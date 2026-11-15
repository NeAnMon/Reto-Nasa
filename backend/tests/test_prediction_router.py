
"""
SEMSA - Physiological Prediction Router Tests.

Run from repository root:

    pytest backend/tests/test_prediction_router.py -v
"""

from datetime import datetime, timedelta, timezone

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.api.v1.prediction_router import (
    router as prediction_router,
)

from backend.app.database.session import Base, get_db

from backend.app.models.models import (
    HealthIndicatorDefinition,
    HealthMeasurement,
    Mission,
    MissionAssignment,
    Role,
    User,
)

from backend.app.security.auth import get_current_user


START = datetime(
    2025, 1, 1, 12,
    tzinfo=timezone.utc,
)


# ============================================================
# DATABASE FIXTURE
# ============================================================

@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    Base.metadata.create_all(engine)

    with Session(engine) as session:
        yield session

    engine.dispose()


# ============================================================
# TEST DATA
# ============================================================

@pytest.fixture
def setup_data(db):

    astronaut_role = Role(
        id=1,
        code="ASTRONAUT",
        name="Astronaut",
    )

    admin_role = Role(
        id=2,
        code="ADMINISTRATOR",
        name="Administrator",
    )

    db.add_all([astronaut_role, admin_role])
    db.flush()

    astronaut = User(
        id=1,
        role_id=1,
        crew_code="AST-001",
        email="astronaut@example.test",
        password_hash="test",
        full_name="Test Astronaut",
    )

    administrator = User(
        id=2,
        role_id=2,
        crew_code="ADM-001",
        email="admin@example.test",
        password_hash="test",
        full_name="Test Administrator",
    )

    mission = Mission(
        id=1,
        code="TEST",
        name="Test Mission",
        description="Prediction testing mission",
        vehicle_or_habitat="Test Habitat",
        current_phase="ORBIT",
    )

    indicator = HealthIndicatorDefinition(
        code="HEART_RATE",
        name="Heart rate",
        category="CARDIOVASCULAR",
        body_region_code="CHEST",
        unit="bpm",
        min_valid_value=30,
        max_valid_value=200,
        step_by_step_instructions="test",
        educational_summary="test",
        spaceflight_risk_explanation="test",
    )

    db.add_all([
        astronaut,
        administrator,
        mission,
        indicator,
    ])

    db.flush()

    assignment = MissionAssignment(
        user_id=astronaut.id,
        mission_id=mission.id,
        assignment_role="ASTRONAUT",
        is_active=True,
    )

    db.add(assignment)
    db.commit()

    return {
        "astronaut": astronaut,
        "administrator": administrator,
        "mission": mission,
        "indicator": indicator,
    }


# ============================================================
# APPLICATION FIXTURE
# ============================================================

@pytest.fixture
def app(db):

    application = FastAPI()

    application.include_router(
        prediction_router,
        prefix="/api/v1",
    )

    def override_db():
        yield db

    application.dependency_overrides[get_db] = override_db

    yield application

    application.dependency_overrides.clear()


# ============================================================
# CLIENT FIXTURE
# ============================================================

@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


# ============================================================
# AUTHENTICATION HELPER
# ============================================================

def authenticate(app, user):

    def override_current_user():
        return user

    app.dependency_overrides[
        get_current_user
    ] = override_current_user


# ============================================================
# MEASUREMENT GENERATOR
# ============================================================

def add_series(
    db,
    n=12,
    slope=2,
    offset=70,
    simulated=False,
):

    for i in range(n):

        measurement = HealthMeasurement(
            astronaut_id=1,
            mission_id=1,
            indicator_code="HEART_RATE",
            value=offset + slope * i,
            unit="bpm",
            measured_at=START + timedelta(days=i),
            phase_code="ORBIT",
            environment_code="LOW_EARTH_ORBIT",
            data_quality="SYNTHETIC_DEMO" if simulated else "VALIDATED",
            calculated_state="NORMAL",
            is_simulated=simulated,
        )

        db.add(measurement)

    db.commit()


# ============================================================
# ENDPOINT HELPER
# ============================================================

def request_prediction(
    client,
    indicator="HEART_RATE",
    mission_id=1,
    horizon_days=7,
    include_simulated=False,
):

    return client.get(
        f"/api/v1/predictions/indicators/{indicator}",
        params={
            "mission_id": mission_id,
            "horizon_days": horizon_days,
            "include_simulated": include_simulated,
        },
    )


# ============================================================
# 1. AUTHENTICATION
# ============================================================

