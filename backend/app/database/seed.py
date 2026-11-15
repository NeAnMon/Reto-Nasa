import json
from datetime import datetime, timedelta, timezone
from typing import Dict
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.models.models import (
    Alert,
    AlertAcknowledgement,
    AstronautProfile,
    AuditEvent,
    Badge,
    ClinicalRule,
    ClinicalRuleVersion,
    CognitiveAssessment,
    CognitiveAssessmentSession,
    CognitiveBaseline,
    CognitiveDomain,
    CognitiveFeedback,
    CognitiveResponse,
    CognitiveResult,
    CognitiveSchedule,
    CognitiveTask,
    CognitiveTest,
    CognitiveTestVersion,
    Conversation,
    ConversationAuditEvent,
    ConversationParticipant,
    CrewActivity,
    CrewActivityParticipant,
    CrewActivityTemplate,
    DailyMission,
    DataQualityEvent,
    DataSource,
    EmotionalAssessment,
    EmotionalAssessmentNotification,
    EmotionalAssessmentRequest,
    EmotionalAssessmentResponse,
    EmotionalAssessmentResult,
    EmotionalFollowUp,
    EmotionalQuestion,
    EmotionalQuestionOption,
    EmotionalQuestionnaire,
    EmotionalQuestionnaireVersion,
    EmotionalSupportRequest,
    EnvironmentalMeasurement,
    EnvironmentProfile,
    FollowUpAction,
    GamificationEvent,
    GamificationProfile,
    HealthBaseline,
    HealthIndicatorDefinition,
    HealthMeasurement,
    LeisureActivity,
    LeisureLog,
    Message,
    MessageAttachment,
    MessageNotification,
    MessageReadReceipt,
    Mission,
    MissionAssignment,
    MissionContext,
    MissionPhase,
    Permission,
    PsychologicalWellnessAssessment,
    QuickCheckin,
    Role,
    RolePermission,
    SensorRegistry,
    SupportRequest,
    User,
    UserBadge,
    UserSession,
    WellnessInstrument,
    WellnessRecommendation,
)
from backend.app.security.auth import hash_password
from backend.app.database.seed_analog import seed_analog_bed_rest
from backend.app.services.cognitive_engine import COGNITIVE_DOMAINS_CATALOG


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


ENVIRONMENT_PROFILES_DATA = [
    (
        "EARTH_SURFACE",
        "Superficie Terrestre (Entrenamiento / Recuperación)",
        1.0,
        "1.0 G (Gravedad estándar)",
        "LOW",
        "LOW",
        "0 km (Tierra)",
        0.0,
        "OPEN_TERRESTRIAL_OR_SIMULATOR",
        "Condiciones de referencia en Tierra para establecer línea base pre-misión y seguimiento de recuperación post-aterrizaje.",
        "Línea base cardiovascular, ortostática y metabólica.",
        "Calibración de sensores, evaluación de línea base y acondicionamiento físico.",
    ),
    (
        "LOW_EARTH_ORBIT",
        "Órbita Terrestre Baja (LEO / Estación Orbital)",
        0.0,
        "Microgravedad (~10⁻⁶ G)",
        "MODERATE",
        "MODERATE",
        "~400 km de la Tierra",
        0.2,
        "ORBITAL_STATION",
        "Entorno orbital con microgravedad continua, ciclos solares de 90 minutos y protección parcial de la magnetosfera.",
        "Redistribución cefálica de fluidos, síndrome neuro-ocular (SANS), descondicionamiento muscular y óseo, alteración circadiana.",
        "Ejercicio contrarresistencia autorizado, higiene luminosa del sueño e hidratación estructurada.",
    ),
    (
        "DEEP_SPACE_TRANSIT",
        "Tránsito en Espacio Profundo (Cislunar / Interplanetario)",
        0.0,
        "Microgravedad en espacio profundo",
        "HIGH",
        "HIGH",
        ">100,000 km de la Tierra",
        1.3,
        "DEEP_SPACE_VESSEL",
        "Crucero fuera de la magnetosfera terrestre con exposición a radiación cósmica galáctica (GCR) y eventos solares (SPE).",
        "Exposición acumulada a radiación, aislamiento en volumen reducido, fatiga cognitiva y desacondicionamiento cardiovascular.",
        "Vigilancia dosimétrica continua, protocolos de refugio ante tormenta solar y apoyo psicosocial activo.",
    ),
    (
        "LUNAR_ORBIT",
        "Órbita Lunar (Estación Gateway NRHO)",
        0.0,
        "Microgravedad en órbita lunar",
        "HIGH",
        "HIGH",
        "~384,400 km de la Tierra",
        1.3,
        "LUNAR_ORBITAL_OUTPOST",
        "Puesto orbital lunar para transferencia a superficie y operaciones autónomas fuera del cinturón de Van Allen.",
        "Radiación ionizante, desacondicionamiento ortostático previo al descenso lunar y alteración del sueño.",
        "Monitoreo de dosis de radiación, preparación cardiovascular pre-descenso y control de CO₂ en cabina.",
    ),
    (
        "LUNAR_SURFACE",
        "Superficie Lunar (Polo Sur / Base Lunar)",
        0.166,
        "0.166 G (Hipogravedad lunar)",
        "HIGH",
        "HIGH",
        "~384,400 km de la Tierra",
        1.3,
        "SURFACE_OUTPOST",
        "Operaciones en gravedad parcial lunar con riesgo de polvo regolítico abrasivo y alta carga física en actividades de superficie.",
        "Irritación respiratoria/ocular por polvo lunar, fatiga por trajes presurizados, estrés térmico e inestabilidad postural.",
        "Filtración y descontaminación post-EVA, control de hidratación y vigilancia respiratoria.",
    ),
    (
        "MARS_TRANSIT",
        "Tránsito Interplanetario a Marte",
        0.0,
        "Microgravedad prolongada (6–9 meses)",
        "VERY_HIGH",
        "EXTREME",
        "50 a 400 millones km",
        480.0,
        "INTERPLANETARY_TRANSPORT",
        "Viaje interplanetario de larga duración con retardo de comunicación creciente (hasta 22 min por sentido) y autonomía médica.",
        "Pérdida de densidad mineral ósea, atrofia muscular, estrés por confinamiento extremo, inmunomodulación y radiación.",
        "Autocuidado autónomo, contramedidas físicas estrictas, nutrición antioxidante y cohesión de tripulación.",
    ),
    (
        "MARS_ORBIT",
        "Órbita Marciana",
        0.0,
        "Microgravedad tras tránsito largo",
        "VERY_HIGH",
        "EXTREME",
        "~225 millones km de la Tierra",
        720.0,
        "ORBITAL_COMMAND_MODULE",
        "Fase orbital marciana previa al ingreso atmosférico tras meses de microgravedad.",
        "Intolerancia ortostática severa ante transición gravitacional, fatiga acumulada y retardo de telemedicina.",
        "Carga salina/hídrica autorizada y revisión integral previa al descenso.",
    ),
    (
        "MARS_SURFACE",
        "Superficie Marciana",
        0.38,
        "0.38 G (Hipogravedad marciana)",
        "HIGH",
        "EXTREME",
        "~225 millones km de la Tierra",
        720.0,
        "PLANETARY_HABITAT",
        "Estancia planetaria en gravedad 0.38 G con tormentas de polvo perclorado y alta autonomía respecto a la Tierra.",
        "Readaptación vestibular y musculoesquelética tras microgravedad, exposición a polvo fino y aislamiento prolongado.",
        "Rehabilitación progresiva en superficie, vigilancia tiroidea/respiratoria y rutinas de bienestar.",
    ),
    (
        "PRESSURIZED_HABITAT",
        "Hábitat Presurizado de Superficie",
        0.166,
        "Gravedad parcial en atmósfera controlada",
        "MODERATE_HIGH",
        "HIGH",
        "Variable según cuerpo planetario",
        1.3,
        "PRESSURIZED_SURFACE_MODULE",
        "Módulo habitable cerrado con soporte vital regenerativo (ECLSS), iluminación artificial y acústica de ventilación continua.",
        "Acumulación local de CO₂, cefaleas, sequedad de mucosas, ruido ambiental constante y fatiga visual.",
        "Supervisión de ventilación ECLSS, pausas acústicas y control de humedad.",
    ),
    (
        "SPACECRAFT_CABIN",
        "Cabina de Nave Espacial (Cápsula de Tripulación)",
        0.0,
        "Microgravedad / Fases dinámicas de vuelo",
        "MODERATE_HIGH",
        "HIGH",
        "Variable en tránsito",
        1.0,
        "CREW_CAPSULE",
        "Volumen habitable compacto durante lanzamiento, acoplamiento, tránsito corto o reentrada.",
        "Cinetosis espacial, restricción de movimiento, picos de aceleración G y cambios de presión de cabina.",
        "Movilización segura, hidratación programada y monitoreo hemodinámico.",
    ),
    (
        "EXTRAVEHICULAR_ACTIVITY",
        "Actividad Extravehicular (EVA / Caminata Espacial)",
        0.166,
        "Traje presurizado en vacío/superficie",
        "VERY_HIGH",
        "HIGH",
        "Exterior de nave o superficie",
        1.3,
        "SPACESUIT_EMU",
        "Operación crítica en traje espacial presurizado con alta demanda metabólica, control térmico por sublimación y atmósfera pura de O₂.",
        "Agotamiento térmico, deshidratación, hipoxia/hipercapnia por fallo de lavado de CO₂, lesiones por contacto en manos y fatiga aguda.",
        "Monitoreo continuo de signos vitales, presión del traje, CO₂ inspirado y suspensión de recordatorios no críticos.",
    ),
    (
        "UNKNOWN_ENVIRONMENT",
        "Entorno no confirmado",
        None,
        "Sin datos verificados",
        "UNKNOWN",
        "UNKNOWN",
        "No confirmado",
        0.0,
        "UNCONFIRMED",
        "No existe telemetría verificada ni confirmación manual autorizada. AstroVital no asume ubicación por GPS local.",
        "Incertidumbre contextual: interprete las mediciones con precaución y confirme el entorno manualmente.",
        "Solicitar confirmación de entorno por parte de la tripulación o control de misión.",
    ),
    (
        "SIMULATION_ENVIRONMENT",
        "Entorno de Simulación / Análogo en Tierra (HERA / NEEMO)",
        1.0,
        "1.0 G (Misión análoga simulada)",
        "LOW",
        "HIGH",
        "0 km (Instalación análoga)",
        5.0,
        "ANALOG_HABITAT",
        "Entorno controlado para entrenamiento de confinamiento, retardo de comunicaciones y validación de protocolos.",
        "Estrés psicosocial, privación de sueño y fatiga operativa.",
        "Práctica de flujos de autocuidado, comunicación de alertas y cohesión de equipo.",
    ),
]


