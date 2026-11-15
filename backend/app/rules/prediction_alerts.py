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
- Se retira sola (RESOLVED con una nota de sistema en su seguimiento; nunca se borra) cuando un pronóstico
  fiable ya no cruza ningún umbral, cuando los datos están desfasados (último dato de hace más de
  `STALE_DATA_DAYS` días o fecha de cruce ya pasada) y cuando el motor de reglas abre una alerta real del
  mismo astronauta e indicador (`rules/engine.py::upsert_alert_for_measurement`).
- Solo se crea, actualiza o retira desde el flujo de escritura `POST /health/measurements`
  (`api/v1/router.py::_refresh_prediction_alert`); `GET /predictions/...` es de solo lectura.
- Nunca es CRITICAL ni se escala: es una proyección exploratoria (estado operativo MONITOR); la prioridad
  refleja el nivel proyectado.
- Recomendación propia: paso 1 fijo del pronóstico + paso del nivel de observación; el seguimiento es la
  pauta del catálogo de recomendaciones para el indicador y la dirección del cruce (la misma que muestra
  la vista de Predicciones). Los textos fijos tienen traducción EN en `frontend/src/i18n/backend-en-runtime.js`.
- Privacidad: solo indicador, valor esperado, umbral, fecha y regla (los mismos datos que una alerta del
  motor de reglas); nada de notas ni respuestas de bienestar.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.app.models.models import Alert, FollowUpAction, HealthIndicatorDefinition
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


# Retirada automática (nota de sistema en el seguimiento de la alerta)
STALE_DATA_DAYS = 7
SYSTEM_AUTHOR_ROLE = "SYSTEM"
PREDICTION_RESOLVED_NO_CROSSING = (
    "Retirada automáticamente: el pronóstico actualizado ya no prevé que el valor esperado cruce un umbral "
    "del motor de alertas."
)
PREDICTION_RESOLVED_STALE = (
    "Retirada automáticamente: el pronóstico se basa en datos desfasados (último registro de hace más de "
    "7 días o fecha de cruce ya pasada). Registra el indicador para obtener un pronóstico actual."
)
PREDICTION_RESOLVED_REAL_ALERT = (
    "Retirada automáticamente: una medición real de este indicador abrió una alerta del motor de reglas, "
    "que sustituye a este aviso temprano."
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fmt(value: Optional[float]) -> str:
    return f"{round(float(value), 1):g}"


def _parse_date(value) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def last_data_date(result) -> Optional[date]:
    """Día del último dato real del pronóstico: el primer día pronosticado menos sus días de adelanto."""
    rec = getattr(result, "recommendation", None) or {}
    for point in getattr(result, "forecast", None) or []:
        day = _parse_date(point.get("date"))
        ahead = point.get("t_ahead")
        if ahead is None and point.get("date") == rec.get("date"):
            ahead = rec.get("days_ahead")
        if day is not None and ahead is not None:
            return day - timedelta(days=int(ahead))
    return None


def open_prediction_alerts(db: Session, astronaut_id: int, indicator_code: str) -> List[Alert]:
    return (
        db.query(Alert)
        .filter(
            Alert.astronaut_id == astronaut_id,
            Alert.indicator_code == indicator_code,
            Alert.rule_code == PREDICTION_RULE,
            Alert.status.in_(OPEN_ALERT_STATUSES),
        )
        .all()
    )


def resolve_prediction_alerts(
    db: Session, astronaut_id: int, indicator_code: str, note: str, now: Optional[datetime] = None
) -> int:
    """Retira (RESOLVED, sin borrar) las alertas tempranas abiertas de ese astronauta e indicador y deja la
    nota de sistema en su seguimiento. Devuelve cuántas. No hace commit."""
    now = now or _utcnow()
    alerts = open_prediction_alerts(db, astronaut_id, indicator_code)
    for alert in alerts:
        alert.status = "RESOLVED"
        alert.updated_at = now
        db.add(FollowUpAction(
            alert_id=alert.id,
            # La columna es obligatoria: se usa el propio astronauta; author_role marca que es del sistema
            author_user_id=alert.astronaut_id,
            author_role=SYSTEM_AUTHOR_ROLE,
            action_type="RESOLVED",
            notes=note,
            created_at=now,
        ))
    if alerts:
        db.flush()
    return len(alerts)


def upsert_prediction_alert(
    db: Session,
    astronaut_id: int,
    mission_id: Optional[int],
    result,
    is_simulated: bool = False,
    now: Optional[datetime] = None,
) -> Tuple[Optional[Alert], bool]:
    """Crea, actualiza o retira la alerta temprana de un `PredictionResult`. Devuelve (alerta, creada).

    `is_simulated`: el pronóstico pudo usar mediciones simuladas (`include_simulated=True`).
    Sin alerta si el pronóstico no es fiable, si el cruce solo lo toca la banda (no el valor esperado), si
    el valor real ya está fuera de rango o si los datos están desfasados. Con un pronóstico fiable que ya no
    cruza, con datos desfasados o con una alerta real abierta, retira la temprana que estuviera abierta.
    Un pronóstico no fiable (`status != ok`) no decide nada: ni crea ni retira. No hace commit.
    """
    simulated = bool(is_simulated)
    now = now or _utcnow()
    if not mission_id or getattr(result, "status", None) != "ok":
        return None, False
    indicator_code = result.indicator_code
    rec = result.recommendation or {}
    state = rec.get("state")

    # Datos desfasados: último dato de hace más de STALE_DATA_DAYS días o fecha de cruce ya pasada (UTC)
    today = (now.astimezone(timezone.utc) if now.tzinfo else now).date()
    last = last_data_date(result)
    crossing = _parse_date(rec.get("date"))
    stale = last is not None and (today - last).days > STALE_DATA_DAYS
    past_crossing = rec.get("basis") == "expected_crossing" and crossing is not None and crossing < today
    if stale or past_crossing:
        resolve_prediction_alerts(db, astronaut_id, indicator_code, PREDICTION_RESOLVED_STALE, now)
        return None, False

    if rec.get("basis") != "expected_crossing" or state not in PREDICTION_PRIORITY:
        resolve_prediction_alerts(db, astronaut_id, indicator_code, PREDICTION_RESOLVED_NO_CROSSING, now)
        return None, False

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
        resolve_prediction_alerts(db, astronaut_id, indicator_code, PREDICTION_RESOLVED_REAL_ALERT, now)
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
        # Refleja los datos del último pronóstico (puede pasar de simulado a real y al revés)
        existing.is_simulated = simulated
        existing.data_quality = "SYNTHETIC_DEMO" if simulated else "VALIDATED"
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