def test_prediction_requires_authentication(client):

    response = request_prediction(client)

    assert response.status_code in (401, 403)


# ============================================================
# 2. ROLE AUTHORIZATION
# ============================================================

def test_administrator_cannot_predict(
    client,
    app,
    setup_data,
):

    authenticate(
        app,
        setup_data["administrator"],
    )

    response = request_prediction(client)

    assert response.status_code == 403


# ============================================================
# 3. MISSION AUTHORIZATION
# ============================================================

def test_astronaut_without_assignment(
    client,
    app,
    setup_data,
):

    authenticate(
        app,
        setup_data["astronaut"],
    )

    response = request_prediction(
        client,
        mission_id=999,
    )

    assert response.status_code == 403


# ============================================================
# 4. UNKNOWN INDICATOR
# ============================================================

def test_unknown_indicator(
    client,
    app,
    setup_data,
):

    authenticate(
        app,
        setup_data["astronaut"],
    )

    response = request_prediction(
        client,
        indicator="UNKNOWN",
    )

    assert response.status_code == 404


# ============================================================
# 5. INVALID FORECAST HORIZON
# ============================================================

@pytest.mark.parametrize(
    "horizon",
    [0, 15, -1],
)
def test_invalid_horizon(
    client,
    app,
    setup_data,
    horizon,
):

    authenticate(
        app,
        setup_data["astronaut"],
    )

    response = request_prediction(
        client,
        horizon_days=horizon,
    )

    assert response.status_code == 422


# ============================================================
# 6. INVALID MISSION ID
# ============================================================

def test_invalid_mission_id(
    client,
    app,
    setup_data,
):

    authenticate(
        app,
        setup_data["astronaut"],
    )

    response = request_prediction(
        client,
        mission_id=0,
    )

    assert response.status_code == 422


# ============================================================
# 7. INSUFFICIENT DATA
# ============================================================

def test_insufficient_data(
    client,
    app,
    db,
    setup_data,
):

    authenticate(
        app,
        setup_data["astronaut"],
    )

    add_series(
        db,
        n=9,
        simulated=False,
    )

    response = request_prediction(client)

    assert response.status_code == 200

    data = response.json()

    assert data["status"] == "insufficient_data"
    assert data["forecast"] == []


# ============================================================
# 8. VALID PHYSIOLOGICAL PREDICTION
# ============================================================

def test_valid_prediction(
    client,
    app,
    db,
    setup_data,
):

    authenticate(
        app,
        setup_data["astronaut"],
    )

    add_series(
        db,
        n=12,
        simulated=False,
    )

    response = request_prediction(client)

    assert response.status_code == 200

    data = response.json()

    assert data["status"] == "ok"
    assert data["indicator_code"] == "HEART_RATE"
    assert data["n_days"] == 12

    assert data["beta1"] == pytest.approx(2)

    assert len(data["forecast"]) == 7

    assert data["forecast"][0]["value"] == pytest.approx(94)


# ============================================================
# 9. SIMULATED MEASUREMENT FILTER
# ============================================================

def test_simulated_measurements_excluded(
    client,
    app,
    db,
    setup_data,
):

    authenticate(
        app,
        setup_data["astronaut"],
    )

    add_series(
        db,
        n=12,
        simulated=True,
    )

    response = request_prediction(
        client,
        include_simulated=False,
    )

    assert response.status_code == 200

    assert response.json()["status"] == "insufficient_data"


# ============================================================
# 10. SIMULATED MEASUREMENTS INCLUDED
# ============================================================

def test_simulated_measurements_included(
    client,
    app,
    db,
    setup_data,
):

    authenticate(
        app,
        setup_data["astronaut"],
    )

    add_series(
        db,
        n=12,
        simulated=True,
    )

    response = request_prediction(
        client,
        include_simulated=True,
    )

    assert response.status_code == 200

    assert response.json()["status"] == "ok"


# ============================================================
# 11. RESPONSE SCHEMA
# ============================================================

def test_prediction_response_schema(
    client,
    app,
    db,
    setup_data,
):

    authenticate(
        app,
        setup_data["astronaut"],
    )

    add_series(db)

    response = request_prediction(client)

    assert response.status_code == 200

    data = response.json()

    required_fields = [
        "status",
        "indicator_code",
        "unit",
        "phase_code",
        "environment_code",
        "n_days",
        "beta0",
        "beta1",
        "mae_ols",
        "mae_naive",
        "forecast",
        "z_score",
        "z_band",
        "direction",
        "baseline_status",
        "baseline_is_simulated",
        "disclaimer",
    ]

    for field in required_fields:
        assert field in data
