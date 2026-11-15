
"""
SEMSA - Physiological Prediction API Router.

Provides authenticated endpoints for exploratory physiological
forecasting using OLS regression, MAE validation and individual
baseline comparison.

Predictions are statistical estimates, not clinical diagnoses.
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
from backend.app.security.auth import get_current_user
from backend.app.services.prediction_service import predict_indicator


router = APIRouter(
    prefix="/predictions",
    tags=["Physiological Predictions"],
)


@router.get(
    "/indicators/{indicator_code}",
    status_code=status.HTTP_200_OK,
    summary="Generate physiological prediction",
    description=(
        "Generates an exploratory physiological forecast for "
        "an authenticated astronaut assigned to a mission. "
        "Uses OLS regression, MAE validation and individual "
        "baseline Z-score analysis. "
        "Results must not be interpreted as clinical diagnoses."
    ),
    responses={
        200: {
            "description": (
                "Prediction processed successfully. "
                "The response may indicate insufficient data "
                "or an unreliable statistical model."
            )
        },
        401: {
            "description": "Authentication required."
        },
        403: {
            "description": "Astronaut is not assigned to the mission."
        },
        404: {
            "description": "Unknown physiological indicator."
        },
        422: {
            "description": "Invalid prediction parameters."
        },
        503: {
            "description": "Prediction capacity limit exceeded."
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
        description="Forecast horizon between 1 and 14 days.",
    ),
    include_simulated: bool = Query(
        default=False,
        description=(
            "Include simulated physiological measurements. "
            "Disabled by default."
        ),
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Generate a physiological forecast for the authenticated astronaut.

    Security:
        - Authentication is mandatory.
        - Astronaut identity comes from the authenticated session.
        - The service verifies active mission assignment.
        - Other astronauts' data cannot be requested through parameters.

    Statistical processing:
        - Validated measurement filtering.
        - Daily median aggregation.
        - Latest contiguous phase/environment segment.
        - OLS linear regression.
        - MAE comparison against a naive model.
        - Individual baseline Z-score calculation.
        - Out-of-range forecast detection.

    Returns:
        Serialized PredictionResult.
    """

    # ----------------------------------------------------------
    # 1. AUTHORIZATION
    # ----------------------------------------------------------

    if (
        current_user.role is None
        or current_user.role.code != "ASTRONAUT"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Physiological predictions are available "
                "only to authenticated astronauts."
            ),
        )

    astronaut_id = current_user.id

    # ----------------------------------------------------------
    # 2. PREDICTION SERVICE
    # ----------------------------------------------------------

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
        # The service raises ValueError for invalid horizons and
        # when its measurement-volume safety limit is exceeded.
        # FastAPI already validates the HTTP horizon parameter.
        if "Too many eligible measurements" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Prediction cannot be generated because "
                    "the measurement volume exceeds the "
                    "current processing limit."
                ),
            ) from exc

        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid prediction parameters or data.",
        ) from exc

    # ----------------------------------------------------------
    # 3. RESULT STATUS HANDLING
    # ----------------------------------------------------------

    if prediction.status == "not_assigned":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "You do not have an active astronaut "
                "assignment for this mission."
            ),
        )

    if prediction.status == "unknown_indicator":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Physiological indicator not found.",
        )

    # ----------------------------------------------------------
    # 4. RESPONSE
    # ----------------------------------------------------------

    # These are valid service outcomes:
    # - ok
    # - insufficient_data
    # - model_not_reliable

    return asdict(prediction)
