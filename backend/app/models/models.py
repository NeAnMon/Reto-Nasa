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


# ============================================================================
# MODULE 1: COMMUNICATION CENTER MODELS
# ============================================================================

class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    leader_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subject = Column(String(200), nullable=False)
    status = Column(String(40), default="OPEN", nullable=False)  # OPEN,PENDING_FOLLOWUP,ARCHIVED
    is_highlighted = Column(Boolean, default=False, nullable=False)
    linked_alert_id = Column(Integer, ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True)
    last_message_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    is_simulated = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    participants = relationship("ConversationParticipant", back_populates="conversation", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")


class ConversationParticipant(Base):
    __tablename__ = "conversation_participants"
    __table_args__ = (UniqueConstraint("conversation_id", "user_id", name="uq_conv_participant"),)

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role_in_conversation = Column(String(50), nullable=False)  # ASTRONAUT, MISSION_LEADER
    last_seen_at = Column(DateTime(timezone=True), default=utcnow, nullable=True)
    joined_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    conversation = relationship("Conversation", back_populates="participants")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    dedup_key = Column(String(120), unique=True, nullable=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    category = Column(String(60), default="GENERAL", nullable=False, index=True)
    # Categories: GENERAL, HEALTH_UPDATE, COGNITIVE_SUPPORT, EMOTIONAL_SUPPORT,
    # MISSION_COORDINATION, TECHNICAL_ISSUE, REQUEST_FOR_ASSISTANCE, URGENT_COMMUNICATION
    delivery_status = Column(String(40), default="DELIVERED", nullable=False)  # SENT, DELIVERED, READ
    is_important = Column(Boolean, default=False, nullable=False)
    marked_unread_by_recipient = Column(Boolean, default=False, nullable=False)
    reply_to_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    linked_alert_id = Column(Integer, ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True)
    has_attachment = Column(Boolean, default=False, nullable=False)
    sync_metadata_json = Column(Text, default="{}", nullable=False)
    is_simulated = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    sent_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    conversation = relationship("Conversation", back_populates="messages")
    attachments = relationship("MessageAttachment", back_populates="message", cascade="all, delete-orphan")
    read_receipts = relationship("MessageReadReceipt", back_populates="message", cascade="all, delete-orphan")


class MessageAttachment(Base):
    __tablename__ = "message_attachments"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name = Column(String(180), nullable=False)
    mime_type = Column(String(80), default="text/plain", nullable=False)
    file_size_bytes = Column(Integer, default=0, nullable=False)
    safe_summary_note = Column(String(255), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    message = relationship("Message", back_populates="attachments")


class MessageReadReceipt(Base):
    __tablename__ = "message_read_receipts"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_message_reader"),)

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    read_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    message = relationship("Message", back_populates="read_receipts")


class MessageNotification(Base):
    __tablename__ = "message_notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    message_id = Column(Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=True)
    title = Column(String(180), nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class SupportRequest(Base):
    __tablename__ = "support_requests"

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    leader_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    category = Column(String(60), default="REQUEST_FOR_ASSISTANCE", nullable=False)
    reason_title = Column(String(180), nullable=False)
    description = Column(Text, nullable=False)
    wants_private_conversation = Column(Boolean, default=True, nullable=False)
    is_emergency = Column(Boolean, default=False, nullable=False)
    status = Column(String(40), default="REQUESTED", nullable=False)
    # States: REQUESTED, RECEIVED, IN_REVIEW, RESPONDED, ESCALATED, CLOSED
    leader_response_notes = Column(Text, nullable=True)
    emergency_protocol_displayed = Column(Boolean, default=False, nullable=False)
    is_simulated = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class ConversationAuditEvent(Base):
    __tablename__ = "conversation_audit_events"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_role = Column(String(50), nullable=True)
    action = Column(String(100), nullable=False)
    justification = Column(Text, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


# ============================================================================
# MODULE 2: COGNITIVE ASSESSMENT CENTER MODELS
# ============================================================================

class CognitiveDomain(Base):
    __tablename__ = "cognitive_domains"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    # VISUAL_LEARNING, MEMORY, ATTENTION, ABSTRACTION, SPATIAL_ORIENTATION,
    # EMOTION_RECOGNITION, ABSTRACT_REASONING, COMPLEX_EXPLORATION, VISUAL_TRACKING
    name = Column(String(120), nullable=False)
    objective = Column(Text, nullable=False)
    scientific_disclaimer = Column(Text, nullable=False)
    badge_code = Column(String(60), nullable=True)


class CognitiveTest(Base):
    __tablename__ = "cognitive_tests"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    domain_code = Column(String(60), ForeignKey("cognitive_domains.code"), nullable=False, index=True)
    title = Column(String(150), nullable=False)
    instructions = Column(Text, nullable=False)
    practice_example_json = Column(Text, nullable=False)
    estimated_duration_seconds = Column(Integer, default=60, nullable=False)
    current_version = Column(String(30), default="1.0-DEMO", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    versions = relationship("CognitiveTestVersion", back_populates="test", cascade="all, delete-orphan")


class CognitiveTestVersion(Base):
    __tablename__ = "cognitive_test_versions"

    id = Column(Integer, primary_key=True, index=True)
    test_id = Column(Integer, ForeignKey("cognitive_tests.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(String(30), nullable=False)
    supported_difficulties_csv = Column(String(120), default="BASIC,INTERMEDIATE,ADVANCED", nullable=False)
    tasks_payload_json = Column(Text, nullable=False)
    educational_feedback = Column(Text, nullable=False)
    is_current = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    test = relationship("CognitiveTest", back_populates="versions")


class CognitiveSchedule(Base):
    __tablename__ = "cognitive_schedules"

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False)
    domain_code = Column(String(60), ForeignKey("cognitive_domains.code"), nullable=False)
    test_code = Column(String(60), ForeignKey("cognitive_tests.code"), nullable=False)
    difficulty = Column(String(30), default="INTERMEDIATE", nullable=False)
    scheduled_for = Column(DateTime(timezone=True), nullable=False)
    assigned_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(40), default="PENDING", nullable=False)  # PENDING, COMPLETED, POSTPONED, OVERDUE
    postpone_reason = Column(Text, nullable=True)
    is_simulated = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class CognitiveAssessment(Base):
    __tablename__ = "cognitive_assessments"

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    domain_code = Column(String(60), ForeignKey("cognitive_domains.code"), nullable=False, index=True)
    test_code = Column(String(60), ForeignKey("cognitive_tests.code"), nullable=False, index=True)
    version_number = Column(String(30), default="1.0-DEMO", nullable=False)
    difficulty = Column(String(30), default="INTERMEDIATE", nullable=False)  # BASIC, INTERMEDIATE, ADVANCED
    phase_code = Column(String(60), default="SURFACE", nullable=False)
    environment_code = Column(String(60), default="LUNAR_SURFACE", nullable=False)
    readiness_status = Column(String(60), default="READY", nullable=False)  # READY, FATIGUED, POST_EVA, POSTPONED
    conditions_notes = Column(Text, nullable=True)
    completion_status = Column(String(40), default="IN_PROGRESS", nullable=False)
    # IN_PROGRESS, COMPLETED, INCOMPLETE, POSTPONED
    postpone_reason = Column(Text, nullable=True)
    attempt_number = Column(Integer, default=1, nullable=False)
    duration_seconds = Column(Float, default=0.0, nullable=False)
    source_code = Column(String(60), default="INTERACTIVE_SESSION", nullable=False)
    is_simulated = Column(Boolean, default=True, nullable=False)
    started_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True, index=True)

    sessions = relationship("CognitiveAssessmentSession", back_populates="assessment", cascade="all, delete-orphan")
    responses = relationship("CognitiveResponse", back_populates="assessment", cascade="all, delete-orphan")
    result = relationship("CognitiveResult", back_populates="assessment", uselist=False, cascade="all, delete-orphan")


class CognitiveAssessmentSession(Base):
    __tablename__ = "cognitive_assessment_sessions"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("cognitive_assessments.id", ondelete="CASCADE"), nullable=False, index=True)
    current_step_index = Column(Integer, default=0, nullable=False)
    autosave_state_json = Column(Text, default="{}", nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    assessment = relationship("CognitiveAssessment", back_populates="sessions")


class CognitiveTask(Base):
    __tablename__ = "cognitive_tasks"

    id = Column(Integer, primary_key=True, index=True)
    test_code = Column(String(60), ForeignKey("cognitive_tests.code", ondelete="CASCADE"), nullable=False, index=True)
    difficulty = Column(String(30), default="INTERMEDIATE", nullable=False)
    sequence_order = Column(Integer, default=1, nullable=False)
    prompt_text = Column(Text, nullable=False)
    stimulus_json = Column(Text, nullable=False)
    options_json = Column(Text, nullable=False)
    correct_answer_key = Column(String(120), nullable=False)


class CognitiveResponse(Base):
    __tablename__ = "cognitive_responses"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("cognitive_assessments.id", ondelete="CASCADE"), nullable=False, index=True)
    task_index = Column(Integer, nullable=False)
    selected_answer = Column(String(255), nullable=False)
    is_correct = Column(Boolean, nullable=False)
    is_omission = Column(Boolean, default=False, nullable=False)
    response_time_ms = Column(Float, default=1000.0, nullable=False)
    moves_or_actions_count = Column(Integer, default=1, nullable=False)
    decision_sequence_json = Column(Text, nullable=True)
    recorded_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    assessment = relationship("CognitiveAssessment", back_populates="responses")


class CognitiveResult(Base):
    __tablename__ = "cognitive_results"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("cognitive_assessments.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    total_items = Column(Integer, nullable=False)
    correct_count = Column(Integer, nullable=False)
    incorrect_count = Column(Integer, default=0, nullable=False)
    omissions_count = Column(Integer, default=0, nullable=False)
    accuracy_percent = Column(Float, nullable=False)
    mean_response_time_ms = Column(Float, nullable=False)
    response_time_variability_ms = Column(Float, default=0.0, nullable=False)
    moves_count = Column(Integer, default=0, nullable=False)
    targets_tracked = Column(Integer, default=0, nullable=False)
    requires_review = Column(Boolean, default=False, nullable=False)
    practice_effect_note = Column(Text, nullable=False)
    non_diagnostic_summary = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    assessment = relationship("CognitiveAssessment", back_populates="result")


class CognitiveBaseline(Base):
    __tablename__ = "cognitive_baselines"
    __table_args__ = (
        UniqueConstraint("astronaut_id", "domain_code", "difficulty", "version_number", name="uq_cog_baseline"),
    )

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    domain_code = Column(String(60), ForeignKey("cognitive_domains.code"), nullable=False)
    difficulty = Column(String(30), default="INTERMEDIATE", nullable=False)
    version_number = Column(String(30), default="1.0-DEMO", nullable=False)
    baseline_accuracy_percent = Column(Float, nullable=False)
    baseline_mean_rt_ms = Column(Float, nullable=False)
    established_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    is_simulated = Column(Boolean, default=True, nullable=False)


class CognitiveFeedback(Base):
    __tablename__ = "cognitive_feedbacks"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("cognitive_assessments.id", ondelete="CASCADE"), nullable=False, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    perceived_difficulty = Column(Integer, default=5, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


# ============================================================================
# MODULE 3: EMOTIONAL ASSESSMENT CENTER MODELS
# ============================================================================

class EmotionalQuestionnaire(Base):
    __tablename__ = "emotional_questionnaires"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    title = Column(String(180), nullable=False)
    description = Column(Text, nullable=False)
    reference_period_label = Column(String(100), default="Últimos 3 a 7 días de misión", nullable=False)
    estimated_minutes = Column(Integer, default=5, nullable=False)
    is_clinically_validated = Column(Boolean, default=False, nullable=False)
    privacy_and_usage_notice = Column(Text, nullable=False)
    current_version = Column(String(30), default="1.0-DEMO", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    versions = relationship("EmotionalQuestionnaireVersion", back_populates="questionnaire", cascade="all, delete-orphan")


class EmotionalQuestionnaireVersion(Base):
    __tablename__ = "emotional_questionnaire_versions"

    id = Column(Integer, primary_key=True, index=True)
    questionnaire_id = Column(Integer, ForeignKey("emotional_questionnaires.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(String(30), nullable=False)
    scoring_rules_json = Column(Text, nullable=False)
    interpretation_guidelines = Column(Text, nullable=False)
    is_current = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    questionnaire = relationship("EmotionalQuestionnaire", back_populates="versions")
    questions = relationship("EmotionalQuestion", back_populates="version", cascade="all, delete-orphan")


class EmotionalQuestion(Base):
    __tablename__ = "emotional_questions"

    id = Column(Integer, primary_key=True, index=True)
    version_id = Column(Integer, ForeignKey("emotional_questionnaire_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_code = Column(String(60), nullable=False, index=True)
    dimension_code = Column(String(60), nullable=False)
    # 12 Dimensions: MOOD, PERCEIVED_STRESS, ISOLATION, MISSION_ADAPTATION, REST_QUALITY,
    # EMOTIONAL_FATIGUE, SOCIAL_SUPPORT, MOTIVATION, COPING_CONTROL, MISSION_CONCERNS,
    # ACCOMPANIMENT_NEED, GENERAL_WELLBEING, OPEN_REFLECTION
    sequence_order = Column(Integer, nullable=False)
    prompt_text = Column(Text, nullable=False)
    question_type = Column(String(40), nullable=False)  # SCALE_1_5, FREQUENCY, OPEN_TEXT, BOOLEAN_SUPPORT
    is_optional = Column(Boolean, default=False, nullable=False)
    allow_prefer_not_to_answer = Column(Boolean, default=True, nullable=False)
    higher_value_indicates_concern = Column(Boolean, default=False, nullable=False)

    version = relationship("EmotionalQuestionnaireVersion", back_populates="questions")
    options = relationship("EmotionalQuestionOption", back_populates="question", cascade="all, delete-orphan")


class EmotionalQuestionOption(Base):
    __tablename__ = "emotional_question_options"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("emotional_questions.id", ondelete="CASCADE"), nullable=False, index=True)
    option_value = Column(String(60), nullable=False)
    option_label = Column(String(150), nullable=False)
    numeric_weight = Column(Integer, nullable=True)
    sequence_order = Column(Integer, default=1, nullable=False)

    question = relationship("EmotionalQuestion", back_populates="options")


class EmotionalAssessmentRequest(Base):
    __tablename__ = "emotional_assessment_requests"

    id = Column(Integer, primary_key=True, index=True)
    requested_by_admin_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    questionnaire_code = Column(String(60), ForeignKey("emotional_questionnaires.code"), nullable=False)
    version_number = Column(String(30), default="1.0-DEMO", nullable=False)
    periodicity = Column(String(40), default="ONCE", nullable=False)  # ONCE, WEEKLY, BIWEEKLY, PHASE_CHANGE
    is_recurring = Column(Boolean, default=False, nullable=False)
    priority = Column(String(30), default="NORMAL", nullable=False)  # NORMAL, HIGH, URGENT_CHECKIN
    custom_message = Column(Text, nullable=True)
    status = Column(String(40), default="SENT", nullable=False, index=True)
    # States: DRAFT, SCHEDULED, SENT, DELIVERED, IN_PROGRESS, COMPLETED, OVERDUE, POSTPONED, CANCELLED
    postpone_reason = Column(Text, nullable=True)
    status_history_json = Column(Text, default="[]", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    is_simulated = Column(Boolean, default=True, nullable=False)

    assessment = relationship("EmotionalAssessment", back_populates="request", uselist=False, cascade="all, delete-orphan")


class EmotionalAssessment(Base):
    __tablename__ = "emotional_assessments"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("emotional_assessment_requests.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False)
    questionnaire_code = Column(String(60), nullable=False)
    version_number = Column(String(30), default="1.0-DEMO", nullable=False)
    phase_code = Column(String(60), default="SURFACE", nullable=False)
    environment_code = Column(String(60), default="LUNAR_SURFACE", nullable=False)
    is_draft = Column(Boolean, default=True, nullable=False)
    share_summary_with_leader = Column(Boolean, default=True, nullable=False)
    allow_admin_detailed_review = Column(Boolean, default=False, nullable=False)
    started_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    is_simulated = Column(Boolean, default=True, nullable=False)

    request = relationship("EmotionalAssessmentRequest", back_populates="assessment")
    responses = relationship("EmotionalAssessmentResponse", back_populates="assessment", cascade="all, delete-orphan")
    result = relationship("EmotionalAssessmentResult", back_populates="assessment", uselist=False, cascade="all, delete-orphan")


class EmotionalAssessmentResponse(Base):
    __tablename__ = "emotional_assessment_responses"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("emotional_assessments.id", ondelete="CASCADE"), nullable=False, index=True)
    question_code = Column(String(60), nullable=False, index=True)
    dimension_code = Column(String(60), nullable=False)
    response_value = Column(String(120), nullable=True)
    numeric_score = Column(Integer, nullable=True)
    open_text_answer = Column(Text, nullable=True)
    prefer_not_to_answer = Column(Boolean, default=False, nullable=False)
    recorded_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    assessment = relationship("EmotionalAssessment", back_populates="responses")


class EmotionalAssessmentResult(Base):
    __tablename__ = "emotional_assessment_results"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("emotional_assessments.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    operational_state = Column(String(60), nullable=False)
    # States: EMOTIONAL_WELLNESS_STABLE, EMOTIONAL_WELLNESS_MONITORING, SUPPORT_REQUESTED,
    # PROFESSIONAL_REVIEW, URGENT_SUPPORT, ASSESSMENT_INCOMPLETE, ASSESSMENT_UNAVAILABLE
    explicit_support_requested = Column(Boolean, default=False, nullable=False)
    urgent_protocol_triggered = Column(Boolean, default=False, nullable=False)
    authorized_operational_summary = Column(Text, nullable=False)
    personal_feedback_summary = Column(Text, nullable=False)
    recommended_next_step = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    assessment = relationship("EmotionalAssessment", back_populates="result")


class EmotionalFollowUp(Base):
    __tablename__ = "emotional_follow_ups"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("emotional_assessment_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    author_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_role = Column(String(50), nullable=False)
    action_type = Column(String(60), nullable=False)  # FOLLOW_UP_SCHEDULED, SUPPORT_PROVIDED, ESCALATED, CLOSED
    notes = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class EmotionalSupportRequest(Base):
    __tablename__ = "emotional_support_requests"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("emotional_assessments.id", ondelete="CASCADE"), nullable=False, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    urgency_level = Column(String(40), default="ROUTINE", nullable=False)  # ROUTINE, PRIORITY, URGENT
    preferred_contact_channel = Column(String(80), default="PRIVATE_CHANNEL", nullable=False)
    notes = Column(Text, nullable=True)
    status = Column(String(40), default="OPEN", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class EmotionalAssessmentNotification(Base):
    __tablename__ = "emotional_assessment_notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    request_id = Column(Integer, ForeignKey("emotional_assessment_requests.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)




# ============================================================================
# MÓDULO DE AISLAMIENTO Y CONFINAMIENTO (NASA HRP — Isolation & Confinement)
# ============================================================================

class QuickCheckin(Base):
    """Check-in rápido de sueño y ánimo. La nota y el ánimo son privados del astronauta."""
    __tablename__ = "quick_checkins"

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    dedup_key = Column(String(120), unique=True, nullable=True, index=True)  # reenvío desde la cola sin enlace
    sleep_hours = Column(Float, nullable=False)
    sleep_quality = Column(Integer, nullable=False)  # 1-5
    mood = Column(Integer, nullable=False)  # 1-5
    energy = Column(Integer, nullable=False)  # 1-5
    feels_isolated = Column(Boolean, default=False, nullable=False)
    note = Column(Text, nullable=True)
    operational_flag = Column(String(30), default="OK", nullable=False)  # OK, NEEDS_CHECK_IN
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class LeisureActivity(Base):
    """Catálogo de actividades breves de tiempo libre (hobbies) para la tripulación."""
    __tablename__ = "leisure_activities"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    title = Column(String(150), nullable=False)
    category = Column(String(30), nullable=False)  # PLANTS, READING, GAMES, MUSIC, ART, PHOTOGRAPHY, WRITING, MOVEMENT
    duration_minutes = Column(Integer, nullable=False)
    description = Column(Text, nullable=False)
    how_to_json = Column(Text, default="[]", nullable=False)
    solo_or_group = Column(String(10), default="SOLO", nullable=False)  # SOLO, GROUP, BOTH
    source_title = Column(String(255), nullable=True)
    source_url = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)


class LeisureLog(Base):
    __tablename__ = "leisure_logs"

    id = Column(Integer, primary_key=True, index=True)
    astronaut_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    activity_code = Column(String(60), ForeignKey("leisure_activities.code"), nullable=False)
    minutes = Column(Integer, nullable=False)
    enjoyment = Column(Integer, nullable=False)  # 1-5
    note = Column(Text, nullable=True)
    xp_awarded = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class CrewActivityTemplate(Base):
    """Plantillas de actividades de integración (comida compartida, noche de película...)."""
    __tablename__ = "crew_activity_templates"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(60), unique=True, nullable=False, index=True)
    title = Column(String(150), nullable=False)
    description = Column(Text, nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    category = Column(String(30), nullable=False)  # MEAL, MOVIE, GARDEN, GAME, OBSERVATION, CELEBRATION
    is_active = Column(Boolean, default=True, nullable=False)


class CrewActivity(Base):
    __tablename__ = "crew_activities"

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    template_code = Column(String(60), ForeignKey("crew_activity_templates.code"), nullable=True)
    title = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    scheduled_for = Column(DateTime(timezone=True), nullable=False, index=True)
    duration_minutes = Column(Integer, nullable=False)
    status = Column(String(20), default="SCHEDULED", nullable=False, index=True)  # SCHEDULED, COMPLETED, CANCELLED
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    participants = relationship(
        "CrewActivityParticipant",
        back_populates="activity",
        cascade="all, delete-orphan",
        order_by="CrewActivityParticipant.id",
    )


class CrewActivityParticipant(Base):
    __tablename__ = "crew_activity_participants"
    __table_args__ = (UniqueConstraint("activity_id", "user_id", name="uq_crew_activity_participant"),)

    id = Column(Integer, primary_key=True, index=True)
    activity_id = Column(Integer, ForeignKey("crew_activities.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    response = Column(String(20), default="PENDING", nullable=False)  # PENDING, JOINED, DECLINED
    attended = Column(Boolean, default=False, nullable=False)
    xp_awarded = Column(Boolean, default=False, nullable=False)  # garantiza XP una sola vez por actividad
    responded_at = Column(DateTime(timezone=True), nullable=True)
    attended_at = Column(DateTime(timezone=True), nullable=True)

    activity = relationship("CrewActivity", back_populates="participants")