INDICATORS_DATA = [
    {
        "code": "HEART_RATE",
        "name": "Frecuencia Cardíaca",
        "category": "CARDIOVASCULAR",
        "body_region_code": "HEART_CARDIO",
        "unit": "bpm",
        "min_valid_value": 25.0,
        "max_valid_value": 240.0,
        "stale_after_hours": 24,
        "requires_device": False,
        "device_note": "Puede medirse con sensor óptico/ECG autorizado o mediante palpación manual radial durante 60 s.",
        "step_by_step_instructions": "1. Permanezca en reposo 3 minutos.\n2. Coloque el sensor de pulso o cuente latidos radiales durante 60 segundos.\n3. Introduzca el valor en latidos por minuto (bpm) y confirme la fuente.",
        "educational_summary": "Número de contracciones cardíacas por minuto. Refleja la respuesta autonómica, el estado de hidratación y la carga física.",
        "spaceflight_risk_explanation": "En microgravedad e hipogravedad se produce redistribución cefálica de fluidos y remodelado cardiovascular, pudiendo alterar la frecuencia basal y la tolerancia ortostática.",
        "normal_min": 52.0,
        "normal_max": 90.0,
        "monitor_min": 45.0,
        "monitor_max": 102.0,
        "warning_min": 38.0,
        "warning_max": 115.0,
        "baseline_delta": 18.0,
    },
    {
        "code": "BLOOD_PRESSURE",
        "name": "Presión Arterial (Sistólica / Diastólica)",
        "category": "CARDIOVASCULAR",
        "body_region_code": "HEART_CARDIO",
        "unit": "mmHg",
        "min_valid_value": 60.0,
        "max_valid_value": 250.0,
        "stale_after_hours": 48,
        "requires_device": True,
        "device_note": "Requiere esfigmomanómetro o monitor braquial calibrado.",
        "step_by_step_instructions": "1. Repose 5 minutos sin cruzar piernas ni sujetar cargas.\n2. Ajuste el brazalete a la altura del corazón.\n3. Registre el valor sistólico (principal) y diastólico (secundario) en mmHg.",
        "educational_summary": "Fuerza ejercida por la sangre contra las paredes arteriales en sístole y diástole.",
        "spaceflight_risk_explanation": "Los cambios gravitacionales alteran el reflejo barorreceptor y el volumen plasmático, incrementando el riesgo de hipotensión ortostática al reingreso o en superficie planetaria.",
        "normal_min": 95.0,
        "normal_max": 128.0,
        "monitor_min": 88.0,
        "monitor_max": 139.0,
        "warning_min": 80.0,
        "warning_max": 159.0,
        "baseline_delta": 16.0,
    },
    {
        "code": "BODY_TEMP",
        "name": "Temperatura Corporal",
        "category": "METABOLIC",
        "body_region_code": "SKIN_THERMO",
        "unit": "°C",
        "min_valid_value": 33.0,
        "max_valid_value": 42.5,
        "stale_after_hours": 24,
        "requires_device": True,
        "device_note": "Requiere termómetro clínico timpánico, frontal o sensor térmico validado.",
        "step_by_step_instructions": "1. Verifique que no haya ingerido líquidos calientes/fríos en los últimos 15 min.\n2. Tome la lectura con el termómetro autorizado.\n3. Ingrese el valor en grados Celsius (°C).",
        "educational_summary": "Equilibrio térmico entre producción de calor metabólico y disipación ambiental.",
        "spaceflight_risk_explanation": "En microgravedad disminuye la convección natural del aire, elevando ligeramente la temperatura central durante el ejercicio ("
        "space fever) y aumentando el riesgo térmico dentro del traje EVA.",
        "normal_min": 36.1,
        "normal_max": 37.3,
        "monitor_min": 35.7,
        "monitor_max": 37.8,
        "warning_min": 35.0,
        "warning_max": 38.4,
        "baseline_delta": 0.7,
    },
    {
        "code": "SPO2",
        "name": "Saturación de Oxígeno (SpO₂)",
        "category": "RESPIRATORY",
        "body_region_code": "LUNGS_RESP",
        "unit": "%",
        "min_valid_value": 70.0,
        "max_valid_value": 100.0,
        "stale_after_hours": 24,
        "requires_device": True,
        "device_note": "Requiere pulsioxímetro óptico calibrado.",
        "step_by_step_instructions": "1. Mantenga la mano estable y templada.\n2. Coloque el pulsioxímetro en el dedo índice y espere onda estable.\n3. Registre el porcentaje de SpO₂.",
        "educational_summary": "Porcentaje de hemoglobina arterial saturada con oxígeno.",
        "spaceflight_risk_explanation": "Esencial para vigilar la oxigenación en atmósferas de cabina despresurizadas, trajes EVA y exposición a polvo lunar o marciano.",
        "normal_min": 95.0,
        "normal_max": 100.0,
        "monitor_min": 93.0,
        "monitor_max": 100.0,
        "warning_min": 90.0,
        "warning_max": 100.0,
        "baseline_delta": 3.0,
    },
    {
        "code": "RESP_RATE",
        "name": "Frecuencia Respiratoria",
        "category": "RESPIRATORY",
        "body_region_code": "LUNGS_RESP",
        "unit": "rpm",
        "min_valid_value": 6.0,
        "max_valid_value": 45.0,
        "stale_after_hours": 24,
        "requires_device": False,
        "device_note": "Puede medirse por observación torácica durante 60 s o banda respiratoria.",
        "step_by_step_instructions": "1. En reposo, cuente las elevaciones del tórax durante 60 segundos completos.\n2. Registre el total en respiraciones por minuto (rpm).",
        "educational_summary": "Número de ciclos ventilatorios completos por minuto.",
        "spaceflight_risk_explanation": "Sensible al incremento de CO₂ ambiental en compartimentos cerrados, fatiga física durante EVA y estrés agudo.",
        "normal_min": 11.0,
        "normal_max": 18.0,
        "monitor_min": 9.0,
        "monitor_max": 22.0,
        "warning_min": 8.0,
        "warning_max": 26.0,
        "baseline_delta": 4.0,
    },
    {
        "code": "BLOOD_GLUCOSE",
        "name": "Glucosa Sanguínea Capilar",
        "category": "METABOLIC",
        "body_region_code": "DIGESTIVE_NUTRITION",
        "unit": "mg/dL",
        "min_valid_value": 40.0,
        "max_valid_value": 400.0,
        "stale_after_hours": 72,
        "requires_device": True,
        "device_note": "Requiere glucómetro capilar o sensor intersticial autorizado. Si no está disponible, puede omitirse en la evaluación parcial.",
        "step_by_step_instructions": "1. Verifique estado de ayuno (≥8 h) o postprandial.\n2. Realice lectura con el analizador portátil autorizado.\n3. Registre el valor en mg/dL.",
        "educational_summary": "Concentración de glucosa circulante para soporte energético celular y cerebral.",
        "spaceflight_risk_explanation": "Los vuelos espaciales pueden inducir resistencia subclínica a la insulina asociada a inflamación, cambios de sueño y pérdida de masa muscular.",
        "normal_min": 75.0,
        "normal_max": 110.0,
        "monitor_min": 68.0,
        "monitor_max": 135.0,
        "warning_min": 60.0,
        "warning_max": 180.0,
        "baseline_delta": 20.0,
    },
    {
        "code": "SLEEP_DURATION",
        "name": "Sueño (Duración y Calidad Percibida)",
        "category": "SLEEP_FATIGUE",
        "body_region_code": "HEAD_BRAIN",
        "unit": "h",
        "min_valid_value": 0.0,
        "max_valid_value": 16.0,
        "stale_after_hours": 30,
        "requires_device": False,
        "device_note": "Registro de bitácora de sueño o actigrafía de muñeca (valor secundario: calidad 1-10).",
        "step_by_step_instructions": "1. Indique el total de horas dormidas en el último ciclo de descanso.\n2. En el campo secundario, califique la calidad percibida de 1 (muy fragmentado) a 10 (reparador).",
        "educational_summary": "Horas efectivas de descanso y percepción subjetiva de recuperación neurocognitiva.",
        "spaceflight_risk_explanation": "La ausencia de ciclo solar natural de 24 h, el ruido de soporte vital y la incomodidad postural reducen frecuentemente el sueño en órbita a ~6 horas.",
        "normal_min": 6.5,
        "normal_max": 9.0,
        "monitor_min": 5.5,
        "monitor_max": 10.0,
        "warning_min": 4.5,
        "warning_max": 11.5,
        "baseline_delta": 1.8,
    },
    {
        "code": "HYDRATION",
        "name": "Hidratación Registrada",
        "category": "HYDRATION",
        "body_region_code": "DIGESTIVE_NUTRITION",
        "unit": "mL/día",
        "min_valid_value": 0.0,
        "max_valid_value": 6000.0,
        "stale_after_hours": 30,
        "requires_device": False,
        "device_note": "Contabilización de bolsas de bebida / dispensador de agua potable del hábitat.",
        "step_by_step_instructions": "1. Sume los mililitros consumidos de agua y bebidas rehidratantes en las últimas 24 h.\n2. Introduzca el volumen acumulado en mL.",
        "educational_summary": "Ingesta hídrica diaria para mantener volumen plasmático, termorregulación y función renal.",
        "spaceflight_risk_explanation": "La diuresis inicial en microgravedad y la reabsorción de calcio óseo elevan el riesgo de nefrolitiasis (cálculos renales) si la hidratación es insuficiente.",
        "normal_min": 2100.0,
        "normal_max": 3400.0,
        "monitor_min": 1600.0,
        "monitor_max": 3800.0,
        "warning_min": 1200.0,
        "warning_max": 4500.0,
        "baseline_delta": 500.0,
    },
    {
        "code": "PHYSICAL_ACTIVITY",
        "name": "Actividad Física Contrarresistencia",
        "category": "ACTIVITY",
        "body_region_code": "MUSCLES",
        "unit": "min/día",
        "min_valid_value": 0.0,
        "max_valid_value": 300.0,
        "stale_after_hours": 36,
        "requires_device": False,
        "device_note": "Tiempo de ejercicio autorizado en sistema ARED/cicloergómetro (secundario: minutos sedentarios).",
        "step_by_step_instructions": "1. Registre los minutos de ejercicio aeróbico y resistivo autorizado completados hoy.\n2. Opcionalmente indique el tiempo estimado de sedentarismo/inmovilidad en el campo secundario.",
        "educational_summary": "Volumen diario de ejercicio físico preventivo para preservar masa muscular, ósea y capacidad aeróbica.",
        "spaceflight_risk_explanation": "Sin carga mecánica diaria, los astronautas pueden perder 1–1.5% de densidad mineral ósea mensual y masa muscular antigravitatoria.",
        "normal_min": 45.0,
        "normal_max": 150.0,
        "monitor_min": 25.0,
        "monitor_max": 180.0,
        "warning_min": 10.0,
        "warning_max": 220.0,
        "baseline_delta": 30.0,
    },
    {
        "code": "PERCEIVED_FATIGUE",
        "name": "Fatiga Percibida",
        "category": "SLEEP_FATIGUE",
        "body_region_code": "HEAD_BRAIN",
        "unit": "escala 1-10",
        "min_valid_value": 1.0,
        "max_valid_value": 10.0,
        "stale_after_hours": 24,
        "requires_device": False,
        "device_note": "Escala subjetiva autoinformada (1 = alerta total, 10 = agotamiento severo).",
        "step_by_step_instructions": "1. Evalúe su nivel actual de cansancio físico y mental antes de tareas críticas.\n2. Seleccione un valor de 1 a 10 con honestidad; reportar fatiga protege a la tripulación y no genera penalizaciones.",
        "educational_summary": "Percepción subjetiva del nivel de agotamiento cognitivo y físico.",
        "spaceflight_risk_explanation": "La sobrecarga de horarios, los cambios circadianos y el trabajo en trajes presurizados aumentan el riesgo de errores operativos por fatiga.",
        "normal_min": 1.0,
        "normal_max": 4.5,
        "monitor_min": 1.0,
        "monitor_max": 6.5,
        "warning_min": 1.0,
        "warning_max": 7.9,
        "baseline_delta": 2.5,
    },
    {
        "code": "MOOD_WELLNESS",
        "name": "Estado de Ánimo y Bienestar General",
        "category": "WELLNESS",
        "body_region_code": "GENERAL_WELLNESS",
        "unit": "escala 1-10",
        "min_valid_value": 1.0,
        "max_valid_value": 10.0,
        "stale_after_hours": 36,
        "requires_device": False,
        "device_note": "Autoevaluación subjetiva (1 = malestar alto / requiere apoyo, 10 = óptimo).",
        "step_by_step_instructions": "1. Reflexione sobre su disposición emocional, calma y motivación hoy.\n2. Registre un valor de 1 a 10. Nunca se otorgan ni restan puntos de gamificación por el valor reportado.",
        "educational_summary": "Indicador subjetivo de equilibrio emocional, adaptación al confinamiento y vitalidad.",
        "spaceflight_risk_explanation": "El aislamiento, la distancia de la Tierra y la convivencia prolongada en espacios cerrados requieren seguimiento preventivo no estigmatizante.",
        "normal_min": 6.0,
        "normal_max": 10.0,
        "monitor_min": 4.5,
        "monitor_max": 10.0,
        "warning_min": 3.0,
        "warning_max": 10.0,
        "baseline_delta": 2.0,
    },
    {
        "code": "RADIATION_EXPOSURE",
        "name": "Dosis Diaria de Radiación Ionizante",
        "category": "ENVIRONMENTAL",
        "body_region_code": "IMMUNE_SYSTEM",
        "unit": "mSv/día",
        "min_valid_value": 0.0,
        "max_valid_value": 50.0,
        "stale_after_hours": 24,
        "requires_device": True,
        "device_note": "Dosímetro personal activo de radiación (CPD) o telemetría del hábitat.",
        "step_by_step_instructions": "1. Consulte la lectura acumulada de 24 h en su dosímetro personal o consola ambiental.\n2. Ingrese el valor en milisieverts por día (mSv/día).",
        "educational_summary": "Exposición biológica diaria a radiación cósmica galáctica y partículas solares.",
        "spaceflight_risk_explanation": "La radiación espacial es uno de los 5 grandes peligros: impacta el sistema hematopoyético e inmunológico, el cristalino ocular y la salud celular a largo plazo.",
        "normal_min": 0.0,
        "normal_max": 0.85,
        "monitor_min": 0.0,
        "monitor_max": 1.5,
        "warning_min": 0.0,
        "warning_max": 2.5,
        "baseline_delta": 0.6,
    },
]


DAILY_MISSIONS_DATA = [
    (
        "DAILY_HEALTH_CHECK",
        "Daily Health Check",
        "MEASUREMENT",
        "Completar una evaluación guiada de indicadores fisiológicos disponibles en My Health Check.",
        35,
        "ALL",
        False,
        "El registro periódico permite distinguir variaciones normales de adaptación frente a tendencias que ameritan seguimiento.",
    ),
    (
        "PULSE_CHECK",
        "Pulse Check",
        "MEASUREMENT",
        "Registrar una medición validada de frecuencia cardíaca y presión arterial en reposo.",
        25,
        "ALL",
        False,
        "En microgravedad e hipogravedad, el sistema cardiovascular redistribuye fluidos hacia el tórax y la cabeza.",
    ),
    (
        "SLEEP_LOG",
        "Sleep Log",
        "SELF_CARE",
        "Registrar la duración y calidad percibida del último periodo de sueño.",
        25,
        "ALL",
        False,
        "Dormir entre 7 y 8 horas protege la atención ejecutiva, la memoria de procedimientos y la regulación emocional.",
    ),
    (
        "HYDRATION_ROUTINE",
        "Hydration Routine",
        "SELF_CARE",
        "Completar y registrar la pauta de hidratación fraccionada del día.",
        20,
        "ALL",
        False,
        "Una ingesta hídrica adecuada reduce el riesgo de cálculos renales inducidos por la resorción de calcio óseo en el espacio.",
    ),
    (
        "MOVE_SAFELY",
        "Move Safely",
        "SELF_CARE",
        "Realizar la sesión de movimiento y ejercicio contrarresistencia autorizada por el protocolo actual.",
        30,
        "ALL",
        True,
        "El ejercicio resistivo protege huesos y músculos antigravitatorios. Se suspende automáticamente si existe una alerta médica incompatible.",
    ),
    (
        "MIND_CHECK",
        "Mind Check",
        "WELLNESS",
        "Completar un chequeo privado de bienestar psicológico en el Wellness Center.",
        30,
        "ALL",
        False,
        "El bienestar psicológico se evalúa con privacidad reforzada; reconocer el estrés a tiempo es una fortaleza operativa.",
    ),
    (
        "ENVIRONMENTAL_AWARENESS",
        "Environmental Awareness",
        "ENVIRONMENT",
        "Revisar las condiciones ambientales del hábitat/nave (CO₂, presión, radiación y soporte vital).",
        20,
        "ALL",
        False,
        "Conocer el estado del soporte vital (ECLSS) y los niveles de CO₂ ayuda a contextualizar síntomas como cefalea o fatiga.",
    ),
    (
        "MISSION_REFLECTION",
        "Mission Reflection",
        "WELLNESS",
        "Registrar una breve reflexión personal sobre adaptación, descanso o trabajo en equipo.",
        20,
        "ALL",
        False,
        "La escritura reflexiva reduce la sensación de aislamiento en misiones de larga duración.",
    ),
    (
        "FOLLOW_UP_MISSION",
        "Follow-up Mission",
        "FOLLOW_UP",
        "Completar la acción de seguimiento o confirmación indicada en una alerta preventiva no urgente.",
        35,
        "ALL",
        False,
        "El cierre trazable de seguimientos permite al astronauta y al líder en tierra mantener control preventivo sin alarmismo.",
    ),
    (
        "LEARNING_MISSION",
        "Learning Mission",
        "LEARNING",
        "Explorar una región anatómica en el Body Explorer y revisar su cápsula educativa sobre riesgos espaciales.",
        25,
        "ALL",
        False,
        "Comprender cómo los 5 peligros del espacio interactúan con cada sistema anatómico empodera el autocuidado.",
    ),
    (
        "COMPLETE_COGNITIVE_CHECK",
        "Complete Cognitive Check",
        "COGNITIVE",
        "Completar una actividad interactiva en el Cognitive Performance Center.",
        35,
        "ALL",
        False,
        "El seguimiento por dominio cognitivo permite observar el impacto del sueño y la carga operativa sin calificaciones estigmatizantes.",
    ),
    (
        "COMPLETE_EMOTIONAL_CHECKIN",
        "Complete Emotional Check-In",
        "WELLNESS",
        "Responder un cuestionario emocional estructurado en My Emotional Check-In.",
        35,
        "ALL",
        False,
        "Expresar cómo te sientes facilita el acompañamiento preventivo oportuno con privacidad reforzada.",
    ),
    (
        "REVIEW_MISSION_MESSAGES",
        "Review Mission Messages",
        "COMMUNICATION",
        "Revisar y confirmar lectura de comunicaciones directas con el líder de misión en el Communication Center.",
        20,
        "ALL",
        False,
        "La comunicación fluida entre el astronauta y el apoyo en tierra reduce la incertidumbre operativa.",
    ),
    (
        "RESPOND_SUPPORT_REQUEST",
        "Respond Support Request",
        "FOLLOW_UP",
        "Dar seguimiento o actualizar una solicitud de apoyo o mensaje prioritario con Tierra.",
        30,
        "ALL",
        False,
        "El seguimiento estructurado de solicitudes asegura que ninguna inquietud quede sin respuesta.",
    ),
    (
        "MEMORY_TRAINING_ACTIVITY",
        "Memory Training Activity",
        "COGNITIVE",
        "Realizar una sesión breve de entrenamiento de memoria operativa o aprendizaje visual.",
        25,
        "ALL",
        False,
        "Ejercitar la memoria de trabajo apoya la ejecución de listas de verificación complejas.",
    ),
    (
        "VISUAL_ATTENTION_ACTIVITY",
        "Visual Attention Activity",
        "COGNITIVE",
        "Realizar una actividad de atención sostenida o seguimiento visual en el centro cognitivo.",
        25,
        "ALL",
        False,
        "La vigilancia visual y el rastreo espacial son esenciales durante acoplamientos y actividades extravehiculares.",
    ),
]


