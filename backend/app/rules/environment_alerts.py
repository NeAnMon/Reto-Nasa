"""SEMSA · Reglas · Alertas del entorno y la radiación ambiental de la misión (issue #30).

Las mediciones ambientales (`POST /environment/measurements`) se guardaban siempre como NORMAL y no generaban
alertas. Este módulo evalúa los parámetros con umbral conocido y, si salen del rango normal, crea una alerta
para cada astronauta asignado a la misión (el entorno es compartido por la tripulación).

- Regla `RULE_ENVIRONMENT_<PARÁMETRO>` (motor ENVIRONMENT, ver `rules/alert_sources.py`).
- Estados como en el motor de reglas: fuera del rango normal → MONITOR (aviso temprano), fuera del de
  seguimiento → WARNING, fuera del de alerta → CRITICAL.
- RADIATION_DOSE (tasa de dosis ambiental, mSv/día) usa los cortes de dosis diaria de la regla calibrada
  RADIATION_EXPOSURE (versión activa del motor; si no existe, la calibración). El resto de cortes son de
  demostración, tomados de NASA-STD-3001 Vol. 2 y de los límites SMAC de la NASA, sin validación clínica.
- Una sola alerta abierta por astronauta + parámetro + regla: si ya hay una se actualiza (el nivel y la
  prioridad solo suben, igual que el motor de reglas).
- Recomendación propia por parámetro y dirección (paso 1 + paso del nivel; seguimiento). Textos fijos con
  traducción EN en `frontend/src/i18n/backend-en-runtime.js`.
- Privacidad: solo datos del hábitat (parámetro, valor, rango); ningún dato personal del astronauta.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.app.models.models import Alert, EnvironmentalMeasurement, MissionAssignment
from backend.app.rules.calibration import get_calibration
from backend.app.rules.engine import PRIORITY_RANK, find_open_alert, get_active_rule_version
from backend.app.rules.evaluation import STATE_RANK, Thresholds
from backend.app.rules.recommendations import HIGH, LEVEL_STEP, LOW

ENVIRONMENT_RULE_PREFIX = "RULE_ENVIRONMENT_"
ENVIRONMENT_RULE_VERSION = "1.0-DEMO"
ENVIRONMENT_PRIORITY = {"MONITOR": "LOW", "WARNING": "HIGH", "CRITICAL": "CRITICAL"}


@dataclass(frozen=True)
class EnvironmentLimit:
    unit: str
    thresholds: Thresholds
    source: str


def _th(normal, monitor, warning) -> Thresholds:
    return Thresholds(
        normal_min=normal[0], normal_max=normal[1], monitor_min=monitor[0], monitor_max=monitor[1],
        warning_min=warning[0], warning_max=warning[1],
    )


SRC_STD3001 = "NASA-STD-3001 Vol. 2 (atmósfera del hábitat); cortes de demostración del equipo, sin validación clínica"
SRC_SMAC = "límites SMAC de la NASA para CO₂ y NASA-STD-3001 Vol. 2; cortes de demostración del equipo"
SRC_RADIATION = "cortes de dosis diaria de la regla calibrada RADIATION_EXPOSURE del motor de alertas"

ENVIRONMENT_LIMITS: Dict[str, EnvironmentLimit] = {
    "CO2_LEVEL": EnvironmentLimit("mmHg", _th((0.0, 2.5), (0.0, 4.0), (0.0, 7.6)), SRC_SMAC),
    "PPO2": EnvironmentLimit("kPa", _th((19.5, 25.0), (18.0, 27.0), (16.0, 30.0)), SRC_STD3001),
    "CABIN_TEMP": EnvironmentLimit("°C", _th((18.0, 27.0), (16.0, 29.0), (13.0, 32.0)), SRC_STD3001),
    "HUMIDITY": EnvironmentLimit("%", _th((25.0, 70.0), (20.0, 75.0), (10.0, 85.0)), SRC_STD3001),
}
RADIATION_PARAMETER = "RADIATION_DOSE"
RADIATION_UNIT = "mSv/día"

# Nombre canónico de cada parámetro con umbral: el título de la alerta nunca lleva el texto libre que envía
# el cliente (`parameter_name`), porque llega a toda la tripulación.
ENVIRONMENT_PARAMETER_NAMES: Dict[str, str] = {
    "CO2_LEVEL": "Concentración de CO₂",
    "PPO2": "Presión Parcial de Oxígeno (ppO₂)",
    "CABIN_TEMP": "Temperatura Ambiental de Cabina",
    "HUMIDITY": "Humedad Relativa",
    RADIATION_PARAMETER: "Tasa de Radiación Ambiental",
}

# Recomendación por parámetro × dirección: (paso 1 de la acción inmediata, seguimiento)
ENVIRONMENT_RECOMMENDATIONS: Dict[Tuple[str, str], Tuple[str, str]] = {
    ("CO2_LEVEL", HIGH): (
        "1. Comprueba el flujo de ventilación de tu módulo y evita el ejercicio intenso hasta que el CO₂ baje; "
        "si notas dolor de cabeza o somnolencia, avísalo.",
        "Revisa con el equipo de soporte vital el depurador de CO₂ y la circulación de aire de los módulos ocupados. "
        "Avisa al médico de vuelo si aparecen dolor de cabeza, mareo o falta de concentración. "
        "Fuente: límites SMAC de la NASA para CO₂ y NASA-STD-3001 Vol. 2.",
    ),
    ("PPO2", LOW): (
        "1. Reduce el esfuerzo físico y comprueba tu SpO₂; si baja o notas falta de aire, avisa de inmediato.",
        "Revisa con el equipo de soporte vital el aporte de oxígeno del hábitat y repite la medición ambiental. "
        "Avisa al médico de vuelo si la SpO₂ de algún tripulante baja de su rango habitual. "
        "Fuente: NASA-STD-3001 Vol. 2.",
    ),
    ("PPO2", HIGH): (
        "1. Evita fuentes de ignición y comprueba con soporte vital el ajuste del aporte de oxígeno.",
        "Revisa el control de presión parcial de oxígeno del hábitat y repite la medición ambiental. "
        "Avisa al médico de vuelo si alguien nota irritación en el pecho o tos. Fuente: NASA-STD-3001 Vol. 2.",
    ),
    ("CABIN_TEMP", HIGH): (
        "1. Hidrátate, reduce el esfuerzo y usa ropa ligera mientras se ajusta el control térmico.",
        "Revisa con soporte vital el control térmico del módulo y planifica el ejercicio en las horas más frescas. "
        "Avisa al médico de vuelo si aparecen mareo o cansancio inusual. Fuente: NASA-STD-3001 Vol. 2.",
    ),
    ("CABIN_TEMP", LOW): (
        "1. Abrígate con capas y mantente activo de forma suave mientras se ajusta el control térmico.",
        "Revisa con soporte vital el control térmico del módulo y vigila el confort durante el descanso. "
        "Avisa al médico de vuelo si aparecen temblores o entumecimiento. Fuente: NASA-STD-3001 Vol. 2.",
    ),
    ("HUMIDITY", HIGH): (
        "1. Comprueba la ventilación del módulo y retira toallas o ropa húmeda de las zonas cerradas.",
        "Revisa con soporte vital el control de humedad y la condensación en superficies frías para evitar moho. "
        "Avisa al médico de vuelo si aparecen molestias respiratorias. Fuente: NASA-STD-3001 Vol. 2.",
    ),
    ("HUMIDITY", LOW): (
        "1. Bebe agua con regularidad y usa lubricante ocular o nasal si notas sequedad.",
        "Revisa con soporte vital el control de humedad del hábitat. "
        "Avisa al médico de vuelo si la sequedad causa sangrado nasal o irritación ocular. Fuente: NASA-STD-3001 Vol. 2.",
    ),
    (RADIATION_PARAMETER, HIGH): (
        "1. Limita el tiempo fuera de las zonas más blindadas del hábitat y revisa tu dosímetro personal.",
        "Sigue los avisos de meteorología espacial, planifica las actividades extravehiculares fuera de los picos "
        "y registra tu dosis personal a diario. Avisa al médico de vuelo si tu dosis personal supera los cortes "
        "del motor de alertas. Fuente: regla calibrada RADIATION_EXPOSURE (NASA HRP).",
    ),
}

ENVIRONMENT_TITLE = "[{state}] Entorno de la misión · {name}: {value} {unit}"
ENVIRONMENT_EXPLANATION = (
    "Alerta ambiental de la misión ({code}): valor {value} {unit} {side} del rango normal "
    "[{low} - {high}]; nivel {state} ({source}). "
)
ENVIRONMENT_SIDE = {HIGH: "por encima", LOW: "por debajo"}
ENVIRONMENT_NOTE_CREW = (
    "El entorno es compartido: la alerta se genera para cada astronauta asignado a la misión y no incluye "
    "datos personales."
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fmt(value: float) -> str:
    return f"{round(float(value), 2):g}"


def environment_limit(db: Session, parameter_code: str) -> Optional[EnvironmentLimit]:
    if parameter_code == RADIATION_PARAMETER:
        _rule, version = get_active_rule_version(db, "RADIATION_EXPOSURE")
        if version is not None:
            return EnvironmentLimit(RADIATION_UNIT, Thresholds.from_version(version), SRC_RADIATION)
        cal = get_calibration("RADIATION_EXPOSURE")
        return EnvironmentLimit(RADIATION_UNIT, Thresholds.from_calibration(cal), SRC_RADIATION) if cal else None
    return ENVIRONMENT_LIMITS.get(parameter_code)


def evaluate_environment(limit: EnvironmentLimit, value: float) -> Tuple[str, Optional[str]]:
    """(estado, dirección) de un valor ambiental: NORMAL / MONITOR / WARNING / CRITICAL y HIGH / LOW."""
    th = limit.thresholds
    if th.normal_min <= value <= th.normal_max:
        return "NORMAL", None
    direction = HIGH if value > th.normal_max else LOW
    if th.monitor_min <= value <= th.monitor_max:
        return "MONITOR", direction
    if th.warning_min <= value <= th.warning_max:
        return "WARNING", direction
    return "CRITICAL", direction


def environment_texts(parameter_code: str, direction: str, state: str) -> Tuple[str, str]:
    step, followup = ENVIRONMENT_RECOMMENDATIONS.get(
        (parameter_code, direction),
        ENVIRONMENT_RECOMMENDATIONS.get((parameter_code, HIGH), ENVIRONMENT_RECOMMENDATIONS[("CO2_LEVEL", HIGH)]),
    )
    return f"{step}\n{LEVEL_STEP.get(state, LEVEL_STEP['MONITOR'])}", followup


def evaluate_and_alert_environment(db: Session, em: EnvironmentalMeasurement) -> List[Alert]:
    """Calcula el estado de la medición ambiental y crea/actualiza las alertas de la tripulación.

    Devuelve las alertas creadas o actualizadas. Sin umbral para el parámetro, sin valor o con otra unidad,
    la medición conserva su estado y no se alerta. No hace commit.
    """
    limit = environment_limit(db, em.parameter_code)
    if limit is None or em.value is None or not isfinite(float(em.value)) or (em.unit or "").strip() != limit.unit:
        return []
    state, direction = evaluate_environment(limit, float(em.value))
    em.calculated_state = state
    if state == "NORMAL":
        return []

    rule_code = f"{ENVIRONMENT_RULE_PREFIX}{em.parameter_code}"[:80]
    version_label = ENVIRONMENT_RULE_VERSION
    rule_version_id = None
    if em.parameter_code == RADIATION_PARAMETER:
        _rule, version = get_active_rule_version(db, "RADIATION_EXPOSURE")
        if version is not None:
            version_label, rule_version_id = version.version_number, version.id

    th = limit.thresholds
    value = _fmt(em.value)
    name = ENVIRONMENT_PARAMETER_NAMES.get(em.parameter_code, em.parameter_code)
    title = ENVIRONMENT_TITLE.format(state=state, name=name, value=value, unit=em.unit)
    explanation = ENVIRONMENT_EXPLANATION.format(
        code=em.parameter_code, value=value, unit=em.unit, side=ENVIRONMENT_SIDE[direction],
        low=_fmt(th.normal_min), high=_fmt(th.normal_max), state=state, source=limit.source,
    ) + ENVIRONMENT_NOTE_CREW
    immediate, followup = environment_texts(em.parameter_code, direction, state)
    priority = ENVIRONMENT_PRIORITY[state]
    now = _utcnow()

    crew = (
        db.query(MissionAssignment.user_id)
        .filter(
            MissionAssignment.mission_id == em.mission_id,
            MissionAssignment.assignment_role == "ASTRONAUT",
            MissionAssignment.is_active.is_(True),
        )
        .distinct()
        .all()
    )
    touched: List[Alert] = []
    for (astronaut_id,) in crew:
        existing = find_open_alert(db, astronaut_id, em.parameter_code, rule_code)
        if existing is not None:
            alert_state = state
            if STATE_RANK[state] > STATE_RANK.get(existing.operational_state, 0):
                existing.operational_state = state
                if PRIORITY_RANK[priority] > PRIORITY_RANK.get(existing.priority, 0):
                    existing.priority = priority
                if state == "CRITICAL":
                    existing.status = "ESCALATED"
            else:
                alert_state = existing.operational_state
            existing.title = ENVIRONMENT_TITLE.format(
                state=alert_state, name=name, value=value, unit=em.unit
            )
            existing.immediate_action, existing.followup_recommendation = environment_texts(
                em.parameter_code, direction, alert_state
            )
            existing.value_recorded = value
            existing.unit = em.unit
            existing.explanation = explanation
            existing.rule_version_id = rule_version_id
            existing.rule_version_label = version_label
            existing.data_quality = em.data_quality
            existing.environment_code = em.environment_code
            existing.phase_code = em.phase_code
            existing.is_simulated = bool(existing.is_simulated and em.is_simulated)
            existing.updated_at = now
            touched.append(existing)
            continue
        alert = Alert(
            astronaut_id=astronaut_id,
            mission_id=em.mission_id,
            indicator_code=em.parameter_code,
            measurement_id=None,
            rule_version_id=rule_version_id,
            rule_code=rule_code,
            rule_version_label=version_label,
            value_recorded=value,
            unit=em.unit,
            priority=priority,
            operational_state=state,
            status="ESCALATED" if state == "CRITICAL" else "NEW",
            title=title,
            explanation=explanation,
            data_quality=em.data_quality,
            immediate_action=immediate,
            followup_recommendation=followup,
            environment_code=em.environment_code,
            phase_code=em.phase_code,
            is_simulated=bool(em.is_simulated),
            created_at=now,
            updated_at=now,
        )
        db.add(alert)
        touched.append(alert)
    db.flush()
    return touched
