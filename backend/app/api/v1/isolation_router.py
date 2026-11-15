"""
Módulo de aislamiento y confinamiento (NASA HRP — Isolation and Confinement / Behavioral Health).

Contrato: docs/CONTRATO_AISLAMIENTO.md
- Check-in rápido de sueño y ánimo (privado por defecto).
- Tiempo libre: catálogo de hobbies breves y registro.
- Actividades de integración de la tripulación con quórum y XP.
- Canal familiar "Conexión con Tierra": contactos autorizados y adjuntos (foto / nota de voz).
"""
import json
import os
import re
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from backend.app.api.v1.expansion_router import _verify_conversation_access
from backend.app.core.config import settings
from backend.app.database.session import get_db
from backend.app.models.models import (
    Conversation,
    ConversationParticipant,
    CrewActivity,
    CrewActivityParticipant,
    CrewActivityTemplate,
    FamilyContact,
    LeisureActivity,
    LeisureLog,
    Message,
    MessageAttachment,
    Mission,
    MissionAssignment,
    QuickCheckin,
    Role,
    User,
)
from backend.app.schemas.schemas import (
    CrewActivityCreate,
    CrewActivityRespond,
    LeisureLogCreate,
    QuickCheckinCreate,
)
from backend.app.security.auth import (
    ensure_aware,
    get_current_user,
    log_audit_event,
    require_roles,
    utcnow,
    verify_astronaut_access,
)
from backend.app.services.gamification import award_activity_xp, record_gamification_mission

isolation_router = APIRouter()

LEISURE_CATEGORIES = {"PLANTS", "READING", "GAMES", "MUSIC", "ART", "PHOTOGRAPHY", "WRITING", "MOVEMENT"}
CREW_STATUSES = {"SCHEDULED", "COMPLETED", "CANCELLED"}


def _role(user: User) -> str:
    return user.role.code if user.role else ""


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return ensure_aware(dt).isoformat() if dt else None


# ============================================================================
# 1. CHECK-IN RÁPIDO (SUEÑO + ÁNIMO)
# ============================================================================

def _compute_operational_flag(recent: List[QuickCheckin], now: datetime) -> str:
    """
    recent: registros más recientes primero.
    NEEDS_CHECK_IN si en los 3 últimos registros (3 de 3) hay ánimo <= 2 o sensación de aislamiento,
    o si el sueño medio de los últimos 3 días es < 6 h. Si no, OK.
    """
    if not recent:
        return "OK"
    last3 = recent[:3]
    if len(last3) == 3 and all((r.mood <= 2) or r.feels_isolated for r in last3):
        return "NEEDS_CHECK_IN"
    cutoff = now - timedelta(days=3)
    sleep_3d = [r.sleep_hours for r in recent if ensure_aware(r.created_at) >= cutoff]
    if sleep_3d and (sum(sleep_3d) / len(sleep_3d)) < 6.0:
        return "NEEDS_CHECK_IN"
    return "OK"


def _circadian_tip(avg_sleep: Optional[float]) -> str:
    if avg_sleep is None:
        return "Registra tu sueño unos días para recibir una recomendación circadiana."
    if avg_sleep < 6.0:
        return (
            "Tu sueño medio está por debajo de 6 h: protege el bloque de descanso, reduce la luz azul "
            "1 h antes y evita cafeína en la segunda mitad del turno."
        )
    if avg_sleep < 7.0:
        return "Vas cerca del objetivo: intenta acostarte a la misma hora y usar la iluminación de tono cálido antes de dormir."
    return "Buen descanso: mantén horarios regulares de luz y sueño para sostener tu ritmo circadiano."


def _serialize_checkin(c: QuickCheckin, full: bool) -> Dict[str, Any]:
    return {
        "id": c.id,
        "created_at": _iso(c.created_at),
        "sleep_hours": c.sleep_hours,
        "sleep_quality": c.sleep_quality,
        "mood": c.mood if full else None,
        "energy": c.energy if full else None,
        "feels_isolated": c.feels_isolated if full else None,
        "note": c.note if full else None,
        "operational_flag": c.operational_flag,
    }


@isolation_router.post("/wellness/quick-checkin", status_code=status.HTTP_201_CREATED)
def create_quick_checkin(
    payload: QuickCheckinCreate,
    user: User = Depends(require_roles(["ASTRONAUT"])),
    db: Session = Depends(get_db),
):
    dedup_key = (payload.dedup_key or "").strip() or None
    if dedup_key:
        existing = db.query(QuickCheckin).filter(QuickCheckin.dedup_key == dedup_key).first()
        if existing:
            if existing.astronaut_id != user.id:
                raise HTTPException(status_code=409, detail="Clave de deduplicación ya utilizada.")
            # Reenvío desde la cola sin enlace: devuelve el registro ya guardado, sin duplicar ni dar XP
            out = _serialize_checkin(existing, full=True)
            out["xp_awarded"] = 0
            out["duplicate_prevented"] = True
            return out
    now = utcnow()
    record = QuickCheckin(
        astronaut_id=user.id,
        dedup_key=dedup_key,
        sleep_hours=payload.sleep_hours,
        sleep_quality=payload.sleep_quality,
        mood=payload.mood,
        energy=payload.energy,
        feels_isolated=payload.feels_isolated,
        note=(payload.note or "").strip() or None,
        operational_flag="OK",
        created_at=now,
    )
    db.add(record)
    db.flush()
    recent = (
        db.query(QuickCheckin)
        .filter(QuickCheckin.astronaut_id == user.id)
        .order_by(QuickCheckin.created_at.desc(), QuickCheckin.id.desc())
        .limit(30)
        .all()
    )
    record.operational_flag = _compute_operational_flag(recent, now)
    db.commit()
    db.refresh(record)

    xp_awarded = 0
    try:
        gam = record_gamification_mission(
            db,
            user_id=user.id,
            daily_mission_code="MIND_CHECK",
            status_mode="COMPLETED",
            reflection_note=None,  # la nota es privada: no se copia a gamificación
            is_simulated=False,
        )
        xp_awarded = int(gam.get("xp_awarded", 0))
    except ValueError:
        xp_awarded = 0  # MIND_CHECK no existe o está inactiva: sin XP

    out = _serialize_checkin(record, full=True)
    out["xp_awarded"] = xp_awarded
    return out


