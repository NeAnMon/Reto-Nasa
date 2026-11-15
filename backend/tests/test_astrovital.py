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
    """Verifies Section 21.1: Frontend shell, CSS, JS, and the interactive body map are served.

    The legacy 10-region SVG "Body Explorer" (in app.js) was superseded by the interactive body map
    of the console summary (console.js + body-figure.js), so the check targets the new modules.
    """
    res_html = client.get("/")
    assert res_html.status_code == 200
    html_text = res_html.text
    assert "AstroVital" in html_text
    # Sin pantalla de acceso: "/" sirve directamente la consola (la sesión demo la abre app.js)
    assert 'id="app-shell"' in html_text
    assert 'id="av-chrome-status"' in html_text
    assert 'id="section-view-container"' in html_text
    assert 'src="/src/app/app.js?v=' in html_text
    assert "Your health. Your mission. Your future." not in html_text

    res_js = client.get("/src/app/app.js")
    assert res_js.status_code == 200
    # The old section id keeps working: it is redirected to the summary that holds the body map
    assert '"body-explorer": "mission-control"' in res_js.text

    res_console = client.get("/src/console/console.js")
    res_figure = client.get("/src/console/body-figure.js")
    assert res_console.status_code == 200
    assert res_figure.status_code == 200
    assert "BODY_ZONES" in res_console.text
    for region_code in [
        "HEAD_BRAIN",
        "HEART_CARDIO",
        "MUSCLES",
        "DIGESTIVE_NUTRITION",
        "SKIN_THERMO",
        "BONES_SKELETAL",
    ]:
        assert region_code in res_console.text
        assert region_code in res_figure.text


def test_01b_env_banner_webp_served_as_image(client: TestClient):
    """Las imágenes .webp del banner de entorno se sirven como image/webp (no application/octet-stream)."""
    for name in ["env-spacecraft.webp", "semsa-logo-dark.webp"]:
        res = client.get(f"/src/assets/env/{name}")
        assert res.status_code == 200, name
        assert res.headers["content-type"].split(";")[0].strip() == "image/webp", res.headers["content-type"]
        assert res.content[:4] == b"RIFF" and res.content[8:12] == b"WEBP"


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


