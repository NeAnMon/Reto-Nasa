"""SEMSA · Reglas · Alerta temprana del pronóstico (issue #30).

El servicio de pronóstico (`services/prediction_service.py`) proyecta cada día contra el motor de alertas
calibrado, pero no crea alertas. Este módulo convierte esa proyección en una ALERTA TEMPRANA cuando el
valor esperado cruza un umbral del motor (`recommendation.basis == "expected_crossing"`) y el último valor
real sigue en rango: avisa antes de que la medición real lo cruce.

- Regla `RULE_PREDICTION_EARLY_WARNING` (motor PREDICTION, ver `rules/alert_sources.py`); la versión de regla
  enlazada es la versión calibrada del indicador cuyo umbral se cruza.
- Una sola alerta abierta por astronauta + indicador: si ya hay una se actualiza (fecha y valor del último
  pronóstico; la prioridad solo sube, igual que en el motor de reglas).
- Si ya hay una alerta abierta del motor de reglas (u otra) para ese indicador, no se crea: el valor real
  ya está fuera de rango y esa alerta lo cubre.
- Nunca es CRITICAL ni se escala: es una proyección exploratoria (estado operativo MONITOR); la prioridad
  refleja el nivel proyectado.
- Recomendación propia: paso 1 fijo del pronóstico + paso del nivel de observación; el seguimiento es la
  pauta del catálogo de recomendaciones para el indicador y la dirección del cruce (la misma que muestra
  la vista de Predicciones). Los textos fijos tienen traducción EN en `frontend/src/i18n/backend-en-runtime.js`.
- Privacidad: solo indicador, valor esperado, umbral, fecha y regla (los mismos datos que una alerta del
  motor de reglas); nada de notas ni respuestas de bienestar.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from backend.app.models.models import Alert, HealthIndicatorDefinition
from backend.app.rules.engine import OPEN_ALERT_STATUSES, PRIORITY_RANK, find_open_alert, get_active_rule_version
from backend.app.rules.recommendations import LEVEL_STEP, get_recommendation

PREDICTION_RULE = "RULE_PREDICTION_EARLY_WARNING"
PREDICTION_PRIORITY = {"MONITOR": "LOW", "WARNING": "MEDIUM", "CRITICAL": "HIGH"}

PREDICTION_TITLE = "[ALERTA TEMPRANA] Pronóstico de {name}: nivel {state} en {days} día(s)"
PREDICTION_EXPLANATION = (
    "Pronóstico: el valor esperado ({value} {unit}) alcanzaría el nivel {state} del motor de alertas en "
    "{days} día(s) ({date}){threshold}; regla {rule_code} v{version}. "
)
PREDICTION_THRESHOLD = "; umbral {threshold} {unit}"
PREDICTION_NOTE_IN_RANGE = "El último valor registrado sigue en rango normal."
PREDICTION_NOTE_NON_DIAGNOSTIC = (
    "Es una proyección exploratoria de la tendencia, no una medición ni un diagnóstico."
)
PREDICTION_IMMEDIATE_STEP = (
    "1. Tu último registro está en rango, pero la tendencia apunta fuera de él: sigue desde hoy la pauta "
    "preventiva de abajo y registra este indicador a diario para confirmarla."
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fmt(value: Optional[float]) -> str:
    return f"{round(float(value), 1):g}"


def upsert_prediction_alert(
    db: Session,
    astronaut_id: int,
    mission_id: Optional[int],
    result,
    is_simulated: bool = False,
) -> Tuple[Optional[Alert], bool]:
    """Crea o actualiza la alerta temprana de un `PredictionResult`. Devuelve (alerta, creada).

    `is_simulated`: el pronóstico pudo usar mediciones simuladas (`include_simulated=True`).
    Sin alerta si el pronóstico no es fiable, si el cruce solo lo toca la banda (no el valor esperado) o
    si el valor real ya está fuera de rango. No hace commit.
    """
    simulated = bool(is_simulated)
    if not mission_id or getattr(result, "status", None) != "ok":
        return None, False
    rec = result.recommendation or {}
    state = rec.get("state")
    if rec.get("basis") != "expected_crossing" or state not in PREDICTION_PRIORITY:
        return None, False
    indicator_code = result.indicator_code

    other_open = (
        db.query(Alert.id)
        .filter(
            Alert.astronaut_id == astronaut_id,
            Alert.indicator_code == indicator_code,
            Alert.rule_code != PREDICTION_RULE,
            Alert.status.in_(OPEN_ALERT_STATUSES),
        )
        .first()
    )
    if other_open is not None:
        return None, False

    rule, version = get_active_rule_version(db, indicator_code)
    if rule is None or version is None:
        return None, False
    defn = db.query(HealthIndicatorDefinition).filter(HealthIndicatorDefinition.code == indicator_code).first()
    name = defn.name if defn else indicator_code
    unit = result.unit or (defn.unit if defn else "")
    point = next((p for p in result.forecast if p.get("date") == rec.get("date")), None)
    if point is None:
        return None, False

    days = int(rec.get("days_ahead") or 0)
    threshold = rec.get("threshold")
    title = PREDICTION_TITLE.format(name=name, state=state, days=days)
    explanation = (
        PREDICTION_EXPLANATION.format(
            value=_fmt(point["value"]), unit=unit, state=state, days=days, date=rec.get("date"),
            threshold=PREDICTION_THRESHOLD.format(threshold=_fmt(threshold), unit=unit) if threshold is not None else "",
            rule_code=rule.rule_code, version=version.version_number,
        )
        + f"{PREDICTION_NOTE_IN_RANGE} {PREDICTION_NOTE_NON_DIAGNOSTIC}"
    )
    immediate = f"{PREDICTION_IMMEDIATE_STEP}\n{LEVEL_STEP['MONITOR']}"
    followup = (rec.get("text") or "").strip() or get_recommendation(indicator_code, rec.get("alert_direction")).followup
    now = _utcnow()
    priority = PREDICTION_PRIORITY[state]
    value = _fmt(point["value"])

    existing = find_open_alert(db, astronaut_id, indicator_code, PREDICTION_RULE)
    if existing is not None:
        if PRIORITY_RANK.get(priority, 0) > PRIORITY_RANK.get(existing.priority, 0):
            existing.priority = priority
        existing.rule_version_id = version.id
        existing.rule_version_label = version.version_number
        existing.value_recorded = value
        existing.unit = unit
        existing.title = title
        existing.explanation = explanation
        existing.immediate_action = immediate
        existing.followup_recommendation = followup
        existing.environment_code = result.environment_code
        existing.phase_code = result.phase_code
        existing.updated_at = now
        db.flush()
        return existing, False

    alert = Alert(
        astronaut_id=astronaut_id,
        mission_id=mission_id,
        indicator_code=indicator_code,
        measurement_id=None,
        rule_version_id=version.id,
        rule_code=PREDICTION_RULE,
        rule_version_label=version.version_number,
        value_recorded=value,
        unit=unit,
        priority=priority,
        operational_state="MONITOR",
        status="NEW",
        title=title,
        explanation=explanation,
        data_quality="SYNTHETIC_DEMO" if simulated else "VALIDATED",
        immediate_action=immediate,
        followup_recommendation=followup,
        environment_code=result.environment_code,
        phase_code=result.phase_code,
        is_simulated=simulated,
        created_at=now,
        updated_at=now,
    )
    db.add(alert)
    db.flush()
    return alert, True
