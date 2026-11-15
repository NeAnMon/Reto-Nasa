import json
from datetime import timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.database.session import get_db
from backend.app.models.models import (
    Alert,
    CognitiveAssessment,
    CognitiveAssessmentSession,
    CognitiveBaseline,
    CognitiveDomain,
    CognitiveFeedback,
    CognitiveResponse,
    CognitiveResult,
    CognitiveSchedule,
    CognitiveTask,
    CognitiveTest,
    CognitiveTestVersion,
    Conversation,
    ConversationAuditEvent,
    ConversationParticipant,
    EmotionalAssessment,
    EmotionalAssessmentNotification,
    EmotionalAssessmentRequest,
    EmotionalAssessmentResponse,
    EmotionalAssessmentResult,
    EmotionalFollowUp,
    EmotionalQuestion,
    EmotionalQuestionOption,
    EmotionalQuestionnaire,
    EmotionalQuestionnaireVersion,
    EmotionalSupportRequest,
    Message,
    MessageAttachment,
    MessageNotification,
    MessageReadReceipt,
    Mission,
    MissionAssignment,
    SupportRequest,
    User,
)
from backend.app.rules.engine import ContextResolver
from backend.app.schemas.schemas import (
    CognitiveAssessmentCreate,
    CognitiveCompleteRequest,
    CognitivePostponeRequest,
    CognitiveResponsesSubmitRequest,
    CognitiveScheduleCreate,
    ConversationCreateRequest,
    EmotionalCompleteRequest,
    EmotionalFollowUpCreate,
    EmotionalRequestCreate,
    EmotionalRequestPatch,
    EmotionalResponsesSaveRequest,
    MessageCreateRequest,
    MessageFlagPatch,
    SupportRequestCreate,
    SupportRequestStatusPatch,
)
from backend.app.security.auth import (
    ensure_aware,
    get_authorized_astronaut_ids,
    get_current_user,
    log_audit_event,
    require_roles,
    utcnow,
    verify_astronaut_access,
)
from backend.app.services.ai_assistant import AssistiveGuidanceService
from backend.app.services.cognitive_engine import evaluate_and_complete_cognitive_assessment
from backend.app.services.emotional_engine import EmotionalWellnessEngine
from backend.app.services.gamification import (
    award_badge_for_cognitive_domain,
    record_gamification_mission,
)

expansion_router = APIRouter()

VALID_MESSAGE_CATEGORIES = {
    "GENERAL",
    "HEALTH_UPDATE",
    "COGNITIVE_SUPPORT",
    "EMOTIONAL_SUPPORT",
    "MISSION_COORDINATION",
    "TECHNICAL_ISSUE",
    "REQUEST_FOR_ASSISTANCE",
    "URGENT_COMMUNICATION",
}

VALID_SUPPORT_STATUSES = {
    "REQUESTED",
    "RECEIVED",
    "IN_REVIEW",
    "RESPONDED",
    "ESCALATED",
    "CLOSED",
}

EMERGENCY_PROTOCOL_BANNER = (
    "PROTOCOLO DE EMERGENCIA DE VUELO ACTIVO: El Communication Center complementa pero NO reemplaza "
    "el canal prioritario de emergencia médica/operativa. Contacte de inmediato al Oficial Médico de "
    "Tripulación (CMO) y a Dirección de Vuelo por bucle de voz prioritario."
)


# ============================================================================
# HELPER FUNCTIONS FOR ACCESS & SERIALIZATION
# ============================================================================

def _get_assigned_leader_for_mission(db: Session, mission_id: int) -> Optional[User]:
    assign = (
        db.query(MissionAssignment)
        .filter(
            MissionAssignment.mission_id == mission_id,
            MissionAssignment.assignment_role == "MISSION_LEADER",
            MissionAssignment.is_active.is_(True),
        )
        .first()
    )
    if assign and assign.user:
        return assign.user
    return (
        db.query(User)
        .join(User.role)
        .filter(User.role.has(code="MISSION_LEADER"))
        .first()
    )


def _verify_conversation_access(
    db: Session,
    actor: User,
    conv: Conversation,
    audit_justification: Optional[str] = None,
) -> None:
    role_code = actor.role.code if actor.role else "ASTRONAUT"
    if actor.id in (conv.astronaut_id, conv.leader_id):
        return

    if role_code == "ADMINISTRATOR":
        if not audit_justification or len(audit_justification.strip()) < 5:
            db.add(
                ConversationAuditEvent(
                    conversation_id=conv.id,
                    actor_user_id=actor.id,
                    actor_role=role_code,
                    action="ADMIN_CONVERSATION_ACCESS_DENIED_NO_JUSTIFICATION",
                    justification=audit_justification,
                    details="Intento de acceso administrativo a conversación privada sin justificación explícita.",
                )
            )
            log_audit_event(
                db,
                action="ADMIN_CONVERSATION_ACCESS_DENIED",
                resource_type="CONVERSATION",
                actor=actor,
                resource_id=str(conv.id),
                target_user_id=conv.astronaut_id,
                status_code="DENIED",
                details="El administrador no puede leer conversaciones privadas silenciosamente sin justificación de auditoría.",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Privacidad de Comunicaciones: El administrador no puede acceder silenciosamente a "
                    "conversaciones privadas 1-a-1 sin autorización y justificación explícita registrada en auditoría."
                ),
            )
        db.add(
            ConversationAuditEvent(
                conversation_id=conv.id,
                actor_user_id=actor.id,
                actor_role=role_code,
                action="ADMIN_AUDITED_CONVERSATION_ACCESS",
                justification=audit_justification.strip(),
                details=f"Acceso administrativo justificado a conversación #{conv.id}.",
            )
        )
        log_audit_event(
            db,
            action="ADMIN_AUDITED_CONVERSATION_ACCESS",
            resource_type="CONVERSATION",
            actor=actor,
            resource_id=str(conv.id),
            target_user_id=conv.astronaut_id,
            justification=audit_justification.strip(),
            status_code="SUCCESS",
            details=f"Acceso administrativo auditado a conversación #{conv.id}.",
        )
        return

    log_audit_event(
        db,
        action="UNAUTHORIZED_CONVERSATION_ACCESS",
        resource_type="CONVERSATION",
        actor=actor,
        resource_id=str(conv.id),
        target_user_id=conv.astronaut_id,
        status_code="DENIED",
        details=f"Usuario {actor.email} ({role_code}) intentó acceder a conversación no asignada #{conv.id}.",
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Acceso denegado: solo el astronauta y el líder asignado pueden acceder a esta conversación privada.",
    )


def _require_participant(db: Session, actor: User, conv: Conversation, action_name: str) -> None:
    """Escribir o cambiar el estado de mensajes: solo el astronauta y el líder de la conversación.
    El acceso auditado de administración es de solo lectura; nunca se usa una justificación fija."""
    if actor.id in (conv.astronaut_id, conv.leader_id):
        return
    role_code = actor.role.code if actor.role else "ASTRONAUT"
    log_audit_event(
        db,
        action=f"{action_name}_DENIED",
        resource_type="CONVERSATION",
        actor=actor,
        resource_id=str(conv.id),
        target_user_id=conv.astronaut_id,
        status_code="DENIED",
        details=f"Usuario ({role_code}) no participante intentó {action_name} en la conversación #{conv.id}.",
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Solo el astronauta y el líder asignado pueden escribir o modificar mensajes en esta conversación privada.",
    )


PROTECTED_TEXT = "[Contenido privado 1-a-1 protegido por política de confidencialidad]"


def _serialize_conversation(db: Session, conv: Conversation, viewer_id: int) -> Dict[str, Any]:
    astro = db.query(User).filter(User.id == conv.astronaut_id).first()
    leader = db.query(User).filter(User.id == conv.leader_id).first()
    mission = db.query(Mission).filter(Mission.id == conv.mission_id).first()

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.created_at.desc())
        .all()
    )
    last_msg = messages[0] if messages else None
    unread_count = sum(
        1
        for m in messages
        if m.recipient_id == viewer_id
        and (m.delivery_status != "READ" or m.marked_unread_by_recipient)
    )

    return {
        "id": conv.id,
        "mission_id": conv.mission_id,
        "mission_code": mission.code if mission else "",
        "mission_name": mission.name if mission else "",
        "astronaut_id": conv.astronaut_id,
        "astronaut_name": astro.full_name if astro else f"Astronaut #{conv.astronaut_id}",
        "astronaut_crew_code": astro.crew_code if astro else "",
        "astronaut_callsign": (
            astro.astronaut_profile.callsign
            if (astro and astro.astronaut_profile)
            else "Crew"
        ),
        "leader_id": conv.leader_id,
        "leader_name": leader.full_name if leader else f"Leader #{conv.leader_id}",
        "leader_crew_code": leader.crew_code if leader else "",
        "subject": conv.subject,
        "status": conv.status,
        "is_highlighted": conv.is_highlighted,
        "linked_alert_id": conv.linked_alert_id,
        "unread_count": unread_count,
        "total_messages": len(messages),
        "last_message_at": ensure_aware(conv.last_message_at).isoformat() if conv.last_message_at else None,
        "last_message_preview": (
            {
                "id": last_msg.id,
                "sender_id": last_msg.sender_id,
                "category": last_msg.category,
                "content": last_msg.content[:140],
                "delivery_status": last_msg.delivery_status,
                "created_at": ensure_aware(last_msg.created_at).isoformat(),
            }
            if last_msg
            else None
        ),
        "connection_status": "ONLINE",
        "is_simulated": conv.is_simulated,
    }


def _serialize_message(db: Session, m: Message) -> Dict[str, Any]:
    sender = db.query(User).filter(User.id == m.sender_id).first()
    reply_msg = (
        db.query(Message).filter(Message.id == m.reply_to_message_id).first()
        if m.reply_to_message_id
        else None
    )
    attachments = [
        {
            "id": att.id,
            "file_name": att.file_name,
            "mime_type": att.mime_type,
            "file_size_bytes": att.file_size_bytes,
            "safe_summary_note": att.safe_summary_note,
        }
        for att in m.attachments
    ]
    receipts = [
        {
            "user_id": rr.user_id,
            "read_at": ensure_aware(rr.read_at).isoformat(),
        }
        for rr in m.read_receipts
    ]
    return {
        "id": m.id,
        "conversation_id": m.conversation_id,
        "sender_id": m.sender_id,
        "sender_name": sender.full_name if sender else f"User #{m.sender_id}",
        "sender_role": sender.role.code if (sender and sender.role) else "ASTRONAUT",
        "recipient_id": m.recipient_id,
        "content": m.content,
        "category": m.category,
        "delivery_status": m.delivery_status,
        "is_important": m.is_important,
        "marked_unread_by_recipient": m.marked_unread_by_recipient,
        "reply_to_message_id": m.reply_to_message_id,
        "reply_to_preview": (
            {"id": reply_msg.id, "content": reply_msg.content[:100]}
            if reply_msg
            else None
        ),
        "linked_alert_id": m.linked_alert_id,
        "has_attachment": m.has_attachment,
        "attachments": attachments,
        "read_receipts": receipts,
        "is_simulated": m.is_simulated,
        "created_at": ensure_aware(m.created_at).isoformat(),
        "sent_at": ensure_aware(m.sent_at).isoformat(),
    }


