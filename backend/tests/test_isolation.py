"""Pruebas del módulo de aislamiento y confinamiento (docs/CONTRATO_AISLAMIENTO.md)."""
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database.seed import apply_lightweight_migrations, seed_database
from backend.app.database.session import Base, get_db
from backend.app.main import app
from backend.app.models.models import AuditEvent, ConversationAuditEvent, GamificationProfile, User

TEST_DB_PATH = Path(__file__).resolve().parent / "test_isolation.db"
engine_iso = create_engine(
    f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False}, future=True
)
IsoSession = sessionmaker(autocommit=False, autoflush=False, bind=engine_iso, future=True)

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 64
OGG_BYTES = b"OggS" + b"\x00" * 60


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
    previous_upload_dir = settings.UPLOAD_DIR
    upload_dir = tempfile.mkdtemp(prefix="astrovital-uploads-")
    settings.UPLOAD_DIR = upload_dir
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
    settings.UPLOAD_DIR = previous_upload_dir
    shutil.rmtree(upload_dir, ignore_errors=True)
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
        "ana": login(client, settings.DEMO_FAMILY1_EMAIL, settings.DEMO_FAMILY1_PASSWORD),
        "sofia": login(client, settings.DEMO_FAMILY2_EMAIL, settings.DEMO_FAMILY2_PASSWORD),
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
# 4. Canal familiar y privacidad
# ---------------------------------------------------------------------------

def _family_conv_id(client, users):
    contacts = client.get("/api/v1/family/contacts", headers=users["ana"]["headers"])
    assert contacts.status_code == 200, contacts.text
    items = contacts.json()["items"]
    assert len(items) == 1
    assert items[0]["user_id"] == users["elena"]["user"]["id"]
    assert items[0]["relationship"] == "Pareja"
    return items[0]["conversation_id"]


def test_family_member_is_confined_to_family_channel(client, users):
    ana = users["ana"]
    me = client.get("/api/v1/auth/me", headers=ana["headers"])
    assert me.status_code == 200
    assert me.json()["user"]["role_code"] == "FAMILY_MEMBER"
    for path in (
        f"/api/v1/health/summary?astronaut_id={users['elena']['user']['id']}",
        "/api/v1/alerts",
        "/api/v1/missions",
        "/api/v1/wellness/quick-checkin",
        "/api/v1/wellness/leisure",
        "/api/v1/crew-activities",
        "/api/v1/cognitive/domains",
        "/api/v1/gamification/profile",
    ):
        assert client.get(path, headers=ana["headers"]).status_code == 403, path
    assert client.post("/api/v1/conversations", headers=ana["headers"], json={"mission_id": 1}).status_code == 403


