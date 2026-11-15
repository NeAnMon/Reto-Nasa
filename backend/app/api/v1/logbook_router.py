"""
SEMSA · Bitácora · Series de solo lectura para las gráficas por motor (issue #30).

La Bitácora dibuja una gráfica por cada motor del backend con los datos que de verdad recibe
ese motor. Casi todas salen de endpoints existentes; aquí solo están las dos series que no
expone ningún endpoint:

- GET /logbook/radiation-dose: dosis diaria registrada y dosis ACUMULADA frente al límite de
  carrera, calculada igual que el motor de reglas (rules/engine.py::_cumulative_dose: última
  lectura válida de cada día UTC, días sin registro no imputados) con los cortes de
  rules/calibration.py (50 % y 100 % de 600 mSv).
- GET /logbook/emotional-states: estado operativo que asignó el motor emocional
  (services/emotional_engine.py) a cada cuestionario completado. Solo el estado operativo y
  la fecha: nunca respuestas, dimensiones ni resúmenes (misma información que ya expone
  GET /analytics/expansion-overview, con la misma comprobación de acceso).

Permisos: los mismos que los endpoints de origen (verify_astronaut_access: el astronauta
solo ve lo suyo, el líder solo a su tripulación asignada, administración a todos). Además, el
astronauta tiene que estar asignado a la misión pedida y un líder solo consulta misiones que
supervisa (asignación activa). Privacidad: si el astronauta no comparte sus señales de bienestar
con su líder (`share_wellness_signals_with_leader = false`), el líder recibe la serie emocional
vacía (`shared_with_viewer = false`), igual que en GET /alerts y en los check-ins.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database.session import get_db
from backend.app.models.models import (
    EmotionalAssessment,
    EmotionalAssessmentResult,
    HealthIndicatorDefinition,
    HealthMeasurement,
    Mission,
    MissionAssignment,
    User,
)
from backend.app.rules.calibration import (
    RADIATION_CAREER_LIMIT_MSV,
    RADIATION_CUMULATIVE_RED_PCT,
    RADIATION_CUMULATIVE_YELLOW_PCT,
)
from backend.app.security.auth import (
    ensure_aware,
    get_authorized_astronaut_ids,
    get_current_user,
    verify_astronaut_access,
)

logbook_router = APIRouter(prefix="/logbook", tags=["Logbook"])

RADIATION_CODE = "RADIATION_EXPOSURE"

# Estados finales del motor emocional (los de borrador / sin respuestas no se grafican)
EMOTIONAL_FINAL_STATES = (
    "EMOTIONAL_WELLNESS_STABLE",
    "EMOTIONAL_WELLNESS_MONITORING",
    "SUPPORT_REQUESTED",
    "PROFESSIONAL_REVIEW",
    "URGENT_SUPPORT",
)


def _resolve_target(db: Session, actor: User, astronaut_id: Optional[int], mission_id: Optional[int]):
    """Mismo criterio que /analytics/timeseries (router._resolve_target_astronaut_and_mission)."""
    if astronaut_id is None:
        if actor.role and actor.role.code == "ASTRONAUT":
            astronaut_id = actor.id
        else:
            ids = get_authorized_astronaut_ids(db, actor)
            if not ids:
                raise HTTPException(status_code=404, detail="No hay astronautas asignados.")
            astronaut_id = ids[0]
    target = verify_astronaut_access(db, actor, astronaut_id, action_name="READ_LOGBOOK_ENGINE_SERIES")
    if mission_id is not None:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
    else:
        assign = (
            db.query(MissionAssignment)
            .filter(MissionAssignment.user_id == target.id, MissionAssignment.is_active.is_(True))
            .first()
        )
        mission = assign.mission if assign else None
    if not mission:
        raise HTTPException(status_code=404, detail="Misión no encontrada.")
    # El astronauta tiene que estar (o haber estado) asignado a esa misión...
    target_assigned = (
        db.query(MissionAssignment.id)
        .filter(MissionAssignment.user_id == target.id, MissionAssignment.mission_id == mission.id)
        .first()
    )
    if target_assigned is None:
        raise HTTPException(status_code=403, detail="El astronauta no está asignado a esa misión.")
    # ...y un líder solo ve las misiones que supervisa (asignación activa); administración, todas
    if actor.role and actor.role.code == "MISSION_LEADER":
        supervises = (
            db.query(MissionAssignment.id)
            .filter(
                MissionAssignment.user_id == actor.id,
                MissionAssignment.mission_id == mission.id,
                MissionAssignment.is_active.is_(True),
            )
            .first()
        )
        if supervises is None:
            raise HTTPException(status_code=403, detail="Solo puede consultar las misiones que supervisa.")
    return target, mission


def _utc_date(dt: datetime):
    return ensure_aware(dt).date()


def _radiation_state(pct: float) -> str:
    if pct >= RADIATION_CUMULATIVE_RED_PCT:
        return "CRITICAL"
    if pct >= RADIATION_CUMULATIVE_YELLOW_PCT:
        return "WARNING"
    return "NORMAL"


@logbook_router.get("/radiation-dose")
def get_radiation_dose(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    target, mission = _resolve_target(db, user, astronaut_id, mission_id)
    defn = db.query(HealthIndicatorDefinition).filter(HealthIndicatorDefinition.code == RADIATION_CODE).first()

    # Igual que el motor: lecturas válidas del tripulante (todas sus misiones), en orden
    rows = (
        db.query(HealthMeasurement)
        .filter(
            HealthMeasurement.astronaut_id == target.id,
            HealthMeasurement.indicator_code == RADIATION_CODE,
            HealthMeasurement.calculated_state != "INVALID",
        )
        .order_by(HealthMeasurement.measured_at.asc(), HealthMeasurement.id.asc())
        .all()
    )
    # Última lectura de cada día UTC (la posterior sustituye a la anterior, como en _cumulative_dose)
    by_day: Dict[Any, HealthMeasurement] = {}
    for r in rows:
        by_day[_utc_date(r.measured_at)] = r

    points: List[Dict[str, Any]] = []
    prior = 0.0  # dosis acumulada de días anteriores a la misión
    cumulative = 0.0
    for day in sorted(by_day):
        r = by_day[day]
        cumulative += float(r.value)
        if r.mission_id != mission.id:
            if not points:
                prior = cumulative
            continue
        pct = cumulative / RADIATION_CAREER_LIMIT_MSV * 100.0
        points.append(
            {
                "date": day.isoformat(),
                "measured_at": ensure_aware(r.measured_at).isoformat(),
                "daily_dose": r.value,
                "cumulative_dose": round(cumulative, 4),
                "percent_of_career_limit": round(pct, 3),
                "cumulative_state": _radiation_state(pct),
                "reading_state": r.calculated_state,
                "is_simulated": bool(r.is_simulated),
            }
        )

    return {
        "astronaut_id": target.id,
        "mission_id": mission.id,
        "mission_code": mission.code,
        "indicator_code": RADIATION_CODE,
        "unit": defn.unit if defn else "mSv",
        "career_limit_msv": RADIATION_CAREER_LIMIT_MSV,
        "yellow_percent": RADIATION_CUMULATIVE_YELLOW_PCT,
        "red_percent": RADIATION_CUMULATIVE_RED_PCT,
        "prior_cumulative_dose": round(prior, 4),
        "points": points,
        "method_note": (
            "Dosis acumulada = suma de la última lectura válida de cada día UTC (los días sin registro no se "
            "imputan: es un mínimo de la dosis real). Mismo cálculo que el motor de reglas."
        ),
    }


@logbook_router.get("/emotional-states")
def get_emotional_states(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    target, mission = _resolve_target(db, user, astronaut_id, mission_id)
    # Mismo criterio de privacidad que el resto del backend (GET /alerts, check-ins): si el astronauta
    # desactivó compartir sus señales de bienestar con su líder, el líder no recibe la serie.
    shared = not (user.role and user.role.code == "MISSION_LEADER" and not target.share_wellness_signals_with_leader)
    if not shared:
        return {
            "astronaut_id": target.id,
            "mission_id": mission.id,
            "states": list(EMOTIONAL_FINAL_STATES),
            "points": [],
            "shared_with_viewer": False,
            "privacy_notice": (
                "El astronauta no comparte sus señales de bienestar con el líder de misión: la serie no se muestra."
            ),
        }
    rows = (
        db.query(EmotionalAssessment, EmotionalAssessmentResult)
        .join(EmotionalAssessmentResult, EmotionalAssessmentResult.assessment_id == EmotionalAssessment.id)
        .filter(
            EmotionalAssessment.astronaut_id == target.id,
            EmotionalAssessment.mission_id == mission.id,
            EmotionalAssessment.is_draft.is_(False),
            EmotionalAssessment.completed_at.isnot(None),
            EmotionalAssessmentResult.operational_state.in_(EMOTIONAL_FINAL_STATES),
        )
        .order_by(EmotionalAssessment.completed_at.asc(), EmotionalAssessment.id.asc())
        .all()
    )
    return {
        "astronaut_id": target.id,
        "mission_id": mission.id,
        "states": list(EMOTIONAL_FINAL_STATES),
        "points": [
            {
                "completed_at": ensure_aware(ea.completed_at).isoformat(),
                "operational_state": res.operational_state,
                "phase_code": ea.phase_code,
                "is_simulated": bool(ea.is_simulated),
            }
            for ea, res in rows
        ],
        "shared_with_viewer": True,
        "privacy_notice": (
            "Solo el estado operativo de seguimiento que asigna el motor; las respuestas y dimensiones "
            "individuales permanecen privadas."
        ),
    }