def _serialize_support_request(db: Session, sr: SupportRequest) -> Dict[str, Any]:
    astro = db.query(User).filter(User.id == sr.astronaut_id).first()
    leader = db.query(User).filter(User.id == sr.leader_id).first()
    mission = db.query(Mission).filter(Mission.id == sr.mission_id).first()
    return {
        "id": sr.id,
        "astronaut_id": sr.astronaut_id,
        "astronaut_name": astro.full_name if astro else f"Astronaut #{sr.astronaut_id}",
        "astronaut_crew_code": astro.crew_code if astro else "",
        "leader_id": sr.leader_id,
        "leader_name": leader.full_name if leader else f"Leader #{sr.leader_id}",
        "mission_id": sr.mission_id,
        "mission_code": mission.code if mission else "",
        "conversation_id": sr.conversation_id,
        "category": sr.category,
        "reason_title": sr.reason_title,
        "description": sr.description,
        "wants_private_conversation": sr.wants_private_conversation,
        "is_emergency": sr.is_emergency,
        "status": sr.status,
        "leader_response_notes": sr.leader_response_notes,
        "emergency_protocol_displayed": sr.emergency_protocol_displayed,
        "emergency_protocol_instructions": EMERGENCY_PROTOCOL_BANNER if sr.is_emergency else None,
        "is_simulated": sr.is_simulated,
        "created_at": ensure_aware(sr.created_at).isoformat(),
        "updated_at": ensure_aware(sr.updated_at).isoformat(),
    }


# ============================================================================
# MODULE 1: COMMUNICATION CENTER ENDPOINTS
# ============================================================================

