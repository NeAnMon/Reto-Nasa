"""SEMSA · Pruebas · Misión análoga con signos vitales reales de NASA (reposo en cama, UTMB).

Verifica que el seed deja datos con los que el servicio de predicción genera pronósticos
con el valor por defecto de la API (`include_simulated=False`).

Run from repository root: pytest backend/tests/test_seed_analog.py -q
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database import seed_analog as sa
from backend.app.database.seed import seed_database
from backend.app.database.session import Base, get_db
from backend.app.main import app
from backend.app.models.models import (
    HealthBaseline,
    HealthMeasurement,
    Mission,
    MissionAssignment,
    User,
)
from backend.app.rules.calibration import CALIBRATION_VERSION
from backend.app.rules.engine import baseline_from_row, get_active_rule_version
from backend.app.rules.evaluation import PreviousReading, Thresholds, evaluate_reading
from backend.app.rules.recommendations import get_recommendation
from backend.app.services.prediction_service import predict_indicator


@pytest.fixture(scope="module")
def session_factory(tmp_path_factory):
    path = tmp_path_factory.mktemp("analog") / "analog.db"
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


def _astronaut(db, crew_code):
    return db.query(User).filter(User.crew_code == crew_code).one()


def _mission(db):
    return db.query(Mission).filter(Mission.code == sa.MISSION_CODE).one()


def test_analog_mission_is_labeled_as_real_ground_analog(db):
    mission = _mission(db)
    assert mission.is_simulated is False
    assert "análogo" in mission.name.lower() or "analog" in mission.name.lower()
    assert mission.current_phase == sa.BED_REST_PHASE
    crew = {
        u.crew_code
        for u in db.query(User).join(MissionAssignment, MissionAssignment.user_id == User.id)
        .filter(MissionAssignment.mission_id == mission.id, MissionAssignment.is_active.is_(True),
                MissionAssignment.assignment_role == "ASTRONAUT")
    }
    assert crew == {"HDBR-01", "HDBR-02", "HDBR-03"}


def test_measurements_are_real_validated_and_end_today(db):
    mission = _mission(db)
    rows = db.query(HealthMeasurement).filter(HealthMeasurement.mission_id == mission.id).all()
    assert rows
    assert {m.source_code for m in rows} == {sa.SOURCE_CODE}
    assert all(m.is_simulated is False and m.data_quality == "VALIDATED" for m in rows)
    assert {m.phase_code for m in rows} == {sa.PRE_PHASE, sa.BED_REST_PHASE}
    latest = max(m.measured_at for m in rows)
    latest = latest.replace(tzinfo=timezone.utc) if latest.tzinfo is None else latest
    assert latest.date() == datetime.now(timezone.utc).date()


def test_baselines_come_from_the_dataset(db):
    user = _astronaut(db, "HDBR-01")  # UTMB-17
    hr = db.query(HealthBaseline).filter(
        HealthBaseline.astronaut_id == user.id, HealthBaseline.indicator_code == "HEART_RATE"
    ).one()
    assert hr.is_simulated is False
    assert hr.std_dev > 0
    bp = db.query(HealthBaseline).filter(
        HealthBaseline.astronaut_id == user.id, HealthBaseline.indicator_code == "BLOOD_PRESSURE"
    ).one()
    assert bp.baseline_secondary_value is not None


def test_prediction_ok_with_api_default_real_data_only(db):
    user = _astronaut(db, "HDBR-01")
    result = predict_indicator(db, user.id, _mission(db).id, "HEART_RATE", 7, include_simulated=False)
    assert result.status == "ok"
    assert result.phase_code == sa.BED_REST_PHASE
    assert result.n_days >= 10
    assert result.beta1 > 0  # el pulso sube durante el reposo en cama
    assert len(result.forecast) == 7
    assert result.baseline_status == "available_unverified"
    assert result.baseline_is_simulated is False
    assert result.z_score is not None


@pytest.mark.parametrize("crew_code", ["HDBR-01", "HDBR-02"])
def test_all_four_indicators_ok_for_full_subjects(db, crew_code):
    user = _astronaut(db, crew_code)
    for code in sa.INDICATOR_COLUMNS:
        assert predict_indicator(db, user.id, _mission(db).id, code, 7).status == "ok", code


def test_third_subject_is_forecast_without_extrapolating_noise(db):
    """Con la compuerta calibrada la presión de UTMB-29 ya no se rechaza: el rechazo de la antigua
    validación de 3 días era ruido (ver test_prediction_calibration.py). Su pendiente no es
    significativa, así que el pronóstico es plano con bandas; la del pulso sí lo es y se informa.
    El estado `model_not_reliable` se prueba en test_prediction_service.py."""
    user = _astronaut(db, "HDBR-03")
    mission_id = _mission(db).id
    hr = predict_indicator(db, user.id, mission_id, "HEART_RATE", 7)
    assert hr.status == "ok"
    assert hr.trend["direction"] == "rising" and hr.trend["significant"] is True
    bp = predict_indicator(db, user.id, mission_id, "BLOOD_PRESSURE", 7)
    assert bp.status == "ok"
    assert bp.reliability["reliable"] is True and bp.reliability["skill_vs_naive"] > 0
    assert bp.trend["significant"] is False and bp.beta1 == 0
    assert len({p["value"] for p in bp.forecast}) == 1
    assert all(p["lower_95"] < p["lower_80"] < p["value"] < p["upper_80"] < p["upper_95"] for p in bp.forecast)
    assert bp.empirical_validation["validated_with_real_data"] is True


@pytest.mark.parametrize("crew_code", ["HDBR-01", "HDBR-02", "HDBR-03"])
def test_projection_matches_the_calibrated_alert_engine(db, crew_code):
    """Con las reglas y las líneas base sembradas, el estado proyectado de cada día es el que daría el
    motor de alertas (`evaluate_reading`) a ese nivel, y la recomendación sale del catálogo de alertas."""
    user = _astronaut(db, crew_code)
    mission_id = _mission(db).id
    for code in sa.INDICATOR_COLUMNS:
        result = predict_indicator(db, user.id, mission_id, code, 7)
        _, version = get_active_rule_version(db, code)
        projection = result.threshold_projection
        assert projection["rule_version"] == version.version_number == CALIBRATION_VERSION, code
        baseline = baseline_from_row(db.query(HealthBaseline).filter(
            HealthBaseline.astronaut_id == user.id, HealthBaseline.indicator_code == code
        ).first())
        for point in result.forecast:
            expected = evaluate_reading(
                code, point["value"], None, Thresholds.from_version(version), unit=result.unit,
                baseline=baseline, previous=PreviousReading(value=point["value"]),
            )
            assert point["projected_state"] == expected.state, (code, point["date"])
        # con línea base real el pronóstico publica el mismo z que usa el motor
        assert result.baseline_status == "available_unverified" and result.z_score is not None, code
        rec = result.recommendation
        if rec["basis"] == "none":
            assert rec["text"] is None
        elif rec["alert_direction"]:
            assert rec["source"] == "alert_recommendation_catalog"
            assert rec["text"] == get_recommendation(code, rec["alert_direction"]).followup, code


def test_reseed_is_idempotent_and_reanchors_to_new_today(db):
    mission = _mission(db)

    def counts():
        return (
            db.query(func.count(HealthMeasurement.id)).filter(HealthMeasurement.mission_id == mission.id).scalar(),
            db.query(func.count(User.id)).filter(User.crew_code.like("HDBR-%")).scalar(),
            db.query(func.count(MissionAssignment.id)).filter(MissionAssignment.mission_id == mission.id).scalar(),
        )

    before = counts()
    later = datetime.now(timezone.utc) + timedelta(days=5)
    sa.seed_analog_bed_rest(db, now=later)
    assert counts() == before
    latest = db.query(func.max(HealthMeasurement.measured_at)).filter(
        HealthMeasurement.mission_id == mission.id
    ).scalar()
    latest = latest.replace(tzinfo=timezone.utc) if latest.tzinfo is None else latest
    assert latest.date() == later.date()
    sa.seed_analog_bed_rest(db)  # deja la serie anclada a hoy para el resto de las pruebas


def test_synthetic_demo_crew_is_untouched(db):
    elena = db.query(User).filter(User.email == settings.DEMO_ASTRONAUT1_EMAIL).one()
    assert db.query(HealthMeasurement).filter(
        HealthMeasurement.astronaut_id == elena.id, HealthMeasurement.source_code == sa.SOURCE_CODE
    ).count() == 0
    assert db.query(MissionAssignment).filter(MissionAssignment.user_id == elena.id).count() == 1


def test_analog_astronaut_can_log_in_and_read_own_data(session_factory):
    def override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override
    try:
        with TestClient(app) as client:
            resp = client.post("/api/v1/auth/login", json={
                "email": "hdbr01@semsa.demo", "password": settings.DEMO_ANALOG_PASSWORD,
            })
            assert resp.status_code == 200, resp.text
            headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
            assert client.get("/api/v1/health/summary", headers=headers).status_code == 200
            measurements = client.get("/api/v1/health/measurements", headers=headers)
            assert measurements.status_code == 200
            phases = client.get("/api/v1/analytics/phase-comparison", headers=headers)
            assert phases.status_code == 200, phases.text
            body = phases.json()
            assert body["mission_code"] == sa.MISSION_CODE
            by_code = {p["phase_code"]: p for p in body["phases_comparison"]}
            assert by_code[sa.BED_REST_PHASE]["has_data"] is True
            assert by_code[sa.PRE_PHASE]["has_data"] is True
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous


def test_logged_measurement_continues_the_forecast_segment(session_factory):
    """Una lectura registrada desde la app en la misión análoga (que no tiene contexto operativo
    confirmado) se guarda con la fase vigente de la misión y continúa la serie. Antes quedaba con fase
    UNKNOWN, abría un segmento de un solo día y dejaba el pronóstico en datos insuficientes."""
    def override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    session = session_factory()
    mission_id = _mission(session).id
    session.close()
    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override
    try:
        with TestClient(app) as client:
            resp = client.post("/api/v1/auth/login", json={
                "email": "hdbr01@semsa.demo", "password": settings.DEMO_ANALOG_PASSWORD,
            })
            assert resp.status_code == 200, resp.text
            headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
            params = {"mission_id": mission_id, "horizon_days": 7}
            before = client.get("/api/v1/predictions/indicators/HEART_RATE", params=params, headers=headers)
            assert before.status_code == 200, before.text
            assert before.json()["status"] == "ok"

            created = client.post("/api/v1/health/measurements", headers=headers, json={
                "mission_id": mission_id, "indicator_code": "HEART_RATE", "value": 72,
            })
            assert created.status_code == 201, created.text
            session = session_factory()
            try:
                row = session.get(HealthMeasurement, created.json()["measurement"]["id"])
                assert (row.phase_code, row.environment_code) == (sa.BED_REST_PHASE, sa.BED_REST_ENV)
            finally:
                session.close()

            after = client.get("/api/v1/predictions/indicators/HEART_RATE", params=params, headers=headers)
            assert after.status_code == 200, after.text
            body = after.json()
            assert body["status"] == "ok"
            assert body["phase_code"] == sa.BED_REST_PHASE
            assert body["n_days"] >= before.json()["n_days"]
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous
