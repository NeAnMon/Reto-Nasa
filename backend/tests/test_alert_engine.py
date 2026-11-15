"""SEMSA · Pruebas · Motor de alertas calibrado con el dataset.

Cubre lo que no depende de los datos reales de UTMB (eso está en test_alert_calibration.py):
- criterio de severidad de la función pura (dos capas) y umbrales del dataset en sus bordes;
- procedencia de cada umbral y línea base demo con DE del dataset;
- una sola alerta abierta por astronauta + indicador + regla (deduplicación) y ciclo de vida;
- recomendación no vacía en todas las alertas y en todos los sitios que crean `Alert`;
- coherencia de los seeds con el motor y migración de una BD ya desplegada.

Run from repository root: pytest backend/tests/test_alert_engine.py -q
"""
import ast
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database import seed_analog as sa
from backend.app.database.seed import INDICATORS_DATA, seed_database
from backend.app.database.session import Base, get_db
from backend.app.main import app
from backend.app.models.models import (
    Alert,
    ClinicalRule,
    ClinicalRuleVersion,
    HealthBaseline,
    HealthIndicatorDefinition,
    HealthMeasurement,
    Mission,
    User,
)
from backend.app.rules import recommendations as rec
from backend.app.rules.calibration import (
    CALIBRATION,
    CALIBRATION_VERSION,
    PERSISTENCE_WINDOW_HOURS,
    UNBACKED,
    demo_std_dev,
)
from backend.app.rules.engine import (
    NON_DIAGNOSTIC_NOTE,
    OPEN_ALERT_STATUSES,
    baseline_from_row,
    evaluate_measurement,
)
from backend.app.rules.evaluation import (
    PersonalBaseline,
    PreviousReading,
    RollingWindow,
    Thresholds,
    evaluate_reading,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_DIR = REPO_ROOT / "backend" / "app"
INDICATOR_BY_CODE = {item["code"]: item for item in INDICATORS_DATA}


# --------------------------------------------------------------------------------------------------
# Función pura: criterio de severidad
# --------------------------------------------------------------------------------------------------
# Bordes de los umbrales del dataset (alertas.py), sin línea base: amarillo → WARNING, rojo → CRITICAL
DATASET_EDGES = [
    ("HEART_RATE", 99, None, "NORMAL"), ("HEART_RATE", 100, None, "WARNING"), ("HEART_RATE", 119, None, "WARNING"),
    ("HEART_RATE", 120, None, "CRITICAL"), ("HEART_RATE", 51, None, "NORMAL"), ("HEART_RATE", 50, None, "WARNING"),
    ("HEART_RATE", 41, None, "WARNING"), ("HEART_RATE", 40, None, "CRITICAL"),
    ("BLOOD_PRESSURE", 139, 80, "NORMAL"), ("BLOOD_PRESSURE", 140, 80, "WARNING"), ("BLOOD_PRESSURE", 179, 80, "WARNING"),
    ("BLOOD_PRESSURE", 180, 80, "CRITICAL"), ("BLOOD_PRESSURE", 91, 60, "NORMAL"), ("BLOOD_PRESSURE", 90, 60, "WARNING"),
    # PAS baja: amarillo ≤ 90 del dataset; rojo < 80 conservado de 1.0-DEMO como piso de seguridad
    ("BLOOD_PRESSURE", 85, 60, "WARNING"), ("BLOOD_PRESSURE", 80, 55, "WARNING"),
    ("BLOOD_PRESSURE", 79, 50, "CRITICAL"), ("BLOOD_PRESSURE", 70, 45, "CRITICAL"),
    ("BLOOD_PRESSURE", 120, 89, "NORMAL"), ("BLOOD_PRESSURE", 120, 90, "WARNING"), ("BLOOD_PRESSURE", 130, 119, "WARNING"),
    ("BLOOD_PRESSURE", 130, 120, "CRITICAL"),
    ("BLOOD_PRESSURE", 120, 46, "NORMAL"),   # PAD baja: sin regla en el dataset
    ("BODY_TEMP", 37.7, None, "NORMAL"), ("BODY_TEMP", 37.8, None, "WARNING"), ("BODY_TEMP", 37.9, None, "WARNING"),
    ("BODY_TEMP", 38.0, None, "CRITICAL"), ("BODY_TEMP", 35.0, None, "NORMAL"), ("BODY_TEMP", 34.9, None, "CRITICAL"),
    ("SPO2", 95, None, "NORMAL"), ("SPO2", 94, None, "WARNING"), ("SPO2", 92, None, "WARNING"), ("SPO2", 91, None, "CRITICAL"),
    ("RESP_RATE", 20, None, "NORMAL"), ("RESP_RATE", 21, None, "WARNING"), ("RESP_RATE", 23, None, "WARNING"),
    ("RESP_RATE", 24, None, "CRITICAL"),
    # FR baja: sin regla en el dataset; cortes de 1.0-DEMO conservados como piso de seguridad
    ("RESP_RATE", 9, None, "NORMAL"), ("RESP_RATE", 8, None, "WARNING"), ("RESP_RATE", 7, None, "CRITICAL"),
    ("BLOOD_GLUCOSE", 70, None, "NORMAL"), ("BLOOD_GLUCOSE", 69, None, "WARNING"), ("BLOOD_GLUCOSE", 105, None, "NORMAL"),
    ("BLOOD_GLUCOSE", 106, None, "WARNING"),
]


@pytest.mark.parametrize("code, value, secondary, expected", DATASET_EDGES)
def test_dataset_thresholds_at_their_edges(code, value, secondary, expected):
    item = INDICATOR_BY_CODE[code]
    ev = evaluate_reading(
        code, float(value), float(secondary) if secondary is not None else None,
        unit=item["unit"], min_valid=item["min_valid_value"], max_valid=item["max_valid_value"],
    )
    assert ev.state == expected, ev.reasons


def test_absolute_red_is_never_attenuated_by_the_baseline():
    # Pulso 125 es "habitual" para esta línea base (z 0,8), pero es rojo absoluto del dataset
    ev = evaluate_reading("HEART_RATE", 125.0, baseline=PersonalBaseline(mean=120.0, sd=6.0))
    assert (ev.state, ev.direction) == ("CRITICAL", "HIGH")
    assert abs(ev.z) < 2


def test_absolute_yellow_depends_on_the_personal_baseline():
    # Pulso 48: amarillo absoluto (≤ 50)
    assert evaluate_reading("HEART_RATE", 48.0).state == "WARNING"                                    # sin línea base
    habitual = evaluate_reading("HEART_RATE", 48.0, baseline=PersonalBaseline(mean=51.0, sd=9.0))
    assert (habitual.state, habitual.direction) == ("MONITOR", "LOW")                                 # z −0,3
    unusual = evaluate_reading("HEART_RATE", 48.0, baseline=PersonalBaseline(mean=75.0, sd=6.0))
    assert (unusual.state, unusual.direction) == ("WARNING", "LOW")                                   # z −4,5


@pytest.mark.parametrize("sd, simulated", [(None, False), (0.0, False), (-1.0, False), (5.0, False), (4.0, True)])
def test_missing_or_placeholder_std_dev_is_not_a_valid_baseline(sd, simulated):
    """DE ausente, ≤ 0, el 5.0 por defecto del modelo o el 4.0 del seed: solo capa absoluta."""
    base = PersonalBaseline(mean=64.0, sd=sd, is_simulated=simulated)
    # 90 lpm: dentro del rango absoluto; con una DE "de verdad" sería un desvío fuerte
    ev = evaluate_reading("HEART_RATE", 90.0, baseline=base)
    assert ev.state == "NORMAL" and ev.z is None and ev.baseline_valid is False
    # 105 lpm: amarillo absoluto sin línea base válida → WARNING (no se atenúa a MONITOR)
    assert evaluate_reading("HEART_RATE", 105.0, baseline=base).state == "WARNING"


def test_real_std_dev_of_4_is_valid_when_not_the_seed_placeholder():
    ev = evaluate_reading("HEART_RATE", 90.0, baseline=PersonalBaseline(mean=64.0, sd=4.0, is_simulated=False))
    assert ev.baseline_valid is True and ev.state == "WARNING"  # la DE se sube al piso del dataset (6 lpm): z 4,3


def test_personal_deviation_layer():
    base = PersonalBaseline(mean=64.0, sd=6.26)
    # |z| ≥ 3 dentro del rango absoluto → WARNING por desvío personal
    strong = evaluate_reading("HEART_RATE", 90.0, baseline=base)
    assert (strong.state, strong.direction, strong.absolute_level) == ("WARNING", "PERSONAL", 0)
    # 2 ≤ |z| < 3 aislado → NORMAL, pendiente de confirmar
    alone = evaluate_reading("HEART_RATE", 78.0, baseline=base, previous=PreviousReading(value=66.0))
    assert alone.state == "NORMAL" and alone.pending_confirmation is True and alone.direction is None
    # ...confirmado por la lectura anterior en el mismo sentido → MONITOR
    confirmed = evaluate_reading("HEART_RATE", 78.0, baseline=base, previous=PreviousReading(value=79.0))
    assert (confirmed.state, confirmed.direction) == ("MONITOR", "PERSONAL")
    # ...la lectura anterior desviada en el otro sentido no confirma
    opposite = evaluate_reading("HEART_RATE", 78.0, baseline=base, previous=PreviousReading(value=50.0))
    assert opposite.state == "NORMAL"


def test_diastolic_uses_its_own_dataset_thresholds_and_baseline():
    base = PersonalBaseline(mean=114.0, sd=8.0, secondary_mean=72.0)
    # PAD 92: amarillo (≥ 90) y lejos de su línea base (z 2,9 con la DE de referencia de UTMB) → WARNING
    ev = evaluate_reading("BLOOD_PRESSURE", 118.0, 92.0, baseline=base)
    assert (ev.state, ev.component, ev.direction) == ("WARNING", "SECONDARY", "HIGH")
    assert ev.z_secondary == pytest.approx((92.0 - 72.0) / 6.94)
    # PAD 92 habitual para alguien con línea base 88 → MONITOR
    habitual = evaluate_reading(
        "BLOOD_PRESSURE", 135.0, 92.0, baseline=PersonalBaseline(mean=132.0, sd=8.0, secondary_mean=88.0)
    )
    assert habitual.state == "MONITOR"
    # Con la DE personal de la diastólica (si se conoce) se usa esa
    own = evaluate_reading(
        "BLOOD_PRESSURE", 118.0, 92.0, baseline=PersonalBaseline(mean=114.0, sd=8.0, secondary_mean=72.0, secondary_sd=12.0)
    )
    assert own.z_secondary == pytest.approx(20.0 / 12.0) and own.state == "MONITOR"
    # Diastólica inválida (≥ sistólica)
    assert evaluate_reading("BLOOD_PRESSURE", 110.0, 115.0).state == "INVALID"


def test_sleep_rule_uses_the_seven_night_mean():
    # Media de 7 noches < 6,0 h → amarillo; < 5,5 h → rojo (regla sueno_corto del dataset)
    assert evaluate_reading("SLEEP_DURATION", 7.5, window=RollingWindow(mean=5.9, count=7)).state == "WARNING"
    assert evaluate_reading("SLEEP_DURATION", 7.5, window=RollingWindow(mean=5.4, count=5)).state == "CRITICAL"
    # Una noche corta no alerta si la media aguanta
    assert evaluate_reading("SLEEP_DURATION", 4.0, window=RollingWindow(mean=6.6, count=7)).state == "NORMAL"
    # Menos de 4 noches registradas: una noche aislada muy corta queda solo en observación
    short = evaluate_reading("SLEEP_DURATION", 5.1, window=RollingWindow(mean=5.1, count=1))
    assert (short.state, short.direction) == ("MONITOR", "LOW")
    assert evaluate_reading("SLEEP_DURATION", 5.8, window=RollingWindow(mean=5.8, count=1)).state == "NORMAL"
    # Persona que duerme poco de forma habitual: amarillo pero habitual → MONITOR
    habitual = evaluate_reading(
        "SLEEP_DURATION", 5.8, window=RollingWindow(mean=5.8, count=7), baseline=PersonalBaseline(mean=5.9, sd=0.52)
    )
    assert habitual.state == "MONITOR"


def test_radiation_cumulative_dose_against_career_limit():
    assert evaluate_reading("RADIATION_EXPOSURE", 0.4, cumulative=299.0).state == "NORMAL"
    half = evaluate_reading("RADIATION_EXPOSURE", 0.4, cumulative=300.0)
    assert (half.state, half.direction) == ("WARNING", "CUMULATIVE")
    full = evaluate_reading("RADIATION_EXPOSURE", 0.4, cumulative=600.0)
    assert (full.state, full.direction) == ("CRITICAL", "CUMULATIVE")


def test_mood_personal_rule_is_one_sided_and_only_yellow():
    base = PersonalBaseline(mean=9.0, sd=0.5)
    # z −4 confirmado: el dataset solo define amarillo para el ánimo (no hay nivel rojo)
    low = evaluate_reading("MOOD_WELLNESS", 7.0, baseline=base, previous=PreviousReading(value=7.0))
    assert (low.state, low.direction) == ("MONITOR", "PERSONAL")
    # Un ánimo mejor que el habitual nunca alerta
    high = evaluate_reading(
        "MOOD_WELLNESS", 9.5, baseline=PersonalBaseline(mean=7.0, sd=0.5), previous=PreviousReading(value=9.5)
    )
    assert high.state == "NORMAL"


def test_invalid_readings_are_rejected_before_any_rule():
    ev = evaluate_reading("HEART_RATE", 350.0, unit="bpm", min_valid=25.0, max_valid=240.0)
    assert ev.state == "INVALID" and ev.direction is None
    assert evaluate_reading("HEART_RATE", float("nan")).state == "INVALID"


def test_safety_floors_for_low_respiratory_rate_and_low_systolic():
    """Pisos de seguridad conservados de 1.0-DEMO (sin respaldo en el dataset): FR baja y PAS baja crítica."""
    # FR 7 rpm: rojo; nunca se atenúa aunque sea "habitual" para la línea base
    rr7 = evaluate_reading("RESP_RATE", 7.0, unit="rpm", min_valid=6.0, max_valid=45.0)
    assert (rr7.state, rr7.direction) == ("CRITICAL", "LOW")
    assert evaluate_reading("RESP_RATE", 7.0, baseline=PersonalBaseline(mean=7.5, sd=1.5)).state == "CRITICAL"
    # FR 8 rpm: amarillo; WARNING lejos de la línea base o sin ella, MONITOR si es habitual
    assert evaluate_reading("RESP_RATE", 8.0).state == "WARNING"
    assert evaluate_reading("RESP_RATE", 8.0, baseline=PersonalBaseline(mean=13.5, sd=1.5)).state == "WARNING"
    assert evaluate_reading("RESP_RATE", 8.0, baseline=PersonalBaseline(mean=9.0, sd=1.5)).state == "MONITOR"
    immediate, followup = rec.build_alert_texts("RESP_RATE", rr7.direction, rr7.state)
    assert ("RESP_RATE", rec.LOW) in rec.CATALOG
    assert immediate.startswith("1. Vuelve a contar las respiraciones") and rec.LEVEL_STEP["CRITICAL"] in immediate
    assert "8 rpm" in followup and UNBACKED in followup and "piso de seguridad" in followup

    # PAS 79 mmHg: rojo (piso de seguridad); PAS 85 sigue en la capa amarilla del dataset (≤ 90)
    pas79 = evaluate_reading("BLOOD_PRESSURE", 79.0, 50.0, unit="mmHg", min_valid=60.0, max_valid=250.0)
    assert (pas79.state, pas79.direction, pas79.component) == ("CRITICAL", "LOW", "PRIMARY")
    assert evaluate_reading(
        "BLOOD_PRESSURE", 79.0, 50.0, baseline=PersonalBaseline(mean=82.0, sd=8.0, secondary_mean=52.0)
    ).state == "CRITICAL"
    pas85 = evaluate_reading("BLOOD_PRESSURE", 85.0, 60.0)
    assert (pas85.state, pas85.direction) == ("WARNING", "LOW")
    habitual = evaluate_reading(
        "BLOOD_PRESSURE", 85.0, 60.0, baseline=PersonalBaseline(mean=92.0, sd=8.0, secondary_mean=62.0)
    )
    assert habitual.state == "MONITOR"
    _, followup = rec.build_alert_texts("BLOOD_PRESSURE", rec.LOW, "CRITICAL")
    assert "80 mmHg" in followup and "no tiene respaldo en el dataset" in followup and "piso de seguridad" in followup
    # La diastólica baja sigue sin umbral absoluto (era la fuente de falsas alarmas)
    assert evaluate_reading("BLOOD_PRESSURE", 120.0, 46.0).state == "NORMAL"


# --------------------------------------------------------------------------------------------------
# Procedencia de los umbrales
# --------------------------------------------------------------------------------------------------
def test_every_indicator_has_calibration_with_provenance():
    assert set(CALIBRATION) == set(INDICATOR_BY_CODE)
    for code, cal in CALIBRATION.items():
        item = INDICATOR_BY_CODE[code]
        assert cal.source and len(cal.source) <= 180, code
        assert cal.provenance, code
        # Rangos anidados y dentro de los límites físicos del indicador
        assert item["min_valid_value"] <= cal.warning[0] <= cal.monitor[0] <= cal.normal[0], code
        assert cal.normal[1] <= cal.monitor[1] <= cal.warning[1] <= item["max_valid_value"], code


def test_unbacked_thresholds_are_labelled_and_nothing_unverified_is_presented_as_verified():
    # El dataset no trae hidratación, ejercicio ni fatiga: umbrales conservados y rotulados
    for code in ("HYDRATION", "PHYSICAL_ACTIVITY", "PERCEIVED_FATIGUE"):
        cal = CALIBRATION[code]
        assert cal.dataset_backed is False and UNBACKED in cal.source and "1.0-DEMO" in cal.source, code
        assert cal.demo_sd is None, code
    # Respaldo parcial: se dice qué parte no lo tiene
    for code in ("BLOOD_GLUCOSE", "MOOD_WELLNESS", "RADIATION_EXPOSURE"):
        assert UNBACKED in CALIBRATION[code].source, code
    # Pisos de seguridad (FR baja y sistólica baja crítica): el dataset no los define; se conservan los
    # cortes de 1.0-DEMO y se dice tanto en la fuente corta como en la procedencia
    for code in ("RESP_RATE", "BLOOD_PRESSURE"):
        cal = CALIBRATION[code]
        assert UNBACKED in cal.source and "1.0-DEMO" in cal.source and "piso de seguridad" in cal.source, code
        assert UNBACKED in cal.provenance and "1.0-DEMO como piso de seguridad" in cal.provenance, code
    assert CALIBRATION["RESP_RATE"].monitor[0] == 9.0 and CALIBRATION["RESP_RATE"].warning[0] == 8.0
    assert CALIBRATION["BLOOD_PRESSURE"].monitor[0] == 91.0 and CALIBRATION["BLOOD_PRESSURE"].warning[0] == 80.0
    # Lo que no se recupera: diastólica baja, temperatura 35,0–36,0 °C y sueño excesivo
    assert CALIBRATION["BLOOD_PRESSURE"].secondary_monitor[0] == CALIBRATION["BLOOD_PRESSURE"].secondary_warning[0] == 30.0
    assert CALIBRATION["BODY_TEMP"].monitor[0] == CALIBRATION["BODY_TEMP"].warning[0] == 35.0
    assert CALIBRATION["SLEEP_DURATION"].warning[1] == INDICATOR_BY_CODE["SLEEP_DURATION"]["max_valid_value"]
    # Reglas que el dataset marca verificado=False (criterio clínico general / guía)
    for code in ("HEART_RATE", "BLOOD_PRESSURE", "BODY_TEMP", "SPO2", "RESP_RATE"):
        cal = CALIBRATION[code]
        assert cal.verified is False and "no verificado" in cal.source, code
    # Solo sueño (Barger 2014) y radiación (límite de 600 mSv) tienen cifra verificada en el dataset
    assert {code for code, cal in CALIBRATION.items() if cal.verified} == {"SLEEP_DURATION", "RADIATION_EXPOSURE"}
    for code in ("SLEEP_DURATION", "RADIATION_EXPOSURE"):
        assert "verificado" in CALIBRATION[code].source and "equipo" in CALIBRATION[code].provenance


def test_measure_catalog_covers_calibrated_indicators():
    """La vista "Registrar medición" ya no usa JSON: su catálogo (seed.MEASURE_UI_DATA) cubre los
    indicadores calibrados, y los umbrales los sirve /health/indicators desde la regla vigente."""
    from backend.app.database.seed import MEASURE_UI_DATA

    assert not (REPO_ROOT / "frontend" / "src" / "console" / "data" / "measure-demo.json").exists()
    assert set(MEASURE_UI_DATA) == set(CALIBRATION)


# --------------------------------------------------------------------------------------------------
# Recomendaciones
# --------------------------------------------------------------------------------------------------
def test_catalog_has_a_specific_recommendation_for_every_reachable_direction():
    for code, cal in CALIBRATION.items():
        item = INDICATOR_BY_CODE[code]
        directions = set()
        if min(cal.normal[1], cal.monitor[1], cal.warning[1]) < item["max_valid_value"]:
            directions.add(rec.HIGH)
        if max(cal.normal[0], cal.monitor[0], cal.warning[0]) > item["min_valid_value"]:
            directions.add(rec.LOW)
        if cal.deviation:
            directions.add(rec.PERSONAL)
        if cal.secondary_monitor:
            directions.add(rec.HIGH)
        if code == "RADIATION_EXPOSURE":
            directions.add(rec.CUMULATIVE)
        assert directions, code
        for direction in directions:
            key = rec._ALIASES.get((code, direction), (code, direction))
            assert key in rec.CATALOG, f"falta recomendación específica para {code} / {direction}"
            for state in ("MONITOR", "WARNING", "CRITICAL"):
                immediate, followup = rec.build_alert_texts(code, direction, state)
                steps = immediate.split("\n")
                assert len(steps) == 2 and steps[0].startswith("1. ") and steps[1] == rec.LEVEL_STEP[state]
                assert followup.startswith("Para mejorar en los próximos días:")
                assert "Fuente:" in followup and "médico de vuelo" in followup


def test_recommendations_are_honest_about_unbacked_thresholds():
    for code in ("HYDRATION", "PHYSICAL_ACTIVITY", "PERCEIVED_FATIGUE"):
        for (c, _direction), entry in rec.CATALOG.items():
            if c == code:
                assert UNBACKED in entry.followup, (code, _direction)
    # Una dirección sin entrada propia cae en la genérica, nunca en un texto vacío
    immediate, followup = rec.build_alert_texts("INDICADOR_NUEVO", rec.LOW, "WARNING")
    assert immediate.strip() and followup.strip()
    assert rec.build_alert_texts("HEART_RATE", rec.SOURCE_CONFLICT, "MONITOR")[0].startswith("1. Dos fuentes")


def test_alert_model_never_stores_an_empty_recommendation():
    alert = Alert(immediate_action="   ", followup_recommendation="")
    assert alert.immediate_action == rec.FALLBACK_IMMEDIATE
    assert alert.followup_recommendation == rec.FALLBACK_FOLLOWUP
    alert.immediate_action = None
    assert alert.immediate_action == rec.FALLBACK_IMMEDIATE
    kept = Alert(immediate_action="Texto propio", followup_recommendation="Seguimiento propio")
    assert (kept.immediate_action, kept.followup_recommendation) == ("Texto propio", "Seguimiento propio")


def test_every_site_that_creates_an_alert_passes_a_recommendation():
    """Todos los `Alert(...)` del backend pasan immediate_action y followup_recommendation.
    Si aparece un sitio nuevo hay que añadirlo aquí (y darle una recomendación)."""
    sites = {}
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Alert":
                keywords = {kw.arg for kw in node.keywords}
                sites.setdefault(path.relative_to(APP_DIR).as_posix(), []).append(keywords)
    assert set(sites) == {
        "rules/engine.py",              # motor: catálogo por indicador × dirección × nivel
        "rules/early_warnings.py",      # alerta temprana "Contacto con Tierra"
        "rules/prediction_alerts.py",   # alerta temprana del pronóstico (issue #30)
        "rules/environment_alerts.py",  # entorno y radiación ambiental de la misión (issue #30)
        "services/emotional_engine.py",
        "services/cognitive_engine.py",
        "api/v1/expansion_router.py",   # solicitud de apoyo urgente
    }, "los seeds ya no crean Alert a mano: usan el upsert del motor"
    for path, calls in sites.items():
        for keywords in calls:
            assert {"immediate_action", "followup_recommendation"} <= keywords, path


# --------------------------------------------------------------------------------------------------
# Con base de datos: seeds, API, deduplicación y migración
# --------------------------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def session_factory(tmp_path_factory):
    path = tmp_path_factory.mktemp("alert_engine") / "alert_engine.db"
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False}, future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
    db = factory()
    try:
        seed_database(db, force_reseed_sim=True)
    finally:
        db.close()
    yield factory
    engine.dispose()