def test_family_channel_privacy(client, users):
    elena, ana, sofia, leader, admin, marcus = (users[k] for k in ("elena", "ana", "sofia", "leader", "admin", "marcus"))
    conv_id = _family_conv_id(client, users)
    assert conv_id

    el_contacts = client.get("/api/v1/family/contacts", headers=elena["headers"]).json()["items"]
    assert {c["relationship"] for c in el_contacts} == {"Pareja", "Hija"}
    assert conv_id in {c["conversation_id"] for c in el_contacts}
    assert client.get("/api/v1/family/contacts", headers=leader["headers"]).status_code == 403

    secret = "Te extrañamos mucho, la niña ya monta en bici #FAM-SECRET-42"
    sent = client.post(
        f"/api/v1/conversations/{conv_id}/messages", headers=ana["headers"],
        json={"content": secret, "category": "URGENT_COMMUNICATION", "linked_alert_id": 1},
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["message"]["category"] == "GENERAL"
    assert sent.json()["message"]["linked_alert_id"] is None

    reply = client.post(f"/api/v1/conversations/{conv_id}/messages", headers=elena["headers"], json={"content": "¡Qué alegría! Os mando una foto pronto."})
    assert reply.status_code == 201

    msgs = client.get(f"/api/v1/conversations/{conv_id}/messages", headers=elena["headers"])
    assert msgs.status_code == 200 and secret in str(msgs.json())
    assert client.get(f"/api/v1/conversations/{conv_id}/messages", headers=ana["headers"]).status_code == 200

    # Listados: FAMILY separado de MISSION
    ana_list = client.get("/api/v1/conversations", headers=ana["headers"]).json()["conversations"]
    assert [c["id"] for c in ana_list] == [conv_id]
    assert ana_list[0]["channel"] == "FAMILY"
    assert ana_list[0]["family_contact"] == {"name": "Ana Rostova", "relationship": "Pareja"}
    elena_default = client.get("/api/v1/conversations", headers=elena["headers"]).json()["conversations"]
    assert elena_default and all(c["channel"] == "MISSION" for c in elena_default)
    elena_family = client.get("/api/v1/conversations?channel=FAMILY", headers=elena["headers"]).json()["conversations"]
    assert conv_id in {c["id"] for c in elena_family}

    # Líder: nunca ve FAMILY en listados ni puede leer
    for q in ("", "?channel=FAMILY", "?channel=MISSION"):
        ldr = client.get(f"/api/v1/conversations{q}", headers=leader["headers"]).json()["conversations"]
        assert all(c["channel"] == "MISSION" for c in ldr)
        assert conv_id not in {c["id"] for c in ldr}
    assert client.get(f"/api/v1/conversations/{conv_id}/messages", headers=leader["headers"]).status_code == 403
    assert client.post(f"/api/v1/conversations/{conv_id}/messages", headers=leader["headers"], json={"content": "hola"}).status_code == 403

    # Administración: la lectura auditada devuelve 403 en FAMILY; solo metadatos en el listado
    justified = f"/api/v1/conversations/{conv_id}/messages?audit_justification=Auditoria_Seguridad_Protocolo_01"
    assert client.get(justified, headers=admin["headers"]).status_code == 403
    assert client.get(f"/api/v1/conversations/{conv_id}?audit_justification=Auditoria_Seguridad_Protocolo_01", headers=admin["headers"]).status_code == 403
    adm_list = client.get("/api/v1/conversations?channel=FAMILY", headers=admin["headers"])
    assert adm_list.status_code == 200
    adm_item = next(c for c in adm_list.json()["conversations"] if c["id"] == conv_id)
    assert adm_item["last_message_preview"] is None
    assert adm_item["total_messages"] >= 2
    assert secret not in str(adm_list.json())
    adm_default = client.get("/api/v1/conversations", headers=admin["headers"]).json()["conversations"]
    assert conv_id not in {c["id"] for c in adm_default}

    # Terceros: otro astronauta y otra familiar no leen la conversación
    assert client.get(f"/api/v1/conversations/{conv_id}/messages", headers=marcus["headers"]).status_code == 403
    assert client.get(f"/api/v1/conversations/{conv_id}/messages", headers=sofia["headers"]).status_code == 403
    assert client.post(f"/api/v1/conversations/{conv_id}/messages", headers=sofia["headers"], json={"content": "hola"}).status_code == 403

    # La auditoría de FAMILY guarda solo metadatos
    db = IsoSession()
    try:
        for ev in db.query(AuditEvent).all():
            assert secret not in (ev.details or "") and secret not in (ev.justification or "")
        for ev in db.query(ConversationAuditEvent).filter(ConversationAuditEvent.conversation_id == conv_id).all():
            assert secret not in (ev.details or "")
    finally:
        db.close()

    # El resumen de Mission Control (que ve el líder) no cuenta mensajes FAMILY
    summary = client.get(f"/api/v1/health/summary?astronaut_id={elena['user']['id']}&mission_id=1", headers=leader["headers"])
    assert summary.status_code == 200
    assert secret not in str(summary.json())


# ---------------------------------------------------------------------------
# 5. Adjuntos
# ---------------------------------------------------------------------------

def _upload(client, who, content, name="foto.png", ctype="image/png"):
    return client.post("/api/v1/attachments", headers=who["headers"], files={"file": (name, content, ctype)})


def test_attachments_validation_download_and_privacy(client, users):
    elena, ana, sofia, leader, admin, marcus = (users[k] for k in ("elena", "ana", "sofia", "leader", "admin", "marcus"))
    conv_id = _family_conv_id(client, users)

    # Magic bytes: un .png con contenido de texto se rechaza
    fake = _upload(client, elena, b"esto no es una imagen, es texto plano", name="trampa.png", ctype="image/png")
    assert fake.status_code == 415
    html = _upload(client, elena, b"<html><script>alert(1)</script></html>", name="x.png", ctype="image/png")
    assert html.status_code == 415
    # Tamaño > 5 MB rechazado
    big = _upload(client, elena, PNG_BYTES + b"\x00" * (5 * 1024 * 1024))
    assert big.status_code == 413
    # Administración (no participa en conversaciones) no sube adjuntos
    assert _upload(client, admin, PNG_BYTES).status_code == 403

    up = _upload(client, elena, PNG_BYTES, name="../../etc/passwd.png", ctype="application/octet-stream")
    assert up.status_code == 201, up.text
    att = up.json()
    assert att["kind"] == "IMAGE" and att["mime_type"] == "image/png"
    assert att["file_size_bytes"] == len(PNG_BYTES) and att["duration_seconds"] is None
    assert "/" not in att["file_name"] and ".." not in att["file_name"].split(".")[0]
    # Ningún archivo en disco usa el nombre del cliente
    stored = list(Path(settings.UPLOAD_DIR).iterdir())
    assert stored and all("passwd" not in p.name for p in stored)

    voice = _upload(client, elena, OGG_BYTES, name="nota.ogg", ctype="audio/ogg")
    assert voice.status_code == 201 and voice.json()["kind"] == "AUDIO"

    # Huérfano: solo quien lo subió lo descarga
    assert client.get(f"/api/v1/attachments/{att['id']}", headers=elena["headers"]).status_code == 200
    assert client.get(f"/api/v1/attachments/{att['id']}", headers=ana["headers"]).status_code == 404

    # No se puede adjuntar el archivo de otra persona
    stolen = client.post(f"/api/v1/conversations/{conv_id}/messages", headers=ana["headers"], json={"content": "", "attachment_ids": [att["id"]]})
    assert stolen.status_code == 403
    # Mensaje vacío sin adjuntos → 422; más de 4 adjuntos → 422
    assert client.post(f"/api/v1/conversations/{conv_id}/messages", headers=elena["headers"], json={"content": "   "}).status_code == 422
    assert client.post(f"/api/v1/conversations/{conv_id}/messages", headers=elena["headers"], json={"content": "", "attachment_ids": [1, 2, 3, 4, 5]}).status_code == 422

    # Mensaje vacío con adjuntos → OK
    sent = client.post(
        f"/api/v1/conversations/{conv_id}/messages", headers=elena["headers"],
        json={"content": "", "attachment_ids": [att["id"], voice.json()["id"]]},
    )
    assert sent.status_code == 201, sent.text
    m = sent.json()["message"]
    assert m["has_attachment"] is True and m["content"] == ""
    urls = {a["id"]: a for a in m["attachments"]}
    assert urls[att["id"]]["url"] == f"/api/v1/attachments/{att['id']}"
    assert urls[att["id"]]["kind"] == "IMAGE"
    assert {"id", "file_name", "mime_type", "kind", "file_size_bytes", "url"} <= set(urls[att["id"]])

    # Un adjunto ya enviado no se reutiliza
    again = client.post(f"/api/v1/conversations/{conv_id}/messages", headers=elena["headers"], json={"content": "otra vez", "attachment_ids": [att["id"]]})
    assert again.status_code == 409

    # Descarga por la familiar: cabeceras seguras
    dl = client.get(f"/api/v1/attachments/{att['id']}", headers=ana["headers"])
    assert dl.status_code == 200
    assert dl.content == PNG_BYTES
    assert dl.headers["content-type"].startswith("image/png")
    assert dl.headers["x-content-type-options"] == "nosniff"
    assert "private" in dl.headers["cache-control"]
    assert dl.headers["content-disposition"].startswith("inline")

    # Terceros, líder y administración (incluso con justificación) → 403
    for who in (leader, marcus, sofia):
        assert client.get(f"/api/v1/attachments/{att['id']}", headers=who["headers"]).status_code == 403
    assert client.get(
        f"/api/v1/attachments/{att['id']}?audit_justification=Auditoria_Seguridad_Protocolo_01", headers=admin["headers"]
    ).status_code == 403
    assert client.get("/api/v1/attachments/999999", headers=ana["headers"]).status_code == 404

    # Máximo de 4 adjuntos aceptados por mensaje
    four = [_upload(client, ana, PNG_BYTES).json()["id"] for _ in range(4)]
    ok4 = client.post(f"/api/v1/conversations/{conv_id}/messages", headers=ana["headers"], json={"content": "", "attachment_ids": four})
    assert ok4.status_code == 201
    assert len(ok4.json()["message"]["attachments"]) == 4


def test_reply_and_dedup_cannot_leak_other_conversations(client, users):
    elena, marcus, ana = users["elena"], users["marcus"], users["ana"]
    conv_id = _family_conv_id(client, users)
    family_msgs = client.get(f"/api/v1/conversations/{conv_id}/messages", headers=elena["headers"]).json()["messages"]
    family_msg_id = family_msgs[0]["id"]
    marcus_conv = client.get("/api/v1/conversations", headers=marcus["headers"]).json()["conversations"][0]["id"]
    # Citar un mensaje de otra conversación no está permitido (filtraría su contenido)
    leak = client.post(f"/api/v1/conversations/{marcus_conv}/messages", headers=marcus["headers"], json={"content": "hola", "reply_to_message_id": family_msg_id})
    assert leak.status_code == 400
    # Una dedup_key ajena no devuelve el mensaje de otra persona
    first = client.post(f"/api/v1/conversations/{conv_id}/messages", headers=ana["headers"], json={"content": "privado", "dedup_key": "ISO-DEDUP-001"})
    assert first.status_code == 201
    stolen = client.post(f"/api/v1/conversations/{marcus_conv}/messages", headers=marcus["headers"], json={"content": "x", "dedup_key": "ISO-DEDUP-001"})
    assert stolen.status_code == 409
    again = client.post(f"/api/v1/conversations/{conv_id}/messages", headers=ana["headers"], json={"content": "privado", "dedup_key": "ISO-DEDUP-001"})
    assert again.status_code == 201 and again.json()["duplicate_prevented"] is True


# ---------------------------------------------------------------------------
# 6. Migración ligera de BD existentes
# ---------------------------------------------------------------------------

def test_lightweight_migration_upgrades_old_schema(tmp_path):
    old_engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}", future=True)
    with old_engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE conversations (id INTEGER PRIMARY KEY, mission_id INTEGER NOT NULL, astronaut_id INTEGER NOT NULL, "
            "leader_id INTEGER NOT NULL, subject VARCHAR(200) NOT NULL)"
        ))
        conn.execute(text(
            "CREATE TABLE message_attachments (id INTEGER NOT NULL PRIMARY KEY, message_id INTEGER NOT NULL, "
            "file_name VARCHAR(180) NOT NULL, mime_type VARCHAR(80) NOT NULL, file_size_bytes INTEGER NOT NULL, "
            "safe_summary_note VARCHAR(255), uploaded_at DATETIME NOT NULL)"
        ))
        conn.execute(text("CREATE INDEX ix_message_attachments_message_id ON message_attachments (message_id)"))
        conn.execute(text("INSERT INTO conversations VALUES (1, 1, 2, 3, 'Canal')"))
        conn.execute(text("INSERT INTO message_attachments VALUES (7, 1, 'informe.txt', 'text/plain', 10, NULL, '2026-01-01 00:00:00')"))
    session = sessionmaker(bind=old_engine, future=True)()
    try:
        apply_lightweight_migrations(session)
        apply_lightweight_migrations(session)  # idempotente
        insp = inspect(old_engine)
        conv_cols = {c["name"] for c in insp.get_columns("conversations")}
        assert "channel" in conv_cols
        assert session.execute(text("SELECT channel FROM conversations WHERE id = 1")).scalar() == "MISSION"
        att_cols = {c["name"]: c for c in insp.get_columns("message_attachments")}
        assert {"uploader_id", "storage_key", "kind", "duration_seconds"} <= set(att_cols)
        assert att_cols["message_id"]["nullable"] is True
        row = session.execute(text("SELECT id, file_name, message_id FROM message_attachments")).fetchall()
        assert [tuple(r) for r in row] == [(7, "informe.txt", 1)]
    finally:
        session.close()
        old_engine.dispose()


