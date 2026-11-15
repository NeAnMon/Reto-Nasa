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
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from backend.app.models.models import Alert, QuickCheckin

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
