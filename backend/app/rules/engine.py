"""SEMSA · Reglas · Motor determinista de alertas (envoltorio con base de datos).

- `ContextResolver`: contexto operativo de la misión (sin cambios).
- `evaluate_measurement`: reúne el contexto de la persona en la BD (línea base, lectura anterior, ventana
  de sueño, dosis acumulada) y delega en la función pura `evaluation.evaluate_reading`.
- `upsert_alert_for_measurement`: una sola alerta abierta por astronauta + indicador + regla; una lectura
  anómala nueva actualiza la abierta en vez de crear otra.

Umbrales y procedencia: `calibration.py`. Recomendaciones: `recommendations.py`.
No es un dispositivo médico.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from backend.app.models.models import (
    Alert,
    ClinicalRule,
    ClinicalRuleVersion,
    DataQualityEvent,
    EnvironmentProfile,
    HealthBaseline,
    HealthIndicatorDefinition,
    HealthMeasurement,
    MissionContext,
)
from backend.app.rules.calibration import PERSISTENCE_WINDOW_HOURS, get_calibration
from backend.app.rules.evaluation import (
    STATE_RANK,
    Evaluation,
    PersonalBaseline,
    PreviousReading,
    RollingWindow,
    Thresholds,
    evaluate_reading,
    num,
    validity_reason,
)
from backend.app.rules.recommendations import HIGH, LOW, PERSONAL, SOURCE_CONFLICT, build_alert_texts

PRIORITY_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
ALERT_STATES = ("MONITOR", "WARNING", "CRITICAL")
OPEN_ALERT_STATUSES = ("NEW", "ACKNOWLEDGED", "IN_FOLLOWUP", "ESCALATED")
SOURCE_CONFLICT_WINDOW_SECONDS = 900
NON_DIAGNOSTIC_NOTE = (
    "Nota: Esta alerta es una señal operativa preventiva y no constituye un diagnóstico médico."
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class ContextResolver:
    """
    Determines the operational mission and environmental context from authorized sources:
    1. Verified telemetry / navigation data (if available)
    2. Mission / spacecraft / habitat identifier
    3. Manual confirmation by an authorized user
    4. Imported environmental dataset associated with a source
    5. Explicit simulation in Demo Mode

    Never uses phone GPS to infer off-Earth location. If no verifiable source exists,
    returns UNKNOWN_ENVIRONMENT ("Entorno no confirmado").
    """

    VALID_SOURCES = {
        "VERIFIED_TELEMETRY": ("HIGH", "Telemetría verificada de nave/hábitat"),
        "MISSION_ID": ("MEDIUM", "Identificador de misión asignada"),
        "MANUAL_CONFIRMATION": ("HIGH", "Confirmación manual por usuario autorizado"),
        "IMPORTED_ENV": ("MEDIUM", "Conjunto de datos ambientales importado"),
        "DEMO_SIMULATION": ("HIGH", "Simulación explícita (Modo DEMO)"),
    }

    @classmethod
    def resolve_active_context(
        cls,
        db: Session,
        mission_id: int,
        astronaut_id: Optional[int] = None,
    ) -> Dict[str, object]:
        query = db.query(MissionContext).filter(
            MissionContext.mission_id == mission_id,
            MissionContext.is_active.is_(True),
        )
        if astronaut_id is not None:
            personal_ctx = (
                query.filter(MissionContext.astronaut_id == astronaut_id)
                .order_by(MissionContext.recorded_at.desc())
                .first()
            )
            if personal_ctx:
                return cls._format_context(db, personal_ctx)

        mission_ctx = (
            query.filter(MissionContext.astronaut_id.is_(None))
            .order_by(MissionContext.recorded_at.desc())
            .first()
        )
        if mission_ctx:
            return cls._format_context(db, mission_ctx)

        unknown_profile = (
            db.query(EnvironmentProfile)
            .filter(EnvironmentProfile.code == "UNKNOWN_ENVIRONMENT")
            .first()
        )
        return {
            "environment_code": "UNKNOWN_ENVIRONMENT",
            "environment_name": unknown_profile.name if unknown_profile else "Entorno no confirmado",
            "phase_code": "UNKNOWN",
            "location_module": "Sin confirmar",
            "determination_source": "UNCONFIRMED",
            "source_label": "Entorno no confirmado (Sin telemetría ni confirmación manual)",
            "confidence": "UNCONFIRMED",
            "connectivity_status": "OFFLINE",
            "recorded_at": None,
            "age_minutes": None,
            "comms_delay_seconds": None,
            "conflict_notes": "No se encontró fuente verificada. Nunca se asume ubicación por GPS local.",
            "is_simulated": True,
            "clinical_thresholds_modified": False,
        }

    @classmethod
    def _format_context(cls, db: Session, ctx: MissionContext) -> Dict[str, object]:
        profile = (
            db.query(EnvironmentProfile)
            .filter(EnvironmentProfile.code == ctx.environment_code)
            .first()
        )
        rec_at = ensure_aware(ctx.recorded_at)
        age_minutes = (
            round((utcnow() - rec_at).total_seconds() / 60.0, 1) if rec_at else None
        )
        source_info = cls.VALID_SOURCES.get(
            ctx.determination_source,
            ("UNCONFIRMED", ctx.determination_source),
        )
        return {
            "id": ctx.id,
            "mission_id": ctx.mission_id,
            "astronaut_id": ctx.astronaut_id,
            "environment_code": ctx.environment_code,
            "environment_name": profile.name if profile else ctx.environment_code,
            "gravity_label": profile.gravity_label if profile else "N/A",
            "radiation_hazard_level": profile.radiation_hazard_level if profile else "UNKNOWN",
            "isolation_level": profile.isolation_level if profile else "UNKNOWN",
            "distance_from_earth_label": profile.distance_from_earth_label if profile else "N/A",
            "comms_delay_seconds": profile.comms_delay_seconds if profile else 0.0,
            "key_physiological_risks": profile.key_physiological_risks if profile else "",
            "preventive_focus": profile.preventive_focus if profile else "",
            "phase_code": ctx.phase_code,
            "location_module": ctx.location_module,
            "determination_source": ctx.determination_source,
            "source_label": source_info[1],
            "confidence": ctx.confidence,
            "connectivity_status": ctx.connectivity_status,
            "recorded_at": rec_at.isoformat() if rec_at else None,
            "age_minutes": age_minutes,
            "conflict_notes": ctx.conflict_notes,
            "is_simulated": ctx.is_simulated,
            "clinical_thresholds_modified": False,
        }



def get_active_rule_version(
    db: Session, indicator_code: str
) -> Tuple[Optional[ClinicalRule], Optional[ClinicalRuleVersion]]:
    rule = (
        db.query(ClinicalRule)
        .filter(
            ClinicalRule.indicator_code == indicator_code,
            ClinicalRule.is_active.is_(True),
        )
        .first()
    )
    if not rule:
        return None, None
    version = (
        db.query(ClinicalRuleVersion)
        .filter(
            ClinicalRuleVersion.rule_id == rule.id,
            ClinicalRuleVersion.is_current.is_(True),
        )
        .order_by(ClinicalRuleVersion.id.desc())
        .first()
    )
    return rule, version


@dataclass
class MeasurementEvaluation:
    """Resultado de evaluar una medición con el contexto de la BD."""

    state: str
    rule: Optional[ClinicalRule]
    version: Optional[ClinicalRuleVersion]
    reasons: List[str]
    detail: Optional[Evaluation] = None

    @property
    def direction(self) -> Optional[str]:
        return self.detail.direction if self.detail is not None else None

    def as_tuple(self) -> Tuple[str, Optional[ClinicalRule], Optional[ClinicalRuleVersion], List[str]]:
        return self.state, self.rule, self.version, self.reasons


def baseline_from_row(row: Optional[HealthBaseline]) -> Optional[PersonalBaseline]:
    if row is None:
        return None
    return PersonalBaseline(
        mean=row.baseline_value,
        sd=row.std_dev,
        secondary_mean=row.baseline_secondary_value,
        is_simulated=bool(row.is_simulated),
    )


def _utc(dt: datetime) -> datetime:
    return (ensure_aware(dt) or utcnow()).astimezone(timezone.utc)


def _valid_rows_query(db: Session, astronaut_id: int, indicator_code: str):
    return db.query(HealthMeasurement).filter(
        HealthMeasurement.astronaut_id == astronaut_id,
        HealthMeasurement.indicator_code == indicator_code,
        HealthMeasurement.calculated_state != "INVALID",
    )


def _previous_row(db: Session, astronaut_id: int, indicator_code: str, meas_dt: datetime) -> Optional[HealthMeasurement]:
    """Última lectura válida del indicador anterior (o simultánea) a `meas_dt`."""
    return (
        _valid_rows_query(db, astronaut_id, indicator_code)
        .filter(HealthMeasurement.measured_at <= meas_dt)
        .order_by(HealthMeasurement.measured_at.desc(), HealthMeasurement.id.desc())
        .first()
    )


def _rolling_window(
    db: Session, astronaut_id: int, indicator_code: str, meas_dt: datetime, value: float, days: int
) -> RollingWindow:
    """Media de las lecturas de los últimos `days` días, incluida la que se evalúa."""
    rows = (
        _valid_rows_query(db, astronaut_id, indicator_code)
        .filter(
            HealthMeasurement.measured_at > meas_dt - timedelta(days=days),
            HealthMeasurement.measured_at <= meas_dt,
        )
        .all()
    )
    values = [r.value for r in rows] + [value]
    return RollingWindow(mean=sum(values) / len(values), count=len(values))


def _cumulative_dose(db: Session, astronaut_id: int, indicator_code: str, meas_dt: datetime, value: float) -> float:
    """Suma de las dosis diarias registradas (la última lectura de cada día UTC). Los días sin registro
    no se imputan, así que es un mínimo de la dosis real."""
    rows = (
        _valid_rows_query(db, astronaut_id, indicator_code)
        .filter(HealthMeasurement.measured_at <= meas_dt)
        .order_by(HealthMeasurement.measured_at.asc(), HealthMeasurement.id.asc())
        .all()
    )
    by_day: Dict[object, float] = {}
    for r in rows:
        by_day[_utc(r.measured_at).date()] = r.value
    by_day[meas_dt.date()] = value
    return float(sum(by_day.values()))


def evaluate_measurement(
    db: Session,
    definition: HealthIndicatorDefinition,
    astronaut_id: int,
    mission_id: int,
    value: float,
    secondary_value: Optional[float],
    measured_at: datetime,
    source_code: str,
) -> MeasurementEvaluation:
    """
    Evalúa una medición de forma determinista (sin IA) con el contexto de la persona.
    Estados: NORMAL, MONITOR, WARNING, CRITICAL, UNKNOWN, INVALID.

    STALE ya no se guarda como estado de la medición: es una propiedad de la antigüedad del último dato
    y la calcula el resumen de salud al consultarlo (router.get_health_summary). Guardarlo dejaba como
    STALE casi todas las cargas históricas.
    """
    meas_dt = _utc(measured_at)

    # 1. Límites físicos de validación
    invalid = validity_reason(
        definition.code, value, secondary_value, definition.unit,
        definition.min_valid_value, definition.max_valid_value,
    )
    if invalid:
        db.add(
            DataQualityEvent(
                astronaut_id=astronaut_id,
                mission_id=mission_id,
                indicator_code=definition.code,
                event_type="OUT_OF_BOUNDS",
                severity="WARNING",
                details=invalid,
            )
        )
        return MeasurementEvaluation("INVALID", None, None, [invalid])

    # 2. Versión de regla activa
    rule, version = get_active_rule_version(db, definition.code)
    if not rule or not version:
        return MeasurementEvaluation(
            "UNKNOWN", None, None, ["No existe versión de regla activa configurada para este indicador."]
        )

    # 3. Contexto personal
    cal = get_calibration(definition.code)
    baseline_row = (
        db.query(HealthBaseline)
        .filter(
            HealthBaseline.astronaut_id == astronaut_id,
            HealthBaseline.indicator_code == definition.code,
        )
        .first()
    )
    prev_row = _previous_row(db, astronaut_id, definition.code, meas_dt)
    prev_dt = _utc(prev_row.measured_at) if prev_row is not None else None
    previous = None
    if prev_row is not None and (meas_dt - prev_dt).total_seconds() <= PERSISTENCE_WINDOW_HOURS * 3600:
        previous = PreviousReading(value=prev_row.value, secondary_value=prev_row.secondary_value)
    window = None
    if cal is not None and cal.rolling_days:
        window = _rolling_window(db, astronaut_id, definition.code, meas_dt, value, cal.rolling_days)
    cumulative = None
    if definition.code == "RADIATION_EXPOSURE":
        cumulative = _cumulative_dose(db, astronaut_id, definition.code, meas_dt, value)

    # 4. Evaluación pura (umbral absoluto + desvío personal)
    detail = evaluate_reading(
        definition.code,
        value,
        secondary_value,
        Thresholds.from_version(version),
        unit=definition.unit,
        baseline=baseline_from_row(baseline_row),
        previous=previous,
        window=window,
        cumulative=cumulative,
        rule_label=f"{rule.rule_code} ({version.version_number})",
    )
    state, reasons = detail.state, list(detail.reasons)

    # 5. Calidad de datos: dos fuentes distintas que discrepan en pocos minutos
    tolerance = version.baseline_delta_threshold
    if (
        prev_row is not None
        and tolerance
        and prev_row.source_code != source_code
        and abs((meas_dt - prev_dt).total_seconds()) <= SOURCE_CONFLICT_WINDOW_SECONDS
        and abs(value - prev_row.value) >= tolerance
    ):
        db.add(
            DataQualityEvent(
                astronaut_id=astronaut_id,
                mission_id=mission_id,
                indicator_code=definition.code,
                event_type="SOURCE_CONFLICT",
                severity="WARNING",
                details=(
                    f"Discrepancia detectada entre fuentes ({source_code}: {num(value)} vs "
                    f"{prev_row.source_code}: {num(prev_row.value)} {definition.unit}) en ventana <15 min."
                ),
            )
        )
        reasons.append(
            f"Contradicción entre fuentes ({source_code} vs {prev_row.source_code}); se recomienda confirmar medición."
        )
        if state == "NORMAL":
            state = "MONITOR"
            detail.state, detail.direction = "MONITOR", SOURCE_CONFLICT

    # 6. Antigüedad: se informa, pero no cambia el estado de la medición
    age_hours = (utcnow() - meas_dt).total_seconds() / 3600.0
    if age_hours > definition.stale_after_hours:
        reasons.append(
            f"Medición con antigüedad superior a {definition.stale_after_hours} h ({age_hours:.1f} h)."
        )

    return MeasurementEvaluation(state, rule, version, reasons, detail)


def compute_measurement_state(
    db: Session,
    definition: HealthIndicatorDefinition,
    astronaut_id: int,
    mission_id: int,
    value: float,
    secondary_value: Optional[float],
    measured_at: datetime,
    source_code: str,
) -> Tuple[str, Optional[ClinicalRule], Optional[ClinicalRuleVersion], List[str]]:
    """Compatibilidad: devuelve (estado, regla, versión, motivos). Ver `evaluate_measurement`."""
    return evaluate_measurement(
        db, definition, astronaut_id, mission_id, value, secondary_value, measured_at, source_code
    ).as_tuple()


def _direction_from_thresholds(measurement: HealthMeasurement, version: ClinicalRuleVersion) -> str:
    if measurement.value > version.normal_max:
        return HIGH
    if measurement.value < version.normal_min:
        return LOW
    return PERSONAL


def find_open_alert(db: Session, astronaut_id: int, indicator_code: str, rule_code: str) -> Optional[Alert]:
    """La alerta abierta (sin resolver) más reciente de ese astronauta, indicador y regla."""
    return (
        db.query(Alert)
        .filter(
            Alert.astronaut_id == astronaut_id,
            Alert.indicator_code == indicator_code,
            Alert.rule_code == rule_code,
            Alert.status.in_(OPEN_ALERT_STATUSES),
        )
        .order_by(Alert.created_at.desc(), Alert.id.desc())
        .first()
    )


def upsert_alert_for_measurement(
    db: Session,
    measurement: HealthMeasurement,
    definition: HealthIndicatorDefinition,
    evaluation: MeasurementEvaluation,
    created_at: Optional[datetime] = None,
) -> Tuple[Optional[Alert], bool]:
    """
    Crea la alerta de una medición anómala o actualiza la que ya está abierta para ese astronauta,
    indicador y regla. Devuelve (alerta, creada). Sin alerta si el estado no es MONITOR/WARNING/CRITICAL.

    Al actualizar: último valor, motivos y recomendación de la lectura nueva; el nivel y la prioridad solo
    suben (una lectura menos grave no rebaja una alerta abierta: la cierra una persona). Si la alerta sube
    a CRITICAL pasa a ESCALATED, igual que una alerta crítica nueva. El resto del ciclo de vida
    (ACKNOWLEDGED / IN_FOLLOWUP / RESOLVED) no se toca.
    """
    new_state = measurement.calculated_state
    rule, version = evaluation.rule, evaluation.version
    if new_state not in ALERT_STATES or not rule or not version:
        return None, False

    direction = evaluation.direction or _direction_from_thresholds(measurement, version)
    val_str = f"{measurement.value:g}"
    if measurement.secondary_value is not None:
        val_str = f"{measurement.value:g}/{measurement.secondary_value:g}"
    now = utcnow()

    def priority_for(state: str) -> str:
        if state == "CRITICAL":
            return version.priority_on_critical or "CRITICAL"
        if state == "WARNING":
            return version.priority_on_warning or "HIGH"
        return "LOW"

    def explanation_for(alert_state: str) -> str:
        parts = list(evaluation.reasons)
        if alert_state != new_state:
            parts.append(
                f"Última lectura en nivel {new_state}; la alerta se mantiene en {alert_state} hasta que se resuelva."
            )
        return " ".join(parts) + (
            f" (Regla: {rule.rule_code} v{version.version_number} — {version.protocol_source}). "
            + NON_DIAGNOSTIC_NOTE
        )

    existing = find_open_alert(db, measurement.astronaut_id, definition.code, rule.rule_code)
    if existing is not None:
        worse = STATE_RANK[new_state] > STATE_RANK.get(existing.operational_state, 0)
        linked = (
            db.query(HealthMeasurement).filter(HealthMeasurement.id == existing.measurement_id).first()
            if existing.measurement_id
            else None
        )
        newer = linked is None or _utc(measurement.measured_at) >= _utc(linked.measured_at)
        if not (worse or newer):
            return existing, False  # lectura antigua y no más grave: la alerta ya refleja algo posterior
        if worse:
            existing.operational_state = new_state
            new_priority = priority_for(new_state)
            if PRIORITY_RANK.get(new_priority, 0) > PRIORITY_RANK.get(existing.priority, 0):
                existing.priority = new_priority
            if new_state == "CRITICAL":
                existing.status = "ESCALATED"
        alert_state = existing.operational_state
        immediate, followup = build_alert_texts(definition.code, direction, alert_state)
        existing.measurement_id = measurement.id
        existing.rule_version_id = version.id
        existing.rule_version_label = version.version_number
        existing.value_recorded = val_str
        existing.unit = measurement.unit
        existing.title = f"[{alert_state}] {definition.name}: {val_str} {measurement.unit}"
        existing.explanation = explanation_for(alert_state)
        existing.data_quality = measurement.data_quality
        existing.immediate_action = immediate
        existing.followup_recommendation = followup
        existing.environment_code = measurement.environment_code
        existing.phase_code = measurement.phase_code
        existing.is_simulated = bool(existing.is_simulated and measurement.is_simulated)
        existing.updated_at = now
        db.flush()
        _retire_prediction_alert(db, measurement.astronaut_id, definition.code, now)
        return existing, False

    immediate, followup = build_alert_texts(definition.code, direction, new_state)
    alert = Alert(
        astronaut_id=measurement.astronaut_id,
        mission_id=measurement.mission_id,
        indicator_code=definition.code,
        measurement_id=measurement.id,
        rule_version_id=version.id,
        rule_code=rule.rule_code,
        rule_version_label=version.version_number,
        value_recorded=val_str,
        unit=measurement.unit,
        priority=priority_for(new_state),
        operational_state=new_state,
        status="ESCALATED" if new_state == "CRITICAL" else "NEW",
        title=f"[{new_state}] {definition.name}: {val_str} {measurement.unit}",
        explanation=explanation_for(new_state),
        data_quality=measurement.data_quality,
        immediate_action=immediate,
        followup_recommendation=followup,
        environment_code=measurement.environment_code,
        phase_code=measurement.phase_code,
        is_simulated=measurement.is_simulated,
        created_at=created_at or now,
        updated_at=created_at or now,
    )
    db.add(alert)
    db.flush()
    _retire_prediction_alert(db, measurement.astronaut_id, definition.code, now)
    return alert, True


def _retire_prediction_alert(db: Session, astronaut_id: int, indicator_code: str, now: datetime) -> None:
    """La alerta real sustituye al aviso temprano del pronóstico (issue #30): se retira con nota de sistema."""
    # Import diferido: prediction_alerts importa de este módulo
    from backend.app.rules.prediction_alerts import PREDICTION_RESOLVED_REAL_ALERT, resolve_prediction_alerts

    resolve_prediction_alerts(db, astronaut_id, indicator_code, PREDICTION_RESOLVED_REAL_ALERT, now)


def create_alert_if_needed(
    db: Session,
    measurement: HealthMeasurement,
    definition: HealthIndicatorDefinition,
    rule: Optional[ClinicalRule],
    version: Optional[ClinicalRuleVersion],
    reasons: List[str],
) -> Optional[Alert]:
    """Compatibilidad: crea o actualiza la alerta abierta. Ver `upsert_alert_for_measurement`."""
    alert, _created = upsert_alert_for_measurement(
        db, measurement, definition, MeasurementEvaluation(measurement.calculated_state, rule, version, reasons)
    )
    return alert