# ---------------------------------------------------------------------------
# 7. Regresiones de la auditoría pre-producción
# ---------------------------------------------------------------------------

import asyncio  # noqa: E402
import json  # noqa: E402
import struct  # noqa: E402
import threading  # noqa: E402

from backend.app.api.v1 import isolation_router as iso_mod  # noqa: E402
from backend.app.core.config import insecure_config_warnings  # noqa: E402
from backend.app.database.seed import seed_isolation_module  # noqa: E402
from backend.app.main import UploadSizeLimitMiddleware  # noqa: E402
from backend.app.models.models import (  # noqa: E402
    CrewActivity,
    CrewActivityParticipant,
    GamificationEvent,
    LeisureActivity,
    MessageAttachment,
    MissionAssignment,
    Role,
)

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


def test_demo_family_accounts_respect_seed_demo_data(tmp_path, monkeypatch):
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
        family_emails = [settings.DEMO_FAMILY1_EMAIL, settings.DEMO_FAMILY2_EMAIL]

        monkeypatch.setattr(settings, "SEED_DEMO_DATA", False)
        seed_database(db)
        assert db.query(User).filter(User.email.in_(family_emails)).count() == 0
        assert db.query(LeisureActivity).count() >= 10  # los catálogos sí se mantienen
        assert db.query(Role).filter(Role.code == "FAMILY_MEMBER").count() == 1

        monkeypatch.setattr(settings, "SEED_DEMO_DATA", True)
        seed_isolation_module(db)
        assert db.query(User).filter(User.email.in_(family_emails)).count() == 2
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


def _box(kind, payload):
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def _mp4(brand, handler=None):
    data = _box(b"ftyp", brand + b"\x00\x00\x02\x00" + brand + b"mp41")
    if handler:
        hdlr = _box(b"hdlr", b"\x00" * 8 + handler + b"\x00" * 12 + b"Handler\x00")
        data += _box(b"moov", _box(b"trak", _box(b"mdia", hdlr)))
    return data + b"\x00" * 32


def test_audio_magic_bytes_are_strict(client, users):
    detect = iso_mod.detect_mime_from_magic
    assert detect(b"ID3\x04\x00" + b"\x00" * 20) == "audio/mpeg"
    assert detect(b"\xff\xfb\x90\x64" + b"\x00" * 20) == "audio/mpeg"  # MPEG-1 Layer III 128 kbps 44.1 kHz
    assert detect(b"\xff\xf3\x64\xc4" + b"\x00" * 20) == "audio/mpeg"  # MPEG-2 Layer III
    assert detect(b"\xff\xff\xff\xff" + b"\x00" * 20) is None  # bitrate no válido
    assert detect(b"\xff\xe0\x00\x00" + b"\x00" * 20) is None  # versión/capa reservadas
    assert detect(b"\xff\xfb\x9c\x64" + b"\x00" * 20) is None  # frecuencia reservada
    assert detect(_mp4(b"M4A ")) == "audio/mp4"
    assert detect(_mp4(b"iso5")) == "audio/mp4"  # Safari MediaRecorder (se verifica la pista después)
    assert detect(_mp4(b"qt  ")) is None and detect(_mp4(b"avc1")) is None
    assert detect(b"\x1a\x45\xdf\xa3" + b"\x00" * 20 + b"webm" + b"\x00" * 20) == "audio/webm"

    elena = users["elena"]
    ok = []
    for content in (_mp4(b"iso5", b"soun"), _mp4(b"mp42", b"soun"), _mp4(b"isom", b"soun"), _mp4(b"M4A ")):
        r = _upload(client, elena, content, name="nota.m4a", ctype="audio/mp4")
        assert r.status_code == 201, r.text
        assert r.json()["mime_type"] == "audio/mp4" and r.json()["kind"] == "AUDIO"
        ok.append(r.json()["id"])
    for content in (_mp4(b"isom", b"vide"), _mp4(b"mp42"), _mp4(b"M4A ", b"vide"), b"\xff\xff\xff\xff" + b"\x00" * 64):
        assert _upload(client, elena, content, name="video.mp4", ctype="audio/mp4").status_code == 415
    for att_id in ok:
        assert client.delete(f"/api/v1/attachments/{att_id}", headers=elena["headers"]).status_code == 204


