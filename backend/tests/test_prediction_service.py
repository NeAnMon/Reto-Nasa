
"""Run from repository root: pytest backend/tests/test_prediction_service.py -q"""
from datetime import datetime, timedelta, timezone
from math import nan
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.database.session import Base
from backend.app.models.models import (
    HealthBaseline, HealthIndicatorDefinition, HealthMeasurement,
    MissionAssignment, Mission, Role, User,
)
from backend.app.services.prediction_service import predict_indicator

START = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def setup(db):
    # Populate only the columns required by the actual ORM schema.
    role = Role(id=1, code="ASTRONAUT", name="Astronaut")
    db.add(role)
    db.flush()
    user = User(id=1, role_id=1, crew_code="AST-001", email="astronaut@example.test", password_hash="test", full_name="Test Astronaut")
    mission = Mission(id=1, code="TEST", name="Test Mission", description="test", vehicle_or_habitat="test", current_phase="ORBIT")
    indicator = HealthIndicatorDefinition(
        code="HEART_RATE", name="Heart rate", category="CARDIOVASCULAR",
        body_region_code="CHEST", unit="bpm", min_valid_value=30, max_valid_value=200,
        step_by_step_instructions="test", educational_summary="test", spaceflight_risk_explanation="test",
    )
    db.add_all([user, mission, indicator])
    db.flush()
    db.add(MissionAssignment(user_id=1, mission_id=1, assignment_role="ASTRONAUT", is_active=True))
    db.commit()
    return indicator


def add_series(db, n=12, *, slope=2, offset=70, phase="ORBIT", env="LOW_EARTH_ORBIT", start=START):
    for i in range(n):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE", value=offset + slope * i,
            unit="bpm", measured_at=start + timedelta(days=i), phase_code=phase,
            environment_code=env, data_quality="SYNTHETIC_DEMO", calculated_state="NORMAL", is_simulated=True,
        ))
    db.commit()


def run(db, **kwargs):
    return predict_indicator(db, 1, 1, "HEART_RATE", 7, **kwargs)


def test_linear_series(db, setup):
    add_series(db)
    r = run(db)
    assert r.status == "ok"
    assert r.beta1 == pytest.approx(2)
    assert r.forecast[0]["value"] == pytest.approx(94)
    assert r.mae_ols == pytest.approx(0)
    assert r.baseline_status == "missing"
    assert r.forecast[0]["z_score"] is None


def test_unreliable_series(db, setup):
    # Alternating noisy data where the last-three holdout favors the naive model.
    values = [70, 71, 69, 70, 71, 69, 70, 71, 69, 69, 69, 69]
    for i, value in enumerate(values):
        db.add(HealthMeasurement(astronaut_id=1, mission_id=1, indicator_code="HEART_RATE", value=value,
            unit="bpm", measured_at=START + timedelta(days=i), phase_code="ORBIT",
            environment_code="LEO", data_quality="VALIDATED", calculated_state="NORMAL"))
    db.commit()
    r = run(db)
    assert r.status == "model_not_reliable"
    assert r.forecast == []


def test_fewer_than_ten_days(db, setup):
    add_series(db, n=9)
    assert run(db).status == "insufficient_data"


def test_daily_median(db, setup):
    add_series(db)
    # Day 1 has 70, 70, and 130: median=70 while mean=90.
    for minute, value in ((1, 70), (2, 130)):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE",
            value=value, unit="bpm",
            measured_at=START + timedelta(minutes=minute),
            phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED", calculated_state="NORMAL",
        ))
    db.commit()
    result = run(db)
    assert result.status == "ok"
    assert result.beta1 == pytest.approx(2)
    assert result.forecast[0]["value"] == pytest.approx(94)


def test_invalid_and_training_rows_excluded(db, setup):
    add_series(db)
    for i, (value, quality, state, phase) in enumerate([
        (300, "VALIDATED", "NORMAL", "ORBIT"),
        (100, "INVALID", "NORMAL", "ORBIT"),
        (100, "VALIDATED", "INVALID", "ORBIT"),
        (100, "VALIDATED", "NORMAL", "TRAINING"),
        (100, "VALIDATED", "NORMAL", "PRE_MISSION_BASELINE"),
    ]):
        db.add(HealthMeasurement(astronaut_id=1, mission_id=1, indicator_code="HEART_RATE", value=value,
            unit="bpm", measured_at=START + timedelta(days=12 + i), phase_code=phase,
            environment_code="LOW_EARTH_ORBIT", data_quality=quality, calculated_state=state))
    db.commit()
    assert run(db).n_days == 12


