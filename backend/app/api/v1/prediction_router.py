
"""SEMSA physiological prediction API."""

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from backend.app.services.prediction_service import predict_indicator

# IMPORTANT:
# Replace these imports with the existing dependencies
# from the SEMSA repository.
from backend.app.database.session import get_db
from backend.app.security.dependencies import get_current_user


router = APIRouter(
    prefix="/predictions",
    tags=["Physiological Predictions"],
)


@router.get(
    "/indicators/{indicator_code}",
    summary="Predict physiological indicator",
    description=(
        "Generate an exploratory physiological forecast using "
        "OLS regression, MAE validation and individual baseline "
        "comparison. Results are not clinical assessments."
    ),
)
def get_indicator_prediction(
    indicator_code: str = Path(
        ...,
        min_length=1,
        max_length=100,
    ),
    mission_id: int = Query(..., gt=0),
    horizon_days: int = Query(7, ge=1, le=14),
    include_simulated: bool = Query(False),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Generate a forecast for the authenticated astronaut.

    The astronaut identifier is derived from authentication,
    never from user-controlled query parameters.
    """

    astronaut_id = current_user.id

    try:
        result = predict_indicator(
            db=db,
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            indicator_code=indicator_code,
            horizon_days=horizon_days,
            include_simulated=include_simulated,
        )

    except ValueError as exc:
        # Avoid exposing internal database or statistical details.
        raise HTTPException(
            status_code=422,
            detail="Prediction cannot be processed with the supplied parameters or data volume.",
        ) from exc

    if result.status == "not_assigned":
        raise HTTPException(
            status_code=403,
            detail="You are not authorized to access predictions for this mission.",
        )

    if result.status == "unknown_indicator":
        raise HTTPException(
            status_code=404,
            detail="Physiological indicator not found.",
        )

    return asdict(result)
