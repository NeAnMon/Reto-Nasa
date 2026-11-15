"""Pruebas del módulo de aislamiento y confinamiento (docs/CONTRATO_AISLAMIENTO.md)."""
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from backend.app.api.v1 import isolation_router as iso_mod
from backend.app.core.config import insecure_config_warnings, settings
from backend.app.database.seed import apply_lightweight_migrations, seed_database
from backend.app.database.session import Base, get_db
from backend.app.main import app
from backend.app.models.models import (
    Conversation,
    CrewActivity,
    CrewActivityParticipant,
    DailyMission,
    GamificationEvent,
    GamificationProfile,
    LeisureActivity,
    MissionAssignment,
    Role,
    User,
    UserSession,
)
from backend.app.security.auth import hash_password

TEST_DB_PATH = Path(__file__).resolve().parent / "test_isolation.db"
engine_iso = create_engine(
    f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False}, future=True
)
IsoSession = sessionmaker(autocommit=False, autoflush=False, bind=engine_iso, future=True)


def _override_get_db():
    db = IsoSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def iso_database():
    # La sobreescritura de get_db se hace aquí (no al importar) para no interferir con otros módulos de prueba
    previous_override = app.dependency_overrides.get(get_db)
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    Base.metadata.create_all(bind=engine_iso)
    db = IsoSession()
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
    engine_iso.dispose()
    try:
        TEST_DB_PATH.unlink()
    except OSError:
        pass


@pytest.fixture(scope="module")
def client(iso_database):
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
        "kenji": login(client, settings.DEMO_ASTRONAUT3_EMAIL, settings.DEMO_ASTRONAUT3_PASSWORD),
        "leader": login(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD),
        "admin": login(client, settings.DEMO_ADMIN_EMAIL, settings.DEMO_ADMIN_PASSWORD),
    }


def _xp(user_id: int) -> int:
    db = IsoSession()
    try:
        return db.query(GamificationProfile).filter(GamificationProfile.user_id == user_id).first().total_xp
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 1. Check-in rápido
# ---------------------------------------------------------------------------