BADGES_DATA = [
    (
        "FIRST_HEALTH_CHECK",
        "First Health Check",
        "heart-pulse",
        "Primer chequeo de salud registrado con validación de calidad.",
        "Registrar al menos una evaluación fisiológica válida en My Health Check.",
    ),
    (
        "CONSISTENCY_STREAK",
        "Consistency Streak",
        "flame",
        "Constancia demostrada en rutinas de observación y autocuidado.",
        "Mantener 3 o más días/rutinas de participación sin penalización por restricciones operativas.",
    ),
    (
        "SLEEP_ROUTINE_COMPLETED",
        "Sleep Routine Completed",
        "moon",
        "Compromiso con la higiene del descanso y registro circadiano.",
        "Completar la misión Sleep Log y revisar pautas de descanso.",
    ),
    (
        "LEARNING_EXPLORER",
        "Learning Explorer",
        "compass",
        "Explorador del conocimiento sobre fisiología humana en el espacio.",
        "Completar una Learning Mission o consultar módulos educativos del Body Explorer.",
    ),
    (
        "SELF_CARE_COMMITMENT",
        "Self-Care Commitment",
        "shield-check",
        "Dedicación proactiva a las contramedidas preventivas autorizadas.",
        "Completar 4 o más rutinas de autocuidado (hidratación, movimiento seguro o bienestar).",
    ),
    (
        "FOLLOW_UP_COMPLETED",
        "Follow-up Completed",
        "check-circle",
        "Gestión responsable de alertas preventivas y comunicación con tierra.",
        "Reconocer una alerta o completar una Follow-up Mission.",
    ),
    (
        "MISSION_MILESTONE",
        "Mission Milestone",
        "award",
        "Hito de participación integral durante la misión espacial.",
        "Alcanzar 150 puntos de experiencia (XP) verificados por el servidor.",
    ),
    (
        "MEMORY_EXPLORER",
        "Memory Explorer",
        "brain",
        "Participación en actividades de memoria operativa y recuerdo inmediato.",
        "Completar una evaluación del dominio MEMORY en el Cognitive Performance Center.",
    ),
    (
        "VISUAL_NAVIGATOR",
        "Visual Navigator",
        "eye",
        "Dominio de actividades de aprendizaje visual y seguimiento de trayectorias.",
        "Completar una evaluación de VISUAL_LEARNING o VISUAL_TRACKING.",
    ),
    (
        "ATTENTION_SPECIALIST",
        "Attention Specialist",
        "target",
        "Entrenamiento de vigilancia, atención sostenida e inhibición de distractores.",
        "Completar una evaluación del dominio ATTENTION.",
    ),
    (
        "PATTERN_DETECTIVE",
        "Pattern Detective",
        "puzzle",
        "Exploración de reglas lógicas y categorización conceptual.",
        "Completar una evaluación del dominio ABSTRACTION.",
    ),
    (
        "SPATIAL_EXPLORER",
        "Spatial Explorer",
        "box",
        "Orientación espacial, rotación mental e integración interpersonal.",
        "Completar una evaluación de SPATIAL_ORIENTATION o EMOTION_RECOGNITION.",
    ),
    (
        "LOGIC_CHALLENGER",
        "Logic Challenger",
        "cpu",
        "Resolución de matrices relacionales y exploración compleja de escenarios.",
        "Completar una evaluación de ABSTRACT_REASONING o COMPLEX_EXPLORATION.",
    ),
    (
        "COGNITIVE_MISSION_COMPLETED",
        "Cognitive Mission Completed",
        "sparkles",
        "Primera actividad cognitiva completada exitosamente en misión.",
        "Completar cualquier evaluación cognitiva interactiva.",
    ),
    (
        "FOCUS_TRAINING",
        "Focus Training",
        "zap",
        "Constancia en el entrenamiento y monitoreo cognitivo preventivo.",
        "Completar 3 o más actividades en el Cognitive Performance Center.",
    ),
]


WELLNESS_RECOMMENDATIONS_DATA = [
    (
        "BOX_BREATHING_4X4",
        "Respiración Táctica Guiada (4-4-4-4)",
        "BREATHING",
        "ALL,WELLNESS_STABLE,WELLNESS_MONITORING,SUPPORT_RECOMMENDED",
        5,
        False,
        "Inhale suavemente durante 4 segundos, mantenga el aire 4 segundos, exhale durante 4 segundos y pause 4 segundos. Repita durante 5 minutos siguiendo el guía visual.",
        "Favorece la modulación vagal y reduce la activación simpática ante cargas operativas o confinamiento.",
    ),
    (
        "COGNITIVE_RECOVERY_PAUSE",
        "Pausa de Recuperación Neurocognitiva y Visual",
        "RECOVERY_BREAK",
        "ALL,WELLNESS_MONITORING,SUPPORT_RECOMMENDED",
        15,
        False,
        "Aléjese de las pantallas de telemetría durante 15 minutos, observe un punto lejano o cúpula de observación y reduzca el estímulo acústico con protección auditiva.",
        "Mitiga la fatiga de atención sostenida y la tensión ocular en entornos cerrados.",
    ),
    (
        "CIRCADIAN_SLEEP_PROTOCOL",
        "Rutina de Higiene Circadiana Pre-Sueño",
        "SLEEP_HYGIENE",
        "ALL,WELLNESS_STABLE,WELLNESS_MONITORING,SUPPORT_RECOMMENDED",
        30,
        False,
        "Ajuste la iluminación del compartimento a espectro cálido (<450 nm reducido) 45 min antes de dormir, asegure el saco de descanso y verifique temperatura confortable.",
        "Facilita la secreción endógena de melatonina cuando los ciclos solares externos están alterados.",
    ),
    (
        "CREW_RECREATION_SESSION",
        "Actividad Recreativa o Musical en Hábitat",
        "RECREATION",
        "ALL,WELLNESS_STABLE,WELLNESS_MONITORING",
        20,
        False,
        "Dedique 20 minutos a lectura recreativa, música personal o juego cooperativo no competitivo con la tripulación.",
        "Previene la monotonía sensorial en misiones de larga duración.",
    ),
    (
        "AUTHORIZED_FAMILY_LINK",
        "Contacto Social o Familiar Autorizado",
        "SOCIAL_CONTACT",
        "ALL,WELLNESS_MONITORING,SUPPORT_RECOMMENDED,PROFESSIONAL_REVIEW",
        25,
        False,
        "Programe una videollamada privada (en LEO/Luna) o mensaje de video diferido de alta prioridad (en espacio profundo) con su red de apoyo en Tierra.",
        "Refuerza el apoyo social percibido y reduce el impacto del aislamiento y la distancia de la Tierra.",
    ),
    (
        "AUTHORIZED_RESISTANCE_EXERCISE",
        "Sesión de Ejercicio Físico Autorizado (Contramedida)",
        "AUTHORIZED_EXERCISE",
        "WELLNESS_STABLE,WELLNESS_MONITORING",
        45,
        True,
        "Complete la pauta autorizada de movilidad y carga resistiva moderada. Nota: Esta recomendación se bloquea automáticamente si existe una alerta médica incompatible.",
        "Libera endorfinas y preserva la integridad musculoesquelética y cardiovascular.",
    ),
    (
        "STRESS_COPING_TOOLKIT",
        "Protocolo de Afrontamiento Cognitivo ante Confinamiento",
        "COPING_RESOURCE",
        "WELLNESS_MONITORING,SUPPORT_RECOMMENDED,PROFESSIONAL_REVIEW",
        15,
        False,
        "Identifique el estresor operativo, separe los factores controlables de los no controlables y registre una nota estructurada en su bitácora privada.",
        "Estrategia validada en factores humanos espaciales para prevenir escaladas de tensión interpersonal o fatiga.",
    ),
    (
        "PRIVATE_PSYCH_CONSULT_REQUEST",
        "Solicitud de Enlace Privado con Especialista de Apoyo",
        "PROFESSIONAL_CONTACT",
        "SUPPORT_RECOMMENDED,PROFESSIONAL_REVIEW,URGENT_SUPPORT",
        30,
        False,
        "Active un canal confidencial con el equipo de soporte psicológico en Tierra. Sus respuestas de cuestionario permanecen privadas por defecto.",
        "Garantiza acompañamiento profesional oportuno sin estigmatización.",
    ),
    (
        "URGENT_MEDICAL_SUPPORT_PROTOCOL",
        "Activación de Protocolo de Apoyo Urgente de Tripulación",
        "URGENT_PROTOCOL",
        "URGENT_SUPPORT",
        10,
        False,
        "Comunique de inmediato al Oficial Médico de Tripulación (CMO) y al Médico de Vuelo en Tierra mediante el canal prioritario.",
        "Las actividades de relajación nunca sustituyen la atención profesional o urgente.",
    ),
]


