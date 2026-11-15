
"""Tests for SEMSA physiological prediction service.

Run from the repository root:
    python -m pytest backend/tests/test_prediction_service.py -v
"""

from datetime import datetime, timedelta, timezone
from math import nan
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.database.session import Base
from backend.app.models.models import (
    HealthBaseline,
    HealthIndicatorDefinition,
    HealthMeasurement,
    MissionAssignment,
    Mission,
    Role,
    User,
)
from backend.app.services.prediction_service import (
    predict_indicator,
    _valid_measurement,
)


START = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)


# ==========================================================
# FIXTURES
# ==========================================================

@pytest.fixture
def db():
    """Create an isolated in-memory SQLite database."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    Base.metadata.create_all(engine)

    with Session(engine) as session:
        yield session

    engine.dispose()


@pytest.fixture
def setup(db):
    """Create the astronaut, mission, assignment and indicator."""

    role = Role(
        id=1,
        code="ASTRONAUT",
        name="Astronaut",
    )
    db.add(role)
    db.flush()

    user = User(
        id=1,
        role_id=1,
        crew_code="AST-001",
        email="astronaut@example.test",
        password_hash="test",
        full_name="Test Astronaut",
    )

    mission = Mission(
        id=1,
        code="TEST",
        name="Test Mission",
        description="Test mission",
        vehicle_or_habitat="Test habitat",
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
        step_by_step_instructions="Test",
        educational_summary="Test",
        spaceflight_risk_explanation="Test",
    )

    db.add_all([user, mission, indicator])
    db.flush()

    db.add(
        MissionAssignment(
            user_id=1,
            mission_id=1,
            assignment_role="ASTRONAUT",
            is_active=True,
        )
    )

    db.commit()
    return indicator


# ==========================================================
# HELPERS
# ==========================================================

def add_series(
    db,
    n=12,
    *,
    slope=2,
    offset=70,
    phase="ORBIT",
    env="LOW_EARTH_ORBIT",
    start=START,
):
    """Insert a synthetic linear physiological time series."""

    for i in range(n):
        db.add(
            HealthMeasurement(
                astronaut_id=1,
                mission_id=1,
                indicator_code="HEART_RATE",
                value=offset + slope * i,
                unit="bpm",
                measured_at=start + timedelta(days=i),
                phase_code=phase,
                environment_code=env,
                data_quality="SYNTHETIC_DEMO",
                calculated_state="NORMAL",
                is_simulated=True,
            )
        )

    db.commit()


def run_prediction(db, **kwargs):
    """Execute a seven-day physiological prediction."""
    return predict_indicator(
        db,
        astronaut_id=1,
        mission_id=1,
        indicator_code="HEART_RATE",
        horizon_days=7,
        **kwargs,
    )


# ==========================================================
# OLS AND MAE TESTS
# ==========================================================

def test_linear_series(db, setup):
    """A perfect linear series should produce a valid forecast."""

    add_series(db)

    result = run_prediction(db)

    assert result.status == "ok"
    assert result.beta1 == pytest.approx(2)
    assert result.forecast[0]["value"] == pytest.approx(94)
    assert result.mae_ols == pytest.approx(0)
    assert result.baseline_status == "missing"
    assert result.forecast[0]["z_score"] is None


def test_unreliable_series(db, setup):
    """OLS should be rejected when the naive model performs better."""

    values = [
        70, 71, 69, 70, 71, 69,
        70, 71, 69, 69, 69, 69,
    ]

    for i, value in enumerate(values):
        db.add(
            HealthMeasurement(
                astronaut_id=1,
                mission_id=1,
                indicator_code="HEART_RATE",
                value=value,
                unit="bpm",
                measured_at=START + timedelta(days=i),
                phase_code="ORBIT",
                environment_code="LEO",
                data_quality="VALIDATED",
                calculated_state="NORMAL",
            )
        )

    db.commit()

    result = run_prediction(db)

    assert result.status == "model_not_reliable"
    assert result.forecast == []


def test_insufficient_observation_days(db, setup):
    """Fewer than ten distinct days should be rejected."""

    add_series(db, n=9)

    result = run_prediction(db)

    assert result.status == "insufficient_data"


# ==========================================================
# PREPROCESSING TESTS
# ==========================================================

def test_daily_median(db, setup):
    """Multiple measurements on one day use the daily median."""

    add_series(db)

    db.add(
        HealthMeasurement(
            astronaut_id=1,
            mission_id=1,
            indicator_code="HEART_RATE",
            value=70,
            unit="bpm",
            measured_at=START + timedelta(hours=1),
            phase_code="ORBIT",
            environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED",
            calculated_state="NORMAL",
        )
    )

    db.commit()

    result = run_prediction(db)

    assert result.beta1 == pytest.approx(2)


def test_invalid_measurements_excluded(db, setup):
    """Invalid, out-of-range and training records are excluded."""

    add_series(db)

    invalid_rows = [
        (300, "VALIDATED", "NORMAL", "ORBIT"),
        (100, "INVALID", "NORMAL", "ORBIT"),
        (100, "VALIDATED", "INVALID", "ORBIT"),
        (100, "VALIDATED", "NORMAL", "TRAINING"),
        (
            100,
            "VALIDATED",
            "NORMAL",
            "PRE_MISSION_BASELINE",
        ),
    ]

    for i, (value, quality, state, phase) in enumerate(invalid_rows):
        db.add(
            HealthMeasurement(
                astronaut_id=1,
                mission_id=1,
                indicator_code="HEART_RATE",
                value=value,
                unit="bpm",
                measured_at=START + timedelta(days=12 + i),
                phase_code=phase,
                environment_code="LOW_EARTH_ORBIT",
                data_quality=quality,
                calculated_state=state,
            )
        )

    db.commit()

    result = run_prediction(db)

    assert result.n_days == 12


def test_nonfinite_measurement_rejected(setup):
    """NaN values must not enter the regression."""

    measurement = SimpleNamespace(
        phase_code="ORBIT",
        data_quality="VALIDATED",
        calculated_state="NORMAL",
        value=nan,
        measured_at=START,
        unit="bpm",
    )

    assert not _valid_measurement(measurement, setup)


# ==========================================================
# PHASE AND ENVIRONMENT TESTS
# ==========================================================

def test_latest_contiguous_segment(db, setup):
    """Only the latest compatible segment should be analyzed."""

    add_series(db, 12, start=START)

    add_series(
        db,
        3,
        phase="SURFACE",
        env="MOON",
        start=START + timedelta(days=12),
    )

    add_series(
        db,
        11,
        start=START + timedelta(days=15),
    )

    result = run_prediction(db)

    assert result.status == "ok"
    assert result.n_days == 11
    assert result.phase_code == "ORBIT"


def test_latest_segment_insufficient(db, setup):
    """A short latest segment must not merge with older segments."""

    add_series(db, 12)

    add_series(
        db,
        3,
        phase="SURFACE",
        env="MOON",
        start=START + timedelta(days=12),
    )

    result = run_prediction(db)

    assert result.status == "insufficient_data"


# ==========================================================
# FORECAST HORIZON TESTS
# ==========================================================

@pytest.mark.parametrize(
    "horizon",
    [0, 15, True, 1.5],
)
def test_invalid_horizon(db, setup, horizon):
    """Only integer horizons from one to fourteen are valid."""

    with pytest.raises(ValueError):
        predict_indicator(
            db,
            astronaut_id=1,
            mission_id=1,
            indicator_code="HEART_RATE",
            horizon_days=horizon,
        )


# ==========================================================
# BASELINE AND Z-SCORE TESTS
# ==========================================================

def test_missing_baseline(db, setup):
    """Forecasts must work without an individual baseline."""

    add_series(db)

    result = run_prediction(db)

    assert result.status == "ok"
    assert result.baseline_status == "missing"
    assert result.z_score is None


def test_invalid_baseline_std(db, setup):
    """Zero standard deviation disables Z-score calculation."""

    add_series(db)

    db.add(
        HealthBaseline(
            astronaut_id=1,
            indicator_code="HEART_RATE",
            baseline_value=70,
            std_dev=0,
        )
    )

    db.commit()

    result = run_prediction(db)

    assert result.status == "ok"
    assert result.baseline_status == "invalid_std_dev"
    assert result.z_score is None


def test_baseline_z_score(db, setup):
    """A numerical baseline enables exploratory Z-scores."""

    add_series(db)

    db.add(
        HealthBaseline(
            astronaut_id=1,
            indicator_code="HEART_RATE",
            baseline_value=70,
            std_dev=5,
            is_simulated=True,
        )
    )

    db.commit()

    result = run_prediction(db)

    assert result.status == "ok"
    assert result.z_score is not None
    assert result.baseline_status == "available_unverified"
    assert result.baseline_is_simulated is True


# ==========================================================
# ASSIGNMENT AND INDICATOR TESTS
# ==========================================================

def test_assignment_role(db, setup):
    """Only astronauts with active assignments are accepted."""

    assignment = db.query(MissionAssignment).first()

    assignment.assignment_role = "MISSION_LEADER"
    db.commit()

    result = run_prediction(db)

    assert result.status == "not_assigned"

    assignment.assignment_role = "ASTRONAUT"
    assignment.is_active = False
    db.commit()

    result = run_prediction(db)

    assert result.status == "not_assigned"


def test_unknown_indicator(db, setup):
    """Unknown indicator codes should return the correct status."""

    result = predict_indicator(
        db,
        astronaut_id=1,
        mission_id=1,
        indicator_code="UNKNOWN",
        horizon_days=7,
    )

    assert result.status == "unknown_indicator"


# ==========================================================
# SIMULATION TESTS
# ==========================================================

def test_simulated_filter(db, setup):
    """Simulated data must be excluded when disabled."""

    add_series(db)

    result = run_prediction(
        db,
        include_simulated=False,
    )

    assert result.status == "insufficient_data"


# ==========================================================
# FORECAST VALIDITY TESTS
# ==========================================================

def test_out_of_range_forecast(db, setup):
    """Forecasts outside physiological limits must be flagged."""

    add_series(
        db,
        n=12,
        slope=8,
        offset=100,
    )

    result = run_prediction(db)

    assert result.status == "ok"

    assert any(
        item["out_of_valid_range"]
        for item in result.forecast
    )


# ==========================================================
# HISTORICAL DATA TESTS
# ==========================================================

def test_historical_data(db, setup):
    """Historical mission data should remain analyzable."""

    add_series(db)

    result = run_prediction(db)

    assert result.status == "ok"

    result = run_prediction(
        db,
        now=START + timedelta(days=12),
    )

    assert result.status == "ok"

    result = run_prediction(
        db,
        now=START + timedelta(days=200),
    )

    assert result.status == "insufficient_data"
