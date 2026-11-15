
"""
SEMSA - Physiological Prediction Service
========================================

Generates exploratory physiological forecasts using:

- SQLAlchemy for database access.
- Daily median aggregation.
- Ordinary Least Squares (OLS) regression.
- Mean Absolute Error (MAE) validation.
- Individual baseline Z-scores.

No FastAPI router or Pydantic schemas are required.

IMPORTANT:
This service does not provide clinical diagnoses.
The calling API must authorize access to astronaut data.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import isfinite
from statistics import median

from sqlalchemy.orm import Session

# Adjust this import to the repository's package structure.
from backend.app.models.models import (
    HealthBaseline,
    HealthIndicatorDefinition,
    HealthMeasurement,
    MissionAssignment,
)


# ==========================================================
# CONFIGURATION
# ==========================================================

MIN_OBSERVATION_DAYS = 10
VALIDATION_DAYS = 3
MAX_FORECAST_DAYS = 14
MAX_HISTORY_DAYS = 90
MAX_MEASUREMENTS = 10000

EXCLUDED_PHASES = {
    "TRAINING",
    "PRE_MISSION_BASELINE",
}


# ==========================================================
# EXCEPTIONS
# ==========================================================

class PredictionError(Exception):
    """
    Controlled error raised by the prediction service.

    Attributes:
        code: Machine-readable error identifier.
        message: Human-readable explanation.
    """

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


# ==========================================================
# STATISTICAL FUNCTIONS
# ==========================================================

def fit_ols(
    xs: list[float],
    ys: list[float],
) -> tuple[float, float]:
    """
    Fit an Ordinary Least Squares linear regression.

    Model:
        predicted_y = intercept + slope * x

    Args:
        xs: Elapsed days.
        ys: Physiological observations.

    Returns:
        (intercept, slope)

    Raises:
        PredictionError: Invalid or insufficient observations.
    """

    if len(xs) != len(ys) or len(xs) < 2:
        raise PredictionError(
            "insufficient_data",
            "At least two aligned observations are required.",
        )

    if not all(isfinite(v) for v in (*xs, *ys)):
        raise PredictionError(
            "invalid_data",
            "Regression observations must be finite.",
        )

    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)

    denominator = sum(
        (x - mean_x) ** 2
        for x in xs
    )

    if denominator <= 0:
        raise PredictionError(
            "invalid_data",
            "Observation timestamps must vary.",
        )

    numerator = sum(
        (x - mean_x) * (y - mean_y)
        for x, y in zip(xs, ys)
    )

    slope = numerator / denominator
    intercept = mean_y - slope * mean_x

    return intercept, slope


def mean_absolute_error(
    actual: list[float],
    predicted: list[float],
) -> float:
    """
    Calculate Mean Absolute Error.

    MAE = sum(abs(actual - predicted)) / n

    Lower values indicate smaller average prediction errors.
    """

    if not actual or len(actual) != len(predicted):
        raise PredictionError(
            "invalid_data",
            "MAE requires aligned nonempty observations.",
        )

    if not all(isfinite(v) for v in (*actual, *predicted)):
        raise PredictionError(
            "invalid_data",
            "MAE observations must be finite.",
        )

    return sum(
        abs(a - p)
        for a, p in zip(actual, predicted)
    ) / len(actual)


def calculate_z_score(
    value: float,
    baseline_mean: float,
    baseline_std: float | None,
) -> float | None:
    """
    Calculate statistical deviation from a personal baseline.

    Z = (value - baseline_mean) / baseline_std

    Returns None when inputs are invalid.

    A valid numerical standard deviation is not proof that
    the baseline has been scientifically established.
    """

    if (
        baseline_std is None
        or not isfinite(baseline_std)
        or baseline_std <= 0
        or not isfinite(value)
        or not isfinite(baseline_mean)
    ):
        return None

    return (value - baseline_mean) / baseline_std


# ==========================================================
# DATA PREPROCESSING
# ==========================================================

def to_utc_date(timestamp: datetime):
    """
    Convert a timestamp to a UTC calendar date.

    Naive timestamps are assumed to represent UTC.
    """

    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)

    return timestamp.astimezone(timezone.utc).date()


def build_daily_history(
    measurements,
    indicator,
) -> list[dict]:
    """
    Build a daily physiological time series.

    Processing:
        1. Exclude training and pre-mission records.
        2. Reject missing and non-finite values.
        3. Reject values outside indicator limits.
        4. Group by UTC day.
        5. Calculate the median per day.
        6. Return chronologically ordered observations.
    """

    buckets = defaultdict(list)

    for measurement in measurements:

        if measurement.phase_code in EXCLUDED_PHASES:
            continue

        value = measurement.value
        timestamp = measurement.measured_at

        if (
            value is None
            or timestamp is None
            or not isfinite(value)
        ):
            continue

        if not (
            indicator.min_valid_value
            <= value
            <= indicator.max_valid_value
        ):
            continue

        day = to_utc_date(timestamp)
        buckets[day].append(float(value))

    return [
        {
            "date": day.isoformat(),
            "value": float(median(values)),
        }
        for day, values in sorted(buckets.items())
    ]


# ==========================================================
# FORECASTING ENGINE
# ==========================================================

def forecast_from_history(
    history: list[dict],
    baseline_mean: float,
    baseline_std: float | None,
    days: int = 7,
    *,
    baseline_std_verified: bool = False,
) -> dict:
    """
    Train, validate, and forecast a physiological time series.

    Method:
        - Require at least 10 distinct observation days.
        - Reserve the last 3 observations for validation.
        - Train an OLS regression on earlier observations.
        - Compare regression MAE against a naive forecast.
        - If OLS wins, refit using all observations.
        - Generate daily predictions.
        - Calculate Z-scores only with a verified baseline.

    The validation is exploratory, not clinical.
    """

    # 1. Validate forecast horizon.

    if not isinstance(days, int) or isinstance(days, bool):
        raise PredictionError(
            "invalid_parameters",
            "Forecast horizon must be an integer.",
        )

    if not 1 <= days <= MAX_FORECAST_DAYS:
        raise PredictionError(
            "invalid_parameters",
            "Forecast horizon must be between 1 and 14 days.",
        )

    # 2. Validate observation count.

    if len(history) < MIN_OBSERVATION_DAYS:
        raise PredictionError(
            "insufficient_data",
            f"At least {MIN_OBSERVATION_DAYS} observation days are required.",
        )

    if baseline_mean is None or not isfinite(baseline_mean):
        raise PredictionError(
            "invalid_baseline",
            "Baseline mean must be finite.",
        )

    # 3. Prepare chronological observations.

    try:
        dates = [
            datetime.fromisoformat(item["date"]).date()
            for item in history
        ]

        values = [
            float(item["value"])
            for item in history
        ]

    except (KeyError, ValueError, TypeError) as exc:
        raise PredictionError(
            "invalid_history",
            "History contains invalid dates or values.",
        ) from exc

    if dates != sorted(set(dates)):
        raise PredictionError(
            "invalid_history",
            "Dates must be unique and chronologically ordered.",
        )

    if not all(isfinite(value) for value in values):
        raise PredictionError(
            "invalid_history",
            "History contains non-finite values.",
        )

    first_date = dates[0]

    xs = [
        float((date - first_date).days)
        for date in dates
    ]

    ys = values

    # 4. Chronological training/validation split.

    split = len(xs) - VALIDATION_DAYS

    x_train = xs[:split]
    y_train = ys[:split]

    x_validation = xs[split:]
    y_validation = ys[split:]

    # 5. Train OLS regression.

    intercept_train, slope_train = fit_ols(
        x_train,
        y_train,
    )

    validation_predictions = [
        intercept_train + slope_train * x
        for x in x_validation
    ]

    # 6. Evaluate OLS performance.

    mae = mean_absolute_error(
        y_validation,
        validation_predictions,
    )

    # 7. Compare with a naive forecasting model.

    last_training_value = y_train[-1]

    naive_predictions = [
        last_training_value
    ] * VALIDATION_DAYS

    naive_mae = mean_absolute_error(
        y_validation,
        naive_predictions,
    )

    evaluation = {
        "mae": mae,
        "naive_mae": naive_mae,
        "training_days": split,
        "validation_days": VALIDATION_DAYS,
        "outperformed_naive": mae < naive_mae,
    }

    # Reject forecasts that fail the preliminary comparison.

    if mae >= naive_mae:
        return {
            "status": "model_not_reliable",
            "message": (
                "OLS regression did not outperform "
                "the naive validation model."
            ),
            "historical": history,
            "forecast": [],
            "trend_per_day": None,
            "evaluation": evaluation,
            "warnings": [
                "The model failed preliminary validation."
            ],
        }

    # 8. Train final regression on all observations.

    intercept, slope = fit_ols(xs, ys)

    last_date = dates[-1]
    last_x = xs[-1]

    # 9. Check baseline standard deviation.

    valid_std = (
        baseline_std is not None
        and isfinite(baseline_std)
        and baseline_std > 0
    )

    use_z_score = valid_std and baseline_std_verified

    warnings = []

    if not use_z_score:
        warnings.append(
            "Z-scores are unavailable because baseline "
            "standard deviation is invalid or unverified."
        )

    # 10. Generate forecasts.

    forecast = []

    for step in range(1, days + 1):

        future_x = last_x + step
        predicted_value = intercept + slope * future_x

        if not isfinite(predicted_value):
            raise PredictionError(
                "invalid_prediction",
                "Regression produced a non-finite forecast.",
            )

        future_date = last_date + timedelta(days=step)

        z_score = (
            calculate_z_score(
                predicted_value,
                baseline_mean,
                baseline_std,
            )
            if use_z_score
            else None
        )

        forecast.append({
            "date": future_date.isoformat(),
            "value": predicted_value,
            "z_score": z_score,
        })

    # 11. Return structured results.

    return {
        "status": "success",
        "message": "Exploratory physiological forecast generated.",
        "historical": history,
        "forecast": forecast,
        "trend_per_day": slope,
        "evaluation": evaluation,
        "warnings": warnings,
    }


# ==========================================================
# DATABASE SERVICE
# ==========================================================

def predict_indicator(
    db: Session,
    *,
    astronaut_id: int,
    mission_id: int,
    indicator_code: str,
    days: int = 7,
    is_simulated: bool = True,
) -> dict:
    """
    Main entry point for SEMSA physiological forecasting.

    Args:
        db:
            Active SQLAlchemy session.

        astronaut_id:
            Target astronaut identifier.

        mission_id:
            Target mission identifier.

        indicator_code:
            Code from HealthIndicatorDefinition.

        days:
            Number of forecast days (1-14).

        is_simulated:
            Whether to use simulated measurements.

    Returns:
        Dictionary with:
            - status
            - astronaut_id
            - mission_id
            - indicator
            - baseline
            - historical
            - forecast
            - trend_per_day
            - evaluation
            - warnings

    Security:
        The caller must authorize the requesting user.
        Mission assignment alone does not grant access.

    Limitations:
        Baseline standard deviation provenance cannot be
        verified using the current database model.
        Therefore Z-scores are disabled by default.
    """

    # 1. Validate request parameters.

    if not isinstance(days, int) or isinstance(days, bool):
        raise PredictionError(
            "invalid_parameters",
            "Forecast horizon must be an integer.",
        )

    if not 1 <= days <= MAX_FORECAST_DAYS:
        raise PredictionError(
            "invalid_parameters",
            "Forecast horizon must be between 1 and 14 days.",
        )

    # 2. Verify active mission assignment.

    assignment = (
        db.query(MissionAssignment.id)
        .filter(
            MissionAssignment.user_id == astronaut_id,
            MissionAssignment.mission_id == mission_id,
            MissionAssignment.is_active.is_(True),
        )
        .first()
    )

    if assignment is None:
        raise PredictionError(
            "not_found",
            "Active mission assignment not found.",
        )

    # 3. Retrieve indicator definition.

    indicator = (
        db.query(HealthIndicatorDefinition)
        .filter(
            HealthIndicatorDefinition.code == indicator_code
        )
        .first()
    )

    if indicator is None:
        raise PredictionError(
            "not_found",
            "Physiological indicator not found.",
        )

    # 4. Retrieve individual baseline.

    baseline = (
        db.query(HealthBaseline)
        .filter(
            HealthBaseline.astronaut_id == astronaut_id,
            HealthBaseline.indicator_code == indicator_code,
            HealthBaseline.is_simulated.is_(is_simulated),
        )
        .first()
    )

    if baseline is None:
        raise PredictionError(
            "insufficient_baseline",
            "Individual physiological baseline not found.",
        )

    # 5. Define accepted measurement quality.

    accepted_quality = (
        ["VALIDATED", "SYNTHETIC_DEMO"]
        if is_simulated
        else ["VALIDATED"]
    )

    # 6. Retrieve recent measurements.

    cutoff = datetime.now(timezone.utc) - timedelta(
        days=MAX_HISTORY_DAYS
    )

    query = (
        db.query(HealthMeasurement)
        .filter(
            HealthMeasurement.astronaut_id == astronaut_id,
            HealthMeasurement.mission_id == mission_id,
            HealthMeasurement.indicator_code == indicator_code,
            HealthMeasurement.is_simulated.is_(is_simulated),
            HealthMeasurement.data_quality.in_(accepted_quality),
            HealthMeasurement.measured_at >= cutoff,
        )
    )

    # Select the most recent records before chronological
    # preprocessing. An extra record detects truncation.

    measurements = (
        query
        .order_by(
            HealthMeasurement.measured_at.desc()
        )
        .limit(MAX_MEASUREMENTS + 1)
        .all()
    )

    if len(measurements) > MAX_MEASUREMENTS:
        raise PredictionError(
            "data_limit_exceeded",
            "Too many measurements in the analysis window.",
        )

    # 7. Avoid combining incompatible environments/phases.

    if measurements:
        latest = measurements[0]

        measurements = [
            measurement
            for measurement in measurements
            if (
                measurement.phase_code == latest.phase_code
                and measurement.environment_code
                == latest.environment_code
            )
        ]

    # 8. Aggregate daily observations.

    history = build_daily_history(
        measurements,
        indicator,
    )

    # 9. Execute statistical analysis.

    # The current HealthBaseline model has no field
    # proving that std_dev was calculated from verified
    # pre-mission measurements.
    #
    # Do not automatically trust its default value (5.0).

    result = forecast_from_history(
        history=history,
        baseline_mean=baseline.baseline_value,
        baseline_std=baseline.std_dev,
        days=days,
        baseline_std_verified=False,
    )

    # 10. Attach metadata.

    std = baseline.std_dev

    valid_std = (
        std is not None
        and isfinite(std)
        and std > 0
    )

    return {
        **result,
        "astronaut_id": astronaut_id,
        "mission_id": mission_id,
        "indicator": {
            "code": indicator.code,
            "name": indicator.name,
            "unit": indicator.unit,
        },
        "baseline": {
            "mean": baseline.baseline_value,
            "std_dev": std if valid_std else None,
            "std_dev_verified": False,
            "is_simulated": baseline.is_simulated,
        },
        "available_days": len(history),
        "disclaimer": (
            "Statistical forecasts are exploratory "
            "and do not constitute clinical assessments."
        ),
    }