@expansion_router.get("/conversations")
def list_conversations(
    mission_id: Optional[int] = None,
    astronaut_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    audit_justification: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role_code = user.role.code if user.role else "ASTRONAUT"
    query = db.query(Conversation)

    if role_code == "ASTRONAUT":
        query = query.filter(Conversation.astronaut_id == user.id)
    elif role_code == "MISSION_LEADER":
        # Conversaciones 1-a-1: un líder solo ve las suyas, no las de otros líderes con el mismo tripulante
        query = query.filter(Conversation.leader_id == user.id)
    elif role_code != "ADMINISTRATOR":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acceso denegado.")
    else:  # ADMINISTRATOR
        # Admin can view assignment metadata list or audited conversations, but not message bodies without justification
        if astronaut_id:
            query = query.filter(Conversation.astronaut_id == astronaut_id)

    if mission_id:
        query = query.filter(Conversation.mission_id == mission_id)
    if astronaut_id and role_code != "ASTRONAUT":
        verify_astronaut_access(db, user, astronaut_id, action_name="FILTER_CONVERSATIONS")
        query = query.filter(Conversation.astronaut_id == astronaut_id)
    if status_filter:
        query = query.filter(Conversation.status == status_filter)

    convs = query.order_by(Conversation.last_message_at.desc()).all()
    serialized = [_serialize_conversation(db, c, user.id) for c in convs]

    # La lista nunca revela contenido a administración: el acceso auditado es por conversación
    # (detalle/mensajes), con justificación validada y registrada en auditoría.
    if role_code == "ADMINISTRATOR":
        for item in serialized:
            if item.get("last_message_preview"):
                item["last_message_preview"]["content"] = PROTECTED_TEXT

    if search:
        q_low = search.strip().lower()
        serialized = [
            c
            for c in serialized
            if q_low in c["astronaut_name"].lower()
            or q_low in c["leader_name"].lower()
            or q_low in c["subject"].lower()
            or q_low in c["mission_code"].lower()
        ]

    return {
        "conversations": serialized,
        "categories": sorted(list(VALID_MESSAGE_CATEGORIES)),
    }


@expansion_router.post("/conversations", status_code=status.HTTP_201_CREATED)
def create_or_get_conversation(
    payload: ConversationCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role_code = user.role.code if user.role else "ASTRONAUT"
    if role_code not in ("ASTRONAUT", "MISSION_LEADER", "ADMINISTRATOR"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acceso denegado.")
    mission = db.query(Mission).filter(Mission.id == payload.mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Misión no encontrada.")

    def _user_with_role(uid: Optional[int], expected_role: str) -> Optional[User]:
        u = db.query(User).filter(User.id == uid).first() if uid else None
        if u is not None and (not u.role or u.role.code != expected_role):
            raise HTTPException(
                status_code=400,
                detail=f"El usuario indicado no tiene el rol {expected_role} requerido para un canal de misión.",
            )
        return u

    if role_code == "ASTRONAUT":
        astro_id = user.id
        leader_user = (
            _user_with_role(payload.leader_id, "MISSION_LEADER")
            if payload.leader_id
            else _get_assigned_leader_for_mission(db, mission.id)
        )
        if not leader_user:
            raise HTTPException(status_code=404, detail="No se encontró líder asignado a la misión.")
        leader_id = leader_user.id
    elif role_code == "MISSION_LEADER":
        if not payload.astronaut_id:
            raise HTTPException(status_code=400, detail="Debe indicar el astronauta destinatario.")
        verify_astronaut_access(db, user, payload.astronaut_id, action_name="CREATE_CONVERSATION")
        astro_id = payload.astronaut_id
        leader_id = user.id
    else:
        if not payload.astronaut_id or not payload.leader_id:
            raise HTTPException(status_code=400, detail="Indique astronaut_id y leader_id.")
        if not _user_with_role(payload.astronaut_id, "ASTRONAUT") or not _user_with_role(payload.leader_id, "MISSION_LEADER"):
            raise HTTPException(status_code=404, detail="Usuario no encontrado.")
        astro_id = payload.astronaut_id
        leader_id = payload.leader_id

    existing = (
        db.query(Conversation)
        .filter(
            Conversation.mission_id == mission.id,
            Conversation.astronaut_id == astro_id,
            Conversation.leader_id == leader_id,
        )
        .first()
    )
    if existing:
        if payload.linked_alert_id:
            existing.linked_alert_id = payload.linked_alert_id
            db.commit()
        return {"conversation": _serialize_conversation(db, existing, user.id), "created": False}

    astro_u = db.query(User).filter(User.id == astro_id).first()
    leader_u = db.query(User).filter(User.id == leader_id).first()
    subj = payload.subject or f"Canal Directo: {astro_u.full_name if astro_u else astro_id} ↔ {leader_u.full_name if leader_u else leader_id}"

    conv = Conversation(
        mission_id=mission.id,
        astronaut_id=astro_id,
        leader_id=leader_id,
        subject=subj,
        status="OPEN",
        is_highlighted=False,
        linked_alert_id=payload.linked_alert_id,
        last_message_at=utcnow(),
        is_simulated=payload.is_simulated,
    )
    db.add(conv)
    db.flush()

    db.add(
        ConversationParticipant(
            conversation_id=conv.id,
            user_id=astro_id,
            role_in_conversation="ASTRONAUT",
            last_seen_at=utcnow(),
        )
    )
    db.add(
        ConversationParticipant(
            conversation_id=conv.id,
            user_id=leader_id,
            role_in_conversation="MISSION_LEADER",
            last_seen_at=utcnow(),
        )
    )
    db.commit()
    db.refresh(conv)
    return {"conversation": _serialize_conversation(db, conv, user.id), "created": True}


@expansion_router.get("/conversations/{conversation_id}")
def get_conversation_detail(
    conversation_id: int,
    audit_justification: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")
    _verify_conversation_access(db, user, conv, audit_justification=audit_justification)
    return {"conversation": _serialize_conversation(db, conv, user.id)}


@expansion_router.get("/conversations/{conversation_id}/messages")
def list_conversation_messages(
    conversation_id: int,
    category: Optional[str] = None,
    only_important: bool = Query(default=False),
    search: Optional[str] = None,
    audit_justification: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")
    _verify_conversation_access(db, user, conv, audit_justification=audit_justification)

    query = db.query(Message).filter(Message.conversation_id == conv.id)
    if category:
        query = query.filter(Message.category == category)
    if only_important:
        query = query.filter(Message.is_important.is_(True))

    msgs = query.order_by(Message.created_at.asc()).all()
    if search:
        s_low = search.strip().lower()
        msgs = [m for m in msgs if s_low in m.content.lower() or s_low in m.category.lower()]

    # Update participant last_seen_at
    part = (
        db.query(ConversationParticipant)
        .filter(
            ConversationParticipant.conversation_id == conv.id,
            ConversationParticipant.user_id == user.id,
        )
        .first()
    )
    if part:
        part.last_seen_at = utcnow()
        db.commit()

    # Credit REVIEW_MISSION_MESSAGES daily mission if astronaut reviews messages
    if user.role and user.role.code == "ASTRONAUT":
        try:
            record_gamification_mission(
                db,
                user_id=user.id,
                daily_mission_code="REVIEW_MISSION_MESSAGES",
                status_mode="COMPLETED",
                reflection_note="Revisión de mensajes de misión en Communication Center.",
                is_simulated=conv.is_simulated,
            )
        except Exception:
            pass

    return {
        "conversation": _serialize_conversation(db, conv, user.id),
        "messages": [_serialize_message(db, m) for m in msgs],
    }


@expansion_router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_201_CREATED)
def send_conversation_message(
    conversation_id: int,
    payload: MessageCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")
    _require_participant(db, user, conv, "SEND_MESSAGE")

    if payload.dedup_key:
        existing_msg = db.query(Message).filter(Message.dedup_key == payload.dedup_key).first()
        if existing_msg:
            # La clave de deduplicación solo devuelve el mensaje si es del mismo remitente y conversación
            # (antes devolvía cualquier mensaje con esa clave: fuga de contenido entre conversaciones).
            if existing_msg.sender_id != user.id or existing_msg.conversation_id != conv.id:
                raise HTTPException(status_code=409, detail="Clave de deduplicación ya utilizada.")
            return {
                "duplicate_prevented": True,
                "message": _serialize_message(db, existing_msg),
                "server_confirmed_delivery": True,
            }

    if payload.reply_to_message_id is not None:
        # La respuesta debe citar un mensaje de esta misma conversación (evita filtrar contenido ajeno en reply_to_preview)
        replied = db.query(Message).filter(Message.id == payload.reply_to_message_id).first()
        if not replied or replied.conversation_id != conv.id:
            raise HTTPException(status_code=400, detail="El mensaje citado no pertenece a esta conversación.")

    cat = payload.category.strip().upper()
    if cat not in VALID_MESSAGE_CATEGORIES:
        cat = "GENERAL"

    recipient_id = conv.leader_id if user.id == conv.astronaut_id else conv.astronaut_id
    now = utcnow()

    msg = Message(
        dedup_key=payload.dedup_key,
        conversation_id=conv.id,
        sender_id=user.id,
        recipient_id=recipient_id,
        content=payload.content.strip(),
        category=cat,
        delivery_status="DELIVERED",
        is_important=payload.is_important or (cat == "URGENT_COMMUNICATION"),
        marked_unread_by_recipient=False,
        reply_to_message_id=payload.reply_to_message_id,
        linked_alert_id=payload.linked_alert_id,
        has_attachment=bool(payload.attachment_file_name),
        is_simulated=payload.is_simulated,
        created_at=now,
        sent_at=now,
    )
    db.add(msg)
    db.flush()

    if payload.attachment_file_name:
        db.add(
            MessageAttachment(
                message_id=msg.id,
                file_name=payload.attachment_file_name.strip()[:180],
                mime_type=payload.attachment_mime_type or "text/plain",
                file_size_bytes=len(payload.content),
                safe_summary_note=payload.attachment_safe_note or "Adjunto operativo verificado",
            )
        )

    conv.last_message_at = now
    if cat in ("URGENT_COMMUNICATION", "REQUEST_FOR_ASSISTANCE"):
        conv.is_highlighted = True
        conv.status = "PENDING_FOLLOWUP"

    db.add(
        MessageNotification(
            user_id=recipient_id,
            conversation_id=conv.id,
            message_id=msg.id,
            title=f"Nuevo mensaje ({cat}) de {user.full_name}",
            is_read=False,
        )
    )
    db.commit()
    db.refresh(msg)

    return {
        "duplicate_prevented": False,
        "server_confirmed_delivery": True,
        "message": _serialize_message(db, msg),
        "urgent_protocol_notice": (
            EMERGENCY_PROTOCOL_BANNER if cat == "URGENT_COMMUNICATION" else None
        ),
    }


@expansion_router.patch("/messages/{message_id}/read")
def mark_message_read(
    message_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado.")
    conv = db.query(Conversation).filter(Conversation.id == msg.conversation_id).first()
    _require_participant(db, user, conv, "MARK_MESSAGE_READ")
    if msg.recipient_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el destinatario puede confirmar la lectura de un mensaje.",
        )

    msg.delivery_status = "READ"
    msg.marked_unread_by_recipient = False
    existing_rr = (
        db.query(MessageReadReceipt)
        .filter(
            MessageReadReceipt.message_id == msg.id,
            MessageReadReceipt.user_id == user.id,
        )
        .first()
    )
    if not existing_rr:
        db.add(
            MessageReadReceipt(
                message_id=msg.id,
                user_id=user.id,
                read_at=utcnow(),
            )
        )

    db.query(MessageNotification).filter(
        MessageNotification.message_id == msg.id,
        MessageNotification.user_id == user.id,
    ).update({"is_read": True}, synchronize_session=False)

    db.commit()
    db.refresh(msg)
    return {"message": _serialize_message(db, msg)}


@expansion_router.patch("/messages/{message_id}/flags")
def update_message_flags(
    message_id: int,
    payload: MessageFlagPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado.")
    conv = db.query(Conversation).filter(Conversation.id == msg.conversation_id).first()
    _require_participant(db, user, conv, "UPDATE_MESSAGE_FLAGS")
    if payload.marked_unread_by_recipient is not None and msg.recipient_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el destinatario puede marcar un mensaje como no leído.",
        )

    if payload.is_important is not None:
        msg.is_important = payload.is_important
    if payload.marked_unread_by_recipient is not None:
        msg.marked_unread_by_recipient = payload.marked_unread_by_recipient
        if payload.marked_unread_by_recipient:
            msg.delivery_status = "DELIVERED"

    db.commit()
    db.refresh(msg)
    return {"message": _serialize_message(db, msg)}


@expansion_router.post("/support-requests", status_code=status.HTTP_201_CREATED)
def create_support_request(
    payload: SupportRequestCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role_code = user.role.code if user.role else "ASTRONAUT"
    if role_code != "ASTRONAUT":
        raise HTTPException(status_code=403, detail="Este botón de solicitud directa está destinado a los astronautas.")

    assign = (
        db.query(MissionAssignment)
        .filter(
            MissionAssignment.user_id == user.id,
            MissionAssignment.is_active.is_(True),
        )
        .first()
    )
    mission_id = payload.mission_id or (assign.mission_id if assign else 1)
    leader_u = _get_assigned_leader_for_mission(db, mission_id)
    if not leader_u:
        raise HTTPException(status_code=404, detail="No hay líder en tierra asignado a esta misión.")

    # Ensure 1-on-1 conversation exists
    conv = (
        db.query(Conversation)
        .filter(
            Conversation.mission_id == mission_id,
            Conversation.astronaut_id == user.id,
            Conversation.leader_id == leader_u.id,
        )
        .first()
    )
    if not conv:
        conv = Conversation(
            mission_id=mission_id,
            astronaut_id=user.id,
            leader_id=leader_u.id,
            subject=f"Canal Directo: {user.full_name} ↔ {leader_u.full_name}",
            status="PENDING_FOLLOWUP",
            is_highlighted=True,
            last_message_at=utcnow(),
            is_simulated=payload.is_simulated,
        )
        db.add(conv)
        db.flush()

    sr = SupportRequest(
        astronaut_id=user.id,
        leader_id=leader_u.id,
        mission_id=mission_id,
        conversation_id=conv.id,
        category=payload.category,
        reason_title=payload.reason_title.strip(),
        description=payload.description.strip(),
        wants_private_conversation=payload.wants_private_conversation,
        is_emergency=payload.is_emergency,
        status="ESCALATED" if payload.is_emergency else "REQUESTED",
        emergency_protocol_displayed=payload.is_emergency,
        is_simulated=payload.is_simulated,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(sr)
    db.flush()

    # Also post a message in the conversation so leader sees it immediately in chat
    msg_cat = "URGENT_COMMUNICATION" if payload.is_emergency else "REQUEST_FOR_ASSISTANCE"
    auto_msg = Message(
        conversation_id=conv.id,
        sender_id=user.id,
        recipient_id=leader_u.id,
        content=(
            f"[SOLICITUD DE APOYO #{sr.id} — {payload.reason_title}] "
            f"{payload.description} "
            f"{'(Conversación privada solicitada)' if payload.wants_private_conversation else ''}"
        ),
        category=msg_cat,
        delivery_status="DELIVERED",
        is_important=True,
        is_simulated=payload.is_simulated,
        created_at=utcnow(),
        sent_at=utcnow(),
    )
    db.add(auto_msg)
    conv.last_message_at = utcnow()
    conv.is_highlighted = True
    conv.status = "PENDING_FOLLOWUP"

    if payload.is_emergency:
        ctx = ContextResolver.resolve_active_context(db, mission_id, user.id)
        db.add(
            Alert(
                astronaut_id=user.id,
                mission_id=mission_id,
                indicator_code="MOOD_WELLNESS",
                rule_code="RULE_SUPPORT_REQUEST_EMERGENCY_DEMO",
                rule_version_label="1.0-DEMO",
                value_recorded="URGENT_SUPPORT_REQUEST",
                unit="solicitud",
                priority="CRITICAL",
                operational_state="CRITICAL",
                status="ESCALATED",
                title=f"[CRITICAL] Solicitud de Apoyo Urgente: {payload.reason_title}",
                explanation=f"El astronauta {user.full_name} activó una solicitud de apoyo urgente en Communication Center.",
                data_quality="SYNTHETIC_DEMO" if payload.is_simulated else "VALIDATED",
                immediate_action=EMERGENCY_PROTOCOL_BANNER,
                followup_recommendation="Establecer contacto prioritario de inmediato.",
                environment_code=str(ctx.get("environment_code") or "LUNAR_SURFACE"),
                phase_code=str(ctx.get("phase_code") or "SURFACE"),
                is_simulated=payload.is_simulated,
                created_at=utcnow(),
                updated_at=utcnow(),
            )
        )

    db.commit()
    db.refresh(sr)
    return {
        "support_request": _serialize_support_request(db, sr),
        "emergency_protocol_instructions": (
            EMERGENCY_PROTOCOL_BANNER if payload.is_emergency else None
        ),
    }


@expansion_router.get("/support-requests")
def list_support_requests(
    mission_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role_code = user.role.code if user.role else "ASTRONAUT"
    query = db.query(SupportRequest)
    if role_code == "ASTRONAUT":
        query = query.filter(SupportRequest.astronaut_id == user.id)
    elif role_code == "MISSION_LEADER":
        # Solo las solicitudes dirigidas a este líder
        query = query.filter(SupportRequest.leader_id == user.id)

    if mission_id:
        query = query.filter(SupportRequest.mission_id == mission_id)
    if status_filter:
        query = query.filter(SupportRequest.status == status_filter)

    rows = query.order_by(SupportRequest.created_at.desc()).all()
    out = [_serialize_support_request(db, r) for r in rows]
    if role_code == "ADMINISTRATOR":
        # Administración ve metadatos y estado, no el contenido privado de la solicitud
        for item in out:
            item["reason_title"] = PROTECTED_TEXT
            item["description"] = PROTECTED_TEXT
            if item.get("leader_response_notes"):
                item["leader_response_notes"] = PROTECTED_TEXT
    return {"support_requests": out}


@expansion_router.patch("/support-requests/{request_id}/status")
def update_support_request_status(
    request_id: int,
    payload: SupportRequestStatusPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sr = db.query(SupportRequest).filter(SupportRequest.id == request_id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Solicitud de apoyo no encontrada.")

    role_code = user.role.code if user.role else "ASTRONAUT"
    if role_code == "ASTRONAUT" and sr.astronaut_id != user.id:
        raise HTTPException(status_code=403, detail="No autorizado.")
    if role_code == "MISSION_LEADER" and sr.leader_id != user.id:
        raise HTTPException(status_code=403, detail="Solo el líder destinatario puede gestionar esta solicitud.")
    if role_code not in ("ASTRONAUT", "MISSION_LEADER"):
        raise HTTPException(status_code=403, detail="Administración tiene acceso de solo lectura a las solicitudes de apoyo.")

    new_st = payload.status.strip().upper()
    if new_st not in VALID_SUPPORT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Use uno de: {sorted(list(VALID_SUPPORT_STATUSES))}")

    if role_code == "ASTRONAUT":
        # El astronauta solo puede cerrar su propia solicitud; nunca responder como líder
        if new_st != "CLOSED":
            raise HTTPException(status_code=403, detail="El astronauta solo puede cerrar su propia solicitud.")
        if payload.leader_response_notes and payload.leader_response_notes.strip():
            raise HTTPException(status_code=403, detail="Solo el líder destinatario puede escribir la respuesta.")

    sr.status = new_st
    if role_code == "MISSION_LEADER" and payload.leader_response_notes:
        sr.leader_response_notes = payload.leader_response_notes.strip()
    sr.updated_at = utcnow()
    db.commit()
    db.refresh(sr)

    if role_code == "ASTRONAUT":
        try:
            record_gamification_mission(
                db,
                user_id=user.id,
                daily_mission_code="RESPOND_SUPPORT_REQUEST",
                status_mode="COMPLETED",
                reflection_note=f"Seguimiento de solicitud de apoyo #{sr.id}",
                is_simulated=sr.is_simulated,
            )
        except Exception:
            pass

    log_audit_event(
        db,
        action="UPDATE_SUPPORT_REQUEST_STATUS",
        resource_type="SUPPORT_REQUEST",
        actor=user,
        resource_id=str(sr.id),
        target_user_id=sr.astronaut_id,
        details=f"Solicitud de apoyo #{sr.id} actualizada a {new_st}.",
    )
    return {"support_request": _serialize_support_request(db, sr)}


# ============================================================================
# MODULE 2: COGNITIVE ASSESSMENT CENTER ENDPOINTS
# ============================================================================

def _serialize_cognitive_assessment(db: Session, ca: CognitiveAssessment) -> Dict[str, Any]:
    dom = db.query(CognitiveDomain).filter(CognitiveDomain.code == ca.domain_code).first()
    test = db.query(CognitiveTest).filter(CognitiveTest.code == ca.test_code).first()
    astro = db.query(User).filter(User.id == ca.astronaut_id).first()
    res = ca.result
    baseline = (
        db.query(CognitiveBaseline)
        .filter(
            CognitiveBaseline.astronaut_id == ca.astronaut_id,
            CognitiveBaseline.domain_code == ca.domain_code,
            CognitiveBaseline.difficulty == ca.difficulty,
            CognitiveBaseline.version_number == ca.version_number,
        )
        .first()
    )
    return {
        "id": ca.id,
        "astronaut_id": ca.astronaut_id,
        "astronaut_name": astro.full_name if astro else f"Astronaut #{ca.astronaut_id}",
        "mission_id": ca.mission_id,
        "domain_code": ca.domain_code,
        "domain_name": dom.name if dom else ca.domain_code,
        "test_code": ca.test_code,
        "test_title": test.title if test else ca.test_code,
        "version_number": ca.version_number,
        "difficulty": ca.difficulty,
        "phase_code": ca.phase_code,
        "environment_code": ca.environment_code,
        "readiness_status": ca.readiness_status,
        "conditions_notes": ca.conditions_notes,
        "completion_status": ca.completion_status,
        "postpone_reason": ca.postpone_reason,
        "attempt_number": ca.attempt_number,
        "duration_seconds": ca.duration_seconds,
        "is_simulated": ca.is_simulated,
        "started_at": ensure_aware(ca.started_at).isoformat(),
        "completed_at": ensure_aware(ca.completed_at).isoformat() if ca.completed_at else None,
        "comparable_baseline": (
            {
                "baseline_accuracy_percent": baseline.baseline_accuracy_percent,
                "baseline_mean_rt_ms": baseline.baseline_mean_rt_ms,
                "difficulty": baseline.difficulty,
                "version_number": baseline.version_number,
            }
            if baseline
            else None
        ),
        "result": (
            {
                "total_items": res.total_items,
                "correct_count": res.correct_count,
                "incorrect_count": res.incorrect_count,
                "omissions_count": res.omissions_count,
                "accuracy_percent": res.accuracy_percent,
                "mean_response_time_ms": res.mean_response_time_ms,
                "response_time_variability_ms": res.response_time_variability_ms,
                "moves_count": res.moves_count,
                "targets_tracked": res.targets_tracked,
                "requires_review": res.requires_review,
                "practice_effect_note": res.practice_effect_note,
                "non_diagnostic_summary": res.non_diagnostic_summary,
            }
            if res
            else None
        ),
    }


@expansion_router.get("/cognitive/domains")
def list_cognitive_domains(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    domains = db.query(CognitiveDomain).order_by(CognitiveDomain.id.asc()).all()
    tests = db.query(CognitiveTest).filter(CognitiveTest.is_active.is_(True)).all()
    tests_by_dom = {t.domain_code: t for t in tests}
    return {
        "scientific_integrity_notice": (
            "Las actividades cognitivas de AstroVital registran métricas específicas por dominio "
            "(aciertos, errores, omisiones y tiempo de respuesta) comparadas únicamente con la línea base "
            "personal del mismo dominio, dificultad y versión. No calculan un puntaje global único de "
            "capacidad mental ni diagnostican deterioro cognitivo."
        ),
        "domains": [
            {
                "code": d.code,
                "name": d.name,
                "objective": d.objective,
                "scientific_disclaimer": d.scientific_disclaimer,
                "badge_code": d.badge_code,
                "default_test_code": tests_by_dom[d.code].code if d.code in tests_by_dom else None,
                "default_test_title": tests_by_dom[d.code].title if d.code in tests_by_dom else d.name,
                "estimated_duration_seconds": (
                    tests_by_dom[d.code].estimated_duration_seconds if d.code in tests_by_dom else 60
                ),
            }
            for d in domains
        ],
    }


@expansion_router.get("/cognitive/tests")
def list_cognitive_tests(
    domain_code: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(CognitiveTest).filter(CognitiveTest.is_active.is_(True))
    if domain_code:
        query = query.filter(CognitiveTest.domain_code == domain_code)
    tests = query.order_by(CognitiveTest.id.asc()).all()
    return {
        "tests": [
            {
                "id": t.id,
                "code": t.code,
                "domain_code": t.domain_code,
                "title": t.title,
                "instructions": t.instructions,
                "practice_example": json.loads(t.practice_example_json or "{}"),
                "estimated_duration_seconds": t.estimated_duration_seconds,
                "current_version": t.current_version,
                "supported_difficulties": ["BASIC", "INTERMEDIATE", "ADVANCED"],
            }
            for t in tests
        ]
    }


@expansion_router.get("/cognitive/tests/{test_identifier}")
def get_cognitive_test_detail(
    test_identifier: str,
    difficulty: str = Query(default="INTERMEDIATE"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if test_identifier.isdigit():
        test = db.query(CognitiveTest).filter(CognitiveTest.id == int(test_identifier)).first()
    else:
        test = db.query(CognitiveTest).filter(CognitiveTest.code == test_identifier).first()
    if not test:
        raise HTTPException(status_code=404, detail="Prueba cognitiva no encontrada.")

    diff_clean = difficulty.strip().upper()
    if diff_clean not in ("BASIC", "INTERMEDIATE", "ADVANCED"):
        diff_clean = "INTERMEDIATE"

    tasks = (
        db.query(CognitiveTask)
        .filter(
            CognitiveTask.test_code == test.code,
            CognitiveTask.difficulty == diff_clean,
        )
        .order_by(CognitiveTask.sequence_order.asc())
        .all()
    )
    dom = db.query(CognitiveDomain).filter(CognitiveDomain.code == test.domain_code).first()

    return {
        "test": {
            "id": test.id,
            "code": test.code,
            "domain_code": test.domain_code,
            "domain_name": dom.name if dom else test.domain_code,
            "objective": dom.objective if dom else "",
            "scientific_disclaimer": dom.scientific_disclaimer if dom else "",
            "title": test.title,
            "difficulty": diff_clean,
            "instructions": test.instructions,
            "practice_example": json.loads(test.practice_example_json or "{}"),
            "estimated_duration_seconds": test.estimated_duration_seconds,
            "version_number": test.current_version,
            "tasks": [
                {
                    "task_index": tk.sequence_order,
                    "prompt_text": tk.prompt_text,
                    "stimulus": json.loads(tk.stimulus_json or "{}"),
                    "options": json.loads(tk.options_json or "[]"),
                    "correct_answer_key": tk.correct_answer_key,
                }
                for tk in tasks
            ],
        }
    }


@expansion_router.post("/cognitive/assessments", status_code=status.HTTP_201_CREATED)
def start_cognitive_assessment(
    payload: CognitiveAssessmentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dom = db.query(CognitiveDomain).filter(CognitiveDomain.code == payload.domain_code).first()
    if not dom:
        raise HTTPException(status_code=404, detail="Dominio cognitivo no encontrado.")

    test = (
        db.query(CognitiveTest).filter(CognitiveTest.code == payload.test_code).first()
        if payload.test_code
        else db.query(CognitiveTest).filter(CognitiveTest.domain_code == dom.code).first()
    )
    if not test:
        raise HTTPException(status_code=404, detail="Prueba cognitiva no encontrada para el dominio.")

    assign = (
        db.query(MissionAssignment)
        .filter(MissionAssignment.user_id == user.id, MissionAssignment.is_active.is_(True))
        .first()
    )
    mission_id = payload.mission_id or (assign.mission_id if assign else 1)
    ctx = ContextResolver.resolve_active_context(db, mission_id, user.id)

    diff = payload.difficulty.strip().upper()
    if diff not in ("BASIC", "INTERMEDIATE", "ADVANCED"):
        diff = "INTERMEDIATE"

    prev_attempts = (
        db.query(CognitiveAssessment)
        .filter(
            CognitiveAssessment.astronaut_id == user.id,
            CognitiveAssessment.domain_code == dom.code,
            CognitiveAssessment.difficulty == diff,
            CognitiveAssessment.version_number == test.current_version,
        )
        .count()
    )

    is_postponed = payload.readiness_status == "POSTPONED" or bool(payload.postpone_reason)
    comp_status = "POSTPONED" if is_postponed else "IN_PROGRESS"

    ca = CognitiveAssessment(
        astronaut_id=user.id,
        mission_id=mission_id,
        domain_code=dom.code,
        test_code=test.code,
        version_number=test.current_version,
        difficulty=diff,
        phase_code=str(ctx.get("phase_code") or "SURFACE"),
        environment_code=str(ctx.get("environment_code") or "LUNAR_SURFACE"),
        readiness_status=payload.readiness_status,
        conditions_notes=payload.conditions_notes,
        completion_status=comp_status,
        postpone_reason=payload.postpone_reason,
        attempt_number=prev_attempts + 1,
        duration_seconds=0.0,
        source_code="INTERACTIVE_SESSION",
        is_simulated=payload.is_simulated,
        started_at=utcnow(),
        completed_at=utcnow() if is_postponed else None,
    )
    db.add(ca)
    db.flush()

    db.add(
        CognitiveAssessmentSession(
            assessment_id=ca.id,
            current_step_index=0,
            autosave_state_json=json.dumps({"status": comp_status}),
        )
    )
    db.commit()
    db.refresh(ca)

    tasks = (
        db.query(CognitiveTask)
        .filter(CognitiveTask.test_code == test.code, CognitiveTask.difficulty == diff)
        .order_by(CognitiveTask.sequence_order.asc())
        .all()
    )

    return {
        "assessment": _serialize_cognitive_assessment(db, ca),
        "test": {
            "code": test.code,
            "title": test.title,
            "instructions": test.instructions,
            "practice_example": json.loads(test.practice_example_json or "{}"),
            "tasks": [
                {
                    "task_index": tk.sequence_order,
                    "prompt_text": tk.prompt_text,
                    "stimulus": json.loads(tk.stimulus_json or "{}"),
                    "options": json.loads(tk.options_json or "[]"),
                    "correct_answer_key": tk.correct_answer_key,
                }
                for tk in tasks
            ],
        },
    }


@expansion_router.get("/cognitive/assessments")
def list_cognitive_assessments(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    domain_code: Optional[str] = None,
    completion_status: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    verify_astronaut_access(db, user, target_id, action_name="LIST_COGNITIVE_ASSESSMENTS")

    query = db.query(CognitiveAssessment).filter(CognitiveAssessment.astronaut_id == target_id)
    if mission_id:
        query = query.filter(CognitiveAssessment.mission_id == mission_id)
    if domain_code:
        query = query.filter(CognitiveAssessment.domain_code == domain_code)
    if completion_status:
        query = query.filter(CognitiveAssessment.completion_status == completion_status)

    rows = query.order_by(CognitiveAssessment.started_at.desc()).limit(60).all()
    return {"assessments": [_serialize_cognitive_assessment(db, r) for r in rows]}


@expansion_router.get("/cognitive/assessments/{assessment_id}")
def get_cognitive_assessment_detail(
    assessment_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ca = db.query(CognitiveAssessment).filter(CognitiveAssessment.id == assessment_id).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Evaluación cognitiva no encontrada.")
    verify_astronaut_access(db, user, ca.astronaut_id, action_name="GET_COGNITIVE_ASSESSMENT")
    return {"assessment": _serialize_cognitive_assessment(db, ca)}


@expansion_router.post("/cognitive/assessments/{assessment_id}/responses")
def submit_cognitive_responses(
    assessment_id: int,
    payload: CognitiveResponsesSubmitRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ca = db.query(CognitiveAssessment).filter(CognitiveAssessment.id == assessment_id).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Evaluación cognitiva no encontrada.")
    # Solo la persona evaluada (ningún otro rol puede responder, completar o posponer en su nombre)
    if ca.astronaut_id != user.id:
        raise HTTPException(status_code=403, detail="Solo puede enviar respuestas a su propia evaluación.")

    tasks_map = {
        tk.sequence_order: tk
        for tk in db.query(CognitiveTask)
        .filter(CognitiveTask.test_code == ca.test_code, CognitiveTask.difficulty == ca.difficulty)
        .all()
    }

    # Replace existing responses for submitted task_indices so autosave/retry works idempotently
    for item in payload.responses:
        db.query(CognitiveResponse).filter(
            CognitiveResponse.assessment_id == ca.id,
            CognitiveResponse.task_index == item.task_index,
        ).delete(synchronize_session=False)

        tk_def = tasks_map.get(item.task_index)
        if item.is_omission:
            is_corr = False
        elif item.is_correct is not None:
            is_corr = item.is_correct
        elif tk_def:
            is_corr = item.selected_answer.strip() == tk_def.correct_answer_key.strip()
        else:
            is_corr = True

        db.add(
            CognitiveResponse(
                assessment_id=ca.id,
                task_index=item.task_index,
                selected_answer=item.selected_answer,
                is_correct=is_corr,
                is_omission=item.is_omission,
                response_time_ms=item.response_time_ms,
                moves_or_actions_count=item.moves_or_actions_count,
                decision_sequence_json=(
                    json.dumps(item.decision_sequence, ensure_ascii=False)
                    if item.decision_sequence is not None
                    else None
                ),
                recorded_at=utcnow(),
            )
        )

    sess = (
        db.query(CognitiveAssessmentSession)
        .filter(CognitiveAssessmentSession.assessment_id == ca.id)
        .first()
    )
    if sess:
        sess.current_step_index = payload.current_step_index
        if payload.autosave_state is not None:
            sess.autosave_state_json = json.dumps(payload.autosave_state, ensure_ascii=False)
        sess.updated_at = utcnow()

    db.commit()
    return {
        "assessment_id": ca.id,
        "saved_responses_count": len(payload.responses),
        "current_step_index": payload.current_step_index,
    }


@expansion_router.post("/cognitive/assessments/{assessment_id}/complete")
def complete_cognitive_assessment_endpoint(
    assessment_id: int,
    payload: CognitiveCompleteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ca = db.query(CognitiveAssessment).filter(CognitiveAssessment.id == assessment_id).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Evaluación cognitiva no encontrada.")
    # Solo la persona evaluada (ningún otro rol puede responder, completar o posponer en su nombre)
    if ca.astronaut_id != user.id:
        raise HTTPException(status_code=403, detail="Solo puede finalizar su propia evaluación.")

    ca.completion_status = "COMPLETED"
    ca.duration_seconds = payload.duration_seconds
    ca.completed_at = utcnow()

    result_obj, alert_obj = evaluate_and_complete_cognitive_assessment(
        db=db,
        assessment=ca,
        duration_seconds=payload.duration_seconds,
    )

    db.add(
        CognitiveFeedback(
            assessment_id=ca.id,
            astronaut_id=ca.astronaut_id,
            perceived_difficulty=payload.perceived_difficulty,
            notes=payload.feedback_notes,
            created_at=utcnow(),
        )
    )

    # Mark matching pending schedule as COMPLETED
    sched = (
        db.query(CognitiveSchedule)
        .filter(
            CognitiveSchedule.astronaut_id == ca.astronaut_id,
            CognitiveSchedule.domain_code == ca.domain_code,
            CognitiveSchedule.status == "PENDING",
        )
        .first()
    )
    if sched:
        sched.status = "COMPLETED"

    db.commit()
    db.refresh(ca)

    # Credit Gamification Missions & Badges for participation
    # Insignia del dominio (antes se llamaba con 3 argumentos y la firma exige 4 → TypeError / 500)
    dom_row = db.query(CognitiveDomain).filter(CognitiveDomain.code == ca.domain_code).first()
    badges_awarded = award_badge_for_cognitive_domain(
        db, ca.astronaut_id, dom_row.badge_code if dom_row else None, ca.domain_code
    )
    if badges_awarded:
        db.commit()
    gam_update = None
    try:
        gam_update = record_gamification_mission(
            db=db,
            user_id=ca.astronaut_id,
            daily_mission_code="COMPLETE_COGNITIVE_CHECK",
            status_mode="COMPLETED",
            reflection_note=f"Actividad cognitiva completada en dominio {ca.domain_code}.",
            is_simulated=ca.is_simulated,
        )
        if ca.domain_code in ("MEMORY", "VISUAL_LEARNING"):
            record_gamification_mission(
                db=db,
                user_id=ca.astronaut_id,
                daily_mission_code="MEMORY_TRAINING_ACTIVITY",
                status_mode="COMPLETED",
                reflection_note=f"Entrenamiento de memoria ({ca.domain_code}).",
                is_simulated=ca.is_simulated,
            )
        elif ca.domain_code in ("ATTENTION", "VISUAL_TRACKING"):
            record_gamification_mission(
                db=db,
                user_id=ca.astronaut_id,
                daily_mission_code="VISUAL_ATTENTION_ACTIVITY",
                status_mode="COMPLETED",
                reflection_note=f"Entrenamiento de atención visual ({ca.domain_code}).",
                is_simulated=ca.is_simulated,
            )
    except Exception:
        pass

    return {
        "assessment": _serialize_cognitive_assessment(db, ca),
        "badges_awarded": badges_awarded,
        "gamification_update": gam_update,
        "alert_generated": (
            {"id": alert_obj.id, "title": alert_obj.title, "priority": alert_obj.priority}
            if alert_obj
            else None
        ),
    }


@expansion_router.post("/cognitive/assessments/{assessment_id}/postpone")
def postpone_cognitive_assessment(
    assessment_id: int,
    payload: CognitivePostponeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ca = db.query(CognitiveAssessment).filter(CognitiveAssessment.id == assessment_id).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Evaluación cognitiva no encontrada.")
    # Solo la persona evaluada (ningún otro rol puede responder, completar o posponer en su nombre)
    if ca.astronaut_id != user.id:
        raise HTTPException(status_code=403, detail="Solo puede posponer su propia evaluación.")

    ca.completion_status = "POSTPONED"
    ca.readiness_status = "POSTPONED"
    ca.postpone_reason = payload.postpone_reason.strip()
    ca.completed_at = utcnow()
    db.commit()
    db.refresh(ca)
    return {
        "message": "Evaluación pospuesta sin penalización. Podrás retomarla cuando tus condiciones de descanso u operación lo permitan.",
        "assessment": _serialize_cognitive_assessment(db, ca),
    }


@expansion_router.get("/cognitive/history")
def get_cognitive_history(
    astronaut_id: Optional[int] = None,
    domain_code: Optional[str] = None,
    difficulty: Optional[str] = None,
    phase_code: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    verify_astronaut_access(db, user, target_id, action_name="GET_COGNITIVE_HISTORY")

    query = db.query(CognitiveAssessment).filter(
        CognitiveAssessment.astronaut_id == target_id,
        CognitiveAssessment.completion_status == "COMPLETED",
    )
    if domain_code:
        query = query.filter(CognitiveAssessment.domain_code == domain_code)
    if difficulty:
        query = query.filter(CognitiveAssessment.difficulty == difficulty)
    if phase_code:
        query = query.filter(CognitiveAssessment.phase_code == phase_code)

    rows = query.order_by(CognitiveAssessment.completed_at.asc()).all()
    return {
        "astronaut_id": target_id,
        "comparability_rule": (
            "Sólo deben compararse directamente resultados obtenidos con la misma prueba, "
            "el mismo dominio, la misma dificultad y la misma versión."
        ),
        "history": [_serialize_cognitive_assessment(db, r) for r in rows],
    }


@expansion_router.get("/cognitive/analytics")
def get_cognitive_analytics(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    domain_code: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    verify_astronaut_access(db, user, target_id, action_name="GET_COGNITIVE_ANALYTICS")

    query = db.query(CognitiveAssessment).filter(
        CognitiveAssessment.astronaut_id == target_id,
        CognitiveAssessment.completion_status == "COMPLETED",
    )
    if mission_id:
        query = query.filter(CognitiveAssessment.mission_id == mission_id)
    if domain_code:
        query = query.filter(CognitiveAssessment.domain_code == domain_code)

    rows = query.order_by(CognitiveAssessment.completed_at.asc()).all()
    by_domain: Dict[str, List[Dict[str, Any]]] = {}
    for ca in rows:
        if not ca.result:
            continue
        by_domain.setdefault(ca.domain_code, []).append(
            {
                "assessment_id": ca.id,
                "completed_at": ensure_aware(ca.completed_at).isoformat() if ca.completed_at else None,
                "phase_code": ca.phase_code,
                "environment_code": ca.environment_code,
                "difficulty": ca.difficulty,
                "version_number": ca.version_number,
                "attempt_number": ca.attempt_number,
                "readiness_status": ca.readiness_status,
                "accuracy_percent": ca.result.accuracy_percent,
                "mean_response_time_ms": ca.result.mean_response_time_ms,
                "omissions_count": ca.result.omissions_count,
                "requires_review": ca.result.requires_review,
            }
        )

    return {
        "astronaut_id": target_id,
        "single_global_score_prohibited": True,
        "methodology_disclaimer": (
            "AstroVital presenta métricas longitudinales separadas por dominio cognitivo. "
            "No combina dominios distintos en un 'puntaje de inteligencia' o 'capacidad mental total' "
            "y advierte explícitamente el efecto de práctica por repetición."
        ),
        "domains_series": by_domain,
    }


@expansion_router.get("/cognitive/schedules")
def list_cognitive_schedules(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    verify_astronaut_access(db, user, target_id, action_name="LIST_COGNITIVE_SCHEDULES")

    query = db.query(CognitiveSchedule).filter(CognitiveSchedule.astronaut_id == target_id)
    if mission_id:
        query = query.filter(CognitiveSchedule.mission_id == mission_id)
    rows = query.order_by(CognitiveSchedule.scheduled_for.asc()).all()

    return {
        "schedules": [
            {
                "id": s.id,
                "astronaut_id": s.astronaut_id,
                "mission_id": s.mission_id,
                "domain_code": s.domain_code,
                "test_code": s.test_code,
                "difficulty": s.difficulty,
                "scheduled_for": ensure_aware(s.scheduled_for).isoformat(),
                "status": s.status,
                "postpone_reason": s.postpone_reason,
                "is_simulated": s.is_simulated,
            }
            for s in rows
        ]
    }


@expansion_router.post("/cognitive/schedules", status_code=status.HTTP_201_CREATED)
def create_cognitive_schedule(
    payload: CognitiveScheduleCreate,
    user: User = Depends(require_roles(["MISSION_LEADER", "ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    verify_astronaut_access(db, user, payload.astronaut_id, action_name="CREATE_COGNITIVE_SCHEDULE")
    dom = db.query(CognitiveDomain).filter(CognitiveDomain.code == payload.domain_code).first()
    if not dom:
        raise HTTPException(status_code=404, detail="Dominio cognitivo no encontrado.")
    test = (
        db.query(CognitiveTest).filter(CognitiveTest.code == payload.test_code).first()
        if payload.test_code
        else db.query(CognitiveTest).filter(CognitiveTest.domain_code == dom.code).first()
    )
    if not test:
        raise HTTPException(status_code=404, detail="Prueba cognitiva no encontrada.")

    sched = CognitiveSchedule(
        astronaut_id=payload.astronaut_id,
        mission_id=payload.mission_id,
        domain_code=dom.code,
        test_code=test.code,
        difficulty=payload.difficulty.strip().upper(),
        scheduled_for=utcnow() + timedelta(hours=payload.due_in_hours),
        assigned_by_user_id=user.id,
        status="PENDING",
        is_simulated=payload.is_simulated,
    )
    db.add(sched)
    db.commit()
    db.refresh(sched)
    return {
        "schedule": {
            "id": sched.id,
            "astronaut_id": sched.astronaut_id,
            "domain_code": sched.domain_code,
            "test_code": sched.test_code,
            "difficulty": sched.difficulty,
            "scheduled_for": ensure_aware(sched.scheduled_for).isoformat(),
            "status": sched.status,
        }
    }


# ============================================================================
# MODULE 3: EMOTIONAL ASSESSMENT CENTER ENDPOINTS
# ============================================================================

def _serialize_emotional_request(
    db: Session,
    req: EmotionalAssessmentRequest,
    viewer: User,
    include_private_answers: bool = False,
    audit_justification: Optional[str] = None,
) -> Dict[str, Any]:
    astro = db.query(User).filter(User.id == req.astronaut_id).first()
    mission = db.query(Mission).filter(Mission.id == req.mission_id).first()
    q_obj = db.query(EmotionalQuestionnaire).filter(EmotionalQuestionnaire.code == req.questionnaire_code).first()
    ea = req.assessment
    res = ea.result if ea else None

    role_code = viewer.role.code if viewer.role else "ASTRONAUT"
    can_view_detailed_answers = False

    if role_code == "ASTRONAUT" and viewer.id == req.astronaut_id:
        can_view_detailed_answers = True
    elif role_code == "ADMINISTRATOR" and include_private_answers:
        if ea and ea.allow_admin_detailed_review and audit_justification and len(audit_justification.strip()) >= 5:
            can_view_detailed_answers = True
            log_audit_event(
                db,
                action="ADMIN_AUDITED_EMOTIONAL_ASSESSMENT_READ",
                resource_type="EMOTIONAL_ASSESSMENT",
                actor=viewer,
                resource_id=str(req.id),
                target_user_id=req.astronaut_id,
                justification=audit_justification.strip(),
                status_code="SUCCESS",
                details=f"Acceso auditado autorizado por el astronauta a respuestas emocionales de solicitud #{req.id}.",
            )
        else:
            log_audit_event(
                db,
                action="ADMIN_EMOTIONAL_PRIVATE_ACCESS_DENIED",
                resource_type="EMOTIONAL_ASSESSMENT",
                actor=viewer,
                resource_id=str(req.id),
                target_user_id=req.astronaut_id,
                justification=audit_justification,
                status_code="DENIED",
                details="Intento de lectura de respuestas detalladas emocionales denegado por política de privacidad.",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Privacidad Emocional Reforzada: El administrador puede gestionar solicitudes y ver el estado "
                    "operativo de cumplimiento, pero no puede inspeccionar respuestas detalladas sin consentimiento "
                    "del astronauta y justificación explícita de auditoría."
                ),
            )
    elif role_code == "MISSION_LEADER" and include_private_answers:
        log_audit_event(
            db,
            action="LEADER_EMOTIONAL_PRIVATE_ACCESS_DENIED",
            resource_type="EMOTIONAL_ASSESSMENT",
            actor=viewer,
            resource_id=str(req.id),
            target_user_id=req.astronaut_id,
            status_code="DENIED",
            details="El líder de misión sólo visualiza señales operativas autorizadas, no respuestas individuales.",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El líder en tierra sólo puede ver el resumen operativo autorizado, nunca las respuestas detalladas privadas.",
        )

    followups = (
        db.query(EmotionalFollowUp)
        .filter(EmotionalFollowUp.request_id == req.id)
        .order_by(EmotionalFollowUp.created_at.desc())
        .all()
    )

    out: Dict[str, Any] = {
        "id": req.id,
        "requested_by_admin_id": req.requested_by_admin_id,
        "astronaut_id": req.astronaut_id,
        "astronaut_name": astro.full_name if astro else f"Astronaut #{req.astronaut_id}",
        "astronaut_crew_code": astro.crew_code if astro else "",
        "mission_id": req.mission_id,
        "mission_code": mission.code if mission else "",
        "questionnaire_code": req.questionnaire_code,
        "questionnaire_title": q_obj.title if q_obj else req.questionnaire_code,
        "version_number": req.version_number,
        "periodicity": req.periodicity,
        "is_recurring": req.is_recurring,
        "priority": req.priority,
        "custom_message": req.custom_message,
        "status": req.status,
        "postpone_reason": req.postpone_reason,
        "status_history": json.loads(req.status_history_json or "[]"),
        "created_at": ensure_aware(req.created_at).isoformat(),
        "sent_at": ensure_aware(req.sent_at).isoformat() if req.sent_at else None,
        "due_at": ensure_aware(req.due_at).isoformat() if req.due_at else None,
        "completed_at": ensure_aware(req.completed_at).isoformat() if req.completed_at else None,
        "is_simulated": req.is_simulated,
        "assessment_id": ea.id if ea else None,
        "operational_result": (
            {
                "operational_state": res.operational_state,
                "explicit_support_requested": res.explicit_support_requested,
                "urgent_protocol_triggered": res.urgent_protocol_triggered,
                "authorized_operational_summary": (
                    res.authorized_operational_summary
                    if (can_view_detailed_answers or (ea and ea.share_summary_with_leader))
                    else "Resumen operativo restringido por preferencia de privacidad del astronauta."
                ),
                "personal_feedback_summary": (
                    res.personal_feedback_summary if can_view_detailed_answers else None
                ),
                "recommended_next_step": res.recommended_next_step,
            }
            if res
            else None
        ),
        "followups": [
            {
                "id": f.id,
                "author_role": f.author_role,
                "action_type": f.action_type,
                "notes": f.notes,
                "created_at": ensure_aware(f.created_at).isoformat(),
            }
            for f in followups
        ],
        "privacy_redacted": not can_view_detailed_answers,
    }

    if can_view_detailed_answers and ea:
        out["detailed_responses"] = [
            {
                "question_code": r.question_code,
                "dimension_code": r.dimension_code,
                "response_value": r.response_value,
                "numeric_score": r.numeric_score,
                "open_text_answer": r.open_text_answer,
                "prefer_not_to_answer": r.prefer_not_to_answer,
            }
            for r in ea.responses
        ]

    return out


@expansion_router.get("/emotional-assessments/questionnaires")
def list_emotional_questionnaires(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    qs = db.query(EmotionalQuestionnaire).filter(EmotionalQuestionnaire.is_active.is_(True)).all()
    out = []
    for q in qs:
        ver = (
            db.query(EmotionalQuestionnaireVersion)
            .filter(
                EmotionalQuestionnaireVersion.questionnaire_id == q.id,
                EmotionalQuestionnaireVersion.is_current.is_(True),
            )
            .first()
        )
        questions = []
        if ver:
            q_rows = (
                db.query(EmotionalQuestion)
                .filter(EmotionalQuestion.version_id == ver.id)
                .order_by(EmotionalQuestion.sequence_order.asc())
                .all()
            )
            for qr in q_rows:
                opts = (
                    db.query(EmotionalQuestionOption)
                    .filter(EmotionalQuestionOption.question_id == qr.id)
                    .order_by(EmotionalQuestionOption.sequence_order.asc())
                    .all()
                )
                questions.append(
                    {
                        "question_code": qr.question_code,
                        "dimension_code": qr.dimension_code,
                        "sequence_order": qr.sequence_order,
                        "prompt_text": qr.prompt_text,
                        "question_type": qr.question_type,
                        "is_optional": qr.is_optional,
                        "allow_prefer_not_to_answer": qr.allow_prefer_not_to_answer,
                        "higher_value_indicates_concern": qr.higher_value_indicates_concern,
                        "options": [
                            {
                                "option_value": o.option_value,
                                "option_label": o.option_label,
                                "numeric_weight": o.numeric_weight,
                            }
                            for o in opts
                        ],
                    }
                )
        out.append(
            {
                "code": q.code,
                "title": q.title,
                "description": q.description,
                "reference_period_label": q.reference_period_label,
                "estimated_minutes": q.estimated_minutes,
                "is_clinically_validated": q.is_clinically_validated,
                "privacy_and_usage_notice": q.privacy_and_usage_notice,
                "current_version": q.current_version,
                "questions": questions,
            }
        )
    return {"questionnaires": out}


@expansion_router.post("/emotional-assessments/requests", status_code=status.HTTP_201_CREATED)
def create_emotional_assessment_requests(
    payload: EmotionalRequestCreate,
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    q_obj = (
        db.query(EmotionalQuestionnaire)
        .filter(EmotionalQuestionnaire.code == payload.questionnaire_code)
        .first()
    )
    if not q_obj:
        raise HTTPException(status_code=404, detail="Cuestionario emocional no encontrado.")

    now = utcnow()
    created_requests = []
    initial_status = "SENT" if payload.send_immediately else "SCHEDULED"

    for astro_id in payload.astronaut_ids:
        astro = db.query(User).filter(User.id == astro_id).first()
        if not astro:
            continue
        req = EmotionalAssessmentRequest(
            requested_by_admin_id=admin_user.id,
            astronaut_id=astro.id,
            mission_id=payload.mission_id,
            questionnaire_code=q_obj.code,
            version_number=q_obj.current_version,
            periodicity=payload.periodicity,
            is_recurring=payload.is_recurring,
            priority=payload.priority,
            custom_message=payload.custom_message,
            status=initial_status,
            status_history_json=json.dumps([{"status": initial_status, "at": now.isoformat()}]),
            created_at=now,
            sent_at=now if payload.send_immediately else None,
            due_at=now + timedelta(hours=payload.due_in_hours),
            is_simulated=payload.is_simulated,
        )
        db.add(req)
        db.flush()

        if payload.send_immediately:
            db.add(
                EmotionalAssessmentNotification(
                    user_id=astro.id,
                    request_id=req.id,
                    title=f"Nuevo cuestionario emocional solicitado ({payload.priority})",
                    message=payload.custom_message or f"Se ha solicitado completar '{q_obj.title}'.",
                    is_read=False,
                )
            )
        created_requests.append(req)

    db.commit()
    log_audit_event(
        db,
        action="CREATE_EMOTIONAL_ASSESSMENT_REQUESTS",
        resource_type="EMOTIONAL_ASSESSMENT_REQUEST",
        actor=admin_user,
        details=f"Creadas {len(created_requests)} solicitudes de cuestionario emocional para astronautas {payload.astronaut_ids}.",
    )
    return {
        "created_count": len(created_requests),
        "requests": [_serialize_emotional_request(db, r, admin_user) for r in created_requests],
    }


@expansion_router.get("/emotional-assessments/requests")
def list_all_emotional_requests(
    mission_id: Optional[int] = None,
    astronaut_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    user: User = Depends(require_roles(["ADMINISTRATOR", "MISSION_LEADER"])),
    db: Session = Depends(get_db),
):
    query = db.query(EmotionalAssessmentRequest)
    role_code = user.role.code if user.role else "MISSION_LEADER"
    if role_code == "MISSION_LEADER":
        allowed_ids = get_authorized_astronaut_ids(db, user)
        query = query.filter(EmotionalAssessmentRequest.astronaut_id.in_(allowed_ids if allowed_ids else [-1]))

    if mission_id:
        query = query.filter(EmotionalAssessmentRequest.mission_id == mission_id)
    if astronaut_id:
        query = query.filter(EmotionalAssessmentRequest.astronaut_id == astronaut_id)
    if status_filter:
        query = query.filter(EmotionalAssessmentRequest.status == status_filter)

    rows = query.order_by(EmotionalAssessmentRequest.created_at.desc()).all()
    return {
        "requests": [_serialize_emotional_request(db, r, user, include_private_answers=False) for r in rows]
    }


@expansion_router.get("/emotional-assessments/my-requests")
def list_my_emotional_requests(
    status_filter: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(EmotionalAssessmentRequest).filter(
        EmotionalAssessmentRequest.astronaut_id == user.id
    )
    if status_filter:
        query = query.filter(EmotionalAssessmentRequest.status == status_filter)

    rows = query.order_by(EmotionalAssessmentRequest.created_at.desc()).all()
    for r in rows:
        if r.status == "SENT":
            r.status = "DELIVERED"
            hist = json.loads(r.status_history_json or "[]")
            hist.append({"status": "DELIVERED", "at": utcnow().isoformat()})
            r.status_history_json = json.dumps(hist)
    db.commit()

    return {
        "requests": [_serialize_emotional_request(db, r, user, include_private_answers=True) for r in rows]
    }


@expansion_router.get("/emotional-assessments/my-requests/{request_id}")
def get_my_emotional_request_detail(
    request_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    req = (
        db.query(EmotionalAssessmentRequest)
        .filter(
            EmotionalAssessmentRequest.id == request_id,
            EmotionalAssessmentRequest.astronaut_id == user.id,
        )
        .first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud de cuestionario emocional no encontrada.")
    return {"request": _serialize_emotional_request(db, req, user, include_private_answers=True)}


@expansion_router.get("/emotional-assessments/requests/{request_id}")
def get_emotional_request_detail(
    request_id: int,
    include_private_answers: bool = Query(default=False),
    audit_justification: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    req = db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
    if user.role.code == "ASTRONAUT" and req.astronaut_id != user.id:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    if user.role.code == "MISSION_LEADER":
        verify_astronaut_access(db, user, req.astronaut_id, action_name="GET_EMOTIONAL_REQUEST")

    return {
        "request": _serialize_emotional_request(
            db,
            req,
            user,
            include_private_answers=include_private_answers,
            audit_justification=audit_justification,
        )
    }


@expansion_router.patch("/emotional-assessments/requests/{request_id}")
def patch_emotional_request(
    request_id: int,
    payload: EmotionalRequestPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    req = db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")

    role_code = user.role.code if user.role else "ASTRONAUT"
    if role_code == "ASTRONAUT" and req.astronaut_id != user.id:
        raise HTTPException(status_code=403, detail="No autorizado.")

    if payload.priority:
        req.priority = payload.priority
    if payload.periodicity:
        req.periodicity = payload.periodicity
    if payload.custom_message is not None:
        req.custom_message = payload.custom_message
    if payload.due_in_hours is not None:
        req.due_at = utcnow() + timedelta(hours=payload.due_in_hours)
    if payload.status:
        req.status = payload.status
        hist = json.loads(req.status_history_json or "[]")
        hist.append({"status": payload.status, "at": utcnow().isoformat()})
        req.status_history_json = json.dumps(hist)
    if payload.postpone_reason:
        req.postpone_reason = payload.postpone_reason
        req.status = "POSTPONED"

    db.commit()
    db.refresh(req)
    return {"request": _serialize_emotional_request(db, req, user)}


@expansion_router.post("/emotional-assessments/requests/{request_id}/send")
def send_or_remind_emotional_request(
    request_id: int,
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    req = db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")

    now = utcnow()
    if req.status in ("DRAFT", "SCHEDULED", "POSTPONED", "OVERDUE"):
        req.status = "SENT"
    req.sent_at = now
    hist = json.loads(req.status_history_json or "[]")
    hist.append({"status": "REMINDER_SENT", "at": now.isoformat()})
    req.status_history_json = json.dumps(hist)

    db.add(
        EmotionalAssessmentNotification(
            user_id=req.astronaut_id,
            request_id=req.id,
            title="Recordatorio de Cuestionario Emocional",
            message=req.custom_message or "Tienes un cuestionario emocional disponible en My Emotional Check-In.",
            is_read=False,
        )
    )
    db.commit()
    db.refresh(req)
    return {"request": _serialize_emotional_request(db, req, admin_user)}


@expansion_router.post("/emotional-assessments/requests/{request_id}/cancel")
def cancel_emotional_request(
    request_id: int,
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    req = db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
    req.status = "CANCELLED"
    hist = json.loads(req.status_history_json or "[]")
    hist.append({"status": "CANCELLED", "at": utcnow().isoformat()})
    req.status_history_json = json.dumps(hist)
    db.commit()
    db.refresh(req)
    return {"request": _serialize_emotional_request(db, req, admin_user)}


@expansion_router.post("/emotional-assessments/{request_id}/start")
def start_emotional_assessment(
    request_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    req = db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud de cuestionario emocional no encontrada.")
    # Solo la persona evaluada (ningún otro rol puede responder, completar o posponer en su nombre)
    if req.astronaut_id != user.id:
        raise HTTPException(status_code=403, detail="Solo el astronauta destinatario puede iniciar este cuestionario.")

    ctx = ContextResolver.resolve_active_context(db, req.mission_id, req.astronaut_id)
    ea = (
        db.query(EmotionalAssessment)
        .filter(EmotionalAssessment.request_id == req.id)
        .first()
    )
    if not ea:
        ea = EmotionalAssessment(
            request_id=req.id,
            astronaut_id=req.astronaut_id,
            mission_id=req.mission_id,
            questionnaire_code=req.questionnaire_code,
            version_number=req.version_number,
            phase_code=str(ctx.get("phase_code") or "SURFACE"),
            environment_code=str(ctx.get("environment_code") or "LUNAR_SURFACE"),
            is_draft=True,
            share_summary_with_leader=True,
            allow_admin_detailed_review=False,
            started_at=utcnow(),
            is_simulated=req.is_simulated,
        )
        db.add(ea)
        db.flush()

    if req.status != "COMPLETED":
        req.status = "IN_PROGRESS"
        hist = json.loads(req.status_history_json or "[]")
        hist.append({"status": "IN_PROGRESS", "at": utcnow().isoformat()})
        req.status_history_json = json.dumps(hist)

    db.commit()
    db.refresh(ea)
    return {
        "assessment_id": ea.id,
        "request_id": req.id,
        "status": req.status,
        "is_draft": ea.is_draft,
    }


def _save_emotional_responses_helper(
    db: Session,
    ea: EmotionalAssessment,
    responses_input: List[Any],
) -> Dict[str, EmotionalQuestion]:
    q_obj = (
        db.query(EmotionalQuestionnaire)
        .filter(EmotionalQuestionnaire.code == ea.questionnaire_code)
        .first()
    )
    ver = (
        db.query(EmotionalQuestionnaireVersion)
        .filter(
            EmotionalQuestionnaireVersion.questionnaire_id == q_obj.id,
            EmotionalQuestionnaireVersion.is_current.is_(True),
        )
        .first()
        if q_obj
        else None
    )
    questions_map: Dict[str, EmotionalQuestion] = {}
    if ver:
        for qr in db.query(EmotionalQuestion).filter(EmotionalQuestion.version_id == ver.id).all():
            questions_map[qr.question_code] = qr

    for item in responses_input:
        db.query(EmotionalAssessmentResponse).filter(
            EmotionalAssessmentResponse.assessment_id == ea.id,
            EmotionalAssessmentResponse.question_code == item.question_code,
        ).delete(synchronize_session=False)

        q_def = questions_map.get(item.question_code)
        dim_code = item.dimension_code or (q_def.dimension_code if q_def else "GENERAL_WELLBEING")
        num_score = item.numeric_score
        if num_score is None and item.response_value and item.response_value.isdigit():
            num_score = int(item.response_value)

        db.add(
            EmotionalAssessmentResponse(
                assessment_id=ea.id,
                question_code=item.question_code,
                dimension_code=dim_code,
                response_value=item.response_value,
                numeric_score=num_score,
                open_text_answer=item.open_text_answer,
                prefer_not_to_answer=item.prefer_not_to_answer or (item.response_value == "PREFER_NOT_TO_ANSWER"),
                recorded_at=utcnow(),
            )
        )
    db.flush()
    return questions_map


@expansion_router.post("/emotional-assessments/{assessment_id}/responses")
def save_emotional_assessment_responses(
    assessment_id: int,
    payload: EmotionalResponsesSaveRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ea = db.query(EmotionalAssessment).filter(EmotionalAssessment.id == assessment_id).first()
    if not ea:
        # Also allow passing request_id if assessment_id matches request_id
        ea = db.query(EmotionalAssessment).filter(EmotionalAssessment.request_id == assessment_id).first()
    if not ea:
        raise HTTPException(status_code=404, detail="Evaluación emocional no encontrada.")
    # Solo la persona evaluada (ningún otro rol puede responder, completar o posponer en su nombre)
    if ea.astronaut_id != user.id:
        raise HTTPException(status_code=403, detail="Solo puede responder su propio cuestionario emocional.")

    ea.is_draft = payload.is_draft
    ea.share_summary_with_leader = payload.share_summary_with_leader
    ea.allow_admin_detailed_review = payload.allow_admin_detailed_review
    questions_map = _save_emotional_responses_helper(db, ea, payload.responses)

    req = db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.id == ea.request_id).first()
    res, _ = EmotionalWellnessEngine.evaluate_assessment(
        db=db,
        assessment=ea,
        request_obj=req,
        questions_map=questions_map,
    )
    db.commit()
    return {
        "assessment_id": ea.id,
        "request_id": ea.request_id,
        "is_draft": ea.is_draft,
        "saved_count": len(payload.responses),
        "operational_state": res.operational_state,
        "personal_feedback_summary": res.personal_feedback_summary,
    }


@expansion_router.post("/emotional-assessments/{assessment_id}/complete")
def complete_emotional_assessment(
    assessment_id: int,
    payload: EmotionalCompleteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ea = db.query(EmotionalAssessment).filter(EmotionalAssessment.id == assessment_id).first()
    if not ea:
        ea = db.query(EmotionalAssessment).filter(EmotionalAssessment.request_id == assessment_id).first()
    if not ea:
        raise HTTPException(status_code=404, detail="Evaluación emocional no encontrada.")
    # Solo la persona evaluada (ningún otro rol puede responder, completar o posponer en su nombre)
    if ea.astronaut_id != user.id:
        raise HTTPException(status_code=403, detail="Solo puede finalizar su propio cuestionario emocional.")

    ea.is_draft = False
    ea.share_summary_with_leader = payload.share_summary_with_leader
    ea.allow_admin_detailed_review = payload.allow_admin_detailed_review
    ea.completed_at = utcnow()

    if payload.responses:
        questions_map = _save_emotional_responses_helper(db, ea, payload.responses)
    else:
        questions_map = _save_emotional_responses_helper(db, ea, [])

    req = db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.id == ea.request_id).first()
    if req:
        req.status = "COMPLETED"
        req.completed_at = utcnow()
        hist = json.loads(req.status_history_json or "[]")
        hist.append({"status": "COMPLETED", "at": utcnow().isoformat()})
        req.status_history_json = json.dumps(hist)

    result_obj, alert_obj = EmotionalWellnessEngine.evaluate_assessment(
        db=db,
        assessment=ea,
        request_obj=req,
        questions_map=questions_map,
        explicit_support_requested=payload.explicit_support_request,
        support_urgency=payload.support_urgency,
    )
    db.commit()
    db.refresh(ea)

    gam_update = None
    try:
        gam_update = record_gamification_mission(
            db=db,
            user_id=ea.astronaut_id,
            daily_mission_code="COMPLETE_EMOTIONAL_CHECKIN",
            status_mode="COMPLETED",
            reflection_note="Cuestionario emocional completado (recompensa por participación).",
            is_simulated=ea.is_simulated,
        )
    except Exception:
        pass

    wellness_recs = AssistiveGuidanceService.filter_safe_wellness_recommendations(
        db,
        ea.astronaut_id,
        "URGENT_SUPPORT" if result_obj.urgent_protocol_triggered else "WELLNESS_MONITORING",
    )

    return {
        "assessment_id": ea.id,
        "request_id": ea.request_id,
        "status": "COMPLETED",
        "result": {
            "operational_state": result_obj.operational_state,
            "explicit_support_requested": result_obj.explicit_support_requested,
            "urgent_protocol_triggered": result_obj.urgent_protocol_triggered,
            "authorized_operational_summary": result_obj.authorized_operational_summary,
            "personal_feedback_summary": result_obj.personal_feedback_summary,
            "recommended_next_step": result_obj.recommended_next_step,
            "urgent_protocol_instructions": (
                EmotionalWellnessEngine.URGENT_PROTOCOL_INSTRUCTIONS
                if result_obj.urgent_protocol_triggered
                else None
            ),
        },
        "wellness_recommendations": wellness_recs,
        "gamification_update": gam_update,
        "alert_generated": (
            {"id": alert_obj.id, "title": alert_obj.title, "priority": alert_obj.priority}
            if alert_obj
            else None
        ),
    }


@expansion_router.get("/emotional-assessments/follow-ups")
def list_emotional_followups(
    request_id: Optional[int] = None,
    astronaut_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(EmotionalFollowUp)
    if user.role.code == "ASTRONAUT":
        query = query.filter(EmotionalFollowUp.astronaut_id == user.id)
    elif astronaut_id:
        verify_astronaut_access(db, user, astronaut_id, action_name="LIST_EMOTIONAL_FOLLOWUPS")
        query = query.filter(EmotionalFollowUp.astronaut_id == astronaut_id)

    if request_id:
        query = query.filter(EmotionalFollowUp.request_id == request_id)

    rows = query.order_by(EmotionalFollowUp.created_at.desc()).all()
    return {
        "follow_ups": [
            {
                "id": f.id,
                "request_id": f.request_id,
                "astronaut_id": f.astronaut_id,
                "author_user_id": f.author_user_id,
                "author_role": f.author_role,
                "action_type": f.action_type,
                "notes": f.notes,
                "created_at": ensure_aware(f.created_at).isoformat(),
            }
            for f in rows
        ]
    }


@expansion_router.post("/emotional-assessments/follow-ups", status_code=status.HTTP_201_CREATED)
def create_emotional_followup(
    payload: EmotionalFollowUpCreate,
    user: User = Depends(require_roles(["MISSION_LEADER", "ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    req = db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.id == payload.request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")

    if user.role.code == "MISSION_LEADER":
        verify_astronaut_access(db, user, req.astronaut_id, action_name="CREATE_EMOTIONAL_FOLLOWUP")

    fup = EmotionalFollowUp(
        request_id=req.id,
        astronaut_id=req.astronaut_id,
        author_user_id=user.id,
        author_role=user.role.code,
        action_type=payload.action_type,
        notes=payload.notes.strip(),
        created_at=utcnow(),
    )
    db.add(fup)
    db.commit()
    db.refresh(fup)

    log_audit_event(
        db,
        action="CREATE_EMOTIONAL_FOLLOWUP",
        resource_type="EMOTIONAL_FOLLOWUP",
        actor=user,
        resource_id=str(fup.id),
        target_user_id=req.astronaut_id,
        details=f"Seguimiento operativo ({payload.action_type}) registrado en solicitud emocional #{req.id}.",
    )
    return {
        "follow_up": {
            "id": fup.id,
            "request_id": fup.request_id,
            "astronaut_id": fup.astronaut_id,
            "author_role": fup.author_role,
            "action_type": fup.action_type,
            "notes": fup.notes,
            "created_at": ensure_aware(fup.created_at).isoformat(),
        }
    }


# ============================================================================
# CROSS-MODULE SUMMARY & ANALYTICS BUILDERS FOR MISSION CONTROL
# ============================================================================

def build_expansion_cards_for_summary(db: Session, target_user: User, mission: Mission) -> Dict[str, Any]:
    # 1. Communication Center Summary Card
    convs = (
        db.query(Conversation)
        .filter(
            Conversation.mission_id == mission.id,
            Conversation.astronaut_id == target_user.id,
        )
        .all()
    )
    conv_ids = [c.id for c in convs]
    unread_msgs = (
        db.query(Message)
        .filter(
            Message.conversation_id.in_(conv_ids if conv_ids else [-1]),
            Message.recipient_id == target_user.id,
            (Message.delivery_status != "READ") | (Message.marked_unread_by_recipient.is_(True)),
        )
        .count()
    )
    last_msg = (
        db.query(Message)
        .filter(Message.conversation_id.in_(conv_ids if conv_ids else [-1]))
        .order_by(Message.created_at.desc())
        .first()
    )
    active_support_reqs = (
        db.query(SupportRequest)
        .filter(
            SupportRequest.astronaut_id == target_user.id,
            SupportRequest.status.notin_(["CLOSED", "RESPONDED"]),
        )
        .count()
    )
    leader_u = _get_assigned_leader_for_mission(db, mission.id)

    # 2. Cognitive Performance Summary Card
    completed_cog_rows = (
        db.query(CognitiveAssessment)
        .filter(
            CognitiveAssessment.astronaut_id == target_user.id,
            CognitiveAssessment.completion_status == "COMPLETED",
        )
        .order_by(CognitiveAssessment.completed_at.desc())
        .all()
    )
    recent_cog = completed_cog_rows[0] if completed_cog_rows else None
    completed_domains_set = {r.domain_code for r in completed_cog_rows}
    total_domains_count = db.query(CognitiveDomain).count() or 9
    pending_cog_schedules = (
        db.query(CognitiveSchedule)
        .filter(
            CognitiveSchedule.astronaut_id == target_user.id,
            CognitiveSchedule.status == "PENDING",
        )
        .count()
    )

    # 3. Emotional Check-In Summary Card
    pending_emo_reqs = (
        db.query(EmotionalAssessmentRequest)
        .filter(
            EmotionalAssessmentRequest.astronaut_id == target_user.id,
            EmotionalAssessmentRequest.status.in_(["SENT", "DELIVERED", "IN_PROGRESS", "OVERDUE"]),
        )
        .order_by(EmotionalAssessmentRequest.created_at.desc())
        .all()
    )
    latest_completed_emo = (
        db.query(EmotionalAssessmentRequest)
        .filter(
            EmotionalAssessmentRequest.astronaut_id == target_user.id,
            EmotionalAssessmentRequest.status == "COMPLETED",
        )
        .order_by(EmotionalAssessmentRequest.completed_at.desc())
        .first()
    )
    latest_emo_state = "EMOTIONAL_WELLNESS_STABLE"
    if latest_completed_emo and latest_completed_emo.assessment and latest_completed_emo.assessment.result:
        latest_emo_state = latest_completed_emo.assessment.result.operational_state

    comm_card = {
        "unread_messages_count": unread_msgs,
        "active_support_requests_count": active_support_reqs,
        "open_support_requests_count": active_support_reqs,
        "assigned_leader_name": leader_u.full_name if leader_u else "Dir. Carlos Ibáñez",
        "last_message_at": (
            ensure_aware(last_msg.created_at).isoformat()
            if (last_msg and last_msg.created_at)
            else None
        ),
        # No exponer el contenido de mensajes privados en el resumen: el
        # administrador y otros líderes también leen /health/summary.
        "last_message_preview": None,
        "connection_status": "ONLINE",
        "status_label": (
            f"{unread_msgs} mensaje(s) sin leer"
            if unread_msgs > 0
            else "Canal directo sincronizado"
        ),
    }

    cog_card = {
        "completed_domains_count": len(completed_domains_set),
        "total_domains_count": total_domains_count,
        "pending_scheduled_tests": pending_cog_schedules,
        "pending_scheduled_count": pending_cog_schedules,
        "last_domain_evaluated": recent_cog.domain_code if recent_cog else "NONE",
        "latest_domain": recent_cog.domain_code if recent_cog else "Ninguno",
        "last_completed_at": (
            ensure_aware(recent_cog.completed_at).isoformat()
            if (recent_cog and recent_cog.completed_at)
            else None
        ),
        "last_accuracy_percent": (
            recent_cog.result.accuracy_percent
            if (recent_cog and recent_cog.result)
            else None
        ),
        "latest_accuracy": (
            recent_cog.result.accuracy_percent
            if (recent_cog and recent_cog.result)
            else None
        ),
        "requires_review": (
            recent_cog.result.requires_review
            if (recent_cog and recent_cog.result)
            else False
        ),
        "non_diagnostic_note": "Evaluación específica por dominio (sin puntaje global único).",
        "non_iq_notice": "Evaluación específica por dominio (sin puntaje global único ni diagnóstico médico).",
    }

    emo_card = {
        "pending_requests_count": len(pending_emo_reqs),
        "next_due_request_id": pending_emo_reqs[0].id if pending_emo_reqs else None,
        "next_due_at": (
            ensure_aware(pending_emo_reqs[0].due_at).isoformat()
            if (pending_emo_reqs and pending_emo_reqs[0].due_at)
            else None
        ),
        "latest_operational_state": latest_emo_state,
        "last_completed_at": (
            ensure_aware(latest_completed_emo.completed_at).isoformat()
            if (latest_completed_emo and latest_completed_emo.completed_at)
            else None
        ),
        "privacy_notice": "Respuestas individuales protegidas con privacidad reforzada.",
    }

    return {
        "communication_center": comm_card,
        "communication_center_card": comm_card,
        "cognitive_performance": cog_card,
        "cognitive_performance_card": cog_card,
        "emotional_check_in": emo_card,
        "emotional_checkin_card": emo_card,
    }


@expansion_router.get("/analytics/expansion-overview")
def get_expansion_analytics_overview(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    verify_astronaut_access(db, user, target_id, action_name="GET_EXPANSION_ANALYTICS")

    # 1. Communication frequency by category & support requests
    convs = db.query(Conversation).filter(Conversation.astronaut_id == target_id).all()
    conv_ids = [c.id for c in convs]
    msgs = (
        db.query(Message)
        .filter(Message.conversation_id.in_(conv_ids if conv_ids else [-1]))
        .all()
    )
    msg_by_cat: Dict[str, int] = {}
    for m in msgs:
        msg_by_cat[m.category] = msg_by_cat.get(m.category, 0) + 1

    support_reqs = db.query(SupportRequest).filter(SupportRequest.astronaut_id == target_id).all()

    # 2. Cognitive assessments by domain and phase
    cog_rows = (
        db.query(CognitiveAssessment)
        .filter(
            CognitiveAssessment.astronaut_id == target_id,
            CognitiveAssessment.completion_status == "COMPLETED",
        )
        .order_by(CognitiveAssessment.completed_at.asc())
        .all()
    )
    cog_points = []
    cog_by_domain: Dict[str, List[Dict[str, Any]]] = {}
    for ca in cog_rows:
        pt = {
            "id": ca.id,
            "domain_code": ca.domain_code,
            "difficulty": ca.difficulty,
            "phase_code": ca.phase_code,
            "environment_code": ca.environment_code,
            "accuracy_percent": ca.result.accuracy_percent if ca.result else None,
            "mean_response_time_ms": ca.result.mean_response_time_ms if ca.result else None,
            "completed_at": ensure_aware(ca.completed_at).isoformat() if ca.completed_at else None,
        }
        cog_points.append(pt)
        cog_by_domain.setdefault(ca.domain_code, []).append(pt)

    # 3. Emotional check-ins compliance & operational states
    emo_reqs = (
        db.query(EmotionalAssessmentRequest)
        .filter(EmotionalAssessmentRequest.astronaut_id == target_id)
        .order_by(EmotionalAssessmentRequest.created_at.asc())
        .all()
    )
    emo_summary = [
        {
            "request_id": r.id,
            "periodicity": r.periodicity,
            "priority": r.priority,
            "status": r.status,
            "operational_state": (
                r.assessment.result.operational_state
                if (r.assessment and r.assessment.result)
                else "PENDING"
            ),
            "created_at": ensure_aware(r.created_at).isoformat(),
            "completed_at": ensure_aware(r.completed_at).isoformat() if r.completed_at else None,
        }
        for r in emo_reqs
    ]

    comm_disc = (
        "La frecuencia de mensajes es un indicador puramente operativo de coordinación; "
        "no constituye una métrica psicológica ni un indicador de productividad."
    )
    cog_disc = (
        "Series separadas por dominio cognitivo. La variación temporal puede reflejar efecto de práctica, "
        "fatiga puntual o cambio de entorno; asociación temporal no implica causalidad directa."
    )
    emo_disc = "Se muestran únicamente estados operativos de cumplimiento y seguimiento sin exponer respuestas privadas."

    emo_analytics_obj = {
        "total_requests": len(emo_reqs),
        "completed_requests": sum(1 for r in emo_reqs if r.status == "COMPLETED"),
        "pending_requests": sum(1 for r in emo_reqs if r.status in ("SENT", "DELIVERED", "IN_PROGRESS")),
        "history": emo_summary,
        "privacy_disclaimer": emo_disc,
        "privacy_notice": emo_disc,
    }

    return {
        "astronaut_id": target_id,
        "communication_analytics": {
            "total_messages": len(msgs),
            "messages_by_category": msg_by_cat,
            "support_requests_total": len(support_reqs),
            "support_requests_open": sum(1 for s in support_reqs if s.status != "CLOSED"),
            "methodology_disclaimer": comm_disc,
            "non_psychological_disclaimer": comm_disc,
        },
        "cognitive_analytics": {
            "completed_assessments_count": len(cog_points),
            "points": cog_points,
            "by_domain": cog_by_domain,
            "methodology_disclaimer": cog_disc,
            "methodology_notice": cog_disc,
        },
        "emotional_analytics": emo_analytics_obj,
        "emotional_checkin_analytics": emo_analytics_obj,
    }