def test_delete_orphan_attachment(client, users):
    elena, ana = users["elena"], users["ana"]
    conv_id = _family_conv_id(client, users)
    up = _upload(client, elena, PNG_BYTES).json()
    db = IsoSession()
    try:
        key = db.query(MessageAttachment).filter(MessageAttachment.id == up["id"]).first().storage_key
    finally:
        db.close()
    path = Path(settings.UPLOAD_DIR) / key
    assert path.is_file()
    # Otra persona no puede borrarlo (ni saber que existe)
    r = client.delete(f"/api/v1/attachments/{up['id']}", headers=ana["headers"])
    assert r.status_code == 404 and r.json()["detail"] == "Adjunto no encontrado."
    assert client.delete(f"/api/v1/attachments/{up['id']}", headers=elena["headers"]).status_code == 204
    assert not path.exists()
    assert client.get(f"/api/v1/attachments/{up['id']}", headers=elena["headers"]).status_code == 404
    assert client.delete(f"/api/v1/attachments/{up['id']}", headers=elena["headers"]).status_code == 404
    # Uno ya enviado no se descarta
    sent_att = _upload(client, elena, PNG_BYTES).json()["id"]
    assert client.post(f"/api/v1/conversations/{conv_id}/messages", headers=elena["headers"],
                       json={"content": "", "attachment_ids": [sent_att]}).status_code == 201
    r = client.delete(f"/api/v1/attachments/{sent_att}", headers=elena["headers"])
    assert r.status_code == 409 and r.json()["detail"] == "Solo se pueden descartar adjuntos que aún no se han enviado."


