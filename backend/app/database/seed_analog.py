"""SEMSA · Seed · Misión análoga en tierra con signos vitales reales de NASA (reposo en cama, UTMB).

Origen: estudio de reposo en cama inclinada 6° con la cabeza abajo (head-down bed rest) de
la University of Texas Medical Branch, publicado por el NASA Life Sciences Portal (NLSP).
Case Report Form, doi:10.83263/wjw1-ta27. El reposo en cama es un análogo en tierra de la
microgravedad: NO son datos de vuelo espacial y la misión se rotula como análoga.

Qué se carga:
- `data/utmb_hdbr_vitals.csv`: una fila por sujeto y día (fase `pre` y `mision`) con pulso,
  presión sistólica/diastólica, frecuencia respiratoria y temperatura.
- `data/utmb_hdbr_baselines.csv`: media y desviación personal de la línea base previa al reposo.

Las fechas originales (2004–2006) se trasladan para que el día `CURRENT_BED_REST_DAY` del reposo
caiga en el día de hoy (UTC). Cada carga borra y vuelve a insertar las mediciones de esta fuente,
así la serie siempre termina hoy. Las mediciones son reales: `is_simulated=False` y
`data_quality="VALIDATED"`, por lo que el servicio de predicción las usa con el valor por defecto
de la API (`include_simulated=false`).

El estado de cada medición lo calcula la misma función pura que usa el motor de alertas
(`rules.evaluation.evaluate_reading`): umbral absoluto del dataset + desvío frente a la línea base
personal del sujeto (media y DE reales de su fase previa), con diastólica incluida. Las lecturas del
día de hoy dejan su alerta abierta con el mismo `upsert` que la API (una por indicador).
"""
from __future__ import annotations

import csv
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.models.models import (
    Alert,
    AstronautProfile,
    ClinicalRule,
    ClinicalRuleVersion,
    GamificationProfile,
    HealthBaseline,
    HealthIndicatorDefinition,
    HealthMeasurement,
    Mission,
    MissionAssignment,
    MissionPhase,
    Role,
    User,
)
from backend.app.rules.calibration import PERSISTENCE_WINDOW_HOURS
from backend.app.rules.engine import MeasurementEvaluation, upsert_alert_for_measurement
from backend.app.rules.evaluation import PersonalBaseline, PreviousReading, Thresholds, evaluate_reading
from backend.app.security.auth import hash_password

DATA_DIR = Path(__file__).resolve().parent / "data"
VITALS_CSV = DATA_DIR / "utmb_hdbr_vitals.csv"
BASELINES_CSV = DATA_DIR / "utmb_hdbr_baselines.csv"

MISSION_CODE = "UTMB-HDBR-ANALOG"
SOURCE_CODE = "NASA_UTMB_BEDREST"
PRE_PHASE, PRE_ENV = "TRAINING", "EARTH_SURFACE"
BED_REST_PHASE, BED_REST_ENV = "BED_REST", "HEAD_DOWN_BED_REST"

# Día del reposo que corresponde a "hoy". Deja una misión en curso con historia suficiente
# (≥10 días) para el pronóstico y días restantes por delante.
CURRENT_BED_REST_DAY = 45
MEASUREMENT_HOUR_UTC = 8

# Sujeto del dataset -> cuenta demo de la misión análoga. Elegidos porque, al día 45, el servicio
# de predicción da resultados distintos con sus datos reales:
# - UTMB-17: `ok` en los 4 indicadores; el pulso sube ~0,33 lpm/día durante el reposo (tendencia significativa).
# - UTMB-03: `ok` en los 4 indicadores; tendencia significativa pequeña en pulso y temperatura.
# - UTMB-29: `ok` en los 4 indicadores; pulso con tendencia significativa (~+0,27 lpm/día) y presión
#   arterial sin tendencia (pronóstico plano con bandas). Con el pronóstico calibrado ya no hay
#   ningún `model_not_reliable` en estas series: ese estado lo cubre test_prediction_service.py.
SUBJECTS: Dict[str, Dict[str, str]] = {
    "UTMB-17": {"crew_code": "HDBR-01", "email": "hdbr01@semsa.demo", "callsign": "Analog-1"},
    "UTMB-03": {"crew_code": "HDBR-02", "email": "hdbr02@semsa.demo", "callsign": "Analog-2"},
    "UTMB-29": {"crew_code": "HDBR-03", "email": "hdbr03@semsa.demo", "callsign": "Analog-3"},
}

