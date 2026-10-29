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
    """
    Evaluates a measurement deterministically without AI dependence.
    Returns (operational_state, rule, rule_version, reasons).
    States: NORMAL, MONITOR, WARNING, CRITICAL, UNKNOWN, STALE, INVALID
    """
    reasons: List[str] = []
    meas_dt = ensure_aware(measured_at) or utcnow()

    # 1. Validate quality bounds
    if value < definition.min_valid_value or value > definition.max_valid_value:
        reasons.append(
            f"Valor ({value} {definition.unit}) fuera de los límites físicos de validación "
            f"[{definition.min_valid_value} - {definition.max_valid_value}]."
        )
        dq = DataQualityEvent(
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            indicator_code=definition.code,
            event_type="OUT_OF_BOUNDS",
            severity="WARNING",
            details=reasons[-1],
        )
        db.add(dq)
        return "INVALID", None, None, reasons

    if definition.code == "BLOOD_PRESSURE" and secondary_value is not None:
        if secondary_value < 30 or secondary_value > 160 or secondary_value >= value:
            reasons.append(
                f"Presión diastólica ({secondary_value} mmHg) inválida respecto a sistólica ({value} mmHg)."
            )
            dq = DataQualityEvent(
                astronaut_id=astronaut_id,
                mission_id=mission_id,
                indicator_code=definition.code,
                event_type="OUT_OF_BOUNDS",
                severity="WARNING",
                details=reasons[-1],
            )
            db.add(dq)
            return "INVALID", None, None, reasons

    # 2. Check active rule version
    rule, version = get_active_rule_version(db, definition.code)
    if not rule or not version:
        reasons.append("No existe versión de regla activa configurada para este indicador.")
        return "UNKNOWN", None, None, reasons

    # 3. Check staleness if historical / delayed
    age_hours = (utcnow() - meas_dt).total_seconds() / 3600.0
    is_stale = age_hours > definition.stale_after_hours

    state = "NORMAL"

    # 4. Evaluate primary value against CRITICAL / WARNING / MONITOR / NORMAL limits
    if value < version.warning_min or value > version.warning_max:
        state = "CRITICAL"
        reasons.append(
            f"Valor {value} {definition.unit} supera el umbral crítico del protocolo "
            f"{rule.rule_code} ({version.version_number}) [{version.warning_min} - {version.warning_max}]."
        )
    elif value < version.monitor_min or value > version.monitor_max:
        state = "WARNING"
        reasons.append(
            f"Valor {value} {definition.unit} requiere seguimiento según protocolo "
            f"{rule.rule_code} ({version.version_number}) [{version.monitor_min} - {version.monitor_max}]."
        )
    elif value < version.normal_min or value > version.normal_max:
        state = "MONITOR"
        reasons.append(
            f"Valor {value} {definition.unit} fuera del rango habitual de referencia "
            f"[{version.normal_min} - {version.normal_max}]."
        )

    # Special handling for diastolic blood pressure
    if definition.code == "BLOOD_PRESSURE" and secondary_value is not None:
        if secondary_value >= 110 or secondary_value < 50:
            state = "CRITICAL"
            reasons.append(
                f"Presión diastólica ({secondary_value} mmHg) en rango crítico de protocolo DEMO."
            )
        elif (secondary_value >= 95 or secondary_value < 55) and state not in ("CRITICAL",):
            state = "WARNING"
            reasons.append(
                f"Presión diastólica ({secondary_value} mmHg) en rango de alerta de seguimiento."
            )
        elif (secondary_value >= 86 or secondary_value < 60) and state == "NORMAL":
            state = "MONITOR"
            reasons.append(
                f"Presión diastólica ({secondary_value} mmHg) en zona de observación."
            )

    # 5. Evaluate individual baseline deviation
    baseline = (
        db.query(HealthBaseline)
        .filter(
            HealthBaseline.astronaut_id == astronaut_id,
            HealthBaseline.indicator_code == definition.code,
        )
        .first()
    )
    if baseline and version.baseline_delta_threshold:
        delta = abs(value - baseline.baseline_value)
        if delta >= version.baseline_delta_threshold and state == "NORMAL":
            state = "MONITOR"
            reasons.append(
                f"Cambio significativo ({delta:.1f} {definition.unit}) respecto a la línea base "
                f"individual ({baseline.baseline_value} {definition.unit})."
            )

    # 6. Evaluate persistent trend or source contradiction across recent measurements
    recent_rows = (
        db.query(HealthMeasurement)
        .filter(
            HealthMeasurement.astronaut_id == astronaut_id,
            HealthMeasurement.indicator_code == definition.code,
            HealthMeasurement.calculated_state != "INVALID",
        )
        .order_by(HealthMeasurement.measured_at.desc())
        .limit(2)
        .all()
    )
    if len(recent_rows) == 2:
        v1 = recent_rows[0].value  # previous
        v2 = recent_rows[1].value  # two steps ago
        # Check contradiction if recorded within 15 minutes from a different source
        prev_dt = ensure_aware(recent_rows[0].measured_at)
        if (
            prev_dt
            and abs((meas_dt - prev_dt).total_seconds()) <= 900
            and recent_rows[0].source_code != source_code
            and version.baseline_delta_threshold
            and abs(value - v1) >= version.baseline_delta_threshold
        ):
            dq = DataQualityEvent(
                astronaut_id=astronaut_id,
                mission_id=mission_id,
                indicator_code=definition.code,
                event_type="SOURCE_CONFLICT",
                severity="WARNING",
                details=(
                    f"Discrepancia detectada entre fuentes ({source_code}: {value} vs "
                    f"{recent_rows[0].source_code}: {v1} {definition.unit}) en ventana <15 min."
                ),
            )
            db.add(dq)
            if state == "NORMAL":
                state = "MONITOR"
            reasons.append(
                f"Contradicción entre fuentes ({source_code} vs {recent_rows[0].source_code}); se recomienda confirmar medición."
            )

    if state == "NORMAL" and not reasons:
        reasons.append(
            f"Dentro de los límites operativos configurados [{version.normal_min} - {version.normal_max} {definition.unit}]."
        )

    if is_stale and state == "NORMAL":
        state = "STALE"
        reasons.append(
            f"Medición con antigüedad superior a {definition.stale_after_hours} h ({age_hours:.1f} h)."
        )

    return state, rule, version, reasons


