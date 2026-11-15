import csv
import io
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.database.seed import reset_simulated_demo_data
from backend.app.database.session import get_db
from backend.app.models.models import (
    Alert,
    AlertAcknowledgement,
    AstronautProfile,
    AuditEvent,
    Badge,
    ClinicalRule,
    ClinicalRuleVersion,
    DailyMission,
    DataQualityEvent,
    DataSource,
    EnvironmentalMeasurement,
    EnvironmentProfile,
    FollowUpAction,
    GamificationEvent,
    GamificationProfile,
    HealthBaseline,
    HealthIndicatorDefinition,
    HealthMeasurement,
    Mission,
    MissionAssignment,
    MissionContext,
    MissionPhase,
    PsychologicalWellnessAssessment,
    Report,
    Role,
    SensorRegistry,
    User,
    UserBadge,
    UserSession,
    WellnessActionFeedback,
    WellnessInstrument,
    WellnessRecommendation,
)
from backend.app.rules.engine import (
    ContextResolver,
    evaluate_measurement,
    upsert_alert_for_measurement,
)
from backend.app.rules.early_warnings import EARLY_RULE_PREFIX, is_early_rule
from backend.app.schemas.schemas import (
    AlertAckRequest,
    AlertEscalateRequest,
    AlertFollowUpRequest,
    BulkImportRequest,
    ContextUpdateRequest,
    EnvironmentalMeasurementCreate,
    GamificationCompleteRequest,
    HealthMeasurementCreate,
    LoginRequest,
    MissionAssignmentRequest,
    MissionCreateRequest,
    PasswordRecoveryRequest,
    PasswordResetConfirm,
    ReportExportRequest,
    RuleVersionCreateRequest,
    SimulatorRunRequest,
    UserCreateRequest,
    UserRolePatch,
    UserStatusPatch,
    UserUpdateRequest,
    WellnessAssessmentCreate,
    WellnessFeedbackCreate,
)
from backend.app.security.auth import (
    ensure_aware,
    get_authorized_astronaut_ids,
    get_current_session,
    get_current_user,
    get_user_permissions,
    hash_password,
    log_audit_event,
    require_roles,
    utcnow,
    verify_astronaut_access,
    verify_password,
)
from backend.app.services.ai_assistant import AssistiveGuidanceService
from backend.app.services.gamification import (
    compute_level,
    ensure_gamification_profile,
    record_gamification_mission,
)
from backend.app.services.simulator import DEMO_SCENARIOS, execute_demo_scenario
from backend.app.api.v1.expansion_router import (
    build_expansion_cards_for_summary,
    expansion_router,
)

from backend.app.api.v1.prediction_router import router as prediction_router

router = APIRouter(prefix="/api/v1")


router.include_router(prediction_router)


BODY_REGIONS_CATALOG = [
    {
        "code": "HEAD_BRAIN",
        "svg_id": "region-head-brain",
        "name": "Cabeza, Cerebro y Ritmo Circadiano",
        "system_function": "Regulación neurocognitiva, control autonómico, equilibrio vestibular, vigilia y arquitectura del sueño.",
        "space_risks": "Desplazamiento cefálico de fluidos en microgravedad, alteración del ciclo circadiano por órbitas rápidas o iluminación artificial, cinetosis espacial y fatiga cognitiva por aislamiento.",
        "preventive_recommendations": "Mantener rutina de higiene circadiana pre-sueño, pausas cognitivas programadas y registro honesto de fatiga antes de actividades críticas.",
        "indicator_codes": ["SLEEP_DURATION", "PERCEIVED_FATIGUE"],
    },
    {
        "code": "EYES_VISION",
        "svg_id": "region-eyes-vision",
        "name": "Ojos y Sistema Neuro-Ocular",
        "system_function": "Agudeza visual, acomodación, presión intraocular y transmisión óptica al córtex visual.",
        "space_risks": "Síndrome Neuro-Ocular Asociado a Vuelos Espaciales (SANS) por congestión venosa cefálica, irritación por partículas de polvo lunar/marciano y fosfenos por radiación cósmica.",
        "preventive_recommendations": "Vigilar presión arterial y niveles de CO₂ ambiental en cabina, realizar pausas visuales de enfoque lejano y usar protección ocular post-EVA.",
        "indicator_codes": ["BLOOD_PRESSURE", "SLEEP_DURATION"],
    },
    {
        "code": "HEART_CARDIO",
        "svg_id": "region-heart-cardio",
        "name": "Corazón y Sistema Cardiovascular",
        "system_function": "Bombeo hemodinámico, perfusión tisular, regulación barorrefleja y transporte de oxígeno.",
        "space_risks": "Redistribución de ~2 litros de fluido hacia el tórax al entrar en microgravedad, disminución del volumen plasmático, remodelado cardíaco e intolerancia ortostática al regresar a gravedad.",
        "preventive_recommendations": "Completar sesiones aeróbicas autorizadas, mantener hidratación estructurada y registrar pulso y presión arterial en reposo.",
        "indicator_codes": ["HEART_RATE", "BLOOD_PRESSURE"],
    },
    {
        "code": "LUNGS_RESP",
        "svg_id": "region-lungs-resp",
        "name": "Pulmones y Sistema Respiratorio",
        "system_function": "Intercambio alveolar de oxígeno (O₂) y eliminación de dióxido de carbono (CO₂).",
        "space_risks": "Homogeneización de ventilación-perfusión en microgravedad, exposición a bolsas de CO₂ en compartimentos mal ventilados, descompresión en EVA e inhalación accidental de polvo regolítico.",
        "preventive_recommendations": "Verificar estado de ventilación ECLSS, supervisar SpO₂ y frecuencia respiratoria, y ejecutar protocolos de descontaminación de trajes.",
        "indicator_codes": ["SPO2", "RESP_RATE"],
    },
    {
        "code": "IMMUNE_SYSTEM",
        "svg_id": "region-immune-system",
        "name": "Sistema Inmunológico y Hematopoyético (Área Funcional Ilustrativa)",
        "system_function": "Defensa frente a patógenos, vigilancia celular, hematopoyesis y respuesta inflamatoria.",
        "space_risks": "Disregulación inmunitaria inducida por estrés, reactivación de virus latentes en confinamiento y daño hematopoyético/celular por radiación cósmica galáctica y eventos solares.",
        "preventive_recommendations": "Monitorear dosimetría personal de radiación, asegurar descanso reparador, nutrición equilibrada y manejo del estrés.",
        "indicator_codes": ["RADIATION_EXPOSURE", "BODY_TEMP"],
    },
    {
        "code": "DIGESTIVE_NUTRITION",
        "svg_id": "region-digestive-nutrition",
        "name": "Sistema Digestivo, Metabólico y Renal",
        "system_function": "Absorción de nutrientes, homeostasis glucémica, balance hidroelectrolítico y excreción renal.",
        "space_risks": "Enlentecimiento del tránsito gastrointestinal inicial, resistencia subclínica a la insulina y riesgo elevado de litiasis renal por hipercalciuria e hipohidratación.",
        "preventive_recommendations": "Cumplir la meta diaria de hidratación (Hydration Routine), fraccionar la ingesta de líquidos y registrar glucosa cuando el protocolo lo indique.",
        "indicator_codes": ["HYDRATION", "BLOOD_GLUCOSE"],
    },
    {
        "code": "BONES_SKELETAL",
        "svg_id": "region-bones-skeletal",
        "name": "Huesos y Sistema Esquelético",
        "system_function": "Soporte estructural biomecánico, protección visceral y reservorio mineral de calcio y fósforo.",
        "space_risks": "Desmineralización ósea acelerada (1–1.5% mensual en cadera y columna lumbar) por ausencia de carga gravitatoria mecánica.",
        "preventive_recommendations": "Realizar cargas resistivas autorizadas (ARED/Move Safely), mantener ingesta hídrica para proteger el riñón del calcio movilizado y evitar cargas bruscas al reingreso.",
        "indicator_codes": ["PHYSICAL_ACTIVITY", "HYDRATION"],
    },
    {
        "code": "MUSCLES",
        "svg_id": "region-muscles",
        "name": "Músculos y Sistema Locomotor",
        "system_function": "Generación de fuerza contráctil, control postural antigravitatorio y locomoción en superficie o EVA.",
        "space_risks": "Atrofia de fibras musculares posturales (sóleo, cuádriceps, paravertebrales) y fatiga muscular de tren superior durante operaciones en traje presurizado.",
        "preventive_recommendations": "Completar la rutina diaria de actividad física autorizada y alternar grupos musculares con periodos de recuperación.",
        "indicator_codes": ["PHYSICAL_ACTIVITY", "PERCEIVED_FATIGUE"],
    },
    {
        "code": "SKIN_THERMO",
        "svg_id": "region-skin-thermo",
        "name": "Piel y Termorregulación",
        "system_function": "Barrera epitelial protectora, sensibilidad táctil y disipación térmica por sudoración y vasodilatación.",
        "space_risks": "Menor disipación convectiva del calor en microgravedad, sequedad o abrasión cutánea por baja humedad y puntos de fricción dentro del traje EVA.",
        "preventive_recommendations": "Vigilar temperatura corporal antes y después del ejercicio o EVA, revisar humedad ambiental del hábitat e hidratar la piel.",
        "indicator_codes": ["BODY_TEMP", "HYDRATION"],
    },
    {
        "code": "GENERAL_WELLNESS",
        "svg_id": "region-general-wellness",
        "name": "Estado General y Bienestar Psicosocial",
        "system_function": "Integración mente-cuerpo, regulación emocional, motivación, cohesión de tripulación y resiliencia.",
        "space_risks": "Aislamiento y confinamiento, distancia visual y comunicativa de la Tierra, sobrecarga de trabajo y monotonía sensorial.",
        "preventive_recommendations": "Usar Bienestar (check-in privado, cuestionarios y respiración guiada), mantener enlaces familiares autorizados y solicitar apoyo sin estigma.",
        "indicator_codes": ["MOOD_WELLNESS", "PERCEIVED_FATIGUE", "SLEEP_DURATION"],
    },
]


def _serialize_user(db: Session, user: User) -> Dict[str, object]:
    role_code = user.role.code if user.role else "ASTRONAUT"
    perms = get_user_permissions(db, user)
    missions_assigned = []
    for ma in user.assignments:
        if ma.is_active and ma.mission:
            missions_assigned.append(
                {
                    "mission_id": ma.mission.id,
                    "mission_code": ma.mission.code,
                    "mission_name": ma.mission.name,
                    "assignment_role": ma.assignment_role,
                    "current_phase": ma.mission.current_phase,
                }
            )
    astro_prof = None
    if user.astronaut_profile:
        ap = user.astronaut_profile
        astro_prof = {
            "callsign": ap.callsign,
            "specialty": ap.specialty,
            "agency_label": ap.agency_label,
            "eva_certified": ap.eva_certified,
            "authorized_restrictions": json.loads(ap.authorized_restrictions_json or "[]"),
            "quiet_hours_window": ap.quiet_hours_window,
            "notes": ap.notes,
        }
    return {
        "id": user.id,
        "crew_code": user.crew_code,
        "email": user.email,
        "full_name": user.full_name,
        "role_code": role_code,
        "role_name": user.role.name if user.role else role_code,
        "status": user.status,
        "preferred_theme": user.preferred_theme,
        "share_wellness_signals_with_leader": user.share_wellness_signals_with_leader,
        "share_detailed_wellness_with_medical": user.share_detailed_wellness_with_medical,
        "permissions": perms,
        "missions": missions_assigned,
        "astronaut_profile": astro_prof,
    }


def _measurement_phase_and_environment(db: Session, mission: Mission, ctx: Dict[str, object]) -> Tuple[str, str]:
    """Fase y entorno con los que se guarda una medición.

    Con contexto operativo confirmado se usa ese contexto. Sin él (ContextResolver devuelve
    UNKNOWN / UNKNOWN_ENVIRONMENT) se usa la fase vigente del plan de la misión y su entorno: así la
    lectura continúa la serie de su fase en vez de abrir un segmento "UNKNOWN" aparte, que dejaba el
    pronóstico de ese indicador en datos insuficientes (misión análoga, que no tiene contexto
    confirmado). El contexto que se muestra al usuario sigue siendo "no confirmado".
    """
    phase, env = ctx.get("phase_code"), ctx.get("environment_code")
    if ctx.get("determination_source") != "UNCONFIRMED" and phase and env:
        return str(phase), str(env)
    current = (
        db.query(MissionPhase)
        .filter(MissionPhase.mission_id == mission.id, MissionPhase.is_current.is_(True))
        .order_by(MissionPhase.sequence_order.desc())
        .first()
    )
    if current is not None:
        return current.phase_code, current.environment_code
    return str(phase or mission.current_phase), str(env or "LUNAR_SURFACE")