# indicador -> (columna valor, columna secundaria)
INDICATOR_COLUMNS = {
    "HEART_RATE": ("pulso_lpm", None),
    "BLOOD_PRESSURE": ("pas_mmhg", "pad_mmhg"),
    "BODY_TEMP": ("temp_c", None),
    "RESP_RATE": ("resp_rpm", None),
}
# indicador -> (columna media, columna desviación, columna media secundaria)
BASELINE_COLUMNS = {
    "HEART_RATE": ("pulso_lpm_media", "pulso_lpm_de", None),
    "BLOOD_PRESSURE": ("pas_mmhg_media", "pas_mmhg_de", "pad_mmhg_media"),
    "BODY_TEMP": ("temp_c_media", "temp_c_de", None),
    "RESP_RATE": ("resp_rpm_media", "resp_rpm_de", None),
}


def _num(raw: str) -> Optional[float]:
    raw = (raw or "").strip()
    return float(raw) if raw else None


def _read_csv(path: Path, subjects: Iterable[str]) -> Dict[str, list]:
    wanted = set(subjects)
    rows: Dict[str, list] = {s: [] for s in wanted}
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["astronauta_id"] in wanted:
                rows[row["astronauta_id"]].append(row)
    return rows


def _personal_baseline(base: Optional[Dict[str, str]], code: str) -> Optional[PersonalBaseline]:
    """Línea base personal del sujeto tal como queda en `health_baselines` (media, DE y media secundaria)."""
    if base is None:
        return None
    mean_col, sd_col, sec_col = BASELINE_COLUMNS[code]
    mean, sd = _num(base[mean_col]), _num(base[sd_col])
    if mean is None or sd is None:
        return None
    return PersonalBaseline(mean=mean, sd=sd, secondary_mean=_num(base[sec_col]) if sec_col else None)


def _alerted_since(db: Session, astronaut_id: int, indicator_code: str, rule_code: str, since: datetime) -> bool:
    """¿Hay ya una alerta de esa regla creada o actualizada desde `since`? Evita que cada reinicio
    del servicio reabra o duplique la alerta del mismo día."""
    return (
        db.query(Alert)
        .filter(
            Alert.astronaut_id == astronaut_id,
            Alert.indicator_code == indicator_code,
            Alert.rule_code == rule_code,
            Alert.updated_at >= since,
        )
        .first()
        is not None
    )


def _ensure_astronaut(db: Session, role: Role, subject: str, meta: Dict[str, str], sujeto: str) -> User:
    user = db.query(User).filter(User.email == meta["email"]).first()
    if user is None:
        user = User(
            crew_code=meta["crew_code"],
            email=meta["email"],
            full_name=f"Sujeto UTMB {sujeto} (análogo)",
            password_hash=hash_password(settings.DEMO_ANALOG_PASSWORD),
            role_id=role.id,
            status="ACTIVE",
            preferred_theme="space-dark",
            share_wellness_signals_with_leader=True,
            share_detailed_wellness_with_medical=False,
        )
        db.add(user)
        db.flush()
        db.add(AstronautProfile(
            user_id=user.id,
            callsign=meta["callsign"],
            specialty="Participante de reposo en cama (análogo de microgravedad)",
            eva_certified=False,
            authorized_restrictions_json="[]",
            quiet_hours_window="22:00-06:00 UTC",
            notes=f"Datos reales del sujeto {sujeto} ({subject}) del estudio de reposo en cama de UTMB (NASA NLSP).",
        ))
        db.add(GamificationProfile(user_id=user.id))
        db.flush()
    return user