def seed_database(db: Session, force_reseed_sim: bool = False) -> None:
    # Migración ligera de BD existentes (siempre, aunque no se siembren datos demo)
    apply_lightweight_migrations(db)
    if not settings.SEED_DEMO_DATA:
        # BD ya inicializada: mantiene al día los catálogos del módulo de aislamiento, sin cuentas demo
        if db.query(Role).count() > 0:
            seed_isolation_module(db)
        return

    existing_roles = db.query(Role).count()
    existing_cog_domains = db.query(CognitiveDomain).count()
    if existing_roles > 0 and existing_cog_domains > 0 and not force_reseed_sim:
        seed_isolation_module(db)
        seed_analog_bed_rest(db)
        return

    now = utcnow()

    # 1. Roles & Permissions
    perm_defs = [
        ("READ_OWN_HEALTH", "Consultar el propio dashboard, silueta e historial de salud"),
        ("WRITE_OWN_HEALTH", "Registrar mediciones fisiológicas y evaluaciones de bienestar propias"),
        ("COMPLETE_GAMIFICATION", "Completar misiones diarias y obtener insignias verificadas"),
        ("READ_ASSIGNED_CREW", "Supervisar astronautas y misiones asignadas"),
        ("ACKNOWLEDGE_ALERTS", "Reconocer alertas y registrar seguimiento operativo"),
        ("ESCALATE_ALERTS", "Escalar alertas al protocolo médico correspondiente"),
        ("EXPORT_REPORTS", "Exportar informes autorizados en PDF, CSV y JSON"),
        ("RUN_SIMULATOR", "Ejecutar escenarios del simulador de telemetría DEMO"),
        ("MANAGE_USERS", "Crear, editar, suspender usuarios y asignar roles"),
        ("MANAGE_MISSIONS", "Crear misiones, fases y asignaciones de tripulación"),
        ("MANAGE_RULES", "Gestionar versiones de reglas operativas con auditoría"),
        ("VIEW_AUDIT_LOGS", "Consultar eventos de seguridad y auditoría del sistema"),
    ]
    perm_map = {}
    for code, desc in perm_defs:
        p = db.query(Permission).filter(Permission.code == code).first()
        if not p:
            p = Permission(code=code, description=desc)
            db.add(p)
            db.flush()
        perm_map[code] = p

    roles_cfg = {
        "ASTRONAUT": (
            "Astronauta / Miembro de Tripulación",
            "Acceso a su propia salud, silueta interactiva, bienestar privado, misiones diarias y simulador DEMO.",
            ["READ_OWN_HEALTH", "WRITE_OWN_HEALTH", "COMPLETE_GAMIFICATION", "ACKNOWLEDGE_ALERTS", "EXPORT_REPORTS", "RUN_SIMULATOR"],
        ),
        "MISSION_LEADER": (
            "Líder de Misión en Tierra (Flight Director / Crew Support)",
            "Supervisión de tripulación asignada, alertas operativas, analítica longitudinal e informes autorizados.",
            ["READ_ASSIGNED_CREW", "ACKNOWLEDGE_ALERTS", "ESCALATE_ALERTS", "EXPORT_REPORTS", "RUN_SIMULATOR"],
        ),
        "ADMINISTRATOR": (
            "Administrador de Plataforma y Sistemas",
            "Gestión de cuentas, roles, misiones, catálogos, fuentes de datos, reglas versionadas y auditoría.",
            [
                "MANAGE_USERS",
                "MANAGE_MISSIONS",
                "MANAGE_RULES",
                "VIEW_AUDIT_LOGS",
                "EXPORT_REPORTS",
                "RUN_SIMULATOR",
                "READ_ASSIGNED_CREW",
            ],
        ),
    }

    role_map = {}
    for rcode, (rname, rdesc, p_codes) in roles_cfg.items():
        r = db.query(Role).filter(Role.code == rcode).first()
        if not r:
            r = Role(code=rcode, name=rname, description=rdesc)
            db.add(r)
            db.flush()
        role_map[rcode] = r
        for pc in p_codes:
            exists_rp = (
                db.query(RolePermission)
                .filter(
                    RolePermission.role_id == r.id,
                    RolePermission.permission_id == perm_map[pc].id,
                )
                .first()
            )
            if not exists_rp:
                db.add(RolePermission(role_id=r.id, permission_id=perm_map[pc].id))
    db.flush()

    # 2. Environment Profiles
    for (
        code,
        name,
        grav_g,
        grav_lbl,
        rad,
        iso,
        dist,
        delay,
        enc_type,
        desc,
        risks,
        focus,
    ) in ENVIRONMENT_PROFILES_DATA:
        ep = db.query(EnvironmentProfile).filter(EnvironmentProfile.code == code).first()
        if not ep:
            db.add(
                EnvironmentProfile(
                    code=code,
                    name=name,
                    gravity_g=grav_g,
                    gravity_label=grav_lbl,
                    radiation_hazard_level=rad,
                    isolation_level=iso,
                    distance_from_earth_label=dist,
                    comms_delay_seconds=delay,
                    enclosed_environment_type=enc_type,
                    description=desc,
                    key_physiological_risks=risks,
                    preventive_focus=focus,
                )
            )
    db.flush()

    # 3. Data Sources
    sources_data = [
        ("MANUAL_ENTRY", "Registro Manual Guiado", "MANUAL", False, "AVAILABLE", "Ingreso directo validado por el astronauta en My Health Check."),
        ("CSV_JSON_IMPORT", "Importación de Archivo (CSV/JSON)", "CSV_JSON_IMPORT", False, "AVAILABLE", "Carga estructurada de lotes de mediciones con validación de esquema."),
        ("DEMO_SIMULATION", "Simulador de Telemetría Sintética (SIMULADO)", "DEMO_SIMULATION", False, "SIMULATED", "Generador reproducible de series temporales sintéticas para demostración."),
        ("OFFLINE_QUEUE_SYNC", "Sincronización Diferida Sin Conexión", "MANUAL", False, "AVAILABLE", "Cola local sincronizada tras recuperar enlace con deduplicación."),
        ("BIOMETRIC_HARNESS_STUB", "Adaptador Bio-Arnés Espacial (Interfaz Preparada)", "EXTERNAL_ADAPTER_STUB", False, "SIMULATED", "Interfaz preparada para futura integración con sensores biométricos certificados."),
    ]
    for scode, sname, stype, verif, sstat, sdesc in sources_data:
        if not db.query(DataSource).filter(DataSource.code == scode).first():
            db.add(
                DataSource(
                    code=scode,
                    name=sname,
                    source_type=stype,
                    is_verified_hardware=verif,
                    status=sstat,
                    description=sdesc,
                )
            )
    db.flush()

    # 4. Health Indicator Definitions & Clinical Rules (DEMO)
    for item in INDICATORS_DATA:
        defn = (
            db.query(HealthIndicatorDefinition)
            .filter(HealthIndicatorDefinition.code == item["code"])
            .first()
        )
        if not defn:
            defn = HealthIndicatorDefinition(
                code=item["code"],
                name=item["name"],
                category=item["category"],
                body_region_code=item["body_region_code"],
                unit=item["unit"],
                min_valid_value=item["min_valid_value"],
                max_valid_value=item["max_valid_value"],
                stale_after_hours=item["stale_after_hours"],
                requires_device=item["requires_device"],
                device_note=item["device_note"],
                step_by_step_instructions=item["step_by_step_instructions"],
                educational_summary=item["educational_summary"],
                spaceflight_risk_explanation=item["spaceflight_risk_explanation"],
                supported_environments_csv="ALL",
            )
            db.add(defn)
            db.flush()

        rule_code = f"RULE_{item['code']}_DEMO"
        rule = db.query(ClinicalRule).filter(ClinicalRule.rule_code == rule_code).first()
        if not rule:
            rule = ClinicalRule(
                rule_code=rule_code,
                indicator_code=item["code"],
                name=f"Protocolo Preventivo {item['name']} (DEMO)",
                applicable_context="ALL_ENVIRONMENTS",
                current_version_number="1.0-DEMO",
                is_active=True,
                is_demo_rule=True,
            )
            db.add(rule)
            db.flush()

            version = ClinicalRuleVersion(
                rule_id=rule.id,
                version_number="1.0-DEMO",
                protocol_source="AstroVital DEMO Reference Protocol (Ilustrativo / No Clínico)",
                approved_by="Comité de Demostración de Medicina Espacial (Ficticio)",
                approval_date=now - timedelta(days=30),
                review_due_date=now + timedelta(days=180),
                normal_min=item["normal_min"],
                normal_max=item["normal_max"],
                monitor_min=item["monitor_min"],
                monitor_max=item["monitor_max"],
                warning_min=item["warning_min"],
                warning_max=item["warning_max"],
                baseline_delta_threshold=item["baseline_delta"],
                priority_on_warning="HIGH",
                priority_on_critical="CRITICAL",
                immediate_instructions=(
                    f"1. Suspenda actividad física exigente y permanezca en observación segura.\n"
                    f"2. Verifique colocación del sensor o repita la medición de {item['name']} en 10 minutos.\n"
                    f"3. Si el estado es CRITICAL, active comunicación prioritaria con el Oficial Médico de Tripulación y Tierra."
                ),
                followup_instructions=(
                    f"Registrar medición de seguimiento de {item['name']}, revisar condiciones ambientales de cabina "
                    f"(CO₂/temperatura) y documentar actuación en el Centro de Alertas."
                ),
                escalation_conditions=(
                    "Escalamiento inmediato a Dirección de Medicina de Vuelo si persiste en rango WARNING por >2 mediciones "
                    "o ante cualquier lectura en rango CRITICAL."
                ),
                change_reason="Versión inicial de demostración.",
                is_current=True,
            )
            db.add(version)
    db.flush()

    # 5. Daily Missions, Badges & Wellness Catalog
    for code, title, cat, desc, xp, envs, contra, edu in DAILY_MISSIONS_DATA:
        if not db.query(DailyMission).filter(DailyMission.code == code).first():
            db.add(
                DailyMission(
                    code=code,
                    title=title,
                    category=cat,
                    description=desc,
                    xp_reward=xp,
                    compatible_environments_csv=envs,
                    contraindicated_on_critical_alert=contra,
                    educational_content=edu,
                    is_active=True,
                )
            )

    for bcode, bname, bicon, bdesc, bcrit in BADGES_DATA:
        if not db.query(Badge).filter(Badge.code == bcode).first():
            db.add(
                Badge(
                    code=bcode,
                    name=bname,
                    icon_name=bicon,
                    description=bdesc,
                    criteria_description=bcrit,
                )
            )

    if not db.query(WellnessInstrument).filter(WellnessInstrument.code == "SPACE_WELLNESS_CHECK_DEMO").first():
        dimensions = [
            {"key": "mood_score", "label": "Estado de ánimo general", "min": 1, "max": 10, "high_is_good": True},
            {"key": "stress_score", "label": "Nivel de estrés percibido", "min": 1, "max": 10, "high_is_good": False},
            {"key": "sleep_quality_score", "label": "Calidad reparadora del sueño", "min": 1, "max": 10, "high_is_good": True},
            {"key": "fatigue_score", "label": "Fatiga física y cognitiva", "min": 1, "max": 10, "high_is_good": False},
            {"key": "concentration_score", "label": "Claridad mental y concentración", "min": 1, "max": 10, "high_is_good": True},
            {"key": "isolation_score", "label": "Sensación de aislamiento o confinamiento", "min": 1, "max": 10, "high_is_good": False},
            {"key": "adaptation_score", "label": "Adaptación al entorno y rutinas de misión", "min": 1, "max": 10, "high_is_good": True},
            {"key": "social_support_score", "label": "Percepción de apoyo social y de equipo", "min": 1, "max": 10, "high_is_good": True},
            {"key": "recovery_score", "label": "Capacidad de recuperación y descanso", "min": 1, "max": 10, "high_is_good": True},
        ]
        db.add(
            WellnessInstrument(
                code="SPACE_WELLNESS_CHECK_DEMO",
                title="Cuestionario Educativo de Bienestar y Adaptación Espacial (DEMO)",
                version="1.0-DEMO",
                is_clinically_validated=False,
                disclaimer=(
                    "AVISO IMPORTANTE: Este instrumento es un cuestionario educativo de demostración (NO diagnóstico "
                    "y NO validado clínicamente). Sus respuestas detalladas son privadas por defecto y tienen como "
                    "único propósito apoyar la autoevaluación preventiva y facilitar la solicitud oportuna de apoyo."
                ),
                dimensions_json=json.dumps(dimensions, ensure_ascii=False),
            )
        )

    for rcode, rtitle, rcat, rstates, rdur, rclear, rinstr, rrat in WELLNESS_RECOMMENDATIONS_DATA:
        if not db.query(WellnessRecommendation).filter(WellnessRecommendation.code == rcode).first():
            db.add(
                WellnessRecommendation(
                    code=rcode,
                    title=rtitle,
                    category=rcat,
                    applicable_states_csv=rstates,
                    duration_minutes=rdur,
                    requires_medical_clearance_if_alert=rclear,
                    instructions=rinstr,
                    educational_rationale=rrat,
                )
            )
    db.flush()

    # 5B. Cognitive Performance Center Catalog (9 Independent Domains + Tasks)
    for dcat in COGNITIVE_DOMAINS_CATALOG:
        dom = db.query(CognitiveDomain).filter(CognitiveDomain.code == dcat["code"]).first()
        if not dom:
            dom = CognitiveDomain(
                code=dcat["code"],
                name=dcat["name"],
                objective=dcat["objective"],
                scientific_disclaimer=dcat["scientific_disclaimer"],
                badge_code=dcat.get("badge_code"),
            )
            db.add(dom)
            db.flush()

        tcode = dcat["test_code"]
        ct = db.query(CognitiveTest).filter(CognitiveTest.code == tcode).first()
        if not ct:
            ct = CognitiveTest(
                code=tcode,
                domain_code=dcat["code"],
                title=dcat["test_title"],
                instructions=dcat["instructions"],
                practice_example_json=json.dumps(dcat["practice_example"], ensure_ascii=False),
                estimated_duration_seconds=60,
                current_version="1.0-DEMO",
                is_active=True,
            )
            db.add(ct)
            db.flush()

            ver = CognitiveTestVersion(
                test_id=ct.id,
                version_number="1.0-DEMO",
                supported_difficulties_csv="BASIC,INTERMEDIATE,ADVANCED",
                tasks_payload_json=json.dumps(dcat["tasks"], ensure_ascii=False),
                educational_feedback=(
                    "La repetición frecuente mejora la familiaridad procedimental con la tarea; "
                    "los cambios deben interpretarse junto con sueño y fatiga. Actividad NO diagnóstica."
                ),
                is_current=True,
            )
            db.add(ver)
            db.flush()

            for diff in ("BASIC", "INTERMEDIATE", "ADVANCED"):
                for idx, task_item in enumerate(dcat["tasks"], start=1):
                    db.add(
                        CognitiveTask(
                            test_code=ct.code,
                            difficulty=diff,
                            sequence_order=idx,
                            prompt_text=task_item["prompt"],
                            stimulus_json=json.dumps(task_item["stimulus"], ensure_ascii=False),
                            options_json=json.dumps(task_item["options"], ensure_ascii=False),
                            correct_answer_key=task_item["correct"],
                        )
                    )
    db.flush()

    # 5C. Emotional Assessment Center Catalog (12 Dimensions + 6 Optional Open Questions)
    eq = db.query(EmotionalQuestionnaire).filter(EmotionalQuestionnaire.code == "EMOTIONAL_CHECKIN_DEMO_V1").first()
    if not eq:
        eq = EmotionalQuestionnaire(
            code="EMOTIONAL_CHECKIN_DEMO_V1",
            title="Cuestionario Estructurado de Bienestar Emocional y Acompañamiento en Misión (DEMO)",
            description=(
                "Evaluación preventiva de 12 dimensiones emocionales y preguntas abiertas opcionales solicitada "
                "para acompañar la adaptación de la tripulación con privacidad reforzada."
            ),
            reference_period_label="Últimos 3 a 7 días de misión",
            estimated_minutes=5,
            is_clinically_validated=False,
            privacy_and_usage_notice=(
                "AVISO ÉTICO Y DE PRIVACIDAD: Este cuestionario es una herramienta preventiva de demostración "
                "(NO diagnóstica y NO validada clínicamente). Sus respuestas detalladas están protegidas con "
                "privacidad reforzada; la administración solo visualiza el estado operativo de cumplimiento."
            ),
            current_version="1.0-DEMO",
            is_active=True,
        )
        db.add(eq)
        db.flush()

        eq_ver = EmotionalQuestionnaireVersion(
            questionnaire_id=eq.id,
            version_number="1.0-DEMO",
            scoring_rules_json=json.dumps(
                {
                    "dimensions_count": 12,
                    "open_questions_count": 6,
                    "single_global_score_allowed": False,
                },
                ensure_ascii=False,
            ),
            interpretation_guidelines="Evaluación multidimensional sin puntaje único universal de salud mental.",
            is_current=True,
        )
        db.add(eq_ver)
        db.flush()

        scale_options_positive = [
            ("1", "1 - Muy bajo / Casi nunca", 1),
            ("2", "2 - Bajo / Ocasionalmente", 2),
            ("3", "3 - Moderado / Regularmente", 3),
            ("4", "4 - Alto / Frecuentemente", 4),
            ("5", "5 - Muy alto / Casi siempre", 5),
            ("PREFER_NOT_TO_ANSWER", "Prefiero no responder", None),
        ]
        scale_options_support = [
            ("1", "1 - No requiero acompañamiento adicional por ahora", 1),
            ("2", "2 - Me gustaría mantener seguimiento preventivo habitual", 2),
            ("3", "3 - Deseo conversar próximamente con apoyo de misión", 3),
            ("4", "4 - Solicito revisión prioritaria con especialista autorizado", 4),
            ("5", "5 - Necesito apoyo inmediato / protocolo urgente", 5),
            ("PREFER_NOT_TO_ANSWER", "Prefiero no responder", None),
        ]

        emotional_questions_cfg = [
            # (qcode, seq, dim_code, qtype, prompt, is_optional, allow_pna, higher_concern, opts)
            ("Q_MOOD", 1, "MOOD", "SCALE_1_5", "¿Cómo describirías tu estado de ánimo general durante las últimas 24–48 horas?", False, True, False, scale_options_positive),
            ("Q_STRESS", 2, "PERCEIVED_STRESS", "SCALE_1_5", "¿Qué nivel de estrés o sobrecarga percibes frente a las tareas actuales?", False, True, True, scale_options_positive),
            ("Q_ISOLATION", 3, "ISOLATION", "SCALE_1_5", "¿En qué medida has experimentado sensación de aislamiento o distancia de tus seres queridos?", False, True, True, scale_options_positive),
            ("Q_ADAPTATION", 4, "MISSION_ADAPTATION", "SCALE_1_5", "¿Qué tan cómoda y fluida sientes tu adaptación al entorno y rutinas de la misión?", False, True, False, scale_options_positive),
            ("Q_REST", 5, "REST_QUALITY", "SCALE_1_5", "¿Cómo evalúas la calidad reparadora de tu descanso reciente?", False, True, False, scale_options_positive),
            ("Q_FATIGUE", 6, "EMOTIONAL_FATIGUE", "SCALE_1_5", "¿Qué nivel de desgaste o fatiga emocional sientes al finalizar la jornada?", False, True, True, scale_options_positive),
            ("Q_SOCIAL", 7, "SOCIAL_SUPPORT", "SCALE_1_5", "¿Qué tan respaldado te sientes por tu tripulación y por el equipo en Tierra?", False, True, False, scale_options_positive),
            ("Q_MOTIVATION", 8, "MOTIVATION", "SCALE_1_5", "¿Cómo describirías tu motivación y sentido de propósito con los objetivos actuales?", False, True, False, scale_options_positive),
            ("Q_COPING", 9, "COPING_CONTROL", "SCALE_1_5", "¿Qué tanta sensación de control y recursos propios sientes para manejar imprevistos?", False, True, False, scale_options_positive),
            ("Q_CONCERNS", 10, "MISSION_CONCERNS", "SCALE_1_5", "¿Qué nivel de preocupación tienes respecto al desarrollo técnico u operativo de la misión?", False, True, True, scale_options_positive),
            ("Q_ACCOMPANIMENT", 11, "ACCOMPANIMENT_NEED", "BOOLEAN_SUPPORT", "¿Qué nivel de acompañamiento o conversación con el equipo de apoyo deseas solicitar?", False, True, True, scale_options_support),
            ("Q_WELLBEING", 12, "GENERAL_WELLBEING", "SCALE_1_5", "En conjunto, ¿cómo valoras tu bienestar integral en este momento de la misión?", False, True, False, scale_options_positive),
            # 6 optional open-ended questions
            ("Q_OPEN_FEELING", 13, "OPEN_REFLECTION", "OPEN_TEXT", "1. ¿Cómo te has sentido durante los últimos días de la misión? (Opcional)", True, True, False, []),
            ("Q_OPEN_WORRY", 14, "OPEN_REFLECTION", "OPEN_TEXT", "2. ¿Hay alguna situación que te esté generando preocupación o cansancio? (Opcional)", True, True, False, []),
            ("Q_OPEN_REST_FOCUS", 15, "OPEN_REFLECTION", "OPEN_TEXT", "3. ¿Cómo sientes tu nivel de descanso y concentración? (Opcional)", True, True, False, []),
            ("Q_OPEN_TEAM_COMMS", 16, "OPEN_REFLECTION", "OPEN_TEXT", "4. ¿Cómo percibes la comunicación con el equipo en tierra? (Opcional)", True, True, False, []),
            ("Q_OPEN_NEED_SUPPORT", 17, "OPEN_REFLECTION", "OPEN_TEXT", "5. ¿Necesitas apoyo adicional en este momento? (Opcional)", True, True, False, []),
            ("Q_OPEN_PRIVATE_TOPIC", 18, "OPEN_REFLECTION", "OPEN_TEXT", "6. ¿Deseas conversar de forma privada con el líder o personal autorizado? (Opcional)", True, True, False, []),
        ]

        for qcode, seq_ord, dim_code, qtype, qtext, opt_flag, pna_flag, hi_conc, opts in emotional_questions_cfg:
            q_obj = EmotionalQuestion(
                version_id=eq_ver.id,
                question_code=qcode,
                dimension_code=dim_code,
                sequence_order=seq_ord,
                prompt_text=qtext,
                question_type=qtype,
                is_optional=opt_flag,
                allow_prefer_not_to_answer=pna_flag,
                higher_value_indicates_concern=hi_conc,
            )
            db.add(q_obj)
            db.flush()
            for o_idx, (oval, olbl, nscore) in enumerate(opts, start=1):
                db.add(
                    EmotionalQuestionOption(
                        question_id=q_obj.id,
                        sequence_order=o_idx,
                        option_value=oval,
                        option_label=olbl,
                        numeric_weight=nscore,
                    )
                )
    db.flush()

    # 6. Users (Admin, Leader, 3 Astronauts)
    users_seed = [
        (
            "ADM-001",
            settings.DEMO_ADMIN_EMAIL,
            "Dra. Valeria Mendoza (Admin)",
            settings.DEMO_ADMIN_PASSWORD,
            "ADMINISTRATOR",
            None,
        ),
        (
            "LDR-101",
            settings.DEMO_LEADER_EMAIL,
            "Dir. Carlos Ibáñez (Flight Support Leader)",
            settings.DEMO_LEADER_PASSWORD,
            "MISSION_LEADER",
            None,
        ),
        (
            "AST-201",
            settings.DEMO_ASTRONAUT1_EMAIL,
            "Cmdr. Elena Rostova",
            settings.DEMO_ASTRONAUT1_PASSWORD,
            "ASTRONAUT",
            ("Vega-1", "Comandante & Fisiología de Superficie", True, '["Sin restricciones operativas activas"]'),
        ),
        (
            "AST-202",
            settings.DEMO_ASTRONAUT2_EMAIL,
            "Dr. Marcus Vance",
            settings.DEMO_ASTRONAUT2_PASSWORD,
            "ASTRONAUT",
            ("Orion-2", "Especialista de Misión & Geología Lunar", True, '["Vigilar hidratación post-EVA"]'),
        ),
        (
            "AST-303",
            settings.DEMO_ASTRONAUT3_EMAIL,
            "Spec. Kenji Takahashi",
            settings.DEMO_ASTRONAUT3_PASSWORD,
            "ASTRONAUT",
            ("Helios-3", "Ingeniero de Sistemas en Tránsito Profundo", False, '["Misión independiente Ares-Pathfinder"]'),
        ),
    ]

    user_objs = {}
    for ccode, email, fname, pwd, rcode, astro_meta in users_seed:
        u = db.query(User).filter(User.email == email).first()
        if not u:
            u = User(
                crew_code=ccode,
                email=email,
                full_name=fname,
                password_hash=hash_password(pwd),
                role_id=role_map[rcode].id,
                status="ACTIVE",
                preferred_theme="space-dark",
                share_wellness_signals_with_leader=True,
                share_detailed_wellness_with_medical=False,
            )
            db.add(u)
            db.flush()
            if astro_meta:
                callsign, spec, eva_cert, restr = astro_meta
                db.add(
                    AstronautProfile(
                        user_id=u.id,
                        callsign=callsign,
                        specialty=spec,
                        eva_certified=eva_cert,
                        authorized_restrictions_json=restr,
                        quiet_hours_window="22:00-06:00 UTC",
                        notes="Perfil ficticio de demostración (SIMULADO).",
                    )
                )
                db.add(
                    GamificationProfile(
                        user_id=u.id,
                        total_xp=145 if ccode == "AST-201" else 95,
                        current_level="Explorer" if ccode == "AST-201" else "Cadet",
                        active_streak_days=5 if ccode == "AST-201" else 3,
                        routines_completed_count=6 if ccode == "AST-201" else 3,
                        learning_modules_completed=2 if ccode == "AST-201" else 1,
                        followups_completed=1,
                    )
                )
        user_objs[ccode] = u
    db.flush()

    # 7. Missions & Assignments
    m1 = db.query(Mission).filter(Mission.code == "ARTEMIS-IV-DEMO").first()
    if not m1:
        m1 = Mission(
            code="ARTEMIS-IV-DEMO",
            name="Artemis IV — Lunar South Pole Outpost (DEMO)",
            description="Misión ficticia de 30 días combinando tránsito cislunar, órbita Gateway y operaciones en el Polo Sur Lunar.",
            vehicle_or_habitat="Hábitat Presurizado Lunar 'Selene-Base' & Módulo Gateway",
            start_date=now - timedelta(days=14),
            planned_end_date=now + timedelta(days=16),
            planned_duration_days=30,
            current_phase="SURFACE",
            status="ACTIVE",
            allow_leader_routine_tracking=True,
            is_simulated=True,
        )
        db.add(m1)
        db.flush()

        phases_m1 = [
            ("TRAINING", "1. Línea Base Pre-Misión (Tierra)", 1, now - timedelta(days=25), now - timedelta(days=14), "EARTH_SURFACE", False),
            ("LAUNCH", "2. Lanzamiento e Inserción Orbital", 2, now - timedelta(days=14), now - timedelta(days=12), "SPACECRAFT_CABIN", False),
            ("TRANSIT", "3. Tránsito Cislunar y Órbita Gateway", 3, now - timedelta(days=12), now - timedelta(days=7), "LUNAR_ORBIT", False),
            ("SURFACE", "4. Estancia en Superficie Lunar (Hábitat)", 4, now - timedelta(days=7), now + timedelta(days=10), "LUNAR_SURFACE", True),
            ("EVA", "5. Actividades Extravehiculares (EVA)", 5, now - timedelta(days=2), now + timedelta(days=5), "EXTRAVEHICULAR_ACTIVITY", False),
            ("RETURN", "6. Tránsito de Regreso y Recuperación", 6, now + timedelta(days=10), now + timedelta(days=16), "DEEP_SPACE_TRANSIT", False),
        ]
        for pcode, pname, seq, s_dt, e_dt, env_c, is_cur in phases_m1:
            db.add(
                MissionPhase(
                    mission_id=m1.id,
                    phase_code=pcode,
                    name=pname,
                    sequence_order=seq,
                    start_date=s_dt,
                    end_date=e_dt,
                    environment_code=env_c,
                    is_current=is_cur,
                    description=f"Fase {pname} (Escenario DEMO).",
                )
            )

    m2 = db.query(Mission).filter(Mission.code == "ARES-PATHFINDER-DEMO").first()
    if not m2:
        m2 = Mission(
            code="ARES-PATHFINDER-DEMO",
            name="Ares Pathfinder — Deep Space Transit simulation (DEMO)",
            description="Misión ficticia de crucero en espacio profundo hacia Marte para pruebas de aislamiento y autonomía médica.",
            vehicle_or_habitat="Nave de Tránsito Interplanetario 'Ares-Vanguard'",
            start_date=now - timedelta(days=45),
            planned_end_date=now + timedelta(days=195),
            planned_duration_days=240,
            current_phase="TRANSIT",
            status="ACTIVE",
            allow_leader_routine_tracking=True,
            is_simulated=True,
        )
        db.add(m2)
        db.flush()

        db.add(
            MissionPhase(
                mission_id=m2.id,
                phase_code="TRANSIT",
                name="Tránsito Interplanetario a Marte",
                sequence_order=1,
                start_date=now - timedelta(days=45),
                end_date=now + timedelta(days=195),
                environment_code="MARS_TRANSIT",
                is_current=True,
                description="Crucero de espacio profundo con retardo de comunicación simulado.",
            )
        )

    # Assign Leader + Elena + Marcus to Mission 1; Kenji ONLY to Mission 2
    assignments_cfg = [
        (m1.id, user_objs["LDR-101"].id, "MISSION_LEADER"),
        (m1.id, user_objs["AST-201"].id, "ASTRONAUT"),
        (m1.id, user_objs["AST-202"].id, "ASTRONAUT"),
        (m2.id, user_objs["AST-303"].id, "ASTRONAUT"),
    ]
    for mid, uid, arole in assignments_cfg:
        if (
            not db.query(MissionAssignment)
            .filter(MissionAssignment.mission_id == mid, MissionAssignment.user_id == uid)
            .first()
        ):
            db.add(
                MissionAssignment(
                    mission_id=mid,
                    user_id=uid,
                    assignment_role=arole,
                    is_active=True,
                )
            )
    db.flush()

    # Populate synthetic dynamic data
    if existing_roles > 0:
        reset_simulated_demo_data(db)
    else:
        _populate_synthetic_demo_records(db, m1, m2, user_objs, now)
        db.commit()

    # Módulo de aislamiento y confinamiento (catálogos)
    seed_isolation_module(db)

    # Misión análoga con signos vitales reales de NASA (reposo en cama, UTMB)
    seed_analog_bed_rest(db)


