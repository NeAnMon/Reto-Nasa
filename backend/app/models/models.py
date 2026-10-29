from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship
from backend.app.database.session import Base


def utcnow():
    return datetime.now(timezone.utc)


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)  # ASTRONAUT, MISSION_LEADER, ADMINISTRATOR
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)

    permissions = relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")
    users = relationship("User", back_populates="role")


class Permission(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(100), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)

    roles = relationship("RolePermission", back_populates="permission", cascade="all, delete-orphan")


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),)

    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False)
    permission_id = Column(Integer, ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False)

    role = relationship("Role", back_populates="permissions")
    permission = relationship("Permission", back_populates="roles")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    crew_code = Column(String(40), unique=True, nullable=False, index=True)
    email = Column(String(150), unique=True, nullable=False, index=True)
    full_name = Column(String(150), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    status = Column(String(30), default="ACTIVE", nullable=False)  # ACTIVE, SUSPENDED, INACTIVE
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    recovery_token = Column(String(128), nullable=True)
    recovery_expires_at = Column(DateTime(timezone=True), nullable=True)
    preferred_theme = Column(String(30), default="space-dark", nullable=False)
    share_wellness_signals_with_leader = Column(Boolean, default=True, nullable=False)
    share_detailed_wellness_with_medical = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    role = relationship("Role", back_populates="users")
    astronaut_profile = relationship("AstronautProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan")
    assignments = relationship("MissionAssignment", back_populates="user", cascade="all, delete-orphan")
    gamification_profile = relationship("GamificationProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(128), unique=True, nullable=False, index=True)
    csrf_token = Column(String(128), nullable=False)
    user_agent = Column(String(255), nullable=True)
    ip_address = Column(String(64), nullable=True)
    is_revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    user = relationship("User", back_populates="sessions")


class AstronautProfile(Base):
    __tablename__ = "astronaut_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    callsign = Column(String(50), nullable=False)
    specialty = Column(String(120), nullable=False)
    agency_label = Column(String(100), default="Fictional Space Crew Initiative", nullable=False)
    eva_certified = Column(Boolean, default=True, nullable=False)
    authorized_restrictions_json = Column(Text, default="[]", nullable=False)
    quiet_hours_window = Column(String(50), default="22:00-06:00 UTC", nullable=False)
    notes = Column(Text, nullable=True)

    user = relationship("User", back_populates="astronaut_profile")


class EnvironmentProfile(Base):
    __tablename__ = "environment_profiles"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    gravity_g = Column(Float, nullable=True)
    gravity_label = Column(String(60), nullable=False)
    radiation_hazard_level = Column(String(40), nullable=False)
    isolation_level = Column(String(40), nullable=False)
    distance_from_earth_label = Column(String(80), nullable=False)
    comms_delay_seconds = Column(Float, default=0.0, nullable=False)
    enclosed_environment_type = Column(String(80), nullable=False)
    description = Column(Text, nullable=False)
    key_physiological_risks = Column(Text, nullable=False)
    preventive_focus = Column(Text, nullable=False)


class Mission(Base):
    __tablename__ = "missions"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=False)
    vehicle_or_habitat = Column(String(120), nullable=False)
    start_date = Column(DateTime(timezone=True), nullable=True)
    planned_end_date = Column(DateTime(timezone=True), nullable=True)
    planned_duration_days = Column(Integer, nullable=True)
    current_phase = Column(String(60), nullable=False)  # TRAINING, LAUNCH, ORBIT, TRANSIT, SURFACE, EVA, RETURN, RECOVERY
    status = Column(String(40), default="ACTIVE", nullable=False)
    allow_leader_routine_tracking = Column(Boolean, default=True, nullable=False)
    is_simulated = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    assignments = relationship("MissionAssignment", back_populates="mission", cascade="all, delete-orphan")
    phases = relationship("MissionPhase", back_populates="mission", cascade="all, delete-orphan")
    contexts = relationship("MissionContext", back_populates="mission", cascade="all, delete-orphan")


class MissionAssignment(Base):
    __tablename__ = "mission_assignments"
    __table_args__ = (UniqueConstraint("mission_id", "user_id", name="uq_mission_user"),)

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    assignment_role = Column(String(60), nullable=False)  # ASTRONAUT, MISSION_LEADER
    assigned_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    mission = relationship("Mission", back_populates="assignments")
    user = relationship("User", back_populates="assignments")


class MissionPhase(Base):
    __tablename__ = "mission_phases"

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    phase_code = Column(String(60), nullable=False)
    name = Column(String(120), nullable=False)
    sequence_order = Column(Integer, nullable=False)
    start_date = Column(DateTime(timezone=True), nullable=True)
    end_date = Column(DateTime(timezone=True), nullable=True)
    environment_code = Column(String(60), nullable=False)
    is_current = Column(Boolean, default=False, nullable=False)
    description = Column(Text, nullable=True)

    mission = relationship("Mission", back_populates="phases")


class MissionContext(Base):
    __tablename__ = "mission_contexts"

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    environment_code = Column(String(60), ForeignKey("environment_profiles.code"), nullable=False)
    phase_code = Column(String(60), nullable=False)
    location_module = Column(String(120), nullable=False)
    determination_source = Column(String(80), nullable=False)  # VERIFIED_TELEMETRY, MISSION_ID, MANUAL_CONFIRMATION, IMPORTED_ENV, DEMO_SIMULATION
    confidence = Column(String(40), default="HIGH", nullable=False)  # HIGH, MEDIUM, UNCONFIRMED
    connectivity_status = Column(String(40), default="ONLINE", nullable=False)  # ONLINE, DELAYED, OFFLINE
    conflict_notes = Column(Text, nullable=True)
    confirmed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    recorded_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_simulated = Column(Boolean, default=True, nullable=False)

    mission = relationship("Mission", back_populates="contexts")


class DataSource(Base):
    __tablename__ = "data_sources"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    source_type = Column(String(50), nullable=False)  # MANUAL, CSV_JSON_IMPORT, DEMO_SIMULATION, EXTERNAL_ADAPTER_STUB
    is_verified_hardware = Column(Boolean, default=False, nullable=False)
    status = Column(String(40), default="AVAILABLE", nullable=False)  # AVAILABLE, OFFLINE, SIMULATED
    description = Column(Text, nullable=True)


class SensorRegistry(Base):
    __tablename__ = "sensor_registry"

    id = Column(Integer, primary_key=True, index=True)
    sensor_code = Column(String(60), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="SET NULL"), nullable=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    indicator_codes_csv = Column(String(255), nullable=False)
    status = Column(String(40), default="SIMULATED_ONLINE", nullable=False)  # SIMULATED_ONLINE, OFFLINE, UNCALIBRATED
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    is_simulated = Column(Boolean, default=True, nullable=False)


class HealthIndicatorDefinition(Base):
    __tablename__ = "health_indicator_definitions"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    category = Column(String(60), nullable=False)  # CARDIOVASCULAR, RESPIRATORY, METABOLIC, SLEEP_FATIGUE, ACTIVITY, HYDRATION, WELLNESS, ENVIRONMENTAL
    body_region_code = Column(String(60), nullable=False, index=True)
    unit = Column(String(40), nullable=False)
    min_valid_value = Column(Float, nullable=False)
    max_valid_value = Column(Float, nullable=False)
    stale_after_hours = Column(Integer, default=48, nullable=False)
    requires_device = Column(Boolean, default=False, nullable=False)
    device_note = Column(String(255), nullable=True)
    step_by_step_instructions = Column(Text, nullable=False)
    educational_summary = Column(Text, nullable=False)
    spaceflight_risk_explanation = Column(Text, nullable=False)
    supported_environments_csv = Column(Text, default="ALL", nullable=False)


class HealthBaseline(Base):
    __tablename__ = "health_baselines"
    __table_args__ = (UniqueConstraint("astronaut_id", "indicator_code", name="uq_astronaut_indicator_baseline"),)

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    indicator_code = Column(String(60), ForeignKey("health_indicator_definitions.code"), nullable=False)
    baseline_value = Column(Float, nullable=False)
    baseline_secondary_value = Column(Float, nullable=True)
    std_dev = Column(Float, default=5.0, nullable=False)
    established_phase = Column(String(60), default="PRE_MISSION_BASELINE", nullable=False)
    is_simulated = Column(Boolean, default=True, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class ClinicalRule(Base):
    __tablename__ = "clinical_rules"

    id = Column(Integer, primary_key=True, index=True)
    rule_code = Column(String(80), unique=True, nullable=False, index=True)
    indicator_code = Column(String(60), ForeignKey("health_indicator_definitions.code"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    applicable_context = Column(String(80), default="ALL_ENVIRONMENTS", nullable=False)
    current_version_number = Column(String(30), default="1.0-DEMO", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_demo_rule = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    versions = relationship("ClinicalRuleVersion", back_populates="rule", cascade="all, delete-orphan")


class ClinicalRuleVersion(Base):
    __tablename__ = "clinical_rule_versions"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("clinical_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(String(30), nullable=False)
    protocol_source = Column(String(180), default="DEMO Educational Protocol (Non-Clinical)", nullable=False)
    approved_by = Column(String(120), default="Demo Flight Medicine Review Board (SIMULATED)", nullable=False)
    approval_date = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    review_due_date = Column(DateTime(timezone=True), nullable=True)
    normal_min = Column(Float, nullable=False)
    normal_max = Column(Float, nullable=False)
    monitor_min = Column(Float, nullable=False)
    monitor_max = Column(Float, nullable=False)
    warning_min = Column(Float, nullable=False)
    warning_max = Column(Float, nullable=False)
    baseline_delta_threshold = Column(Float, nullable=True)
    priority_on_warning = Column(String(30), default="MEDIUM", nullable=False)
    priority_on_critical = Column(String(30), default="CRITICAL", nullable=False)
    immediate_instructions = Column(Text, nullable=False)
    followup_instructions = Column(Text, nullable=False)
    escalation_conditions = Column(Text, nullable=False)
    change_reason = Column(Text, nullable=True)
    is_current = Column(Boolean, default=True, nullable=False)

    rule = relationship("ClinicalRule", back_populates="versions")


class HealthMeasurement(Base):
    __tablename__ = "health_measurements"
    __table_args__ = (
        Index("ix_health_meas_user_ind_time", "astronaut_id", "indicator_code", "measured_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    dedup_key = Column(String(120), unique=True, nullable=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    indicator_code = Column(String(60), ForeignKey("health_indicator_definitions.code"), nullable=False, index=True)
    value = Column(Float, nullable=False)
    secondary_value = Column(Float, nullable=True)  # e.g., diastolic blood pressure or sleep quality score
    unit = Column(String(40), nullable=False)
    measured_at = Column(DateTime(timezone=True), nullable=False, index=True)
    received_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    phase_code = Column(String(60), default="ORBIT", nullable=False)
    environment_code = Column(String(60), default="LOW_EARTH_ORBIT", nullable=False)
    source_code = Column(String(60), default="MANUAL_ENTRY", nullable=False)
    data_quality = Column(String(40), default="VALIDATED", nullable=False)  # VALIDATED, PENDING_CONFIRMATION, INVALID, SYNTHETIC_DEMO
    calculated_state = Column(String(40), nullable=False)  # NORMAL, MONITOR, WARNING, CRITICAL, UNKNOWN, STALE, INVALID
    rule_version_id = Column(Integer, ForeignKey("clinical_rule_versions.id"), nullable=True)
    is_simulated = Column(Boolean, default=True, nullable=False)
    notes = Column(Text, nullable=True)


class EnvironmentalMeasurement(Base):
    __tablename__ = "environmental_measurements"

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    environment_code = Column(String(60), ForeignKey("environment_profiles.code"), nullable=False)
    phase_code = Column(String(60), nullable=False)
    parameter_code = Column(String(60), nullable=False, index=True)  # CABIN_TEMP, HUMIDITY, CABIN_PRESSURE, PPO2, CO2_LEVEL, RADIATION_DOSE, AIR_QUALITY, PARTICULATES, LIGHTING_LUX, NOISE_DB, VENTILATION_STATE, ECLSS_STATE, SUIT_STATE
    parameter_name = Column(String(120), nullable=False)
    value = Column(Float, nullable=True)
    text_state = Column(String(80), nullable=True)
    unit = Column(String(40), nullable=False)
    source_code = Column(String(60), nullable=False)
    data_quality = Column(String(40), default="SYNTHETIC_DEMO", nullable=False)
    availability_status = Column(String(40), default="AVAILABLE", nullable=False)  # AVAILABLE, OFFLINE, NOT_APPLICABLE
    calculated_state = Column(String(40), default="NORMAL", nullable=False)
    measured_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    is_simulated = Column(Boolean, default=True, nullable=False)


class DataQualityEvent(Base):
    __tablename__ = "data_quality_events"

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=True)
    indicator_code = Column(String(60), nullable=True)
    event_type = Column(String(60), nullable=False)  # OUT_OF_BOUNDS, SENSOR_OFFLINE, SOURCE_CONFLICT, DUPLICATE_REJECTED, STALE_DATA
    severity = Column(String(30), default="INFO", nullable=False)
    details = Column(Text, nullable=False)
    recorded_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    indicator_code = Column(String(60), nullable=False, index=True)
    measurement_id = Column(Integer, ForeignKey("health_measurements.id", ondelete="SET NULL"), nullable=True)
    rule_version_id = Column(Integer, ForeignKey("clinical_rule_versions.id", ondelete="SET NULL"), nullable=True)
    rule_code = Column(String(80), nullable=False)
    rule_version_label = Column(String(40), nullable=False)
    value_recorded = Column(String(80), nullable=True)
    unit = Column(String(40), nullable=True)
    priority = Column(String(30), nullable=False)  # LOW, MEDIUM, HIGH, CRITICAL
    operational_state = Column(String(40), nullable=False)  # MONITOR, WARNING, CRITICAL
    status = Column(String(40), default="NEW", nullable=False)  # NEW, ACKNOWLEDGED, IN_FOLLOWUP, RESOLVED, ESCALATED
    title = Column(String(200), nullable=False)
    explanation = Column(Text, nullable=False)
    data_quality = Column(String(40), default="SYNTHETIC_DEMO", nullable=False)
    immediate_action = Column(Text, nullable=False)
    followup_recommendation = Column(Text, nullable=False)
    environment_code = Column(String(60), nullable=True)
    phase_code = Column(String(60), nullable=True)
    is_simulated = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    acknowledgements = relationship("AlertAcknowledgement", back_populates="alert", cascade="all, delete-orphan")
    followups = relationship("FollowUpAction", back_populates="alert", cascade="all, delete-orphan")


class AlertAcknowledgement(Base):
    __tablename__ = "alert_acknowledgements"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_at_time = Column(String(50), nullable=False)
    action_taken = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    alert = relationship("Alert", back_populates="acknowledgements")


class FollowUpAction(Base):
    __tablename__ = "follow_up_actions"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False, index=True)
    author_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    author_role = Column(String(50), nullable=False)
    action_type = Column(String(50), nullable=False)  # FOLLOW_UP_NOTE, RECHECK_COMPLETED, ESCALATED_TO_FLIGHT_SURGEON, RESOLVED
    notes = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    alert = relationship("Alert", back_populates="followups")


class WellnessInstrument(Base):
    __tablename__ = "wellness_instruments"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    title = Column(String(150), nullable=False)
    version = Column(String(30), default="1.0-DEMO", nullable=False)
    is_clinically_validated = Column(Boolean, default=False, nullable=False)
    disclaimer = Column(Text, nullable=False)
    dimensions_json = Column(Text, nullable=False)


class PsychologicalWellnessAssessment(Base):
    __tablename__ = "psychological_wellness_assessments"

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    instrument_code = Column(String(60), ForeignKey("wellness_instruments.code"), nullable=False)
    is_draft = Column(Boolean, default=False, nullable=False)
    mood_score = Column(Integer, nullable=True)  # 1-10
    stress_score = Column(Integer, nullable=True)  # 1-10
    sleep_quality_score = Column(Integer, nullable=True)  # 1-10
    sleep_hours = Column(Float, nullable=True)
    fatigue_score = Column(Integer, nullable=True)  # 1-10
    concentration_score = Column(Integer, nullable=True)  # 1-10
    isolation_score = Column(Integer, nullable=True)  # 1-10
    adaptation_score = Column(Integer, nullable=True)  # 1-10
    social_support_score = Column(Integer, nullable=True)  # 1-10
    recovery_score = Column(Integer, nullable=True)  # 1-10
    request_additional_support = Column(Boolean, default=False, nullable=False)
    support_urgency = Column(String(40), default="NONE", nullable=False)  # NONE, ROUTINE_COUNSELING, PRIORITY_REVIEW, URGENT_SUPPORT
    private_reflection = Column(Text, nullable=True)
    share_operational_signal_with_leader = Column(Boolean, default=True, nullable=False)
    operational_wellness_state = Column(String(60), nullable=False)  # WELLNESS_STABLE, WELLNESS_MONITORING, SUPPORT_RECOMMENDED, PROFESSIONAL_REVIEW, URGENT_SUPPORT, ASSESSMENT_INCOMPLETE, ASSESSMENT_UNAVAILABLE
    phase_code = Column(String(60), default="ORBIT", nullable=False)
    environment_code = Column(String(60), default="LOW_EARTH_ORBIT", nullable=False)
    is_simulated = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class WellnessRecommendation(Base):
    __tablename__ = "wellness_recommendations"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    title = Column(String(150), nullable=False)
    category = Column(String(60), nullable=False)  # BREATHING, RECOVERY_BREAK, SLEEP_HYGIENE, RECREATION, SOCIAL_CONTACT, AUTHORIZED_EXERCISE, COPING_RESOURCE, PROFESSIONAL_CONTACT, URGENT_PROTOCOL
    applicable_states_csv = Column(String(255), nullable=False)
    duration_minutes = Column(Integer, default=10, nullable=False)
    requires_medical_clearance_if_alert = Column(Boolean, default=False, nullable=False)
    instructions = Column(Text, nullable=False)
    educational_rationale = Column(Text, nullable=False)


class WellnessActionFeedback(Base):
    __tablename__ = "wellness_action_feedbacks"

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    recommendation_code = Column(String(60), ForeignKey("wellness_recommendations.code"), nullable=False)
    helpful_rating = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    completed_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class DailyMission(Base):
    __tablename__ = "daily_missions"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    title = Column(String(120), nullable=False)
    category = Column(String(60), nullable=False)  # SELF_CARE, MEASUREMENT, LEARNING, FOLLOW_UP, WELLNESS, ENVIRONMENT
    description = Column(Text, nullable=False)
    xp_reward = Column(Integer, nullable=False)
    compatible_environments_csv = Column(Text, default="ALL", nullable=False)
    contraindicated_on_critical_alert = Column(Boolean, default=False, nullable=False)
    educational_content = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)


class GamificationProfile(Base):
    __tablename__ = "gamification_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    total_xp = Column(Integer, default=0, nullable=False)
    current_level = Column(String(60), default="Cadet", nullable=False)
    active_streak_days = Column(Integer, default=1, nullable=False)
    routines_completed_count = Column(Integer, default=0, nullable=False)
    learning_modules_completed = Column(Integer, default=0, nullable=False)
    followups_completed = Column(Integer, default=0, nullable=False)
    preferred_reminder_window = Column(String(80), default="08:00 & 19:00 UTC (Muted during EVA/Critical)", nullable=False)
    reminders_paused_for_operations = Column(Boolean, default=False, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("User", back_populates="gamification_profile")


class GamificationEvent(Base):
    __tablename__ = "gamification_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    daily_mission_code = Column(String(60), ForeignKey("daily_missions.code"), nullable=False)
    event_date_str = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    status = Column(String(40), default="COMPLETED", nullable=False)  # COMPLETED, EXCUSED_OPERATIONAL_RESTRICTION
    xp_awarded = Column(Integer, default=0, nullable=False)
    reinforcement_message = Column(String(255), nullable=False)
    reflection_note = Column(Text, nullable=True)
    is_simulated = Column(Boolean, default=True, nullable=False)
    completed_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class Badge(Base):
    __tablename__ = "badges"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    icon_name = Column(String(60), nullable=False)
    description = Column(Text, nullable=False)
    criteria_description = Column(Text, nullable=False)


class UserBadge(Base):
    __tablename__ = "user_badges"
    __table_args__ = (UniqueConstraint("user_id", "badge_code", name="uq_user_badge"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    badge_code = Column(String(60), ForeignKey("badges.code"), nullable=False)
    awarded_reason = Column(String(255), nullable=False)
    awarded_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    generated_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False)
    report_format = Column(String(20), nullable=False)  # PDF, CSV, JSON
    period_start = Column(DateTime(timezone=True), nullable=True)
    period_end = Column(DateTime(timezone=True), nullable=True)
    summary_metadata_json = Column(Text, nullable=False)
    is_simulated = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(Integer, primary_key=True, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_email = Column(String(150), nullable=True)
    actor_role = Column(String(50), nullable=True)
    action = Column(String(100), nullable=False, index=True)
    resource_type = Column(String(80), nullable=False)
    resource_id = Column(String(80), nullable=True)
    target_user_id = Column(Integer, nullable=True, index=True)
    justification = Column(Text, nullable=True)
    ip_address = Column(String(64), nullable=True)
    status = Column(String(40), default="SUCCESS", nullable=False)  # SUCCESS, DENIED, ERROR
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)

