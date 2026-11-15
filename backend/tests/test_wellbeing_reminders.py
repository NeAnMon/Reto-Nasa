"""Recordatorios de Bienestar: tiempo libre y actividades de tripulación (issue #44).

Alertas tempranas RULE_EARLY_LEISURE y RULE_EARLY_CREW_ACTIVITY (backend/app/rules/early_warnings.py):
se evalúan al pedir el resumen de salud o las alertas y tras cada acción de tiempo libre o tripulación,
una sola abierta por regla y astronauta, y se retiran solas cuando ya no hacen falta.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database.seed import seed_database
from backend.app.database.session import Base, get_db
from backend.app.main import app
from backend.app.models.models import Alert, CrewActivity, FollowUpAction, LeisureLog, User
from backend.app.rules import early_warnings as ew
from backend.app.rules.alert_sources import alert_source_engine

TEST_DB_PATH = Path(__file__).resolve().parent / "test_wellbeing_reminders.db"
engine_rem = create_engine(f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False}, future=True)
RemSession = sessionmaker(autocommit=False, autoflush=False, bind=engine_rem, future=True)


def _override_get_db():
    db = RemSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def rem_database():
    previous_override = app.dependency_overrides.get(get_db)
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    Base.metadata.create_all(bind=engine_rem)
    db = RemSession()
    try:
        seed_database(db, force_reseed_sim=True)
        # Punto de partida conocido: sin tiempo libre registrado ni actividades de tripulación
        db.query(LeisureLog).delete()
        db.query(CrewActivity).delete()
        db.commit()
    finally:
        db.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    if previous_override is not None:
        app.dependency_overrides[get_db] = previous_override
    else:
        app.dependency_overrides.pop(get_db, None)
    engine_rem.dispose()
    try:
        TEST_DB_PATH.unlink()
    except OSError:
        pass


@pytest.fixture(scope="module")
def client(rem_database):
    with TestClient(app) as c:
        yield c


def _login(client, email, password):
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    return {"headers": {"Authorization": f"Bearer {data['access_token']}"}, "user": data["user"]}


@pytest.fixture(scope="module")
def users(client):
    return {
        "elena": _login(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD),
        "marcus": _login(client, settings.DEMO_ASTRONAUT2_EMAIL, settings.DEMO_ASTRONAUT2_PASSWORD),
        "leader": _login(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD),
    }


def _reminders(client, headers, aid, rule):
    res = client.get(f"/api/v1/alerts?astronaut_id={aid}", headers=headers)
    assert res.status_code == 200, res.text
    return [a for a in res.json()["alerts"] if a["rule_code"] == rule]


def _open(alerts):
    return [a for a in alerts if a["status"] != "RESOLVED"]


def _summary_flags(client, headers, aid):
    res = client.get(f"/api/v1/health/summary?astronaut_id={aid}", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["wellbeing_reminders"]


def test_rules_are_early_isolation_alerts_with_their_own_codes():
    assert ew.LEISURE_RULE.startswith(ew.EARLY_RULE_PREFIX) and ew.CREW_RULE.startswith(ew.EARLY_RULE_PREFIX)
    assert alert_source_engine(ew.LEISURE_RULE, ew.LEISURE_INDICATOR) == "ISOLATION"
    assert alert_source_engine(ew.CREW_RULE, ew.CREW_INDICATOR) == "ISOLATION"
    now = datetime.now(timezone.utc)
    assert ew.leisure_reminder_due(None, now)
    assert ew.leisure_reminder_due(now - timedelta(hours=ew.LEISURE_GAP_HOURS, minutes=1), now)
    assert not ew.leisure_reminder_due(now - timedelta(hours=ew.LEISURE_GAP_HOURS - 1), now)
    # Sin zona horaria (SQLite) se trata como UTC
    assert not ew.leisure_reminder_due((now - timedelta(hours=1)).replace(tzinfo=None), now)


def test_leisure_reminder_appears_and_clears_when_logged(client, users):
    elena, leader = users["elena"], users["leader"]
    eid = elena["user"]["id"]

    # Sin tiempo libre en 48 h: el resumen marca la pestaña y la alerta temprana aparece (una sola)
    assert _summary_flags(client, elena["headers"], eid)["leisure"] is True
    own = _open(_reminders(client, elena["headers"], eid, ew.LEISURE_RULE))
    assert len(own) == 1
    a = own[0]
    assert a["priority"] == "LOW" and a["operational_state"] == "MONITOR" and a["status"] == "NEW"
    assert a["indicator_code"] == ew.LEISURE_INDICATOR and a["title"] == ew.LEISURE_TITLE
    assert "Tiempo libre" in a["immediate_action"] and a["value_recorded"] is None
    # Volver a consultar no duplica
    assert len(_open(_reminders(client, elena["headers"], eid, ew.LEISURE_RULE))) == 1
    # El líder (Elena comparte señales) también la ve
    assert [x["id"] for x in _open(_reminders(client, leader["headers"], eid, ew.LEISURE_RULE))] == [a["id"]]

    # "Lo hice" → se retira sola, con nota de sistema, sin borrarse
    logged = client.post(
        "/api/v1/wellness/leisure/GRATITUDE_JOURNAL/log", headers=elena["headers"], json={"minutes": 10, "enjoyment": 4},
    )
    assert logged.status_code == 201, logged.text
    after = _reminders(client, elena["headers"], eid, ew.LEISURE_RULE)
    assert _open(after) == []
    assert [x["status"] for x in after if x["id"] == a["id"]] == ["RESOLVED"]
    assert _summary_flags(client, elena["headers"], eid)["leisure"] is False
    db = RemSession()
    try:
        note = db.query(FollowUpAction).filter(FollowUpAction.alert_id == a["id"]).one()
        assert note.author_role == "SYSTEM" and note.notes == ew.LEISURE_RESOLVED_NOTE
    finally:
        db.close()


def test_crew_reminder_weekly_goal_then_invite_then_clears(client, users):
    elena, marcus = users["elena"], users["marcus"]
    eid = elena["user"]["id"]

    # Sin actividades esta semana ni programadas: meta semanal sin cumplir
    weekly = _open(_reminders(client, elena["headers"], eid, ew.CREW_RULE))
    assert len(weekly) == 1 and weekly[0]["title"] == ew.CREW_TITLE[ew.CREW_REASON_WEEKLY]
    assert _summary_flags(client, elena["headers"], eid)["crew"] is True

    # Marcus propone una actividad para dentro de 2 h: Elena tiene la invitación pendiente →
    # la misma alerta cambia de motivo (no se crea otra)
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    created = client.post(
        "/api/v1/crew-activities", headers=marcus["headers"],
        json={"mission_id": 1, "template_code": "SHARED_MEAL", "scheduled_for": when},
    )
    assert created.status_code == 201, created.text
    act_id = created.json()["id"]
    invite = _open(_reminders(client, elena["headers"], eid, ew.CREW_RULE))
    assert [x["id"] for x in invite] == [weekly[0]["id"]]
    assert invite[0]["title"] == ew.CREW_TITLE[ew.CREW_REASON_INVITE]
    assert invite[0]["immediate_action"] == ew.CREW_ACTION[ew.CREW_REASON_INVITE]

    # Marcus (creador, ya unido) no tiene invitación pendiente y hay una actividad programada esta semana
    mid = marcus["user"]["id"]
    assert _open(_reminders(client, marcus["headers"], mid, ew.CREW_RULE)) == []

    # Elena responde → se retira sola
    res = client.post(f"/api/v1/crew-activities/{act_id}/respond", headers=elena["headers"], json={"response": "JOINED"})
    assert res.status_code == 200, res.text
    assert _open(_reminders(client, elena["headers"], eid, ew.CREW_RULE)) == []
    assert _summary_flags(client, elena["headers"], eid)["crew"] is False

    # Si se cancela y la semana queda sin actividades, vuelve el recordatorio de la meta semanal
    assert client.post(f"/api/v1/crew-activities/{act_id}/cancel", headers=marcus["headers"]).status_code == 200
    again = _open(_reminders(client, elena["headers"], eid, ew.CREW_RULE))
    assert len(again) == 1 and again[0]["title"] == ew.CREW_TITLE[ew.CREW_REASON_WEEKLY]


def test_leader_does_not_see_reminders_when_astronaut_stops_sharing(client, users):
    marcus, leader = users["marcus"], users["leader"]
    mid = marcus["user"]["id"]
    assert _open(_reminders(client, marcus["headers"], mid, ew.LEISURE_RULE))
    db = RemSession()
    try:
        db.query(User).filter(User.id == mid).update({User.share_wellness_signals_with_leader: False})
        db.commit()
        assert _reminders(client, leader["headers"], mid, ew.LEISURE_RULE) == []
        assert _summary_flags(client, leader["headers"], mid) == {"leisure": False, "crew": False}
    finally:
        db.query(User).filter(User.id == mid).update({User.share_wellness_signals_with_leader: True})
        db.commit()
        db.close()


def test_reminders_skip_users_without_an_active_mission_or_that_are_not_astronauts(users):
    db = RemSession()
    try:
        leader_id = users["leader"]["user"]["id"]
        assert ew.refresh_wellbeing_reminders(db, [leader_id]) == 0
        assert db.query(Alert).filter(Alert.astronaut_id == leader_id, Alert.rule_code.like("RULE_EARLY_%")).count() == 0
        assert ew.refresh_wellbeing_reminders(db, []) == 0
    finally:
        db.rollback()
        db.close()