def test_latest_contiguous_segment(db, setup):
    add_series(db, 12, start=START)
    add_series(db, 3, phase="SURFACE", env="MOON", start=START + timedelta(days=12))
    add_series(db, 11, start=START + timedelta(days=15))
    r = run(db)
    assert r.status == "ok"
    assert r.n_days == 11
    assert r.phase_code == "ORBIT"


def test_segment_too_short(db, setup):
    add_series(db, 12)
    add_series(db, 3, phase="SURFACE", env="MOON", start=START + timedelta(days=12))
    assert run(db).status == "insufficient_data"


@pytest.mark.parametrize("h", [0, 15, True, 1.5])
def test_invalid_horizon(db, setup, h):
    with pytest.raises(ValueError):
        predict_indicator(db, 1, 1, "HEART_RATE", h)


def test_baseline_std_zero(db, setup):
    add_series(db)
    db.add(HealthBaseline(astronaut_id=1, indicator_code="HEART_RATE", baseline_value=70, std_dev=0))
    db.commit()
    r = run(db)
    assert r.status == "ok"
    assert r.baseline_status == "invalid_std_dev"
    assert r.z_score is None


def test_baseline_z_score(db, setup):
    add_series(db)
    db.add(HealthBaseline(astronaut_id=1, indicator_code="HEART_RATE", baseline_value=70, std_dev=5, is_simulated=True))
    db.commit()
    r = run(db)
    assert r.status == "ok"
    assert r.z_score is not None
    assert r.baseline_status == "available_unverified"
    assert r.baseline_is_simulated is True


def test_assignment_role_and_activity(db, setup):
    assignment = db.query(MissionAssignment).first()
    assignment.assignment_role = "MISSION_LEADER"
    db.commit()
    assert run(db).status == "not_assigned"
    assignment.assignment_role = "ASTRONAUT"
    assignment.is_active = False
    db.commit()
    assert run(db).status == "not_assigned"


def test_unknown_indicator(db, setup):
    assert predict_indicator(db, 1, 1, "UNKNOWN", 7).status == "unknown_indicator"


def test_simulated_filter(db, setup):
    add_series(db)
    assert run(db, include_simulated=False).status == "insufficient_data"




def test_real_series_accepted_when_simulated_excluded(db, setup):
    """A validated real series remains available with include_simulated=False."""
    for i in range(12):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE",
            value=70 + 2 * i, unit="bpm",
            measured_at=START + timedelta(days=i),
            phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED", calculated_state="NORMAL",
            is_simulated=False,
        ))
    db.commit()
    result = run(db, include_simulated=False)
    assert result.status == "ok"
    assert result.beta1 == pytest.approx(2)


def test_cutoff_applied_before_row_limit(db, setup, monkeypatch):
    """Old measurements do not consume the safety limit for the active window."""
    import backend.app.services.prediction_service as prediction_module
    monkeypatch.setattr(prediction_module, "MAX_ROWS", 15)
    for i in range(16):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE",
            value=70, unit="bpm",
            measured_at=START - timedelta(days=200) + timedelta(minutes=i),
            phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED", calculated_state="NORMAL",
            is_simulated=True,
        ))
    db.commit()
    add_series(db, n=12)
    result = run(db)
    assert result.status == "ok"
    assert result.n_days == 12



def test_recent_row_limit_is_explicit(db, setup, monkeypatch):
    """More than MAX_ROWS eligible recent records must fail explicitly."""
    import backend.app.services.prediction_service as prediction_module
    monkeypatch.setattr(prediction_module, "MAX_ROWS", 10)
    add_series(db, n=12)
    with pytest.raises(ValueError, match="Too many eligible measurements"):
        run(db)


def test_real_measurements_not_removed_when_include_simulated_true(db, setup):
    """The inclusive flag accepts a purely real validated time series."""
    for i in range(12):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE",
            value=70 + 2 * i, unit="bpm",
            measured_at=START + timedelta(days=i),
            phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED", calculated_state="NORMAL",
            is_simulated=False,
        ))
    db.commit()
    assert run(db, include_simulated=True).status == "ok"

def test_out_of_range_forecast_flag(db, setup):
    add_series(db, n=12, slope=8, offset=100)
    r = run(db)
    assert r.status == "ok"
    assert any(x["out_of_valid_range"] for x in r.forecast)


def test_historical_data_and_as_of(db, setup):
    add_series(db)
    assert run(db).status == "ok"
    assert run(db, now=START + timedelta(days=12)).status == "ok"
    assert run(db, now=START + timedelta(days=200)).status == "insufficient_data"


def test_nonfinite_value_rejected_by_preprocessor(setup):
    from backend.app.services.prediction_service import _valid_measurement
    m = SimpleNamespace(phase_code="ORBIT", data_quality="VALIDATED", calculated_state="NORMAL",
        value=nan, measured_at=START, unit="bpm")
    assert not _valid_measurement(m, setup)