def test_quick_checkin_and_role_redaction(client, users):
    elena, marcus, leader, admin = users["elena"], users["marcus"], users["leader"], users["admin"]
    eid = elena["user"]["id"]
    private_note = "Nota privada: echo de menos a mi familia #ISO-NOTE-1"

    r = client.post(
        "/api/v1/wellness/quick-checkin",
        headers=elena["headers"],
        json={"sleep_hours": 6.56, "sleep_quality": 3, "mood": 4, "energy": 3, "feels_isolated": True, "note": private_note},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["sleep_hours"] == 6.6
    assert body["note"] == private_note and body["mood"] == 4
    assert body["operational_flag"] == "OK"
    assert {"id", "created_at", "operational_flag"} <= set(body)

    # Validación de rangos del contrato
    for bad in (
        {"sleep_hours": 17, "sleep_quality": 3, "mood": 3, "energy": 3},
        {"sleep_hours": 7, "sleep_quality": 0, "mood": 3, "energy": 3},
        {"sleep_hours": 7, "sleep_quality": 3, "mood": 6, "energy": 3},
        {"sleep_hours": 7, "sleep_quality": 3, "mood": 3, "energy": 3, "note": "x" * 501},
    ):
        assert client.post("/api/v1/wellness/quick-checkin", headers=elena["headers"], json=bad).status_code == 422

    # Solo astronautas registran (para sí mismos)
    assert client.post(
        "/api/v1/wellness/quick-checkin", headers=leader["headers"],
        json={"sleep_hours": 7, "sleep_quality": 3, "mood": 3, "energy": 3},
    ).status_code == 403

    # 3 de 3 registros con aislamiento → NEEDS_CHECK_IN
    for _ in range(2):
        r = client.post(
            "/api/v1/wellness/quick-checkin", headers=elena["headers"],
            json={"sleep_hours": 7.5, "sleep_quality": 4, "mood": 4, "energy": 4, "feels_isolated": True},
        )
        assert r.status_code == 201
    assert r.json()["operational_flag"] == "NEEDS_CHECK_IN"

    own = client.get("/api/v1/wellness/quick-checkin", headers=elena["headers"])
    assert own.status_code == 200
    own_json = own.json()
    assert own_json["summary"]["checkins_7d"] == 3
    assert own_json["summary"]["operational_flag"] == "NEEDS_CHECK_IN"
    assert own_json["summary"]["circadian_tip"]
    assert any(i["note"] == private_note for i in own_json["items"])

    # Líder asignado y administración: sueño y señal operativa, nunca nota/ánimo/energía/aislamiento
    for viewer in (leader, admin):
        res = client.get(f"/api/v1/wellness/quick-checkin?astronaut_id={eid}", headers=viewer["headers"])
        assert res.status_code == 200
        data = res.json()
        assert private_note not in str(data)
        for item in data["items"]:
            assert item["note"] is None and item["mood"] is None
            assert item["energy"] is None and item["feels_isolated"] is None
            assert item["sleep_hours"] is not None
        assert data["summary"]["operational_flag"] == "NEEDS_CHECK_IN"

    # Otro astronauta no puede leer
    assert client.get(f"/api/v1/wellness/quick-checkin?astronaut_id={eid}", headers=marcus["headers"]).status_code == 403

    # Reenvío desde la cola sin enlace con dedup_key: no duplica
    queued = {"sleep_hours": 7, "sleep_quality": 4, "mood": 4, "energy": 4, "dedup_key": "QC-OFFLINE-001"}
    a = client.post("/api/v1/wellness/quick-checkin", headers=elena["headers"], json=queued)
    b = client.post("/api/v1/wellness/quick-checkin", headers=elena["headers"], json=queued)
    assert a.status_code == 201 and b.status_code in (200, 201)
    assert a.json()["id"] == b.json()["id"]
    assert client.get("/api/v1/wellness/quick-checkin", headers=elena["headers"]).json()["summary"]["checkins_7d"] == 4
    assert client.post("/api/v1/wellness/quick-checkin", headers=marcus["headers"], json=queued).status_code == 409


# ---------------------------------------------------------------------------
# 2. Tiempo libre
# ---------------------------------------------------------------------------

def test_leisure_catalog_and_log(client, users):
    elena, leader = users["elena"], users["leader"]
    cat = client.get("/api/v1/wellness/leisure", headers=elena["headers"])
    assert cat.status_code == 200
    items = cat.json()["items"]
    assert len(items) >= 10
    valid = {"PLANTS", "READING", "GAMES", "MUSIC", "ART", "PHOTOGRAPHY", "WRITING", "MOVEMENT"}
    for it in items:
        assert it["category"] in valid
        assert 5 <= it["duration_minutes"] <= 30
        assert isinstance(it["how_to"], list) and it["how_to"]
        assert {"code", "title", "description", "solo_or_group", "source_title", "source_url"} <= set(it)
    plant = next(i for i in items if i["code"] == "PLANT_CARE")
    assert "gardening" in plant["source_url"]

    plants = client.get("/api/v1/wellness/leisure?category=PLANTS", headers=elena["headers"]).json()["items"]
    assert plants and all(i["category"] == "PLANTS" for i in plants)
    short = client.get("/api/v1/wellness/leisure?max_minutes=10", headers=elena["headers"]).json()["items"]
    assert short and all(i["duration_minutes"] <= 10 for i in short)
    assert client.get("/api/v1/wellness/leisure?category=HACKING", headers=elena["headers"]).status_code == 422

    note = "Me relajó mucho regar la albahaca #LEIS-1"
    first = client.post("/api/v1/wellness/leisure/PLANT_CARE/log", headers=elena["headers"], json={"minutes": 15, "enjoyment": 5, "note": note})
    assert first.status_code == 201, first.text
    assert first.json()["xp_awarded"] > 0
    assert {"id", "code", "minutes", "enjoyment", "created_at", "xp_awarded"} <= set(first.json())
    second = client.post("/api/v1/wellness/leisure/READING_BREAK/log", headers=elena["headers"], json={"minutes": 20, "enjoyment": 4})
    assert second.status_code == 201
    assert second.json()["xp_awarded"] == 0  # XP una vez al día

    assert client.post("/api/v1/wellness/leisure/NOPE/log", headers=elena["headers"], json={"minutes": 5, "enjoyment": 3}).status_code == 404
    assert client.post("/api/v1/wellness/leisure/PLANT_CARE/log", headers=elena["headers"], json={"minutes": 5, "enjoyment": 6}).status_code == 422
    assert client.post("/api/v1/wellness/leisure/PLANT_CARE/log", headers=leader["headers"], json={"minutes": 5, "enjoyment": 3}).status_code == 403

    own = client.get("/api/v1/wellness/leisure/log", headers=elena["headers"]).json()
    assert own["minutes_7d"] == 35
    assert any(i["note"] == note for i in own["items"])
    other = client.get(f"/api/v1/wellness/leisure/log?astronaut_id={elena['user']['id']}", headers=leader["headers"])
    assert other.status_code == 200
    assert note not in str(other.json())


# ---------------------------------------------------------------------------
# 3. Actividades de integración de la tripulación
# ---------------------------------------------------------------------------

def test_crew_activities_flow_quorum_xp_and_permissions(client, users):
    elena, marcus, kenji, leader, admin = (users[k] for k in ("elena", "marcus", "kenji", "leader", "admin"))
    eid, mid = elena["user"]["id"], marcus["user"]["id"]

    catalog = client.get("/api/v1/crew-activities/catalog", headers=elena["headers"]).json()["items"]
    codes = {c["code"] for c in catalog}
    assert {"SHARED_MEAL", "MOVIE_NIGHT", "GROUP_GARDEN", "BOARD_GAME", "EARTH_OBSERVATION", "CELEBRATION"} <= codes

    # Dentro de la ventana de asistencia (desde 15 min antes del inicio)
    when = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    created = client.post(
        "/api/v1/crew-activities", headers=elena["headers"],
        json={"mission_id": 1, "template_code": "SHARED_MEAL", "scheduled_for": when},
    )
    assert created.status_code == 201, created.text
    act = created.json()
    act_id = act["id"]
    assert act["status"] == "SCHEDULED" and act["title"] == "Comida compartida"
    assert act["duration_minutes"] == 45
    assert act["created_by"]["id"] == eid
    assert {p["user_id"] for p in act["participants"]} == {eid, mid}
    assert act["quorum"] == 2 and act["attended_count"] == 0
    assert act["my_response"] == "JOINED"

    # Sin plantilla ni título → 422; plantilla inexistente → 404
    assert client.post("/api/v1/crew-activities", headers=elena["headers"], json={"mission_id": 1, "scheduled_for": when}).status_code == 422
    assert client.post("/api/v1/crew-activities", headers=elena["headers"], json={"mission_id": 1, "template_code": "NOPE", "scheduled_for": when}).status_code == 404
    # Kenji no pertenece a la misión 1
    assert client.post("/api/v1/crew-activities", headers=kenji["headers"], json={"mission_id": 1, "template_code": "BOARD_GAME", "scheduled_for": when}).status_code == 403
    assert client.get("/api/v1/crew-activities?mission_id=1", headers=kenji["headers"]).status_code == 403
    assert client.post(f"/api/v1/crew-activities/{act_id}/respond", headers=kenji["headers"], json={"response": "JOINED"}).status_code == 403
    # Respuesta no válida
    assert client.post(f"/api/v1/crew-activities/{act_id}/respond", headers=marcus["headers"], json={"response": "MAYBE"}).status_code == 422

    listing = client.get("/api/v1/crew-activities", headers=marcus["headers"])
    assert listing.status_code == 200
    lj = listing.json()
    mine = next(a for a in lj["items"] if a["id"] == act_id)
    assert mine["my_response"] == "PENDING"
    assert lj["weekly_goal"]["target"] == 1

    # Marcus no puede asistir sin unirse
    assert client.post(f"/api/v1/crew-activities/{act_id}/attend", headers=marcus["headers"]).status_code == 409

    xp_elena_before, xp_marcus_before = _xp(eid), _xp(mid)
    r = client.post(f"/api/v1/crew-activities/{act_id}/attend", headers=elena["headers"])
    assert r.status_code == 200 and r.json()["status"] == "SCHEDULED" and r.json()["attended_count"] == 1
    assert _xp(eid) == xp_elena_before  # aún sin quórum

    r = client.post(f"/api/v1/crew-activities/{act_id}/respond", headers=marcus["headers"], json={"response": "JOINED"})
    assert r.status_code == 200 and r.json()["my_response"] == "JOINED"
    r = client.post(f"/api/v1/crew-activities/{act_id}/attend", headers=marcus["headers"])
    assert r.status_code == 200
    assert r.json()["status"] == "COMPLETED" and r.json()["attended_count"] == 2
    gained_e = _xp(eid) - xp_elena_before
    gained_m = _xp(mid) - xp_marcus_before
    assert gained_e > 0 and gained_e == gained_m

    # XP una sola vez: repetir asistencia no suma
    assert client.post(f"/api/v1/crew-activities/{act_id}/attend", headers=elena["headers"]).status_code == 200
    assert client.post(f"/api/v1/crew-activities/{act_id}/attend", headers=marcus["headers"]).status_code == 200
    assert _xp(eid) - xp_elena_before == gained_e
    assert _xp(mid) - xp_marcus_before == gained_m
    # Una actividad completada no se cancela ni admite nuevas respuestas
    assert client.post(f"/api/v1/crew-activities/{act_id}/cancel", headers=elena["headers"]).status_code == 409
    assert client.post(f"/api/v1/crew-activities/{act_id}/respond", headers=marcus["headers"], json={"response": "DECLINED"}).status_code == 409

    done = client.get("/api/v1/crew-activities?mission_id=1&status=COMPLETED", headers=leader["headers"]).json()
    assert any(a["id"] == act_id for a in done["items"])
    assert done["weekly_goal"]["completed_this_week"] >= 1

    # Cancelación: el líder asignado puede, otro astronauta no creador no
    second = client.post(
        "/api/v1/crew-activities", headers=leader["headers"],
        json={"mission_id": 1, "title": "Noche de astronomía", "scheduled_for": when, "duration_minutes": 60},
    )
    assert second.status_code == 201
    sid = second.json()["id"]
    assert second.json()["my_response"] is None  # el líder no es participante
    assert client.post(f"/api/v1/crew-activities/{sid}/respond", headers=leader["headers"], json={"response": "JOINED"}).status_code == 403
    assert client.post(f"/api/v1/crew-activities/{sid}/cancel", headers=marcus["headers"]).status_code == 403
    cancelled = client.post(f"/api/v1/crew-activities/{sid}/cancel", headers=leader["headers"])
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
    client.post(f"/api/v1/crew-activities/{sid}/respond", headers=elena["headers"], json={"response": "JOINED"})
    assert client.post(f"/api/v1/crew-activities/{sid}/attend", headers=elena["headers"]).status_code == 409

    # El creador puede cancelar la suya; administración también
    third = client.post("/api/v1/crew-activities", headers=marcus["headers"], json={"mission_id": 1, "template_code": "BOARD_GAME", "scheduled_for": when}).json()
    assert client.post(f"/api/v1/crew-activities/{third['id']}/cancel", headers=marcus["headers"]).status_code == 200
    fourth = client.post("/api/v1/crew-activities", headers=marcus["headers"], json={"mission_id": 1, "template_code": "MOVIE_NIGHT", "scheduled_for": when}).json()
    assert client.post(f"/api/v1/crew-activities/{fourth['id']}/cancel", headers=admin["headers"]).status_code == 200


# ---------------------------------------------------------------------------
# 4. Mensajes: citas y dedup_key no filtran contenido entre conversaciones
# ---------------------------------------------------------------------------

def _first_conv_id(client, who):
    convs = client.get("/api/v1/conversations", headers=who["headers"]).json()["conversations"]
    assert convs, "la persona debería tener al menos una conversación de misión"
    return convs[0]["id"]


def test_reply_and_dedup_cannot_leak_other_conversations(client, users):
    elena, marcus = users["elena"], users["marcus"]
    elena_conv = _first_conv_id(client, elena)
    marcus_conv = _first_conv_id(client, marcus)
    assert elena_conv != marcus_conv
    sent = client.post(f"/api/v1/conversations/{elena_conv}/messages", headers=elena["headers"], json={"content": "privado de Elena"})
    assert sent.status_code == 201, sent.text
    elena_msg_id = sent.json()["message"]["id"]
    # Citar un mensaje de otra conversación no está permitido (filtraría su contenido)
    leak = client.post(f"/api/v1/conversations/{marcus_conv}/messages", headers=marcus["headers"], json={"content": "hola", "reply_to_message_id": elena_msg_id})
    assert leak.status_code == 400
    # Una dedup_key ajena no devuelve el mensaje de otra persona
    first = client.post(f"/api/v1/conversations/{elena_conv}/messages", headers=elena["headers"], json={"content": "privado", "dedup_key": "ISO-DEDUP-001"})
    assert first.status_code == 201
    stolen = client.post(f"/api/v1/conversations/{marcus_conv}/messages", headers=marcus["headers"], json={"content": "x", "dedup_key": "ISO-DEDUP-001"})
    assert stolen.status_code == 409
    again = client.post(f"/api/v1/conversations/{elena_conv}/messages", headers=elena["headers"], json={"content": "privado", "dedup_key": "ISO-DEDUP-001"})
    assert again.status_code == 201 and again.json()["duplicate_prevented"] is True
    # Los adjuntos de mensajes solo guardan el nombre del archivo (no hay subida de archivos)
    att = client.post(
        f"/api/v1/conversations/{elena_conv}/messages", headers=elena["headers"],
        json={"content": "Informe adjunto", "attachment_file_name": "informe.txt"},
    )
    assert att.status_code == 201, att.text
    assert [a["file_name"] for a in att.json()["message"]["attachments"]] == ["informe.txt"]


# ---------------------------------------------------------------------------
# 5. Compatibilidad con BD migradas por una versión previa con canal familiar (retirado)
# ---------------------------------------------------------------------------

# Esquema que dejaba esa versión: conversations.channel NOT NULL DEFAULT 'MISSION', message_attachments
# reconstruida (message_id anulable, AUTOINCREMENT, columnas extra) y la tabla family_contacts.
LEGACY_CHANNEL_ERA_DDL = [
    "CREATE TABLE conversations (id INTEGER NOT NULL, mission_id INTEGER NOT NULL, astronaut_id INTEGER NOT NULL, "
    "leader_id INTEGER NOT NULL, subject VARCHAR(200) NOT NULL, status VARCHAR(40) NOT NULL, is_highlighted BOOLEAN NOT NULL, "
    "linked_alert_id INTEGER, last_message_at DATETIME NOT NULL, is_simulated BOOLEAN NOT NULL, created_at DATETIME NOT NULL, "
    "channel VARCHAR(20) DEFAULT 'MISSION' NOT NULL, PRIMARY KEY (id), "
    "FOREIGN KEY(mission_id) REFERENCES missions (id) ON DELETE CASCADE, "
    "FOREIGN KEY(astronaut_id) REFERENCES users (id) ON DELETE CASCADE, "
    "FOREIGN KEY(leader_id) REFERENCES users (id) ON DELETE CASCADE, "
    "FOREIGN KEY(linked_alert_id) REFERENCES alerts (id) ON DELETE SET NULL)",
    "CREATE INDEX ix_conversations_channel ON conversations (channel)",
    "CREATE TABLE message_attachments (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, message_id INTEGER, "
    "file_name VARCHAR(180) NOT NULL, mime_type VARCHAR(80) NOT NULL, file_size_bytes INTEGER NOT NULL, "
    "safe_summary_note VARCHAR(255), uploaded_at DATETIME NOT NULL, uploader_id INTEGER, storage_key VARCHAR(64), "
    "kind VARCHAR(10), duration_seconds FLOAT, UNIQUE (storage_key), "
    "FOREIGN KEY(message_id) REFERENCES messages (id) ON DELETE CASCADE, "
    "FOREIGN KEY(uploader_id) REFERENCES users (id) ON DELETE CASCADE)",
    "CREATE INDEX ix_message_attachments_message_id ON message_attachments (message_id)",
    "CREATE TABLE family_contacts (id INTEGER NOT NULL, astronaut_id INTEGER NOT NULL, user_id INTEGER NOT NULL, "
    "relationship VARCHAR(60) NOT NULL, is_active BOOLEAN NOT NULL, created_at DATETIME NOT NULL, PRIMARY KEY (id), "
    "CONSTRAINT uq_family_contact UNIQUE (astronaut_id, user_id), "
    "FOREIGN KEY(astronaut_id) REFERENCES users (id) ON DELETE CASCADE, "
    "FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE)",
]
LEGACY_EMAIL = "familiar.legacy@astrovital.demo"
LEGACY_PASSWORD = "Legacy!2026"


def test_db_migrated_by_previous_channel_version_keeps_working(client, tmp_path, monkeypatch):
    legacy_engine = create_engine(
        f"sqlite:///{tmp_path / 'legacy_channel_era.db'}", connect_args={"check_same_thread": False}, future=True
    )
    with legacy_engine.begin() as conn:
        for ddl in LEGACY_CHANNEL_ERA_DDL:
            conn.execute(text(ddl))
    Base.metadata.create_all(bind=legacy_engine)  # resto de tablas (las anteriores ya existen)
    LegacySession = sessionmaker(autocommit=False, autoflush=False, bind=legacy_engine, future=True)
    monkeypatch.setattr(settings, "SEED_DEMO_DATA", True)
    db = LegacySession()
    try:
        # La siembra inserta conversaciones, mensajes y adjuntos con el modelo actual (sin channel)
        seed_database(db, force_reseed_sim=True)
        assert db.query(Conversation).count() > 0
        assert set(db.execute(text("SELECT DISTINCT channel FROM conversations")).scalars()) == {"MISSION"}

        # Datos que dejó la versión anterior: rol retirado, cuenta activa con sesión, conversación del
        # canal retirado, vínculo y adjunto huérfano
        elena = db.query(User).filter(User.email == settings.DEMO_ASTRONAUT1_EMAIL).first()
        legacy_role = Role(code="FAMILY_MEMBER", name="Rol retirado")
        db.add(legacy_role)
        db.flush()
        relative = User(crew_code="LEG-001", email=LEGACY_EMAIL, full_name="Cuenta heredada",
                        password_hash=hash_password(LEGACY_PASSWORD), role_id=legacy_role.id, status="ACTIVE")
        db.add(relative)
        db.flush()
        db.add(UserSession(user_id=relative.id, token="legacy-role-token", csrf_token="legacy-csrf",
                           expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
        mission_id = (
            db.query(MissionAssignment.mission_id)
            .filter(MissionAssignment.user_id == elena.id, MissionAssignment.is_active.is_(True))
            .scalar()
        )
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        db.execute(text(
            "INSERT INTO conversations (mission_id, astronaut_id, leader_id, subject, status, is_highlighted, "
            "last_message_at, is_simulated, created_at, channel) "
            "VALUES (:m, :a, :l, 'Canal retirado', 'OPEN', 0, :now, 0, :now, 'FAMILY')"
        ), {"m": mission_id, "a": elena.id, "l": relative.id, "now": now})
        db.execute(text(
            "INSERT INTO family_contacts (astronaut_id, user_id, relationship, is_active, created_at) "
            "VALUES (:a, :u, 'Pareja', 1, :now)"
        ), {"a": elena.id, "u": relative.id, "now": now})
        db.execute(text(
            "INSERT INTO message_attachments (message_id, file_name, mime_type, file_size_bytes, uploaded_at, "
            "uploader_id, storage_key, kind) VALUES (NULL, 'foto.png', 'image/png', 10, :now, :u, 'abc.png', 'IMAGE')"
        ), {"u": relative.id, "now": now})
        db.commit()
        relative_id, elena_id = relative.id, elena.id

        apply_lightweight_migrations(db)
        apply_lightweight_migrations(db)  # idempotente
        db.expire_all()
        assert db.query(User).filter(User.id == relative_id).first().status == "INACTIVE"
        assert db.query(UserSession).filter(UserSession.token == "legacy-role-token").first().is_revoked is True
        assert db.execute(text("SELECT status FROM conversations WHERE channel = 'FAMILY'")).scalar() == "ARCHIVED"
        conv_cols = {c["name"] for c in inspect(legacy_engine).get_columns("conversations")}
        assert "channel" in conv_cols  # se conserva (tiene DEFAULT): las inserciones no la necesitan
    finally:
        db.close()

    def _legacy_db():
        s = LegacySession()
        try:
            yield s
        finally:
            s.close()

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _legacy_db
    try:
        # La cuenta con el rol retirado ya no puede iniciar sesión
        denied = client.post("/api/v1/auth/login", json={"email": LEGACY_EMAIL, "password": LEGACY_PASSWORD})
        assert denied.status_code in (401, 403)

        elena_s = login(client, settings.DEMO_ASTRONAUT1_EMAIL, settings.DEMO_ASTRONAUT1_PASSWORD)
        admin_s = login(client, settings.DEMO_ADMIN_EMAIL, settings.DEMO_ADMIN_PASSWORD)
        leader_id = login(client, settings.DEMO_LEADER_EMAIL, settings.DEMO_LEADER_PASSWORD)["user"]["id"]
        # Conversación nueva (INSERT real): se elimina antes la que la siembra creó para ese trío
        s = LegacySession()
        try:
            s.query(Conversation).filter(
                Conversation.mission_id == mission_id, Conversation.astronaut_id == elena_id,
                Conversation.leader_id == leader_id,
            ).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()
        created = client.post("/api/v1/conversations", headers=admin_s["headers"],
                              json={"mission_id": mission_id, "astronaut_id": elena_id, "leader_id": leader_id})
        assert created.status_code == 201, created.text
        assert created.json()["created"] is True
        conv_id = created.json()["conversation"]["id"]
        msg = client.post(f"/api/v1/conversations/{conv_id}/messages", headers=elena_s["headers"],
                          json={"content": "Hola desde una BD heredada", "attachment_file_name": "parte.txt"})
        assert msg.status_code == 201, msg.text
        assert msg.json()["message"]["attachments"][0]["file_name"] == "parte.txt"
        with legacy_engine.connect() as conn:
            assert conn.execute(text("SELECT channel FROM conversations WHERE id = :i"), {"i": conv_id}).scalar() == "MISSION"
        # La cuenta con el rol retirado no se acepta como líder de un canal de misión
        bad = client.post("/api/v1/conversations", headers=elena_s["headers"],
                          json={"mission_id": mission_id, "leader_id": relative_id})
        assert bad.status_code == 400
    finally:
        if previous is not None:
            app.dependency_overrides[get_db] = previous
        else:
            app.dependency_overrides.pop(get_db, None)
        legacy_engine.dispose()


def test_lightweight_migration_is_noop_on_db_without_previous_channel(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'prod_like.db'}", future=True)
    Base.metadata.create_all(bind=eng)
    session = sessionmaker(bind=eng, future=True)()
    try:
        apply_lightweight_migrations(session)
        apply_lightweight_migrations(session)
        insp = inspect(eng)
        assert "channel" not in {c["name"] for c in insp.get_columns("conversations")}
        assert "family_contacts" not in insp.get_table_names()
        assert insp.get_columns("message_attachments")[1]["name"] == "message_id"
        assert insp.get_columns("message_attachments")[1]["nullable"] is False
    finally:
        session.close()
        eng.dispose()


# ---------------------------------------------------------------------------
# 6. Regresiones de la auditoría pre-producción
# ---------------------------------------------------------------------------

ATTEND_WINDOW_MSG = (
    "Solo puedes registrar asistencia desde 15 minutos antes del inicio "
    "hasta 24 horas después del final de la actividad."
)


def _activity_note(act_id):
    return f"Actividad de integración #{act_id}"


def _clear_crew_xp_today(user_ids):
    """Permite comprobar el XP por actividad sin depender del límite diario consumido por otras pruebas."""
    db = IsoSession()
    try:
        db.query(GamificationEvent).filter(
            GamificationEvent.user_id.in_(list(user_ids)),
            GamificationEvent.daily_mission_code == "CREW_INTEGRATION",
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _crew_events(user_id, act_id):
    db = IsoSession()
    try:
        return (
            db.query(GamificationEvent)
            .filter(
                GamificationEvent.user_id == user_id,
                GamificationEvent.daily_mission_code == "CREW_INTEGRATION",
                GamificationEvent.reflection_note == _activity_note(act_id),
            )
            .count()
        )
    finally:
        db.close()


def _insert_stale_activity(user_ids, mission_id=1):
    """Actividad con quórum cumplido que quedó SCHEDULED (datos afectados por la carrera antigua)."""
    db = IsoSession()
    try:
        now = datetime.now(timezone.utc)
        act = CrewActivity(
            mission_id=mission_id, title="Actividad afectada", scheduled_for=now, duration_minutes=30,
            status="SCHEDULED", created_by_id=user_ids[0], created_at=now,
        )
        db.add(act)
        db.flush()
        for uid in user_ids:
            db.add(CrewActivityParticipant(
                activity_id=act.id, user_id=uid, response="JOINED", attended=True, attended_at=now, xp_awarded=False,
            ))
        db.commit()
        return act.id
    finally:
        db.close()


def test_recovery_token_never_exposed_unless_explicit_opt_in(client, users):
    email = settings.DEMO_ASTRONAUT2_EMAIL
    previous = settings.DEMO_EXPOSE_RECOVERY_TOKEN
    try:
        settings.DEMO_EXPOSE_RECOVERY_TOKEN = False
        r = client.post("/api/v1/auth/password-recovery/request", json={"email": email})
        assert r.status_code == 200
        assert "demo_recovery_token" not in r.json()
        unknown = client.post("/api/v1/auth/password-recovery/request", json={"email": "nadie@astrovital.demo"})
        assert unknown.json() == r.json()  # no revela si la cuenta existe

        settings.DEMO_EXPOSE_RECOVERY_TOKEN = True
        r = client.post("/api/v1/auth/password-recovery/request", json={"email": email})
        assert r.status_code == 200 and r.json()["demo_recovery_token"]
        assert any("DEMO_EXPOSE_RECOVERY_TOKEN" in w for w in insecure_config_warnings(settings))
    finally:
        settings.DEMO_EXPOSE_RECOVERY_TOKEN = previous
    # La clave de demo siempre genera aviso al arrancar
    assert any("SECRET_KEY" in w for w in insecure_config_warnings(settings)) == (
        "replace-this" in settings.SECRET_KEY or len(settings.SECRET_KEY) < 32
    )



def test_seed_without_demo_data_keeps_catalogs_only(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 'seed.db'}", future=True)
    Base.metadata.create_all(bind=eng)
    db = sessionmaker(bind=eng, future=True)()
    try:
        role = Role(code="ASTRONAUT", name="Astronauta")
        db.add(role)
        db.flush()
        db.add(User(crew_code="AST-201", email=settings.DEMO_ASTRONAUT1_EMAIL, full_name="Elena",
                    password_hash="x", role_id=role.id, status="ACTIVE"))
        db.commit()

        monkeypatch.setattr(settings, "SEED_DEMO_DATA", False)
        seed_database(db)
        assert db.query(User).count() == 1  # no crea cuentas demo
        assert db.query(LeisureActivity).count() >= 10  # los catálogos sí se mantienen
        assert db.query(DailyMission).filter(DailyMission.code == "CREW_INTEGRATION").count() == 1
        assert {r.code for r in db.query(Role).all()} == {"ASTRONAUT"}
    finally:
        db.close()
        eng.dispose()



def test_attend_window_daily_cap_and_min_attendees(client, users):
    elena, marcus, kenji = users["elena"], users["marcus"], users["kenji"]
    eid, mid, kid = elena["user"]["id"], marcus["user"]["id"], kenji["user"]["id"]
    now = datetime.now(timezone.utc)

    # Fuera de ventana: demasiado pronto y demasiado tarde → 409 con mensaje claro
    future = client.post("/api/v1/crew-activities", headers=elena["headers"],
                         json={"mission_id": 1, "template_code": "BOARD_GAME", "scheduled_for": (now + timedelta(hours=2)).isoformat()})
    assert future.status_code == 201
    r = client.post(f"/api/v1/crew-activities/{future.json()['id']}/attend", headers=elena["headers"])
    assert r.status_code == 409 and r.json()["detail"] == ATTEND_WINDOW_MSG
    past = client.post("/api/v1/crew-activities", headers=elena["headers"],
                       json={"mission_id": 1, "template_code": "BOARD_GAME", "scheduled_for": (now - timedelta(days=3)).isoformat()})
    assert past.status_code == 201
    r = client.post(f"/api/v1/crew-activities/{past.json()['id']}/attend", headers=elena["headers"])
    assert r.status_code == 409 and r.json()["detail"] == ATTEND_WINDOW_MSG
    # 10 min antes del inicio ya se puede
    soon = client.post("/api/v1/crew-activities", headers=elena["headers"],
                       json={"mission_id": 1, "template_code": "GROUP_GARDEN", "scheduled_for": (now + timedelta(minutes=10)).isoformat()})
    assert client.post(f"/api/v1/crew-activities/{soon.json()['id']}/attend", headers=elena["headers"]).status_code == 200

    # Límite diario: segunda actividad completada el mismo día → sin XP adicional
    _clear_crew_xp_today([eid, mid])
    xp_e, xp_m = _xp(eid), _xp(mid)
    ids = []
    for code in ("EARTH_OBSERVATION", "CELEBRATION"):
        a = client.post("/api/v1/crew-activities", headers=elena["headers"],
                        json={"mission_id": 1, "template_code": code, "scheduled_for": now.isoformat()}).json()
        client.post(f"/api/v1/crew-activities/{a['id']}/respond", headers=marcus["headers"], json={"response": "JOINED"})
        client.post(f"/api/v1/crew-activities/{a['id']}/attend", headers=elena["headers"])
        done = client.post(f"/api/v1/crew-activities/{a['id']}/attend", headers=marcus["headers"])
        assert done.status_code == 200 and done.json()["status"] == "COMPLETED"
        ids.append(a["id"])
    assert _xp(eid) - xp_e == 25 and _xp(mid) - xp_m == 25
    assert _crew_events(eid, ids[0]) == 1 and _crew_events(eid, ids[1]) == 0

    # Misión de un solo tripulante (Kenji): se completa con quórum 1, pero sin XP
    _clear_crew_xp_today([kid])
    xp_k = _xp(kid)
    db = IsoSession()
    try:
        kenji_mission = db.query(MissionAssignment.mission_id).filter(
            MissionAssignment.user_id == kid, MissionAssignment.is_active.is_(True)).scalar()
    finally:
        db.close()
    solo = client.post("/api/v1/crew-activities", headers=kenji["headers"],
                       json={"mission_id": kenji_mission, "template_code": "MOVIE_NIGHT", "scheduled_for": now.isoformat()})
    assert solo.status_code == 201 and solo.json()["quorum"] == 1
    for _ in range(3):
        r = client.post(f"/api/v1/crew-activities/{solo.json()['id']}/attend", headers=kenji["headers"])
        assert r.status_code == 200 and r.json()["status"] == "COMPLETED"
    assert _xp(kid) == xp_k


def test_concurrent_attend_completes_and_awards_once(client, users):
    elena, marcus = users["elena"], users["marcus"]
    eid, mid = elena["user"]["id"], marcus["user"]["id"]
    for _ in range(8):
        _clear_crew_xp_today([eid, mid])
        act = client.post("/api/v1/crew-activities", headers=elena["headers"],
                          json={"mission_id": 1, "template_code": "SHARED_MEAL",
                                "scheduled_for": datetime.now(timezone.utc).isoformat()}).json()
        assert client.post(f"/api/v1/crew-activities/{act['id']}/respond", headers=marcus["headers"],
                           json={"response": "JOINED"}).status_code == 200
        barrier = threading.Barrier(2)
        codes = []

        def attend(who):
            barrier.wait()
            codes.append(client.post(f"/api/v1/crew-activities/{act['id']}/attend", headers=who["headers"]).status_code)

        threads = [threading.Thread(target=attend, args=(w,)) for w in (elena, marcus)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert codes == [200, 200]
        db = IsoSession()
        try:
            row = db.query(CrewActivity).filter(CrewActivity.id == act["id"]).first()
            assert row.status == "COMPLETED"
            assert all(p.attended and p.xp_awarded for p in row.participants)
        finally:
            db.close()
        assert _crew_events(eid, act["id"]) == 1 and _crew_events(mid, act["id"]) == 1


def test_finalize_is_atomic_and_self_heals_stale_activities(client, users):
    elena, marcus, kenji, leader = users["elena"], users["marcus"], users["kenji"], users["leader"]
    trio = [elena["user"]["id"], marcus["user"]["id"], kenji["user"]["id"]]

    # Varias peticiones a la vez sobre una actividad afectada con 3 asistentes: XP exactamente una vez
    _clear_crew_xp_today(trio)
    act_id = _insert_stale_activity(trio)
    barrier = threading.Barrier(4)
    errors = []

    def finalize():
        db = IsoSession()
        try:
            barrier.wait()
            iso_mod._finalize_activity(db, act_id)
        except Exception as exc:  # pragma: no cover - se informa abajo
            errors.append(exc)
        finally:
            db.close()

    threads = [threading.Thread(target=finalize) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors
    db = IsoSession()
    try:
        row = db.query(CrewActivity).filter(CrewActivity.id == act_id).first()
        assert row.status == "COMPLETED" and row.completed_at is not None
        assert all(p.xp_awarded for p in row.participants)
    finally:
        db.close()
    for uid in trio:
        assert _crew_events(uid, act_id) == 1

    # Autocuración por GET (líder) y por /attend repetido
    pair = trio[:2]
    _clear_crew_xp_today(pair)
    stale_get = _insert_stale_activity(pair)
    listing = client.get("/api/v1/crew-activities?mission_id=1", headers=leader["headers"]).json()["items"]
    assert next(a for a in listing if a["id"] == stale_get)["status"] == "COMPLETED"
    assert _crew_events(pair[0], stale_get) == 1 and _crew_events(pair[1], stale_get) == 1
    stale_attend = _insert_stale_activity(pair)
    r = client.post(f"/api/v1/crew-activities/{stale_attend}/attend", headers=elena["headers"])
    assert r.status_code == 200 and r.json()["status"] == "COMPLETED"
