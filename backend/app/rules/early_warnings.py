"""
Alertas tempranas de bienestar (issue #14).

"Contacto con Tierra" dejó de ser una subsección de Bienestar: ahora es una RECOMENDACIÓN que solo
aparece como alerta temprana cuando las señales autoinformadas del astronauta sugieren riesgo de
aislamiento (NASA HRP — Isolation and Confinement / Behavioral Health).

Disparadores (deterministas, sin IA):
  1. Check-in rápido de Bienestar: el registro nuevo es una "señal" (ánimo <= 2 o sensación de
     aislamiento) y al menos 2 de los 3 últimos check-ins de los últimos 7 días (incluido el nuevo)
     también lo son. Es más temprano que la señal operativa NEEDS_CHECK_IN (3 de 3).
  2. Cuestionario emocional: la dimensión ISOLATION queda en preocupación (puntuación >= 4 de 5).

Una sola alerta abierta por astronauta: si ya hay una sin resolver con esta regla no se crea otra.

Privacidad: la alerta nunca incluye ánimo, energía, respuestas ni notas; solo dice que hay señales de
riesgo de aislamiento. Si el astronauta desactivó compartir señales de bienestar con su líder, el
líder no ve estas alertas (mismo criterio que la señal operativa del check-in).
"""
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.models.models import (
    Alert, CrewActivity, FollowUpAction, LeisureLog, MissionAssignment, QuickCheckin, Role, User,
)

EARLY_RULE_PREFIX = "RULE_EARLY_"
EARTH_CONTACT_RULE = "RULE_EARLY_EARTH_CONTACT"
EARTH_CONTACT_INDICATOR = "EARTH_CONTACT"
EARTH_CONTACT_VERSION = "1.0-DEMO"

# Ventana y umbral del disparador por check-in
CHECKIN_WINDOW_DAYS = 7
CHECKIN_LOOKBACK = 3
CHECKIN_MIN_SIGNALS = 2
LOW_MOOD_MAX = 2

SOURCE_CHECKIN = "CHECKIN"
SOURCE_EMOTIONAL = "EMOTIONAL"