def _ensure_mission(db: Session, today: date, now: datetime) -> Mission:
    start = datetime.combine(today - timedelta(days=CURRENT_BED_REST_DAY - 1), time(0), timezone.utc)
    mission = db.query(Mission).filter(Mission.code == MISSION_CODE).first()
    if mission is None:
        mission = Mission(
            code=MISSION_CODE,
            name="Análogo de microgravedad — Reposo en cama UTMB (datos reales NASA)",
            description=(
                "Misión análoga en tierra: reposo en cama inclinada 6° con la cabeza abajo. "
                "Signos vitales reales del estudio de UTMB publicados por el NASA Life Sciences Portal "
                "(doi:10.83263/wjw1-ta27), con las fechas trasladadas para la demostración. "
                "No son datos de vuelo espacial."
            ),
            vehicle_or_habitat="Unidad de reposo en cama, UTMB (Galveston, Texas)",
            current_phase=BED_REST_PHASE,
            status="ACTIVE",
            allow_leader_routine_tracking=True,
            is_simulated=False,
        )
        db.add(mission)
        db.flush()
    mission.start_date = start
    mission.planned_duration_days = 90
    mission.planned_end_date = start + timedelta(days=90)

    phases = [
        (PRE_PHASE, "1. Línea base previa al reposo (ambulatoria)", 1,
         start - timedelta(days=14), start, PRE_ENV, False),
        (BED_REST_PHASE, "2. Reposo en cama inclinada 6° (cabeza abajo)", 2,
         start, start + timedelta(days=90), BED_REST_ENV, True),
    ]
    for code, name, order, s_dt, e_dt, env, current in phases:
        phase = db.query(MissionPhase).filter(
            MissionPhase.mission_id == mission.id, MissionPhase.phase_code == code
        ).first()
        if phase is None:
            phase = MissionPhase(mission_id=mission.id, phase_code=code, name=name, sequence_order=order,
                                 environment_code=env)
            db.add(phase)
        phase.start_date, phase.end_date, phase.is_current = s_dt, e_dt, current
    db.flush()
    return mission


