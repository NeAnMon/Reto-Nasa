"""Pruebas de las series de solo lectura de la Bitácora (backend/app/api/v1/logbook_router.py, issue #30)."""
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database.seed import seed_database
from backend.app.database.session import Base, get_db
from backend.app.main import app
from backend.app.models.models import HealthMeasurement
from backend.app.rules.calibration import RADIATION_CAREER_LIMIT_MSV
from backend.app.rules.engine import _cumulative_dose

TEST_DB_PATH = Path(__file__).resolve().parent / "test_logbook.db"
engine_lb = create_engine(f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False}, future=True)
LbSession = sessionmaker(autocommit=False, autoflush=False, bind=engine_lb, future=True)


def _override_get_db():
    db = LbSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def lb_database():
    previous_override = app.dependency_overrides.get(get_db)
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    Base.metadata.create_all(bind=engine_lb)
    db = LbSession()
    try:
        seed_database(db, force_reseed_sim=True)
    finally:
        db.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    if previous_override is not None:
        app.dependency_overrides[get_db] = previous_override
    else:
        app.dependency_overrides.pop(get_db, None)
    engine_lb.dispose()
    try:
        TEST_DB_PATH.unlink()
    except OSError:
        pass


@pytest.fixture(scope="module")
def client(lb_database):
    with TestClient(app) as c:
        yield c


def login(client, email, password):
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    return {"headers": {"Authorization": f"Bearer {data['access_token']}"}, "user": data["user"]}


@pytest.fixture(scope="module")
def users(client):
    return {
        "elena": login(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD),
        "marcus": login(client, settings.DEMO_ASTRONAUT2_EMAIL, settings.DEMO_ASTRONAUT2_PASSWORD),
        "leader": login(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD),
        "admin": login(client, settings.DEMO_ADMIN_EMAIL, settings.DEMO_ADMIN_PASSWORD),
    }


def test_radiation_dose_matches_rule_engine(client, users):
    elena = users["elena"]
    r = client.get("/api/v1/logbook/radiation-dose", headers=elena["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["astronaut_id"] == elena["user"]["id"]
    assert body["career_limit_msv"] == RADIATION_CAREER_LIMIT_MSV
    assert body["yellow_percent"] < body["red_percent"]
    pts = body["points"]
    assert pts, "la semilla trae dosis de radiación para Elena"
    dates = [p["date"] for p in pts]
    assert dates == sorted(dates) and len(dates) == len(set(dates))  # un punto por día UTC
    cums = [p["cumulative_dose"] for p in pts]
    assert all(b >= a for a, b in zip(cums, cums[1:]))
    for p in pts:
        assert p["percent_of_career_limit"] == pytest.approx(p["cumulative_dose"] / RADIATION_CAREER_LIMIT_MSV * 100, abs=1e-2)
        assert p["cumulative_state"] in ("NORMAL", "WARNING", "CRITICAL")

    # El último acumulado coincide con el del motor de reglas para esa lectura
    db = LbSession()
    try:
        last = (
            db.query(HealthMeasurement)
            .filter(
                HealthMeasurement.astronaut_id == elena["user"]["id"],
                HealthMeasurement.indicator_code == "RADIATION_EXPOSURE",
                HealthMeasurement.calculated_state != "INVALID",
            )
            .order_by(HealthMeasurement.measured_at.desc(), HealthMeasurement.id.desc())
            .first()
        )
        expected = _cumulative_dose(db, last.astronaut_id, "RADIATION_EXPOSURE", last.measured_at, last.value)
    finally:
        db.close()
    assert cums[-1] == pytest.approx(expected, abs=1e-3)


def test_radiation_dose_reflects_new_reading(client, users):
    elena = users["elena"]
    before = client.get("/api/v1/logbook/radiation-dose", headers=elena["headers"]).json()["points"]
    db = LbSession()
    try:
        last = (
            db.query(HealthMeasurement)
            .filter(HealthMeasurement.astronaut_id == elena["user"]["id"], HealthMeasurement.indicator_code == "RADIATION_EXPOSURE")
            .order_by(HealthMeasurement.measured_at.desc())
            .first()
        )
        db.add(
            HealthMeasurement(
                astronaut_id=last.astronaut_id,
                mission_id=last.mission_id,
                indicator_code="RADIATION_EXPOSURE",
                value=1.25,
                unit=last.unit,
                source_code=last.source_code,
                data_quality=last.data_quality,
                calculated_state="NORMAL",
                measured_at=last.measured_at + timedelta(days=1),
                phase_code=last.phase_code,
                environment_code=last.environment_code,
                is_simulated=False,
            )
        )
        db.commit()
    finally:
        db.close()
    after = client.get("/api/v1/logbook/radiation-dose", headers=elena["headers"]).json()["points"]
    assert len(after) == len(before) + 1
    assert after[-1]["daily_dose"] == 1.25 and after[-1]["is_simulated"] is False
    assert after[-1]["cumulative_dose"] == pytest.approx(before[-1]["cumulative_dose"] + 1.25, abs=1e-3)


def test_emotional_states_only_operational_state(client, users):
    elena = users["elena"]
    r = client.get("/api/v1/logbook/emotional-states", headers=elena["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["points"], "la semilla trae un cuestionario emocional completado de Elena"
    for p in body["points"]:
        assert set(p) == {"completed_at", "operational_state", "phase_code", "is_simulated"}
        assert p["operational_state"] in body["states"]


def test_logbook_series_permissions(client, users):
    elena, marcus, leader, admin = (users[k] for k in ("elena", "marcus", "leader", "admin"))
    eid = elena["user"]["id"]
    for path in ("/api/v1/logbook/radiation-dose", "/api/v1/logbook/emotional-states"):
        assert client.get(path).status_code == 401
        # un astronauta no ve los datos de otro
        assert client.get(f"{path}?astronaut_id={eid}", headers=marcus["headers"]).status_code == 403
        for viewer in (leader, admin):
            resp = client.get(f"{path}?astronaut_id={eid}", headers=viewer["headers"])
            assert resp.status_code == 200, resp.text
            assert resp.json()["astronaut_id"] == eid