def _populate_synthetic_demo_records(
    db: Session,
    m1: Mission,
    m2: Mission,
    user_objs: dict,
    now: datetime,
) -> None:
    elena = user_objs["AST-201"]
    marcus = user_objs["AST-202"]
    kenji = user_objs["AST-303"]
    leader = user_objs["LDR-101"]

    # Contexts
    contexts = [
        (m1.id, None, "LUNAR_SURFACE", "SURFACE", "Hábitat Presurizado Selene-Base (Sector Alfa)", "DEMO_SIMULATION", "HIGH", "ONLINE"),
        (m1.id, elena.id, "LUNAR_SURFACE", "SURFACE", "Laboratorio Biomédico Selene-Base", "DEMO_SIMULATION", "HIGH", "ONLINE"),
        (m1.id, marcus.id, "PRESSURIZED_HABITAT", "SURFACE", "Esclusa dePreparación EVA-2", "DEMO_SIMULATION", "HIGH", "ONLINE"),
        (m2.id, kenji.id, "MARS_TRANSIT", "TRANSIT", "Módulo Crucero Ares-Vanguard", "DEMO_SIMULATION", "HIGH", "DELAYED"),
    ]
    for mid, aid, env_c, ph_c, loc, src, conf, conn in contexts:
        db.add(
            MissionContext(
                mission_id=mid,
                astronaut_id=aid,
                environment_code=env_c,
                phase_code=ph_c,
                location_module=loc,
                determination_source=src,
                confidence=conf,
                connectivity_status=conn,
                confirmed_by_user_id=leader.id,
                recorded_at=now - timedelta(minutes=18),
                is_active=True,
                is_simulated=True,
            )
        )

    # Sensors
    sensors = [
        ("BIO-ASTRO-201", "Bio-Monitor Óptico & ECG (Elena)", m1.id, elena.id, "HEART_RATE,SPO2,RESP_RATE,BODY_TEMP", "SIMULATED_ONLINE"),
        ("DOSIM-201", "Dosímetro Personal CPD-Alfa (Elena)", m1.id, elena.id, "RADIATION_EXPOSURE", "SIMULATED_ONLINE"),
        ("BIO-ASTRO-202", "Bio-Monitor Óptico & ECG (Marcus)", m1.id, marcus.id, "HEART_RATE,SPO2,RESP_RATE,BODY_TEMP", "SIMULATED_ONLINE"),
        ("GLUCO-202", "Analizador Metabólico Portátil (Marcus)", m1.id, marcus.id, "BLOOD_GLUCOSE", "OFFLINE"),
        ("BIO-ASTRO-303", "Bio-Monitor Crucero Profundo (Kenji)", m2.id, kenji.id, "HEART_RATE,SPO2,RESP_RATE", "SIMULATED_ONLINE"),
    ]
    for scode, sname, mid, aid, inds, st in sensors:
        existing_s = db.query(SensorRegistry).filter(SensorRegistry.sensor_code == scode).first()
        if existing_s:
            existing_s.status = st
            existing_s.last_seen_at = now - timedelta(minutes=12)
        else:
            db.add(
                SensorRegistry(
                    sensor_code=scode,
                    name=sname,
                    mission_id=mid,
                    astronaut_id=aid,
                    indicator_codes_csv=inds,
                    status=st,
                    last_seen_at=now - timedelta(minutes=12),
                    is_simulated=True,
                )
            )

    # Baselines for astronauts
    baselines_cfg = [
        ("HEART_RATE", 64.0, None),
        ("BLOOD_PRESSURE", 114.0, 72.0),
        ("BODY_TEMP", 36.6, None),
        ("SPO2", 98.5, None),
        ("RESP_RATE", 13.5, None),
        ("BLOOD_GLUCOSE", 88.0, None),
        ("SLEEP_DURATION", 7.8, 8.5),
        ("HYDRATION", 2600.0, None),
        ("PHYSICAL_ACTIVITY", 75.0, 300.0),
        ("PERCEIVED_FATIGUE", 2.0, None),
        ("MOOD_WELLNESS", 8.5, None),
        ("RADIATION_EXPOSURE", 0.05, None),
    ]
    for astro in (elena, marcus, kenji):
        for icode, bval, bsec in baselines_cfg:
            if (
                not db.query(HealthBaseline)
                .filter(HealthBaseline.astronaut_id == astro.id, HealthBaseline.indicator_code == icode)
                .first()
            ):
                db.add(
                    HealthBaseline(
                        astronaut_id=astro.id,
                        indicator_code=icode,
                        baseline_value=bval,
                        baseline_secondary_value=bsec,
                        std_dev=4.0,
                        established_phase="TRAINING",
                        is_simulated=True,
                    )
                )
    db.flush()

    # Longitudinal time series for Elena (14 days across TRAINING -> LAUNCH -> TRANSIT -> SURFACE -> EVA)
    defn_map = {d.code: d for d in db.query(HealthIndicatorDefinition).all()}
    rule_ver_map = {}
    for r in db.query(ClinicalRule).all():
        v = (
            db.query(ClinicalRuleVersion)
            .filter(ClinicalRuleVersion.rule_id == r.id, ClinicalRuleVersion.is_current.is_(True))
            .first()
        )
        if v:
            rule_ver_map[r.indicator_code] = (r, v)

    elena_timeline = [
        # (days_ago, phase, env, hr, sys_bp, dia_bp, temp, spo2, rr, glu, sleep_h, sleep_q, hyd, act, fat, mood, rad)
        (16, "TRAINING", "EARTH_SURFACE", 63, 113, 72, 36.6, 99, 13, 87, 8.0, 9.0, 2700, 80, 2.0, 8.8, 0.02),
        (14, "LAUNCH", "SPACECRAFT_CABIN", 84, 126, 80, 36.9, 98, 16, 94, 6.6, 7.0, 2300, 35, 4.0, 8.0, 0.18),
        (11, "TRANSIT", "LUNAR_ORBIT", 70, 118, 75, 36.7, 98, 14, 90, 7.1, 7.5, 2450, 65, 3.2, 8.2, 0.36),
        (8, "TRANSIT", "LUNAR_ORBIT", 72, 120, 76, 36.8, 97, 14, 92, 6.8, 7.2, 2400, 70, 3.5, 7.9, 0.41),
        (5, "SURFACE", "LUNAR_SURFACE", 74, 121, 77, 36.8, 97, 15, 93, 6.9, 7.4, 2500, 75, 3.8, 8.1, 0.48),
        (3, "EVA", "EXTRAVEHICULAR_ACTIVITY", 89, 129, 82, 37.2, 96, 17, None, 6.2, 6.8, 2200, 95, 5.2, 7.6, 0.65),
        (1, "SURFACE", "LUNAR_SURFACE", 76, 124, 79, 36.8, 97, 15, 95, 6.4, 6.8, 2150, 65, 4.6, 7.5, 0.44),
        (0, "SURFACE", "LUNAR_SURFACE", 93, 131, 84, 36.9, 97, 16, None, 5.8, 6.0, 1950, 60, 5.4, 7.2, 0.46),
    ]

    for (
        d_ago,
        ph,
        env,
        hr,
        sbp,
        dbp,
        tmp,
        spo2,
        rr,
        glu,
        slp_h,
        slp_q,
        hyd,
        act,
        fat,
        mood,
        rad,
    ) in elena_timeline:
        ts = now - timedelta(days=d_ago, hours=1)
        row_items = [
            ("HEART_RATE", hr, None),
            ("BLOOD_PRESSURE", sbp, dbp),
            ("BODY_TEMP", tmp, None),
            ("SPO2", spo2, None),
            ("RESP_RATE", rr, None),
            ("SLEEP_DURATION", slp_h, slp_q),
            ("HYDRATION", hyd, None),
            ("PHYSICAL_ACTIVITY", act, 340.0),
            ("PERCEIVED_FATIGUE", fat, None),
            ("MOOD_WELLNESS", mood, None),
            ("RADIATION_EXPOSURE", rad, None),
        ]
        if glu is not None:
            row_items.append(("BLOOD_GLUCOSE", glu, None))

        for icode, val, sec_val in row_items:
            defn = defn_map[icode]
            r_pair = rule_ver_map.get(icode)
            ver = r_pair[1] if r_pair else None
            state = "NORMAL"
            if ver and (val < ver.monitor_min or val > ver.monitor_max):
                state = "WARNING"
            elif ver and (val < ver.normal_min or val > ver.normal_max):
                state = "MONITOR"

            m = HealthMeasurement(
                astronaut_id=elena.id,
                mission_id=m1.id,
                indicator_code=icode,
                value=float(val),
                secondary_value=float(sec_val) if sec_val is not None else None,
                unit=defn.unit,
                measured_at=ts,
                received_at=ts + timedelta(minutes=2),
                phase_code=ph,
                environment_code=env,
                source_code="DEMO_SIMULATION",
                data_quality="SYNTHETIC_DEMO",
                calculated_state=state,
                rule_version_id=ver.id if ver else None,
                is_simulated=True,
                notes=f"[SIMULADO] Registro histórico de fase {ph}.",
            )
            db.add(m)
            db.flush()

            if d_ago == 0 and state in ("MONITOR", "WARNING"):
                rule_obj = r_pair[0]
                db.add(
                    Alert(
                        astronaut_id=elena.id,
                        mission_id=m1.id,
                        indicator_code=icode,
                        measurement_id=m.id,
                        rule_version_id=ver.id,
                        rule_code=rule_obj.rule_code,
                        rule_version_label=ver.version_number,
                        value_recorded=f"{val:g}" if sec_val is None else f"{val:g}/{sec_val:g}",
                        unit=defn.unit,
                        priority="LOW" if state == "MONITOR" else "MEDIUM",
                        operational_state=state,
                        status="NEW",
                        title=f"[{state}] {defn.name}: {val:g} {defn.unit} (SIMULADO)",
                        explanation=(
                            f"El indicador {defn.name} registró {val:g} {defn.unit}, superando el rango habitual "
                            f"[{ver.normal_min}–{ver.normal_max} {defn.unit}] según protocolo {rule_obj.rule_code} ({ver.version_number}). "
                            "Señal operativa preventiva (no diagnóstica)."
                        ),
                        data_quality="SYNTHETIC_DEMO",
                        immediate_action=ver.immediate_instructions,
                        followup_recommendation=ver.followup_instructions,
                        environment_code=env,
                        phase_code=ph,
                        is_simulated=True,
                        created_at=ts,
                        updated_at=ts,
                    )
                )

    # Measurements for Marcus Vance (includes a WARNING alert on Sleep/Fatigue & Hydration)
    marcus_samples = [
        ("HEART_RATE", 78.0, None, "NORMAL"),
        ("BLOOD_PRESSURE", 126.0, 82.0, "NORMAL"),
        ("BODY_TEMP", 36.8, None, "NORMAL"),
        ("SPO2", 97.0, None, "NORMAL"),
        ("RESP_RATE", 16.0, None, "NORMAL"),
        ("SLEEP_DURATION", 5.1, 5.0, "WARNING"),
        ("HYDRATION", 1550.0, None, "WARNING"),
        ("PHYSICAL_ACTIVITY", 55.0, 390.0, "NORMAL"),
        ("PERCEIVED_FATIGUE", 7.1, None, "WARNING"),
        ("MOOD_WELLNESS", 6.2, None, "NORMAL"),
        ("RADIATION_EXPOSURE", 0.51, None, "NORMAL"),
    ]
    for icode, val, sec_v, st in marcus_samples:
        defn = defn_map[icode]
        r_pair = rule_ver_map.get(icode)
        ver = r_pair[1] if r_pair else None
        m = HealthMeasurement(
            astronaut_id=marcus.id,
            mission_id=m1.id,
            indicator_code=icode,
            value=val,
            secondary_value=sec_v,
            unit=defn.unit,
            measured_at=now - timedelta(hours=2),
            received_at=now - timedelta(hours=2),
            phase_code="SURFACE",
            environment_code="PRESSURIZED_HABITAT",
            source_code="DEMO_SIMULATION",
            data_quality="SYNTHETIC_DEMO",
            calculated_state=st,
            rule_version_id=ver.id if ver else None,
            is_simulated=True,
            notes="[SIMULADO] Evaluación de turno en Hábitat Selene-Base.",
        )
        db.add(m)
        db.flush()
        if st == "WARNING" and r_pair:
            db.add(
                Alert(
                    astronaut_id=marcus.id,
                    mission_id=m1.id,
                    indicator_code=icode,
                    measurement_id=m.id,
                    rule_version_id=ver.id,
                    rule_code=r_pair[0].rule_code,
                    rule_version_label=ver.version_number,
                    value_recorded=f"{val:g}",
                    unit=defn.unit,
                    priority="HIGH",
                    operational_state="WARNING",
                    status="NEW",
                    title=f"[WARNING] {defn.name} ({marcus.full_name}): {val:g} {defn.unit}",
                    explanation=(
                        f"Lectura de {defn.name} ({val:g} {defn.unit}) requiere seguimiento preventivo post-EVA "
                        f"conforme a {r_pair[0].rule_code} v{ver.version_number}."
                    ),
                    data_quality="SYNTHETIC_DEMO",
                    immediate_action=ver.immediate_instructions,
                    followup_recommendation=ver.followup_instructions,
                    environment_code="PRESSURIZED_HABITAT",
                    phase_code="SURFACE",
                    is_simulated=True,
                    created_at=now - timedelta(hours=2),
                )
            )

    # Measurements for Kenji (Ares Pathfinder)
    for icode, val in [("HEART_RATE", 66.0), ("SPO2", 98.0), ("SLEEP_DURATION", 7.4), ("RADIATION_EXPOSURE", 0.78)]:
        defn = defn_map[icode]
        ver = rule_ver_map[icode][1]
        db.add(
            HealthMeasurement(
                astronaut_id=kenji.id,
                mission_id=m2.id,
                indicator_code=icode,
                value=val,
                unit=defn.unit,
                measured_at=now - timedelta(hours=3),
                received_at=now - timedelta(hours=3),
                phase_code="TRANSIT",
                environment_code="MARS_TRANSIT",
                source_code="DEMO_SIMULATION",
                data_quality="SYNTHETIC_DEMO",
                calculated_state="NORMAL",
                rule_version_id=ver.id,
                is_simulated=True,
                notes="[SIMULADO] Telemetría de tránsito profundo Ares Pathfinder.",
            )
        )

    # Environmental Telemetry for Mission 1
    env_Telemetry = [
        ("CABIN_TEMP", "Temperatura Ambiental de Cabina", 21.8, "Nominal", "°C", "AVAILABLE", "NORMAL"),
        ("HUMIDITY", "Humedad Relativa", 46.0, "Confortable", "%", "AVAILABLE", "NORMAL"),
        ("CABIN_PRESSURE", "Presión Total de Hábitat", 101.2, "Nominal", "kPa", "AVAILABLE", "NORMAL"),
        ("PPO2", "Presión Parcial de Oxígeno (ppO₂)", 21.1, "Nominal", "kPa", "AVAILABLE", "NORMAL"),
        ("CO2_LEVEL", "Concentración de CO₂", 2.9, "En observación (<3.5 mmHg)", "mmHg", "AVAILABLE", "MONITOR"),
        ("RADIATION_DOSE", "Tasa de Radiación Ambiental", 0.46, "Flujo solar moderado", "mSv/día", "AVAILABLE", "NORMAL"),
        ("AIR_QUALITY", "Índice de Calidad del Aire (VOCs)", 96.0, "Óptimo", "ICA", "AVAILABLE", "NORMAL"),
        ("PARTICULATES", "Partículas y Polvo Lunar (PM2.5)", 12.0, "Filtración HEPA activa", "µg/m³", "AVAILABLE", "NORMAL"),
        ("LIGHTING_LUX", "Iluminación Circadiana del Módulo", 420.0, "Fase diurna activa", "lux", "AVAILABLE", "NORMAL"),
        ("NOISE_DB", "Nivel Acústico de Fondo", 54.0, "Ventilación ECLSS continua", "dBA", "AVAILABLE", "NORMAL"),
        ("VENTILATION_STATE", "Estado de Ventilación", 100.0, "NOMINAL_FLOW", "%", "AVAILABLE", "NORMAL"),
        ("ECLSS_STATE", "Soporte Vital Regenerativo (ECLSS)", 99.0, "OPERATIONAL_REDUNDANT", "%", "AVAILABLE", "NORMAL"),
        ("SUIT_STATE", "Integración de Trajes EVA", None, "STANDBY_IN_AIRLOCK (Sin EVA activa)", "psi", "NOT_APPLICABLE", "UNKNOWN"),
    ]
    for pcode, pname, val, txt, unit, avail, st in env_Telemetry:
        db.add(
            EnvironmentalMeasurement(
                mission_id=m1.id,
                environment_code="LUNAR_SURFACE",
                phase_code="SURFACE",
                parameter_code=pcode,
                parameter_name=pname,
                value=val,
                text_state=txt,
                unit=unit,
                source_code="DEMO_SIMULATION",
                data_quality="SYNTHETIC_DEMO",
                availability_status=avail,
                calculated_state=st,
                measured_at=now - timedelta(minutes=20),
                is_simulated=True,
            )
        )

    # Wellness Assessments (Elena & Marcus)
    db.add(
        PsychologicalWellnessAssessment(
            astronaut_id=elena.id,
            mission_id=m1.id,
            instrument_code="SPACE_WELLNESS_CHECK_DEMO",
            is_draft=False,
            mood_score=8,
            stress_score=4,
            sleep_quality_score=7,
            sleep_hours=6.8,
            fatigue_score=4,
            concentration_score=8,
            isolation_score=3,
            adaptation_score=9,
            social_support_score=8,
            recovery_score=7,
            request_additional_support=False,
            support_urgency="NONE",
            private_reflection="[DEMO PRIVADO - Elena] Buena adaptación al ritmo del hábitat lunar; planeo usar la guía de respiración antes de dormir.",
            share_operational_signal_with_leader=True,
            operational_wellness_state="WELLNESS_STABLE",
            phase_code="SURFACE",
            environment_code="LUNAR_SURFACE",
            is_simulated=True,
            created_at=now - timedelta(days=1),
        )
    )
    db.add(
        PsychologicalWellnessAssessment(
            astronaut_id=marcus.id,
            mission_id=m1.id,
            instrument_code="SPACE_WELLNESS_CHECK_DEMO",
            is_draft=False,
            mood_score=6,
            stress_score=6,
            sleep_quality_score=5,
            sleep_hours=5.1,
            fatigue_score=7,
            concentration_score=6,
            isolation_score=6,
            adaptation_score=7,
            social_support_score=7,
            recovery_score=5,
            request_additional_support=False,
            support_urgency="ROUTINE_COUNSELING",
            private_reflection="[DEMO PRIVADO - Marcus] Algo de cansancio acumulado tras la preparación de muestras lunares.",
            share_operational_signal_with_leader=True,
            operational_wellness_state="WELLNESS_MONITORING",
            phase_code="SURFACE",
            environment_code="PRESSURIZED_HABITAT",
            is_simulated=True,
            created_at=now - timedelta(hours=6),
        )
    )

    # Initial Gamification Events & Badges for Elena
    yesterday_str = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    today_str = now.strftime("%Y-%m-%d")
    initial_events = [
        (elena.id, "DAILY_HEALTH_CHECK", yesterday_str, "COMPLETED", 35, "Rutina completada: evaluación registrada."),
        (elena.id, "SLEEP_LOG", yesterday_str, "COMPLETED", 25, "Buen trabajo: registraste tu descanso."),
        (elena.id, "LEARNING_MISSION", yesterday_str, "COMPLETED", 25, "Exploraste el módulo cardiovascular."),
        (elena.id, "PULSE_CHECK", today_str, "COMPLETED", 25, "Medición de pulso verificada."),
        (elena.id, "ENVIRONMENTAL_AWARENESS", today_str, "COMPLETED", 20, "Revisión ambiental completada."),
        (elena.id, "MOVE_SAFELY", (now - timedelta(days=2)).strftime("%Y-%m-%d"), "EXCUSED_OPERATIONAL_RESTRICTION", 0, "Omitida durante EVA programada sin penalización."),
    ]
    for uid, mcode, dstr, st, xp, msg in initial_events:
        db.add(
            GamificationEvent(
                user_id=uid,
                daily_mission_code=mcode,
                event_date_str=dstr,
                status=st,
                xp_awarded=xp,
                reinforcement_message=msg,
                is_simulated=True,
                completed_at=now - timedelta(hours=4),
            )
        )

    for bcode, reason in [
        ("FIRST_HEALTH_CHECK", "Primer registro fisiológico validado en misión Artemis IV."),
        ("CONSISTENCY_STREAK", "Racha de 5 días de participación constante."),
        ("SLEEP_ROUTINE_COMPLETED", "Registro de rutina de descanso completado."),
        ("LEARNING_EXPLORER", "Exploración de cápsulas educativas en Body Explorer."),
        ("COGNITIVE_MISSION_COMPLETED", "Primera actividad cognitiva interactiva completada en misión."),
        ("MEMORY_EXPLORER", "Evaluación del dominio MEMORY completada en Hábitat Selene-Base."),
    ]:
        if not db.query(UserBadge).filter(UserBadge.user_id == elena.id, UserBadge.badge_code == bcode).first():
            db.add(
                UserBadge(
                    user_id=elena.id,
                    badge_code=bcode,
                    awarded_reason=reason,
                    awarded_at=now - timedelta(days=1),
                )
            )

    admin_user = user_objs["ADM-001"]

    # 8. Module 1 — Communication Center Demo Records (1-on-1 Conversations, Messages & Support Requests)
    conv_elena = (
        db.query(Conversation)
        .filter(
            Conversation.mission_id == m1.id,
            Conversation.astronaut_id == elena.id,
            Conversation.leader_id == leader.id,
        )
        .first()
    )
    if not conv_elena:
        conv_elena = Conversation(
            mission_id=m1.id,
            astronaut_id=elena.id,
            leader_id=leader.id,
            subject="Canal Directo: Cmdr. Elena Rostova ↔ Dir. Carlos Ibáñez",
            status="OPEN",
            is_highlighted=True,
            last_message_at=now - timedelta(minutes=15),
            is_simulated=True,
        )
        db.add(conv_elena)
        db.flush()
        db.add(
            ConversationParticipant(
                conversation_id=conv_elena.id,
                user_id=elena.id,
                role_in_conversation="ASTRONAUT",
                last_seen_at=now - timedelta(minutes=5),
            )
        )
        db.add(
            ConversationParticipant(
                conversation_id=conv_elena.id,
                user_id=leader.id,
                role_in_conversation="MISSION_LEADER",
                last_seen_at=now - timedelta(minutes=2),
            )
        )

    msg1 = Message(
        conversation_id=conv_elena.id,
        sender_id=elena.id,
        recipient_id=leader.id,
        category="HEALTH_UPDATE",
        content="[SIMULADO] Hola Dir. Carlos, finalicé el turno de superficie lunar. Registré pulso ligeramente elevado (93 bpm) e hidratación en 1950 ml; ya inicié pauta de rehidratación fraccionada.",
        delivery_status="READ",
        is_important=True,
        is_simulated=True,
        created_at=now - timedelta(hours=2),
        sent_at=now - timedelta(hours=2),
    )
    db.add(msg1)
    db.flush()
    db.add(
        MessageReadReceipt(
            message_id=msg1.id,
            user_id=leader.id,
            read_at=now - timedelta(hours=1, minutes=50),
        )
    )

    msg2 = Message(
        conversation_id=conv_elena.id,
        sender_id=leader.id,
        recipient_id=elena.id,
        category="MISSION_COORDINATION",
        content="[SIMULADO] Recibido Cmdr. Elena. Confirmamos desde Control en Tierra tu lectura en estado MONITOR. Mantén reposo relativo antes del bloque de sueño y avísanos tras tu próxima toma de agua.",
        delivery_status="DELIVERED",
        reply_to_message_id=msg1.id,
        is_important=False,
        marked_unread_by_recipient=True,
        is_simulated=True,
        created_at=now - timedelta(minutes=15),
        sent_at=now - timedelta(minutes=15),
    )
    db.add(msg2)
    db.flush()
    db.add(
        MessageNotification(
            user_id=elena.id,
            conversation_id=conv_elena.id,
            message_id=msg2.id,
            title="Nuevo mensaje de Dir. Carlos Ibáñez",
            is_read=False,
        )
    )

    conv_marcus = (
        db.query(Conversation)
        .filter(
            Conversation.mission_id == m1.id,
            Conversation.astronaut_id == marcus.id,
            Conversation.leader_id == leader.id,
        )
        .first()
    )
    if not conv_marcus:
        conv_marcus = Conversation(
            mission_id=m1.id,
            astronaut_id=marcus.id,
            leader_id=leader.id,
            subject="Canal Directo: Dr. Marcus Vance ↔ Dir. Carlos Ibáñez",
            status="OPEN",
            is_highlighted=False,
            last_message_at=now - timedelta(hours=1),
            is_simulated=True,
        )
        db.add(conv_marcus)
        db.flush()
        db.add(
            ConversationParticipant(
                conversation_id=conv_marcus.id,
                user_id=marcus.id,
                role_in_conversation="ASTRONAUT",
                last_seen_at=now - timedelta(minutes=25),
            )
        )
        db.add(
            ConversationParticipant(
                conversation_id=conv_marcus.id,
                user_id=leader.id,
                role_in_conversation="MISSION_LEADER",
                last_seen_at=now - timedelta(minutes=2),
            )
        )

    msg_m1 = Message(
        conversation_id=conv_marcus.id,
        sender_id=marcus.id,
        recipient_id=leader.id,
        category="REQUEST_FOR_ASSISTANCE",
        content="[SIMULADO] Equipo en Tierra, dormí 5.1 horas y siento fatiga acumulada tras catalogar muestras. Solicito ajuste preventivo en el cronograma secundario de mañana.",
        delivery_status="READ",
        is_important=True,
        is_simulated=True,
        created_at=now - timedelta(hours=1, minutes=20),
        sent_at=now - timedelta(hours=1, minutes=20),
    )
    db.add(msg_m1)
    db.flush()

    db.add(
        SupportRequest(
            mission_id=m1.id,
            astronaut_id=marcus.id,
            leader_id=leader.id,
            conversation_id=conv_marcus.id,
            category="COGNITIVE_SUPPORT",
            reason_title="Ajuste preventivo de carga por fatiga de sueño (5.1 h)",
            description="[SIMULADO] Solicitud de redistribución de carga operativa y revisión de higiene de sueño tras alerta WARNING de descanso (5.1 h).",
            wants_private_conversation=True,
            is_emergency=False,
            status="IN_REVIEW",
            leader_response_notes="En revisión con planificación de vuelo para ampliar ventana de descanso nocturno.",
            emergency_protocol_displayed=False,
            is_simulated=True,
            created_at=now - timedelta(hours=1, minutes=15),
        )
    )

    # 9. Module 2 — Cognitive Performance Center Demo Records (Baselines, Schedules & Longitudinal History)
    tests_by_dom = {
        t.domain_code: t
        for t in db.query(CognitiveTest).all()
    }
    for dom_code, base_acc, base_rt in [
        ("MEMORY", 92.0, 1450.0),
        ("ATTENTION", 95.0, 980.0),
        ("VISUAL_TRACKING", 90.0, 1620.0),
        ("SPATIAL_ORIENTATION", 88.0, 1750.0),
        ("VISUAL_LEARNING", 91.0, 1520.0),
    ]:
        for astro_u in (elena, marcus):
            existing_cb = (
                db.query(CognitiveBaseline)
                .filter(
                    CognitiveBaseline.astronaut_id == astro_u.id,
                    CognitiveBaseline.domain_code == dom_code,
                    CognitiveBaseline.difficulty == "INTERMEDIATE",
                    CognitiveBaseline.version_number == "1.0-DEMO",
                )
                .first()
            )
            if not existing_cb:
                db.add(
                    CognitiveBaseline(
                        astronaut_id=astro_u.id,
                        domain_code=dom_code,
                        difficulty="INTERMEDIATE",
                        version_number="1.0-DEMO",
                        baseline_accuracy_percent=base_acc,
                        baseline_mean_rt_ms=base_rt,
                        established_at=now - timedelta(days=16),
                        is_simulated=True,
                    )
                )

    # Historical cognitive assessments for Elena across phases (TRAINING -> TRANSIT -> SURFACE)
    elena_cog_history = [
        ("MEMORY", 15, "TRAINING", "EARTH_SURFACE", 94.0, 1410.0, False, "READY", 1),
        ("MEMORY", 9, "TRANSIT", "LUNAR_ORBIT", 90.0, 1510.0, False, "READY", 2),
        ("MEMORY", 1, "SURFACE", "LUNAR_SURFACE", 86.0, 1640.0, False, "READY", 3),
        ("ATTENTION", 15, "TRAINING", "EARTH_SURFACE", 96.0, 950.0, False, "READY", 1),
        ("ATTENTION", 8, "TRANSIT", "LUNAR_ORBIT", 92.0, 1040.0, False, "READY", 2),
        ("ATTENTION", 0, "SURFACE", "LUNAR_SURFACE", 66.7, 1320.0, True, "FATIGUED", 3),
        ("VISUAL_TRACKING", 4, "SURFACE", "LUNAR_SURFACE", 91.0, 1580.0, False, "READY", 1),
    ]
    for dom_c, d_ago, ph_c, env_c, acc_pct, rt_ms, req_rev, r_stat, att_num in elena_cog_history:
        ct_obj = tests_by_dom.get(dom_c)
        if not ct_obj:
            continue
        ts_c = now - timedelta(days=d_ago, hours=2)
        ca = CognitiveAssessment(
            astronaut_id=elena.id,
            mission_id=m1.id,
            domain_code=dom_c,
            test_code=ct_obj.code,
            version_number="1.0-DEMO",
            difficulty="INTERMEDIATE",
            phase_code=ph_c,
            environment_code=env_c,
            readiness_status=r_stat,
            conditions_notes=f"[SIMULADO] Sesión realizada en fase {ph_c}.",
            completion_status="COMPLETED",
            attempt_number=att_num,
            duration_seconds=round((rt_ms * 3) / 1000.0, 1),
            source_code="DEMO_SIMULATION",
            is_simulated=True,
            started_at=ts_c - timedelta(minutes=2),
            completed_at=ts_c,
        )
        db.add(ca)
        db.flush()
        db.add(
            CognitiveAssessmentSession(
                assessment_id=ca.id,
                current_step_index=3,
                autosave_state_json=json.dumps({"completed": True, "phase": ph_c}),
            )
        )
        db.add(
            CognitiveResult(
                assessment_id=ca.id,
                total_items=3,
                correct_count=3 if acc_pct >= 85 else 2,
                incorrect_count=0 if acc_pct >= 85 else 1,
                omissions_count=0,
                accuracy_percent=acc_pct,
                mean_response_time_ms=rt_ms,
                response_time_variability_ms=42.0,
                moves_count=3,
                targets_tracked=3 if dom_c == "VISUAL_TRACKING" else 0,
                requires_review=req_rev,
                practice_effect_note=(
                    f"Intento #{att_num} en dificultad INTERMEDIATE (v1.0-DEMO). "
                    "Sólo comparable con evaluaciones del mismo dominio, dificultad y versión."
                ),
                non_diagnostic_summary=(
                    f"[SIMULADO] Desempeño en dominio {dom_c}: {acc_pct:.1f}% de precisión y {rt_ms:.0f} ms de tiempo medio. "
                    "Evaluación orientativa específica por dominio (no representa un puntaje global de inteligencia ni un diagnóstico clínico)."
                ),
                created_at=ts_c,
            )
        )

    # Cognitive Schedules for Elena & Marcus
    for astro_u, dom_c in [
        (elena, "SPATIAL_ORIENTATION"),
        (elena, "VISUAL_LEARNING"),
        (marcus, "ATTENTION"),
    ]:
        ct_obj = tests_by_dom.get(dom_c)
        if ct_obj:
            db.add(
                CognitiveSchedule(
                    astronaut_id=astro_u.id,
                    mission_id=m1.id,
                    domain_code=dom_c,
                    test_code=ct_obj.code,
                    difficulty="INTERMEDIATE",
                    scheduled_for=now + timedelta(hours=18),
                    assigned_by_user_id=leader.id,
                    status="PENDING",
                    is_simulated=True,
                )
            )

    # 10. Module 3 — Emotional Assessment Center Demo Records (Admin Requests & Astronaut Check-Ins)
    eq_obj = db.query(EmotionalQuestionnaire).filter(EmotionalQuestionnaire.code == "EMOTIONAL_CHECKIN_DEMO_V1").first()
    if eq_obj:
        # Request 1: Elena (COMPLETED yesterday)
        req_elena_done = EmotionalAssessmentRequest(
            requested_by_admin_id=admin_user.id,
            astronaut_id=elena.id,
            mission_id=m1.id,
            questionnaire_code=eq_obj.code,
            version_number="1.0-DEMO",
            periodicity="WEEKLY",
            is_recurring=True,
            priority="NORMAL",
            custom_message="Hola Cmdr. Elena, te invitamos a completar tu cuestionario preventivo semanal de adaptación en Selene-Base.",
            status="COMPLETED",
            status_history_json=json.dumps(
                [
                    {"status": "SENT", "at": (now - timedelta(days=1, hours=4)).isoformat()},
                    {"status": "IN_PROGRESS", "at": (now - timedelta(days=1, hours=2)).isoformat()},
                    {"status": "COMPLETED", "at": (now - timedelta(days=1, hours=1)).isoformat()},
                ]
            ),
            created_at=now - timedelta(days=1, hours=4),
            sent_at=now - timedelta(days=1, hours=4),
            due_at=now - timedelta(hours=12),
            completed_at=now - timedelta(days=1, hours=1),
            is_simulated=True,
        )
        db.add(req_elena_done)
        db.flush()

        ea_elena = EmotionalAssessment(
            request_id=req_elena_done.id,
            astronaut_id=elena.id,
            mission_id=m1.id,
            questionnaire_code=eq_obj.code,
            version_number="1.0-DEMO",
            phase_code="SURFACE",
            environment_code="LUNAR_SURFACE",
            is_draft=False,
            share_summary_with_leader=True,
            allow_admin_detailed_review=False,
            started_at=now - timedelta(days=1, hours=2),
            completed_at=now - timedelta(days=1, hours=1),
            is_simulated=True,
        )
        db.add(ea_elena)
        db.flush()

        db.add(
            EmotionalAssessmentResult(
                assessment_id=ea_elena.id,
                operational_state="EMOTIONAL_WELLNESS_STABLE",
                explicit_support_requested=False,
                urgent_protocol_triggered=False,
                authorized_operational_summary=(
                    "Estado operativo: EMOTIONAL_WELLNESS_STABLE. Cuestionario completado a tiempo sin solicitud de apoyo urgente."
                ),
                personal_feedback_summary=(
                    "Gracias por completar tu check-in emocional. Tus respuestas reflejan una adaptación estable "
                    "y buen respaldo interpersonal durante la fase de superficie lunar."
                ),
                recommended_next_step="Mantener rutina de higiene circadiana pre-sueño y contacto periódico con el líder en Tierra.",
            )
        )

        # Request 2: Elena (New active request SENT by Admin for today)
        req_elena_active = EmotionalAssessmentRequest(
            requested_by_admin_id=admin_user.id,
            astronaut_id=elena.id,
            mission_id=m1.id,
            questionnaire_code=eq_obj.code,
            version_number="1.0-DEMO",
            periodicity="PHASE_CHANGE",
            is_recurring=False,
            priority="HIGH",
            custom_message="Estimada Cmdr. Elena: tras las actividades extravehiculares recientes, agradeceremos tu check-in breve sobre descanso, carga percibida y necesidad de apoyo.",
            status="SENT",
            status_history_json=json.dumps([{"status": "SENT", "at": (now - timedelta(hours=2)).isoformat()}]),
            created_at=now - timedelta(hours=2),
            sent_at=now - timedelta(hours=2),
            due_at=now + timedelta(days=1),
            is_simulated=True,
        )
        db.add(req_elena_active)
        db.flush()
        db.add(
            EmotionalAssessmentNotification(
                user_id=elena.id,
                request_id=req_elena_active.id,
                title="Nuevo cuestionario emocional solicitado por Administración",
                message="Se ha solicitado tu participación en el Check-In Emocional Post-EVA Lunar.",
                is_read=False,
            )
        )

        # Request 3: Marcus (SENT / Pending completion)
        req_marcus_active = EmotionalAssessmentRequest(
            requested_by_admin_id=admin_user.id,
            astronaut_id=marcus.id,
            mission_id=m1.id,
            questionnaire_code=eq_obj.code,
            version_number="1.0-DEMO",
            periodicity="ONCE",
            is_recurring=False,
            priority="HIGH",
            custom_message="Dr. Marcus: te enviamos este cuestionario breve para acompañar tu recuperación tras la jornada de geología lunar.",
            status="SENT",
            status_history_json=json.dumps([{"status": "SENT", "at": (now - timedelta(hours=3)).isoformat()}]),
            created_at=now - timedelta(hours=3),
            sent_at=now - timedelta(hours=3),
            due_at=now + timedelta(hours=12),
            is_simulated=True,
        )
        db.add(req_marcus_active)
        db.flush()
        db.add(
            EmotionalAssessmentNotification(
                user_id=marcus.id,
                request_id=req_marcus_active.id,
                title="Nuevo cuestionario emocional solicitado: Seguimiento de Descanso",
                message="Por favor completa tu check-in emocional cuando dispongas de 5 minutos.",
                is_read=False,
            )
        )


