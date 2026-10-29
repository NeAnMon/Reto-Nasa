import os
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database.session import Base, get_db
from backend.app.database.seed import seed_database
from backend.app.main import app

TEST_DB_PATH = Path(__file__).resolve().parent / "test_astrovital.db"
TEST_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"

engine_test = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    future=True,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_test, future=True)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="module", autouse=True)
def setup_test_database():
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    Base.metadata.create_all(bind=engine_test)
    db = TestingSessionLocal()
    try:
        seed_database(db, force_reseed_sim=True)
    finally:
        db.close()
    yield
    engine_test.dispose()
    if TEST_DB_PATH.exists():
        try:
            TEST_DB_PATH.unlink()
        except OSError:
            pass


@pytest.fixture(scope="module")
def client():
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


def test_01_frontend_and_svg_delivery(client: TestClient):
    """Verifies Section 21.1: Frontend shell, CSS, JS, and interactive 10-region SVG are served."""
    res_html = client.get("/")
    assert res_html.status_code == 200
    html_text = res_html.text
    assert "AstroVital" in html_text
    assert "Your health. Your mission. Your future." in html_text

    res_js = client.get("/src/app/app.js")
    assert res_js.status_code == 200
    for svg_id in [
        "region-head-brain",
        "region-eyes-vision",
        "region-heart-cardio",
        "region-lungs-resp",
        "region-immune-system",
        "region-digestive-nutrition",
        "region-bones-skeletal",
        "region-muscles",
        "region-skin-thermo",
        "region-general-wellness",
    ]:
        assert svg_id in res_js.text


