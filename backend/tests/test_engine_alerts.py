"""SEMSA · Pruebas · Alertas tempranas de todos los motores en GET /alerts (issue #30).

- Motor de origen (`source_engine`) deducido del prefijo de `rule_code` y filtro `?source_engine=`.
- Pronóstico: alerta temprana cuando el valor esperado cruza un umbral del motor calibrado.
- Entorno / radiación ambiental: alerta para la tripulación de la misión.
- Textos fijos con traducción EN en frontend/src/i18n/backend-en-runtime.js.

Run from repository root: pytest backend/tests/test_engine_alerts.py -q
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api.v1 import router as main_router_module
from backend.app.api.v1.prediction_router import router as prediction_router
from backend.app.core.config import settings
from backend.app.database.seed import seed_database
from backend.app.database.session import Base, get_db
from backend.app.main import app
from backend.app.models.models import (
    Alert, ClinicalRule, ClinicalRuleVersion, EnvironmentalMeasurement, HealthBaseline,
    HealthIndicatorDefinition, HealthMeasurement, Mission, MissionAssignment, Role, User,
)
from backend.app.rules import alert_sources as src
from backend.app.rules import environment_alerts as env
from backend.app.rules import prediction_alerts as pa
from backend.app.rules.calibration import CALIBRATION
from backend.app.rules.engine import OPEN_ALERT_STATUSES
from backend.app.rules.recommendations import HIGH, LEVEL_STEP, LOW, get_recommendation
from backend.app.security.auth import get_current_user
from backend.app.services.prediction_service import predict_indicator

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_JS = REPO_ROOT / "frontend" / "src" / "i18n" / "backend-en-runtime.js"
START = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)


# --------------------------------------------------------------------------------------------------
# Motor de origen
# --------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("rule_code, engine", [
    ("RULE_HEART_RATE_DEMO", "RULES"),
    ("RULE_SPO2_DEMO", "RULES"),
    ("RULE_RADIATION_EXPOSURE_DEMO", "RULES"),
    ("RULE_PREDICTION_EARLY_WARNING", "PREDICTION"),
    ("RULE_COGNITIVE_OBSERVATION_DEMO", "COGNITIVE"),
    ("RULE_EMOTIONAL_CHECKIN_DEMO", "EMOTIONAL"),
    ("RULE_EARLY_EARTH_CONTACT", "ISOLATION"),
    ("RULE_ENVIRONMENT_CO2_LEVEL", "ENVIRONMENT"),
    ("RULE_SUPPORT_REQUEST_EMERGENCY_DEMO", "SUPPORT"),
    (None, "RULES"),
])
def test_source_engine_from_rule_code(rule_code, engine):
    assert src.alert_source_engine(rule_code) == engine
    assert engine in src.SOURCE_ENGINES


@pytest.mark.parametrize("rule_code, indicator_code, engine", [
    ("RULE_RADIATION_EXPOSURE_DEMO", "RADIATION_EXPOSURE", "RADIATION"),
    ("RULE_ENVIRONMENT_RADIATION_DOSE", "RADIATION_DOSE", "RADIATION"),
    ("RULE_ENVIRONMENT_CO2_LEVEL", "CO2_LEVEL", "ENVIRONMENT"),
    ("RULE_HEART_RATE_DEMO", "HEART_RATE", "RULES"),
    # La alerta temprana del pronóstico sobre la dosis sigue siendo del motor PREDICTION
    ("RULE_PREDICTION_EARLY_WARNING", "RADIATION_EXPOSURE", "PREDICTION"),
])
def test_radiation_is_its_own_source_engine(rule_code, indicator_code, engine):
    assert src.alert_source_engine(rule_code, indicator_code) == engine
    assert "RADIATION" in src.SOURCE_ENGINES


def test_early_warning_flag():
    assert src.is_early_warning_alert("RULE_EARLY_EARTH_CONTACT")
    assert src.is_early_warning_alert(pa.PREDICTION_RULE)
    assert not src.is_early_warning_alert("RULE_HEART_RATE_DEMO")
    assert not src.is_early_warning_alert("RULE_ENVIRONMENT_CO2_LEVEL")


def test_every_alert_rule_code_in_the_backend_maps_to_its_engine():
    """Cada rule_code literal con el que el backend crea alertas cae en el motor de su módulo."""
    app_dir = REPO_ROOT / "backend" / "app"
    expected = {
        "services/cognitive_engine.py": "COGNITIVE",
        "services/emotional_engine.py": "EMOTIONAL",
        "api/v1/expansion_router.py": "SUPPORT",
        "rules/early_warnings.py": "ISOLATION",
        "rules/prediction_alerts.py": "PREDICTION",
    }
    for rel, engine in expected.items():
        text = (app_dir / rel).read_text(encoding="utf-8")
        codes = set(re.findall(r'"(RULE_[A-Z_]+)"', text)) - {"RULE_EARLY_", "RULE_PREDICTION_"}
        assert codes, rel
        assert {src.alert_source_engine(c) for c in codes} == {engine}, (rel, codes)
    assert src.alert_source_engine(f"{env.ENVIRONMENT_RULE_PREFIX}PPO2") == "ENVIRONMENT"


# --------------------------------------------------------------------------------------------------
# Pronóstico (sin app completa)
# --------------------------------------------------------------------------------------------------
@pytest.fixture
def mem_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def astro(mem_db):
    db = mem_db
    db.add(Role(id=1, code="ASTRONAUT", name="Astronaut"))
    db.flush()
    user = User(id=1, role_id=1, crew_code="AST-001", email="astronaut@example.test",
                password_hash="test", full_name="Astronauta Privada")
    mission = Mission(id=1, code="TEST", name="Test Mission", description="test",
                      vehicle_or_habitat="test", current_phase="ORBIT")
    indicator = HealthIndicatorDefinition(
        code="HEART_RATE", name="Frecuencia Cardíaca", category="CARDIOVASCULAR",
        body_region_code="CHEST", unit="bpm", min_valid_value=30, max_valid_value=200,
        step_by_step_instructions="test", educational_summary="test", spaceflight_risk_explanation="test",
    )
    db.add_all([user, mission, indicator])
    db.flush()
    db.add(MissionAssignment(user_id=1, mission_id=1, assignment_role="ASTRONAUT", is_active=True))
    rule = ClinicalRule(rule_code="RULE_HEART_RATE_TEST", indicator_code="HEART_RATE", name="Regla", is_active=True)
    db.add(rule)
    db.flush()
    db.add(ClinicalRuleVersion(
        rule_id=rule.id, version_number="1.0-TEST", normal_min=60, normal_max=100, monitor_min=50,
        monitor_max=110, warning_min=40, warning_max=130, immediate_instructions="x",
        followup_instructions="Registrar medición de seguimiento (texto de la regla).",
        escalation_conditions="x", is_current=True,
    ))
    db.commit()
    return user


def add_series(db, *, slope=2, offset=70, n=12, simulated=False):
    for i in range(n):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE", value=offset + slope * i, unit="bpm",
            measured_at=START + timedelta(days=i), phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="SYNTHETIC_DEMO" if simulated else "VALIDATED", calculated_state="NORMAL",
            is_simulated=simulated,
        ))
    db.commit()


# "Hoy" de las series de prueba: el día siguiente al último dato (los datos no están desfasados)
SERIES_NOW = START + timedelta(days=12)


def predict(db):
    return predict_indicator(db, 1, 1, "HEART_RATE", 7, include_simulated=False, now=SERIES_NOW)


def test_prediction_crossing_creates_one_early_alert_with_recommendation(mem_db, astro):
    db = mem_db
    add_series(db)  # 70 … 92: el valor esperado sale del rango normal (100) en 5 días
    r = predict(db)
    assert r.recommendation["basis"] == "expected_crossing"

    alert, created = pa.upsert_prediction_alert(db, 1, 1, r, now=SERIES_NOW)
    db.commit()
    assert created is True
    assert alert.rule_code == pa.PREDICTION_RULE and src.alert_source_engine(alert.rule_code) == "PREDICTION"
    assert alert.indicator_code == "HEART_RATE"
    assert (alert.operational_state, alert.priority, alert.status) == ("MONITOR", "LOW", "NEW")
    assert alert.title == "[ALERTA TEMPRANA] Pronóstico de Frecuencia Cardíaca: nivel MONITOR en 5 día(s)"
    assert alert.value_recorded == pa._fmt(r.forecast[4]["value"]) and alert.unit == "bpm"
    assert alert.rule_version_label == "1.0-TEST" and alert.rule_version_id is not None
    assert "regla RULE_HEART_RATE_TEST v1.0-TEST" in alert.explanation and "; umbral 100 bpm" in alert.explanation
    assert alert.explanation.endswith(f"{pa.PREDICTION_NOTE_IN_RANGE} {pa.PREDICTION_NOTE_NON_DIAGNOSTIC}")
    # Recomendación propia: paso del pronóstico + nivel de observación; seguimiento del catálogo
    assert alert.immediate_action == f"{pa.PREDICTION_IMMEDIATE_STEP}\n{LEVEL_STEP['MONITOR']}"
    assert alert.followup_recommendation == get_recommendation("HEART_RATE", HIGH).followup
    assert alert.data_quality == "VALIDATED" and alert.is_simulated is False
    # Privacidad: ni nombre ni datos personales fuera del indicador
    assert "Astronauta Privada" not in alert.title + alert.explanation

    # Repetir el pronóstico no duplica: actualiza la alerta abierta
    again, created_again = pa.upsert_prediction_alert(db, 1, 1, predict(db), now=SERIES_NOW)
    db.commit()
    assert created_again is False and again.id == alert.id
    assert db.query(Alert).filter(Alert.rule_code == pa.PREDICTION_RULE).count() == 1

    # Resuelta por una persona: el siguiente cruce abre otra
    alert.status = "RESOLVED"
    db.commit()
    third, created_third = pa.upsert_prediction_alert(db, 1, 1, predict(db), now=SERIES_NOW)
    assert created_third is True and third.id != alert.id


def test_prediction_without_expected_crossing_gives_no_alert(mem_db, astro):
    add_series(mem_db, slope=0, offset=75)  # plano, lejos de los límites
    r = predict(mem_db)
    assert r.status == "ok" and r.recommendation["basis"] == "none"
    assert pa.upsert_prediction_alert(mem_db, 1, 1, r, now=SERIES_NOW) == (None, False)
    # Pronóstico no fiable o sin datos: tampoco
    assert pa.upsert_prediction_alert(mem_db, 1, 1, SimpleNamespace(status="insufficient_data")) == (None, False)
    assert mem_db.query(Alert).count() == 0


def test_prediction_alert_skipped_when_a_real_alert_is_already_open(mem_db, astro):
    db = mem_db
    add_series(db)
    db.add(Alert(
        astronaut_id=1, mission_id=1, indicator_code="HEART_RATE", rule_code="RULE_HEART_RATE_TEST",
        rule_version_label="1.0-TEST", priority="HIGH", operational_state="WARNING", status="NEW",
        title="t", explanation="e", immediate_action="i", followup_recommendation="f",
    ))
    db.commit()
    assert pa.upsert_prediction_alert(db, 1, 1, predict(db), now=SERIES_NOW) == (None, False)
    assert db.query(Alert).filter(Alert.rule_code == pa.PREDICTION_RULE).count() == 0


def test_prediction_endpoint_is_read_only(mem_db, astro):
    """GET /predictions no crea, actualiza ni retira alertas (la Bitácora lo abre con include_simulated=true);
    `early_warning_alert_id` solo informa de la alerta temprana ya abierta."""
    add_series(mem_db)
    add_series(mem_db, offset=71, simulated=True)
    application = FastAPI()
    application.include_router(prediction_router, prefix="/api/v1")
    application.dependency_overrides[get_db] = lambda: (yield mem_db)
    application.dependency_overrides[get_current_user] = lambda: astro
    with TestClient(application) as client:
        for include_simulated in ("false", "true"):
            resp = client.get("/api/v1/predictions/indicators/HEART_RATE",
                              params={"mission_id": 1, "include_simulated": include_simulated})
            assert resp.status_code == 200, resp.text
            assert resp.json()["early_warning_alert_id"] is None
        assert mem_db.query(Alert).count() == 0

        # Con una alerta temprana ya abierta (creada por el flujo de escritura) el GET solo la lee
        alert, created = pa.upsert_prediction_alert(mem_db, 1, 1, predict(mem_db), now=SERIES_NOW)
        mem_db.commit()
        assert created is True
        before = (alert.status, alert.updated_at, alert.value_recorded)
        resp = client.get("/api/v1/predictions/indicators/HEART_RATE",
                          params={"mission_id": 1, "include_simulated": "true"})
        assert resp.json()["early_warning_alert_id"] == alert.id
    mem_db.expire_all()
    stored = mem_db.query(Alert).one()
    assert (stored.status, stored.updated_at, stored.value_recorded) == before
    assert stored.rule_code == pa.PREDICTION_RULE and stored.status in OPEN_ALERT_STATUSES
    assert stored.followups == []


def fake_forecast(*, basis="expected_crossing", last_day=START.date() + timedelta(days=11), days_ahead=5,
                  state="MONITOR", value=101.0):
    """PredictionResult mínimo: el pronóstico empieza el día siguiente a `last_day`."""
    first = (last_day + timedelta(days=1)).isoformat()
    crossing = (last_day + timedelta(days=days_ahead)).isoformat()
    return SimpleNamespace(
        status="ok", indicator_code="HEART_RATE", unit="bpm", phase_code="ORBIT",
        environment_code="LOW_EARTH_ORBIT",
        forecast=[{"date": first, "value": 95.0, "t_ahead": 1},
                  {"date": crossing, "value": value, "t_ahead": days_ahead}],
        recommendation={
            "basis": basis, "state": state if basis == "expected_crossing" else None,
            "date": crossing if basis == "expected_crossing" else None,
            "days_ahead": days_ahead if basis == "expected_crossing" else None,
            "threshold": 100, "alert_direction": HIGH, "text": None,
        },
    )


def system_notes(alert):
    return [(f.author_role, f.action_type, f.notes) for f in alert.followups]


def test_prediction_alert_retired_when_the_forecast_no_longer_crosses(mem_db, astro):
    db = mem_db
    alert, created = pa.upsert_prediction_alert(db, 1, 1, fake_forecast(), now=SERIES_NOW)
    db.commit()
    assert created is True and alert.status == "NEW"
    # Un pronóstico no fiable no decide nada: la alerta sigue abierta
    assert pa.upsert_prediction_alert(db, 1, 1, SimpleNamespace(status="model_not_reliable"),
                                      now=SERIES_NOW) == (None, False)
    assert alert.status == "NEW"
    # Pronóstico fiable sin cruce: se retira (RESOLVED con nota de sistema, sin borrar)
    assert pa.upsert_prediction_alert(db, 1, 1, fake_forecast(basis="none"), now=SERIES_NOW) == (None, False)
    db.commit()
    db.refresh(alert)
    assert alert.status == "RESOLVED"
    assert system_notes(alert) == [("SYSTEM", "RESOLVED", pa.PREDICTION_RESOLVED_NO_CROSSING)]
    assert db.query(Alert).count() == 1


@pytest.mark.parametrize("forecast, reason", [
    # Último dato de hace más de 7 días
    (lambda: fake_forecast(last_day=SERIES_NOW.date() - timedelta(days=8), days_ahead=10), "stale"),
    # Fecha de cruce prevista anterior a hoy (UTC)
    (lambda: fake_forecast(last_day=SERIES_NOW.date() - timedelta(days=4), days_ahead=2), "past"),
])
def test_prediction_alert_not_created_and_retired_with_outdated_data(mem_db, astro, forecast, reason):
    db = mem_db
    assert pa.upsert_prediction_alert(db, 1, 1, forecast(), now=SERIES_NOW) == (None, False)
    assert db.query(Alert).count() == 0
    # Con una abierta, los datos desfasados la retiran
    alert, _ = pa.upsert_prediction_alert(db, 1, 1, fake_forecast(), now=SERIES_NOW)
    db.commit()
    assert pa.upsert_prediction_alert(db, 1, 1, forecast(), now=SERIES_NOW) == (None, False)
    db.commit()
    db.refresh(alert)
    assert alert.status == "RESOLVED", reason
    assert system_notes(alert) == [("SYSTEM", "RESOLVED", pa.PREDICTION_RESOLVED_STALE)]


def test_prediction_alert_retired_when_the_rule_engine_opens_a_real_alert(mem_db, astro):
    from backend.app.rules.engine import MeasurementEvaluation, get_active_rule_version, upsert_alert_for_measurement

    db = mem_db
    early, _ = pa.upsert_prediction_alert(db, 1, 1, fake_forecast(), now=SERIES_NOW)
    db.commit()
    m = HealthMeasurement(
        astronaut_id=1, mission_id=1, indicator_code="HEART_RATE", value=115.0, unit="bpm",
        measured_at=SERIES_NOW, phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
        data_quality="VALIDATED", calculated_state="WARNING", is_simulated=False,
    )
    db.add(m)
    db.flush()
    rule, version = get_active_rule_version(db, "HEART_RATE")
    defn = db.query(HealthIndicatorDefinition).filter(HealthIndicatorDefinition.code == "HEART_RATE").one()
    real, created = upsert_alert_for_measurement(db, m, defn, MeasurementEvaluation("WARNING", rule, version, ["x"]))
    db.commit()
    db.refresh(early)
    assert created is True and real.rule_code == "RULE_HEART_RATE_TEST" and real.status == "NEW"
    assert early.status == "RESOLVED"
    assert system_notes(early) == [("SYSTEM", "RESOLVED", pa.PREDICTION_RESOLVED_REAL_ALERT)]


def test_prediction_alert_update_refreshes_simulated_flag_and_quality(mem_db, astro):
    db = mem_db
    alert, _ = pa.upsert_prediction_alert(db, 1, 1, fake_forecast(), is_simulated=True, now=SERIES_NOW)
    db.commit()
    assert (alert.is_simulated, alert.data_quality) == (True, "SYNTHETIC_DEMO")
    again, created = pa.upsert_prediction_alert(db, 1, 1, fake_forecast(), is_simulated=False, now=SERIES_NOW)
    db.commit()
    assert created is False and again.id == alert.id
    assert (again.is_simulated, again.data_quality) == (False, "VALIDATED")


# --------------------------------------------------------------------------------------------------
# Entorno (lógica pura)
# --------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("code, value, expected", [
    ("CO2_LEVEL", 2.0, ("NORMAL", None)),
    ("CO2_LEVEL", 3.0, ("MONITOR", HIGH)),
    ("CO2_LEVEL", 4.8, ("WARNING", HIGH)),
    ("CO2_LEVEL", 9.0, ("CRITICAL", HIGH)),
    ("PPO2", 17.0, ("WARNING", LOW)),
    ("PPO2", 21.0, ("NORMAL", None)),
    ("HUMIDITY", 15.0, ("WARNING", LOW)),
    ("CABIN_TEMP", 28.0, ("MONITOR", HIGH)),
])
def test_environment_evaluation(code, value, expected):
    assert env.evaluate_environment(env.ENVIRONMENT_LIMITS[code], value) == expected


def test_environment_recommendations_cover_every_reachable_direction():
    for code, limit in env.ENVIRONMENT_LIMITS.items():
        th = limit.thresholds
        directions = {HIGH}
        if th.normal_min > 0:
            directions.add(LOW)
        for direction in directions:
            assert (code, direction) in env.ENVIRONMENT_RECOMMENDATIONS, (code, direction)
    assert (env.RADIATION_PARAMETER, HIGH) in env.ENVIRONMENT_RECOMMENDATIONS
    immediate, followup = env.environment_texts("CO2_LEVEL", HIGH, "WARNING")
    assert immediate.startswith("1. ") and immediate.endswith(LEVEL_STEP["WARNING"]) and "Fuente:" in followup


# --------------------------------------------------------------------------------------------------
# Con la app y el seed demo: entorno, /alerts y gancho de medición
# --------------------------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def session_factory(tmp_path_factory):
    path = tmp_path_factory.mktemp("engine_alerts") / "engine_alerts.db"
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


def mission_and_crew(db):
    mission = db.query(Mission).order_by(Mission.id.asc()).first()
    crew = {
        uid for (uid,) in db.query(MissionAssignment.user_id).filter(
            MissionAssignment.mission_id == mission.id, MissionAssignment.assignment_role == "ASTRONAUT",
            MissionAssignment.is_active.is_(True),
        ).all()
    }
    return mission, crew


def post_env(client, who, mission_id, code, name, value, unit):
    resp = client.post("/api/v1/environment/measurements", headers=who["headers"], json={
        "mission_id": mission_id, "environment_code": "LUNAR_SURFACE", "phase_code": "SURFACE",
        "parameter_code": code, "parameter_name": name, "value": value, "unit": unit,
        "source_code": "DEMO_SIMULATION", "is_simulated": True,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


def open_env_alerts(db, code):
    db.expire_all()
    return db.query(Alert).filter(
        Alert.rule_code == f"{env.ENVIRONMENT_RULE_PREFIX}{code}", Alert.status.in_(OPEN_ALERT_STATUSES)
    ).all()


def test_environment_measurement_alerts_the_whole_crew_once(client, db):
    leader = login(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)
    mission, crew = mission_and_crew(db)
    assert crew

    normal = post_env(client, leader, mission.id, "CO2_LEVEL", "Concentración de CO₂", 2.0, "mmHg")
    assert normal["calculated_state"] == "NORMAL" and normal["alerts_generated"] == []

    first = post_env(client, leader, mission.id, "CO2_LEVEL", "Concentración de CO₂", 4.8, "mmHg")
    assert first["calculated_state"] == "WARNING"
    assert {a["astronaut_id"] for a in first["alerts_generated"]} == crew
    assert {a["source_engine"] for a in first["alerts_generated"]} == {"ENVIRONMENT"}
    alerts = open_env_alerts(db, "CO2_LEVEL")
    assert len(alerts) == len(crew)
    for a in alerts:
        assert (a.operational_state, a.priority, a.status) == ("WARNING", "HIGH", "NEW")
        assert a.title == "[WARNING] Entorno de la misión · Concentración de CO₂: 4.8 mmHg"
        assert a.immediate_action == env.environment_texts("CO2_LEVEL", HIGH, "WARNING")[0]
        assert a.followup_recommendation == env.ENVIRONMENT_RECOMMENDATIONS[("CO2_LEVEL", HIGH)][1]
        assert a.explanation.endswith(env.ENVIRONMENT_NOTE_CREW)
        astro = db.query(User).filter(User.id == a.astronaut_id).one()
        assert astro.full_name not in a.title + a.explanation  # sin datos personales

    # Una lectura menos grave actualiza el valor pero no rebaja ni duplica
    second = post_env(client, leader, mission.id, "CO2_LEVEL", "Concentración de CO₂", 3.0, "mmHg")
    assert second["calculated_state"] == "MONITOR"
    again = open_env_alerts(db, "CO2_LEVEL")
    assert {a.id for a in again} == {a.id for a in alerts}
    assert {(a.operational_state, a.value_recorded) for a in again} == {("WARNING", "3")}

    # Unidad distinta o parámetro sin umbral: sin alerta
    assert post_env(client, leader, mission.id, "CO2_LEVEL", "CO₂", 1.0, "%")["alerts_generated"] == []
    assert post_env(client, leader, mission.id, "NOISE_DB", "Ruido", 90.0, "dBA")["alerts_generated"] == []


def test_ambient_radiation_uses_the_calibrated_rule_cutoffs(client, db):
    leader = login(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)
    mission, crew = mission_and_crew(db)
    cal = CALIBRATION["RADIATION_EXPOSURE"]
    ok = post_env(client, leader, mission.id, "RADIATION_DOSE", "Tasa de Radiación Ambiental", 0.46, "mSv/día")
    assert ok["calculated_state"] == "NORMAL"
    value = round((cal.normal[1] + cal.monitor[1]) / 2, 2)
    out = post_env(client, leader, mission.id, "RADIATION_DOSE", "Tasa de Radiación Ambiental", value, "mSv/día")
    assert out["calculated_state"] == "MONITOR"
    alerts = open_env_alerts(db, "RADIATION_DOSE")
    assert {a.astronaut_id for a in alerts} == crew
    assert all(a.rule_version_id is not None and a.priority == "LOW" for a in alerts)
    assert all(env.SRC_RADIATION in a.explanation for a in alerts)


def test_alerts_endpoint_exposes_and_filters_the_source_engine(client, db):
    leader = login(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)
    mission, _crew = mission_and_crew(db)
    post_env(client, leader, mission.id, "PPO2", "Presión Parcial de Oxígeno (ppO₂)", 17.0, "kPa")

    resp = client.get("/api/v1/alerts", headers=leader["headers"])
    assert resp.status_code == 200
    alerts = resp.json()["alerts"]
    assert alerts and all(a["source_engine"] in src.SOURCE_ENGINES for a in alerts)
    assert all(a["source_engine"] == src.alert_source_engine(a["rule_code"], a["indicator_code"]) for a in alerts)
    assert all(a["is_early_warning"] == src.is_early_warning_alert(a["rule_code"]) for a in alerts)
    assert "ENVIRONMENT" in {a["source_engine"] for a in alerts}

    only_env = client.get("/api/v1/alerts", params={"source_engine": "environment"}, headers=leader["headers"])
    assert only_env.status_code == 200
    assert only_env.json()["alerts"] and {a["source_engine"] for a in only_env.json()["alerts"]} == {"ENVIRONMENT"}
    assert not any(a["indicator_code"].startswith("RADIATION") for a in only_env.json()["alerts"])
    only_rules = client.get("/api/v1/alerts", params={"source_engine": "RULES"}, headers=leader["headers"])
    assert only_rules.json()["alerts"] and {a["source_engine"] for a in only_rules.json()["alerts"]} == {"RULES"}
    assert not any(a["indicator_code"].startswith("RADIATION") for a in only_rules.json()["alerts"])
    bad = client.get("/api/v1/alerts", params={"source_engine": "NOPE"}, headers=leader["headers"])
    assert bad.status_code == 422


def test_radiation_alerts_are_listed_and_filtered_as_radiation(client, db):
    """Radiación es un motor propio: la tasa ambiental (entorno) y la dosis personal (motor de reglas)."""
    leader = login(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)
    mission, _crew = mission_and_crew(db)
    cal = CALIBRATION["RADIATION_EXPOSURE"]
    out = post_env(client, leader, mission.id, "RADIATION_DOSE", "Tasa de Radiación Ambiental",
                   round((cal.normal[1] + cal.monitor[1]) / 2, 2), "mSv/día")
    assert out["alerts_generated"] and {a["source_engine"] for a in out["alerts_generated"]} == {"RADIATION"}

    # Dosis personal del motor de reglas (RULE_RADIATION_EXPOSURE_*) para un astronauta de la tripulación
    elena = login(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
    personal = client.post("/api/v1/health/measurements", headers=elena["headers"], json={
        "indicator_code": "RADIATION_EXPOSURE", "value": round(cal.warning[1] - 0.1, 2),
        "source_code": "DEMO_SIMULATION", "data_quality": "SYNTHETIC_DEMO", "is_simulated": True,
    })
    assert personal.status_code == 201, personal.text
    assert personal.json()["alert_generated"] is not None

    resp = client.get("/api/v1/alerts", params={"source_engine": "radiation"}, headers=leader["headers"])
    assert resp.status_code == 200, resp.text
    rad = resp.json()["alerts"]
    assert rad and {a["source_engine"] for a in rad} == {"RADIATION"}
    assert all(a["indicator_code"].startswith("RADIATION") for a in rad)
    assert {"RADIATION_DOSE", "RADIATION_EXPOSURE"} <= {a["indicator_code"] for a in rad}
    assert {src.alert_source_engine(a["rule_code"]) for a in rad} <= {"RULES", "ENVIRONMENT"}


def test_environment_measurement_access_and_input_validation(client, db):
    leader = login(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)
    mission, crew = mission_and_crew(db)
    payload = {
        "mission_id": mission.id, "environment_code": "LUNAR_SURFACE", "phase_code": "SURFACE",
        "parameter_code": "CABIN_TEMP", "parameter_name": "Temperatura", "value": 31.0, "unit": "°C",
        "source_code": "DEMO_SIMULATION", "is_simulated": True,
    }
    # Misión inexistente → 404
    missing = client.post("/api/v1/environment/measurements", headers=leader["headers"],
                          json={**payload, "mission_id": 999999})
    assert missing.status_code == 404
    # NaN / inf → 422 (JSON con literales no estándar, como los acepta json.loads)
    for literal in ("NaN", "Infinity", "-Infinity"):
        body = json.dumps({**payload, "value": 0.0}).replace("0.0", literal)
        bad = client.post("/api/v1/environment/measurements", content=body,
                          headers={**leader["headers"], "Content-Type": "application/json"})
        assert bad.status_code == 422, (literal, bad.text)

    # Astronauta sin asignación activa a la misión (Kenji solo está en la misión 2) → 403, sin medición
    kenji = login(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD)
    kid = kenji["user"]["id"]
    assert kid not in crew
    count_before = db.query(EnvironmentalMeasurement).count()
    denied = client.post("/api/v1/environment/measurements", headers=kenji["headers"], json=payload)
    assert denied.status_code == 403
    db.expire_all()
    assert db.query(EnvironmentalMeasurement).count() == count_before

    # Texto libre del usuario: nunca en el título de la alerta (nombre canónico del parámetro)
    rogue = {**payload, "parameter_name": "EVACUAR YA: orden del comandante"}
    led = client.post("/api/v1/environment/measurements", headers=leader["headers"], json=rogue)
    assert led.status_code == 201, led.text
    titles = {a["title"] for a in led.json()["alerts_generated"]}
    assert titles and all("EVACUAR" not in t and env.ENVIRONMENT_PARAMETER_NAMES["CABIN_TEMP"] in t for t in titles)
    assert led.json()["crew_alerts_count"] == len(crew)
    assert {a["astronaut_id"] for a in led.json()["alerts_generated"]} == crew  # el líder supervisa la tripulación

    # Un astronauta asignado puede registrar, pero solo ve el detalle de su propia alerta
    elena = login(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
    eid = elena["user"]["id"]
    assert eid in crew and len(crew) > 1
    own = client.post("/api/v1/environment/measurements", headers=elena["headers"], json=rogue)
    assert own.status_code == 201, own.text
    assert own.json()["crew_alerts_count"] == len(crew)
    assert {a["astronaut_id"] for a in own.json()["alerts_generated"]} == {eid}

    # Un líder que no supervisa la misión de Kenji no recibe ids de esa tripulación
    k_mission = db.query(MissionAssignment.mission_id).filter(MissionAssignment.user_id == kid).first()[0]
    foreign = client.post("/api/v1/environment/measurements", headers=leader["headers"],
                          json={**rogue, "mission_id": k_mission})
    assert foreign.status_code == 201, foreign.text
    assert foreign.json()["crew_alerts_count"] >= 1 and foreign.json()["alerts_generated"] == []


def test_open_alerts_are_never_pushed_out_of_the_list_limit(client, db):
    kenji = login(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD)
    kid = kenji["user"]["id"]
    mission_id = db.query(MissionAssignment.mission_id).filter(MissionAssignment.user_id == kid).first()[0]
    now = datetime.now(timezone.utc)
    common = dict(astronaut_id=kid, mission_id=mission_id, indicator_code="HEART_RATE",
                  rule_code="RULE_TEST_LIMIT_ORDER", rule_version_label="1.0-TEST", priority="LOW",
                  operational_state="MONITOR", explanation="e", immediate_action="i", followup_recommendation="f")
    old_open = Alert(status="NEW", title="abierta antigua", created_at=now - timedelta(days=3650),
                     updated_at=now - timedelta(days=3650), **common)
    resolved = [Alert(status="RESOLVED", title=f"resuelta {i}", created_at=now - timedelta(minutes=i),
                      updated_at=now, **common) for i in range(120)]
    db.add(old_open)
    db.add_all(resolved)
    db.commit()
    try:
        listed = client.get("/api/v1/alerts", params={"astronaut_id": kid}, headers=kenji["headers"]).json()["alerts"]
        assert len(listed) == 100
        ids = [a["id"] for a in listed]
        assert old_open.id in ids
        statuses = [a["status"] for a in listed]
        first_resolved = statuses.index("RESOLVED")
        assert all(s in OPEN_ALERT_STATUSES for s in statuses[:first_resolved])
        assert all(s == "RESOLVED" for s in statuses[first_resolved:])
    finally:
        db.query(Alert).filter(Alert.rule_code == "RULE_TEST_LIMIT_ORDER").delete()
        db.commit()


def test_normal_measurement_runs_the_forecast_and_returns_the_early_alert(client, db, monkeypatch):
    """Gancho de POST /health/measurements: tras una lectura normal se pronostica el indicador y, si el
    valor esperado cruza un umbral, la alerta temprana aparece en la respuesta y en GET /alerts."""
    kenji = login(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD)
    kid = kenji["user"]["id"]
    # Sin otra alerta abierta de temperatura (si la hubiera, el pronóstico no abre otra)
    for a in db.query(Alert).filter(Alert.astronaut_id == kid, Alert.indicator_code == "BODY_TEMP").all():
        a.status = "RESOLVED"
    db.commit()
    base = db.query(HealthBaseline).filter(
        HealthBaseline.astronaut_id == kid, HealthBaseline.indicator_code == "BODY_TEMP"
    ).first()
    normal_value = round(base.baseline_value, 1) if base is not None else 36.6
    calls = []

    def fake_predict(db, astronaut_id, mission_id, indicator_code, horizon_days, include_simulated=True, now=None):
        calls.append((astronaut_id, indicator_code, include_simulated))
        return SimpleNamespace(
            status="ok", indicator_code=indicator_code, unit="°C", phase_code="SURFACE",
            environment_code="LUNAR_SURFACE",
            forecast=[{"date": "2030-01-03", "value": 37.6}],
            recommendation={"basis": "expected_crossing", "state": "WARNING", "date": "2030-01-03",
                            "days_ahead": 3, "threshold": 37.5, "alert_direction": HIGH, "text": None},
        )

    monkeypatch.setattr(main_router_module, "predict_indicator", fake_predict)
    resp = client.post("/api/v1/health/measurements", headers=kenji["headers"], json={
        "indicator_code": "BODY_TEMP", "value": normal_value, "source_code": "DEMO_SIMULATION",
        "data_quality": "SYNTHETIC_DEMO", "is_simulated": True,
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["measurement"]["calculated_state"] == "NORMAL"
    early = body["early_warning_alert"]
    assert calls == [(kid, "BODY_TEMP", True)]
    assert early is not None and early["source_engine"] == "PREDICTION" and early["priority"] == "MEDIUM"
    assert early["followup_recommendation"] == get_recommendation("BODY_TEMP", HIGH).followup

    listed = client.get("/api/v1/alerts", params={"source_engine": "PREDICTION", "astronaut_id": kid},
                        headers=kenji["headers"]).json()["alerts"]
    assert [a["id"] for a in listed] == [early["id"]]
    assert listed[0]["is_early_warning"] is True and listed[0]["operational_state"] == "MONITOR"

    # Una lectura fuera de rango no pasa por el pronóstico (la cubre el motor de reglas)
    out = client.post("/api/v1/health/measurements", headers=kenji["headers"], json={
        "indicator_code": "BODY_TEMP", "value": 38.6, "source_code": "DEMO_SIMULATION",
        "data_quality": "SYNTHETIC_DEMO", "is_simulated": True,
    })
    assert out.status_code == 201 and out.json()["early_warning_alert"] is None
    assert len(calls) == 1


def test_forecast_failure_never_blocks_the_measurement(client, monkeypatch):
    kenji = login(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD)

    def boom(*args, **kwargs):
        raise ValueError("Too many eligible measurements")

    monkeypatch.setattr(main_router_module, "predict_indicator", boom)
    resp = client.post("/api/v1/health/measurements", headers=kenji["headers"], json={
        "indicator_code": "HEART_RATE", "value": 66.0, "source_code": "DEMO_SIMULATION",
        "data_quality": "SYNTHETIC_DEMO", "is_simulated": True,
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["early_warning_alert"] is None


# --------------------------------------------------------------------------------------------------
# Traducción EN de los textos fijos
# --------------------------------------------------------------------------------------------------
def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


def _en_keys():
    text = RUNTIME_JS.read_text(encoding="utf-8")
    start = text.index("export const EXACT = {")
    block = text[start:text.index("\n};", start)]
    return {_norm(k.replace('\\"', '"')) for k in re.findall(r'^\s*"((?:[^"\\]|\\.)*)"\s*:', block, re.M)}


def test_new_alert_texts_have_english_translation():
    texts = {
        pa.PREDICTION_NOTE_IN_RANGE, pa.PREDICTION_NOTE_NON_DIAGNOSTIC, pa.PREDICTION_IMMEDIATE_STEP,
        env.ENVIRONMENT_NOTE_CREW, env.SRC_STD3001, env.SRC_SMAC, env.SRC_RADIATION,
        *(t for pair in env.ENVIRONMENT_RECOMMENDATIONS.values() for t in pair),
    }
    missing = sorted({_norm(t) for t in texts} - _en_keys())
    assert not missing, f"backend-en-runtime.js is missing English translations for: {missing}"
    runtime = RUNTIME_JS.read_text(encoding="utf-8")
    for fragment in (
        r"Pronóstico de (.+): nivel ([A-Z_]+) en (\d+) día\(s\)",
        r"alcanzaría el nivel ([A-Z_]+) del motor de alertas",
        "Entorno de la misión · ",
        r"Alerta ambiental de la misión \((\S+)\)",
    ):
        assert fragment in runtime, f"backend-en-runtime.js needs a pattern for: {fragment}"
    for template in (pa.PREDICTION_TITLE, pa.PREDICTION_EXPLANATION, env.ENVIRONMENT_TITLE, env.ENVIRONMENT_EXPLANATION):
        assert "{" in template  # plantillas con valores: se traducen con PATTERNS