def reset_simulated_demo_data(db: Session) -> Dict[str, int]:
    """
    Safely resets ONLY synthetic/simulated records (is_simulated=True) and restores
    the reproducible baseline demo dataset, preserving any non-simulated records.
    """
    # Clean up Module 1 simulated records
    sim_conv_ids = [c.id for c in db.query(Conversation).filter(Conversation.is_simulated.is_(True)).all()]
    if sim_conv_ids:
        db.query(MessageNotification).filter(MessageNotification.conversation_id.in_(sim_conv_ids)).delete(synchronize_session=False)
        sim_msg_ids = [m.id for m in db.query(Message).filter(Message.conversation_id.in_(sim_conv_ids)).all()]
        if sim_msg_ids:
            db.query(MessageReadReceipt).filter(MessageReadReceipt.message_id.in_(sim_msg_ids)).delete(synchronize_session=False)
            db.query(MessageAttachment).filter(MessageAttachment.message_id.in_(sim_msg_ids)).delete(synchronize_session=False)
        db.query(Message).filter(Message.conversation_id.in_(sim_conv_ids)).delete(synchronize_session=False)
        db.query(ConversationParticipant).filter(ConversationParticipant.conversation_id.in_(sim_conv_ids)).delete(synchronize_session=False)
    db.query(SupportRequest).filter(SupportRequest.is_simulated.is_(True)).delete(synchronize_session=False)
    db.query(Conversation).filter(Conversation.is_simulated.is_(True)).delete(synchronize_session=False)

    # Clean up Module 2 simulated records
    sim_cog_ids = [ca.id for ca in db.query(CognitiveAssessment).filter(CognitiveAssessment.is_simulated.is_(True)).all()]
    if sim_cog_ids:
        db.query(CognitiveAssessmentSession).filter(CognitiveAssessmentSession.assessment_id.in_(sim_cog_ids)).delete(synchronize_session=False)
        db.query(CognitiveResponse).filter(CognitiveResponse.assessment_id.in_(sim_cog_ids)).delete(synchronize_session=False)
        db.query(CognitiveResult).filter(CognitiveResult.assessment_id.in_(sim_cog_ids)).delete(synchronize_session=False)
        db.query(CognitiveFeedback).filter(CognitiveFeedback.assessment_id.in_(sim_cog_ids)).delete(synchronize_session=False)
    db.query(CognitiveAssessment).filter(CognitiveAssessment.is_simulated.is_(True)).delete(synchronize_session=False)
    db.query(CognitiveSchedule).filter(CognitiveSchedule.is_simulated.is_(True)).delete(synchronize_session=False)
    db.query(CognitiveBaseline).filter(CognitiveBaseline.is_simulated.is_(True)).delete(synchronize_session=False)

    # Clean up Module 3 simulated records
    sim_ea_ids = [ea.id for ea in db.query(EmotionalAssessment).filter(EmotionalAssessment.is_simulated.is_(True)).all()]
    if sim_ea_ids:
        db.query(EmotionalAssessmentResponse).filter(EmotionalAssessmentResponse.assessment_id.in_(sim_ea_ids)).delete(synchronize_session=False)
        db.query(EmotionalAssessmentResult).filter(EmotionalAssessmentResult.assessment_id.in_(sim_ea_ids)).delete(synchronize_session=False)
        db.query(EmotionalSupportRequest).filter(EmotionalSupportRequest.assessment_id.in_(sim_ea_ids)).delete(synchronize_session=False)
    sim_req_ids = [r.id for r in db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.is_simulated.is_(True)).all()]
    if sim_req_ids:
        db.query(EmotionalAssessmentNotification).filter(EmotionalAssessmentNotification.request_id.in_(sim_req_ids)).delete(synchronize_session=False)
        db.query(EmotionalFollowUp).filter(EmotionalFollowUp.request_id.in_(sim_req_ids)).delete(synchronize_session=False)
    db.query(EmotionalAssessment).filter(EmotionalAssessment.is_simulated.is_(True)).delete(synchronize_session=False)
    db.query(EmotionalAssessmentRequest).filter(EmotionalAssessmentRequest.is_simulated.is_(True)).delete(synchronize_session=False)

    del_alerts = db.query(Alert).filter(Alert.is_simulated.is_(True)).delete(synchronize_session=False)
    del_meas = db.query(HealthMeasurement).filter(HealthMeasurement.is_simulated.is_(True)).delete(synchronize_session=False)
    del_env = db.query(EnvironmentalMeasurement).filter(EnvironmentalMeasurement.is_simulated.is_(True)).delete(synchronize_session=False)
    del_well = db.query(PsychologicalWellnessAssessment).filter(PsychologicalWellnessAssessment.is_simulated.is_(True)).delete(synchronize_session=False)
    del_gam = db.query(GamificationEvent).filter(GamificationEvent.is_simulated.is_(True)).delete(synchronize_session=False)
    del_ctx = db.query(MissionContext).filter(MissionContext.is_simulated.is_(True)).delete(synchronize_session=False)
    db.query(DataQualityEvent).delete(synchronize_session=False)
    db.commit()

    m1 = db.query(Mission).filter(Mission.code == "ARTEMIS-IV-DEMO").first()
    m2 = db.query(Mission).filter(Mission.code == "ARES-PATHFINDER-DEMO").first()
    user_objs = {u.crew_code: u for u in db.query(User).all()}
    if m1 and m2 and "AST-201" in user_objs:
        _populate_synthetic_demo_records(db, m1, m2, user_objs, utcnow())
        db.commit()

    return {
        "deleted_simulated_measurements": del_meas,
        "deleted_simulated_alerts": del_alerts,
        "deleted_simulated_env_records": del_env,
        "deleted_simulated_wellness": del_well,
        "deleted_simulated_gamification_events": del_gam,
        "deleted_simulated_contexts": del_ctx,
    }