EARTH_CONTACT_TITLE = "[ALERTA TEMPRANA] Contacto con Tierra recomendado"
EARTH_CONTACT_EXPLANATION = {
    SOURCE_CHECKIN: (
        "Alerta temprana: los check-ins de Bienestar de los últimos días muestran señales repetidas de "
        "riesgo de aislamiento. El programa de investigación humana de la NASA (HRP) señala el aislamiento "
        "y el confinamiento como un riesgo para el ánimo, el sueño y la convivencia; el apoyo de los seres "
        "queridos es uno de los recursos que más lo amortiguan. Los valores individuales (ánimo, "
        "aislamiento, notas) son privados y no se muestran en esta alerta."
    ),
    SOURCE_EMOTIONAL: (
        "Alerta temprana: el cuestionario emocional registró preocupación en la dimensión de aislamiento. "
        "El programa de investigación humana de la NASA (HRP) señala el aislamiento y el confinamiento como "
        "un riesgo para el ánimo, el sueño y la convivencia; el apoyo de los seres queridos es uno de los "
        "recursos que más lo amortiguan. Las respuestas individuales son privadas y no se muestran en esta alerta."
    ),
}
EARTH_CONTACT_ACTION = (
    "Recomendación: reserva hoy un momento para el contacto con tus seres queridos y con tu equipo en Tierra. "
    "Lo más adecuado es un canal asíncrono (notas de voz, chat o fotos del día a día) que se entrega cuando hay "
    "enlace; la propuesta está en la pestaña Recomendaciones: «Canal de comunicación con Tierra y con la familia»."
)
EARTH_CONTACT_FOLLOWUP = (
    "Sin videollamadas: con el retardo de la comunicación una conversación en directo resulta frustrante. "
    "Repite el check-in de Bienestar en 24 h; si las señales continúan, coméntalo con tu especialista de apoyo "
    "en el próximo contacto con Tierra."
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def is_early_rule(rule_code: Optional[str]) -> bool:
    return bool(rule_code) and str(rule_code).startswith(EARLY_RULE_PREFIX)


def is_isolation_signal(c: QuickCheckin) -> bool:
    return bool(c.feels_isolated) or (c.mood is not None and c.mood <= LOW_MOOD_MAX)


def checkin_needs_earth_contact(recent: List[QuickCheckin], now: Optional[datetime] = None) -> bool:
    """recent: check-ins más recientes primero (el primero es el recién creado)."""
    if not recent:
        return False
    now = now or _utcnow()
    if not is_isolation_signal(recent[0]):
        return False
    cutoff = now - timedelta(days=CHECKIN_WINDOW_DAYS)
    window = [c for c in recent if (_aware(c.created_at) or now) >= cutoff][:CHECKIN_LOOKBACK]
    return sum(1 for c in window if is_isolation_signal(c)) >= CHECKIN_MIN_SIGNALS


def emotional_needs_earth_contact(concern_dimensions: Iterable[str]) -> bool:
    return "ISOLATION" in set(concern_dimensions or [])


def open_earth_contact_alert(db: Session, astronaut_id: int) -> Optional[Alert]:
    return (
        db.query(Alert)
        .filter(
            Alert.astronaut_id == astronaut_id,
            Alert.rule_code == EARTH_CONTACT_RULE,
            Alert.status != "RESOLVED",
        )
        .first()
    )


def create_earth_contact_alert(
    db: Session,
    astronaut_id: int,
    mission_id: Optional[int],
    source: str,
    environment_code: Optional[str] = None,
    phase_code: Optional[str] = None,
    is_simulated: bool = False,
) -> Optional[Alert]:
    """Crea la alerta temprana de contacto con Tierra si no hay otra abierta. Devuelve la nueva o None."""
    if not mission_id:
        return None
    if open_earth_contact_alert(db, astronaut_id):
        return None
    now = _utcnow()
    alert = Alert(
        astronaut_id=astronaut_id,
        mission_id=mission_id,
        indicator_code=EARTH_CONTACT_INDICATOR,
        measurement_id=None,
        rule_version_id=None,
        rule_code=EARTH_CONTACT_RULE,
        rule_version_label=EARTH_CONTACT_VERSION,
        value_recorded=None,
        unit=None,
        priority="LOW",
        operational_state="MONITOR",
        status="NEW",
        title=EARTH_CONTACT_TITLE,
        explanation=EARTH_CONTACT_EXPLANATION.get(source, EARTH_CONTACT_EXPLANATION[SOURCE_CHECKIN]),
        data_quality="SYNTHETIC_DEMO" if is_simulated else "VALIDATED",
        immediate_action=EARTH_CONTACT_ACTION,
        followup_recommendation=EARTH_CONTACT_FOLLOWUP,
        environment_code=environment_code,
        phase_code=phase_code,
        is_simulated=is_simulated,
        created_at=now,
        updated_at=now,
    )
    db.add(alert)
    db.flush()
    return alert


# ──────────────────────────────────────────────────────────────────────────────────────────────────
# Recordatorios de Bienestar: tiempo libre y actividades de tripulación (issue #44)
#
# Avisan a cada astronauta (y a su líder, con el mismo criterio de privacidad que el resto de alertas
# tempranas) de lo que falta por hacer en Bienestar → Tiempo libre y Bienestar → Tripulación. Son
# contramedidas del riesgo NASA HRP de aislamiento y confinamiento. Son alertas tempranas (RULE_EARLY_*,
# prioridad LOW, clase A): nunca alarma W/C.
#
# No hay planificador: se evalúan al pedir el resumen de salud o la lista de alertas y después de cada
# acción de tiempo libre o de tripulación (refresh_wellbeing_reminders). Una sola abierta por regla y
# astronauta; se retiran solas (RESOLVED con nota de sistema, sin borrar) cuando ya no hace falta.
#
#   RULE_EARLY_LEISURE        sin ningún "Lo hice" de tiempo libre en las últimas LEISURE_GAP_HOURS.
#   RULE_EARLY_CREW_ACTIVITY  a) invitación PENDIENTE a una actividad de su misión que empieza en las
#                                próximas CREW_UPCOMING_HOURS (o ya está en curso), o
#                             b) la misión no ha completado ninguna actividad esta semana y no tiene
#                                ninguna programada de aquí al final de la semana.
# ──────────────────────────────────────────────────────────────────────────────────────────────────

OPEN_REMINDER_STATUSES = ("NEW", "ACKNOWLEDGED", "IN_FOLLOWUP", "ESCALATED")
REMINDER_VERSION = "1.0-DEMO"
SYSTEM_AUTHOR_ROLE = "SYSTEM"

LEISURE_RULE = "RULE_EARLY_LEISURE"
LEISURE_INDICATOR = "LEISURE_TIME"
LEISURE_GAP_HOURS = 48

CREW_RULE = "RULE_EARLY_CREW_ACTIVITY"
CREW_INDICATOR = "CREW_ACTIVITY"
CREW_UPCOMING_HOURS = 48

CREW_REASON_INVITE = "INVITE"
CREW_REASON_WEEKLY = "WEEKLY"

LEISURE_TITLE = "[RECORDATORIO] Tiempo libre pendiente"
LEISURE_EXPLANATION = (
    "No hay ninguna actividad de tiempo libre registrada en las últimas 48 horas. El programa de investigación "
    "humana de la NASA (HRP) recomienda reservar cada día un rato breve para aficiones (plantas, lectura, música, "
    "dibujo, fotografía...) como contramedida frente a la fatiga y la monotonía del aislamiento."
)
LEISURE_ACTION = (
    "Recomendación: elige hoy una actividad breve (10–30 min) en Bienestar → Tiempo libre y, al terminar, "
    "pulsa «Lo hice» para registrarla."
)
LEISURE_FOLLOWUP = "El aviso se retira solo en cuanto registras una actividad de tiempo libre."
LEISURE_RESOLVED_NOTE = "Retirada automática: se registró una actividad de tiempo libre."

CREW_TITLE = {
    CREW_REASON_INVITE: "[RECORDATORIO] Actividad de tripulación pendiente de respuesta",
    CREW_REASON_WEEKLY: "[RECORDATORIO] Meta semanal de tripulación sin cumplir",
}
CREW_EXPLANATION = {
    CREW_REASON_INVITE: (
        "Hay una actividad de integración de la tripulación que empieza en las próximas 48 horas (o ya está en curso) "
        "y aún no has respondido si te unes. Las actividades en grupo son una contramedida del riesgo de aislamiento "
        "y confinamiento (NASA HRP): mejoran la cohesión y la comunicación del equipo."
    ),
    CREW_REASON_WEEKLY: (
        "La tripulación no ha completado ninguna actividad de integración esta semana y no hay ninguna programada. "
        "La meta es al menos una por semana: las actividades en grupo son una contramedida del riesgo de aislamiento "
        "y confinamiento (NASA HRP)."
    ),
}
CREW_ACTION = {
    CREW_REASON_INVITE: (
        "Recomendación: abre Bienestar → Tripulación y responde si te unes a la actividad; si te unes, marca tu "
        "asistencia cuando empiece."
    ),
    CREW_REASON_WEEKLY: (
        "Recomendación: propón en Bienestar → Tripulación una actividad breve para esta semana (comida compartida, "
        "película, observación de la Tierra...)."
    ),
}
CREW_FOLLOWUP = "El aviso se retira solo cuando respondes a la invitación o la tripulación programa o completa una actividad."
CREW_RESOLVED_NOTE = "Retirada automática: la actividad de tripulación ya no está pendiente."


def _open_reminder(db: Session, astronaut_id: int, rule_code: str) -> Optional[Alert]:
    return (
        db.query(Alert)
        .filter(
            Alert.astronaut_id == astronaut_id,
            Alert.rule_code == rule_code,
            Alert.status.in_(OPEN_REMINDER_STATUSES),
        )
        .order_by(Alert.id.desc())
        .first()
    )


def _resolve_reminder(db: Session, alert: Alert, note: str, now: datetime) -> None:
    alert.status = "RESOLVED"
    alert.updated_at = now
    db.add(FollowUpAction(
        alert_id=alert.id,
        author_user_id=alert.astronaut_id,  # columna obligatoria: el propio astronauta; author_role marca el sistema
        author_role=SYSTEM_AUTHOR_ROLE,
        action_type="RESOLVED",
        notes=note,
        created_at=now,
    ))


def _upsert_reminder(
    db: Session, astronaut_id: int, mission_id: int, rule_code: str, indicator_code: str,
    title: str, explanation: str, action: str, followup: str, now: datetime,
) -> Tuple[Alert, bool]:
    """Una sola abierta por regla: si existe se actualiza su texto (p. ej. cambia el motivo); si no, se crea."""
    existing = _open_reminder(db, astronaut_id, rule_code)
    if existing:
        if (existing.title, existing.explanation, existing.immediate_action) != (title, explanation, action):
            existing.title = title
            existing.explanation = explanation
            existing.immediate_action = action
            existing.followup_recommendation = followup
            existing.updated_at = now
        return existing, False
    alert = Alert(
        astronaut_id=astronaut_id,
        mission_id=mission_id,
        indicator_code=indicator_code,
        measurement_id=None,
        rule_version_id=None,
        rule_code=rule_code,
        rule_version_label=REMINDER_VERSION,
        value_recorded=None,
        unit=None,
        priority="LOW",
        operational_state="MONITOR",
        status="NEW",
        title=title,
        explanation=explanation,
        data_quality="VALIDATED",
        immediate_action=action,
        followup_recommendation=followup,
        environment_code=None,
        phase_code=None,
        is_simulated=False,
        created_at=now,
        updated_at=now,
    )
    db.add(alert)
    return alert, True


def leisure_reminder_due(last_log_at: Optional[datetime], now: datetime) -> bool:
    """¿Toca recordar el tiempo libre? (sin registro nunca, o el último hace más de LEISURE_GAP_HOURS)."""
    last = _aware(last_log_at)
    return last is None or now - last > timedelta(hours=LEISURE_GAP_HOURS)


def crew_reminder_reason(db: Session, astronaut_id: int, mission_id: int, now: datetime) -> Optional[str]:
    """Motivo del recordatorio de tripulación (INVITE, WEEKLY) o None si no hace falta."""
    horizon = now + timedelta(hours=CREW_UPCOMING_HOURS)
    scheduled = (
        db.query(CrewActivity)
        .filter(CrewActivity.mission_id == mission_id, CrewActivity.status == "SCHEDULED")
        .all()
    )
    for act in scheduled:
        start = _aware(act.scheduled_for)
        end = start + timedelta(minutes=act.duration_minutes or 0)
        if end < now or start > horizon:
            continue
        mine = next((p for p in act.participants if p.user_id == astronaut_id), None)
        if mine is not None and mine.response == "PENDING":
            return CREW_REASON_INVITE

    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_end = week_start + timedelta(days=7)
    completed_week = (
        db.query(CrewActivity)
        .filter(
            CrewActivity.mission_id == mission_id,
            CrewActivity.status == "COMPLETED",
            CrewActivity.completed_at >= week_start,
        )
        .count()
    )
    if completed_week:
        return None
    upcoming_week = any(
        _aware(a.scheduled_for) + timedelta(minutes=a.duration_minutes or 0) >= now
        and _aware(a.scheduled_for) < week_end
        for a in scheduled
    )
    return None if upcoming_week else CREW_REASON_WEEKLY


def refresh_wellbeing_reminders(db: Session, astronaut_ids: Iterable[int], now: Optional[datetime] = None) -> int:
    """Crea, actualiza o retira los recordatorios de tiempo libre y tripulación de esos astronautas.

    Solo astronautas activos con una misión activa asignada. Devuelve cuántas alertas nuevas creó.
    No hace commit (lo hace quien llama)."""
    now = now or _utcnow()
    ids = sorted({int(i) for i in astronaut_ids or [] if i is not None})
    if not ids:
        return 0
    astronauts = (
        db.query(User.id)
        .join(Role, Role.id == User.role_id)
        .filter(User.id.in_(ids), Role.code == "ASTRONAUT", User.status == "ACTIVE")
        .all()
    )
    created = 0
    for (aid,) in astronauts:
        assign = (
            db.query(MissionAssignment)
            .filter(MissionAssignment.user_id == aid, MissionAssignment.is_active.is_(True))
            .order_by(MissionAssignment.id.asc())
            .first()
        )
        if not assign:
            continue
        mission_id = assign.mission_id

        last_log = db.query(func.max(LeisureLog.created_at)).filter(LeisureLog.astronaut_id == aid).scalar()
        if leisure_reminder_due(last_log, now):
            _, is_new = _upsert_reminder(
                db, aid, mission_id, LEISURE_RULE, LEISURE_INDICATOR,
                LEISURE_TITLE, LEISURE_EXPLANATION, LEISURE_ACTION, LEISURE_FOLLOWUP, now,
            )
            created += int(is_new)
        else:
            open_alert = _open_reminder(db, aid, LEISURE_RULE)
            if open_alert:
                _resolve_reminder(db, open_alert, LEISURE_RESOLVED_NOTE, now)

        reason = crew_reminder_reason(db, aid, mission_id, now)
        if reason:
            _, is_new = _upsert_reminder(
                db, aid, mission_id, CREW_RULE, CREW_INDICATOR,
                CREW_TITLE[reason], CREW_EXPLANATION[reason], CREW_ACTION[reason], CREW_FOLLOWUP, now,
            )
            created += int(is_new)
        else:
            open_alert = _open_reminder(db, aid, CREW_RULE)
            if open_alert:
                _resolve_reminder(db, open_alert, CREW_RESOLVED_NOTE, now)
    db.flush()
    return created