@isolation_router.get("/wellness/quick-checkin")
def list_quick_checkins(
    astronaut_id: Optional[int] = None,
    limit: int = Query(default=14, ge=1, le=60),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    target = verify_astronaut_access(db, user, target_id, action_name="READ_QUICK_CHECKIN")
    is_self = user.id == target.id
    role_code = _role(user)
    now = utcnow()

    items = (
        db.query(QuickCheckin)
        .filter(QuickCheckin.astronaut_id == target.id)
        .order_by(QuickCheckin.created_at.desc(), QuickCheckin.id.desc())
        .limit(limit)
        .all()
    )
    week_ago = now - timedelta(days=7)
    last_7d = (
        db.query(QuickCheckin)
        .filter(QuickCheckin.astronaut_id == target.id, QuickCheckin.created_at >= week_ago)
        .order_by(QuickCheckin.created_at.desc(), QuickCheckin.id.desc())
        .all()
    )
    avg_sleep = round(sum(r.sleep_hours for r in last_7d) / len(last_7d), 1) if last_7d else None
    recent = (
        db.query(QuickCheckin)
        .filter(QuickCheckin.astronaut_id == target.id)
        .order_by(QuickCheckin.created_at.desc(), QuickCheckin.id.desc())
        .limit(30)
        .all()
    )
    flag: Optional[str] = _compute_operational_flag(recent, now)

    serialized = [_serialize_checkin(c, full=is_self) for c in items]
    # Si el astronauta desactivó compartir señales con su líder, el líder tampoco ve la señal operativa
    if role_code == "MISSION_LEADER" and not target.share_wellness_signals_with_leader:
        flag = None
        for it in serialized:
            it["operational_flag"] = None

    return {
        "items": serialized,
        "summary": {
            "avg_sleep_hours_7d": avg_sleep,
            "nights_under_6h_7d": sum(1 for r in last_7d if r.sleep_hours < 6.0),
            "checkins_7d": len(last_7d),
            "operational_flag": flag,
            "circadian_tip": _circadian_tip(avg_sleep),
        },
    }


# ============================================================================
# 2. TIEMPO LIBRE (HOBBIES BREVES)
# ============================================================================

def _serialize_leisure(a: LeisureActivity) -> Dict[str, Any]:
    try:
        how_to = json.loads(a.how_to_json or "[]")
    except ValueError:
        how_to = []
    return {
        "code": a.code,
        "title": a.title,
        "category": a.category,
        "duration_minutes": a.duration_minutes,
        "description": a.description,
        "how_to": how_to,
        "solo_or_group": a.solo_or_group,
        "source_title": a.source_title,
        "source_url": a.source_url,
    }


@isolation_router.get("/wellness/leisure")
def list_leisure_catalog(
    max_minutes: Optional[int] = Query(default=None, ge=1, le=240),
    category: Optional[str] = Query(default=None, max_length=30),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(LeisureActivity).filter(LeisureActivity.is_active.is_(True))
    if category:
        cat = category.strip().upper()
        if cat not in LEISURE_CATEGORIES:
            raise HTTPException(status_code=422, detail="Categoría de tiempo libre no válida.")
        query = query.filter(LeisureActivity.category == cat)
    if max_minutes is not None:
        query = query.filter(LeisureActivity.duration_minutes <= max_minutes)
    rows = query.order_by(LeisureActivity.duration_minutes.asc(), LeisureActivity.id.asc()).all()
    return {"items": [_serialize_leisure(a) for a in rows]}


@isolation_router.get("/wellness/leisure/log")
def list_leisure_log(
    astronaut_id: Optional[int] = None,
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    target = verify_astronaut_access(db, user, target_id, action_name="READ_LEISURE_LOG")
    is_self = user.id == target.id
    rows = (
        db.query(LeisureLog)
        .filter(LeisureLog.astronaut_id == target.id)
        .order_by(LeisureLog.created_at.desc(), LeisureLog.id.desc())
        .limit(limit)
        .all()
    )
    titles = {a.code: a for a in db.query(LeisureActivity).all()}
    week_ago = utcnow() - timedelta(days=7)
    minutes_7d = sum(
        r.minutes
        for r in db.query(LeisureLog)
        .filter(LeisureLog.astronaut_id == target.id, LeisureLog.created_at >= week_ago)
        .all()
    )
    return {
        "items": [
            {
                "id": r.id,
                "code": r.activity_code,
                "title": titles[r.activity_code].title if r.activity_code in titles else r.activity_code,
                "category": titles[r.activity_code].category if r.activity_code in titles else None,
                "minutes": r.minutes,
                "enjoyment": r.enjoyment,
                "note": r.note if is_self else None,
                "created_at": _iso(r.created_at),
                "xp_awarded": r.xp_awarded,
            }
            for r in rows
        ],
        "minutes_7d": minutes_7d,
    }


@isolation_router.post("/wellness/leisure/{code}/log", status_code=status.HTTP_201_CREATED)
def log_leisure_activity(
    code: str,
    payload: LeisureLogCreate,
    user: User = Depends(require_roles(["ASTRONAUT"])),
    db: Session = Depends(get_db),
):
    activity = (
        db.query(LeisureActivity)
        .filter(LeisureActivity.code == code.strip().upper()[:60], LeisureActivity.is_active.is_(True))
        .first()
    )
    if not activity:
        raise HTTPException(status_code=404, detail="Actividad de tiempo libre no encontrada.")
    now = utcnow()
    xp = award_activity_xp(db, user.id, "LEISURE_BREAK", reflection_note=None, once_per_day=True)
    row = LeisureLog(
        astronaut_id=user.id,
        activity_code=activity.code,
        minutes=payload.minutes,
        enjoyment=payload.enjoyment,
        note=(payload.note or "").strip() or None,
        xp_awarded=xp,
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "code": row.activity_code,
        "minutes": row.minutes,
        "enjoyment": row.enjoyment,
        "created_at": _iso(row.created_at),
        "xp_awarded": row.xp_awarded,
    }


# ============================================================================
# 3. ACTIVIDADES DE INTEGRACIÓN DE LA TRIPULACIÓN
# ============================================================================

def _active_assignment(db: Session, user_id: int, mission_id: Optional[int] = None) -> Optional[MissionAssignment]:
    q = db.query(MissionAssignment).filter(
        MissionAssignment.user_id == user_id,
        MissionAssignment.is_active.is_(True),
    )
    if mission_id is not None:
        q = q.filter(MissionAssignment.mission_id == mission_id)
    return q.order_by(MissionAssignment.id.asc()).first()


def _crew_ids(db: Session, mission_id: int) -> List[int]:
    rows = (
        db.query(MissionAssignment.user_id)
        .join(User, User.id == MissionAssignment.user_id)
        .join(Role, Role.id == User.role_id)
        .filter(
            MissionAssignment.mission_id == mission_id,
            MissionAssignment.is_active.is_(True),
            Role.code == "ASTRONAUT",
            User.status == "ACTIVE",
        )
        .order_by(MissionAssignment.user_id.asc())
        .all()
    )
    return [r[0] for r in rows]


def _resolve_crew_mission(db: Session, user: User, mission_id: Optional[int]) -> Mission:
    """Misión para actividades de tripulación con control de pertenencia (astronauta o líder asignado, o administración)."""
    role_code = _role(user)
    if mission_id is None:
        assign = _active_assignment(db, user.id)
        if not assign:
            raise HTTPException(status_code=400, detail="Indique mission_id: no tiene una misión activa asignada.")
        mission_id = assign.mission_id
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Misión no encontrada.")
    if role_code in ("ASTRONAUT", "MISSION_LEADER"):
        if not _active_assignment(db, user.id, mission.id):
            log_audit_event(
                db,
                action="CREW_ACTIVITY_ACCESS_DENIED",
                resource_type="CREW_ACTIVITY",
                actor=user,
                resource_id=str(mission.id),
                status_code="DENIED",
                details="Intento de acceso a actividades de una misión no asignada.",
            )
            raise HTTPException(status_code=403, detail="Acceso denegado: no está asignado a esta misión.")
    elif role_code != "ADMINISTRATOR":
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    return mission


def _quorum(n: int) -> int:
    return (n // 2) + 1 if n > 0 else 1


def _serialize_activity(db: Session, act: CrewActivity, viewer_id: int) -> Dict[str, Any]:
    user_ids = {p.user_id for p in act.participants} | {act.created_by_id}
    names = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    my = next((p for p in act.participants if p.user_id == viewer_id), None)
    return {
        "id": act.id,
        "mission_id": act.mission_id,
        "template_code": act.template_code,
        "title": act.title,
        "description": act.description,
        "scheduled_for": _iso(act.scheduled_for),
        "duration_minutes": act.duration_minutes,
        "status": act.status,
        "created_by": {"id": act.created_by_id, "name": names.get(act.created_by_id, "")},
        "quorum": _quorum(len(act.participants)),
        "attended_count": sum(1 for p in act.participants if p.attended),
        "my_response": my.response if my else None,
        "participants": [
            {
                "user_id": p.user_id,
                "name": names.get(p.user_id, ""),
                "response": p.response,
                "attended": p.attended,
            }
            for p in act.participants
        ],
        "completed_at": _iso(act.completed_at),
        "created_at": _iso(act.created_at),
    }


def _load_activity(db: Session, activity_id: int, user: User) -> CrewActivity:
    act = db.query(CrewActivity).filter(CrewActivity.id == activity_id).first()
    if not act:
        raise HTTPException(status_code=404, detail="Actividad no encontrada.")
    _resolve_crew_mission(db, user, act.mission_id)  # pertenencia a la misión
    return act


def _my_participation(act: CrewActivity, user: User) -> CrewActivityParticipant:
    part = next((p for p in act.participants if p.user_id == user.id), None)
    if not part:
        raise HTTPException(status_code=403, detail="Solo los participantes de la actividad pueden hacer esta acción.")
    return part


# Ventana para registrar asistencia: desde 15 min antes del inicio hasta 24 h después del final
ATTEND_OPENS_BEFORE = timedelta(minutes=15)
ATTEND_CLOSES_AFTER_END = timedelta(hours=24)
# XP de integración solo si asistieron al menos 2 personas (una actividad "de grupo" de una sola persona no puntúa)
MIN_ATTENDEES_FOR_XP = 2


def _attend_window(act: CrewActivity):
    start = ensure_aware(act.scheduled_for)
    return (
        start - ATTEND_OPENS_BEFORE,
        start + timedelta(minutes=act.duration_minutes or 0) + ATTEND_CLOSES_AFTER_END,
    )


def _finalize_activity(db: Session, activity_id: int) -> None:
    """
    Cierra la actividad y reparte XP de forma idempotente y segura ante peticiones concurrentes.
    - Recuenta asistentes en BD (no en la colección cargada en memoria, que puede estar desfasada).
    - SCHEDULED → COMPLETED con UPDATE condicionado (solo un proceso hace la transición).
    - XP por participante reclamando la fila con UPDATE ... WHERE xp_awarded = false (solo un proceso
      lo otorga). CREW_INTEGRATION da XP como máximo una vez al día por persona.
    También autocura actividades que ya cumplían quórum pero quedaron en SCHEDULED.
    """
    base = db.query(CrewActivityParticipant).filter(CrewActivityParticipant.activity_id == activity_id)
    total = base.count()
    attended = base.filter(CrewActivityParticipant.attended.is_(True)).count()
    if total and attended >= _quorum(total):
        now = utcnow()
        db.query(CrewActivity).filter(
            CrewActivity.id == activity_id, CrewActivity.status == "SCHEDULED"
        ).update({"status": "COMPLETED", "completed_at": now}, synchronize_session=False)
        db.commit()
    status_now = db.query(CrewActivity.status).filter(CrewActivity.id == activity_id).scalar()
    if status_now != "COMPLETED" or attended < MIN_ATTENDEES_FOR_XP:
        return
    pending = (
        db.query(CrewActivityParticipant.id, CrewActivityParticipant.user_id)
        .filter(
            CrewActivityParticipant.activity_id == activity_id,
            CrewActivityParticipant.attended.is_(True),
            CrewActivityParticipant.xp_awarded.is_(False),
        )
        .all()
    )
    for part_id, user_id in pending:
        claimed = (
            db.query(CrewActivityParticipant)
            .filter(CrewActivityParticipant.id == part_id, CrewActivityParticipant.xp_awarded.is_(False))
            .update({"xp_awarded": True}, synchronize_session=False)
        )
        if claimed == 1:
            award_activity_xp(
                db,
                user_id,
                "CREW_INTEGRATION",
                reflection_note=f"Actividad de integración #{activity_id}",
                once_per_day=True,
            )
        # El reclamo y el XP se confirman juntos: si algo falla, ninguno de los dos queda aplicado
        db.commit()


def _heal_stale_activities(db: Session, rows: List[CrewActivity]) -> bool:
    """Completa (y reparte XP) las actividades SCHEDULED que ya tienen quórum. Devuelve si cambió algo."""
    healed = False
    for act in rows:
        if act.status != "SCHEDULED":
            continue
        attended = sum(1 for p in act.participants if p.attended)
        if act.participants and attended >= _quorum(len(act.participants)):
            _finalize_activity(db, act.id)
            healed = True
    return healed


@isolation_router.get("/crew-activities/catalog")
def list_crew_activity_catalog(
    user: User = Depends(require_roles(["ASTRONAUT", "MISSION_LEADER", "ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(CrewActivityTemplate)
        .filter(CrewActivityTemplate.is_active.is_(True))
        .order_by(CrewActivityTemplate.id.asc())
        .all()
    )
    return {
        "items": [
            {
                "code": t.code,
                "title": t.title,
                "description": t.description,
                "duration_minutes": t.duration_minutes,
                "category": t.category,
            }
            for t in rows
        ]
    }


@isolation_router.get("/crew-activities")
def list_crew_activities(
    mission_id: Optional[int] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: User = Depends(require_roles(["ASTRONAUT", "MISSION_LEADER", "ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    mission = _resolve_crew_mission(db, user, mission_id)
    query = db.query(CrewActivity).filter(CrewActivity.mission_id == mission.id)
    if status_filter:
        st = status_filter.strip().upper()
        if st not in CREW_STATUSES:
            raise HTTPException(status_code=422, detail="Estado de actividad no válido.")
        query = query.filter(CrewActivity.status == st)
    rows = query.order_by(CrewActivity.scheduled_for.desc(), CrewActivity.id.desc()).limit(100).all()
    if _heal_stale_activities(db, rows):
        db.expire_all()
        rows = query.order_by(CrewActivity.scheduled_for.desc(), CrewActivity.id.desc()).limit(100).all()

    now = utcnow()
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    completed_week = (
        db.query(CrewActivity)
        .filter(
            CrewActivity.mission_id == mission.id,
            CrewActivity.status == "COMPLETED",
            CrewActivity.completed_at >= week_start,
        )
        .count()
    )
    return {
        "items": [_serialize_activity(db, a, user.id) for a in rows],
        "weekly_goal": {"target": 1, "completed_this_week": completed_week},
    }


@isolation_router.post("/crew-activities", status_code=status.HTTP_201_CREATED)
def create_crew_activity(
    payload: CrewActivityCreate,
    user: User = Depends(require_roles(["ASTRONAUT", "MISSION_LEADER", "ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    mission = _resolve_crew_mission(db, user, payload.mission_id)
    template = None
    if payload.template_code:
        template = (
            db.query(CrewActivityTemplate)
            .filter(
                CrewActivityTemplate.code == payload.template_code.strip().upper(),
                CrewActivityTemplate.is_active.is_(True),
            )
            .first()
        )
        if not template:
            raise HTTPException(status_code=404, detail="Plantilla de actividad no encontrada.")

    scheduled = ensure_aware(payload.scheduled_for).astimezone(timezone.utc)
    now = utcnow()
    if scheduled < now - timedelta(days=7) or scheduled > now + timedelta(days=180):
        raise HTTPException(
            status_code=422,
            detail="La fecha debe estar entre los últimos 7 días y los próximos 180 días.",
        )

    crew = _crew_ids(db, mission.id)
    if not crew:
        raise HTTPException(status_code=400, detail="La misión no tiene tripulación asignada.")

    title = (payload.title or "").strip() or (template.title if template else "")
    description = (payload.description or "").strip() or (template.description if template else None)
    act = CrewActivity(
        mission_id=mission.id,
        template_code=template.code if template else None,
        title=title[:150],
        description=description,
        scheduled_for=scheduled,
        duration_minutes=payload.duration_minutes or (template.duration_minutes if template else 30),
        status="SCHEDULED",
        created_by_id=user.id,
        created_at=now,
    )
    db.add(act)
    db.flush()
    for uid in crew:
        is_creator = uid == user.id
        db.add(
            CrewActivityParticipant(
                activity_id=act.id,
                user_id=uid,
                # Quien propone la actividad se apunta automáticamente
                response="JOINED" if is_creator else "PENDING",
                responded_at=now if is_creator else None,
            )
        )
    db.commit()
    db.refresh(act)
    return _serialize_activity(db, act, user.id)


@isolation_router.post("/crew-activities/{activity_id}/respond")
def respond_crew_activity(
    activity_id: int,
    payload: CrewActivityRespond,
    user: User = Depends(require_roles(["ASTRONAUT"])),
    db: Session = Depends(get_db),
):
    act = _load_activity(db, activity_id, user)
    part = _my_participation(act, user)
    if act.status != "SCHEDULED":
        raise HTTPException(status_code=409, detail="Solo se puede responder a actividades programadas.")
    if payload.response == "DECLINED" and part.attended:
        raise HTTPException(status_code=409, detail="Ya registraste tu asistencia a esta actividad.")
    part.response = payload.response
    part.responded_at = utcnow()
    db.commit()
    db.refresh(act)
    return _serialize_activity(db, act, user.id)


@isolation_router.post("/crew-activities/{activity_id}/attend")
def attend_crew_activity(
    activity_id: int,
    user: User = Depends(require_roles(["ASTRONAUT"])),
    db: Session = Depends(get_db),
):
    act = _load_activity(db, activity_id, user)
    part = _my_participation(act, user)
    if act.status == "CANCELLED":
        raise HTTPException(status_code=409, detail="La actividad está cancelada.")
    if part.response != "JOINED":
        raise HTTPException(status_code=409, detail="Debes unirte (JOINED) antes de registrar asistencia.")
    if not part.attended:
        now = utcnow()
        opens_at, closes_at = _attend_window(act)
        if now < opens_at or now > closes_at:
            _finalize_activity(db, act.id)  # autocuración aunque esta asistencia quede fuera de plazo
            raise HTTPException(
                status_code=409,
                detail=(
                    "Solo puedes registrar asistencia desde 15 minutos antes del inicio "
                    "hasta 24 horas después del final de la actividad."
                ),
            )
        # UPDATE condicionado: idempotente aunque lleguen dos peticiones a la vez
        db.query(CrewActivityParticipant).filter(
            CrewActivityParticipant.id == part.id, CrewActivityParticipant.attended.is_(False)
        ).update({"attended": True, "attended_at": now}, synchronize_session=False)
        db.commit()
    # Recuento en BD, transición atómica y XP atómico por participante (también autocura datos antiguos)
    _finalize_activity(db, act.id)
    db.expire_all()
    act = db.query(CrewActivity).filter(CrewActivity.id == activity_id).first()
    return _serialize_activity(db, act, user.id)


@isolation_router.post("/crew-activities/{activity_id}/cancel")
def cancel_crew_activity(
    activity_id: int,
    user: User = Depends(require_roles(["ASTRONAUT", "MISSION_LEADER", "ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    act = _load_activity(db, activity_id, user)
    role_code = _role(user)
    allowed = (
        act.created_by_id == user.id
        or role_code == "ADMINISTRATOR"
        or (role_code == "MISSION_LEADER" and _active_assignment(db, user.id, act.mission_id) is not None)
    )
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="Solo quien creó la actividad, el líder asignado o administración pueden cancelarla.",
        )
    if act.status != "SCHEDULED":
        raise HTTPException(status_code=409, detail="Solo se pueden cancelar actividades programadas.")
    act.status = "CANCELLED"
    act.cancelled_at = utcnow()
    db.commit()
    db.refresh(act)
    return _serialize_activity(db, act, user.id)


# ============================================================================
# 4. CANAL FAMILIAR ("CONEXIÓN CON TIERRA")
# ============================================================================

def _ensure_family_conversation(db: Session, contact: FamilyContact) -> Optional[Conversation]:
    conv = (
        db.query(Conversation)
        .filter(
            Conversation.channel == "FAMILY",
            Conversation.astronaut_id == contact.astronaut_id,
            Conversation.leader_id == contact.user_id,
        )
        .first()
    )
    if conv:
        return conv
    assign = _active_assignment(db, contact.astronaut_id)
    mission_id = assign.mission_id if assign else None
    if mission_id is None:
        first_mission = db.query(Mission).order_by(Mission.id.asc()).first()
        if not first_mission:
            return None
        mission_id = first_mission.id
    astro = db.query(User).filter(User.id == contact.astronaut_id).first()
    fam = db.query(User).filter(User.id == contact.user_id).first()
    now = utcnow()
    conv = Conversation(
        mission_id=mission_id,
        astronaut_id=contact.astronaut_id,
        leader_id=contact.user_id,
        channel="FAMILY",
        subject=f"Conexión con Tierra: {astro.full_name if astro else ''} ↔ {fam.full_name if fam else ''}"[:200],
        status="OPEN",
        is_highlighted=False,
        last_message_at=now,
        is_simulated=False,
    )
    db.add(conv)
    db.flush()
    db.add(ConversationParticipant(conversation_id=conv.id, user_id=contact.astronaut_id, role_in_conversation="ASTRONAUT", last_seen_at=now))
    db.add(ConversationParticipant(conversation_id=conv.id, user_id=contact.user_id, role_in_conversation="FAMILY_MEMBER", last_seen_at=now))
    db.commit()
    db.refresh(conv)
    return conv


@isolation_router.get("/family/contacts")
def list_family_contacts(
    user: User = Depends(require_roles(["ASTRONAUT", "FAMILY_MEMBER"])),
    db: Session = Depends(get_db),
):
    role_code = _role(user)
    q = db.query(FamilyContact).filter(FamilyContact.is_active.is_(True))
    if role_code == "ASTRONAUT":
        q = q.filter(FamilyContact.astronaut_id == user.id)
    else:
        q = q.filter(FamilyContact.user_id == user.id)
    items = []
    for contact in q.order_by(FamilyContact.id.asc()).all():
        other_id = contact.user_id if role_code == "ASTRONAUT" else contact.astronaut_id
        other = db.query(User).filter(User.id == other_id).first()
        if not other or other.status != "ACTIVE":
            continue
        conv = _ensure_family_conversation(db, contact)
        items.append(
            {
                "id": contact.id,
                "user_id": other.id,
                "name": other.full_name,
                "relationship": contact.relationship_label,
                "conversation_id": conv.id if conv else None,
            }
        )
    return {"items": items}


# ============================================================================
# 5. ADJUNTOS (FOTO Y NOTA DE VOZ — "GUARDAR Y ENVIAR")
# ============================================================================

# mime → (kind, extensión en disco)
ALLOWED_ATTACHMENT_TYPES = {
    "image/jpeg": ("IMAGE", ".jpg"),
    "image/png": ("IMAGE", ".png"),
    "image/webp": ("IMAGE", ".webp"),
    "audio/webm": ("AUDIO", ".webm"),
    "audio/ogg": ("AUDIO", ".ogg"),
    "audio/mp4": ("AUDIO", ".m4a"),
    "audio/mpeg": ("AUDIO", ".mp3"),
}
_STORAGE_KEY_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp|webm|ogg|m4a|mp3)$")
_CHUNK = 64 * 1024


def detect_mime_from_magic(head: bytes) -> Optional[str]:
    """Tipo real por magic bytes (nunca por nombre ni por el Content-Type del cliente)."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(head) >= 12 and head[0:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in head[:64]:
        return "audio/webm"
    if head.startswith(b"OggS"):
        return "audio/ogg"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in MP4_AUDIO_BRANDS or brand in MP4_GENERIC_BRANDS:
            return "audio/mp4"
        return None
    if head.startswith(b"ID3"):
        return "audio/mpeg"  # candidato: tras subirlo se exige un frame MPEG después de la etiqueta (_id3_followed_by_mpeg_frame)
    if _is_mpeg_audio_frame_header(head):
        return "audio/mpeg"
    return None


# Marcas "major brand" de ftyp. Las de audio son inequívocas; las genéricas (las que escriben Safari
# —iso5/mp42/isom— y Chrome con MediaRecorder audio/mp4) también se usan para vídeo, así que con ellas
# se exige además que el archivo tenga una pista de sonido y ninguna de vídeo (ver _mp4_is_audio_only).
MP4_AUDIO_BRANDS = {b"M4A ", b"M4B ", b"M4P ", b"F4A ", b"F4B "}
MP4_GENERIC_BRANDS = {b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42", b"dash"}


def _is_mpeg_audio_frame_header(head: bytes) -> bool:
    """Cabecera de frame MPEG audio válida: sync de 11 bits y versión/capa/bitrate/frecuencia no reservados."""
    if len(head) < 4 or head[0] != 0xFF or (head[1] & 0xE0) != 0xE0:
        return False
    version = (head[1] >> 3) & 0x03  # 01 = reservado
    layer = (head[1] >> 1) & 0x03  # 00 = reservado
    bitrate = (head[2] >> 4) & 0x0F  # 1111 = no válido (0000 = "free", rarísimo: también se rechaza)
    sample_rate = (head[2] >> 2) & 0x03  # 11 = reservado
    emphasis = head[3] & 0x03  # 10 = reservado
    return version != 1 and layer != 0 and bitrate not in (0, 15) and sample_rate != 3 and emphasis != 2


def _id3_followed_by_mpeg_frame(path: Path) -> bool:
    """
    MP3 con etiqueta ID3v2: cabecera de 10 bytes ('ID3', versión, flags, tamaño sincsafe en los bytes 6-9;
    +10 si el flag de footer está activo). Justo después de la etiqueta debe empezar un frame MPEG válido;
    si el archivo es demasiado corto para comprobarlo, no se acepta.
    """
    with open(path, "rb") as fh:
        header = fh.read(10)
        if len(header) < 10 or header[:3] != b"ID3" or header[3] == 0xFF or header[4] == 0xFF:
            return False
        size_bytes = header[6:10]
        if any(b & 0x80 for b in size_bytes):
            return False  # tamaño no sincsafe: cabecera corrupta
        tag_size = (size_bytes[0] << 21) | (size_bytes[1] << 14) | (size_bytes[2] << 7) | size_bytes[3]
        offset = 10 + tag_size + (10 if header[5] & 0x10 else 0)
        fh.seek(offset)
        return _is_mpeg_audio_frame_header(fh.read(4))


def _mp4_is_audio_only(path: Path, head: bytes) -> bool:
    """
    MP4/M4A: rechaza vídeo. Busca las cajas 'hdlr' (tipo de pista) en todo el archivo (≤ 5 MB):
    ninguna puede ser 'vide'; con marcas genéricas debe existir al menos una 'soun'.
    """
    data = path.read_bytes()
    handlers = set()
    idx = data.find(b"hdlr")
    while idx != -1:
        handlers.add(data[idx + 12: idx + 16])  # 'hdlr' + versión/flags (4) + pre_defined (4) → handler_type
        idx = data.find(b"hdlr", idx + 4)
    if b"vide" in handlers:
        return False
    if head[8:12] in MP4_AUDIO_BRANDS:
        return True
    return b"soun" in handlers


def _safe_display_name(raw: Optional[str], ext: str) -> str:
    """Nombre solo para mostrar: sin rutas, sin caracteres de control ni comillas; nunca se usa en disco."""
    name = (raw or "").replace("\\", "/").split("/")[-1]
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C" and ch not in '"<>;')
    name = name.strip().strip(".")[:120]
    return name or f"adjunto{ext}"


def _upload_dir() -> Path:
    path = Path(settings.UPLOAD_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _remove_stored_file(storage_key: Optional[str]) -> None:
    if not storage_key or not _STORAGE_KEY_RE.match(storage_key):
        return  # nunca se borra una ruta que no tenga el formato de clave aleatoria
    try:
        (Path(settings.UPLOAD_DIR) / storage_key).unlink(missing_ok=True)
    except OSError:
        pass


def purge_expired_orphan_attachments(db: Session, uploader_id: Optional[int] = None) -> int:
    """
    Borra (fila + archivo) los adjuntos huérfanos —subidos y nunca enviados— con más de
    ORPHAN_ATTACHMENT_TTL_HOURS (168 h = 7 días por defecto). Se llama al arrancar y, de forma oportunista,
    al subir; nunca toca huérfanos recientes (p. ej. los de un mensaje que espera en la cola sin conexión).
    Los ids borrados no se reutilizan (AUTOINCREMENT), así que un mensaje en cola con un id purgado falla
    en vez de adjuntar otro archivo. Devuelve cuántos borró.
    """
    cutoff = utcnow() - timedelta(hours=settings.ORPHAN_ATTACHMENT_TTL_HOURS)
    q = db.query(MessageAttachment).filter(
        MessageAttachment.message_id.is_(None),
        MessageAttachment.storage_key.isnot(None),
        MessageAttachment.uploaded_at < cutoff,
    )
    if uploader_id is not None:
        q = q.filter(MessageAttachment.uploader_id == uploader_id)
    expired = q.limit(500).all()
    if not expired:
        return 0
    keys = [a.storage_key for a in expired]
    for att in expired:
        db.delete(att)
    db.commit()
    for key in keys:
        _remove_stored_file(key)
    return len(keys)


@isolation_router.post("/attachments", status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Solo quien participa en alguna conversación (astronauta, líder o familiar)
    participates = (
        db.query(Conversation.id)
        .filter((Conversation.astronaut_id == user.id) | (Conversation.leader_id == user.id))
        .first()
    )
    if not participates:
        raise HTTPException(status_code=403, detail="Solo los participantes de una conversación pueden subir adjuntos.")

    # Los huérfanos caducados (> ORPHAN_ATTACHMENT_TTL_HOURS) no cuentan para el límite (ni ocupan disco);
    # los recientes sí: para liberar hueco se descartan con DELETE /attachments/{id}
    purge_expired_orphan_attachments(db, uploader_id=user.id)
    pending = (
        db.query(MessageAttachment)
        .filter(
            MessageAttachment.uploader_id == user.id,
            MessageAttachment.message_id.is_(None),
        )
        .count()
    )
    if pending >= settings.MAX_PENDING_ATTACHMENTS_PER_USER:
        raise HTTPException(status_code=429, detail="Demasiados adjuntos pendientes de enviar. Envía o descarta los actuales.")

    max_bytes = settings.MAX_ATTACHMENT_BYTES
    # Rechazo temprano por Content-Length (margen para las cabeceras multipart); el límite real se aplica leyendo por bloques
    try:
        declared_len = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared_len = 0
    if declared_len > max_bytes + 64 * 1024:
        raise HTTPException(status_code=413, detail="El adjunto supera el tamaño máximo de 5 MB.")
    upload_dir = _upload_dir()
    tmp_path = upload_dir / f".tmp-{secrets.token_hex(16)}"
    size = 0
    head = b""
    try:
        with open(tmp_path, "wb") as out:
            while True:
                chunk = await file.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail="El adjunto supera el tamaño máximo de 5 MB.")
                if len(head) < 64:
                    head += chunk[: 64 - len(head)]
                out.write(chunk)
        if size == 0:
            raise HTTPException(status_code=422, detail="El archivo está vacío.")
        mime = detect_mime_from_magic(head)
        if mime == "audio/mp4" and not _mp4_is_audio_only(tmp_path, head):
            mime = None  # MP4 con vídeo (o sin pista de sonido): no es una nota de voz
        if mime == "audio/mpeg" and head.startswith(b"ID3") and not _id3_followed_by_mpeg_frame(tmp_path):
            mime = None  # 'ID3' seguido de cualquier cosa que no sea audio MPEG
        if mime not in ALLOWED_ATTACHMENT_TYPES:
            raise HTTPException(
                status_code=415,
                detail="Tipo de archivo no permitido. Solo fotos (JPEG, PNG, WebP) o notas de voz (WebM, OGG, MP4, MP3).",
            )
        kind, ext = ALLOWED_ATTACHMENT_TYPES[mime]
        storage_key = f"{secrets.token_hex(16)}{ext}"
        os.replace(tmp_path, upload_dir / storage_key)
    except BaseException:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    finally:
        await file.close()

    att = MessageAttachment(
        message_id=None,
        file_name=_safe_display_name(file.filename, ext),
        mime_type=mime,
        file_size_bytes=size,
        safe_summary_note=None,
        uploader_id=user.id,
        storage_key=storage_key,
        kind=kind,
        duration_seconds=None,
        uploaded_at=utcnow(),
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return {
        "id": att.id,
        "file_name": att.file_name,
        "mime_type": att.mime_type,
        "kind": att.kind,
        "file_size_bytes": att.file_size_bytes,
        "duration_seconds": att.duration_seconds,
    }


@isolation_router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_orphan_attachment(
    attachment_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Descarta un adjunto subido que aún no se ha enviado. Solo quien lo subió; borra fila y archivo."""
    att = db.query(MessageAttachment).filter(MessageAttachment.id == attachment_id).first()
    if not att or att.uploader_id != user.id:
        # Igual que en la descarga: no se revela la existencia de adjuntos ajenos
        raise HTTPException(status_code=404, detail="Adjunto no encontrado.")
    if att.message_id is not None:
        raise HTTPException(status_code=409, detail="Solo se pueden descartar adjuntos que aún no se han enviado.")
    key = att.storage_key
    db.delete(att)
    db.commit()
    _remove_stored_file(key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@isolation_router.get("/attachments/{attachment_id}")
def download_attachment(
    attachment_id: int,
    audit_justification: Optional[str] = Query(default=None, max_length=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    att = db.query(MessageAttachment).filter(MessageAttachment.id == attachment_id).first()
    if not att or not att.storage_key or not _STORAGE_KEY_RE.match(att.storage_key):
        raise HTTPException(status_code=404, detail="Adjunto no encontrado.")

    if att.message_id is None:
        # Huérfano: solo quien lo subió
        if att.uploader_id != user.id:
            raise HTTPException(status_code=404, detail="Adjunto no encontrado.")
    else:
        msg = db.query(Message).filter(Message.id == att.message_id).first()
        conv = db.query(Conversation).filter(Conversation.id == msg.conversation_id).first() if msg else None
        if not conv:
            raise HTTPException(status_code=404, detail="Adjunto no encontrado.")
        # MISSION: participantes (o administración con justificación auditada).
        # FAMILY: solo los dos participantes; nunca administración ni líder.
        _verify_conversation_access(db, user, conv, audit_justification=audit_justification)

    path = Path(settings.UPLOAD_DIR) / att.storage_key
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Archivo del adjunto no disponible.")
    ascii_name = att.file_name.encode("ascii", "ignore").decode("ascii").replace("\\", "") or "adjunto"
    headers = {
        "Content-Disposition": f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(att.file_name)}",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private",
        "Content-Security-Policy": "default-src 'none'; sandbox",
    }
    return FileResponse(str(path), media_type=att.mime_type, headers=headers)