def test_expired_orphans_are_purged_and_unblock_uploads(client, users):
    marcus = users["marcus"]
    uid = marcus["user"]["id"]
    limit = settings.MAX_PENDING_ATTACHMENTS_PER_USER
    db = IsoSession()
    try:
        pending = db.query(MessageAttachment).filter(
            MessageAttachment.uploader_id == uid, MessageAttachment.message_id.is_(None)).count()
    finally:
        db.close()
    for _ in range(limit - pending):
        assert _upload(client, marcus, PNG_BYTES).status_code == 201
    assert _upload(client, marcus, PNG_BYTES).status_code == 429

    ttl = settings.ORPHAN_ATTACHMENT_TTL_HOURS

    def _age_orphans(hours):
        db = IsoSession()
        try:
            rows = db.query(MessageAttachment).filter(
                MessageAttachment.uploader_id == uid, MessageAttachment.message_id.is_(None)).all()
            for r in rows:
                r.uploaded_at = datetime.now(timezone.utc) - timedelta(hours=hours)
            db.commit()
            return [r.storage_key for r in rows]
        finally:
            db.close()

    # Huérfanos de 25 h (p. ej. de un mensaje en la cola sin conexión): dentro del TTL (168 h), no se purgan
    if ttl > 25:
        recent_keys = _age_orphans(25)
        assert _upload(client, marcus, PNG_BYTES).status_code == 429
        assert all((Path(settings.UPLOAD_DIR) / k).is_file() for k in recent_keys)

    # Más viejos que el TTL: la siguiente subida los purga (fila + archivo) y se acepta
    old_keys = _age_orphans(ttl + 1)
    assert _upload(client, marcus, PNG_BYTES).status_code == 201
    assert all(not (Path(settings.UPLOAD_DIR) / k).exists() for k in old_keys)
    db = IsoSession()
    try:
        assert db.query(MessageAttachment).filter(
            MessageAttachment.uploader_id == uid, MessageAttachment.message_id.is_(None)).count() == 1
        # Purga de arranque (sin filtrar por usuario): mismo mecanismo
        last = db.query(MessageAttachment).filter(
            MessageAttachment.uploader_id == uid, MessageAttachment.message_id.is_(None)).first()
        last_key = last.storage_key
        last.uploaded_at = datetime.now(timezone.utc) - timedelta(hours=ttl + 1)
        db.commit()
        assert iso_mod.purge_expired_orphan_attachments(db) >= 1
        assert not (Path(settings.UPLOAD_DIR) / last_key).exists()
        assert db.query(MessageAttachment).filter(MessageAttachment.storage_key == last_key).count() == 0
    finally:
        db.close()


def test_attachment_ids_are_never_reused(client, users):
    elena = users["elena"]
    conv_id = _family_conv_id(client, users)
    # Descartado con DELETE: el siguiente adjunto no recibe su id (sería el más alto sin AUTOINCREMENT)
    first = _upload(client, elena, PNG_BYTES).json()["id"]
    assert client.delete(f"/api/v1/attachments/{first}", headers=elena["headers"]).status_code == 204
    second = _upload(client, elena, PNG_BYTES).json()["id"]
    assert second > first
    # Purgado por caducidad: igual
    db = IsoSession()
    try:
        att = db.query(MessageAttachment).filter(MessageAttachment.id == second).first()
        att.uploaded_at = datetime.now(timezone.utc) - timedelta(hours=settings.ORPHAN_ATTACHMENT_TTL_HOURS + 1)
        db.commit()
        assert iso_mod.purge_expired_orphan_attachments(db) >= 1
    finally:
        db.close()
    third = _upload(client, elena, PNG_BYTES).json()["id"]
    assert third > second
    # Un mensaje "en cola" que aún referencia el id purgado falla en vez de adjuntar el archivo nuevo
    r = client.post(f"/api/v1/conversations/{conv_id}/messages", headers=elena["headers"],
                    json={"content": "", "attachment_ids": [second]})
    assert r.status_code == 404 and r.json()["detail"] == f"Adjunto #{second} no encontrado."
    assert client.delete(f"/api/v1/attachments/{third}", headers=elena["headers"]).status_code == 204


def _id3_tag(body, version=3, footer=False):
    size = len(body)
    sincsafe = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    flags = 0x10 if footer else 0x00
    tag = b"ID3" + bytes([version, 0, flags]) + sincsafe + body
    if footer:
        tag += b"3DI" + bytes([version, 0, flags]) + sincsafe
    return tag


