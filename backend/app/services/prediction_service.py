
"""SEMSA exploratory physiological forecasting (not clinical decision support).

The caller must authorize access to astronaut/mission data. No FastAPI dependencies.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from math import isfinite
from statistics import median

from sqlalchemy.orm import Session

from backend.app.models.models import (
    HealthBaseline, HealthIndicatorDefinition, HealthMeasurement, MissionAssignment,
)

MIN_DAYS = 10
VALIDATION_DAYS = 3
MAX_HORIZON = 14
MAX_HISTORY_DAYS = 90
MAX_ROWS = 10000
VALID_QUALITIES = ("VALIDATED", "SYNTHETIC_DEMO")
EXCLUDED_PHASES = ("TRAINING", "PRE_MISSION_BASELINE")
DISCLAIMER = (
    "Preliminary statistical estimate only; not a clinical assessment, "
    "diagnosis, or basis for medical decisions."
)


@dataclass
class PredictionResult:
    status: str
    indicator_code: str
    unit: str | None = None
    phase_code: str | None = None
    environment_code: str | None = None
    n_days: int = 0
    beta0: float | None = None
    beta1: float | None = None
    mae_ols: float | None = None
    mae_naive: float | None = None
    forecast: list[dict] = field(default_factory=list)
    z_score: float | None = None  # last forecast day; also provided per forecast day
    z_band: str | None = None
    direction: str | None = None
    baseline_status: str = "missing"
    baseline_is_simulated: bool | None = None
    disclaimer: str = DISCLAIMER


def _utc(dt: datetime) -> datetime:
    """Treat naive database timestamps as UTC (SQLite compatibility)."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _fit_ols(xs: list[int], ys: list[float]) -> tuple[float, float]:
    if len(xs) < 2 or len(xs) != len(ys):
        raise ValueError("insufficient_data")
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        raise ValueError("insufficient_data")
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den
    intercept = my - slope * mx
    if not (isfinite(intercept) and isfinite(slope)):
        raise ValueError("invalid regression result")
    return intercept, slope


def _mae(actual: list[float], predicted: list[float]) -> float:
    return sum(abs(a - p) for a, p in zip(actual, predicted)) / len(actual)


def _z_band(z: float) -> str:
    az = abs(z)
    if az < 1:
        return "within_baseline"
    if az < 2:
        return "mild_deviation"
    if az < 3:
        return "moderate_deviation"
    return "strong_deviation"


def _baseline_status(baseline: HealthBaseline | None) -> str:
    if baseline is None:
        return "missing"
    if not isfinite(baseline.baseline_value):
        return "invalid_baseline"
    if baseline.std_dev is None or not isfinite(baseline.std_dev) or baseline.std_dev <= 0:
        return "invalid_std_dev"
    return "available_unverified"  # std_dev may be the model's arbitrary default (5.0)


def _valid_measurement(m: HealthMeasurement, indicator: HealthIndicatorDefinition) -> bool:
    return (
        m.phase_code not in EXCLUDED_PHASES
        and m.data_quality in VALID_QUALITIES
        and m.calculated_state != "INVALID"
        and m.value is not None
        and isfinite(m.value)
        and indicator.min_valid_value <= m.value <= indicator.max_valid_value
        and m.measured_at is not None
        and m.unit == indicator.unit
    )


def _latest_segment(measurements: list[HealthMeasurement]) -> list[HealthMeasurement]:
    """Find the last uninterrupted run of the same phase/environment.

    Invalid measurements were already excluded. Gaps in calendar days are allowed
    (OLS uses elapsed days); a change of context breaks the segment.
    """
    if not measurements:
        return []
    key = (measurements[-1].phase_code, measurements[-1].environment_code)
    start = len(measurements) - 1
    while start >= 0 and (measurements[start].phase_code, measurements[start].environment_code) == key:
        start -= 1
    return measurements[start + 1:]


def _daily_series(measurements: list[HealthMeasurement]) -> tuple[list[date], list[float]]:
    buckets: dict[date, list[float]] = defaultdict(list)
    for m in measurements:
        buckets[_utc(m.measured_at).date()].append(float(m.value))
    days = sorted(buckets)
    return days, [float(median(buckets[d])) for d in days]