# ============================================================================
# MÓDULO DE AISLAMIENTO Y CONFINAMIENTO — migración ligera + catálogos idempotentes
# ============================================================================

NASA_GARDEN_SOURCE = (
    "NASA — Can Space Gardening Help Astronauts Cope with Isolation?",
    "https://www.nasa.gov/humans-in-space/can-space-gardening-help-astronauts-cope-with-isolation/",
)
NASA_HRP_SOURCE = (
    "NASA Human Research Program — Isolation and Confinement / Behavioral Health",
    "https://www.nasa.gov/hrp/",
)

# (code, title, category, minutes, description, how_to, solo_or_group, source)
LEISURE_ACTIVITIES_DATA = [
    ("PLANT_CARE", "Cuidar las plantas del huerto", "PLANTS", 15,
     "Revisar, regar y observar los cultivos del huerto del hábitat. Cuidar algo vivo aporta rutina, propósito y contacto con lo natural.",
     ["Revisa la humedad del sustrato y el nivel de agua", "Observa hojas nuevas o cambios de color", "Anota en tu diario cómo ha crecido desde la última vez"],
     "SOLO", NASA_GARDEN_SOURCE),
    ("PLANT_JOURNAL", "Diario de crecimiento del huerto", "PLANTS", 10,
     "Fotografiar o dibujar una planta y registrar su evolución día a día.",
     ["Elige una planta del huerto", "Haz una foto o un boceto rápido", "Escribe una línea sobre lo que ha cambiado"],
     "SOLO", NASA_GARDEN_SOURCE),
    ("READING_BREAK", "Lectura libre", "READING", 20,
     "Un bloque corto de lectura por placer, sin relación con procedimientos de misión.",
     ["Elige un libro o relato de la biblioteca digital", "Silencia notificaciones no críticas", "Lee sin objetivo, solo por disfrutar"],
     "SOLO", NASA_HRP_SOURCE),
    ("PUZZLE_GAME", "Rompecabezas o juego de lógica", "GAMES", 15,
     "Sudoku, crucigrama o rompecabezas para desconectar de la carga operativa.",
     ["Elige un nivel de dificultad cómodo", "Juega sin cronómetro", "Para cuando termine el bloque, aunque no acabes"],
     "SOLO", NASA_HRP_SOURCE),
    ("CARD_GAME", "Partida rápida de cartas", "GAMES", 20,
     "Juego de cartas o de mesa breve con otra persona de la tripulación.",
     ["Invita a un compañero o compañera", "Elige un juego de reglas sencillas", "Prioriza conversar más que ganar"],
     "GROUP", NASA_HRP_SOURCE),
    ("MUSIC_LISTENING", "Escuchar música de casa", "MUSIC", 10,
     "Escuchar una lista de canciones que recuerde a la familia o a lugares queridos.",
     ["Ponte auriculares", "Elige 2 o 3 canciones significativas", "Respira despacio mientras escuchas"],
     "SOLO", NASA_HRP_SOURCE),
    ("MUSIC_PLAYING", "Tocar un instrumento", "MUSIC", 20,
     "Practicar con un instrumento ligero o cantar unas canciones.",
     ["Calienta con escalas o una canción conocida", "Prueba algo nuevo durante unos minutos", "Comparte una pieza con la tripulación si te apetece"],
     "BOTH", NASA_HRP_SOURCE),
    ("SKETCHING", "Dibujo o boceto libre", "ART", 15,
     "Dibujar el interior del hábitat, una planta o un recuerdo de la Tierra.",
     ["Toma lápiz y papel o una tableta", "Elige un motivo cercano", "Dibuja sin buscar perfección"],
     "SOLO", NASA_HRP_SOURCE),
    ("EARTH_PHOTOGRAPHY", "Fotografía de la Tierra por la ventana", "PHOTOGRAPHY", 15,
     "Fotografiar la Tierra o el paisaje exterior y elegir la mejor imagen del día.",
     ["Consulta cuándo hay buena vista", "Haz varias tomas", "Guarda una favorita para compartir con tu familia"],
     "SOLO", NASA_HRP_SOURCE),
    ("GRATITUDE_JOURNAL", "Diario de gratitud", "WRITING", 5,
     "Escribir tres cosas buenas del día, por pequeñas que sean.",
     ["Abre tu diario privado", "Escribe tres cosas concretas", "Relee la entrada de ayer"],
     "SOLO", NASA_HRP_SOURCE),
    ("LETTER_HOME", "Carta a casa", "WRITING", 20,
     "Escribir una carta o mensaje largo a la familia para enviarlo en la próxima ventana de comunicaciones.",
     ["Piensa en una anécdota del día", "Escribe como si hablaras en persona", "Guárdala para enviarla cuando haya enlace"],
     "SOLO", NASA_HRP_SOURCE),
    ("STRETCH_BREAK", "Estiramientos suaves", "MOVEMENT", 10,
     "Pausa de estiramientos suaves autorizados para soltar tensión (no sustituye al ejercicio prescrito).",
     ["Asegura los pies en los anclajes", "Estira cuello, hombros y espalda despacio", "Respira profundamente en cada postura"],
     "SOLO", NASA_HRP_SOURCE),
    ("DANCE_BREAK", "Pausa de baile", "MOVEMENT", 5,
     "Una canción para moverse libremente y cambiar de energía.",
     ["Elige una canción animada", "Muévete con seguridad en el espacio disponible", "Invita a alguien si te apetece"],
     "BOTH", NASA_HRP_SOURCE),
]