def _resolve_target_astronaut_and_mission(
    db: Session,
    actor: User,
    astronaut_id: Optional[int],
    mission_id: Optional[int],
) -> tuple[User, Mission]:
    authorized_ids = get_authorized_astronaut_ids(db, actor)
    if astronaut_id is None:
        if actor.role and actor.role.code == "ASTRONAUT":
            astronaut_id = actor.id
        elif authorized_ids:
            astronaut_id = authorized_ids[0]
        else:
            raise HTTPException(status_code=404, detail="No hay astronautas asignados.")

    target_user = verify_astronaut_access(db, actor, astronaut_id)

    if mission_id is not None:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
    else:
        assign = (
            db.query(MissionAssignment)
            .filter(
                MissionAssignment.user_id == target_user.id,
                MissionAssignment.is_active.is_(True),
            )
            .first()
        )
        mission = assign.mission if assign else db.query(Mission).first()

    if not mission:
        raise HTTPException(status_code=404, detail="Misión no encontrada.")

    return target_user, mission


# ============================================================================
# 1. AUTHENTICATION ENDPOINTS
# ============================================================================

@router.post("/auth/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    now = utcnow()
    email_clean = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email_clean).first()
    ip_addr = request.client.host if request.client else "127.0.0.1"

    if not user:
        log_audit_event(
            db,
            action="LOGIN_FAILED",
            resource_type="AUTH",
            status_code="DENIED",
            details=f"Intento de inicio de sesión con correo no registrado: {email_clean}",
            ip_address=ip_addr,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas.",
        )

    if user.status != "ACTIVE":
        log_audit_event(
            db,
            action="LOGIN_BLOCKED_SUSPENDED",
            resource_type="AUTH",
            actor=user,
            status_code="DENIED",
            details=f"Cuenta en estado {user.status} intentó iniciar sesión.",
            ip_address=ip_addr,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"La cuenta se encuentra {user.status}. Contacte al administrador.",
        )

    if user.locked_until and ensure_aware(user.locked_until) > now:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intente más tarde.",
        )

    if not verify_password(payload.password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= settings.MAX_LOGIN_ATTEMPTS:
            user.locked_until = now + timedelta(minutes=settings.LOCKOUT_MINUTES)
        db.commit()
        log_audit_event(
            db,
            action="LOGIN_FAILED",
            resource_type="AUTH",
            actor=user,
            status_code="DENIED",
            details=f"Contraseña incorrecta (intento #{user.failed_login_attempts}).",
            ip_address=ip_addr,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas.",
        )

    user.failed_login_attempts = 0
    user.locked_until = None

    token = secrets.token_urlsafe(48)
    csrf_token = secrets.token_hex(24)
    session_obj = UserSession(
        user_id=user.id,
        token=token,
        csrf_token=csrf_token,
        user_agent=request.headers.get("user-agent", "SEMSA-Client"),
        ip_address=ip_addr,
        is_revoked=False,
        created_at=now,
        expires_at=now + timedelta(hours=settings.SESSION_EXPIRE_HOURS),
    )
    db.add(session_obj)
    db.commit()

    log_audit_event(
        db,
        action="LOGIN_SUCCESS",
        resource_type="AUTH",
        actor=user,
        status_code="SUCCESS",
        details="Inicio de sesión exitoso.",
        ip_address=ip_addr,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "csrf_token": csrf_token,
        "expires_at": session_obj.expires_at.isoformat(),
        "user": _serialize_user(db, user),
    }


@router.post("/auth/logout")
def logout(
    session_obj: UserSession = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    session_obj.is_revoked = True
    db.commit()
    log_audit_event(
        db,
        action="LOGOUT",
        resource_type="AUTH",
        actor=session_obj.user,
        status_code="SUCCESS",
        details="Sesión cerrada y revocada correctamente.",
    )
    return {"message": "Sesión cerrada correctamente."}


@router.get("/auth/me")
def get_me(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {
        "user": _serialize_user(db, user),
        "system_time_utc": utcnow().isoformat(),
    }


@router.post("/auth/password-recovery/request")
def request_password_recovery(payload: PasswordRecoveryRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.strip().lower()).first()
    if user and user.status == "ACTIVE":
        user.recovery_token = secrets.token_urlsafe(24)
        user.recovery_expires_at = utcnow() + timedelta(minutes=30)
        db.commit()
        log_audit_event(
            db,
            action="PASSWORD_RECOVERY_REQUESTED",
            resource_type="AUTH",
            actor=user,
            details="Token temporal de recuperación generado.",
        )
        if settings.DEMO_EXPOSE_RECOVERY_TOKEN:
            # Solo demo local con opt-in explícito (DEMO_EXPOSE_RECOVERY_TOKEN=true); nunca por APP_ENV
            return {
                "message": "Si el correo está registrado, se ha generado el token de recuperación.",
                "demo_recovery_token": user.recovery_token,
            }
    # Misma respuesta exista o no la cuenta (no revela qué correos están registrados)
    return {"message": "Si el correo está registrado, se ha generado el token de recuperación."}


@router.post("/auth/password-recovery/reset")
def confirm_password_recovery(payload: PasswordResetConfirm, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.strip().lower()).first()
    now = utcnow()
    if (
        not user
        or not user.recovery_token
        or user.recovery_token != payload.recovery_token
        or not user.recovery_expires_at
        or ensure_aware(user.recovery_expires_at) < now
    ):
        raise HTTPException(status_code=400, detail="Token de recuperación inválido o expirado.")

    user.password_hash = hash_password(payload.new_password)
    user.recovery_token = None
    user.recovery_expires_at = None
    user.failed_login_attempts = 0
    for s in user.sessions:
        s.is_revoked = True
    db.commit()

    log_audit_event(
        db,
        action="PASSWORD_RESET_COMPLETED",
        resource_type="AUTH",
        actor=user,
        details="Contraseña restablecida y sesiones previas revocadas.",
    )
    return {"message": "Contraseña actualizada correctamente."}


# ============================================================================
# 2. USERS, ROLES & PERMISSIONS
# ============================================================================

@router.get("/roles")
def list_roles(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    roles = db.query(Role).all()
    out = []
    for r in roles:
        p_codes = [rp.permission.code for rp in r.permissions if rp.permission]
        out.append(
            {
                "id": r.id,
                "code": r.code,
                "name": r.name,
                "description": r.description,
                "permissions": p_codes,
            }
        )
    return {"roles": out}


@router.get("/users")
def list_users(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role_code = user.role.code if user.role else ""
    if role_code == "ADMINISTRATOR":
        users = db.query(User).order_by(User.id.asc()).all()
    elif role_code == "MISSION_LEADER":
        allowed_ids = set(get_authorized_astronaut_ids(db, user)) | {user.id}
        users = db.query(User).filter(User.id.in_(allowed_ids)).order_by(User.id.asc()).all()
    else:
        users = [user]

    return {"users": [_serialize_user(db, u) for u in users]}


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateRequest,
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    email_clean = payload.email.strip().lower()
    if db.query(User).filter(User.email == email_clean).first():
        raise HTTPException(status_code=400, detail="El correo electrónico ya está registrado.")
    if db.query(User).filter(User.crew_code == payload.crew_code.strip()).first():
        raise HTTPException(status_code=400, detail="El código de tripulación ya existe.")

    role = db.query(Role).filter(Role.code == payload.role_code).first()
    if not role:
        raise HTTPException(status_code=400, detail="Rol no válido.")

    new_user = User(
        crew_code=payload.crew_code.strip().upper(),
        email=email_clean,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        role_id=role.id,
        status="ACTIVE",
        preferred_theme="space-dark",
        share_wellness_signals_with_leader=True,
        share_detailed_wellness_with_medical=False,
    )
    db.add(new_user)
    db.flush()

    if role.code == "ASTRONAUT":
        db.add(
            AstronautProfile(
                user_id=new_user.id,
                callsign=payload.callsign or "Astro-New",
                specialty=payload.specialty or "Especialista de Misión",
                eva_certified=True,
                authorized_restrictions_json='["Sin restricciones operativas"]',
            )
        )
        ensure_gamification_profile(db, new_user.id)

    db.commit()
    db.refresh(new_user)

    log_audit_event(
        db,
        action="CREATE_USER",
        resource_type="USER",
        actor=admin_user,
        resource_id=str(new_user.id),
        target_user_id=new_user.id,
        details=f"Usuario '{new_user.email}' creado con rol '{role.code}'.",
    )
    return {"user": _serialize_user(db, new_user)}


@router.get("/users/{user_id}")
def get_user_detail(
    user_id: int,
    actor: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if actor.role.code != "ADMINISTRATOR" and actor.id != user_id:
        verify_astronaut_access(db, actor, user_id, action_name="GET_USER_PROFILE")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return {"user": _serialize_user(db, target)}


@router.patch("/users/{user_id}")
def update_user_profile(
    user_id: int,
    payload: UserUpdateRequest,
    actor: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if actor.role.code != "ADMINISTRATOR" and actor.id != user_id:
        raise HTTPException(status_code=403, detail="Solo puede editar su propio perfil o ser Administrador.")

    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    if payload.full_name is not None:
        target.full_name = payload.full_name.strip()
    if payload.preferred_theme is not None:
        target.preferred_theme = payload.preferred_theme
    if payload.share_wellness_signals_with_leader is not None:
        target.share_wellness_signals_with_leader = payload.share_wellness_signals_with_leader
    if payload.share_detailed_wellness_with_medical is not None:
        target.share_detailed_wellness_with_medical = payload.share_detailed_wellness_with_medical

    if target.astronaut_profile:
        if payload.callsign is not None:
            target.astronaut_profile.callsign = payload.callsign
        if payload.specialty is not None:
            target.astronaut_profile.specialty = payload.specialty
        if payload.quiet_hours_window is not None:
            target.astronaut_profile.quiet_hours_window = payload.quiet_hours_window

    db.commit()
    db.refresh(target)

    log_audit_event(
        db,
        action="UPDATE_USER_PROFILE",
        resource_type="USER",
        actor=actor,
        resource_id=str(target.id),
        target_user_id=target.id,
        details="Perfil / preferencias de privacidad actualizadas.",
    )
    return {"user": _serialize_user(db, target)}


@router.patch("/users/{user_id}/status")
def change_user_status(
    user_id: int,
    payload: UserStatusPatch,
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    if payload.status not in ("ACTIVE", "SUSPENDED", "INACTIVE"):
        raise HTTPException(status_code=400, detail="Estado no válido.")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    old_status = target.status
    target.status = payload.status
    if payload.status != "ACTIVE":
        for s in target.sessions:
            s.is_revoked = True
    db.commit()

    log_audit_event(
        db,
        action="CHANGE_USER_STATUS",
        resource_type="USER",
        actor=admin_user,
        resource_id=str(target.id),
        target_user_id=target.id,
        justification=payload.reason,
        details=f"Estado de cuenta cambiado de {old_status} a {payload.status}.",
    )
    return {"user": _serialize_user(db, target)}


@router.patch("/users/{user_id}/role")
def change_user_role(
    user_id: int,
    payload: UserRolePatch,
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    role = db.query(Role).filter(Role.code == payload.role_code).first()
    if not role:
        raise HTTPException(status_code=400, detail="Rol no encontrado.")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    old_role = target.role.code if target.role else "NONE"
    target.role_id = role.id
    db.commit()
    db.refresh(target)

    log_audit_event(
        db,
        action="CHANGE_USER_ROLE",
        resource_type="USER_ROLE",
        actor=admin_user,
        resource_id=str(target.id),
        target_user_id=target.id,
        justification=payload.reason,
        details=f"Rol modificado de {old_role} a {role.code}.",
    )
    return {"user": _serialize_user(db, target)}


# ============================================================================
# 3. MISSIONS & CONTEXT ENGINE
# ============================================================================

@router.get("/missions")
def list_missions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role_code = user.role.code if user.role else ""
    if role_code == "ADMINISTRATOR":
        missions = db.query(Mission).order_by(Mission.id.asc()).all()
    else:
        assigned_m_ids = [
            ma.mission_id for ma in user.assignments if ma.is_active
        ]
        missions = (
            db.query(Mission)
            .filter(Mission.id.in_(assigned_m_ids))
            .order_by(Mission.id.asc())
            .all()
        )

    result = []
    now = utcnow()
    for m in missions:
        start_dt = ensure_aware(m.start_date)
        elapsed_days = (
            max(0, round((now - start_dt).total_seconds() / 86400.0, 1))
            if start_dt
            else None
        )
        crew = []
        for ma in m.assignments:
            if ma.is_active and ma.user:
                crew.append(
                    {
                        "user_id": ma.user.id,
                        "crew_code": ma.user.crew_code,
                        "full_name": ma.user.full_name,
                        "assignment_role": ma.assignment_role,
                    }
                )
        phases = [
            {
                "id": ph.id,
                "phase_code": ph.phase_code,
                "name": ph.name,
                "sequence_order": ph.sequence_order,
                "environment_code": ph.environment_code,
                "is_current": ph.is_current,
            }
            for ph in sorted(m.phases, key=lambda x: x.sequence_order)
        ]
        result.append(
            {
                "id": m.id,
                "code": m.code,
                "name": m.name,
                "description": m.description,
                "vehicle_or_habitat": m.vehicle_or_habitat,
                "start_date": start_dt.isoformat() if start_dt else None,
                "planned_end_date": ensure_aware(m.planned_end_date).isoformat() if m.planned_end_date else None,
                "elapsed_days": elapsed_days,
                "planned_duration_days": m.planned_duration_days,
                "current_phase": m.current_phase,
                "status": m.status,
                "is_simulated": m.is_simulated,
                "crew": crew,
                "phases": phases,
                "active_context": ContextResolver.resolve_active_context(db, m.id),
            }
        )
    return {"missions": result}


@router.post("/missions", status_code=status.HTTP_201_CREATED)
def create_mission(
    payload: MissionCreateRequest,
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    code_clean = payload.code.strip().upper()
    if db.query(Mission).filter(Mission.code == code_clean).first():
        raise HTTPException(status_code=400, detail="El código de misión ya existe.")

    now = utcnow()
    m = Mission(
        code=code_clean,
        name=payload.name.strip(),
        description=payload.description.strip(),
        vehicle_or_habitat=payload.vehicle_or_habitat.strip(),
        start_date=now,
        planned_end_date=now + timedelta(days=payload.planned_duration_days),
        planned_duration_days=payload.planned_duration_days,
        current_phase=payload.current_phase,
        status="ACTIVE",
        is_simulated=payload.is_simulated,
    )
    db.add(m)
    db.flush()

    db.add(
        MissionPhase(
            mission_id=m.id,
            phase_code=payload.current_phase,
            name=f"Fase Inicial ({payload.current_phase})",
            sequence_order=1,
            start_date=now,
            environment_code=payload.environment_code,
            is_current=True,
        )
    )
    db.add(
        MissionContext(
            mission_id=m.id,
            astronaut_id=None,
            environment_code=payload.environment_code,
            phase_code=payload.current_phase,
            location_module=payload.vehicle_or_habitat,
            determination_source="MISSION_ID",
            confidence="HIGH",
            connectivity_status="ONLINE",
            confirmed_by_user_id=admin_user.id,
            is_active=True,
            is_simulated=payload.is_simulated,
        )
    )
    db.commit()
    db.refresh(m)

    log_audit_event(
        db,
        action="CREATE_MISSION",
        resource_type="MISSION",
        actor=admin_user,
        resource_id=str(m.id),
        details=f"Misión '{m.code}' creada.",
    )
    return {"mission_id": m.id, "code": m.code, "name": m.name}


@router.post("/missions/{mission_id}/assignments")
def assign_user_to_mission(
    mission_id: int,
    payload: MissionAssignmentRequest,
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Misión no encontrada.")
    target_user = db.query(User).filter(User.id == payload.user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    existing = (
        db.query(MissionAssignment)
        .filter(
            MissionAssignment.mission_id == mission_id,
            MissionAssignment.user_id == payload.user_id,
        )
        .first()
    )
    if existing:
        existing.assignment_role = payload.assignment_role
        existing.is_active = True
    else:
        db.add(
            MissionAssignment(
                mission_id=mission_id,
                user_id=payload.user_id,
                assignment_role=payload.assignment_role,
                is_active=True,
            )
        )
    db.commit()

    log_audit_event(
        db,
        action="ASSIGN_USER_TO_MISSION",
        resource_type="MISSION_ASSIGNMENT",
        actor=admin_user,
        resource_id=f"{mission_id}:{payload.user_id}",
        target_user_id=payload.user_id,
        details=f"Usuario {target_user.email} vinculado a misión {mission.code} como {payload.assignment_role}.",
    )
    return {"message": "Asignación registrada correctamente."}


@router.get("/missions/{mission_id}/context")
def get_mission_context(
    mission_id: int,
    astronaut_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if astronaut_id:
        verify_astronaut_access(db, user, astronaut_id)
    ctx = ContextResolver.resolve_active_context(db, mission_id, astronaut_id)
    return {"context": ctx}


@router.post("/missions/{mission_id}/context")
def update_mission_context(
    mission_id: int,
    payload: ContextUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Misión no encontrada.")
    ep = (
        db.query(EnvironmentProfile)
        .filter(EnvironmentProfile.code == payload.environment_code)
        .first()
    )
    if not ep:
        raise HTTPException(status_code=400, detail="Perfil ambiental no reconocido.")

    target_astro_id = payload.astronaut_id
    if user.role.code == "ASTRONAUT":
        target_astro_id = user.id

    old_ctxs = (
        db.query(MissionContext)
        .filter(
            MissionContext.mission_id == mission_id,
            MissionContext.astronaut_id == target_astro_id,
            MissionContext.is_active.is_(True),
        )
        .all()
    )
    for o in old_ctxs:
        o.is_active = False

    mission.current_phase = payload.phase_code
    new_ctx = MissionContext(
        mission_id=mission_id,
        astronaut_id=target_astro_id,
        environment_code=payload.environment_code,
        phase_code=payload.phase_code,
        location_module=payload.location_module,
        determination_source=payload.determination_source,
        confidence="HIGH" if payload.environment_code != "UNKNOWN_ENVIRONMENT" else "UNCONFIRMED",
        connectivity_status=payload.connectivity_status,
        conflict_notes=payload.conflict_notes,
        confirmed_by_user_id=user.id,
        recorded_at=utcnow(),
        is_active=True,
        is_simulated=payload.is_simulated,
    )
    db.add(new_ctx)
    db.commit()

    log_audit_event(
        db,
        action="UPDATE_MISSION_CONTEXT",
        resource_type="MISSION_CONTEXT",
        actor=user,
        resource_id=str(mission_id),
        target_user_id=target_astro_id,
        details=(
            f"Entorno cambiado a {payload.environment_code} (Fase: {payload.phase_code}, "
            f"Fuente: {payload.determination_source}). Los límites clínicos NO fueron alterados."
        ),
    )
    return {
        "context": ContextResolver.resolve_active_context(db, mission_id, target_astro_id),
        "clinical_thresholds_modified": False,
    }


# ============================================================================
# 4. HEALTH INDICATORS, BODY EXPLORER & MEASUREMENTS
# ============================================================================

@router.get("/health/indicators")
def list_health_indicators(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    defs = db.query(HealthIndicatorDefinition).order_by(HealthIndicatorDefinition.id.asc()).all()
    out = []
    for d in defs:
        rule = (
            db.query(ClinicalRule)
            .filter(ClinicalRule.indicator_code == d.code, ClinicalRule.is_active.is_(True))
            .first()
        )
        ver = (
            db.query(ClinicalRuleVersion)
            .filter(ClinicalRuleVersion.rule_id == rule.id, ClinicalRuleVersion.is_current.is_(True))
            .first()
            if rule
            else None
        )
        out.append(
            {
                "code": d.code,
                "name": d.name,
                "category": d.category,
                "body_region_code": d.body_region_code,
                "unit": d.unit,
                "min_valid_value": d.min_valid_value,
                "max_valid_value": d.max_valid_value,
                "stale_after_hours": d.stale_after_hours,
                "requires_device": d.requires_device,
                "device_note": d.device_note,
                "step_by_step_instructions": d.step_by_step_instructions,
                "educational_summary": d.educational_summary,
                "spaceflight_risk_explanation": d.spaceflight_risk_explanation,
                "rule": {
                    "rule_code": rule.rule_code if rule else None,
                    "version": ver.version_number if ver else None,
                    "is_demo_rule": rule.is_demo_rule if rule else True,
                    "normal_min": ver.normal_min if ver else None,
                    "normal_max": ver.normal_max if ver else None,
                    "monitor_min": ver.monitor_min if ver else None,
                    "monitor_max": ver.monitor_max if ver else None,
                    "warning_min": ver.warning_min if ver else None,
                    "warning_max": ver.warning_max if ver else None,
                    "protocol_source": ver.protocol_source if ver else None,
                },
            }
        )
    return {"indicators": out}


@router.get("/health/body-regions")
def get_body_explorer_regions(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(db, user, astronaut_id, mission_id)
    summary_data = _build_astronaut_health_summary(db, target_user, mission)
    cards_by_code = {c["indicator_code"]: c for c in summary_data["indicator_cards"]}

    active_alerts = (
        db.query(Alert)
        .filter(
            Alert.astronaut_id == target_user.id,
            Alert.status.in_(["NEW", "ACKNOWLEDGED", "IN_FOLLOWUP", "ESCALATED"]),
        )
        .order_by(Alert.created_at.desc())
        .all()
    )

    regions_out = []
    for reg in BODY_REGIONS_CATALOG:
        reg_cards = [cards_by_code[ic] for ic in reg["indicator_codes"] if ic in cards_by_code]
        reg_alerts = [
            {
                "id": a.id,
                "title": a.title,
                "priority": a.priority,
                "operational_state": a.operational_state,
                "status": a.status,
                "created_at": ensure_aware(a.created_at).isoformat(),
            }
            for a in active_alerts
            if a.indicator_code in reg["indicator_codes"]
        ]

        # Determine visual region status
        states = [c["state"] for c in reg_cards]
        if "CRITICAL" in states:
            region_state = "CRITICAL"
        elif "WARNING" in states:
            region_state = "WARNING"
        elif "MONITOR" in states:
            region_state = "MONITOR"
        elif all(s in ("UNKNOWN", "STALE") for s in states):
            region_state = "UNKNOWN"
        else:
            region_state = "NORMAL"

        regions_out.append(
            {
                **reg,
                "region_state": region_state,
                "indicators": reg_cards,
                "active_alerts": reg_alerts,
                "non_diagnostic_notice": (
                    "La silueta corporal es una herramienta interactiva de navegación y educación; "
                    "no diagnostica enfermedades por sí misma."
                ),
            }
        )

    return {
        "astronaut": _serialize_user(db, target_user),
        "mission_code": mission.code,
        "regions": regions_out,
    }


def _build_astronaut_health_summary(
    db: Session, target_user: User, mission: Mission
) -> Dict[str, object]:
    now = utcnow()
    defs = db.query(HealthIndicatorDefinition).order_by(HealthIndicatorDefinition.id.asc()).all()
    sensors = (
        db.query(SensorRegistry)
        .filter(SensorRegistry.astronaut_id == target_user.id)
        .all()
    )
    offline_indicators = set()
    for s in sensors:
        if s.status == "OFFLINE":
            for ic in s.indicator_codes_csv.split(","):
                offline_indicators.add(ic.strip())

    cards = []
    counts = {
        "NORMAL": 0,
        "MONITOR": 0,
        "WARNING": 0,
        "CRITICAL": 0,
        "UNKNOWN": 0,
        "STALE": 0,
        "INVALID": 0,
    }
    trends_requiring_review = []

    for d in defs:
        recent = (
            db.query(HealthMeasurement)
            .filter(
                HealthMeasurement.astronaut_id == target_user.id,
                HealthMeasurement.indicator_code == d.code,
            )
            .order_by(HealthMeasurement.measured_at.desc())
            .limit(5)
            .all()
        )
        if not recent:
            state = "UNKNOWN"
            counts["UNKNOWN"] += 1
            cards.append(
                {
                    "indicator_code": d.code,
                    "name": d.name,
                    "category": d.category,
                    "body_region_code": d.body_region_code,
                    "latest_value": None,
                    "secondary_value": None,
                    "display_value": "Sin datos",
                    "unit": d.unit,
                    "measured_at": None,
                    "age_hours": None,
                    "trend_direction": "NO_DATA",
                    "trend_delta": None,
                    "trend_label": "Sin historial suficiente",
                    "state": state,
                    "source_code": "NONE",
                    "sensor_offline": d.code in offline_indicators,
                    "data_quality": "UNAVAILABLE",
                    "is_simulated": True,
                    "requires_device": d.requires_device,
                    "device_note": d.device_note,
                    "history_points": [],
                }
            )
            continue

        # Un dato INVALID (fuera de rango físico) se conserva para auditoría, pero no tapa
        # la última lectura válida: una lectura W/C no puede quedar oculta por un error de entrada.
        latest = next((r for r in recent if r.calculated_state != "INVALID"), recent[0])
        meas_dt = ensure_aware(latest.measured_at) or now
        age_hours = round((now - meas_dt).total_seconds() / 3600.0, 1)
        state = latest.calculated_state
        if age_hours > d.stale_after_hours and state not in ("WARNING", "CRITICAL", "INVALID"):
            state = "STALE"

        counts[state] = counts.get(state, 0) + 1

        # Compute trend vs previous measurement
        valid_recent = [r for r in recent if r.calculated_state != "INVALID"]
        if len(valid_recent) >= 2:
            delta = round(valid_recent[0].value - valid_recent[1].value, 2)
            if abs(delta) < 0.05:
                trend_dir = "STABLE"
                trend_lbl = "Estable frente a medición previa"
            elif delta > 0:
                trend_dir = "UP"
                trend_lbl = f"+{delta:g} {d.unit} frente a anterior"
            else:
                trend_dir = "DOWN"
                trend_lbl = f"{delta:g} {d.unit} frente a anterior"
        else:
            delta = 0.0
            trend_dir = "SINGLE"
            trend_lbl = "Única medición disponible"

        if state in ("MONITOR", "WARNING", "CRITICAL"):
            trends_requiring_review.append(
                {
                    "indicator_code": d.code,
                    "name": d.name,
                    "state": state,
                    "trend_label": trend_lbl,
                }
            )

        disp_val = f"{latest.value:g}"
        if latest.secondary_value is not None:
            disp_val = f"{latest.value:g}/{latest.secondary_value:g}"

        cards.append(
            {
                "indicator_code": d.code,
                "name": d.name,
                "category": d.category,
                "body_region_code": d.body_region_code,
                "latest_value": latest.value,
                "secondary_value": latest.secondary_value,
                "display_value": disp_val,
                "unit": d.unit,
                "measured_at": meas_dt.isoformat(),
                "age_hours": age_hours,
                "trend_direction": trend_dir,
                "trend_delta": delta,
                "trend_label": trend_lbl,
                "state": state,
                "source_code": latest.source_code,
                "sensor_offline": d.code in offline_indicators,
                "data_quality": latest.data_quality,
                "is_simulated": latest.is_simulated,
                "requires_device": d.requires_device,
                "device_note": d.device_note,
                "history_points": [
                    {
                        "measured_at": ensure_aware(r.measured_at).isoformat(),
                        "value": r.value,
                        "secondary_value": r.secondary_value,
                        "state": r.calculated_state,
                    }
                    for r in reversed(valid_recent)
                ],
            }
        )

    active_alerts = (
        db.query(Alert)
        .filter(
            Alert.astronaut_id == target_user.id,
            Alert.status.in_(["NEW", "ACKNOWLEDGED", "IN_FOLLOWUP", "ESCALATED"]),
        )
        .order_by(Alert.created_at.desc())
        .all()
    )

    today_str = now.strftime("%Y-%m-%d")
    total_daily_missions = db.query(DailyMission).filter(DailyMission.is_active.is_(True)).count()
    completed_today = (
        db.query(GamificationEvent)
        .filter(
            GamificationEvent.user_id == target_user.id,
            GamificationEvent.event_date_str == today_str,
        )
        .count()
    )

    context = ContextResolver.resolve_active_context(db, mission.id, target_user.id)
    env_measurements = (
        db.query(EnvironmentalMeasurement)
        .filter(EnvironmentalMeasurement.mission_id == mission.id)
        .order_by(EnvironmentalMeasurement.measured_at.desc())
        .limit(13)
        .all()
    )

    start_dt = ensure_aware(mission.start_date)
    elapsed_days = (
        max(0, round((now - start_dt).total_seconds() / 86400.0, 1))
        if start_dt
        else None
    )

    available_count = len(defs) - counts["UNKNOWN"] - counts["STALE"] - counts["INVALID"]
    coverage_pct = round((available_count / len(defs)) * 100) if defs else 0

    return {
        "system_time_utc": now.isoformat(),
        "timezone_label": "UTC (Mission Elapsed Reference Time)",
        "astronaut": _serialize_user(db, target_user),
        "mission": {
            "id": mission.id,
            "code": mission.code,
            "name": mission.name,
            "vehicle_or_habitat": mission.vehicle_or_habitat,
            "current_phase": mission.current_phase,
            "elapsed_days": elapsed_days,
            "planned_duration_days": mission.planned_duration_days,
            "is_simulated": mission.is_simulated,
        },
        "context": context,
        "mission_summary": {
            "indicators_normal": counts["NORMAL"],
            "indicators_monitoring": counts["MONITOR"],
            "indicators_warning": counts["WARNING"],
            "indicators_critical": counts["CRITICAL"],
            "pending_or_missing_measurements": counts["UNKNOWN"] + counts["STALE"],
            "active_alerts_count": len(active_alerts),
            "routines_completed_today": completed_today,
            "routines_total_available": total_daily_missions,
            "routine_participation_label": (
                f"{completed_today}/{total_daily_missions} rutinas hoy (Indicador de participación, no medida médica)"
            ),
            "trends_for_review": trends_requiring_review,
            "data_quality_coverage_percent": coverage_pct,
            "non_clinical_index_notice": (
                "SEMSA no calcula un 'porcentaje de salud total' arbitrario. "
                "Se presentan estados operativos verificables por indicador e índices de participación en autocuidado."
            ),
        },
        "indicator_cards": cards,
        "environmental_telemetry": [
            {
                "parameter_code": em.parameter_code,
                "parameter_name": em.parameter_name,
                "value": em.value,
                "text_state": em.text_state,
                "unit": em.unit,
                "source_code": em.source_code,
                "data_quality": em.data_quality,
                "availability_status": em.availability_status,
                "calculated_state": em.calculated_state,
                "measured_at": ensure_aware(em.measured_at).isoformat(),
                "is_simulated": em.is_simulated,
            }
            for em in env_measurements
        ],
        "sensors": [
            {
                "sensor_code": s.sensor_code,
                "name": s.name,
                "indicator_codes": s.indicator_codes_csv.split(","),
                "status": s.status,
                "last_seen_at": ensure_aware(s.last_seen_at).isoformat() if s.last_seen_at else None,
                "is_simulated": s.is_simulated,
            }
            for s in sensors
        ],
        "expansion_cards": build_expansion_cards_for_summary(db, target_user, mission),
    }


@router.get("/health/summary")
def get_health_summary(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(db, user, astronaut_id, mission_id)
    return _build_astronaut_health_summary(db, target_user, mission)


@router.get("/health/measurements")
def list_health_measurements(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    indicator_code: Optional[str] = None,
    phase_code: Optional[str] = None,
    environment_code: Optional[str] = None,
    state: Optional[str] = None,
    source_code: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(db, user, astronaut_id, mission_id)
    query = db.query(HealthMeasurement).filter(HealthMeasurement.astronaut_id == target_user.id)
    if mission_id:
        query = query.filter(HealthMeasurement.mission_id == mission_id)
    if indicator_code:
        query = query.filter(HealthMeasurement.indicator_code == indicator_code)
    if phase_code:
        query = query.filter(HealthMeasurement.phase_code == phase_code)
    if environment_code:
        query = query.filter(HealthMeasurement.environment_code == environment_code)
    if state:
        query = query.filter(HealthMeasurement.calculated_state == state)
    if source_code:
        query = query.filter(HealthMeasurement.source_code == source_code)

    rows = query.order_by(HealthMeasurement.measured_at.desc()).limit(limit).all()
    return {
        "measurements": [
            {
                "id": r.id,
                "astronaut_id": r.astronaut_id,
                "mission_id": r.mission_id,
                "indicator_code": r.indicator_code,
                "value": r.value,
                "secondary_value": r.secondary_value,
                "unit": r.unit,
                "measured_at": ensure_aware(r.measured_at).isoformat(),
                "received_at": ensure_aware(r.received_at).isoformat(),
                "phase_code": r.phase_code,
                "environment_code": r.environment_code,
                "source_code": r.source_code,
                "data_quality": r.data_quality,
                "calculated_state": r.calculated_state,
                "is_simulated": r.is_simulated,
                "notes": r.notes,
            }
            for r in rows
        ]
    }


@router.post("/health/measurements", status_code=status.HTTP_201_CREATED)
def create_health_measurement(
    payload: HealthMeasurementCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(
        db, user, payload.astronaut_id, payload.mission_id
    )
    if user.role.code == "ASTRONAUT" and target_user.id != user.id:
        raise HTTPException(status_code=403, detail="Solo puede registrar sus propias mediciones.")

    if payload.dedup_key:
        existing_dedup = (
            db.query(HealthMeasurement)
            .filter(HealthMeasurement.dedup_key == payload.dedup_key)
            .first()
        )
        if existing_dedup:
            return {
                "duplicate_prevented": True,
                "measurement_id": existing_dedup.id,
                "calculated_state": existing_dedup.calculated_state,
                "message": "Medición previamente sincronizada (duplicado evitado).",
            }

    defn = (
        db.query(HealthIndicatorDefinition)
        .filter(HealthIndicatorDefinition.code == payload.indicator_code)
        .first()
    )
    if not defn:
        raise HTTPException(status_code=404, detail="Indicador de salud no encontrado.")

    ctx = ContextResolver.resolve_active_context(db, mission.id, target_user.id)
    meas_phase, meas_env = _measurement_phase_and_environment(db, mission, ctx)
    meas_dt = ensure_aware(payload.measured_at) or utcnow()

    evaluation = evaluate_measurement(
        db=db,
        definition=defn,
        astronaut_id=target_user.id,
        mission_id=mission.id,
        value=payload.value,
        secondary_value=payload.secondary_value,
        measured_at=meas_dt,
        source_code=payload.source_code,
    )
    state, rule, version, reasons = evaluation.as_tuple()

    quality = payload.data_quality
    if state == "INVALID":
        quality = "INVALID"
    elif payload.is_simulated and quality == "VALIDATED":
        quality = "SYNTHETIC_DEMO"

    m = HealthMeasurement(
        dedup_key=payload.dedup_key,
        astronaut_id=target_user.id,
        mission_id=mission.id,
        indicator_code=defn.code,
        value=payload.value,
        secondary_value=payload.secondary_value,
        unit=defn.unit,
        measured_at=meas_dt,
        received_at=utcnow(),
        phase_code=meas_phase,
        environment_code=meas_env,
        source_code=payload.source_code,
        data_quality=quality,
        calculated_state=state,
        rule_version_id=version.id if version else None,
        is_simulated=payload.is_simulated,
        notes=payload.notes,
    )
    db.add(m)
    db.flush()

    # Una sola alerta abierta por astronauta + indicador + regla: si ya existe, se actualiza
    alert_created, alert_is_new = upsert_alert_for_measurement(db, m, defn, evaluation)
    db.commit()
    db.refresh(m)

    # If valid measurement, also credit DAILY_HEALTH_CHECK or PULSE_CHECK if astronaut
    gamification_bonus = None
    if state != "INVALID" and user.role.code == "ASTRONAUT":
        mission_to_credit = (
            "PULSE_CHECK"
            if defn.code in ("HEART_RATE", "BLOOD_PRESSURE")
            else "DAILY_HEALTH_CHECK"
        )
        try:
            gamification_bonus = record_gamification_mission(
                db,
                user_id=target_user.id,
                daily_mission_code=mission_to_credit,
                status_mode="COMPLETED",
                reflection_note=f"Registro validado de {defn.name}",
                is_simulated=payload.is_simulated,
            )
        except Exception:
            gamification_bonus = None

    return {
        "duplicate_prevented": False,
        "measurement": {
            "id": m.id,
            "indicator_code": m.indicator_code,
            "indicator_name": defn.name,
            "value": m.value,
            "secondary_value": m.secondary_value,
            "unit": m.unit,
            "calculated_state": m.calculated_state,
            "data_quality": m.data_quality,
            "measured_at": ensure_aware(m.measured_at).isoformat(),
            "is_simulated": m.is_simulated,
        },
        "evaluation_reasons": reasons,
        # La recomendación concreta sale del catálogo por indicador × dirección × nivel (la de la alerta)
        "recommended_next_step": (
            alert_created.immediate_action
            if alert_created
            else "Medición dentro de los límites configurados. Continúe con su plan preventivo habitual."
        ),
        "alert_generated": (
            {
                "id": alert_created.id,
                "priority": alert_created.priority,
                "title": alert_created.title,
                "immediate_action": alert_created.immediate_action,
                "followup_recommendation": alert_created.followup_recommendation,
                # False: la lectura actualizó la alerta que ya estaba abierta para este indicador
                "is_new": alert_is_new,
            }
            if alert_created
            else None
        ),
        "gamification_update": gamification_bonus,
    }


@router.post("/health/measurements/import")
def import_health_measurements(
    payload: BulkImportRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(
        db, user, payload.astronaut_id, payload.mission_id
    )
    if len(payload.payload_text) > 250_000:
        raise HTTPException(status_code=413, detail="Archivo importado excede el tamaño máximo permitido (250 KB).")

    records_to_process = []
    fmt = payload.format_type.strip().upper()
    try:
        if fmt == "JSON":
            parsed = json.loads(payload.payload_text)
            if isinstance(parsed, dict) and "measurements" in parsed:
                parsed = parsed["measurements"]
            if not isinstance(parsed, list):
                raise ValueError("El JSON debe contener una lista de objetos de medición.")
            records_to_process = parsed
        elif fmt == "CSV":
            reader = csv.DictReader(io.StringIO(payload.payload_text.strip()))
            records_to_process = list(reader)
        else:
            raise ValueError("Formato no soportado. Use JSON o CSV.")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error al procesar archivo importado: {exc}")

    ctx = ContextResolver.resolve_active_context(db, mission.id, target_user.id)
    meas_phase, meas_env = _measurement_phase_and_environment(db, mission, ctx)
    imported_count = 0
    invalid_count = 0
    touched_alert_ids = set()  # alertas creadas o actualizadas (una por indicador)

    for item in records_to_process[:100]:
        icode = str(item.get("indicator_code", "")).strip().upper()
        defn = (
            db.query(HealthIndicatorDefinition)
            .filter(HealthIndicatorDefinition.code == icode)
            .first()
        )
        if not defn:
            invalid_count += 1
            continue
        try:
            val = float(item.get("value"))
            sec_raw = item.get("secondary_value")
            sec_val = float(sec_raw) if sec_raw not in (None, "") else None
        except Exception:
            invalid_count += 1
            continue

        meas_dt = utcnow()
        evaluation = evaluate_measurement(
            db, defn, target_user.id, mission.id, val, sec_val, meas_dt, "CSV_JSON_IMPORT"
        )
        state, rule, version, reasons = evaluation.as_tuple()
        if state == "INVALID":
            invalid_count += 1

        m = HealthMeasurement(
            astronaut_id=target_user.id,
            mission_id=mission.id,
            indicator_code=defn.code,
            value=val,
            secondary_value=sec_val,
            unit=defn.unit,
            measured_at=meas_dt,
            received_at=utcnow(),
            phase_code=meas_phase,
            environment_code=meas_env,
            source_code="CSV_JSON_IMPORT",
            data_quality="INVALID" if state == "INVALID" else ("SYNTHETIC_DEMO" if payload.is_simulated else "VALIDATED"),
            calculated_state=state,
            rule_version_id=version.id if version else None,
            is_simulated=payload.is_simulated,
            notes="Importado por lote CSV/JSON",
        )
        db.add(m)
        db.flush()
        imported_count += 1

        al, _al_is_new = upsert_alert_for_measurement(db, m, defn, evaluation)
        if al:
            touched_alert_ids.add(al.id)

    db.commit()
    log_audit_event(
        db,
        action="BULK_IMPORT_MEASUREMENTS",
        resource_type="HEALTH_MEASUREMENT",
        actor=user,
        target_user_id=target_user.id,
        details=f"Importados {imported_count} registros ({fmt}), inválidos={invalid_count}, alertas={len(touched_alert_ids)}.",
    )
    return {
        "imported_count": imported_count,
        "invalid_count": invalid_count,
        "alerts_generated": len(touched_alert_ids),
    }


@router.get("/health/measurements/{measurement_id}")
def get_single_measurement(
    measurement_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.query(HealthMeasurement).filter(HealthMeasurement.id == measurement_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Medición no encontrada.")
    verify_astronaut_access(db, user, m.astronaut_id)
    return {
        "id": m.id,
        "astronaut_id": m.astronaut_id,
        "mission_id": m.mission_id,
        "indicator_code": m.indicator_code,
        "value": m.value,
        "secondary_value": m.secondary_value,
        "unit": m.unit,
        "calculated_state": m.calculated_state,
        "data_quality": m.data_quality,
        "source_code": m.source_code,
        "measured_at": ensure_aware(m.measured_at).isoformat(),
        "is_simulated": m.is_simulated,
        "notes": m.notes,
    }


@router.get("/health/explain/{indicator_code}")
def explain_health_indicator(
    indicator_code: str,
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(db, user, astronaut_id, mission_id)
    ctx = ContextResolver.resolve_active_context(db, mission.id, target_user.id)
    return AssistiveGuidanceService.explain_indicator_and_trend(
        db=db,
        astronaut_id=target_user.id,
        indicator_code=indicator_code,
        environment_code=str(ctx.get("environment_code") or "LUNAR_SURFACE"),
    )


# ============================================================================
# 5. ENVIRONMENT PROFILES & TELEMETRY
# ============================================================================

@router.get("/environment/profiles")
def list_environment_profiles(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profiles = db.query(EnvironmentProfile).order_by(EnvironmentProfile.id.asc()).all()
    return {
        "profiles": [
            {
                "code": p.code,
                "name": p.name,
                "gravity_g": p.gravity_g,
                "gravity_label": p.gravity_label,
                "radiation_hazard_level": p.radiation_hazard_level,
                "isolation_level": p.isolation_level,
                "distance_from_earth_label": p.distance_from_earth_label,
                "comms_delay_seconds": p.comms_delay_seconds,
                "enclosed_environment_type": p.enclosed_environment_type,
                "description": p.description,
                "key_physiological_risks": p.key_physiological_risks,
                "preventive_focus": p.preventive_focus,
            }
            for p in profiles
        ]
    }


@router.get("/environment/measurements")
def list_environmental_measurements(
    mission_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not mission_id:
        first_m = db.query(Mission).first()
        mission_id = first_m.id if first_m else 1
    rows = (
        db.query(EnvironmentalMeasurement)
        .filter(EnvironmentalMeasurement.mission_id == mission_id)
        .order_by(EnvironmentalMeasurement.measured_at.desc())
        .limit(50)
        .all()
    )
    return {
        "environmental_measurements": [
            {
                "id": r.id,
                "mission_id": r.mission_id,
                "environment_code": r.environment_code,
                "phase_code": r.phase_code,
                "parameter_code": r.parameter_code,
                "parameter_name": r.parameter_name,
                "value": r.value,
                "text_state": r.text_state,
                "unit": r.unit,
                "source_code": r.source_code,
                "data_quality": r.data_quality,
                "availability_status": r.availability_status,
                "calculated_state": r.calculated_state,
                "measured_at": ensure_aware(r.measured_at).isoformat(),
                "is_simulated": r.is_simulated,
            }
            for r in rows
        ]
    }


@router.post("/environment/measurements", status_code=status.HTTP_201_CREATED)
def create_environmental_measurement(
    payload: EnvironmentalMeasurementCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    em = EnvironmentalMeasurement(
        mission_id=payload.mission_id,
        environment_code=payload.environment_code,
        phase_code=payload.phase_code,
        parameter_code=payload.parameter_code,
        parameter_name=payload.parameter_name,
        value=payload.value,
        text_state=payload.text_state,
        unit=payload.unit,
        source_code=payload.source_code,
        data_quality="SYNTHETIC_DEMO" if payload.is_simulated else "VALIDATED",
        availability_status="AVAILABLE",
        calculated_state="NORMAL",
        measured_at=utcnow(),
        is_simulated=payload.is_simulated,
    )
    db.add(em)
    db.commit()
    db.refresh(em)
    return {"id": em.id, "parameter_code": em.parameter_code}


@router.get("/environment/sources")
def list_data_sources(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sources = db.query(DataSource).all()
    return {
        "sources": [
            {
                "code": s.code,
                "name": s.name,
                "source_type": s.source_type,
                "is_verified_hardware": s.is_verified_hardware,
                "status": s.status,
                "description": s.description,
            }
            for s in sources
        ]
    }


# ============================================================================
# 6. ALERTS & PREVENTIVE FOLLOW-UP
# ============================================================================

def _serialize_alert(db: Session, a: Alert) -> Dict[str, object]:
    astro = db.query(User).filter(User.id == a.astronaut_id).first()
    return {
        "id": a.id,
        "astronaut_id": a.astronaut_id,
        "astronaut_name": astro.full_name if astro else f"Astronaut #{a.astronaut_id}",
        "crew_code": astro.crew_code if astro else "",
        "mission_id": a.mission_id,
        "indicator_code": a.indicator_code,
        "rule_code": a.rule_code,
        "rule_version_label": a.rule_version_label,
        "value_recorded": a.value_recorded,
        "unit": a.unit,
        "priority": a.priority,
        "operational_state": a.operational_state,
        "status": a.status,
        "title": a.title,
        "explanation": a.explanation,
        "data_quality": a.data_quality,
        "immediate_action": a.immediate_action,
        "followup_recommendation": a.followup_recommendation,
        "environment_code": a.environment_code,
        "phase_code": a.phase_code,
        "is_simulated": a.is_simulated,
        "created_at": ensure_aware(a.created_at).isoformat(),
        "updated_at": ensure_aware(a.updated_at).isoformat(),
        "acknowledgements": [
            {
                "id": ack.id,
                "user_id": ack.user_id,
                "role_at_time": ack.role_at_time,
                "action_taken": ack.action_taken,
                "created_at": ensure_aware(ack.created_at).isoformat(),
            }
            for ack in a.acknowledgements
        ],
        "followups": [
            {
                "id": f.id,
                "author_user_id": f.author_user_id,
                "author_role": f.author_role,
                "action_type": f.action_type,
                "notes": f.notes,
                "created_at": ensure_aware(f.created_at).isoformat(),
            }
            for f in a.followups
        ],
    }


@router.get("/alerts")
def list_alerts(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    priority: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed_ids = get_authorized_astronaut_ids(db, user)
    if astronaut_id is not None:
        verify_astronaut_access(db, user, astronaut_id, action_name="LIST_ALERTS")
        filter_ids = [astronaut_id]
    else:
        filter_ids = allowed_ids

    if not filter_ids:
        return {"alerts": []}

    query = db.query(Alert).filter(Alert.astronaut_id.in_(filter_ids))
    if mission_id:
        query = query.filter(Alert.mission_id == mission_id)
    if status_filter:
        query = query.filter(Alert.status == status_filter)
    if priority:
        query = query.filter(Alert.priority == priority)

    # Alertas tempranas de bienestar: el líder no las ve si el astronauta no comparte sus señales
    hidden_ids = _early_alert_hidden_astronauts(db, user, filter_ids)
    if hidden_ids:
        query = query.filter(~(Alert.astronaut_id.in_(hidden_ids) & Alert.rule_code.like(f"{EARLY_RULE_PREFIX}%")))

    alerts = query.order_by(Alert.created_at.desc()).limit(100).all()
    return {"alerts": [_serialize_alert(db, a) for a in alerts]}


def _early_alert_hidden_astronauts(db: Session, user: User, astronaut_ids: List[int]) -> List[int]:
    """Astronautas cuyas alertas tempranas de bienestar no ve este usuario (solo aplica al líder:
    mismo criterio que la señal operativa del check-in en isolation_router.list_quick_checkins)."""
    if not user.role or user.role.code != "MISSION_LEADER" or not astronaut_ids:
        return []
    rows = (
        db.query(User.id)
        .filter(User.id.in_(astronaut_ids), User.share_wellness_signals_with_leader.is_(False))
        .all()
    )
    return [r[0] for r in rows]


def _early_alert_hidden(db: Session, user: User, alert: Alert) -> bool:
    return is_early_rule(alert.rule_code) and bool(_early_alert_hidden_astronauts(db, user, [alert.astronaut_id]))


@router.get("/alerts/{alert_id}")
def get_alert_detail(
    alert_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")
    verify_astronaut_access(db, user, alert.astronaut_id, action_name="GET_ALERT_DETAIL")
    if _early_alert_hidden(db, user, alert):
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")
    return {"alert": _serialize_alert(db, alert)}


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: int,
    payload: AlertAckRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")
    verify_astronaut_access(db, user, alert.astronaut_id, action_name="ACKNOWLEDGE_ALERT")
    if _early_alert_hidden(db, user, alert):
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")

    ack = AlertAcknowledgement(
        alert_id=alert.id,
        user_id=user.id,
        role_at_time=user.role.code if user.role else "ASTRONAUT",
        action_taken=payload.action_taken.strip(),
        created_at=utcnow(),
    )
    db.add(ack)
    if alert.status == "NEW":
        alert.status = "ACKNOWLEDGED"
    alert.updated_at = utcnow()
    db.commit()
    db.refresh(alert)

    # Credit FOLLOW_UP_MISSION if astronaut
    if user.role.code == "ASTRONAUT":
        try:
            record_gamification_mission(
                db,
                user_id=user.id,
                daily_mission_code="FOLLOW_UP_MISSION",
                status_mode="COMPLETED",
                reflection_note=f"Reconocimiento de alerta #{alert.id}",
                is_simulated=alert.is_simulated,
            )
        except Exception:
            pass

    log_audit_event(
        db,
        action="ACKNOWLEDGE_ALERT",
        resource_type="ALERT",
        actor=user,
        resource_id=str(alert.id),
        target_user_id=alert.astronaut_id,
        details=f"Alerta #{alert.id} reconocida: {payload.action_taken}",
    )
    return {"alert": _serialize_alert(db, alert)}


@router.post("/alerts/{alert_id}/followup")
def add_alert_followup(
    alert_id: int,
    payload: AlertFollowUpRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")
    verify_astronaut_access(db, user, alert.astronaut_id, action_name="FOLLOWUP_ALERT")
    if _early_alert_hidden(db, user, alert):
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")

    fup = FollowUpAction(
        alert_id=alert.id,
        author_user_id=user.id,
        author_role=user.role.code if user.role else "ASTRONAUT",
        action_type=payload.action_type,
        notes=payload.notes.strip(),
        created_at=utcnow(),
    )
    db.add(fup)
    if payload.action_type == "RESOLVED":
        alert.status = "RESOLVED"
    elif alert.status in ("NEW", "ACKNOWLEDGED"):
        alert.status = "IN_FOLLOWUP"
    alert.updated_at = utcnow()
    db.commit()
    db.refresh(alert)

    log_audit_event(
        db,
        action="FOLLOWUP_ALERT",
        resource_type="ALERT",
        actor=user,
        resource_id=str(alert.id),
        target_user_id=alert.astronaut_id,
        details=f"Seguimiento ({payload.action_type}) en alerta #{alert.id}: {payload.notes}",
    )
    return {"alert": _serialize_alert(db, alert)}


@router.post("/alerts/{alert_id}/escalate")
def escalate_alert(
    alert_id: int,
    payload: AlertEscalateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")
    verify_astronaut_access(db, user, alert.astronaut_id, action_name="ESCALATE_ALERT")
    if _early_alert_hidden(db, user, alert):
        raise HTTPException(status_code=404, detail="Alerta no encontrada.")

    alert.status = "ESCALATED"
    alert.updated_at = utcnow()
    fup = FollowUpAction(
        alert_id=alert.id,
        author_user_id=user.id,
        author_role=user.role.code if user.role else "MISSION_LEADER",
        action_type="ESCALATED_TO_FLIGHT_SURGEON",
        notes=payload.notes.strip(),
        created_at=utcnow(),
    )
    db.add(fup)
    db.commit()
    db.refresh(alert)

    log_audit_event(
        db,
        action="ESCALATE_ALERT",
        resource_type="ALERT",
        actor=user,
        resource_id=str(alert.id),
        target_user_id=alert.astronaut_id,
        details=f"Alerta #{alert.id} escalada a equipo médico: {payload.notes}",
    )
    return {"alert": _serialize_alert(db, alert)}


# ============================================================================
# 7. WELLNESS CENTER (PRIVACY-ENFORCED PSYCHOLOGICAL WELLBEING)
# ============================================================================

def _compute_operational_wellness_state(payload: WellnessAssessmentCreate) -> str:
    if payload.is_draft:
        return "ASSESSMENT_INCOMPLETE"
    if payload.support_urgency == "URGENT_SUPPORT":
        return "URGENT_SUPPORT"
    if payload.support_urgency == "PRIORITY_REVIEW":
        return "PROFESSIONAL_REVIEW"
    if payload.request_additional_support or payload.support_urgency == "ROUTINE_COUNSELING":
        return "SUPPORT_RECOMMENDED"
    if (
        payload.stress_score >= 8
        or payload.isolation_score >= 8
        or payload.mood_score <= 3
        or payload.fatigue_score >= 8
    ):
        return "SUPPORT_RECOMMENDED"
    if (
        payload.stress_score >= 6
        or payload.isolation_score >= 6
        or payload.mood_score <= 5
        or payload.sleep_quality_score <= 4
    ):
        return "WELLNESS_MONITORING"
    return "WELLNESS_STABLE"


@router.get("/wellness/instruments")
def list_wellness_instruments(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    instruments = db.query(WellnessInstrument).all()
    return {
        "instruments": [
            {
                "code": inst.code,
                "title": inst.title,
                "version": inst.version,
                "is_clinically_validated": inst.is_clinically_validated,
                "disclaimer": inst.disclaimer,
                "dimensions": json.loads(inst.dimensions_json),
            }
            for inst in instruments
        ]
    }


@router.get("/wellness/assessments")
def list_wellness_assessments(
    astronaut_id: Optional[int] = None,
    include_private_details: bool = Query(default=False),
    audit_justification: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Enforces strict privacy rules (Section 9.3 & 14):
    - Astronaut sees their own complete assessments including private reflections and dimension scores.
    - Mission Leader NEVER sees raw questionnaire scores or private reflections; only sees operational
      follow-up signals (operational_wellness_state, support_urgency) when allowed by policy.
    - Administrator cannot see private reflections unless include_private_details=True AND an explicit
      audit_justification is provided (which is recorded in AuditEvent).
    """
    target_id = astronaut_id or user.id
    role_code = user.role.code if user.role else "ASTRONAUT"

    if role_code == "ASTRONAUT":
        verify_astronaut_access(db, user, target_id, action_name="READ_OWN_WELLNESS")
        can_see_private = True
    elif role_code == "MISSION_LEADER":
        if include_private_details:
            verify_astronaut_access(
                db,
                user,
                target_id,
                action_name="ATTEMPT_READ_PRIVATE_WELLNESS",
                is_sensitive_psychological=True,
            )
        verify_astronaut_access(db, user, target_id, action_name="READ_WELLNESS_OPERATIONAL_SIGNAL")
        can_see_private = False
    else:  # ADMINISTRATOR
        if include_private_details:
            verify_astronaut_access(
                db,
                user,
                target_id,
                action_name="ADMIN_AUDITED_WELLNESS_ACCESS",
                audit_justification=audit_justification,
                is_sensitive_psychological=True,
            )
            can_see_private = True
        else:
            can_see_private = False

    rows = (
        db.query(PsychologicalWellnessAssessment)
        .filter(PsychologicalWellnessAssessment.astronaut_id == target_id)
        .order_by(PsychologicalWellnessAssessment.created_at.desc())
        .limit(30)
        .all()
    )

    out = []
    for r in rows:
        if not can_see_private and not r.share_operational_signal_with_leader and role_code == "MISSION_LEADER":
            out.append(
                {
                    "id": r.id,
                    "astronaut_id": r.astronaut_id,
                    "operational_wellness_state": "PRIVATE_BY_CREW_PREFERENCE",
                    "request_additional_support": r.request_additional_support,
                    "support_urgency": r.support_urgency,
                    "privacy_redacted": True,
                    "privacy_notice": "El astronauta configuró privacidad reforzada para este registro.",
                    "created_at": ensure_aware(r.created_at).isoformat(),
                    "is_simulated": r.is_simulated,
                }
            )
            continue

        item = {
            "id": r.id,
            "astronaut_id": r.astronaut_id,
            "mission_id": r.mission_id,
            "instrument_code": r.instrument_code,
            "is_draft": r.is_draft,
            "operational_wellness_state": r.operational_wellness_state,
            "request_additional_support": r.request_additional_support,
            "support_urgency": r.support_urgency,
            "phase_code": r.phase_code,
            "environment_code": r.environment_code,
            "is_simulated": r.is_simulated,
            "created_at": ensure_aware(r.created_at).isoformat(),
            "privacy_redacted": not can_see_private,
        }
        if can_see_private:
            item.update(
                {
                    "mood_score": r.mood_score,
                    "stress_score": r.stress_score,
                    "sleep_quality_score": r.sleep_quality_score,
                    "sleep_hours": r.sleep_hours,
                    "fatigue_score": r.fatigue_score,
                    "concentration_score": r.concentration_score,
                    "isolation_score": r.isolation_score,
                    "adaptation_score": r.adaptation_score,
                    "social_support_score": r.social_support_score,
                    "recovery_score": r.recovery_score,
                    "private_reflection": r.private_reflection,
                    "share_operational_signal_with_leader": r.share_operational_signal_with_leader,
                }
            )
        else:
            item["privacy_notice"] = (
                "Vista operativa autorizada: las respuestas detalladas y reflexiones personales están protegidas por defecto."
            )
        out.append(item)

    return {"assessments": out}


@router.post("/wellness/assessments", status_code=status.HTTP_201_CREATED)
def create_wellness_assessment(
    payload: WellnessAssessmentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(
        db, user, payload.astronaut_id, payload.mission_id
    )
    if user.role.code == "ASTRONAUT" and target_user.id != user.id:
        raise HTTPException(status_code=403, detail="Solo puede registrar su propia evaluación de bienestar.")

    ctx = ContextResolver.resolve_active_context(db, mission.id, target_user.id)
    op_state = _compute_operational_wellness_state(payload)

    record = PsychologicalWellnessAssessment(
        astronaut_id=target_user.id,
        mission_id=mission.id,
        instrument_code=payload.instrument_code,
        is_draft=payload.is_draft,
        mood_score=payload.mood_score,
        stress_score=payload.stress_score,
        sleep_quality_score=payload.sleep_quality_score,
        sleep_hours=payload.sleep_hours,
        fatigue_score=payload.fatigue_score,
        concentration_score=payload.concentration_score,
        isolation_score=payload.isolation_score,
        adaptation_score=payload.adaptation_score,
        social_support_score=payload.social_support_score,
        recovery_score=payload.recovery_score,
        request_additional_support=payload.request_additional_support,
        support_urgency=payload.support_urgency,
        private_reflection=payload.private_reflection,
        share_operational_signal_with_leader=payload.share_operational_signal_with_leader,
        operational_wellness_state=op_state,
        phase_code=str(ctx.get("phase_code") or mission.current_phase),
        environment_code=str(ctx.get("environment_code") or "LUNAR_SURFACE"),
        is_simulated=payload.is_simulated,
        created_at=utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    gamification_update = None
    if not payload.is_draft and user.role.code == "ASTRONAUT":
        try:
            gamification_update = record_gamification_mission(
                db,
                user_id=target_user.id,
                daily_mission_code="MIND_CHECK",
                status_mode="COMPLETED",
                reflection_note="Chequeo de bienestar completado (recompensa por participación, independiente del estado emocional).",
                is_simulated=payload.is_simulated,
            )
        except Exception:
            gamification_update = None

    recs_bundle = AssistiveGuidanceService.filter_safe_wellness_recommendations(
        db, target_user.id, op_state
    )

    return {
        "assessment": {
            "id": record.id,
            "is_draft": record.is_draft,
            "operational_wellness_state": record.operational_wellness_state,
            "request_additional_support": record.request_additional_support,
            "support_urgency": record.support_urgency,
            "created_at": ensure_aware(record.created_at).isoformat(),
            "is_simulated": record.is_simulated,
        },
        "recommendations_bundle": recs_bundle,
        "gamification_update": gamification_update,
    }


@router.get("/wellness/recommendations")
def get_wellness_recommendations(
    astronaut_id: Optional[int] = None,
    wellness_state: str = Query(default="WELLNESS_STABLE"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    verify_astronaut_access(db, user, target_id, action_name="GET_WELLNESS_RECOMMENDATIONS")
    return AssistiveGuidanceService.filter_safe_wellness_recommendations(
        db, target_id, wellness_state
    )


@router.post("/wellness/feedback")
def submit_wellness_feedback(
    payload: WellnessFeedbackCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    fb = WellnessActionFeedback(
        astronaut_id=user.id,
        recommendation_code=payload.recommendation_code,
        helpful_rating=payload.helpful_rating,
        notes=payload.notes,
        completed_at=utcnow(),
    )
    db.add(fb)
    db.commit()
    return {"message": "Actividad de bienestar registrada correctamente."}


# ============================================================================
# 8. GAMIFICATION: DAILY MISSIONS, XP, LEVELS & BADGES
# ============================================================================

@router.get("/gamification/profile")
def get_gamification_profile_endpoint(
    astronaut_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    verify_astronaut_access(db, user, target_id, action_name="GET_GAMIFICATION_PROFILE")
    profile = ensure_gamification_profile(db, target_id)
    level_info = compute_level(profile.total_xp)

    all_badges = db.query(Badge).order_by(Badge.id.asc()).all()
    earned_map = {
        ub.badge_code: ub
        for ub in db.query(UserBadge).filter(UserBadge.user_id == target_id).all()
    }
    badges_out = []
    for b in all_badges:
        ub = earned_map.get(b.code)
        badges_out.append(
            {
                "code": b.code,
                "name": b.name,
                "icon_name": b.icon_name,
                "description": b.description,
                "criteria_description": b.criteria_description,
                "earned": ub is not None,
                "awarded_reason": ub.awarded_reason if ub else None,
                "awarded_at": ensure_aware(ub.awarded_at).isoformat() if ub else None,
            }
        )

    recent_events = (
        db.query(GamificationEvent)
        .filter(GamificationEvent.user_id == target_id)
        .order_by(GamificationEvent.completed_at.desc())
        .limit(30)
        .all()
    )

    return {
        "user_id": target_id,
        "level_info": level_info,
        "active_streak_days": profile.active_streak_days,
        "routines_completed_count": profile.routines_completed_count,
        "learning_modules_completed": profile.learning_modules_completed,
        "followups_completed": profile.followups_completed,
        "preferred_reminder_window": profile.preferred_reminder_window,
        "reminders_paused_for_operations": profile.reminders_paused_for_operations,
        "ethical_gamification_policy": (
            "Las recompensas reconocen la participación, el aprendizaje y la constancia en el autocuidado. "
            "Nunca se otorgan puntos por signos vitales 'normales' ni se penaliza por reportar síntomas o restricciones de misión."
        ),
        "badges": badges_out,
        "recent_events": [
            {
                "id": ev.id,
                "daily_mission_code": ev.daily_mission_code,
                "event_date_str": ev.event_date_str,
                "status": ev.status,
                "xp_awarded": ev.xp_awarded,
                "reinforcement_message": ev.reinforcement_message,
                "reflection_note": ev.reflection_note,
                "completed_at": ensure_aware(ev.completed_at).isoformat(),
            }
            for ev in recent_events
        ],
    }


@router.get("/gamification/missions")
def list_daily_missions_endpoint(
    astronaut_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_id = astronaut_id or user.id
    verify_astronaut_access(db, user, target_id, action_name="GET_DAILY_MISSIONS")

    today_str = utcnow().strftime("%Y-%m-%d")
    today_events = {
        ev.daily_mission_code: ev
        for ev in db.query(GamificationEvent)
        .filter(
            GamificationEvent.user_id == target_id,
            GamificationEvent.event_date_str == today_str,
        )
        .all()
    }

    has_critical_alert = (
        db.query(Alert)
        .filter(
            Alert.astronaut_id == target_id,
            Alert.status.in_(["NEW", "ACKNOWLEDGED", "IN_FOLLOWUP", "ESCALATED"]),
            Alert.operational_state.in_(["WARNING", "CRITICAL"]),
        )
        .count()
        > 0
    )

    missions = db.query(DailyMission).filter(DailyMission.is_active.is_(True)).order_by(DailyMission.id.asc()).all()
    out = []
    next_recommended = None

    for m in missions:
        ev = today_events.get(m.code)
        safety_blocked = m.contraindicated_on_critical_alert and has_critical_alert
        status_today = ev.status if ev else ("PAUSED_FOR_SAFETY" if safety_blocked else "PENDING")
        if status_today == "PENDING" and next_recommended is None:
            next_recommended = m.code

        out.append(
            {
                "code": m.code,
                "title": m.title,
                "category": m.category,
                "description": m.description,
                "xp_reward": m.xp_reward,
                "educational_content": m.educational_content,
                "contraindicated_on_critical_alert": m.contraindicated_on_critical_alert,
                "safety_blocked": safety_blocked,
                "status_today": status_today,
                "completed_at": ensure_aware(ev.completed_at).isoformat() if ev else None,
            }
        )

    completed_count = sum(1 for x in out if x["status_today"] in ("COMPLETED", "EXCUSED_OPERATIONAL_RESTRICTION"))
    daily_progress_pct = round((completed_count / len(out)) * 100) if out else 0

    return {
        "date": today_str,
        "daily_progress_percent": daily_progress_pct,
        "completed_or_excused_today": completed_count,
        "total_missions": len(out),
        "next_recommended_mission_code": next_recommended,
        "missions": out,
    }


@router.post("/gamification/missions/complete")
def complete_daily_mission_endpoint(
    payload: GamificationCompleteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Bloqueo de seguridad: una contramedida contraindicada con alerta C/W activa no se puede
    # completar (solo excusar por restricción operativa), igual que muestra /gamification/missions.
    mission_def = (
        db.query(DailyMission)
        .filter(DailyMission.code == (payload.daily_mission_code or "").strip())
        .first()
    )
    if (
        mission_def
        and mission_def.contraindicated_on_critical_alert
        and (payload.status_mode or "COMPLETED").strip().upper() != "EXCUSED_OPERATIONAL_RESTRICTION"
    ):
        has_critical_alert = (
            db.query(Alert)
            .filter(
                Alert.astronaut_id == user.id,
                Alert.status.in_(["NEW", "ACKNOWLEDGED", "IN_FOLLOWUP", "ESCALATED"]),
                Alert.operational_state.in_(["WARNING", "CRITICAL"]),
            )
            .count()
            > 0
        )
        if has_critical_alert:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Contramedida en pausa por seguridad: hay una alerta de precaución o aviso activa. "
                    "Resuélvela con tu líder o regístrala como excusada por restricción operativa."
                ),
            )
    try:
        result = record_gamification_mission(
            db=db,
            user_id=user.id,
            daily_mission_code=payload.daily_mission_code,
            status_mode=payload.status_mode,
            reflection_note=payload.reflection_note,
            is_simulated=payload.is_simulated,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ============================================================================
# 9. MISSION ANALYTICS & LONGITUDINAL REPORTS
# ============================================================================

@router.get("/analytics/timeseries")
def get_analytics_timeseries(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    indicator_code: str = Query(default="HEART_RATE"),
    phase_code: Optional[str] = None,
    environment_code: Optional[str] = None,
    source_code: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(db, user, astronaut_id, mission_id)
    defn = (
        db.query(HealthIndicatorDefinition)
        .filter(HealthIndicatorDefinition.code == indicator_code)
        .first()
    )
    if not defn:
        raise HTTPException(status_code=404, detail="Indicador no encontrado.")

    query = db.query(HealthMeasurement).filter(
        HealthMeasurement.astronaut_id == target_user.id,
        HealthMeasurement.mission_id == mission.id,
        HealthMeasurement.indicator_code == indicator_code,
        HealthMeasurement.calculated_state != "INVALID",
    )
    if phase_code:
        query = query.filter(HealthMeasurement.phase_code == phase_code)
    if environment_code:
        query = query.filter(HealthMeasurement.environment_code == environment_code)
    if source_code:
        query = query.filter(HealthMeasurement.source_code == source_code)

    rows = query.order_by(HealthMeasurement.measured_at.asc()).all()
    baseline = (
        db.query(HealthBaseline)
        .filter(
            HealthBaseline.astronaut_id == target_user.id,
            HealthBaseline.indicator_code == indicator_code,
        )
        .first()
    )

    points = []
    gaps_detected = []
    prev_dt = None
    for r in rows:
        cur_dt = ensure_aware(r.measured_at)
        gap_before = False
        if prev_dt and cur_dt:
            diff_hours = (cur_dt - prev_dt).total_seconds() / 3600.0
            if diff_hours > defn.stale_after_hours * 2:
                gap_before = True
                gaps_detected.append(
                    {
                        "from": prev_dt.isoformat(),
                        "to": cur_dt.isoformat(),
                        "gap_hours": round(diff_hours, 1),
                    }
                )
                # Insert explicit null gap marker so Chart.js does not connect distant points
                points.append(
                    {
                        "measured_at": (prev_dt + timedelta(hours=1)).isoformat(),
                        "value": None,
                        "secondary_value": None,
                        "phase_code": r.phase_code,
                        "environment_code": r.environment_code,
                        "state": "GAP",
                        "is_gap_marker": True,
                    }
                )
        prev_dt = cur_dt
        points.append(
            {
                "id": r.id,
                "measured_at": cur_dt.isoformat() if cur_dt else None,
                "value": r.value,
                "secondary_value": r.secondary_value,
                "phase_code": r.phase_code,
                "environment_code": r.environment_code,
                "source_code": r.source_code,
                "state": r.calculated_state,
                "is_simulated": r.is_simulated,
                "gap_before": gap_before,
            }
        )

    return {
        "astronaut_id": target_user.id,
        "astronaut_name": target_user.full_name,
        "mission_code": mission.code,
        "indicator_code": defn.code,
        "indicator_name": defn.name,
        "unit": defn.unit,
        "baseline_value": baseline.baseline_value if baseline else None,
        "points": points,
        "temporal_gaps": gaps_detected,
        "methodology_note": (
            "Las mediciones separadas por intervalos prolongados incluyen marcadores explícitos de discontinuidad. "
            "La asociación temporal con fases o cambios ambientales no implica causalidad directa."
        ),
    }


@router.get("/analytics/phase-comparison")
def get_phase_comparison(
    astronaut_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    indicator_code: str = Query(default="HEART_RATE"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(db, user, astronaut_id, mission_id)
    defn = (
        db.query(HealthIndicatorDefinition)
        .filter(HealthIndicatorDefinition.code == indicator_code)
        .first()
    )
    if not defn:
        raise HTTPException(status_code=404, detail="Indicador no encontrado.")

    rows = (
        db.query(HealthMeasurement)
        .filter(
            HealthMeasurement.astronaut_id == target_user.id,
            HealthMeasurement.mission_id == mission.id,
            HealthMeasurement.indicator_code == indicator_code,
            HealthMeasurement.calculated_state != "INVALID",
        )
        .all()
    )

    by_phase: Dict[str, List[float]] = {}
    for r in rows:
        by_phase.setdefault(r.phase_code, []).append(r.value)

    phase_order = ["TRAINING", "LAUNCH", "ORBIT", "TRANSIT", "SURFACE", "EVA", "RETURN", "RECOVERY", "BED_REST"]
    summary = []
    for ph in phase_order:
        vals = by_phase.get(ph, [])
        if vals:
            summary.append(
                {
                    "phase_code": ph,
                    "count": len(vals),
                    "mean_value": round(sum(vals) / len(vals), 2),
                    "min_value": round(min(vals), 2),
                    "max_value": round(max(vals), 2),
                    "has_data": True,
                }
            )
        else:
            summary.append(
                {
                    "phase_code": ph,
                    "count": 0,
                    "mean_value": None,
                    "min_value": None,
                    "max_value": None,
                    "has_data": False,
                }
            )

    return {
        "astronaut_id": target_user.id,
        "mission_code": mission.code,
        "indicator_code": defn.code,
        "indicator_name": defn.name,
        "unit": defn.unit,
        "phases_comparison": summary,
    }


def _generate_simple_pdf_bytes(lines: List[str]) -> bytes:
    """
    Generates a valid, standalone PDF 1.4 binary document with standard Helvetica font.
    """
    escaped_lines = []
    for line in lines[:55]:
        safe = (
            line.encode("latin-1", errors="replace")
            .decode("latin-1")
            .replace("\\", "\\\\")
            .replace("(", "\\(")
            .replace(")", "\\)")
        )
        escaped_lines.append(safe)

    content_ops = ["BT", "/F1 10 Tf", "45 790 Td", "13 TL"]
    for idx, text_line in enumerate(escaped_lines):
        if idx == 0:
            content_ops.append(f"/F1 13 Tf ({text_line}) Tj /F1 9 Tf")
        else:
            content_ops.append(f"T* ({text_line}) Tj")
    content_ops.append("ET")
    stream_str = "\n".join(content_ops)
    stream_bytes = stream_str.encode("latin-1")

    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
        f"5 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n".encode("latin-1")
        + stream_bytes
        + b"\nendstream\nendobj\n",
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = []
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)

    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for off in offsets:
        pdf.extend(f"{off:010d} 00000 n \n".encode("latin-1"))

    pdf.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode(
            "latin-1"
        )
    )
    return bytes(pdf)


@router.post("/reports/export")
def export_mission_report(
    payload: ReportExportRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(
        db, user, payload.astronaut_id, payload.mission_id
    )
    summary = _build_astronaut_health_summary(db, target_user, mission)
    alerts = (
        db.query(Alert)
        .filter(Alert.astronaut_id == target_user.id, Alert.mission_id == mission.id)
        .order_by(Alert.created_at.desc())
        .limit(25)
        .all()
    )
    alerts = [a for a in alerts if not _early_alert_hidden(db, user, a)]

    fmt = payload.report_format.strip().upper()
    if fmt not in ("PDF", "CSV", "JSON"):
        raise HTTPException(status_code=400, detail="Formato no soportado. Use PDF, CSV o JSON.")

    now = utcnow()
    report_meta = {
        "report_title": f"SEMSA Mission Health & Context Report — {mission.code}",
        "generated_at_utc": now.isoformat(),
        "generated_by": user.email,
        "generated_by_role": user.role.code if user.role else "",
        "astronaut_crew_code": target_user.crew_code,
        "astronaut_name": target_user.full_name,
        "mission_code": mission.code,
        "mission_name": mission.name,
        "current_phase": mission.current_phase,
        "active_environment": summary["context"]["environment_code"],
        "environment_source": summary["context"]["determination_source"],
        "data_coverage_percent": summary["mission_summary"]["data_quality_coverage_percent"],
        "contains_simulated_data": True,
        "simulation_badge": "SIMULADO — Datos sintéticos de demostración",
        "clinical_disclaimer": (
            "SEMSA ayuda a observar, comprender, registrar y comunicar información sobre la salud. "
            "No diagnostica de manera autónoma ni reemplaza al personal médico."
        ),
    }

    rep_row = Report(
        generated_by_user_id=user.id,
        target_astronaut_id=target_user.id,
        mission_id=mission.id,
        report_format=fmt,
        period_start=mission.start_date,
        period_end=now,
        summary_metadata_json=json.dumps(report_meta, ensure_ascii=False),
        is_simulated=True,
        created_at=now,
    )
    db.add(rep_row)
    db.commit()
    db.refresh(rep_row)

    log_audit_event(
        db,
        action=f"EXPORT_REPORT_{fmt}",
        resource_type="REPORT",
        actor=user,
        resource_id=str(rep_row.id),
        target_user_id=target_user.id,
        justification=payload.justification,
        details=f"Informe exportado en formato {fmt} para astronauta {target_user.crew_code} en misión {mission.code}.",
    )

    if fmt == "JSON":
        full_json = {
            "report_id": rep_row.id,
            "metadata": report_meta,
            "mission_summary": summary["mission_summary"],
            "indicators": summary["indicator_cards"],
            "environmental_telemetry": summary["environmental_telemetry"],
            "alerts": [_serialize_alert(db, a) for a in alerts],
        }
        content_bytes = json.dumps(full_json, indent=2, ensure_ascii=False).encode("utf-8")
        return Response(
            content=content_bytes,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="semsa_report_{target_user.crew_code}.json"'
            },
        )

    if fmt == "CSV":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            [
                "ReportID",
                "GeneratedAtUTC",
                "AstronautCode",
                "MissionCode",
                "Environment",
                "IndicatorCode",
                "IndicatorName",
                "LatestValue",
                "Unit",
                "State",
                "Source",
                "DataQuality",
                "SimulatedLabel",
            ]
        )
        for c in summary["indicator_cards"]:
            writer.writerow(
                [
                    rep_row.id,
                    now.isoformat(),
                    target_user.crew_code,
                    mission.code,
                    summary["context"]["environment_code"],
                    c["indicator_code"],
                    c["name"],
                    c["display_value"],
                    c["unit"],
                    c["state"],
                    c["source_code"],
                    c["data_quality"],
                    "SIMULADO" if c["is_simulated"] else "VALIDATED",
                ]
            )
        return Response(
            content=buf.getvalue().encode("utf-8"),
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="semsa_report_{target_user.crew_code}.csv"'
            },
        )

    # PDF Format
    pdf_lines = [
        f"SEMSA MISSION HEALTH & CONTEXT REPORT [SIMULADO] (ID #{rep_row.id})",
        f"Generado (UTC): {now.strftime('%Y-%m-%d %H:%M:%S UTC')} | Solicitado por: {user.email} ({user.role.code})",
        f"Tripulante: {target_user.full_name} ({target_user.crew_code}) | Mision: {mission.name} ({mission.code})",
        f"Fase Actual: {mission.current_phase} | Entorno: {summary['context']['environment_code']} (Fuente: {summary['context']['determination_source']})",
        f"Cobertura Temporal de Datos: {summary['mission_summary']['data_quality_coverage_percent']}% | Alertas Activas: {summary['mission_summary']['active_alerts_count']}",
        "----------------------------------------------------------------------------------------",
        "AVISO OPERATIVO: Datos etiquetados como SIMULADO. SEMSA no realiza diagnosticos medicos autonomos.",
        "----------------------------------------------------------------------------------------",
        "RESUMEN DE INDICADORES FISIOLOGICOS Y DE BIENESTAR:",
    ]
    for c in summary["indicator_cards"]:
        sim_tag = "SIMULADO" if c["is_simulated"] else "REAL"
        pdf_lines.append(
            f" - {c['name']} ({c['indicator_code']}): {c['display_value']} {c['unit']} | Estado: {c['state']} | Fuente: {c['source_code']} [{sim_tag}]"
        )
    pdf_lines.append("----------------------------------------------------------------------------------------")
    pdf_lines.append("ALERTAS Y SEGUIMIENTO REGISTRADO:")
    if not alerts:
        pdf_lines.append(" - Sin alertas registradas en el periodo.")
    for a in alerts[:12]:
        pdf_lines.append(
            f" - [{a.priority}/{a.status}] {a.title} (Regla: {a.rule_code} v{a.rule_version_label})"
        )

    pdf_bytes = _generate_simple_pdf_bytes(pdf_lines)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="semsa_report_{target_user.crew_code}.pdf"'
        },
    )


# ============================================================================
# 10. TELEMETRY SIMULATOR & DEMO SCENARIOS
# ============================================================================

@router.get("/simulator/scenarios")
def list_simulator_scenarios(user: User = Depends(get_current_user)):
    return {
        "enabled": settings.ENABLE_DEMO_SIMULATOR,
        "simulation_badge": "SIMULADO",
        "scenarios": DEMO_SCENARIOS,
    }


@router.post("/simulator/run")
def run_simulator_scenario(
    payload: SimulatorRunRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user, mission = _resolve_target_astronaut_and_mission(
        db, user, payload.astronaut_id, payload.mission_id
    )
    try:
        result = execute_demo_scenario(
            db=db,
            scenario_code=payload.scenario_code,
            astronaut_id=target_user.id,
            mission_id=mission.id,
            environment_code=payload.environment_code,
            actor_user=user,
        )
        log_audit_event(
            db,
            action="RUN_DEMO_SCENARIO",
            resource_type="SIMULATOR",
            actor=user,
            resource_id=payload.scenario_code,
            target_user_id=target_user.id,
            details=f"Escenario DEMO '{payload.scenario_code}' ejecutado (SIMULADO).",
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/simulator/reset")
def reset_simulator_data(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stats = reset_simulated_demo_data(db)
    log_audit_event(
        db,
        action="RESET_SIMULATED_DEMO_DATA",
        resource_type="SIMULATOR",
        actor=user,
        details=f"Escenario sintético DEMO reiniciado de forma segura: {stats}",
    )
    return {
        "message": "Datos sintéticos de demostración reiniciados de forma segura (los datos reales se conservan intactos).",
        "stats": stats,
    }


# ============================================================================
# 11. ADMINISTRATION, RULES VERSIONING & AUDIT LOGS
# ============================================================================

@router.get("/admin/rules")
def list_clinical_rules(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rules = db.query(ClinicalRule).order_by(ClinicalRule.id.asc()).all()
    out = []
    for r in rules:
        versions = [
            {
                "id": v.id,
                "version_number": v.version_number,
                "protocol_source": v.protocol_source,
                "approved_by": v.approved_by,
                "approval_date": ensure_aware(v.approval_date).isoformat() if v.approval_date else None,
                "normal_min": v.normal_min,
                "normal_max": v.normal_max,
                "monitor_min": v.monitor_min,
                "monitor_max": v.monitor_max,
                "warning_min": v.warning_min,
                "warning_max": v.warning_max,
                "baseline_delta_threshold": v.baseline_delta_threshold,
                "immediate_instructions": v.immediate_instructions,
                "followup_instructions": v.followup_instructions,
                "escalation_conditions": v.escalation_conditions,
                "change_reason": v.change_reason,
                "is_current": v.is_current,
            }
            for v in sorted(r.versions, key=lambda x: x.id, reverse=True)
        ]
        out.append(
            {
                "id": r.id,
                "rule_code": r.rule_code,
                "indicator_code": r.indicator_code,
                "name": r.name,
                "applicable_context": r.applicable_context,
                "current_version_number": r.current_version_number,
                "is_active": r.is_active,
                "is_demo_rule": r.is_demo_rule,
                "versions": versions,
            }
        )
    return {"rules": out}


@router.post("/admin/rules/{rule_id}/versions", status_code=status.HTTP_201_CREATED)
def create_new_rule_version(
    rule_id: int,
    payload: RuleVersionCreateRequest,
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    rule = db.query(ClinicalRule).filter(ClinicalRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Regla no encontrada.")

    for old_v in rule.versions:
        old_v.is_current = False

    new_v = ClinicalRuleVersion(
        rule_id=rule.id,
        version_number=payload.version_number.strip(),
        protocol_source=payload.protocol_source.strip(),
        approved_by=payload.approved_by.strip(),
        approval_date=utcnow(),
        normal_min=payload.normal_min,
        normal_max=payload.normal_max,
        monitor_min=payload.monitor_min,
        monitor_max=payload.monitor_max,
        warning_min=payload.warning_min,
        warning_max=payload.warning_max,
        baseline_delta_threshold=payload.baseline_delta_threshold,
        immediate_instructions=payload.immediate_instructions.strip(),
        followup_instructions=payload.followup_instructions.strip(),
        escalation_conditions=payload.escalation_conditions.strip(),
        change_reason=payload.change_reason.strip(),
        is_current=True,
    )
    rule.current_version_number = new_v.version_number
    db.add(new_v)
    db.commit()
    db.refresh(new_v)

    log_audit_event(
        db,
        action="CREATE_RULE_VERSION",
        resource_type="CLINICAL_RULE",
        actor=admin_user,
        resource_id=f"{rule.rule_code}:{new_v.version_number}",
        justification=payload.change_reason,
        details=(
            f"Nueva versión auditada {new_v.version_number} para {rule.rule_code} "
            f"aprobada por '{new_v.approved_by}'."
        ),
    )
    return {"rule_code": rule.rule_code, "version_number": new_v.version_number}


@router.get("/admin/system-status")
def get_system_status(
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    return {
        "app_name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.APP_ENV,
        "database_status": "ONLINE",
        "rules_engine_status": "OPERATIONAL_DETERMINISTIC",
        "context_resolver_status": "OPERATIONAL",
        "simulator_status": "ENABLED_DEMO" if settings.ENABLE_DEMO_SIMULATOR else "DISABLED",
        "counts": {
            "users": db.query(User).count(),
            "missions": db.query(Mission).count(),
            "health_measurements": db.query(HealthMeasurement).count(),
            "active_alerts": db.query(Alert).filter(Alert.status != "RESOLVED").count(),
            "audit_events": db.query(AuditEvent).count(),
            "data_quality_events": db.query(DataQualityEvent).count(),
        },
        "checked_at": utcnow().isoformat(),
    }


@router.get("/audit/events")
def list_audit_events(
    limit: int = Query(default=100, ge=1, le=300),
    admin_user: User = Depends(require_roles(["ADMINISTRATOR"])),
    db: Session = Depends(get_db),
):
    events = db.query(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit).all()
    return {
        "audit_events": [
            {
                "id": ev.id,
                "actor_user_id": ev.actor_user_id,
                "actor_email": ev.actor_email,
                "actor_role": ev.actor_role,
                "action": ev.action,
                "resource_type": ev.resource_type,
                "resource_id": ev.resource_id,
                "target_user_id": ev.target_user_id,
                "justification": ev.justification,
                "ip_address": ev.ip_address,
                "status": ev.status,
                "details": ev.details,
                "created_at": ensure_aware(ev.created_at).isoformat(),
            }
            for ev in events
        ]
    }


router.include_router(expansion_router)



# Módulo de aislamiento y confinamiento (docs/CONTRATO_AISLAMIENTO.md)
from backend.app.api.v1.isolation_router import isolation_router  # noqa: E402

router.include_router(isolation_router)