# Frame MPEG-1 Layer III, 128 kbps, 44.1 kHz, sin padding: 417 bytes
MP3_FRAME = b"\xff\xfb\x90\x64" + b"\x00" * 413


def test_id3_mp3_requires_mpeg_frame_after_tag(client, users):
    elena = users["elena"]
    # Etiqueta con un frame TIT2 y relleno: el audio empieza más allá de los primeros 64 bytes
    tit2 = b"TIT2" + struct.pack(">I", 6) + b"\x00\x00" + b"\x00Nota\x00"
    tag_body = tit2 + b"\x00" * 200
    ok_ids = []
    for content in (
        _id3_tag(tag_body) + MP3_FRAME * 2,  # MP3 real mínimo (ID3v2.3 + frames)
        _id3_tag(tag_body, version=4, footer=True) + MP3_FRAME,  # ID3v2.4 con footer (+10 bytes)
    ):
        r = _upload(client, elena, content, name="nota.mp3", ctype="audio/mpeg")
        assert r.status_code == 201, r.text
        assert r.json()["mime_type"] == "audio/mpeg" and r.json()["kind"] == "AUDIO"
        ok_ids.append(r.json()["id"])
    for content in (
        b"ID3<html><script>alert(1)</script></html>",  # 'ID3' + cualquier cosa
        _id3_tag(tag_body) + b"<html></html>" + b"\x00" * 64,  # etiqueta válida, pero no sigue audio
        _id3_tag(tag_body),  # demasiado corto para comprobar el frame
        _id3_tag(tag_body) + b"\xff\xfb",  # frame truncado
        _id3_tag(tag_body, footer=True)[:-10] + MP3_FRAME,  # flag de footer sin footer: el frame no está donde toca
        b"ID3\x03\x00\x00\x00\x00\x01\x80" + MP3_FRAME,  # tamaño no sincsafe
    ):
        r = _upload(client, elena, content, name="nota.mp3", ctype="audio/mpeg")
        assert r.status_code == 415, (content[:16], r.status_code)
    for att_id in ok_ids:
        assert client.delete(f"/api/v1/attachments/{att_id}", headers=elena["headers"]).status_code == 204