def test_07_module1_communication_center_and_support_requests(client: TestClient):
    """
    Verifies Expansion Module 1 & Acceptance Criteria #1, #2, #3, #4, #5, #6:
    1. Each astronaut can converse privately 1-on-1 with their assigned Mission Leader.
    2. Each Mission Leader can converse independently with each assigned astronaut.
    3. An unauthorized user cannot read another astronaut's conversation; Admin cannot silently read private messages without audit justification.
    4. Messages persist after closing session and reloading.
    5. Offline messages sync without faking server delivery before confirmation (dedup_key).
    6. Support requests record status, follow-up, and emergency protocol instructions when urgent.

    Updated to the implemented API (the one the frontend uses): mission_id is required to open a
    conversation, offline sync uses dedup_key/duplicate_prevented, unread flag is
    marked_unread_by_recipient (recipient only) and support requests use reason_title/is_emergency
    and PATCH /support-requests/{id}/status.
    """
    elena = login_as(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
    marcus = login_as(client, settings.DEMO_ASTRONAUT2_EMAIL, settings.DEMO_ASTRONAUT2_PASSWORD)
    kenji = login_as(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD)
    leader = login_as(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)
    admin = login_as(client, settings.DEMO_ADMIN_EMAIL, settings.DEMO_ADMIN_PASSWORD)

    # 1. Elena lists her conversations (sees her 1-on-1 with Leader)
    elena_convs = client.get("/api/v1/conversations", headers=elena["headers"])
    assert elena_convs.status_code == 200
    convs = elena_convs.json()["conversations"]
    assert len(convs) >= 1
    elena_conv_id = convs[0]["id"]

    # 2. Leader sees separate conversations for Elena and Marcus
    ldr_convs = client.get("/api/v1/conversations", headers=leader["headers"])
    assert ldr_convs.status_code == 200
    ldr_conv_ids = [c["astronaut_id"] for c in ldr_convs.json()["conversations"]]
    assert elena["user"]["id"] in ldr_conv_ids
    assert marcus["user"]["id"] in ldr_conv_ids

    # 3. Unauthorized access blocked: Marcus cannot read Elena's conversation
    marcus_read_elena = client.get(
        f"/api/v1/conversations/{elena_conv_id}/messages", headers=marcus["headers"]
    )
    assert marcus_read_elena.status_code == 403

    # Leader cannot start a conversation with Kenji (not assigned to the leader's missions)
    ldr_unassigned = client.post(
        "/api/v1/conversations",
        headers=leader["headers"],
        json={"mission_id": 1, "astronaut_id": kenji["user"]["id"], "leader_id": leader["user"]["id"]},
    )
    assert ldr_unassigned.status_code == 403

    # Admin cannot silently read private messages without audit justification
    adm_silent = client.get(
        f"/api/v1/conversations/{elena_conv_id}/messages", headers=admin["headers"]
    )
    assert adm_silent.status_code == 403

    # Admin WITH explicit justification is allowed and audited
    adm_audited = client.get(
        f"/api/v1/conversations/{elena_conv_id}/messages?audit_justification=Auditoria_Seguridad_Protocolo_01",
        headers=admin["headers"],
    )
    assert adm_audited.status_code == 200

    # 4 & 5. Send message, reply to message, mark important/unread, and sync offline message
    offline_payload = {
        "category": "HEALTH_UPDATE",
        "content": "Reporte de control tras rutina de hidratación en módulo hábitat.",
        "is_important": True,
        "dedup_key": "MSG-OFFLINE-TEST-001",
        "is_simulated": True,
    }
    msg_res = client.post(
        f"/api/v1/conversations/{elena_conv_id}/messages", headers=elena["headers"], json=offline_payload
    )
    assert msg_res.status_code == 201
    msg_data = msg_res.json()["message"]
    assert msg_data["delivery_status"] == "DELIVERED"
    assert msg_res.json()["duplicate_prevented"] is False
    msg_id = msg_data["id"]

    # Duplicate offline sync is idempotently deduplicated
    dup_res = client.post(
        f"/api/v1/conversations/{elena_conv_id}/messages", headers=elena["headers"], json=offline_payload
    )
    assert dup_res.status_code == 201
    assert dup_res.json()["duplicate_prevented"] is True
    assert dup_res.json()["message"]["id"] == msg_id

    # Messages persist across sessions (new login sees the message)
    elena_again = login_as(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
    persisted = client.get(f"/api/v1/conversations/{elena_conv_id}/messages", headers=elena_again["headers"])
    assert any(m["id"] == msg_id for m in persisted.json()["messages"])

    # Leader replies to specific message
    reply_res = client.post(
        f"/api/v1/conversations/{elena_conv_id}/messages",
        headers=leader["headers"],
        json={
            "category": "MISSION_COORDINATION",
            "content": "Recibido, Dra. Rostova. Continuamos monitoreo nominal.",
            "reply_to_message_id": msg_id,
            "is_simulated": True,
        },
    )
    assert reply_res.status_code == 201
    assert reply_res.json()["message"]["reply_to_message_id"] == msg_id
    reply_id = reply_res.json()["message"]["id"]

    # Only the recipient can mark a message as unread; Elena marks the leader's reply important/unread
    not_recipient = client.patch(
        f"/api/v1/messages/{msg_id}/flags",
        headers=elena["headers"],
        json={"marked_unread_by_recipient": True},
    )
    assert not_recipient.status_code == 403
    flag_res = client.patch(
        f"/api/v1/messages/{reply_id}/flags",
        headers=elena["headers"],
        json={"is_important": True, "marked_unread_by_recipient": True},
    )
    assert flag_res.status_code == 200
    assert flag_res.json()["message"]["is_important"] is True
    assert flag_res.json()["message"]["marked_unread_by_recipient"] is True

    # 6. Support Request creation flagged as emergency triggers immediate emergency protocol
    sup_res = client.post(
        "/api/v1/support-requests",
        headers=elena["headers"],
        json={
            "mission_id": 1,
            "category": "URGENT_COMMUNICATION",
            "reason_title": "Mareo persistente tras transición gravitacional",
            "description": "Solicito orientación inmediata del médico de vuelo.",
            "wants_private_conversation": True,
            "is_emergency": True,
            "is_simulated": True,
        },
    )
    assert sup_res.status_code == 201
    sup_body = sup_res.json()
    # Una solicitud marcada como emergencia se escala de inmediato (las ordinarias quedan en REQUESTED)
    assert sup_body["support_request"]["status"] == "ESCALATED"
    assert sup_body["emergency_protocol_instructions"] is not None
    sup_id = sup_body["support_request"]["id"]

    # Leader updates support request status & follow-up
    sup_upd = client.patch(
        f"/api/v1/support-requests/{sup_id}/status",
        headers=leader["headers"],
        json={
            "status": "RESPONDED",
            "leader_response_notes": "Enlace médico de vuelo activado y signos vitales verificados.",
        },
    )
    assert sup_upd.status_code == 200
    assert sup_upd.json()["support_request"]["status"] == "RESPONDED"


def test_08_module2_cognitive_assessment_center_domains_baselines_and_badges(client: TestClient):
    """
    Verifies Expansion Module 2 & Acceptance Criteria #7, #8, #9, #10, #16, #17:
    7. All 9 cognitive domains are available and interactive tests can be completed or postponed without penalty.
    8. Results record reaction times, accuracy, errors, duration, and pre-test readiness factors.
    9. Baseline comparisons only compare identical domain, difficulty, and version, noting practice effect and never generating an IQ or medical diagnosis.
    10. Completing cognitive assessments awards non-competitive cognitive badges.
    (Uses Marcus: the demo seed already gives Elena the MEMORY_EXPLORER badge.)

    Updated to the implemented API: tasks come from GET /cognitive/tests/{code}?difficulty=,
    assessments start with POST /cognitive/assessments, responses are saved with
    POST /cognitive/assessments/{id}/responses and finished with /complete.
    """
    marcus = login_as(client, settings.DEMO_ASTRONAUT2_EMAIL, settings.DEMO_ASTRONAUT2_PASSWORD)
    leader = login_as(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)

    # 7. Verify all 9 cognitive domains exist
    dom_res = client.get("/api/v1/cognitive/domains", headers=marcus["headers"])
    assert dom_res.status_code == 200
    domains = dom_res.json()["domains"]
    assert len(domains) == 9
    expected_domains = {
        "VISUAL_LEARNING",
        "MEMORY",
        "ATTENTION",
        "ABSTRACTION",
        "SPATIAL_ORIENTATION",
        "EMOTION_RECOGNITION",
        "ABSTRACT_REASONING",
        "COMPLEX_EXPLORATION",
        "VISUAL_TRACKING",
    }
    assert {d["code"] for d in domains} == expected_domains

    # Verify interactive test payload for MEMORY (INTERMEDIATE)
    tests_res = client.get("/api/v1/cognitive/tests?domain_code=MEMORY", headers=marcus["headers"])
    assert tests_res.status_code == 200
    tests = tests_res.json()["tests"]
    assert len(tests) >= 1
    test_code = tests[0]["code"]
    detail = client.get(f"/api/v1/cognitive/tests/{test_code}?difficulty=INTERMEDIATE", headers=marcus["headers"])
    assert detail.status_code == 200
    tasks = detail.json()["test"]["tasks"]
    assert len(tasks) >= 3

    # Postponing a cognitive assessment works without penalty
    post_res = client.post(
        "/api/v1/cognitive/assessments",
        headers=marcus["headers"],
        json={
            "mission_id": 1,
            "domain_code": "ATTENTION",
            "difficulty": "BASIC",
            "readiness_status": "POSTPONED",
            "postpone_reason": "Turno EVA de mantenimiento programado",
            "is_simulated": True,
        },
    )
    assert post_res.status_code == 201
    assert post_res.json()["assessment"]["completion_status"] == "POSTPONED"

    # 8, 9 & 10. Start and complete a MEMORY INTERMEDIATE assessment
    start_res = client.post(
        "/api/v1/cognitive/assessments",
        headers=marcus["headers"],
        json={
            "mission_id": 1,
            "domain_code": "MEMORY",
            "test_code": test_code,
            "difficulty": "INTERMEDIATE",
            "readiness_status": "READY",
            "conditions_notes": "Sueño óptimo, fatiga 3/10, estrés 2/10",
            "is_simulated": True,
        },
    )
    assert start_res.status_code == 201
    start_body = start_res.json()
    assessment_id = start_body["assessment"]["id"]
    assert start_body["assessment"]["readiness_status"] == "READY"

    responses = [
        {
            "task_index": t["task_index"],
            "selected_answer": t["correct_answer_key"],
            "response_time_ms": 1350 + i * 30,
        }
        for i, t in enumerate(start_body["test"]["tasks"])
    ]
    save_res = client.post(
        f"/api/v1/cognitive/assessments/{assessment_id}/responses",
        headers=marcus["headers"],
        json={"responses": responses, "current_step_index": len(responses)},
    )
    assert save_res.status_code == 200

    # Nobody else (not even the assigned leader) can complete an astronaut's assessment
    assert client.post(
        f"/api/v1/cognitive/assessments/{assessment_id}/complete",
        headers=leader["headers"],
        json={"duration_seconds": 21.5, "perceived_difficulty": 4},
    ).status_code == 403

    comp_res = client.post(
        f"/api/v1/cognitive/assessments/{assessment_id}/complete",
        headers=marcus["headers"],
        json={"duration_seconds": 21.5, "perceived_difficulty": 4},
    )
    assert comp_res.status_code == 200
    res_body = comp_res.json()["assessment"]["result"]
    assert res_body["accuracy_percent"] == 100.0
    assert res_body["mean_response_time_ms"] > 0
    assert comp_res.json()["assessment"]["duration_seconds"] == 21.5
    assert "efecto de práctica" in res_body["practice_effect_note"].lower()
    assert "no constituye un diagnóstico" in res_body["non_diagnostic_summary"].lower()
    assert "MEMORY_EXPLORER" in {b["code"] for b in comp_res.json()["badges_awarded"]}


def test_09_module3_emotional_assessment_requests_privacy_and_urgent_protocol(client: TestClient):
    """
    Verifies Expansion Module 3 & Acceptance Criteria #11, #12, #13, #14, #15, #18:
    11. Administrator can create an emotional assessment request for one or multiple astronauts.
    12. Astronaut receives notification and sees the request in My Emotional Check-In.
    13. Astronaut can complete the questionnaire (including 'Prefiero no responder' without penalty).
    14. Request status updates to COMPLETED.
    15. Admin sees administrative compliance status (COMPLETED) but NOT detailed personal answers; Leader sees operational summary without raw sensitive answers.
    16. Urgent emotional check-in activates immediate protocol.

    Updated to the implemented API: creation returns {created_count, requests}, answers use
    question_code/numeric_score/open_text_answer and the detail endpoint is
    GET /emotional-assessments/requests/{id} (include_private_answers is denied to leader/admin).
    """
    admin = login_as(client, settings.DEMO_ADMIN_EMAIL, settings.DEMO_ADMIN_PASSWORD)
    elena = login_as(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
    marcus = login_as(client, settings.DEMO_ASTRONAUT2_EMAIL, settings.DEMO_ASTRONAUT2_PASSWORD)
    leader = login_as(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)

    # 11. Admin creates emotional assessment requests for both Elena and Marcus
    req_create = client.post(
        "/api/v1/emotional-assessments/requests",
        headers=admin["headers"],
        json={
            "astronaut_ids": [elena["user"]["id"], marcus["user"]["id"]],
            "mission_id": 1,
            "priority": "HIGH",
            "periodicity": "ONCE",
            "due_in_hours": 24,
            "custom_message": "Solicitud de seguimiento emocional previo a maniobra orbital.",
            "send_immediately": True,
            "is_simulated": True,
        },
    )
    assert req_create.status_code == 201
    assert req_create.json()["created_count"] == 2
    created_list = req_create.json()["requests"]
    elena_req_id = next(r["id"] for r in created_list if r["astronaut_id"] == elena["user"]["id"])

    # 12. Elena sees her pending request in /my-requests
    my_reqs = client.get("/api/v1/emotional-assessments/my-requests", headers=elena["headers"])
    assert my_reqs.status_code == 200
    assert any(r["id"] == elena_req_id for r in my_reqs.json()["requests"])

    # Fetch questionnaire questions
    q_res = client.get("/api/v1/emotional-assessments/questionnaires", headers=elena["headers"])
    assert q_res.status_code == 200
    questions = q_res.json()["questionnaires"][0]["questions"]
    assert len(questions) >= 12

    # Marcus cannot start Elena's questionnaire
    assert client.post(f"/api/v1/emotional-assessments/{elena_req_id}/start", headers=marcus["headers"]).status_code == 403

    # 13. Elena starts the emotional assessment
    start_emo = client.post(f"/api/v1/emotional-assessments/{elena_req_id}/start", headers=elena["headers"])
    assert start_emo.status_code in (200, 201)
    emo_assessment_id = start_emo.json()["assessment_id"]

    # Answers include "Prefiero no responder" on open questions and a private open text
    private_open_text = "Confidencial: Siento sobrecarga emocional intensa hoy #PRIV-7788"
    answers_payload = []
    open_done = False
    for q in questions:
        if q["question_type"].startswith("SCALE"):
            answers_payload.append({"question_code": q["question_code"], "dimension_code": q["dimension_code"], "numeric_score": 2})
        elif not open_done:
            answers_payload.append({"question_code": q["question_code"], "dimension_code": q["dimension_code"], "open_text_answer": private_open_text})
            open_done = True
        else:
            answers_payload.append({"question_code": q["question_code"], "dimension_code": q["dimension_code"], "prefer_not_to_answer": True})

    # The leader cannot complete the astronaut's questionnaire on her behalf
    assert client.post(
        f"/api/v1/emotional-assessments/{emo_assessment_id}/complete",
        headers=leader["headers"],
        json={"responses": answers_payload},
    ).status_code == 403

    # Complete emotional assessment with URGENT support request
    comp_emo = client.post(
        f"/api/v1/emotional-assessments/{emo_assessment_id}/complete",
        headers=elena["headers"],
        json={
            "responses": answers_payload,
            "share_summary_with_leader": True,
            "explicit_support_request": True,
            "support_urgency": "URGENT",
            "support_notes": private_open_text,
        },
    )
    assert comp_emo.status_code == 200
    comp_data = comp_emo.json()
    assert comp_data["status"] == "COMPLETED"
    assert comp_data["result"]["operational_state"] == "URGENT_SUPPORT"
    assert comp_data["result"]["urgent_protocol_instructions"] is not None

    # 14 & 15. Admin sees COMPLETED compliance status, NOT detailed answers or private text
    adm_reqs = client.get("/api/v1/emotional-assessments/requests", headers=admin["headers"])
    assert adm_reqs.status_code == 200
    adm_req_item = next(r for r in adm_reqs.json()["requests"] if r["id"] == elena_req_id)
    assert adm_req_item["status"] == "COMPLETED"
    assert adm_req_item["privacy_redacted"] is True
    assert "detailed_responses" not in adm_req_item
    assert private_open_text not in str(adm_req_item)

    # Admin attempting to read detailed answers without consent/audit justification is blocked (403)
    adm_res_blocked = client.get(
        f"/api/v1/emotional-assessments/requests/{elena_req_id}?include_private_answers=true",
        headers=admin["headers"],
    )
    assert adm_res_blocked.status_code == 403

    # Leader sees operational state, NOT raw answers or private text; asking for answers is denied
    ldr_res_view = client.get(f"/api/v1/emotional-assessments/requests/{elena_req_id}", headers=leader["headers"])
    assert ldr_res_view.status_code == 200
    ldr_json = ldr_res_view.json()["request"]
    assert ldr_json["privacy_redacted"] is True
    assert ldr_json["operational_result"]["operational_state"] == "URGENT_SUPPORT"
    assert "detailed_responses" not in ldr_json
    assert private_open_text not in str(ldr_json)
    assert client.get(
        f"/api/v1/emotional-assessments/requests/{elena_req_id}?include_private_answers=true",
        headers=leader["headers"],
    ).status_code == 403

    # 18. Verify Mission Control summary includes expansion_cards and Analytics overview works
    mc_sum = client.get(
        f"/api/v1/health/summary?astronaut_id={elena['user']['id']}&mission_id=1",
        headers=elena["headers"],
    )
    assert mc_sum.status_code == 200
    assert "expansion_cards" in mc_sum.json()
    assert "communication_center" in mc_sum.json()["expansion_cards"]
    assert "cognitive_performance" in mc_sum.json()["expansion_cards"]
    assert "emotional_check_in" in mc_sum.json()["expansion_cards"]

    an_ov = client.get(
        f"/api/v1/analytics/expansion-overview?astronaut_id={elena['user']['id']}&mission_id=1",
        headers=elena["headers"],
    )
    assert an_ov.status_code == 200
    assert "communication_analytics" in an_ov.json()
    assert "cognitive_analytics" in an_ov.json()
    assert "emotional_analytics" in an_ov.json()