def create_alert_if_needed(
    db: Session,
    measurement: HealthMeasurement,
    definition: HealthIndicatorDefinition,
    rule: Optional[ClinicalRule],
    version: Optional[ClinicalRuleVersion],
    reasons: List[str],
) -> Optional[Alert]:
    if measurement.calculated_state not in ("MONITOR", "WARNING", "CRITICAL"):
        return None
    if not rule or not version:
        return None

    if measurement.calculated_state == "CRITICAL":
        priority = version.priority_on_critical or "CRITICAL"
    elif measurement.calculated_state == "WARNING":
        priority = version.priority_on_warning or "HIGH"
    else:
        priority = "LOW"

    val_str = f"{measurement.value:g}"
    if measurement.secondary_value is not None:
        val_str = f"{measurement.value:g}/{measurement.secondary_value:g}"

    title = f"[{measurement.calculated_state}] {definition.name}: {val_str} {measurement.unit}"
    explanation = " ".join(reasons) + (
        f" (Regla: {rule.rule_code} v{version.version_number} — {version.protocol_source}). "
        "Nota: Esta alerta es una señal operativa preventiva y no constituye un diagnóstico médico."
    )

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
        priority=priority,
        operational_state=measurement.calculated_state,
        status="ESCALATED" if measurement.calculated_state == "CRITICAL" else "NEW",
        title=title,
        explanation=explanation,
        data_quality=measurement.data_quality,
        immediate_action=version.immediate_instructions,
        followup_recommendation=version.followup_instructions,
        environment_code=measurement.environment_code,
        phase_code=measurement.phase_code,
        is_simulated=measurement.is_simulated,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(alert)
    db.flush()
    return alert