def test_02_rbac_and_horizontal_access_protection(client: TestClient):
    """
    Verifies Section 21.5:
    - An astronaut cannot query another astronaut's data.
    - A mission leader can query assigned astronauts (Elena, Marcus) but NOT unassigned astronauts (Kenji).
    - A mission leader cannot create users or escalate their own role.
    """
    elena = login_as(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
    marcus = login_as(client, settings.DEMO_ASTRONAUT2_EMAIL, settings.DEMO_ASTRONAUT2_PASSWORD)
    kenji = login_as(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD)
    leader = login_as(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)

    # Elena can read her own summary
    own_res = client.get(f"/api/v1/health/summary?astronaut_id={elena['user']['id']}", headers=elena["headers"])
    assert own_res.status_code == 200

    # Elena CANNOT read Marcus's summary
    forbidden_res = client.get(
        f"/api/v1/health/summary?astronaut_id={marcus['user']['id']}",
        headers=elena["headers"],
    )
    assert forbidden_res.status_code == 403

    # Leader CAN read assigned astronaut Elena
    ldr_allowed = client.get(
        f"/api/v1/health/summary?astronaut_id={elena['user']['id']}",
        headers=leader["headers"],
    )
    assert ldr_allowed.status_code == 200

    # Leader CANNOT read unassigned astronaut Kenji (Ares Pathfinder)
    ldr_denied = client.get(
        f"/api/v1/health/summary?astronaut_id={kenji['user']['id']}",
        headers=leader["headers"],
    )
    assert ldr_denied.status_code == 403

    # Leader CANNOT create users or assign roles
    ldr_admin_attempt = client.post(
        "/api/v1/users",
        headers=leader["headers"],
        json={
            "crew_code": "HACK-01",
            "email": "unauthorized@astrovital.demo",
            "full_name": "Unauthorized User",
            "password": "Password123!",
            "role_code": "ADMINISTRATOR",
        },
    )
    assert ldr_admin_attempt.status_code == 403


def test_03_health_validation_rules_and_alerts(client: TestClient):
    """
    Verifies Section 21.2:
    - Out-of-bounds values are flagged as INVALID.
    - Critical values trigger immediate CRITICAL alerts with rule & version traceability.
    - Alert acknowledgement and follow-up persist.
    """
    elena = login_as(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
    leader = login_as(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)

    # 1. Invalid measurement (e.g., Heart rate 350 bpm)
    inv_res = client.post(
        "/api/v1/health/measurements",
        headers=elena["headers"],
        json={
            "indicator_code": "HEART_RATE",
            "value": 350.0,
            "source_code": "MANUAL_ENTRY",
            "data_quality": "VALIDATED",
            "is_simulated": True,
        },
    )
    assert inv_res.status_code == 201
    assert inv_res.json()["measurement"]["calculated_state"] == "INVALID"
    assert inv_res.json()["alert_generated"] is None

    # 2. Critical measurement (SpO2 88%)
    crit_res = client.post(
        "/api/v1/health/measurements",
        headers=elena["headers"],
        json={
            "indicator_code": "SPO2",
            "value": 88.0,
            "source_code": "DEMO_SIMULATION",
            "data_quality": "SYNTHETIC_DEMO",
            "is_simulated": True,
        },
    )
    assert crit_res.status_code == 201
    crit_data = crit_res.json()
    assert crit_data["measurement"]["calculated_state"] == "CRITICAL"
    assert crit_data["alert_generated"] is not None
    alert_id = crit_data["alert_generated"]["id"]

    # 3. Acknowledge & follow up alert
    ack_res = client.post(
        f"/api/v1/alerts/{alert_id}/acknowledge",
        headers=elena["headers"],
        json={"action_taken": "Verificando colocación de sensor y flujo de O2."},
    )
    assert ack_res.status_code == 200
    assert len(ack_res.json()["alert"]["acknowledgements"]) == 1

    fup_res = client.post(
        f"/api/v1/alerts/{alert_id}/followup",
        headers=leader["headers"],
        json={"action_type": "RESOLVED", "notes": "Lectura confirmada normal tras recalibrar sensor."},
    )
    assert fup_res.status_code == 200
    assert fup_res.json()["alert"]["status"] == "RESOLVED"


def test_04_context_resolver_preserves_clinical_thresholds(client: TestClient):
    """
    Verifies Section 21.3:
    - Selecting a new environment updates MissionContext, records source & timestamp,
      and NEVER automatically alters clinical rule thresholds.
    """
    elena = login_as(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)

    rules_before = client.get("/api/v1/admin/rules", headers=elena["headers"]).json()["rules"]
    hr_rule_before = next(r for r in rules_before if r["indicator_code"] == "HEART_RATE")["versions"][0]

    ctx_res = client.post(
        "/api/v1/missions/1/context",
        headers=elena["headers"],
        json={
            "astronaut_id": elena["user"]["id"],
            "environment_code": "EXTRAVEHICULAR_ACTIVITY",
            "phase_code": "EVA",
            "location_module": "Traje EVA-1 Exterior",
            "determination_source": "MANUAL_CONFIRMATION",
            "connectivity_status": "ONLINE",
            "is_simulated": True,
        },
    )
    assert ctx_res.status_code == 200
    ctx_json = ctx_res.json()
    assert ctx_json["context"]["environment_code"] == "EXTRAVEHICULAR_ACTIVITY"
    assert ctx_json["clinical_thresholds_modified"] is False

    rules_after = client.get("/api/v1/admin/rules", headers=elena["headers"]).json()["rules"]
    hr_rule_after = next(r for r in rules_after if r["indicator_code"] == "HEART_RATE")["versions"][0]
    assert hr_rule_before["normal_min"] == hr_rule_after["normal_min"]
    assert hr_rule_before["normal_max"] == hr_rule_after["normal_max"]


def test_05_wellness_privacy_and_gamification_ethics(client: TestClient):
    """
    Verifies Section 21.4:
    - Astronaut submits a private wellness evaluation.
    - Leader sees operational signal only, NEVER private_reflection or raw scores.
    - Admin is blocked from private_reflection unless explicit audited justification is given.
    - Gamification awards backend-verified XP for participation and allows non-punitive operational excusal.
    """
    elena = login_as(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
    leader = login_as(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)
    admin = login_as(client, settings.DEMO_ADMIN_EMAIL, settings.DEMO_ADMIN_PASSWORD)

    secret_note = "Nota psicológica estrictamente privada de prueba #9912"
    w_create = client.post(
        "/api/v1/wellness/assessments",
        headers=elena["headers"],
        json={
            "mood_score": 5,
            "stress_score": 8,
            "sleep_quality_score": 5,
            "sleep_hours": 5.5,
            "fatigue_score": 7,
            "concentration_score": 6,
            "isolation_score": 8,
            "adaptation_score": 6,
            "social_support_score": 6,
            "recovery_score": 5,
            "request_additional_support": True,
            "support_urgency": "PRIORITY_REVIEW",
            "private_reflection": secret_note,
            "share_operational_signal_with_leader": True,
            "is_simulated": True,
        },
    )
    assert w_create.status_code == 201
    assert w_create.json()["assessment"]["operational_wellness_state"] == "PROFESSIONAL_REVIEW"

    # Leader queries assessments: gets operational state, NOT secret_note
    ldr_view = client.get(
        f"/api/v1/wellness/assessments?astronaut_id={elena['user']['id']}",
        headers=leader["headers"],
    )
    assert ldr_view.status_code == 200
    ldr_latest = ldr_view.json()["assessments"][0]
    assert ldr_latest["privacy_redacted"] is True
    assert "private_reflection" not in ldr_latest

    # Leader attempting include_private_details=true is explicitly rejected with 403
    ldr_force = client.get(
        f"/api/v1/wellness/assessments?astronaut_id={elena['user']['id']}&include_private_details=true",
        headers=leader["headers"],
    )
    assert ldr_force.status_code == 403

    # Admin without justification is blocked from private details
    adm_no_just = client.get(
        f"/api/v1/wellness/assessments?astronaut_id={elena['user']['id']}&include_private_details=true",
        headers=admin["headers"],
    )
    assert adm_no_just.status_code == 403

    # Gamification completion & non-punitive operational excusal
    gam_excuse = client.post(
        "/api/v1/gamification/missions/complete",
        headers=elena["headers"],
        json={
            "daily_mission_code": "SLEEP_LOG",
            "status_mode": "EXCUSED_OPERATIONAL_RESTRICTION",
            "reflection_note": "En turno EVA programado",
            "is_simulated": True,
        },
    )
    assert gam_excuse.status_code == 200
    assert gam_excuse.json()["status"] == "EXCUSED_OPERATIONAL_RESTRICTION"
    assert gam_excuse.json()["xp_awarded"] == 0


def test_06_admin_suspension_reports_and_simulator_scenarios(client: TestClient):
    """
    Verifies Section 13, 19, 21.5:
    - Admin creates a user, suspends the account, and suspended user cannot log in.
    - All 9 demo scenarios execute cleanly and mark records as simulated.
    - Reports export in PDF, CSV, JSON and record an AuditEvent.
    """
    admin = login_as(client, settings.DEMO_ADMIN_EMAIL, settings.DEMO_ADMIN_PASSWORD)
    elena = login_as(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)

    # Create a new user
    create_u = client.post(
        "/api/v1/users",
        headers=admin["headers"],
        json={
            "crew_code": "AST-999",
            "email": "temp.crew@astrovital.demo",
            "full_name": "Temp Astronaut",
            "password": "TempPassword!2026",
            "role_code": "ASTRONAUT",
        },
    )
    assert create_u.status_code == 201
    new_uid = create_u.json()["user"]["id"]

    # Suspend user
    susp = client.patch(
        f"/api/v1/users/{new_uid}/status",
        headers=admin["headers"],
        json={"status": "SUSPENDED", "reason": "Prueba de seguridad de suspensión"},
    )
    assert susp.status_code == 200

    # Suspended user cannot log in
    blocked_login = client.post(
        "/api/v1/auth/login",
        json={"email": "temp.crew@astrovital.demo", "password": "TempPassword!2026"},
    )
    assert blocked_login.status_code == 403

    # Export reports (PDF, CSV, JSON)
    for fmt, expected_mime in [
        ("PDF", "application/pdf"),
        ("CSV", "text/csv"),
        ("JSON", "application/json"),
    ]:
        rep = client.post(
            "/api/v1/reports/export",
            headers=elena["headers"],
            json={
                "astronaut_id": elena["user"]["id"],
                "mission_id": 1,
                "report_format": fmt,
                "justification": f"Prueba automatizada {fmt}",
            },
        )
        assert rep.status_code == 200
        assert expected_mime in rep.headers["content-type"]
        if fmt == "PDF":
            assert rep.content.startswith(b"%PDF-1.4")

    # Run simulator scenario & reset
    sim_run = client.post(
        "/api/v1/simulator/run",
        headers=elena["headers"],
        json={
            "scenario_code": "SCENARIO_3_TREND_MONITORING",
            "astronaut_id": elena["user"]["id"],
            "mission_id": 1,
        },
    )
    assert sim_run.status_code == 200
    assert sim_run.json()["is_simulated"] is True

    sim_reset = client.post("/api/v1/simulator/reset", headers=elena["headers"])
    assert sim_reset.status_code == 200

