
"""
SEMSA - Physiological Prediction Router.

Authenticated API for exploratory forecasting of physiological indicators using:
- Robust level (exponentially weighted median of daily medians)
- Trend test (OLS slope with lag-1 autocorrelation correction); the slope is only
  extrapolated when it is significant and validated inside the series
- Reliability gate: rolling-origin skill against the last-value forecast
- Calibrated 80 % / 95 % prediction intervals
- Projection against the current clinical rule ranges and preventive recommendation
- Individual physiological baselines (Z-score only with a measured dispersion)
- Mission phase and environment segmentation

The method was calibrated by backtesting on real NASA UTMB bed-rest vitals (a ground
analog of microgravity, not spaceflight data). It forecasts indicator trends; it does
not predict or diagnose any condition.

Predictions are exploratory and non-diagnostic.
"""

from dataclasses import asdict

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    status,
)
from sqlalchemy.orm import Session

from backend.app.database.session import get_db
from backend.app.models.models import User
from backend.app.schemas.schemas import PredictionResponse
from backend.app.security.auth import get_current_user
from backend.app.rules.prediction_alerts import open_prediction_alerts
from backend.app.services.prediction_service import predict_indicator


# ============================================================
# ROUTER CONFIGURATION
# ============================================================

router = APIRouter(
    prefix="/predictions",
    tags=["Physiological Predictions"],
)


# ============================================================
# PHYSIOLOGICAL PREDICTION ENDPOINT
# ============================================================

@router.get(
    "/indicators/{indicator_code}",
    response_model=PredictionResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate physiological prediction",
    description=(
        "Generate an exploratory physiological forecast "
        "for an authenticated astronaut assigned to a mission. "
        "The forecast uses a robust level of the daily medians "
        "(a trend is only extrapolated when statistically "
        "significant and validated within the series), calibrated "
        "80/95 % prediction intervals, the current clinical rule "
        "ranges and the individual baseline. It forecasts indicator "
        "trends; results are not clinical diagnoses."
    ),
    responses={
        401: {
            "description": "Authentication required."
        },
        403: {
            "description": (
                "User is not an astronaut or does not have "
                "an active assignment to the requested mission."
            )
        },
        404: {
            "description": "Physiological indicator not found."
        },
        422: {
            "description": "Invalid prediction parameters."
        },
        503: {
            "description": "Prediction processing capacity exceeded."
        },
    },
)
def get_indicator_prediction(
    indicator_code: str = Path(
        ...,
        min_length=1,
        max_length=100,
        description="Physiological indicator code.",
        examples=["HEART_RATE"],
    ),
    mission_id: int = Query(
        ...,
        gt=0,
        description="Mission identifier.",
    ),
    horizon_days: int = Query(
        default=7,
        ge=1,
        le=14,
        description="Prediction horizon between 1 and 14 days.",
    ),
    include_simulated: bool = Query(
        default=False,
        description=(
            "Include simulated measurements in the prediction. "
            "Disabled by default."
        ),
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PredictionResponse:
    """
    Generate a physiological prediction for the authenticated astronaut.

    Security:
        - Requires an authenticated user.
        - Restricts access to the ASTRONAUT role.
        - Derives astronaut_id from the authenticated user.
        - Validates active mission assignment through the service.
        - Does not accept arbitrary astronaut IDs.

    Statistical processing:
        - Measurement quality filtering.
        - Daily median aggregation.
        - Phase and environment segmentation.
        - Robust level (exponentially weighted median).
        - Trend significance test; trend extrapolated only when validated.
        - Rolling-origin validation against the last-value forecast.
        - Calibrated 80 % / 95 % prediction intervals.
        - Projection against the current clinical rule ranges.
        - Individual baseline comparison.
        - Z-score classification.
        - Forecast horizon of 1-14 days.

    Returns:
        PredictionResponse with forecast and statistical metadata.
    """

    # ========================================================
    # 1. AUTHORIZATION
    # ========================================================

    if (
        current_user.role is None
        or current_user.role.code != "ASTRONAUT"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Only authenticated astronauts can "
                "request physiological predictions."
            ),
        )

    astronaut_id = current_user.id

    # ========================================================
    # 2. PREDICTION EXECUTION
    # ========================================================

    try:
        prediction = predict_indicator(
            db=db,
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            indicator_code=indicator_code,
            horizon_days=horizon_days,
            include_simulated=include_simulated,
        )

    except ValueError as exc:
        # Do not expose raw internal exception messages.
        # The service may reject excessive data volume.

        if "Too many eligible measurements" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "The prediction could not be generated "
                    "because the measurement volume exceeds "
                    "the current processing limit."
                ),
            ) from exc

        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid prediction parameters or data.",
        ) from exc

    # ========================================================
    # 3. SERVICE STATUS VALIDATION
    # ========================================================

    if prediction.status == "not_assigned":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "The authenticated astronaut does not have "
                "an active assignment to this mission."
            ),
        )

    if prediction.status == "unknown_indicator":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Physiological indicator not found.",
        )

    # ========================================================
    # 4. RESPONSE SERIALIZATION
    # ========================================================

    # Valid prediction outcomes include:
    #
    # ok:
    #     A reliable forecast was generated.
    #
    # insufficient_data:
    #     There are not enough eligible measurement days.
    #
    # model_not_reliable:
    #     The method did not outperform the last-value forecast in the
    #     rolling-origin validation inside the series.
    #
    # These are expected statistical outcomes, not HTTP errors.

    # ========================================================
    # 5. EARLY WARNING ALERT (issue #30)
    # ========================================================

    # Read-only: this GET never creates, updates or resolves alerts (the
    # Logbook calls it with include_simulated=true just by opening). The
    # early-warning alert (RULE_PREDICTION_EARLY_WARNING) is only written by
    # POST /health/measurements (router._refresh_prediction_alert). Here we
    # only report the id of the one already open for this astronaut,
    # indicator and mission, if any. See backend/app/rules/prediction_alerts.py.

    open_alerts = [
        a for a in open_prediction_alerts(db, astronaut_id, prediction.indicator_code)
        if a.mission_id == mission_id
    ]
    response = PredictionResponse.model_validate(
        asdict(prediction)
    )
    response.early_warning_alert_id = (
        max(open_alerts, key=lambda a: a.id).id if open_alerts else None
    )
    return response
