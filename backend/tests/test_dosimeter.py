"""Lecturas del dosímetro activo de tripulación (CAD) guardadas en base de datos.

Contrato: GET/POST /api/v1/radiation/dosimeter-readings, mismo modelo de permisos que
/health/measurements (el líder registra para su tripulación; un ASTRONAUT solo para sí mismo).
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database.seed import seed_database
from backend.app.database.session import Base, get_db
from backend.app.main import app
from backend.app.models.models import DosimeterReading

TEST_DB_PATH = Path(__file__).resolve().parent / "test_dosimeter.db"
TEST_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"

engine_test = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    future=True,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_test, future=True)

URL = "/api/v1/radiation/dosimeter-readings"


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_test_database():
    # La sobreescritura de get_db se hace aquí (no al importar) para no interferir con otros módulos
    previous_override = app.dependency_overrides.get(get_db)
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    Base.metadata.create_all(bind=engine_test)
    db = TestingSessionLocal()
    try:
        seed_database(db, force_reseed_sim=True)
    finally:
        db.close()
    app.dependency_overrides[get_db] = override_get_db
    yield
    if previous_override is not None:
        app.dependency_overrides[get_db] = previous_override
    else:
        app.dependency_overrides.pop(get_db, None)
    engine_test.dispose()
    if TEST_DB_PATH.exists():
        try:
            TEST_DB_PATH.unlink()
        except OSError:
            pass


@pytest.fixture(scope="module")
def client(setup_test_database):
    with TestClient(app) as c:
        yield c


def login_as(client: TestClient, email: str, password: str) -> dict:
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    return {
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
        "user": data["user"],
        "token": data["access_token"],
    }


@pytest.fixture(scope="module")
def users(client):
    return {
        "elena": login_as(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD),
        "marcus": login_as(client, settings.DEMO_ASTRONAUT2_EMAIL, settings.DEMO_ASTRONAUT2_PASSWORD),
        "leader": login_as(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD),
    }


def _reading(astronaut_id, **extra):
    body = {
        "astronaut_id": astronaut_id,
        "device": "CAD-0082",
        "measured_at": "2026-11-10T08:30:00Z",
        "dose_mgy": 1.234,
        "rate_ugy_h": 12.5,
        "location": "Hábitat",
        "notes": "lectura de prueba",
    }
    body.update(extra)
    return body


def test_leader_posts_per_astronaut_and_get_is_isolated(client: TestClient, users):
    leader = users["leader"]
    elena_id = users["elena"]["user"]["id"]
    marcus_id = users["marcus"]["user"]["id"]

    r1 = client.post(URL, json=_reading(elena_id, device="CAD-ELENA"), headers=leader["headers"])
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    assert body1["duplicate_prevented"] is False
    assert body1["reading"]["astronaut_id"] == elena_id
    assert body1["reading"]["recorded_by_user_id"] == leader["user"]["id"]
    assert body1["reading"]["rate_ugy_h"] == 12.5

    # segunda lectura de Elena, más antigua: el GET debe devolverlas en orden ascendente
    r1b = client.post(
        URL,
        json=_reading(elena_id, device="CAD-ELENA", measured_at="2026-11-09T08:30:00Z", rate_ugy_h=None),
        headers=leader["headers"],
    )
    assert r1b.status_code == 201, r1b.text
    assert r1b.json()["reading"]["rate_ugy_h"] is None

    r2 = client.post(URL, json=_reading(marcus_id, device="CAD-MARCUS", dose_mgy=2.0), headers=leader["headers"])
    assert r2.status_code == 201, r2.text
    assert r2.json()["reading"]["astronaut_id"] == marcus_id

    g_elena = client.get(f"{URL}?astronaut_id={elena_id}", headers=leader["headers"])
    assert g_elena.status_code == 200, g_elena.text
    elena_rows = g_elena.json()["readings"]
    assert len(elena_rows) == 2
    assert {row["astronaut_id"] for row in elena_rows} == {elena_id}
    assert {row["device"] for row in elena_rows} == {"CAD-ELENA"}
    assert elena_rows[0]["measured_at"] < elena_rows[1]["measured_at"]

    g_marcus = client.get(f"{URL}?astronaut_id={marcus_id}", headers=leader["headers"])
    assert g_marcus.status_code == 200, g_marcus.text
    marcus_rows = g_marcus.json()["readings"]
    assert len(marcus_rows) == 1
    assert marcus_rows[0]["device"] == "CAD-MARCUS"

    # con la misión explícita devuelta por el GET se obtiene lo mismo
    mid = g_elena.json()["mission_id"]
    g_mid = client.get(f"{URL}?astronaut_id={elena_id}&mission_id={mid}&limit=1", headers=leader["headers"])
    assert g_mid.status_code == 200
    rows_mid = g_mid.json()["readings"]
    assert len(rows_mid) == 1  # limit=1 → solo la más reciente
    assert rows_mid[0]["measured_at"] == elena_rows[-1]["measured_at"]

    # el propio astronauta lee las suyas; no las de otro
    own = client.get(f"{URL}?astronaut_id={elena_id}", headers=users["elena"]["headers"])
    assert own.status_code == 200
    assert len(own.json()["readings"]) == 2
    other = client.get(f"{URL}?astronaut_id={marcus_id}", headers=users["elena"]["headers"])
    assert other.status_code == 403


def test_astronaut_cannot_post_for_another(client: TestClient, users):
    marcus_id = users["marcus"]["user"]["id"]
    res = client.post(URL, json=_reading(marcus_id), headers=users["elena"]["headers"])
    assert res.status_code == 403, res.text


def test_astronaut_can_post_own(client: TestClient, users):
    elena = users["elena"]
    res = client.post(
        URL,
        json=_reading(elena["user"]["id"], measured_at="2026-11-11T10:00:00Z"),
        headers=elena["headers"],
    )
    assert res.status_code == 201, res.text
    assert res.json()["reading"]["recorded_by_user_id"] == elena["user"]["id"]


def test_validation_errors(client: TestClient, users):
    leader = users["leader"]
    elena_id = users["elena"]["user"]["id"]
    neg = client.post(URL, json=_reading(elena_id, dose_mgy=-0.5), headers=leader["headers"])
    assert neg.status_code == 422, neg.text
    neg_rate = client.post(URL, json=_reading(elena_id, rate_ugy_h=-1), headers=leader["headers"])
    assert neg_rate.status_code == 422, neg_rate.text
    long_notes = client.post(URL, json=_reading(elena_id, notes="x" * 141), headers=leader["headers"])
    assert long_notes.status_code == 422, long_notes.text
    long_dev = client.post(URL, json=_reading(elena_id, device="D" * 33), headers=leader["headers"])
    assert long_dev.status_code == 422, long_dev.text
    bad_limit = client.get(f"{URL}?astronaut_id={elena_id}&limit=501", headers=leader["headers"])
    assert bad_limit.status_code == 422


def test_dedup_key_returns_existing_row(client: TestClient, users):
    leader = users["leader"]
    marcus_id = users["marcus"]["user"]["id"]
    payload = _reading(marcus_id, measured_at="2026-11-12T06:00:00Z", dedup_key="cad-test-dedup-1")
    first = client.post(URL, json=payload, headers=leader["headers"])
    assert first.status_code == 201, first.text
    assert first.json()["duplicate_prevented"] is False
    second = client.post(URL, json=payload, headers=leader["headers"])
    assert second.status_code in (200, 201), second.text
    assert second.json()["duplicate_prevented"] is True
    assert second.json()["reading"]["id"] == first.json()["reading"]["id"]

    db = TestingSessionLocal()
    try:
        assert db.query(DosimeterReading).filter(DosimeterReading.dedup_key == "cad-test-dedup-1").count() == 1
    finally:
        db.close()