# (code, title, description, minutes, category)
CREW_ACTIVITY_TEMPLATES_DATA = [
    ("SHARED_MEAL", "Comida compartida", "Comer juntos sin pantallas de trabajo: conversar, compartir comida y celebrar el día.", 45, "MEAL"),
    ("MOVIE_NIGHT", "Noche de película", "Ver juntos una película o serie elegida por votación de la tripulación.", 120, "MOVIE"),
    ("GROUP_GARDEN", "Huerto en grupo", "Cuidar juntos el huerto del hábitat: riego, poda y cosecha compartida.", 30, "GARDEN"),
    ("BOARD_GAME", "Juego de mesa", "Partida de un juego de mesa o de cartas en equipo.", 45, "GAME"),
    ("EARTH_OBSERVATION", "Observación de la Tierra", "Reunirse junto a la ventana para observar y fotografiar la Tierra.", 20, "OBSERVATION"),
    ("CELEBRATION", "Celebración de la tripulación", "Celebrar un cumpleaños, un hito de misión o una fiesta de casa.", 60, "CELEBRATION"),
]

# Misiones de XP del módulo (inactivas: no aparecen en la lista de misiones diarias)
ISOLATION_XP_MISSIONS_DATA = [
    ("LEISURE_BREAK", "Tiempo libre registrado", "WELLNESS",
     "Registrar una actividad breve de tiempo libre.", 10,
     "El ocio planificado ayuda a mantener el bienestar en aislamiento y confinamiento."),
    ("CREW_INTEGRATION", "Actividad de integración de la tripulación", "WELLNESS",
     "Asistir a una actividad de integración que alcanzó el quórum.", 25,
     "La cohesión de la tripulación es un factor protector frente al aislamiento (NASA HRP)."),
]


# Rol de una versión previa con canal familiar (retirado; ver docs/CONTRATO_AISLAMIENTO.md §4)
LEGACY_RETIRED_ROLE_CODE = "FAMILY_MEMBER"


def apply_lightweight_migrations(db: Session) -> None:
    """
    Compatibilidad idempotente con BD creadas o migradas por una versión previa que incluía un canal
    familiar (retirado). En una BD que nunca lo tuvo no hace nada. En una que sí lo tuvo:
    - conversations.channel: el modelo ya no la usa. Esa versión la creaba con DEFAULT 'MISSION', así que
      las inserciones siguen funcionando; si aun así fuera NOT NULL sin DEFAULT, se elimina la columna
      (y su índice) para que las inserciones no fallen. Las conversaciones de ese canal se archivan
      (status ARCHIVED) antes, sin borrar mensajes.
    - Usuarios con el rol retirado: pasan a INACTIVE y se revocan sus sesiones (no se borran cuentas),
      para que no queden cuentas activas con un rol sin permisos definidos.
    - message_attachments (columnas extra anulables) y family_contacts se dejan como están: no afectan
      a las inserciones del modelo actual.
    """
    from sqlalchemy import inspect, text

    bind = db.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())

    if "conversations" in tables:
        channel_col = next((c for c in insp.get_columns("conversations") if c["name"] == "channel"), None)
        if channel_col is not None:
            db.execute(
                text("UPDATE conversations SET status = 'ARCHIVED' WHERE channel = 'FAMILY' AND status != 'ARCHIVED'")
            )
            if not channel_col.get("nullable", True) and channel_col.get("default") is None:
                db.execute(text("DROP INDEX IF EXISTS ix_conversations_channel"))
                db.execute(text("ALTER TABLE conversations DROP COLUMN channel"))
            db.commit()

    legacy_role = db.query(Role).filter(Role.code == LEGACY_RETIRED_ROLE_CODE).first()
    if legacy_role:
        legacy_users = db.query(User).filter(User.role_id == legacy_role.id, User.status == "ACTIVE").all()
        for u in legacy_users:
            u.status = "INACTIVE"
            db.query(UserSession).filter(UserSession.user_id == u.id, UserSession.is_revoked.is_(False)).update(
                {UserSession.is_revoked: True}, synchronize_session=False
            )
        if legacy_users:
            db.commit()


def seed_isolation_module(db: Session) -> None:
    """Catálogos del módulo de aislamiento (tiempo libre, plantillas de tripulación, XP). Idempotente."""
    # Catálogo de tiempo libre
    for code, title, cat, minutes, desc, how_to, mode, (src_title, src_url) in LEISURE_ACTIVITIES_DATA:
        if not db.query(LeisureActivity).filter(LeisureActivity.code == code).first():
            db.add(
                LeisureActivity(
                    code=code,
                    title=title,
                    category=cat,
                    duration_minutes=minutes,
                    description=desc,
                    how_to_json=json.dumps(how_to, ensure_ascii=False),
                    solo_or_group=mode,
                    source_title=src_title,
                    source_url=src_url,
                    is_active=True,
                )
            )

    # Plantillas de integración de la tripulación
    for code, title, desc, minutes, cat in CREW_ACTIVITY_TEMPLATES_DATA:
        if not db.query(CrewActivityTemplate).filter(CrewActivityTemplate.code == code).first():
            db.add(
                CrewActivityTemplate(
                    code=code, title=title, description=desc, duration_minutes=minutes, category=cat, is_active=True
                )
            )

    for code, title, cat, desc, xp, edu in ISOLATION_XP_MISSIONS_DATA:
        if not db.query(DailyMission).filter(DailyMission.code == code).first():
            db.add(
                DailyMission(
                    code=code,
                    title=title,
                    category=cat,
                    description=desc,
                    xp_reward=xp,
                    compatible_environments_csv="ALL",
                    contraindicated_on_critical_alert=False,
                    educational_content=edu,
                    is_active=False,
                )
            )
    db.commit()
