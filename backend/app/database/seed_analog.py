"""Misión análoga en tierra con signos vitales reales de NASA (reposo en cama, UTMB).

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
"""
from __future__ import annotations

import csv
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, Optional

from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.models.models import (
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
# - UTMB-17: `ok` en los 4 indicadores; el pulso sube ~0,33 lpm/día durante el reposo.
# - UTMB-03: `ok` en los 4 indicadores.
# - UTMB-29: pulso `ok` (~+0,27 lpm/día) y presión arterial `model_not_reliable`.
SUBJECTS: Dict[str, Dict[str, str]] = {
    "UTMB-17": {"crew_code": "HDBR-01", "email": "hdbr01@astrovital.demo", "callsign": "Analog-1"},
    "UTMB-03": {"crew_code": "HDBR-02", "email": "hdbr02@astrovital.demo", "callsign": "Analog-2"},
    "UTMB-29": {"crew_code": "HDBR-03", "email": "hdbr03@astrovital.demo", "callsign": "Analog-3"},
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


def _state(value: float, version: Optional[ClinicalRuleVersion]) -> str:
    if version is None:
        return "NORMAL"
    if value < version.monitor_min or value > version.monitor_max:
        return "WARNING"
    if value < version.normal_min or value > version.normal_max:
        return "MONITOR"
    return "NORMAL"


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
    versions: Dict[str, ClinicalRuleVersion] = {}
    for rule in db.query(ClinicalRule).filter(ClinicalRule.indicator_code.in_(INDICATOR_COLUMNS)).all():
        version = db.query(ClinicalRuleVersion).filter(
            ClinicalRuleVersion.rule_id == rule.id, ClinicalRuleVersion.is_current.is_(True)
        ).first()
        if version is not None:
            versions[rule.indicator_code] = version

    mission = _ensure_mission(db, today, now)
    vitals = _read_csv(VITALS_CSV, subjects)
    baselines = {k: v[0] for k, v in _read_csv(BASELINES_CSV, subjects).items() if v}

    # Recarga completa de esta fuente: así la serie siempre termina hoy.
    db.query(HealthMeasurement).filter(
        HealthMeasurement.mission_id == mission.id, HealthMeasurement.source_code == SOURCE_CODE
    ).delete(synchronize_session=False)

    n_meas = n_base = 0
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

        for row in rows:
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
                db.add(HealthMeasurement(
                    dedup_key=f"utmb:{row['sujeto']}:{row['fecha']}:{code}",
                    astronaut_id=user.id,
                    mission_id=mission.id,
                    indicator_code=code,
                    value=value,
                    secondary_value=_num(row[sec_col]) if sec_col else None,
                    unit=definition.unit,
                    measured_at=measured_at,
                    received_at=measured_at,
                    phase_code=BED_REST_PHASE if in_bed else PRE_PHASE,
                    environment_code=BED_REST_ENV if in_bed else PRE_ENV,
                    source_code=SOURCE_CODE,
                    data_quality="VALIDATED",
                    calculated_state=_state(value, versions.get(code)),
                    rule_version_id=versions[code].id if code in versions else None,
                    is_simulated=False,
                    notes=(f"Dato real NASA UTMB, sujeto {row['sujeto']}, fecha original {row['fecha']}, "
                           f"día de reposo {day}. Fecha trasladada para la demo."),
                ))
                n_meas += 1

        base = baselines.get(subject)
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
    return {"measurements": n_meas, "baselines": n_base}
