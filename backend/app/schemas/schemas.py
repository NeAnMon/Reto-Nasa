from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


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
    dedup_key: Optional[str] = Field(default=None, max_length=120)


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


# ============================================================================
# MODULE 1: COMMUNICATION CENTER SCHEMAS
# ============================================================================

class ConversationCreateRequest(BaseModel):
    mission_id: int
    astronaut_id: Optional[int] = None
    leader_id: Optional[int] = None
    subject: Optional[str] = None
    linked_alert_id: Optional[int] = None
    is_simulated: bool = True


class MessageCreateRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)
    category: str = Field(default="GENERAL")
    is_important: bool = False
    reply_to_message_id: Optional[int] = None
    linked_alert_id: Optional[int] = None
    dedup_key: Optional[str] = Field(default=None, max_length=120)
    attachment_file_name: Optional[str] = None
    attachment_mime_type: Optional[str] = "text/plain"
    attachment_safe_note: Optional[str] = None
    is_simulated: bool = True


class MessageFlagPatch(BaseModel):
    is_important: Optional[bool] = None
    marked_unread_by_recipient: Optional[bool] = None


class SupportRequestCreate(BaseModel):
    mission_id: Optional[int] = None
    category: str = Field(default="REQUEST_FOR_ASSISTANCE")
    reason_title: str = Field(..., min_length=3, max_length=180)
    description: str = Field(..., min_length=3, max_length=4000)
    wants_private_conversation: bool = True
    is_emergency: bool = False
    is_simulated: bool = True


class SupportRequestStatusPatch(BaseModel):
    status: str = Field(..., description="REQUESTED, RECEIVED, IN_REVIEW, RESPONDED, ESCALATED, CLOSED")
    leader_response_notes: Optional[str] = None


# ============================================================================
# MODULE 2: COGNITIVE ASSESSMENT CENTER SCHEMAS
# ============================================================================

class CognitiveAssessmentCreate(BaseModel):
    mission_id: Optional[int] = None
    domain_code: str
    test_code: Optional[str] = None
    difficulty: str = Field(default="INTERMEDIATE", description="BASIC, INTERMEDIATE, ADVANCED")
    readiness_status: str = Field(default="READY", description="READY, FATIGUED, POST_EVA, POSTPONED")
    conditions_notes: Optional[str] = None
    postpone_reason: Optional[str] = None
    is_simulated: bool = True


class CognitiveResponseItemInput(BaseModel):
    task_index: int
    selected_answer: str
    is_correct: Optional[bool] = None
    is_omission: bool = False
    response_time_ms: float = Field(default=1000.0, ge=0.0)
    moves_or_actions_count: int = Field(default=1, ge=0)
    decision_sequence: Optional[List[Any]] = None


class CognitiveResponsesSubmitRequest(BaseModel):
    responses: List[CognitiveResponseItemInput]
    current_step_index: int = 0
    autosave_state: Optional[Dict[str, Any]] = None


class CognitiveCompleteRequest(BaseModel):
    duration_seconds: float = Field(default=45.0, ge=0.1)
    perceived_difficulty: int = Field(default=5, ge=1, le=10)
    feedback_notes: Optional[str] = None


class CognitivePostponeRequest(BaseModel):
    postpone_reason: str = Field(..., min_length=3)


class CognitiveScheduleCreate(BaseModel):
    astronaut_id: int
    mission_id: int
    domain_code: str
    test_code: Optional[str] = None
    difficulty: str = "INTERMEDIATE"
    due_in_hours: int = Field(default=24, ge=1, le=720)
    is_simulated: bool = True


# ============================================================================
# MODULE 3: EMOTIONAL ASSESSMENT CENTER SCHEMAS
# ============================================================================

class EmotionalRequestCreate(BaseModel):
    astronaut_ids: List[int] = Field(..., min_length=1)
    mission_id: int
    questionnaire_code: str = "EMOTIONAL_CHECKIN_DEMO_V1"
    periodicity: str = Field(default="ONCE", description="ONCE, WEEKLY, BIWEEKLY, PHASE_CHANGE")
    is_recurring: bool = False
    priority: str = Field(default="NORMAL", description="NORMAL, HIGH, URGENT_CHECKIN")
    custom_message: Optional[str] = None
    due_in_hours: int = Field(default=24, ge=1, le=720)
    send_immediately: bool = True
    is_simulated: bool = True


class EmotionalRequestPatch(BaseModel):
    priority: Optional[str] = None
    periodicity: Optional[str] = None
    custom_message: Optional[str] = None
    due_in_hours: Optional[int] = None
    status: Optional[str] = None
    postpone_reason: Optional[str] = None


class EmotionalResponseItemInput(BaseModel):
    question_code: str
    dimension_code: Optional[str] = None
    response_value: Optional[str] = None
    numeric_score: Optional[int] = None
    open_text_answer: Optional[str] = None
    prefer_not_to_answer: bool = False


class EmotionalResponsesSaveRequest(BaseModel):
    responses: List[EmotionalResponseItemInput]
    is_draft: bool = True
    share_summary_with_leader: bool = True
    allow_admin_detailed_review: bool = False


class EmotionalCompleteRequest(BaseModel):
    responses: Optional[List[EmotionalResponseItemInput]] = None
    share_summary_with_leader: bool = True
    allow_admin_detailed_review: bool = False
    explicit_support_request: bool = False
    support_urgency: str = Field(default="NONE", description="NONE, ROUTINE, PRIORITY, URGENT")
    preferred_contact_channel: str = Field(default="PRIVATE_CHANNEL")
    support_notes: Optional[str] = None


class EmotionalFollowUpCreate(BaseModel):
    request_id: int
    action_type: str = Field(default="FOLLOW_UP_SCHEDULED", description="FOLLOW_UP_SCHEDULED, SUPPORT_PROVIDED, ESCALATED, CLOSED")
    notes: str = Field(..., min_length=3)




# ============================================================================
# MÓDULO DE AISLAMIENTO Y CONFINAMIENTO
# ============================================================================

class QuickCheckinCreate(BaseModel):
    sleep_hours: float = Field(..., ge=0.0, le=16.0)
    sleep_quality: int = Field(..., ge=1, le=5)
    mood: int = Field(..., ge=1, le=5)
    energy: int = Field(..., ge=1, le=5)
    feels_isolated: bool = False
    note: Optional[str] = Field(default=None, max_length=500)
    dedup_key: Optional[str] = Field(default=None, max_length=120)

    @field_validator("sleep_hours")
    @classmethod
    def _one_decimal(cls, v: float) -> float:
        return round(v, 1)


class LeisureLogCreate(BaseModel):
    minutes: int = Field(..., ge=1, le=180)
    enjoyment: int = Field(..., ge=1, le=5)
    note: Optional[str] = Field(default=None, max_length=500)


class CrewActivityCreate(BaseModel):
    mission_id: int
    template_code: Optional[str] = Field(default=None, max_length=60)
    title: Optional[str] = Field(default=None, min_length=3, max_length=150)
    description: Optional[str] = Field(default=None, max_length=1000)
    scheduled_for: datetime
    duration_minutes: Optional[int] = Field(default=None, ge=5, le=240)

    @model_validator(mode="after")
    def _title_or_template(self):
        if not self.template_code and not (self.title and self.title.strip()):
            raise ValueError("Indique una plantilla (template_code) o un título.")
        return self


class CrewActivityRespond(BaseModel):
    response: str = Field(..., pattern="^(JOINED|DECLINED)$")