def test_lightweight_migration_adds_autoincrement_to_attachments(tmp_path):
    old_engine = create_engine(f"sqlite:///{tmp_path / 'noautoinc.db'}", future=True)
    with old_engine.begin() as conn:
        # Esquema de la versión anterior: columnas actuales, pero id sin AUTOINCREMENT
        conn.execute(text(
            "CREATE TABLE message_attachments (id INTEGER NOT NULL, message_id INTEGER, "
            "file_name VARCHAR(180) NOT NULL, mime_type VARCHAR(80) NOT NULL, file_size_bytes INTEGER NOT NULL, "
            "safe_summary_note VARCHAR(255), uploaded_at DATETIME NOT NULL, uploader_id INTEGER, "
            "storage_key VARCHAR(64), kind VARCHAR(10), duration_seconds FLOAT, PRIMARY KEY (id), UNIQUE (storage_key), "
            "FOREIGN KEY(message_id) REFERENCES messages (id) ON DELETE CASCADE, "
            "FOREIGN KEY(uploader_id) REFERENCES users (id) ON DELETE CASCADE)"
        ))
        conn.execute(text("CREATE INDEX ix_message_attachments_id ON message_attachments (id)"))
        conn.execute(text("CREATE INDEX ix_message_attachments_message_id ON message_attachments (message_id)"))
        conn.execute(text("CREATE INDEX ix_message_attachments_uploader_id ON message_attachments (uploader_id)"))
        conn.execute(text("CREATE INDEX ix_custom_attachment_kind ON message_attachments (kind)"))  # índice ajeno al modelo
        for i, key in ((1, None), (2, "a" * 32 + ".png"), (3, "b" * 32 + ".ogg")):
            conn.execute(text(
                "INSERT INTO message_attachments (id, message_id, file_name, mime_type, file_size_bytes, uploaded_at, "
                "uploader_id, storage_key, kind) VALUES (:i, :m, :n, 'image/png', 10, '2026-01-01 00:00:00', 5, :k, 'IMAGE')"
            ), {"i": i, "m": 9 if i == 1 else None, "n": f"f{i}.png", "k": key})
    session = sessionmaker(bind=old_engine, future=True)()
    try:
        apply_lightweight_migrations(session)
        apply_lightweight_migrations(session)  # idempotente
        table_sql = session.execute(text(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='message_attachments'")).scalar()
        assert "AUTOINCREMENT" in table_sql.upper()
        assert session.execute(text(
            "SELECT count(*) FROM sqlite_master WHERE name='_message_attachments_old'")).scalar() == 0
        rows = session.execute(text(
            "SELECT id, message_id, file_name, uploader_id, storage_key, kind FROM message_attachments ORDER BY id")).fetchall()
        assert [tuple(r) for r in rows] == [
            (1, 9, "f1.png", 5, None, "IMAGE"),
            (2, None, "f2.png", 5, "a" * 32 + ".png", "IMAGE"),
            (3, None, "f3.png", 5, "b" * 32 + ".ogg", "IMAGE"),
        ]
        idx = {r[0] for r in session.execute(text(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='message_attachments'")).fetchall()}
        assert {"ix_message_attachments_id", "ix_message_attachments_message_id",
                "ix_message_attachments_uploader_id", "ix_custom_attachment_kind"} <= idx
        assert any(i.startswith("sqlite_autoindex_message_attachments") for i in idx)  # UNIQUE(storage_key)
        fks = {(r[2], r[3], r[6]) for r in session.execute(text("PRAGMA foreign_key_list(message_attachments)")).fetchall()}
        assert fks == {("messages", "message_id", "CASCADE"), ("users", "uploader_id", "CASCADE")}
        # Desde ahora un id borrado no se reutiliza
        session.execute(text("DELETE FROM message_attachments WHERE id = 3"))
        session.execute(text(
            "INSERT INTO message_attachments (message_id, file_name, mime_type, file_size_bytes, uploaded_at) "
            "VALUES (NULL, 'nuevo.png', 'image/png', 1, '2026-01-02 00:00:00')"))
        session.commit()
        assert session.execute(text("SELECT max(id) FROM message_attachments")).scalar() == 4
    finally:
        session.close()
        old_engine.dispose()


def _run_middleware(headers, method="POST", path="/api/v1/attachments"):
    called = []
    sent = []

    async def inner(scope, receive, send):
        called.append(True)
        await send({"type": "http.response.start", "status": 201, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": method, "path": path,
             "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]}
    asyncio.run(UploadSizeLimitMiddleware(inner)(scope, receive, send))
    status_code = next(m["status"] for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status_code, body, bool(called)


def test_upload_size_is_checked_before_parsing(client, users):
    limit = settings.MAX_ATTACHMENT_BYTES + 64 * 1024
    code, body, reached = _run_middleware({})
    assert code == 411 and not reached
    assert json.loads(body)["detail"] == "Falta la cabecera Content-Length: no se aceptan subidas sin tamaño declarado."
    code, body, reached = _run_middleware({"Content-Length": str(limit + 1)})
    assert code == 413 and not reached
    assert json.loads(body)["detail"] == "El adjunto supera el tamaño máximo de 5 MB."
    code, _, reached = _run_middleware({"Content-Length": "abc"})
    assert code == 400 and not reached
    assert _run_middleware({"Content-Length": str(limit)})[2] is True
    # Otras rutas y métodos no se ven afectados
    assert _run_middleware({}, path="/api/v1/conversations/1/messages")[2] is True
    assert _run_middleware({}, method="GET", path="/api/v1/attachments/1")[2] is True

    # Extremo a extremo: un cuerpo de 6 MB se rechaza con 413 sin dejar archivos temporales
    before = set(Path(settings.UPLOAD_DIR).iterdir())
    big = _upload(client, users["elena"], PNG_BYTES + b"\x00" * (6 * 1024 * 1024))
    assert big.status_code == 413
    assert set(Path(settings.UPLOAD_DIR).iterdir()) == before


def test_family_member_conversation_hides_mission_fields(client, users):
    ana, elena = users["ana"], users["elena"]
    _family_conv_id(client, users)
    convs = client.get("/api/v1/conversations", headers=ana["headers"]).json()["conversations"]
    assert convs
    for c in convs:
        for field in ("mission_code", "mission_name", "astronaut_crew_code", "astronaut_callsign"):
            assert c[field] is None, field
        assert c["astronaut_name"]
    assert client.get("/api/v1/conversations?search=rostova", headers=ana["headers"]).status_code == 200
    detail = client.get(f"/api/v1/conversations/{convs[0]['id']}", headers=ana["headers"])
    assert detail.status_code == 200 and detail.json()["conversation"]["mission_code"] is None
    own = client.get("/api/v1/conversations?channel=FAMILY", headers=elena["headers"]).json()["conversations"]
    assert own and all(c["mission_code"] for c in own)
