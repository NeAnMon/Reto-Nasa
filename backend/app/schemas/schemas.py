from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str
    password: str


class PasswordRecoveryRequest(BaseModel):
    email: str


class PasswordResetConfirm(BaseModel):
    email: str
    recovery_token: str
    new_password: str = Field(..., min_length=8)


class UserCreateRequest(BaseModel):
    crew_code: str = Field(..., min_length=3, max_length=40)
    email: str
    full_name: str = Field(..., min_length=2, max_length=150)
    password: str = Field(..., min_length=8)
    role_code: str = Field(..., description="ASTRONAUT, MISSION_LEADER, or ADMINISTRATOR")
    callsign: Optional[str] = "Nova-1"
    specialty: Optional[str] = "Especialista de Misión"


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    preferred_theme: Optional[str] = None
    share_wellness_signals_with_leader: Optional[bool] = None
    share_detailed_wellness_with_medical: Optional[bool] = None
    callsign: Optional[str] = None
    specialty: Optional[str] = None
    quiet_hours_window: Optional[str] = None


class UserStatusPatch(BaseModel):
    status: str = Field(..., description="ACTIVE, SUSPENDED, or INACTIVE")
    reason: Optional[str] = "Cambio administrativo de estado de cuenta"


class UserRolePatch(BaseModel):
    role_code: str = Field(..., description="ASTRONAUT, MISSION_LEADER, or ADMINISTRATOR")
    reason: str = Field(..., min_length=3)


class MissionCreateRequest(BaseModel):
    code: str = Field(..., min_length=3, max_length=50)
    name: str = Field(..., min_length=3, max_length=150)
    description: str
    vehicle_or_habitat: str
    planned_duration_days: int = Field(default=30, ge=1, le=2000)
    current_phase: str = Field(default="ORBIT")
    environment_code: str = Field(default="LOW_EARTH_ORBIT")
    is_simulated: bool = True


class MissionAssignmentRequest(BaseModel):
    user_id: int
    assignment_role: str = Field(..., description="ASTRONAUT or MISSION_LEADER")


class ContextUpdateRequest(BaseModel):
    astronaut_id: Optional[int] = None
    environment_code: str
    phase_code: str
    location_module: str
    determination_source: str = Field(default="MANUAL_CONFIRMATION")
    connectivity_status: str = Field(default="ONLINE")
    conflict_notes: Optional[str] = None
    is_simulated: bool = True


class HealthMeasurementCreate(BaseModel):
    astronaut_id: Optional[int] = None
    mission_id: Optional[int] = None
    indicator_code: str
    value: float
    secondary_value: Optional[float] = None
    measured_at: Optional[datetime] = None
    source_code: str = Field(default="MANUAL_ENTRY")
    data_quality: str = Field(default="VALIDATED")
    is_simulated: bool = False
    notes: Optional[str] = None
    dedup_key: Optional[str] = None


class BulkImportRequest(BaseModel):
    astronaut_id: Optional[int] = None
    mission_id: Optional[int] = None
    format_type: str = Field(default="JSON", description="JSON or CSV")
    payload_text: str
    is_simulated: bool = True


class EnvironmentalMeasurementCreate(BaseModel):
    mission_id: int
    environment_code: str
    phase_code: str = "SURFACE"
    parameter_code: str
    parameter_name: str
    value: Optional[float] = None
    text_state: Optional[str] = None
    unit: str
    source_code: str = "MANUAL_ENTRY"
    is_simulated: bool = True


class AlertAckRequest(BaseModel):
    action_taken: str = Field(..., min_length=3)


class AlertFollowUpRequest(BaseModel):
    action_type: str = Field(default="FOLLOW_UP_NOTE", description="FOLLOW_UP_NOTE, RECHECK_COMPLETED, RESOLVED")
    notes: str = Field(..., min_length=3)


class AlertEscalateRequest(BaseModel):
    notes: str = Field(..., min_length=3)


class WellnessAssessmentCreate(BaseModel):
    astronaut_id: Optional[int] = None
    mission_id: Optional[int] = None
    instrument_code: str = "SPACE_WELLNESS_CHECK_DEMO"
    is_draft: bool = False
    mood_score: int = Field(default=7, ge=1, le=10)
    stress_score: int = Field(default=4, ge=1, le=10)
    sleep_quality_score: int = Field(default=7, ge=1, le=10)
    sleep_hours: float = Field(default=7.0, ge=0.0, le=16.0)
    fatigue_score: int = Field(default=4, ge=1, le=10)
    concentration_score: int = Field(default=7, ge=1, le=10)
    isolation_score: int = Field(default=3, ge=1, le=10)
    adaptation_score: int = Field(default=8, ge=1, le=10)
    social_support_score: int = Field(default=7, ge=1, le=10)
    recovery_score: int = Field(default=7, ge=1, le=10)
    request_additional_support: bool = False
    support_urgency: str = "NONE"
    private_reflection: Optional[str] = None
    share_operational_signal_with_leader: bool = True
    is_simulated: bool = True


class WellnessFeedbackCreate(BaseModel):
    recommendation_code: str
    helpful_rating: int = Field(default=5, ge=1, le=5)
    notes: Optional[str] = None


class GamificationCompleteRequest(BaseModel):
    daily_mission_code: str
    status_mode: str = Field(default="COMPLETED", description="COMPLETED or EXCUSED_OPERATIONAL_RESTRICTION")
    reflection_note: Optional[str] = None
    is_simulated: bool = True


class SimulatorRunRequest(BaseModel):
    scenario_code: str
    astronaut_id: Optional[int] = None
    mission_id: Optional[int] = None
    environment_code: Optional[str] = None


class RuleVersionCreateRequest(BaseModel):
    version_number: str
    protocol_source: str
    approved_by: str
    normal_min: float
    normal_max: float
    monitor_min: float
    monitor_max: float
    warning_min: float
    warning_max: float
    baseline_delta_threshold: Optional[float] = None
    immediate_instructions: str
    followup_instructions: str
    escalation_conditions: str
    change_reason: str = Field(..., min_length=5)


class ReportExportRequest(BaseModel):
    astronaut_id: int
    mission_id: Optional[int] = None
    report_format: str = Field(default="JSON", description="PDF, CSV, or JSON")
    include_simulated: bool = True
    justification: Optional[str] = "Exportación operativa autorizada"

