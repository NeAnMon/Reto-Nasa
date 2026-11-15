"""Integración del script de precarga sintética por API (issue #24): scripts/seed_synthetic_api.py.

Ejecuta el script contra la app real (TestClient) sobre una BD SQLite temporal sembrada con el seed demo
y comprueba que deja datos útiles para predicción, gráficas, comparación de fases y alertas, que todo
queda marcado como SIMULADO y que una segunda ejecución no duplica nada.
"""
import importlib.util
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings
from backend.app.database.seed import seed_database
from backend.app.database.session import Base, get_db
from backend.app.main import app
from backend.app.models.models import (
    Alert, EnvironmentalMeasurement, HealthBaseline, HealthMeasurement, MissionContext, User,
)

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "seed_synthetic_api.py"
_spec = importlib.util.spec_from_file_location("seed_synthetic_api", SCRIPT)
seeder = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = seeder  # las dataclasses del script resuelven su módulo
_spec.loader.exec_module(seeder)

INDICATORS = ["HEART_RATE", "BLOOD_PRESSURE", "SPO2", "BODY_TEMP", "PERCEIVED_FATIGUE", "BLOOD_GLUCOSE"]


@pytest.fixture(scope="module")
def session_factory(tmp_path_factory):
    path = tmp_path_factory.mktemp("seed24") / "seed24.db"
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


def _config(**overrides):
    cfg = seeder.Config(
        admin_email=settings.DEMO_ADMIN_EMAIL,
        admin_password=settings.DEMO_ADMIN_PASSWORD,
        leader_email=settings.DEMO_LEADER_EMAIL,
        astronaut_password=settings.DEMO_ASTRONAUT1_PASSWORD,
        astronauts=3,
        days=30,
        indicators=list(INDICATORS),
        baselines_db=True,
    )
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return cfg


@pytest.fixture(scope="module")
def first_run(client, session_factory):
    return seeder.run(_config(), client, session_factory=session_factory)


def _synthetic_ids(db):
    return [u.id for u in db.query(User).filter(User.crew_code.like("SYN24-%")).all()]


def test_series_are_reproducible_and_scenario_specific():
    a = seeder.generate_series(24, "SYN24-01", "HEART_RATE", 30)
    assert a == seeder.generate_series(24, "SYN24-01", "HEART_RATE", 30)
    assert a != seeder.generate_series(25, "SYN24-01", "HEART_RATE", 30)
    rising = seeder.generate_series(24, "SYN24-02", "HEART_RATE", 30, trend_per_day=0.3)
    assert sum(v for v, _ in rising[-7:]) / 7 > sum(v for v, _ in rising[:7]) / 7
    bp = seeder.generate_series(24, "SYN24-01", "BLOOD_PRESSURE", 30)
    assert all(dia is not None and dia < systolic for systolic, dia in bp)


def test_first_run_loads_data_and_verification_passes(first_run):
    assert first_run["failed"] == {}, first_run["errors"]
    verification = first_run["verification"]
    failed_checks = [c for c in verification["checks"] if not c["ok"]]
    assert verification["all_ok"], failed_checks
    # 3 astronautas × (5 indicadores × 30 días + glucosa 5 días)
    assert first_run["created"]["health_measurements"] == 3 * (5 * 30 + 5)
    assert first_run["created"]["users"] == 3
    assert first_run["created"]["missions"] == 1
    statuses = verification["prediction_status_counts"]
    assert statuses.get("ok", 0) >= 1
    assert statuses.get("insufficient_data", 0) >= 3  # glucosa: solo 5 días
    # El backend calculó estados distintos de NORMAL y alertas a partir de las anomalías
    # (el script no fija estados: solo apunta a los tramos de la regla vigente)
    assert "NORMAL" in first_run["measurement_states_created"]
    assert set(first_run["measurement_states_created"]) - {"NORMAL"}
    assert first_run["measurements_with_alert"] > 0
    assert {"WARNING", "CRITICAL"} & set(verification["alerts_by_state"])