def seed_analog_bed_rest(
    db: Session,
    now: Optional[datetime] = None,
    subjects: Optional[Dict[str, Dict[str, str]]] = None,
    current_day: int = CURRENT_BED_REST_DAY,
) -> Dict[str, int]:
    """Crea o actualiza la misión análoga y recarga sus mediciones reales. Idempotente."""
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(timezone.utc).date()
    subjects = subjects or SUBJECTS

    role = db.query(Role).filter(Role.code == "ASTRONAUT").first()
    if role is None:
        return {"measurements": 0, "baselines": 0}
    definitions = {
        d.code: d for d in db.query(HealthIndicatorDefinition)
        .filter(HealthIndicatorDefinition.code.in_(INDICATOR_COLUMNS)).all()
    }
    rules: Dict[str, Tuple[ClinicalRule, ClinicalRuleVersion]] = {}
    for rule in db.query(ClinicalRule).filter(
        ClinicalRule.indicator_code.in_(INDICATOR_COLUMNS), ClinicalRule.is_active.is_(True)
    ).all():
        version = db.query(ClinicalRuleVersion).filter(
            ClinicalRuleVersion.rule_id == rule.id, ClinicalRuleVersion.is_current.is_(True)
        ).order_by(ClinicalRuleVersion.id.desc()).first()
        if version is not None:
            rules[rule.indicator_code] = (rule, version)

    mission = _ensure_mission(db, today, now)
    vitals = _read_csv(VITALS_CSV, subjects)
    baselines = {k: v[0] for k, v in _read_csv(BASELINES_CSV, subjects).items() if v}

    # Recarga completa de esta fuente: así la serie siempre termina hoy.
    db.query(HealthMeasurement).filter(
        HealthMeasurement.mission_id == mission.id, HealthMeasurement.source_code == SOURCE_CODE
    ).delete(synchronize_session=False)

    n_meas = n_base = n_alerts = 0
    day_start = datetime.combine(today, time(0), timezone.utc)
    persistence = timedelta(hours=PERSISTENCE_WINDOW_HOURS)
    for subject, meta in subjects.items():
        rows = vitals.get(subject) or []
        if not rows:
            continue
        user = _ensure_astronaut(db, role, subject, meta, rows[0]["sujeto"])
        if db.query(MissionAssignment).filter(
            MissionAssignment.mission_id == mission.id, MissionAssignment.user_id == user.id
        ).first() is None:
            db.add(MissionAssignment(mission_id=mission.id, user_id=user.id,
                                     assignment_role="ASTRONAUT", is_active=True))

        base = baselines.get(subject)
        previous: Dict[str, Tuple[datetime, PreviousReading]] = {}
        todays: Dict[str, Tuple[HealthMeasurement, MeasurementEvaluation]] = {}
        for row in sorted(rows, key=lambda r: int(r["dia_mision"])):
            day = int(row["dia_mision"])
            if day > current_day:
                continue
            in_bed = row["fase"] == "mision"
            measured_at = datetime.combine(today - timedelta(days=current_day - day),
                                           time(MEASUREMENT_HOUR_UTC), timezone.utc)
            for code, (col, sec_col) in INDICATOR_COLUMNS.items():
                value = _num(row[col])
                definition = definitions.get(code)
                if value is None or definition is None:
                    continue
                secondary = _num(row[sec_col]) if sec_col else None
                rule, version = rules.get(code, (None, None))
                state, detail = "UNKNOWN", None
                reasons = ["No existe versión de regla activa configurada para este indicador."]
                if version is not None:
                    prev = previous.get(code)
                    detail = evaluate_reading(
                        code, value, secondary, Thresholds.from_version(version),
                        unit=definition.unit,
                        min_valid=definition.min_valid_value, max_valid=definition.max_valid_value,
                        baseline=_personal_baseline(base, code),
                        previous=prev[1] if prev and measured_at - prev[0] <= persistence else None,
                        rule_label=f"{rule.rule_code} ({version.version_number})",
                    )
                    state, reasons = detail.state, detail.reasons
                measurement = HealthMeasurement(
                    dedup_key=f"utmb:{row['sujeto']}:{row['fecha']}:{code}",
                    astronaut_id=user.id,
                    mission_id=mission.id,
                    indicator_code=code,
                    value=value,
                    secondary_value=secondary,
                    unit=definition.unit,
                    measured_at=measured_at,
                    received_at=measured_at,
                    phase_code=BED_REST_PHASE if in_bed else PRE_PHASE,
                    environment_code=BED_REST_ENV if in_bed else PRE_ENV,
                    source_code=SOURCE_CODE,
                    data_quality="VALIDATED",
                    calculated_state=state,
                    rule_version_id=version.id if version is not None else None,
                    is_simulated=False,
                    notes=(f"Dato real NASA UTMB, sujeto {row['sujeto']}, fecha original {row['fecha']}, "
                           f"día de reposo {day}. Fecha trasladada para la demo."),
                )
                db.add(measurement)
                n_meas += 1
                if state != "INVALID":
                    previous[code] = (measured_at, PreviousReading(value=value, secondary_value=secondary))
                if day == current_day:
                    todays[code] = (measurement, MeasurementEvaluation(state, rule, version, reasons, detail))

        # Alertas: solo las lecturas de hoy, con el mismo upsert que la API (una abierta por indicador).
        # Si esa regla ya tiene una alerta creada o actualizada hoy no se toca, para que reiniciar el
        # servicio no la duplique ni reabra una que alguien ya resolvió.
        db.flush()
        for code, (measurement, evaluation) in todays.items():
            if evaluation.rule is None or _alerted_since(db, user.id, code, evaluation.rule.rule_code, day_start):
                continue
            alert, created = upsert_alert_for_measurement(
                db, measurement, definitions[code], evaluation, created_at=min(measurement.measured_at, now)
            )
            if alert is not None:
                n_alerts += 1

        if base is None:
            continue
        for code, (mean_col, sd_col, sec_col) in BASELINE_COLUMNS.items():
            mean, sd = _num(base[mean_col]), _num(base[sd_col])
            if mean is None or sd is None:
                continue
            baseline = db.query(HealthBaseline).filter(
                HealthBaseline.astronaut_id == user.id, HealthBaseline.indicator_code == code
            ).first()
            if baseline is None:
                baseline = HealthBaseline(astronaut_id=user.id, indicator_code=code)
                db.add(baseline)
            baseline.baseline_value = mean
            baseline.baseline_secondary_value = _num(base[sec_col]) if sec_col else None
            baseline.std_dev = sd
            baseline.established_phase = "PRE_MISSION_BASELINE"
            baseline.is_simulated = False
            baseline.updated_at = now
            n_base += 1

    db.commit()
    return {"measurements": n_meas, "baselines": n_base, "alerts": n_alerts}