def predict_indicator(
    db: Session,
    astronaut_id: int,
    mission_id: int,
    indicator_code: str,
    horizon_days: int,
    include_simulated: bool = True,
    now: datetime | None = None,
) -> PredictionResult:
    """Predict the next 1–14 UTC days for the latest compatible observation segment.

    `include_simulated=True` accepts both real and simulated observations. For
    production use, pass False to restrict to real observations. Mixed real and
    simulated series are NOT separated by this contract; callers must ensure
    their provenance is suitable for the intended analysis.

    If `now` is None, the history window is anchored to the newest measurement
    (supports historical seed data). With `now`, only data at/before that UTC
    instant are considered, and the window is anchored to that instant.
    """
    if type(horizon_days) is not int or not 1 <= horizon_days <= MAX_HORIZON:
        raise ValueError("horizon_days must be an integer between 1 and 14")
    if now is not None and not isinstance(now, datetime):
        raise ValueError("now must be a datetime or None")

    result = PredictionResult(status="insufficient_data", indicator_code=indicator_code)
    assigned = db.query(MissionAssignment.id).filter(
        MissionAssignment.user_id == astronaut_id,
        MissionAssignment.mission_id == mission_id,
        MissionAssignment.is_active.is_(True),
        MissionAssignment.assignment_role == "ASTRONAUT",
    ).first()
    if assigned is None:
        result.status = "not_assigned"
        return result

    indicator = db.query(HealthIndicatorDefinition).filter(
        HealthIndicatorDefinition.code == indicator_code
    ).first()
    if indicator is None:
        result.status = "unknown_indicator"
        return result
    result.unit = indicator.unit

    baseline = db.query(HealthBaseline).filter(
        HealthBaseline.astronaut_id == astronaut_id,
        HealthBaseline.indicator_code == indicator_code,
    ).first()
    result.baseline_status = _baseline_status(baseline)
    result.baseline_is_simulated = baseline.is_simulated if baseline is not None else None

    query = db.query(HealthMeasurement).filter(
        HealthMeasurement.astronaut_id == astronaut_id,
        HealthMeasurement.mission_id == mission_id,
        HealthMeasurement.indicator_code == indicator_code,
        HealthMeasurement.data_quality.in_(VALID_QUALITIES),
        HealthMeasurement.calculated_state != "INVALID",
        HealthMeasurement.phase_code.notin_(EXCLUDED_PHASES),
    )
    if not include_simulated:
        query = query.filter(MissionAssignment.is_simulated.is_(False),
                             HealthMeasurement.data_quality == "VALIDATED")
    if now is not None:
        query = query.filter(HealthMeasurement.measured_at <= _utc(now))
    rows = query.order_by(HealthMeasurement.measured_at.desc(), HealthMeasurement.id.desc()).limit(MAX_ROWS + 1).all()
    if len(rows) > MAX_ROWS:
        raise ValueError("Too many measurements; narrow the analysis window")
    if not rows:
        return result

    anchor = _utc(now) if now is not None else _utc(rows[0].measured_at)
    cutoff = anchor - timedelta(days=MAX_HISTORY_DAYS)
    valid = [m for m in reversed(rows) if _utc(m.measured_at) >= cutoff and _valid_measurement(m, indicator)]
    segment = _latest_segment(valid)
    if not segment:
        return result
    result.phase_code = segment[-1].phase_code
    result.environment_code = segment[-1].environment_code
    dates, values = _daily_series(segment)
    result.n_days = len(dates)
    if len(dates) < MIN_DAYS:
        return result

    xs = [(d - dates[0]).days for d in dates]
    split = len(xs) - VALIDATION_DAYS
    try:
        b0_train, b1_train = _fit_ols(xs[:split], values[:split])
    except ValueError:
        return result
    result.mae_ols = _mae(values[split:], [b0_train + b1_train * x for x in xs[split:]])
    result.mae_naive = _mae(values[split:], [values[split - 1]] * VALIDATION_DAYS)
    if not (isfinite(result.mae_ols) and isfinite(result.mae_naive)):
        return result
    if result.mae_ols >= result.mae_naive:
        result.status = "model_not_reliable"
        return result

    try:
        result.beta0, result.beta1 = _fit_ols(xs, values)
    except ValueError:
        return result
    for h in range(1, horizon_days + 1):
        t = xs[-1] + h
        value = result.beta0 + result.beta1 * t
        if not isfinite(value):
            result.status = "model_not_reliable"
            result.forecast.clear()
            return result
        z = None
        band = None
        direction = None
        if result.baseline_status == "available_unverified":
            z = (value - baseline.baseline_value) / baseline.std_dev
            if isfinite(z):
                band = _z_band(z)
                direction = "above" if z > 0 else "below" if z < 0 else "at_baseline"
            else:
                z = None
        result.forecast.append({
            "date": (dates[-1] + timedelta(days=h)).isoformat(),
            "t": t,
            "value": value,
            "out_of_valid_range": not (indicator.min_valid_value <= value <= indicator.max_valid_value),
            "z_score": z,
            "z_band": band,
            "direction": direction,
        })
    result.z_score = result.forecast[-1]["z_score"]
    result.z_band = result.forecast[-1]["z_band"]
    result.direction = result.forecast[-1]["direction"]
    result.status = "ok"
    return result
