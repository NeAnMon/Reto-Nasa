from datetime import datetime, timezone
from typing import Dict, List, Optional
from sqlalchemy.orm import Session

from backend.app.models.models import (
    Badge,
    DailyMission,
    GamificationEvent,
    GamificationProfile,
    UserBadge,
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


LEVEL_THRESHOLDS = [
    (0, "Cadet"),
    (120, "Explorer"),
    (280, "Specialist"),
    (500, "Mission Expert"),
    (800, "Wellbeing Champion"),
]

POSITIVE_MESSAGES = [
    "Rutina completada: tu constancia fortalece la seguridad de toda la misión.",
    "Buen trabajo: registraste tu evaluación de forma transparente y trazable.",
    "Tu seguimiento quedó registrado. Observar y comunicar a tiempo es parte del éxito espacial.",
    "Módulo de autocuidado registrado: priorizar tu descanso y bienestar protege a la tripulación.",
]


def compute_level(total_xp: int) -> Dict[str, object]:
    current_level = "Cadet"
    next_level = "Explorer"
    next_threshold = 120
    prev_threshold = 0

    for idx, (thresh, name) in enumerate(LEVEL_THRESHOLDS):
        if total_xp >= thresh:
            current_level = name
            prev_threshold = thresh
            if idx + 1 < len(LEVEL_THRESHOLDS):
                next_threshold = LEVEL_THRESHOLDS[idx + 1][0]
                next_level = LEVEL_THRESHOLDS[idx + 1][1]
            else:
                next_threshold = thresh
                next_level = name

    if next_threshold > prev_threshold:
        progress_pct = min(
            100,
            round(((total_xp - prev_threshold) / (next_threshold - prev_threshold)) * 100),
        )
    else:
        progress_pct = 100

    return {
        "current_level": current_level,
        "next_level": next_level,
        "total_xp": total_xp,
        "next_level_xp": next_threshold,
        "level_progress_percent": progress_pct,
    }


def ensure_gamification_profile(db: Session, user_id: int) -> GamificationProfile:
    profile = (
        db.query(GamificationProfile)
        .filter(GamificationProfile.user_id == user_id)
        .first()
    )
    if not profile:
        profile = GamificationProfile(
            user_id=user_id,
            total_xp=60,
            current_level="Cadet",
            active_streak_days=1,
            routines_completed_count=0,
            learning_modules_completed=0,
            followups_completed=0,
        )
        db.add(profile)
        db.flush()
    return profile


def evaluate_and_award_badges(
    db: Session, user_id: int, profile: GamificationProfile, mission_code: str
) -> List[Dict[str, str]]:
    existing_codes = {
        r[0]
        for r in db.query(UserBadge.badge_code)
        .filter(UserBadge.user_id == user_id)
        .all()
    }
    newly_awarded: List[Dict[str, str]] = []

    def try_award(badge_code: str, reason: str):
        if badge_code in existing_codes:
            return
        badge = db.query(Badge).filter(Badge.code == badge_code).first()
        if not badge:
            return
        ub = UserBadge(
            user_id=user_id,
            badge_code=badge_code,
            awarded_reason=reason,
            awarded_at=utcnow(),
        )
        db.add(ub)
        existing_codes.add(badge_code)
        newly_awarded.append(
            {
                "code": badge.code,
                "name": badge.name,
                "icon_name": badge.icon_name,
                "reason": reason,
            }
        )

    if mission_code in ("DAILY_HEALTH_CHECK", "PULSE_CHECK"):
        try_award("FIRST_HEALTH_CHECK", "Completaste un registro validado de evaluación de salud.")
    if profile.active_streak_days >= 3 or profile.routines_completed_count >= 3:
        try_award("CONSISTENCY_STREAK", "Mantuviste constancia en tus rutinas preventivas sin penalización.")
    if mission_code == "SLEEP_LOG":
        try_award("SLEEP_ROUTINE_COMPLETED", "Registraste tu rutina de descanso y sueño.")
    if mission_code == "LEARNING_MISSION" or profile.learning_modules_completed >= 1:
        try_award("LEARNING_EXPLORER", "Exploraste contenido educativo sobre fisiología espacial.")
    if profile.routines_completed_count >= 4 or mission_code in ("HYDRATION_ROUTINE", "MIND_CHECK", "MOVE_SAFELY"):
        try_award("SELF_CARE_COMMITMENT", "Demostraste compromiso con el autocuidado integral.")
    if mission_code == "FOLLOW_UP_MISSION" or profile.followups_completed >= 1:
        try_award("FOLLOW_UP_COMPLETED", "Completaste un seguimiento preventivo recomendado por el protocolo.")
    if profile.total_xp >= 150:
        try_award("MISSION_MILESTONE", "Alcanzaste un hito de participación y aprendizaje en la misión.")

    return newly_awarded


def record_gamification_mission(
    db: Session,
    user_id: int,
    daily_mission_code: str,
    status_mode: str = "COMPLETED",
    reflection_note: Optional[str] = None,
    is_simulated: bool = True,
) -> Dict[str, object]:
    """
    Backend-verified mission completion or operational excusal.
    Points are strictly determined by the server's DailyMission catalog, never client payload.
    """
    dm = (
        db.query(DailyMission)
        .filter(DailyMission.code == daily_mission_code, DailyMission.is_active.is_(True))
        .first()
    )
    if not dm:
        raise ValueError(f"Misión diaria '{daily_mission_code}' no encontrada o inactiva.")

    profile = ensure_gamification_profile(db, user_id)
    today_str = utcnow().strftime("%Y-%m-%d")

    existing_today = (
        db.query(GamificationEvent)
        .filter(
            GamificationEvent.user_id == user_id,
            GamificationEvent.daily_mission_code == daily_mission_code,
            GamificationEvent.event_date_str == today_str,
        )
        .first()
    )
    if existing_today:
        level_info = compute_level(profile.total_xp)
        return {
            "already_recorded_today": True,
            "event_id": existing_today.id,
            "status": existing_today.status,
            "xp_awarded": 0,
            "reinforcement_message": "Esta misión ya fue registrada hoy. Tu progreso está conservado de forma segura.",
            "level_info": level_info,
            "newly_awarded_badges": [],
        }

    if status_mode == "EXCUSED_OPERATIONAL_RESTRICTION":
        xp_awarded = 0
        message = (
            "Actividad omitida por restricción operativa o indisponibilidad de sensor. "
            "Tu racha y progreso se conservan sin ninguna penalización."
        )
    else:
        status_mode = "COMPLETED"
        xp_awarded = dm.xp_reward
        profile.total_xp += xp_awarded
        profile.routines_completed_count += 1
        if dm.category == "LEARNING":
            profile.learning_modules_completed += 1
        if dm.category == "FOLLOW_UP":
            profile.followups_completed += 1
        msg_idx = profile.routines_completed_count % len(POSITIVE_MESSAGES)
        message = POSITIVE_MESSAGES[msg_idx]

    level_info = compute_level(profile.total_xp)
    profile.current_level = str(level_info["current_level"])

    event = GamificationEvent(
        user_id=user_id,
        daily_mission_code=daily_mission_code,
        event_date_str=today_str,
        status=status_mode,
        xp_awarded=xp_awarded,
        reinforcement_message=message,
        reflection_note=reflection_note,
        is_simulated=is_simulated,
        completed_at=utcnow(),
    )
    db.add(event)

    new_badges: List[Dict[str, str]] = []
    if status_mode == "COMPLETED":
        new_badges = evaluate_and_award_badges(db, user_id, profile, daily_mission_code)

    db.commit()
    db.refresh(event)

    return {
        "already_recorded_today": False,
        "event_id": event.id,
        "daily_mission_code": daily_mission_code,
        "daily_mission_title": dm.title,
        "status": status_mode,
        "xp_awarded": xp_awarded,
        "reinforcement_message": message,
        "level_info": level_info,
        "newly_awarded_badges": new_badges,
    }