@pytest.fixture
def db(session_factory):
    session = session_factory()
    yield session
    session.close()


@pytest.fixture(scope="module")
def client(session_factory):
    def override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override
    try:
        with TestClient(app) as c:
            yield c
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous


def login(client, email, password):
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    return {"headers": {"Authorization": f"Bearer {data['access_token']}"}, "user": data["user"]}


def post_measurement(client, who, code, value, secondary=None, **extra):
    payload = {
        "indicator_code": code, "value": value, "source_code": "DEMO_SIMULATION",
        "data_quality": "SYNTHETIC_DEMO", "is_simulated": True,
    }
    if secondary is not None:
        payload["secondary_value"] = secondary
    payload.update(extra)
    resp = client.post("/api/v1/health/measurements", headers=who["headers"], json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def get_alert(client, who, alert_id):
    resp = client.get(f"/api/v1/alerts/{alert_id}", headers=who["headers"])
    assert resp.status_code == 200, resp.text
    return resp.json()["alert"]


def open_alerts(db, astronaut_id, code):
    return (
        db.query(Alert)
        .filter(Alert.astronaut_id == astronaut_id, Alert.indicator_code == code,
                Alert.rule_code == f"RULE_{code}_DEMO", Alert.status.in_(OPEN_ALERT_STATUSES))
        .all()
    )


def test_seeded_rules_are_the_dataset_calibrated_version(db):
    rules = db.query(ClinicalRule).all()
    assert {r.indicator_code for r in rules} == set(CALIBRATION)
    for rule in rules:
        cal = CALIBRATION[rule.indicator_code]
        current = [v for v in rule.versions if v.is_current]
        assert len(current) == 1, rule.rule_code
        version = current[0]
        assert version.version_number == CALIBRATION_VERSION == rule.current_version_number
        assert version.protocol_source == cal.source
        assert cal.provenance in version.change_reason
        assert Thresholds.from_version(version) == Thresholds.from_calibration(cal)
        assert version.immediate_instructions.strip() and version.followup_instructions.strip()


def test_demo_baselines_have_a_std_dev_from_the_dataset(db):
    elena = db.query(User).filter(User.email == settings.DEMO_ASTRONAUT1_EMAIL).one()
    rows = {b.indicator_code: b for b in db.query(HealthBaseline).filter(HealthBaseline.astronaut_id == elena.id)}
    assert set(rows) == set(CALIBRATION)
    expected = {
        "HEART_RATE": 6.26, "BLOOD_PRESSURE": 8.0, "BODY_TEMP": 0.30, "RESP_RATE": 1.50,   # mediana de UTMB
        "SLEEP_DURATION": 0.52, "BLOOD_GLUCOSE": 2.62,                                      # reales del dataset
        "SPO2": 0.68, "MOOD_WELLNESS": 0.56,                                                # columnas simuladas
        "HYDRATION": 0.0, "PHYSICAL_ACTIVITY": 0.0, "PERCEIVED_FATIGUE": 0.0, "RADIATION_EXPOSURE": 0.0,
    }
    for code, sd in expected.items():
        assert rows[code].std_dev == pytest.approx(sd), code
        assert demo_std_dev(code) == pytest.approx(sd), code
        if sd:
            assert CALIBRATION[code].demo_sd_source, code
    # Ninguna línea base simulada conserva la DE de relleno
    assert db.query(HealthBaseline).filter(
        HealthBaseline.is_simulated.is_(True), HealthBaseline.std_dev.in_([4.0, 5.0])
    ).count() == 0


def test_seed_states_come_from_the_engine(db):
    """Las mediciones sembradas llevan el estado del motor (no escrito a mano) y STALE no se guarda."""
    assert db.query(HealthMeasurement).filter(HealthMeasurement.calculated_state == "STALE").count() == 0
    elena = db.query(User).filter(User.email == settings.DEMO_ASTRONAUT1_EMAIL).one()
    marcus = db.query(User).filter(User.email == settings.DEMO_ASTRONAUT2_EMAIL).one()

    def latest_state(user, code):
        return (
            db.query(HealthMeasurement)
            .filter(HealthMeasurement.astronaut_id == user.id, HealthMeasurement.indicator_code == code,
                    HealthMeasurement.source_code == "DEMO_SIMULATION")
            .order_by(HealthMeasurement.measured_at.desc(), HealthMeasurement.id.desc())
            .first()
            .calculated_state
        )

    # Elena hoy: pulso 93 con línea base 64 ± 6,26 → desvío personal fuerte (antes: MONITOR por umbral fijo)
    assert latest_state(elena, "HEART_RATE") == "WARNING"
    # Elena hoy: PA 131/84 (z 2,1 aislado) → sin alerta; sueño 5,8 h con media de la semana 6,3 h → normal
    assert latest_state(elena, "BLOOD_PRESSURE") == "NORMAL"
    assert latest_state(elena, "SLEEP_DURATION") == "NORMAL"
    # Marcus: una sola noche de 5,1 h → observación; hidratación y fatiga (umbrales 1.0-DEMO) → WARNING
    assert latest_state(marcus, "SLEEP_DURATION") == "MONITOR"
    assert latest_state(marcus, "HYDRATION") == "WARNING"
    assert latest_state(marcus, "PERCEIVED_FATIGUE") == "WARNING"


def test_analog_seed_uses_the_same_evaluation_as_the_engine(db):
    """seed_analog guarda, para cada medición real, el estado que daría el motor con la línea base del
    sujeto (diastólica incluida) y la lectura anterior."""
    user = db.query(User).filter(User.crew_code == "HDBR-03").one()
    window = timedelta(hours=PERSISTENCE_WINDOW_HOURS)
    checked = 0
    states = set()
    for code in sa.INDICATOR_COLUMNS:
        definition = db.query(HealthIndicatorDefinition).filter(HealthIndicatorDefinition.code == code).one()
        rule = db.query(ClinicalRule).filter(ClinicalRule.indicator_code == code).one()
        version = next(v for v in rule.versions if v.is_current)
        baseline = baseline_from_row(
            db.query(HealthBaseline).filter(
                HealthBaseline.astronaut_id == user.id, HealthBaseline.indicator_code == code
            ).one()
        )
        rows = (
            db.query(HealthMeasurement)
            .filter(HealthMeasurement.astronaut_id == user.id, HealthMeasurement.indicator_code == code,
                    HealthMeasurement.source_code == sa.SOURCE_CODE)
            .order_by(HealthMeasurement.measured_at.asc())
            .all()
        )
        assert len(rows) >= 40, code
        prev = None
        for m in rows:
            previous = None
            if prev is not None and m.measured_at - prev.measured_at <= window:
                previous = PreviousReading(value=prev.value, secondary_value=prev.secondary_value)
            ev = evaluate_reading(
                code, m.value, m.secondary_value, Thresholds.from_version(version), unit=definition.unit,
                min_valid=definition.min_valid_value, max_valid=definition.max_valid_value,
                baseline=baseline, previous=previous,
            )
            assert m.calculated_state == ev.state, (code, m.measured_at, m.value, m.secondary_value, ev.reasons)
            assert m.rule_version_id == version.id
            states.add(m.calculated_state)
            prev = m
            checked += 1
    assert checked >= 160
    assert states <= {"NORMAL", "MONITOR", "WARNING", "CRITICAL"} and "NORMAL" in states


def test_analog_reseed_does_not_duplicate_alerts(db):
    analog_ids = [u.id for u in db.query(User).filter(User.crew_code.like("HDBR-%")).all()]
    assert len(analog_ids) == 3

    def snapshot():
        return sorted(
            (a.id, a.status) for a in db.query(Alert).filter(Alert.astronaut_id.in_(analog_ids)).all()
        )

    before = snapshot()
    result = sa.seed_analog_bed_rest(db)
    assert result["alerts"] == 0, "las alertas de hoy ya existen: reiniciar no las toca"
    assert snapshot() == before
    for a in db.query(Alert).filter(Alert.astronaut_id.in_(analog_ids)).all():
        assert a.is_simulated is False and a.rule_version_label == CALIBRATION_VERSION
        assert a.immediate_action.strip() and a.followup_recommendation.strip()


def test_alert_dedup_updates_the_open_alert_instead_of_creating_another(client, db):
    kenji = login(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD)
    kid = kenji["user"]["id"]
    assert open_alerts(db, kid, "SPO2") == []

    # 1) SpO2 93: amarillo del dataset y lejos de su línea base (98,5 ± 0,68) → WARNING, alerta nueva
    first = post_measurement(client, kenji, "SPO2", 93.0)
    assert first["measurement"]["calculated_state"] == "WARNING"
    generated = first["alert_generated"]
    assert generated["is_new"] is True and generated["priority"] == "HIGH"
    alert_id = generated["id"]
    immediate, followup = rec.build_alert_texts("SPO2", rec.LOW, "WARNING")
    assert generated["immediate_action"] == immediate == first["recommended_next_step"]
    assert generated["followup_recommendation"] == followup
    alert = get_alert(client, kenji, alert_id)
    assert (alert["operational_state"], alert["status"], alert["value_recorded"]) == ("WARNING", "NEW", "93")
    assert alert["rule_code"] == "RULE_SPO2_DEMO" and alert["rule_version_label"] == CALIBRATION_VERSION
    assert alert["explanation"].endswith(NON_DIAGNOSTIC_NOTE)
    assert CALIBRATION["SPO2"].source in alert["explanation"]
    created_at = alert["created_at"]

    # 2) Otra lectura anómala del mismo nivel: misma alerta, último valor
    second = post_measurement(client, kenji, "SPO2", 94.0)
    assert second["alert_generated"]["id"] == alert_id and second["alert_generated"]["is_new"] is False
    alert = get_alert(client, kenji, alert_id)
    assert (alert["operational_state"], alert["status"], alert["value_recorded"]) == ("WARNING", "NEW", "94")
    assert alert["created_at"] == created_at and alert["updated_at"] >= created_at

    # 3) Empeora a zona roja: misma alerta, sube a CRITICAL / prioridad CRITICAL y queda ESCALATED
    third = post_measurement(client, kenji, "SPO2", 90.0)
    assert third["measurement"]["calculated_state"] == "CRITICAL"
    assert third["alert_generated"]["id"] == alert_id and third["alert_generated"]["priority"] == "CRITICAL"
    alert = get_alert(client, kenji, alert_id)
    assert (alert["operational_state"], alert["priority"], alert["status"]) == ("CRITICAL", "CRITICAL", "ESCALATED")
    assert alert["title"].startswith("[CRITICAL]") and alert["value_recorded"] == "90"
    assert rec.LEVEL_STEP["CRITICAL"] in alert["immediate_action"]

    # 4) Una lectura menos grave actualiza el valor, pero no rebaja la alerta abierta
    fourth = post_measurement(client, kenji, "SPO2", 93.0)
    assert fourth["measurement"]["calculated_state"] == "WARNING"
    assert fourth["alert_generated"]["id"] == alert_id
    alert = get_alert(client, kenji, alert_id)
    assert (alert["operational_state"], alert["priority"], alert["value_recorded"]) == ("CRITICAL", "CRITICAL", "93")
    assert "Última lectura en nivel WARNING; la alerta se mantiene en CRITICAL" in alert["explanation"]

    # 5) Una lectura normal no genera alerta ni toca la abierta
    normal = post_measurement(client, kenji, "SPO2", 98.0)
    assert normal["measurement"]["calculated_state"] == "NORMAL" and normal["alert_generated"] is None
    db.expire_all()
    assert [a.id for a in open_alerts(db, kid, "SPO2")] == [alert_id]

    # 6) Resuelta por una persona: la siguiente lectura anómala abre una alerta nueva
    resolved = client.post(
        f"/api/v1/alerts/{alert_id}/followup", headers=kenji["headers"],
        json={"action_type": "RESOLVED", "notes": "Sensor recolocado; lectura normal."},
    )
    assert resolved.status_code == 200 and resolved.json()["alert"]["status"] == "RESOLVED"
    again = post_measurement(client, kenji, "SPO2", 93.0)
    assert again["alert_generated"]["is_new"] is True and again["alert_generated"]["id"] != alert_id
    db.expire_all()
    assert len(open_alerts(db, kid, "SPO2")) == 1


def test_alert_dedup_respects_the_lifecycle(client, db):
    kenji = login(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD)
    # FR 22: amarillo (> 20) y lejos de su línea base (13,5 ± 1,5) → WARNING
    first = post_measurement(client, kenji, "RESP_RATE", 22.0)
    assert first["measurement"]["calculated_state"] == "WARNING"
    alert_id = first["alert_generated"]["id"]
    ack = client.post(
        f"/api/v1/alerts/{alert_id}/acknowledge", headers=kenji["headers"],
        json={"action_taken": "Repito la medición en reposo."},
    )
    assert ack.status_code == 200 and ack.json()["alert"]["status"] == "ACKNOWLEDGED"

    # Otra lectura del mismo nivel no devuelve la alerta a NEW ni borra el reconocimiento
    second = post_measurement(client, kenji, "RESP_RATE", 23.0)
    assert second["alert_generated"]["id"] == alert_id
    alert = get_alert(client, kenji, alert_id)
    assert alert["status"] == "ACKNOWLEDGED" and len(alert["acknowledgements"]) == 1
    assert alert["value_recorded"] == "23"

    # Si empeora a zona roja vuelve a pedir atención: ESCALATED, como una alerta crítica nueva
    third = post_measurement(client, kenji, "RESP_RATE", 25.0)
    assert third["alert_generated"]["id"] == alert_id
    alert = get_alert(client, kenji, alert_id)
    assert (alert["operational_state"], alert["status"]) == ("CRITICAL", "ESCALATED")
    assert len(alert["acknowledgements"]) == 1


def test_old_reading_is_not_stored_as_stale(client, db):
    kenji = login(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD)
    old = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    res = post_measurement(client, kenji, "BODY_TEMP", 36.6, measured_at=old)
    assert res["measurement"]["calculated_state"] == "NORMAL"
    assert any("antigüedad superior" in reason for reason in res["evaluation_reasons"])
    # El resumen sí lo muestra como dato vencido (se calcula al consultar, no se guarda)
    summary = client.get("/api/v1/health/summary", headers=kenji["headers"])
    assert summary.status_code == 200


def test_simulator_and_seed_leave_one_open_alert_per_indicator_with_recommendation(client, db):
    elena = login(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
    for scenario in ("SCENARIO_3_TREND_MONITORING", "SCENARIO_3_TREND_MONITORING",
                     "SCENARIO_4_CRITICAL_ESCALATION", "SCENARIO_5_SLEEP_FATIGUE"):
        run = client.post(
            "/api/v1/simulator/run", headers=elena["headers"],
            json={"scenario_code": scenario, "astronaut_id": elena["user"]["id"], "mission_id": 1},
        )
        assert run.status_code == 200, run.text
        assert run.json()["created_alerts"] >= 1, scenario

    db.expire_all()
    alerts = db.query(Alert).all()
    assert alerts
    seen = {}
    for a in alerts:
        assert a.immediate_action and a.immediate_action.strip(), a.rule_code
        assert a.followup_recommendation and a.followup_recommendation.strip(), a.rule_code
        if a.status in OPEN_ALERT_STATUSES and a.rule_code.endswith("_DEMO") and a.rule_code.startswith("RULE_") \
                and a.indicator_code in CALIBRATION and a.rule_code == f"RULE_{a.indicator_code}_DEMO":
            key = (a.astronaut_id, a.indicator_code, a.rule_code)
            seen[key] = seen.get(key, 0) + 1
    assert seen and max(seen.values()) == 1, {k: v for k, v in seen.items() if v > 1}

    # Escenario 4 (SpO2 89 %): zona roja del dataset → CRITICAL con la recomendación del catálogo
    spo2 = [a for a in open_alerts(db, elena["user"]["id"], "SPO2")]
    assert len(spo2) == 1 and spo2[0].operational_state == "CRITICAL" and spo2[0].status == "ESCALATED"
    assert spo2[0].immediate_action == rec.build_alert_texts("SPO2", rec.LOW, "CRITICAL")[0]
    # Escenario 3: pulso y presión suben frente a la línea base de Elena → alerta por desvío personal
    hr = open_alerts(db, elena["user"]["id"], "HEART_RATE")
    assert len(hr) == 1 and hr[0].operational_state in ("WARNING", "CRITICAL")


def test_deployed_database_gets_the_calibration_without_losing_data(tmp_path):
    """BD ya desplegada (reglas 1.0-DEMO, líneas base con DE 4.0): al reiniciar con el código nuevo entra
    la versión calibrada como vigente, la anterior deja de serlo y se corrigen las DE de relleno, sin
    borrar nada y sin pasos manuales."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'deployed.db'}", connect_args={"check_same_thread": False}, future=True
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)()
    try:
        seed_database(db, force_reseed_sim=True)

        # Deja la BD como la sembraba la versión anterior del código
        legacy_hr = dict(normal_min=52.0, normal_max=90.0, monitor_min=45.0, monitor_max=102.0,
                         warning_min=38.0, warning_max=115.0)
        for version in db.query(ClinicalRuleVersion).all():
            version.version_number = "1.0-DEMO"
            version.protocol_source = "SEMSA DEMO Reference Protocol (Ilustrativo / No Clínico)"
            version.change_reason = "Versión inicial de demostración."
        for rule in db.query(ClinicalRule).all():
            rule.current_version_number = "1.0-DEMO"
        hr_rule = db.query(ClinicalRule).filter(ClinicalRule.indicator_code == "HEART_RATE").one()
        for key, value in legacy_hr.items():
            setattr(hr_rule.versions[0], key, value)
        db.query(HealthBaseline).filter(HealthBaseline.is_simulated.is_(True)).update(
            {HealthBaseline.std_dev: 4.0}, synchronize_session=False
        )
        db.commit()
        old_version_ids = {v.id for v in db.query(ClinicalRuleVersion).all()}

        def counts():
            return (
                db.query(User).count(), db.query(HealthMeasurement).count(), db.query(Alert).count(),
                db.query(HealthBaseline).count(), db.query(Mission).count(),
            )

        before = counts()
        real_baselines = {
            (b.astronaut_id, b.indicator_code): b.std_dev
            for b in db.query(HealthBaseline).filter(HealthBaseline.is_simulated.is_(False)).all()
        }
        assert real_baselines

        seed_database(db)  # reinicio del servicio con el código nuevo
        db.expire_all()

        assert counts() == before
        for rule in db.query(ClinicalRule).all():
            versions = sorted(rule.versions, key=lambda v: v.id)
            assert [v.version_number for v in versions] == ["1.0-DEMO", CALIBRATION_VERSION], rule.rule_code
            assert [v.is_current for v in versions] == [False, True], rule.rule_code
            assert rule.current_version_number == CALIBRATION_VERSION
            assert versions[0].id in old_version_ids
        hr_rule = db.query(ClinicalRule).filter(ClinicalRule.indicator_code == "HEART_RATE").one()
        old_v, new_v = sorted(hr_rule.versions, key=lambda v: v.id)
        assert (old_v.normal_min, old_v.warning_max) == (52.0, 115.0)          # la versión anterior se conserva
        assert Thresholds.from_version(new_v) == Thresholds.from_calibration(CALIBRATION["HEART_RATE"])
        # Las mediciones antiguas siguen apuntando a la versión con la que se evaluaron
        assert db.query(HealthMeasurement).filter(
            HealthMeasurement.is_simulated.is_(True), HealthMeasurement.rule_version_id.in_(old_version_ids)
        ).count() > 0

        # Líneas base simuladas: DE del dataset (o 0.0 si no hay); las reales no se tocan
        simulated = db.query(HealthBaseline).filter(HealthBaseline.is_simulated.is_(True)).all()
        assert simulated and all(b.std_dev == pytest.approx(demo_std_dev(b.indicator_code)) for b in simulated)
        assert {
            (b.astronaut_id, b.indicator_code): b.std_dev
            for b in db.query(HealthBaseline).filter(HealthBaseline.is_simulated.is_(False)).all()
        } == real_baselines

        # Una medición nueva ya se evalúa con la versión calibrada
        elena = db.query(User).filter(User.email == settings.DEMO_ASTRONAUT1_EMAIL).one()
        mission = db.query(Mission).order_by(Mission.id.asc()).first()
        hr_def = db.query(HealthIndicatorDefinition).filter(HealthIndicatorDefinition.code == "HEART_RATE").one()
        evaluation = evaluate_measurement(
            db, hr_def, elena.id, mission.id, 101.0, None, datetime.now(timezone.utc), "MANUAL_ENTRY"
        )
        assert evaluation.version.version_number == CALIBRATION_VERSION and evaluation.state == "WARNING"
        db.rollback()

        # Idempotente: otro reinicio no crea más versiones
        seed_database(db)
        db.expire_all()
        assert db.query(ClinicalRuleVersion).count() == 2 * len(CALIBRATION)
        assert counts() == before

        # Una versión creada después por un administrador no se pisa en el siguiente reinicio
        for v in hr_rule.versions:
            v.is_current = False
        db.add(ClinicalRuleVersion(
            rule_id=hr_rule.id, version_number="2.1-ADMIN", protocol_source="Ajuste del médico de vuelo",
            normal_min=50.0, normal_max=100.0, monitor_min=50.0, monitor_max=100.0, warning_min=40.0, warning_max=125.0,
            immediate_instructions="x", followup_instructions="y", escalation_conditions="z", is_current=True,
        ))
        hr_rule.current_version_number = "2.1-ADMIN"
        db.commit()
        seed_database(db)
        db.expire_all()
        current = [v.version_number for v in hr_rule.versions if v.is_current]
        assert current == ["2.1-ADMIN"] and hr_rule.current_version_number == "2.1-ADMIN"
    finally:
        db.close()
        engine.dispose()
