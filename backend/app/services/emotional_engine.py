from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from backend.app.models.models import (
    Alert,
    EmotionalAssessment,
    EmotionalAssessmentRequest,
    EmotionalAssessmentResponse,
    EmotionalAssessmentResult,
    EmotionalQuestion,
    EmotionalSupportRequest,
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class EmotionalWellnessEngine:
    """
    Deterministic Rule-Based Emotional Follow-Up Engine (Module 3.8).
    Evaluates questionnaire responses solely via configured protocol rules.
    Strictly adheres to safety and privacy constraints:
    - States are operational follow-up signals, NOT clinical or mental health diagnoses.
    - Never uses stigmatizing labels ("unstable", "weak", etc.) or computes a universal mental health score.
    - Immediately activates urgent protocol instructions when urgent criteria or explicit help requests occur,
      without waiting for manual administrator review or AI intervention.
    """

    STATES = {
        "EMOTIONAL_WELLNESS_STABLE",
        "EMOTIONAL_WELLNESS_MONITORING",
        "SUPPORT_REQUESTED",
        "PROFESSIONAL_REVIEW",
        "URGENT_SUPPORT",
        "ASSESSMENT_INCOMPLETE",
        "ASSESSMENT_UNAVAILABLE",
    }

    URGENT_PROTOCOL_INSTRUCTIONS = (
        "PROTOCOLO URGENTE DE ACOMPAÑAMIENTO ACTIVO: "
        "1. Su solicitud prioritaria de apoyo ha sido activada de inmediato.\n"
        "2. Establezca contacto directo mediante el canal privado prioritario con el Oficial Médico de Tripulación (CMO) "
        "o el especialista de soporte en Tierra.\n"
        "3. Suspenda tareas operativas exigentes y priorice su seguridad y acompañamiento."
    )

    @classmethod
    def evaluate_assessment(
        cls,
        db: Session,
        assessment: EmotionalAssessment,
        request_obj: EmotionalAssessmentRequest,
        questions_map: Dict[str, EmotionalQuestion],
        explicit_support_requested: bool = False,
        support_urgency: str = "NONE",
    ) -> Tuple[EmotionalAssessmentResult, Optional[Alert]]:
        if assessment.is_draft:
            result = cls._upsert_result(
                db=db,
                assessment_id=assessment.id,
                operational_state="ASSESSMENT_INCOMPLETE",
                explicit_support=explicit_support_requested,
                urgent_triggered=False,
                authorized_summary="Cuestionario emocional en borrador (pendiente de envío final).",
                personal_summary="Tus respuestas parciales se han guardado de forma privada. Puedes continuar cuando lo desees.",
                recommended_step="Completar las preguntas pendientes a tu propio ritmo.",
            )
            return result, None

        responses: List[EmotionalAssessmentResponse] = (
            db.query(EmotionalAssessmentResponse)
            .filter(EmotionalAssessmentResponse.assessment_id == assessment.id)
            .all()
        )
        if not responses:
            result = cls._upsert_result(
                db=db,
                assessment_id=assessment.id,
                operational_state="ASSESSMENT_UNAVAILABLE",
                explicit_support=False,
                urgent_triggered=False,
                authorized_summary="Sin respuestas registradas.",
                personal_summary="No se encontraron respuestas evaluables.",
                recommended_step="Iniciar el cuestionario o solicitar acompañamiento directo.",
            )
            return result, None

        concern_dimensions: List[str] = []
        severe_concern_dimensions: List[str] = []

        for resp in responses:
            if resp.prefer_not_to_answer:
                continue
            q = questions_map.get(resp.question_code)
            if not q:
                continue
            if q.question_type in ("BOOLEAN_SUPPORT", "SUPPORT_SELECT"):
                if resp.response_value in ("YES", "TRUE", "URGENT", "3", "4", "5"):
                    explicit_support_requested = True
                    if resp.response_value in ("URGENT", "5"):
                        support_urgency = "URGENT"
                    elif resp.response_value == "4" and support_urgency != "URGENT":
                        support_urgency = "PRIORITY"
            if resp.numeric_score is not None:
                score = resp.numeric_score  # 1 to 5 scale
                # Normalize concern level: if higher_value_indicates_concern (e.g. stress, isolation, fatigue),
                # 4 is moderate concern, 5 is high concern. If lower indicates concern (e.g. mood, rest, support),
                # 2 is moderate concern, 1 is high concern.
                if q.higher_value_indicates_concern:
                    if score >= 5:
                        severe_concern_dimensions.append(q.dimension_code)
                    elif score >= 4:
                        concern_dimensions.append(q.dimension_code)
                else:
                    if score <= 1:
                        severe_concern_dimensions.append(q.dimension_code)
                    elif score <= 2:
                        concern_dimensions.append(q.dimension_code)

        urgent_triggered = False
        if support_urgency == "URGENT" or len(severe_concern_dimensions) >= 3:
            op_state = "URGENT_SUPPORT"
            urgent_triggered = True
        elif explicit_support_requested and support_urgency == "PRIORITY":
            op_state = "PROFESSIONAL_REVIEW"
        elif explicit_support_requested:
            op_state = "SUPPORT_REQUESTED"
        elif len(severe_concern_dimensions) >= 1 or len(concern_dimensions) >= 4:
            op_state = "PROFESSIONAL_REVIEW"
        elif len(concern_dimensions) >= 2:
            op_state = "EMOTIONAL_WELLNESS_MONITORING"
        else:
            op_state = "EMOTIONAL_WELLNESS_STABLE"

        if urgent_triggered:
            auth_summary = (
                "Señal operativa URGENT_SUPPORT activada por regla de protocolo DEMO. "
                "Requiere contacto prioritario de acompañamiento (respuestas detalladas protegidas)."
            )
            personal_summary = (
                "Gracias por responder con confianza. Hemos activado de inmediato las instrucciones de apoyo prioritario "
                "para que cuentes con acompañamiento oportuno."
            )
            next_step = cls.URGENT_PROTOCOL_INSTRUCTIONS
        elif op_state in ("SUPPORT_REQUESTED", "PROFESSIONAL_REVIEW"):
            auth_summary = (
                f"Estado operativo {op_state}: el tripulante solicitó contacto de apoyo o registró dimensiones que "
                "ameritan seguimiento preventivo autorizado."
            )
            personal_summary = (
                "Tu cuestionario emocional fue registrado de forma privada. Se ha generado una señal de acompañamiento "
                "para facilitar el contacto con el equipo de apoyo."
            )
            next_step = (
                "Accede al Wellness Center o abre un canal privado en Communication Center con tu líder o especialista."
            )
        elif op_state == "EMOTIONAL_WELLNESS_MONITORING":
            auth_summary = (
                "Estado operativo EMOTIONAL_WELLNESS_MONITORING: se recomienda seguimiento preventivo de descanso y carga operativa."
            )
            personal_summary = (
                "Se observan algunas dimensiones de carga o cansancio que vale la pena acompañar con pausas de recuperación."
            )
            next_step = "Revisar recursos de descanso, respiración guiada y contacto social autorizado en el Wellness Center."
        else:
            auth_summary = "Estado operativo EMOTIONAL_WELLNESS_STABLE: cuestionario completado dentro de parámetros habituales."
            personal_summary = (
                "Tu registro emocional quedó guardado de forma privada. Continúa con tus rutinas habituales de autocuidado y descanso."
            )
            next_step = "Mantener las pautas de descanso, recreación y comunicación periódica."

        result = cls._upsert_result(
            db=db,
            assessment_id=assessment.id,
            operational_state=op_state,
            explicit_support=explicit_support_requested,
            urgent_triggered=urgent_triggered,
            authorized_summary=auth_summary,
            personal_summary=personal_summary,
            recommended_step=next_step,
        )

        if explicit_support_requested or urgent_triggered:
            db.add(
                EmotionalSupportRequest(
                    assessment_id=assessment.id,
                    astronaut_id=assessment.astronaut_id,
                    urgency_level="URGENT" if urgent_triggered else ("PRIORITY" if support_urgency == "PRIORITY" else "ROUTINE"),
                    preferred_contact_channel="PRIVATE_COMMUNICATION_CENTER",
                    notes="Generada desde My Emotional Check-In",
                    status="OPEN",
                    created_at=utcnow(),
                )
            )

        alert_created = None
        if op_state in ("SUPPORT_REQUESTED", "PROFESSIONAL_REVIEW", "URGENT_SUPPORT"):
            priority = "CRITICAL" if urgent_triggered else ("HIGH" if op_state == "PROFESSIONAL_REVIEW" else "MEDIUM")
            alert_state = "CRITICAL" if urgent_triggered else "WARNING"
            alert_created = Alert(
                astronaut_id=assessment.astronaut_id,
                mission_id=assessment.mission_id,
                indicator_code="MOOD_WELLNESS",
                measurement_id=None,
                rule_version_id=None,
                rule_code="RULE_EMOTIONAL_CHECKIN_DEMO",
                rule_version_label=assessment.version_number,
                value_recorded=op_state,
                unit="estado operativo",
                priority=priority,
                operational_state=alert_state,
                status="ESCALATED" if urgent_triggered else "NEW",
                title=f"[{op_state}] Seguimiento de Cuestionario Emocional (#{request_obj.id})",
                explanation=(
                    f"{auth_summary} Nota de privacidad: Las respuestas individuales y comentarios abiertos "
                    "permanecen confidenciales y no se exponen en esta alerta."
                ),
                data_quality="SYNTHETIC_DEMO" if assessment.is_simulated else "VALIDATED",
                immediate_action=next_step,
                followup_recommendation="Coordinar acompañamiento privado respetando las preferencias de confidencialidad del astronauta.",
                environment_code=assessment.environment_code,
                phase_code=assessment.phase_code,
                is_simulated=assessment.is_simulated,
                created_at=utcnow(),
                updated_at=utcnow(),
            )
            db.add(alert_created)
            db.flush()

        return result, alert_created

    @classmethod
    def _upsert_result(
        cls,
        db: Session,
        assessment_id: int,
        operational_state: str,
        explicit_support: bool,
        urgent_triggered: bool,
        authorized_summary: str,
        personal_summary: str,
        recommended_step: str,
    ) -> EmotionalAssessmentResult:
        existing = (
            db.query(EmotionalAssessmentResult)
            .filter(EmotionalAssessmentResult.assessment_id == assessment_id)
            .first()
        )
        if existing:
            existing.operational_state = operational_state
            existing.explicit_support_requested = explicit_support
            existing.urgent_protocol_triggered = urgent_triggered
            existing.authorized_operational_summary = authorized_summary
            existing.personal_feedback_summary = personal_summary
            existing.recommended_next_step = recommended_step
            return existing

        res = EmotionalAssessmentResult(
            assessment_id=assessment_id,
            operational_state=operational_state,
            explicit_support_requested=explicit_support,
            urgent_protocol_triggered=urgent_triggered,
            authorized_operational_summary=authorized_summary,
            personal_feedback_summary=personal_summary,
            recommended_next_step=recommended_step,
            created_at=utcnow(),
        )
        db.add(res)
        db.flush()
        return res