def test_predictions_have_statistics_and_forecast(client, first_run):
    astro = next(a for a in first_run["astronauts"] if a["scenario"] == "ESTABLE")
    login = client.post("/api/v1/auth/login", json={
        "email": astro["email"], "password": settings.DEMO_ASTRONAUT1_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    oks = []
    for code in INDICATORS:
        r = client.get(f"/api/v1/predictions/indicators/{code}", headers=headers, params={
            "mission_id": first_run["mission"]["id"], "include_simulated": "true"})
        assert r.status_code == 200, r.text
        if r.json()["status"] == "ok":
            oks.append(r.json())
    assert oks, "ninguna predicción ok para el astronauta estable"
    body = oks[0]
    assert body["n_days"] >= 10 and body["phase_code"] == "SURFACE"
    assert body["forecast"] and body["reliability"]["mae_model"] is not None
    assert body["baseline_status"] != "missing"


def test_records_are_marked_simulated_and_linked(session_factory, first_run):
    db = session_factory()
    try:
        ids = _synthetic_ids(db)
        assert len(ids) == 3
        rows = db.query(HealthMeasurement).filter(HealthMeasurement.astronaut_id.in_(ids)).all()
        assert rows and all(r.is_simulated for r in rows)
        assert all(r.data_quality in ("SYNTHETIC_DEMO", "INVALID") for r in rows)
        assert all(r.mission_id == first_run["mission"]["id"] for r in rows)
        assert {r.phase_code for r in rows} == {"TRANSIT", "SURFACE"}
        assert all(r.dedup_key and r.dedup_key.startswith("seed24:") for r in rows)
        assert db.query(HealthBaseline).filter(HealthBaseline.astronaut_id.in_(ids)).count() == 3 * len(INDICATORS)
        assert db.query(Alert).filter(Alert.astronaut_id.in_(ids)).count() > 0
        env = db.query(EnvironmentalMeasurement).filter(
            EnvironmentalMeasurement.mission_id == first_run["mission"]["id"]).all()
        assert env and all(e.is_simulated for e in env)
    finally:
        db.close()


def test_second_run_does_not_duplicate(client, session_factory, first_run):
    db = session_factory()
    try:
        ids = _synthetic_ids(db)
        before = (
            db.query(HealthMeasurement).filter(HealthMeasurement.astronaut_id.in_(ids)).count(),
            db.query(MissionContext).filter(MissionContext.astronaut_id.in_(ids)).count(),
            db.query(EnvironmentalMeasurement).filter(
                EnvironmentalMeasurement.mission_id == first_run["mission"]["id"]).count(),
            db.query(User).count(),
        )
    finally:
        db.close()

    second = seeder.run(_config(verify=False), client, session_factory=session_factory)
    assert second["failed"] == {}, second["errors"]
    for kind in ("users", "missions", "assignments", "baselines", "health_measurements", "contexts",
                 "environment_measurements", "wellness_assessments", "quick_checkins"):
        assert second["created"].get(kind, 0) == 0, (kind, second["created"])

    db = session_factory()
    try:
        after = (
            db.query(HealthMeasurement).filter(HealthMeasurement.astronaut_id.in_(ids)).count(),
            db.query(MissionContext).filter(MissionContext.astronaut_id.in_(ids)).count(),
            db.query(EnvironmentalMeasurement).filter(
                EnvironmentalMeasurement.mission_id == first_run["mission"]["id"]).count(),
            db.query(User).count(),
        )
    finally:
        db.close()
    assert after == before


def test_destructive_reset_requires_explicit_confirmation(client, first_run):
    with pytest.raises(seeder.SeedError, match="confirm-reset"):
        seeder.run(_config(reset=True, verify=False), client)


def test_refuses_non_local_host_without_flag():
    with httpx.Client(base_url="https://semsa.example.org") as remote:
        with pytest.raises(seeder.SeedError, match="allow-remote"):
            seeder.run(_config(), remote)
