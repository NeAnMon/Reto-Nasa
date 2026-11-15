/* =========================================================================
   Traducciones EN de textos del backend (seed). Ver src/i18n/backend.js
   -------------------------------------------------------------------------
   Fuentes cubiertas:
     - backend/app/database/seed.py (catálogos + registros sintéticos DEMO)
     - backend/app/services/cognitive_engine.py → COGNITIVE_DOMAINS_CATALOG
       (sembrado en BD por seed.py)
     - backend/app/api/v1/router.py → BODY_REGIONS_CATALOG
     - backend/app/api/v1/expansion_router.py → EMERGENCY_PROTOCOL_BANNER
     - backend/app/models/models.py → defaults de texto en español
   Las claves deben coincidir EXACTAMENTE con el texto en español (bt()
   normaliza espacios/saltos de línea, nada más).
   ========================================================================= */

export const EXACT = {
  /* ---------------------------------------------------------------------
     Perfiles de entorno (ENVIRONMENT_PROFILES_DATA)
     --------------------------------------------------------------------- */
  // EARTH_SURFACE
  "Superficie Terrestre (Entrenamiento / Recuperación)": "Earth Surface (Training / Recovery)",
  "1.0 G (Gravedad estándar)": "1.0 G (Standard gravity)",
  "0 km (Tierra)": "0 km (Earth)",
  "Condiciones de referencia en Tierra para establecer línea base pre-misión y seguimiento de recuperación post-aterrizaje.":
    "Earth reference conditions for establishing the pre-mission baseline and tracking post-landing recovery.",
  "Línea base cardiovascular, ortostática y metabólica.": "Cardiovascular, orthostatic and metabolic baseline.",
  "Calibración de sensores, evaluación de línea base y acondicionamiento físico.":
    "Sensor calibration, baseline assessment and physical conditioning.",
  // LOW_EARTH_ORBIT
  "Órbita Terrestre Baja (LEO / Estación Orbital)": "Low Earth Orbit (LEO / Orbital Station)",
  "Microgravedad (~10⁻⁶ G)": "Microgravity (~10⁻⁶ G)",
  "~400 km de la Tierra": "~400 km from Earth",
  "Entorno orbital con microgravedad continua, ciclos solares de 90 minutos y protección parcial de la magnetosfera.":
    "Orbital environment with continuous microgravity, 90-minute day/night cycles and partial magnetospheric protection.",
  "Redistribución cefálica de fluidos, síndrome neuro-ocular (SANS), descondicionamiento muscular y óseo, alteración circadiana.":
    "Headward fluid shift, spaceflight-associated neuro-ocular syndrome (SANS), muscle and bone deconditioning, circadian disruption.",
  "Ejercicio contrarresistencia autorizado, higiene luminosa del sueño e hidratación estructurada.":
    "Authorized resistive exercise countermeasures, light-based sleep hygiene and structured hydration.",
  // DEEP_SPACE_TRANSIT
  "Tránsito en Espacio Profundo (Cislunar / Interplanetario)": "Deep Space Transit (Cislunar / Interplanetary)",
  "Microgravedad en espacio profundo": "Deep-space microgravity",
  ">100,000 km de la Tierra": ">100,000 km from Earth",
  "Crucero fuera de la magnetosfera terrestre con exposición a radiación cósmica galáctica (GCR) y eventos solares (SPE).":
    "Cruise beyond Earth's magnetosphere with exposure to galactic cosmic rays (GCR) and solar particle events (SPE).",
  "Exposición acumulada a radiación, aislamiento en volumen reducido, fatiga cognitiva y desacondicionamiento cardiovascular.":
    "Cumulative radiation exposure, isolation in a confined volume, cognitive fatigue and cardiovascular deconditioning.",
  "Vigilancia dosimétrica continua, protocolos de refugio ante tormenta solar y apoyo psicosocial activo.":
    "Continuous dosimetry monitoring, solar-storm shelter protocols and active psychosocial support.",
  // LUNAR_ORBIT
  "Órbita Lunar (Estación Gateway NRHO)": "Lunar Orbit (Gateway Station, NRHO)",
  "Microgravedad en órbita lunar": "Lunar-orbit microgravity",
  "~384,400 km de la Tierra": "~384,400 km from Earth",
  "Puesto orbital lunar para transferencia a superficie y operaciones autónomas fuera del cinturón de Van Allen.":
    "Lunar orbital outpost for surface transfer and autonomous operations beyond the Van Allen belts.",
  "Radiación ionizante, desacondicionamiento ortostático previo al descenso lunar y alteración del sueño.":
    "Ionizing radiation, orthostatic deconditioning ahead of lunar descent, and sleep disruption.",
  "Monitoreo de dosis de radiación, preparación cardiovascular pre-descenso y control de CO₂ en cabina.":
    "Radiation dose monitoring, pre-descent cardiovascular preparation and cabin CO₂ control.",
  // LUNAR_SURFACE
  "Superficie Lunar (Polo Sur / Base Lunar)": "Lunar Surface (South Pole / Lunar Base)",
  "0.166 G (Hipogravedad lunar)": "0.166 G (Lunar partial gravity)",
  "Operaciones en gravedad parcial lunar con riesgo de polvo regolítico abrasivo y alta carga física en actividades de superficie.":
    "Operations in lunar partial gravity with abrasive regolith dust hazards and high physical workload during surface activities.",
  "Irritación respiratoria/ocular por polvo lunar, fatiga por trajes presurizados, estrés térmico e inestabilidad postural.":
    "Respiratory/ocular irritation from lunar dust, pressurized-suit fatigue, thermal stress and postural instability.",
  "Filtración y descontaminación post-EVA, control de hidratación y vigilancia respiratoria.":
    "Post-EVA filtration and decontamination, hydration management and respiratory monitoring.",
  // MARS_TRANSIT (el nombre también se usa como fase de la misión Ares Pathfinder)
  "Tránsito Interplanetario a Marte": "Interplanetary Transit to Mars",
  "Microgravedad prolongada (6–9 meses)": "Prolonged microgravity (6–9 months)",
  "50 a 400 millones km": "50 to 400 million km",
  "Viaje interplanetario de larga duración con retardo de comunicación creciente (hasta 22 min por sentido) y autonomía médica.":
    "Long-duration interplanetary journey with increasing communication delay (up to 22 min one-way) and medical autonomy.",
  "Pérdida de densidad mineral ósea, atrofia muscular, estrés por confinamiento extremo, inmunomodulación y radiación.":
    "Bone mineral density loss, muscle atrophy, extreme-confinement stress, immune modulation and radiation.",
  "Autocuidado autónomo, contramedidas físicas estrictas, nutrición antioxidante y cohesión de tripulación.":
    "Autonomous self-care, strict exercise countermeasures, antioxidant nutrition and crew cohesion.",
  // MARS_ORBIT
  "Órbita Marciana": "Mars Orbit",
  "Microgravedad tras tránsito largo": "Microgravity after long transit",
  "~225 millones km de la Tierra": "~225 million km from Earth",
  "Fase orbital marciana previa al ingreso atmosférico tras meses de microgravedad.":
    "Mars orbital phase prior to atmospheric entry after months in microgravity.",
  "Intolerancia ortostática severa ante transición gravitacional, fatiga acumulada y retardo de telemedicina.":
    "Severe orthostatic intolerance at the gravity transition, cumulative fatigue and telemedicine delay.",
  "Carga salina/hídrica autorizada y revisión integral previa al descenso.":
    "Authorized salt/fluid loading and comprehensive pre-descent review.",
  // MARS_SURFACE
  "Superficie Marciana": "Mars Surface",
  "0.38 G (Hipogravedad marciana)": "0.38 G (Martian partial gravity)",
  "Estancia planetaria en gravedad 0.38 G con tormentas de polvo perclorado y alta autonomía respecto a la Tierra.":
    "Planetary stay at 0.38 G with perchlorate dust storms and high autonomy from Earth.",
  "Readaptación vestibular y musculoesquelética tras microgravedad, exposición a polvo fino y aislamiento prolongado.":
    "Vestibular and musculoskeletal readaptation after microgravity, fine dust exposure and prolonged isolation.",
  "Rehabilitación progresiva en superficie, vigilancia tiroidea/respiratoria y rutinas de bienestar.":
    "Progressive surface rehabilitation, thyroid/respiratory monitoring and wellness routines.",
  // PRESSURIZED_HABITAT
  "Hábitat Presurizado de Superficie": "Pressurized Surface Habitat",
  "Gravedad parcial en atmósfera controlada": "Partial gravity in a controlled atmosphere",
  "Variable según cuerpo planetario": "Varies by planetary body",
  "Módulo habitable cerrado con soporte vital regenerativo (ECLSS), iluminación artificial y acústica de ventilación continua.":
    "Closed habitable module with regenerative life support (ECLSS), artificial lighting and continuous ventilation noise.",
  "Acumulación local de CO₂, cefaleas, sequedad de mucosas, ruido ambiental constante y fatiga visual.":
    "Local CO₂ buildup, headaches, dry mucous membranes, constant ambient noise and eye strain.",
  "Supervisión de ventilación ECLSS, pausas acústicas y control de humedad.":
    "ECLSS ventilation monitoring, noise breaks and humidity control.",
  // SPACECRAFT_CABIN
  "Cabina de Nave Espacial (Cápsula de Tripulación)": "Spacecraft Cabin (Crew Capsule)",
  "Microgravedad / Fases dinámicas de vuelo": "Microgravity / Dynamic flight phases",
  "Variable en tránsito": "Varies in transit",
  "Volumen habitable compacto durante lanzamiento, acoplamiento, tránsito corto o reentrada.":
    "Compact habitable volume during launch, docking, short transit or reentry.",
  "Cinetosis espacial, restricción de movimiento, picos de aceleración G y cambios de presión de cabina.":
    "Space motion sickness, restricted movement, G-load peaks and cabin pressure changes.",
  "Movilización segura, hidratación programada y monitoreo hemodinámico.":
    "Safe mobilization, scheduled hydration and hemodynamic monitoring.",
  // EXTRAVEHICULAR_ACTIVITY
  "Actividad Extravehicular (EVA / Caminata Espacial)": "Extravehicular Activity (EVA / Spacewalk)",
  "Traje presurizado en vacío/superficie": "Pressurized suit in vacuum/on surface",
  "Exterior de nave o superficie": "Vehicle exterior or surface",
  "Operación crítica en traje espacial presurizado con alta demanda metabólica, control térmico por sublimación y atmósfera pura de O₂.":
    "Critical operation in a pressurized spacesuit with high metabolic demand, sublimator thermal control and a pure O₂ atmosphere.",
  "Agotamiento térmico, deshidratación, hipoxia/hipercapnia por fallo de lavado de CO₂, lesiones por contacto en manos y fatiga aguda.":
    "Heat exhaustion, dehydration, hypoxia/hypercapnia from CO₂ washout failure, hand contact injuries and acute fatigue.",
  "Monitoreo continuo de signos vitales, presión del traje, CO₂ inspirado y suspensión de recordatorios no críticos.":
    "Continuous monitoring of vital signs, suit pressure and inspired CO₂, with non-critical reminders suspended.",
  // UNKNOWN_ENVIRONMENT
  "Entorno no confirmado": "Unconfirmed environment",
  "Sin datos verificados": "No verified data",
  "No confirmado": "Not confirmed",
  "No existe telemetría verificada ni confirmación manual autorizada. SEMSA no asume ubicación por GPS local.":
    "No verified telemetry or authorized manual confirmation is available. SEMSA does not infer location from local GPS.",
  "Incertidumbre contextual: interprete las mediciones con precaución y confirme el entorno manualmente.":
    "Contextual uncertainty: interpret measurements with caution and confirm the environment manually.",
  "Solicitar confirmación de entorno por parte de la tripulación o control de misión.":
    "Request environment confirmation from the crew or Mission Control.",
  // SIMULATION_ENVIRONMENT
  "Entorno de Simulación / Análogo en Tierra (HERA / NEEMO)": "Simulation Environment / Earth Analog (HERA / NEEMO)",
  "1.0 G (Misión análoga simulada)": "1.0 G (Simulated analog mission)",
  "0 km (Instalación análoga)": "0 km (Analog facility)",
  "Entorno controlado para entrenamiento de confinamiento, retardo de comunicaciones y validación de protocolos.":
    "Controlled environment for confinement training, communication-delay practice and protocol validation.",
  "Estrés psicosocial, privación de sueño y fatiga operativa.": "Psychosocial stress, sleep deprivation and operational fatigue.",
  "Práctica de flujos de autocuidado, comunicación de alertas y cohesión de equipo.":
    "Practice of self-care workflows, alert communication and team cohesion.",

  /* ---------------------------------------------------------------------
     Indicadores de salud (INDICATORS_DATA)
     --------------------------------------------------------------------- */
  // Unidades mostradas como texto
  "mL/día": "mL/day",
  "min/día": "min/day",
  "mSv/día": "mSv/day",
  "escala 1-10": "scale 1-10",
  // HEART_RATE
  "Frecuencia Cardíaca": "Heart Rate",
  "Puede medirse con sensor óptico/ECG autorizado o mediante palpación manual radial durante 60 s.":
    "Can be measured with an authorized optical/ECG sensor or by manual radial palpation for 60 s.",
  "1. Permanezca en reposo 3 minutos.\n2. Coloque el sensor de pulso o cuente latidos radiales durante 60 segundos.\n3. Introduzca el valor en latidos por minuto (bpm) y confirme la fuente.":
    "1. Rest for 3 minutes.\n2. Apply the pulse sensor or count radial beats for 60 seconds.\n3. Enter the value in beats per minute (bpm) and confirm the source.",
  "Número de contracciones cardíacas por minuto. Refleja la respuesta autonómica, el estado de hidratación y la carga física.":
    "Number of heartbeats per minute. Reflects autonomic response, hydration status and physical workload.",
  "En microgravedad e hipogravedad se produce redistribución cefálica de fluidos y remodelado cardiovascular, pudiendo alterar la frecuencia basal y la tolerancia ortostática.":
    "Microgravity and partial gravity cause a headward fluid shift and cardiovascular remodeling, which can alter resting heart rate and orthostatic tolerance.",
  // BLOOD_PRESSURE
  "Presión Arterial (Sistólica / Diastólica)": "Blood Pressure (Systolic / Diastolic)",
  "Requiere esfigmomanómetro o monitor braquial calibrado.": "Requires a calibrated sphygmomanometer or upper-arm monitor.",
  "1. Repose 5 minutos sin cruzar piernas ni sujetar cargas.\n2. Ajuste el brazalete a la altura del corazón.\n3. Registre el valor sistólico (principal) y diastólico (secundario) en mmHg.":
    "1. Rest for 5 minutes without crossing your legs or holding loads.\n2. Position the cuff at heart level.\n3. Record the systolic (primary) and diastolic (secondary) values in mmHg.",
  "Fuerza ejercida por la sangre contra las paredes arteriales en sístole y diástole.":
    "Force exerted by blood against the arterial walls during systole and diastole.",
  "Los cambios gravitacionales alteran el reflejo barorreceptor y el volumen plasmático, incrementando el riesgo de hipotensión ortostática al reingreso o en superficie planetaria.":
    "Gravity transitions alter the baroreceptor reflex and plasma volume, increasing the risk of orthostatic hypotension on reentry or on a planetary surface.",
  // BODY_TEMP
  "Temperatura Corporal": "Body Temperature",
  "Requiere termómetro clínico timpánico, frontal o sensor térmico validado.":
    "Requires a clinical tympanic or forehead thermometer, or a validated thermal sensor.",
  "1. Verifique que no haya ingerido líquidos calientes/fríos en los últimos 15 min.\n2. Tome la lectura con el termómetro autorizado.\n3. Ingrese el valor en grados Celsius (°C).":
    "1. Make sure you have not had hot or cold drinks in the last 15 min.\n2. Take the reading with the authorized thermometer.\n3. Enter the value in degrees Celsius (°C).",
  "Equilibrio térmico entre producción de calor metabólico y disipación ambiental.":
    "Thermal balance between metabolic heat production and dissipation to the environment.",
  "En microgravedad disminuye la convección natural del aire, elevando ligeramente la temperatura central durante el ejercicio (space fever) y aumentando el riesgo térmico dentro del traje EVA.":
    "In microgravity, natural air convection is reduced, slightly raising core temperature during exercise (space fever) and increasing thermal risk inside the EVA suit.",
  // SPO2
  "Saturación de Oxígeno (SpO₂)": "Oxygen Saturation (SpO₂)",
  "Requiere pulsioxímetro óptico calibrado.": "Requires a calibrated optical pulse oximeter.",
  "1. Mantenga la mano estable y templada.\n2. Coloque el pulsioxímetro en el dedo índice y espere onda estable.\n3. Registre el porcentaje de SpO₂.":
    "1. Keep your hand still and warm.\n2. Place the pulse oximeter on your index finger and wait for a stable waveform.\n3. Record the SpO₂ percentage.",
  "Porcentaje de hemoglobina arterial saturada con oxígeno.": "Percentage of arterial hemoglobin saturated with oxygen.",
  "Esencial para vigilar la oxigenación en atmósferas de cabina despresurizadas, trajes EVA y exposición a polvo lunar o marciano.":
    "Essential for monitoring oxygenation in depressurized cabin atmospheres, EVA suits and during lunar or Martian dust exposure.",
  // RESP_RATE
  "Frecuencia Respiratoria": "Respiratory Rate",
  "Puede medirse por observación torácica durante 60 s o banda respiratoria.":
    "Can be measured by observing chest movement for 60 s or with a respiratory band.",
  "1. En reposo, cuente las elevaciones del tórax durante 60 segundos completos.\n2. Registre el total en respiraciones por minuto (rpm).":
    "1. At rest, count chest rises for a full 60 seconds.\n2. Record the total in breaths per minute (rpm).",
  "Número de ciclos ventilatorios completos por minuto.": "Number of complete breathing cycles per minute.",
  "Sensible al incremento de CO₂ ambiental en compartimentos cerrados, fatiga física durante EVA y estrés agudo.":
    "Sensitive to rising ambient CO₂ in enclosed compartments, physical fatigue during EVA and acute stress.",
  // BLOOD_GLUCOSE
  "Glucosa Sanguínea Capilar": "Capillary Blood Glucose",
  "Requiere glucómetro capilar o sensor intersticial autorizado. Si no está disponible, puede omitirse en la evaluación parcial.":
    "Requires an authorized capillary glucometer or interstitial sensor. If unavailable, it may be skipped in a partial assessment.",
  "1. Verifique estado de ayuno (≥8 h) o postprandial.\n2. Realice lectura con el analizador portátil autorizado.\n3. Registre el valor en mg/dL.":
    "1. Note whether you are fasting (≥8 h) or postprandial.\n2. Take the reading with the authorized portable analyzer.\n3. Record the value in mg/dL.",
  "Concentración de glucosa circulante para soporte energético celular y cerebral.":
    "Circulating glucose concentration supporting cellular and brain energy needs.",
  "Los vuelos espaciales pueden inducir resistencia subclínica a la insulina asociada a inflamación, cambios de sueño y pérdida de masa muscular.":
    "Spaceflight can induce subclinical insulin resistance associated with inflammation, sleep changes and muscle mass loss.",
  // SLEEP_DURATION
  "Sueño (Duración y Calidad Percibida)": "Sleep (Duration & Perceived Quality)",
  "Registro de bitácora de sueño o actigrafía de muñeca (valor secundario: calidad 1-10).":
    "Sleep log entry or wrist actigraphy (secondary value: quality 1-10).",
  "1. Indique el total de horas dormidas en el último ciclo de descanso.\n2. En el campo secundario, califique la calidad percibida de 1 (muy fragmentado) a 10 (reparador).":
    "1. Enter the total hours slept in your last rest period.\n2. In the secondary field, rate perceived quality from 1 (very fragmented) to 10 (restorative).",
  "Horas efectivas de descanso y percepción subjetiva de recuperación neurocognitiva.":
    "Effective hours of rest and subjective perception of neurocognitive recovery.",
  "La ausencia de ciclo solar natural de 24 h, el ruido de soporte vital y la incomodidad postural reducen frecuentemente el sueño en órbita a ~6 horas.":
    "The lack of a natural 24-h solar cycle, life-support noise and postural discomfort frequently reduce sleep in orbit to ~6 hours.",
  // HYDRATION
  "Hidratación Registrada": "Logged Hydration",
  "Contabilización de bolsas de bebida / dispensador de agua potable del hábitat.":
    "Count of drink pouches / habitat potable water dispenser.",
  "1. Sume los mililitros consumidos de agua y bebidas rehidratantes en las últimas 24 h.\n2. Introduzca el volumen acumulado en mL.":
    "1. Add up the milliliters of water and rehydration drinks consumed in the last 24 h.\n2. Enter the cumulative volume in mL.",
  "Ingesta hídrica diaria para mantener volumen plasmático, termorregulación y función renal.":
    "Daily fluid intake to maintain plasma volume, thermoregulation and kidney function.",
  "La diuresis inicial en microgravedad y la reabsorción de calcio óseo elevan el riesgo de nefrolitiasis (cálculos renales) si la hidratación es insuficiente.":
    "Early diuresis in microgravity and bone calcium resorption raise the risk of nephrolithiasis (kidney stones) if hydration is insufficient.",
  // PHYSICAL_ACTIVITY
  "Actividad Física Contrarresistencia": "Physical Activity (Exercise Countermeasures)",
  "Tiempo de ejercicio autorizado en sistema ARED/cicloergómetro (secundario: minutos sedentarios).":
    "Authorized exercise time on ARED/cycle ergometer (secondary: sedentary minutes).",
  "1. Registre los minutos de ejercicio aeróbico y resistivo autorizado completados hoy.\n2. Opcionalmente indique el tiempo estimado de sedentarismo/inmovilidad en el campo secundario.":
    "1. Record the minutes of authorized aerobic and resistive exercise completed today.\n2. Optionally enter your estimated sedentary/inactive time in the secondary field.",
  "Volumen diario de ejercicio físico preventivo para preservar masa muscular, ósea y capacidad aeróbica.":
    "Daily volume of preventive exercise to preserve muscle mass, bone mass and aerobic capacity.",
  "Sin carga mecánica diaria, los astronautas pueden perder 1–1.5% de densidad mineral ósea mensual y masa muscular antigravitatoria.":
    "Without daily mechanical loading, astronauts can lose 1–1.5% of bone mineral density per month, along with antigravity muscle mass.",
  // PERCEIVED_FATIGUE
  "Fatiga Percibida": "Perceived Fatigue",
  "Escala subjetiva autoinformada (1 = alerta total, 10 = agotamiento severo).":
    "Self-reported subjective scale (1 = fully alert, 10 = severe exhaustion).",
  "1. Evalúe su nivel actual de cansancio físico y mental antes de tareas críticas.\n2. Seleccione un valor de 1 a 10 con honestidad; reportar fatiga protege a la tripulación y no genera penalizaciones.":
    "1. Assess your current level of physical and mental tiredness before critical tasks.\n2. Honestly select a value from 1 to 10; reporting fatigue protects the crew and carries no penalty.",
  "Percepción subjetiva del nivel de agotamiento cognitivo y físico.": "Subjective perception of cognitive and physical exhaustion.",
  "La sobrecarga de horarios, los cambios circadianos y el trabajo en trajes presurizados aumentan el riesgo de errores operativos por fatiga.":
    "Schedule overload, circadian shifts and work in pressurized suits increase the risk of fatigue-related operational errors.",
  // MOOD_WELLNESS
  "Estado de Ánimo y Bienestar General": "Mood & General Well-being",
  "Autoevaluación subjetiva (1 = malestar alto / requiere apoyo, 10 = óptimo).":
    "Subjective self-assessment (1 = high distress / needs support, 10 = optimal).",
  "1. Reflexione sobre su disposición emocional, calma y motivación hoy.\n2. Registre un valor de 1 a 10. Nunca se otorgan ni restan puntos de gamificación por el valor reportado.":
    "1. Reflect on your emotional state, calm and motivation today.\n2. Record a value from 1 to 10. Gamification points are never awarded or deducted based on the reported value.",
  "Indicador subjetivo de equilibrio emocional, adaptación al confinamiento y vitalidad.":
    "Subjective indicator of emotional balance, adaptation to confinement and vitality.",
  "El aislamiento, la distancia de la Tierra y la convivencia prolongada en espacios cerrados requieren seguimiento preventivo no estigmatizante.":
    "Isolation, distance from Earth and prolonged cohabitation in confined spaces call for non-stigmatizing preventive follow-up.",
  // RADIATION_EXPOSURE
  "Dosis Diaria de Radiación Ionizante": "Daily Ionizing Radiation Dose",
  "Dosímetro personal activo de radiación (CPD) o telemetría del hábitat.":
    "Active personal radiation dosimeter (CPD) or habitat telemetry.",
  "1. Consulte la lectura acumulada de 24 h en su dosímetro personal o consola ambiental.\n2. Ingrese el valor en milisieverts por día (mSv/día).":
    "1. Check the 24-h cumulative reading on your personal dosimeter or environmental console.\n2. Enter the value in millisieverts per day (mSv/day).",
  "Exposición biológica diaria a radiación cósmica galáctica y partículas solares.":
    "Daily biological exposure to galactic cosmic radiation and solar particles.",
  "La radiación espacial es uno de los 5 grandes peligros: impacta el sistema hematopoyético e inmunológico, el cristalino ocular y la salud celular a largo plazo.":
    "Space radiation is one of the 5 major spaceflight hazards: it affects the hematopoietic and immune systems, the lens of the eye and long-term cellular health.",

  /* ---------------------------------------------------------------------
     Reglas clínicas DEMO (ClinicalRule / ClinicalRuleVersion)
     (nombre e instrucciones con el indicador dentro → ver PATTERNS)
     --------------------------------------------------------------------- */
  "SEMSA DEMO Reference Protocol (Ilustrativo / No Clínico)":
    "SEMSA DEMO Reference Protocol (Illustrative / Non-Clinical)",
  "Comité de Demostración de Medicina Espacial (Ficticio)": "Space Medicine Demonstration Committee (Fictional)",
  "Escalamiento inmediato a Dirección de Medicina de Vuelo si persiste en rango WARNING por >2 mediciones o ante cualquier lectura en rango CRITICAL.":
    "Immediate escalation to the Flight Medicine Directorate if the value stays in the WARNING range for >2 measurements, or upon any reading in the CRITICAL range.",
  "Versión inicial de demostración.": "Initial demonstration version.",
  // Líneas sueltas de immediate_instructions (para btLines)
  "1. Suspenda actividad física exigente y permanezca en observación segura.":
    "1. Stop strenuous physical activity and remain under safe observation.",
  "3. Si el estado es CRITICAL, active comunicación prioritaria con el Oficial Médico de Tripulación y Tierra.":
    "3. If the state is CRITICAL, open priority communication with the Crew Medical Officer and the ground.",

  /* ---------------------------------------------------------------------
     Misiones diarias (DAILY_MISSIONS_DATA) — títulos ya en inglés
     --------------------------------------------------------------------- */
  "Completar una evaluación guiada de indicadores fisiológicos disponibles en My Health Check.":
    "Complete a guided assessment of the physiological indicators available in My Health Check.",
  "El registro periódico permite distinguir variaciones normales de adaptación frente a tendencias que ameritan seguimiento.":
    "Regular logging helps distinguish normal adaptation variability from trends that warrant follow-up.",
  "Registrar una medición validada de frecuencia cardíaca y presión arterial en reposo.":
    "Log a validated resting heart rate and blood pressure measurement.",
  "En microgravedad e hipogravedad, el sistema cardiovascular redistribuye fluidos hacia el tórax y la cabeza.":
    "In microgravity and partial gravity, the cardiovascular system shifts fluids toward the chest and head.",
  "Registrar la duración y calidad percibida del último periodo de sueño.":
    "Log the duration and perceived quality of your last sleep period.",
  "Dormir entre 7 y 8 horas protege la atención ejecutiva, la memoria de procedimientos y la regulación emocional.":
    "Sleeping 7 to 8 hours protects executive attention, procedural memory and emotional regulation.",
  "Completar y registrar la pauta de hidratación fraccionada del día.":
    "Complete and log the day's split hydration schedule.",
  "Una ingesta hídrica adecuada reduce el riesgo de cálculos renales inducidos por la resorción de calcio óseo en el espacio.":
    "Adequate fluid intake reduces the risk of kidney stones caused by bone calcium resorption in space.",
  "Realizar la sesión de movimiento y ejercicio contrarresistencia autorizada por el protocolo actual.":
    "Perform the movement and resistive exercise session authorized by the current protocol.",
  "El ejercicio resistivo protege huesos y músculos antigravitatorios. Se suspende automáticamente si existe una alerta médica incompatible.":
    "Resistive exercise protects bones and antigravity muscles. It is automatically suspended if there is an incompatible medical alert.",
  "Completar un chequeo privado de bienestar psicológico en el Wellness Center.":
    "Complete a private psychological well-being check in the Wellness Center.",
  "El bienestar psicológico se evalúa con privacidad reforzada; reconocer el estrés a tiempo es una fortaleza operativa.":
    "Psychological well-being is assessed with enhanced privacy; recognizing stress early is an operational strength.",
  "Revisar las condiciones ambientales del hábitat/nave (CO₂, presión, radiación y soporte vital).":
    "Review habitat/vehicle environmental conditions (CO₂, pressure, radiation and life support).",
  "Conocer el estado del soporte vital (ECLSS) y los niveles de CO₂ ayuda a contextualizar síntomas como cefalea o fatiga.":
    "Knowing life-support (ECLSS) status and CO₂ levels helps put symptoms such as headache or fatigue in context.",
  "Registrar una breve reflexión personal sobre adaptación, descanso o trabajo en equipo.":
    "Write a brief personal reflection on adaptation, rest or teamwork.",
  "La escritura reflexiva reduce la sensación de aislamiento en misiones de larga duración.":
    "Reflective writing reduces the feeling of isolation on long-duration missions.",
  "Completar la acción de seguimiento o confirmación indicada en una alerta preventiva no urgente.":
    "Complete the follow-up or confirmation action indicated in a non-urgent preventive alert.",
  "El cierre trazable de seguimientos permite al astronauta y al líder en tierra mantener control preventivo sin alarmismo.":
    "Traceable closure of follow-ups lets the astronaut and the ground leader maintain preventive oversight without alarmism.",
  "Explorar una región anatómica en el Body Explorer y revisar su cápsula educativa sobre riesgos espaciales.":
    "Explore an anatomical region in the Body Explorer and review its educational capsule on spaceflight risks.",
  "Comprender cómo los 5 peligros del espacio interactúan con cada sistema anatómico empodera el autocuidado.":
    "Understanding how the 5 spaceflight hazards interact with each body system empowers self-care.",
  "Completar una actividad interactiva en el Cognitive Performance Center.":
    "Complete an interactive activity in the Cognitive Performance Center.",
  "El seguimiento por dominio cognitivo permite observar el impacto del sueño y la carga operativa sin calificaciones estigmatizantes.":
    "Tracking by cognitive domain shows the impact of sleep and operational workload without stigmatizing scores.",
  "Responder un cuestionario emocional estructurado en My Emotional Check-In.":
    "Answer a structured emotional questionnaire in My Emotional Check-In.",
  "Expresar cómo te sientes facilita el acompañamiento preventivo oportuno con privacidad reforzada.":
    "Expressing how you feel enables timely preventive support with enhanced privacy.",
  "Revisar y confirmar lectura de comunicaciones directas con el líder de misión en el Communication Center.":
    "Review and acknowledge direct communications with the mission leader in the Communication Center.",
  "La comunicación fluida entre el astronauta y el apoyo en tierra reduce la incertidumbre operativa.":
    "Smooth communication between the astronaut and ground support reduces operational uncertainty.",
  "Dar seguimiento o actualizar una solicitud de apoyo o mensaje prioritario con Tierra.":
    "Follow up on or update a support request or priority message with the ground.",
  "El seguimiento estructurado de solicitudes asegura que ninguna inquietud quede sin respuesta.":
    "Structured request follow-up ensures that no concern goes unanswered.",
  "Realizar una sesión breve de entrenamiento de memoria operativa o aprendizaje visual.":
    "Perform a short working-memory or visual-learning training session.",
  "Ejercitar la memoria de trabajo apoya la ejecución de listas de verificación complejas.":
    "Exercising working memory supports the execution of complex checklists.",
  "Realizar una actividad de atención sostenida o seguimiento visual en el centro cognitivo.":
    "Perform a sustained-attention or visual-tracking activity in the cognitive center.",
  "La vigilancia visual y el rastreo espacial son esenciales durante acoplamientos y actividades extravehiculares.":
    "Visual vigilance and spatial tracking are essential during docking and extravehicular activities.",

  /* ---------------------------------------------------------------------
     Insignias (BADGES_DATA) — nombres ya en inglés
     --------------------------------------------------------------------- */
  "Primer chequeo de salud registrado con validación de calidad.": "First health check logged with quality validation.",
  "Registrar al menos una evaluación fisiológica válida en My Health Check.":
    "Log at least one valid physiological assessment in My Health Check.",
  "Constancia demostrada en rutinas de observación y autocuidado.": "Demonstrated consistency in monitoring and self-care routines.",
  "Mantener 3 o más días/rutinas de participación sin penalización por restricciones operativas.":
    "Maintain 3 or more days/routines of participation (no penalty for operational restrictions).",
  "Compromiso con la higiene del descanso y registro circadiano.": "Commitment to sleep hygiene and circadian logging.",
  "Completar la misión Sleep Log y revisar pautas de descanso.": "Complete the Sleep Log mission and review rest guidelines.",
  "Explorador del conocimiento sobre fisiología humana en el espacio.": "Explorer of knowledge about human physiology in space.",
  "Completar una Learning Mission o consultar módulos educativos del Body Explorer.":
    "Complete a Learning Mission or review Body Explorer educational modules.",
  "Dedicación proactiva a las contramedidas preventivas autorizadas.": "Proactive dedication to authorized preventive countermeasures.",
  "Completar 4 o más rutinas de autocuidado (hidratación, movimiento seguro o bienestar).":
    "Complete 4 or more self-care routines (hydration, safe movement or well-being).",
  "Gestión responsable de alertas preventivas y comunicación con tierra.":
    "Responsible handling of preventive alerts and communication with the ground.",
  "Reconocer una alerta o completar una Follow-up Mission.": "Acknowledge an alert or complete a Follow-up Mission.",
  "Hito de participación integral durante la misión espacial.": "Milestone of comprehensive participation during the space mission.",
  "Alcanzar 150 puntos de experiencia (XP) verificados por el servidor.": "Reach 150 server-verified experience points (XP).",
  "Participación en actividades de memoria operativa y recuerdo inmediato.":
    "Participation in working-memory and immediate-recall activities.",
  "Completar una evaluación del dominio MEMORY en el Cognitive Performance Center.":
    "Complete a MEMORY domain assessment in the Cognitive Performance Center.",
  "Dominio de actividades de aprendizaje visual y seguimiento de trayectorias.":
    "Mastery of visual-learning and trajectory-tracking activities.",
  "Completar una evaluación de VISUAL_LEARNING o VISUAL_TRACKING.": "Complete a VISUAL_LEARNING or VISUAL_TRACKING assessment.",
  "Entrenamiento de vigilancia, atención sostenida e inhibición de distractores.":
    "Training in vigilance, sustained attention and distractor inhibition.",
  "Completar una evaluación del dominio ATTENTION.": "Complete an ATTENTION domain assessment.",
  "Exploración de reglas lógicas y categorización conceptual.": "Exploration of logical rules and conceptual categorization.",
  "Completar una evaluación del dominio ABSTRACTION.": "Complete an ABSTRACTION domain assessment.",
  "Orientación espacial, rotación mental e integración interpersonal.": "Spatial orientation, mental rotation and interpersonal integration.",
  "Completar una evaluación de SPATIAL_ORIENTATION o EMOTION_RECOGNITION.":
    "Complete a SPATIAL_ORIENTATION or EMOTION_RECOGNITION assessment.",
  "Resolución de matrices relacionales y exploración compleja de escenarios.":
    "Solving relational matrices and complex scenario exploration.",
  "Completar una evaluación de ABSTRACT_REASONING o COMPLEX_EXPLORATION.":
    "Complete an ABSTRACT_REASONING or COMPLEX_EXPLORATION assessment.",
  "Primera actividad cognitiva completada exitosamente en misión.": "First cognitive activity successfully completed in mission.",
  "Completar cualquier evaluación cognitiva interactiva.": "Complete any interactive cognitive assessment.",
  "Constancia en el entrenamiento y monitoreo cognitivo preventivo.": "Consistency in preventive cognitive training and monitoring.",
  "Completar 3 o más actividades en el Cognitive Performance Center.":
    "Complete 3 or more activities in the Cognitive Performance Center.",

  /* ---------------------------------------------------------------------
     Recomendaciones de bienestar (WELLNESS_RECOMMENDATIONS_DATA)
     --------------------------------------------------------------------- */
  "Respiración Táctica Guiada (4-4-4-4)": "Guided Tactical Breathing (4-4-4-4)",
  "Inhale suavemente durante 4 segundos, mantenga el aire 4 segundos, exhale durante 4 segundos y pause 4 segundos. Repita durante 5 minutos siguiendo el guía visual.":
    "Inhale gently for 4 seconds, hold for 4 seconds, exhale for 4 seconds and pause for 4 seconds. Repeat for 5 minutes following the visual guide.",
  "Favorece la modulación vagal y reduce la activación simpática ante cargas operativas o confinamiento.":
    "Promotes vagal modulation and reduces sympathetic activation under operational workload or confinement.",
  "Pausa de Recuperación Neurocognitiva y Visual": "Neurocognitive & Visual Recovery Break",
  "Aléjese de las pantallas de telemetría durante 15 minutos, observe un punto lejano o cúpula de observación y reduzca el estímulo acústico con protección auditiva.":
    "Step away from telemetry screens for 15 minutes, look at a distant point or out of the observation cupola, and reduce noise exposure with hearing protection.",
  "Mitiga la fatiga de atención sostenida y la tensión ocular en entornos cerrados.":
    "Mitigates sustained-attention fatigue and eye strain in enclosed environments.",
  "Rutina de Higiene Circadiana Pre-Sueño": "Pre-Sleep Circadian Hygiene Routine",
  "Ajuste la iluminación del compartimento a espectro cálido (<450 nm reducido) 45 min antes de dormir, asegure el saco de descanso y verifique temperatura confortable.":
    "Set crew-quarters lighting to a warm spectrum (reduced <450 nm) 45 min before sleep, secure your sleeping bag and check for a comfortable temperature.",
  "Facilita la secreción endógena de melatonina cuando los ciclos solares externos están alterados.":
    "Supports endogenous melatonin secretion when external solar cycles are disrupted.",
  "Actividad Recreativa o Musical en Hábitat": "Recreational or Music Activity in the Habitat",
  "Dedique 20 minutos a lectura recreativa, música personal o juego cooperativo no competitivo con la tripulación.":
    "Spend 20 minutes on leisure reading, personal music or a cooperative, non-competitive game with the crew.",
  "Previene la monotonía sensorial en misiones de larga duración.": "Prevents sensory monotony on long-duration missions.",
  "Contacto Social o Familiar Autorizado": "Authorized Social or Family Contact",
  "Programe una videollamada privada (en LEO/Luna) o mensaje de video diferido de alta prioridad (en espacio profundo) con su red de apoyo en Tierra.":
    "Schedule a private video call (in LEO/lunar missions) or a high-priority delayed video message (in deep space) with your support network on Earth.",
  "Refuerza el apoyo social percibido y reduce el impacto del aislamiento y la distancia de la Tierra.":
    "Strengthens perceived social support and reduces the impact of isolation and distance from Earth.",
  "Sesión de Ejercicio Físico Autorizado (Contramedida)": "Authorized Exercise Session (Countermeasure)",
  "Complete la pauta autorizada de movilidad y carga resistiva moderada. Nota: Esta recomendación se bloquea automáticamente si existe una alerta médica incompatible.":
    "Complete the authorized mobility and moderate resistive-loading routine. Note: this recommendation is automatically blocked if there is an incompatible medical alert.",
  "Libera endorfinas y preserva la integridad musculoesquelética y cardiovascular.":
    "Releases endorphins and preserves musculoskeletal and cardiovascular integrity.",
  "Protocolo de Afrontamiento Cognitivo ante Confinamiento": "Cognitive Coping Protocol for Confinement",
  "Identifique el estresor operativo, separe los factores controlables de los no controlables y registre una nota estructurada en su bitácora privada.":
    "Identify the operational stressor, separate controllable from uncontrollable factors and record a structured note in your private log.",
  "Estrategia validada en factores humanos espaciales para prevenir escaladas de tensión interpersonal o fatiga.":
    "A strategy validated in space human-factors research to prevent escalation of interpersonal tension or fatigue.",
  "Solicitud de Enlace Privado con Especialista de Apoyo": "Request a Private Link with a Support Specialist",
  "Active un canal confidencial con el equipo de soporte psicológico en Tierra. Sus respuestas de cuestionario permanecen privadas por defecto.":
    "Open a confidential channel with the psychological support team on Earth. Your questionnaire answers remain private by default.",
  "Garantiza acompañamiento profesional oportuno sin estigmatización.": "Ensures timely professional support without stigma.",
  "Activación de Protocolo de Apoyo Urgente de Tripulación": "Activate Crew Urgent Support Protocol",
  "Comunique de inmediato al Oficial Médico de Tripulación (CMO) y al Médico de Vuelo en Tierra mediante el canal prioritario.":
    "Immediately notify the Crew Medical Officer (CMO) and the Flight Surgeon on the ground via the priority channel.",
  "Las actividades de relajación nunca sustituyen la atención profesional o urgente.":
    "Relaxation activities never replace professional or urgent care.",

  /* ---------------------------------------------------------------------
     Permisos y roles
     --------------------------------------------------------------------- */
  "Consultar el propio dashboard, silueta e historial de salud": "View your own dashboard, body silhouette and health history",
  "Registrar mediciones fisiológicas y evaluaciones de bienestar propias": "Log your own physiological measurements and well-being assessments",
  "Completar misiones diarias y obtener insignias verificadas": "Complete daily missions and earn verified badges",
  "Supervisar astronautas y misiones asignadas": "Oversee assigned astronauts and missions",
  "Reconocer alertas y registrar seguimiento operativo": "Acknowledge alerts and log operational follow-up",
  "Escalar alertas al protocolo médico correspondiente": "Escalate alerts to the appropriate medical protocol",
  "Exportar informes autorizados en PDF, CSV y JSON": "Export authorized reports as PDF, CSV and JSON",
  "Ejecutar escenarios del simulador de telemetría DEMO": "Run DEMO telemetry simulator scenarios",
  "Crear, editar, suspender usuarios y asignar roles": "Create, edit and suspend users, and assign roles",
  "Crear misiones, fases y asignaciones de tripulación": "Create missions, phases and crew assignments",
  "Gestionar versiones de reglas operativas con auditoría": "Manage operational rule versions with auditing",
  "Consultar eventos de seguridad y auditoría del sistema": "View system security and audit events",
  "Astronauta / Miembro de Tripulación": "Astronaut / Crew Member",
  "Acceso a su propia salud, silueta interactiva, bienestar privado, misiones diarias y simulador DEMO.":
    "Access to own health data, interactive silhouette, private well-being, daily missions and DEMO simulator.",
  "Líder de Misión en Tierra (Flight Director / Crew Support)": "Ground Mission Leader (Flight Director / Crew Support)",
  "Supervisión de tripulación asignada, alertas operativas, analítica longitudinal e informes autorizados.":
    "Oversight of assigned crew, operational alerts, longitudinal analytics and authorized reports.",
  "Administrador de Plataforma y Sistemas": "Platform & Systems Administrator",
  "Gestión de cuentas, roles, misiones, catálogos, fuentes de datos, reglas versionadas y auditoría.":
    "Management of accounts, roles, missions, catalogs, data sources, versioned rules and auditing.",

  /* ---------------------------------------------------------------------
     Fuentes de datos (sources_data)
     --------------------------------------------------------------------- */
  "Registro Manual Guiado": "Guided Manual Entry",
  "Ingreso directo validado por el astronauta en My Health Check.": "Direct entry validated by the astronaut in My Health Check.",
  "Importación de Archivo (CSV/JSON)": "File Import (CSV/JSON)",
  "Carga estructurada de lotes de mediciones con validación de esquema.": "Structured batch upload of measurements with schema validation.",
  "Simulador de Telemetría Sintética (SIMULADO)": "Synthetic Telemetry Simulator (SIMULATED)",
  "Generador reproducible de series temporales sintéticas para demostración.":
    "Reproducible generator of synthetic time series for demonstration.",
  "Sincronización Diferida Sin Conexión": "Deferred Offline Sync",
  "Cola local sincronizada tras recuperar enlace con deduplicación.": "Local queue synced with deduplication once the link is restored.",
  "Adaptador Bio-Arnés Espacial (Interfaz Preparada)": "Space Bio-Harness Adapter (Interface Ready)",
  "Interfaz preparada para futura integración con sensores biométricos certificados.":
    "Interface ready for future integration with certified biometric sensors.",

  /* ---------------------------------------------------------------------
     Instrumento de bienestar (WellnessInstrument SPACE_WELLNESS_CHECK_DEMO)
     --------------------------------------------------------------------- */
  "Estado de ánimo general": "Overall mood",
  "Nivel de estrés percibido": "Perceived stress level",
  "Calidad reparadora del sueño": "Restorative sleep quality",
  "Fatiga física y cognitiva": "Physical and cognitive fatigue",
  "Claridad mental y concentración": "Mental clarity and concentration",
  "Sensación de aislamiento o confinamiento": "Sense of isolation or confinement",
  "Adaptación al entorno y rutinas de misión": "Adaptation to the environment and mission routines",
  "Percepción de apoyo social y de equipo": "Perceived social and team support",
  "Capacidad de recuperación y descanso": "Recovery and rest capacity",
  "Cuestionario Educativo de Bienestar y Adaptación Espacial (DEMO)": "Educational Space Well-being & Adaptation Questionnaire (DEMO)",
  "AVISO IMPORTANTE: Este instrumento es un cuestionario educativo de demostración (NO diagnóstico y NO validado clínicamente). Sus respuestas detalladas son privadas por defecto y tienen como único propósito apoyar la autoevaluación preventiva y facilitar la solicitud oportuna de apoyo.":
    "IMPORTANT NOTICE: This instrument is an educational demonstration questionnaire (NOT diagnostic and NOT clinically validated). Your detailed answers are private by default and serve only to support preventive self-assessment and make it easier to request support in a timely manner.",

  /* ---------------------------------------------------------------------
     Centro Cognitivo — versión de test (seed) y catálogo de dominios
     (COGNITIVE_DOMAINS_CATALOG, sembrado por seed.py)
     --------------------------------------------------------------------- */
  "La repetición frecuente mejora la familiaridad procedimental con la tarea; los cambios deben interpretarse junto con sueño y fatiga. Actividad NO diagnóstica.":
    "Frequent repetition improves procedural familiarity with the task; changes should be interpreted alongside sleep and fatigue. NON-diagnostic activity.",
  // A. VISUAL_LEARNING
  "A. Aprendizaje Visual (Visual Learning)": "A. Visual Learning",
  "Observar la capacidad de aprender, codificar y reconocer secuencias de patrones y símbolos visuales presentados brevemente.":
    "Observe the ability to learn, encode and recognize sequences of briefly presented visual patterns and symbols.",
  "Actividad de seguimiento operativo (DEMO). Describe el desempeño observado en reconocimiento visual; no constituye diagnóstico neuropsicológico.":
    "Operational monitoring activity (DEMO). Describes observed visual-recognition performance; it is not a neuropsychological diagnosis.",
  "Codificación y Reconocimiento de Patrones Orbitales": "Orbital Pattern Encoding & Recognition",
  "1. Observe la secuencia de emblemas geométricos durante unos segundos.\n2. Al ocultarse la muestra, identifique cuál par o figura formaba parte de la secuencia original.":
    "1. Watch the sequence of geometric emblems for a few seconds.\n2. When the sample is hidden, identify which pair or shape was part of the original sequence.",
  "Ejemplo de práctica: Si vio [▲ Azul, ● Cian, ◆ Verde], ¿cuál símbolo estaba en el centro?":
    "Practice example: If you saw [▲ Blue, ● Cyan, ◆ Green], which symbol was in the middle?",
  "▲ Azul": "▲ Blue",
  "● Cian": "● Cyan",
  "■ Rojo": "■ Red",
  "★ Ámbar": "★ Amber",
  "Muestra estudiada: [Hexágono-Alfa, Círculo-Beta, Triángulo-Gamma]. ¿Qué elemento seguía inmediatamente a Hexágono-Alfa?":
    "Studied sample: [Hexagon-Alpha, Circle-Beta, Triangle-Gamma]. Which item came immediately after Hexagon-Alpha?",
  "⬢ Alfa": "⬢ Alpha",
  "■ Épsilon": "■ Epsilon",
  "Pares asociados: [Módulo-1 → Panel Solar], [Módulo-2 → Antena], [Módulo-3 → Esclusa]. ¿Qué elemento corresponde a Módulo-2?":
    "Paired associates: [Module-1 → Solar Array], [Module-2 → Antenna], [Module-3 → Airlock]. Which item goes with Module-2?",
  "Módulo-1": "Module-1",
  "Módulo-2": "Module-2",
  "Módulo-3": "Module-3",
  "Panel Solar": "Solar Array",
  "Antena": "Antenna",
  "Esclusa": "Airlock",
  "Radiador": "Radiator",
  "Patrón de cuadrícula aprendido: Esquina superior izquierda = Cian; Centro = Verde; Inferior derecha = Ámbar. ¿Qué color ocupaba el centro?":
    "Learned grid pattern: Top-left corner = Cyan; Center = Green; Bottom-right = Amber. Which color was in the center?",
  "Cian": "Cyan",
  "Verde": "Green",
  "Ámbar": "Amber",
  "Violeta": "Violet",
  // B. MEMORY
  "B. Memoria de Trabajo y Secuencial (Memory)": "B. Working & Sequential Memory",
  "Observar la retención a corto plazo de secuencias numéricas, espaciales y simbólicas operativas.":
    "Observe short-term retention of operational numeric, spatial and symbolic sequences.",
  "Tarea de memoria de trabajo en pantalla (DEMO). Sujeta a efecto de práctica; no mide capacidad mnésica clínica global.":
    "On-screen working-memory task (DEMO). Subject to practice effects; it does not measure overall clinical memory capacity.",
  "Retención de Secuencias de Telemetría y Posición": "Telemetry & Position Sequence Retention",
  "1. Memorice la secuencia de códigos y coordenadas mostrada.\n2. Reproduzca el orden exacto o el elemento solicitado sin ayudas externas.":
    "1. Memorize the displayed sequence of codes and coordinates.\n2. Reproduce the exact order or the requested item without external aids.",
  "Ejemplo: Secuencia [4 - 9 - 2]. ¿Cuál es la secuencia en orden inverso?":
    "Example: Sequence [4 - 9 - 2]. What is the sequence in reverse order?",
  "Secuencia presentada: [7 - 3 - 8 - 1 - 5]. Seleccione la reproducción exacta:":
    "Sequence shown: [7 - 3 - 8 - 1 - 5]. Select the exact reproduction:",
  "Secuencia en orden INVERSO de [A2 - B5 - C9 - D4]:": "REVERSE order of [A2 - B5 - C9 - D4]:",
  "Posiciones iluminadas en matriz 3x3: [Fila 1 Col 2] → [Fila 2 Col 3] → [Fila 3 Col 1]. ¿Cuál fue la segunda posición?":
    "Lit positions in a 3x3 grid: [Row 1 Col 2] → [Row 2 Col 3] → [Row 3 Col 1]. What was the second position?",
  "Fila 1 Col 2": "Row 1 Col 2",
  "Fila 2 Col 3": "Row 2 Col 3",
  "Fila 3 Col 1": "Row 3 Col 1",
  "Fila 2 Col 2": "Row 2 Col 2",
  // C. ATTENTION
  "C. Atención Selectiva y Sostenida (Attention)": "C. Selective & Sustained Attention",
  "Observar la detección de estímulos objetivo entre distractores, registrando aciertos, omisiones y variabilidad de respuesta.":
    "Observe detection of target stimuli among distractors, recording hits, omissions and response variability.",
  "Actividad de vigilancia atencional (DEMO). Sensible a fatiga puntual e iluminación ambiental.":
    "Attentional vigilance activity (DEMO). Sensitive to momentary fatigue and ambient lighting.",
  "Discriminación de Estímulos Objetivo entre Distractores": "Target Stimulus Discrimination Among Distractors",
  "1. Identifique únicamente el símbolo objetivo '⊕' entre los distractores ('⊗', '⊘', '⊙').\n2. Responda con rapidez y precisión evitando falsas alarmas.":
    "1. Identify only the target symbol '⊕' among the distractors ('⊗', '⊘', '⊙').\n2. Respond quickly and accurately, avoiding false alarms.",
  "Ejemplo: En la fila [⊗  ⊕  ⊘  ⊕  ⊙], ¿cuántas veces aparece el objetivo '⊕'?":
    "Example: In the row [⊗  ⊕  ⊘  ⊕  ⊙], how many times does the target '⊕' appear?",
  "Matriz de barrido: [⊗ ⊕ ⊘ ⊙ ⊕ ⊗ ⊕ ⊘]. ¿Cuántos objetivos '⊕' están presentes?":
    "Scan array: [⊗ ⊕ ⊘ ⊙ ⊕ ⊗ ⊕ ⊘]. How many '⊕' targets are present?",
  "Detección de cambio en telemetría: Serie A=[101.2, 101.2, 101.2, 98.4, 101.2]. ¿En qué posición ocurre la anomalía?":
    "Telemetry change detection: Series A=[101.2, 101.2, 101.2, 98.4, 101.2]. At which position does the anomaly occur?",
  "Posición 2": "Position 2",
  "Posición 3": "Position 3",
  "Posición 4": "Position 4",
  "Sin cambio": "No change",
  "Filtro selectivo: Seleccione el único código que comienza con vocal y termina en número par:":
    "Selective filter: Select the only code that starts with a vowel and ends in an even number:",
  // D. ABSTRACTION
  "D. Abstracción y Categorización (Abstraction)": "D. Abstraction & Categorization",
  "Observar la capacidad para identificar reglas generales, clasificar elementos y detectar el elemento discordante.":
    "Observe the ability to identify general rules, classify items and spot the odd one out.",
  "Tarea de categorización conceptual y visual (DEMO).": "Conceptual and visual categorization task (DEMO).",
  "Clasificación de Patrones y Deducción de Reglas": "Pattern Classification & Rule Deduction",
  "1. Analice las propiedades compartidas por el conjunto de figuras o conceptos.\n2. Seleccione la regla general o el elemento que no pertenece a la categoría.":
    "1. Analyze the properties shared by the set of shapes or concepts.\n2. Select the general rule or the item that does not belong to the category.",
  "Ejemplo: [Oxígeno, Nitrógeno, Dióxido de Carbono, Titanio]. ¿Cuál elemento NO pertenece a la categoría de gases atmosféricos?":
    "Example: [Oxygen, Nitrogen, Carbon Dioxide, Titanium]. Which item does NOT belong to the atmospheric gases category?",
  "Oxígeno": "Oxygen",
  "Nitrógeno": "Nitrogen",
  "Titanio": "Titanium",
  "Dióxido de Carbono": "Carbon Dioxide",
  "Conjunto: [Triángulo (3 lados), Cuadrado (4 lados), Pentágono (5 lados), Círculo (0 lados rectos)]. ¿Cuál es el elemento discordante?":
    "Set: [Triangle (3 sides), Square (4 sides), Pentagon (5 sides), Circle (0 straight sides)]. Which is the odd one out?",
  "Triángulo": "Triangle",
  "Cuadrado": "Square",
  "Pentágono": "Pentagon",
  "Círculo": "Circle",
  "Regla de clasificación: Grupo Alfa=[2, 4, 8, 16]; Grupo Beta=[3, 9, 27, 81]. ¿Qué regla define ambos grupos?":
    "Classification rule: Group Alpha=[2, 4, 8, 16]; Group Beta=[3, 9, 27, 81]. Which rule defines both groups?",
  "Progresión geométrica por potencias de la base inicial": "Geometric progression by powers of the initial base",
  "Suma constante de números primos": "Constant sum of prime numbers",
  "Alternancia de pares e impares": "Alternating even and odd numbers",
  "División sucesiva entre 2": "Successive division by 2",
  "Complete la pareja conceptual: [Termómetro → Temperatura] es equivalente a [Dosímetro → ___]:":
    "Complete the analogy: [Thermometer → Temperature] is equivalent to [Dosimeter → ___]:",
  "Presión arterial": "Blood pressure",
  "Radiación ionizante": "Ionizing radiation",
  "Humedad relativa": "Relative humidity",
  "Velocidad orbital": "Orbital velocity",
  // E. SPATIAL_ORIENTATION
  "E. Orientación Espacial y Rotación Mental (Spatial Orientation)": "E. Spatial Orientation & Mental Rotation",
  "Observar la comprensión de relaciones espaciales 2D/3D, rotaciones de acoplamiento y cambios de perspectiva en microgravedad.":
    "Observe understanding of 2D/3D spatial relationships, docking rotations and perspective changes in microgravity.",
  "Actividad de rotación espacial (DEMO). Útil para seguimiento durante la adaptación neuro-vestibular.":
    "Spatial rotation activity (DEMO). Useful for monitoring during neurovestibular adaptation.",
  "Rotación Mental de Módulos y Acoplamiento 3D": "Module Mental Rotation & 3D Docking",
  "1. Visualice el módulo espacial con su vector de referencia.\n2. Aplique mentalmente la rotación indicada (guiñada/cabeceo/alabeo) y elija la orientación resultante.":
    "1. Visualize the space module with its reference vector.\n2. Mentally apply the indicated rotation (yaw/pitch/roll) and choose the resulting orientation.",
  "Ejemplo: Si una flecha apunta al NORTE (↑) y gira 90° en sentido horario, ¿hacia dónde apunta?":
    "Example: If an arrow points NORTH (↑) and rotates 90° clockwise, where does it point?",
  "ESTE (→)": "EAST (→)",
  "SUR (↓)": "SOUTH (↓)",
  "OESTE (←)": "WEST (←)",
  "NORTE (↑)": "NORTH (↑)",
  "El puerto de acoplamiento de una nave apunta hacia ARRIBA (+Z) con el panel solar a la IZQUIERDA (-Y). Si la nave rota 180° sobre su eje longitudinal (Roll), ¿dónde queda el panel solar?":
    "A spacecraft's docking port points UP (+Z) with the solar array on the LEFT (-Y). If the spacecraft rotates 180° about its longitudinal axis (Roll), where does the solar array end up?",
  "A la DERECHA (+Y)": "On the RIGHT (+Y)",
  "A la IZQUIERDA (-Y)": "On the LEFT (-Y)",
  "Atrás (-X)": "Aft (-X)",
  "Forma en 'L' con brazo largo vertical hacia arriba y base hacia la derecha (└). Tras rotar 90° en sentido horario, ¿qué orientación adopta?":
    "An 'L' shape with the long arm vertical pointing up and the base pointing right (└). After rotating 90° clockwise, what orientation does it take?",
  "Brazo largo horizontal a la derecha y base hacia abajo (┌)": "Long arm horizontal to the right and base pointing down (┌)",
  "Brazo largo hacia abajo y base a la izquierda (┐)": "Long arm pointing down and base to the left (┐)",
  "Brazo largo a la izquierda y base hacia arriba (┘)": "Long arm to the left and base pointing up (┘)",
  "Permanece idéntica (└)": "Stays the same (└)",
  "Desde la cúpula de observación mirando hacia la proa (+X), el brazo robótico está a estribor (derecha). Si usted flota boca abajo (invertido 180° en eje Z) mirando hacia la misma proa (+X), ¿de qué lado percibe el brazo robótico?":
    "From the observation cupola facing forward (+X), the robotic arm is to starboard (right). If you float upside down (inverted 180° about the Z axis) facing the same forward direction (+X), on which side do you perceive the robotic arm?",
  "A su izquierda subjetiva": "To your subjective left",
  "A su derecha subjetiva": "To your subjective right",
  "Detrás de usted": "Behind you",
  "Arriba del cenit": "Above the zenith",
  // F. EMOTION_RECOGNITION
  "F. Reconocimiento de Expresiones en Estímulos Controlados (Emotion Recognition)":
    "F. Expression Recognition in Controlled Stimuli (Emotion Recognition)",
  "Evaluar la identificación de expresiones faciales esquemáticas estandarizadas para apoyar la empatía y comunicación de tripulación.":
    "Assess identification of standardized schematic facial expressions to support crew empathy and communication.",
  "AVISO ÉTICO Y CIENTÍFICO: Utiliza ilustraciones esquemáticas estandarizadas. NUNCA utiliza cámara ni reconocimiento facial sobre el usuario, ni infiere el estado emocional real o personalidad del astronauta.":
    "ETHICAL AND SCIENTIFIC NOTICE: Uses standardized schematic illustrations. It NEVER uses the camera or facial recognition on the user, nor does it infer the astronaut's actual emotional state or personality.",
  "Identificación de Expresiones en Estímulos Visuales Controlados": "Expression Identification in Controlled Visual Stimuli",
  "1. Observe la ilustración esquemática estandarizada descrita.\n2. Seleccione la etiqueta emocional que mejor corresponde a los rasgos visuales del estímulo.":
    "1. Look at the standardized schematic illustration described.\n2. Select the emotion label that best matches the stimulus's visual features.",
  "Ejemplo: Ilustración con comisuras labiales elevadas en arco y arrugas perioculares suaves. ¿Qué expresión representa el estímulo?":
    "Example: Illustration with upturned, arched mouth corners and soft wrinkles around the eyes. Which expression does the stimulus represent?",
  "Alegría / Calma positiva": "Joy / Positive calm",
  "Ira": "Anger",
  "Sorpresa": "Surprise",
  "Miedo": "Fear",
  "Estímulo controlado #1: Cejas arqueadas y elevadas simétricamente, párpados ampliamente abiertos y boca ovalada relajada.":
    "Controlled stimulus #1: Arched, symmetrically raised eyebrows, wide-open eyelids and a relaxed oval mouth.",
  "Sorpresa / Alerta súbita": "Surprise / Sudden alertness",
  "Tristeza": "Sadness",
  "Enojo": "Anger",
  "cansancio": "tiredness",
  "Estímulo controlado #2: Cejas fruncidas hacia el centro e inclinadas hacia abajo, mirada fija y labios tensos comprimidos.":
    "Controlled stimulus #2: Eyebrows drawn together and angled down, fixed gaze and tense, pressed lips.",
  "Tensión / Frustración": "Tension / Frustration",
  "Alegría": "Joy",
  "Neutralidad": "Neutral",
  "Somnolencia": "Drowsiness",
  "Estímulo controlado #3: Extremos internos de las cejas elevados, párpados superiores ligeramente caídos y comisuras de la boca descendidas.":
    "Controlled stimulus #3: Inner corners of the eyebrows raised, upper eyelids slightly drooping and mouth corners turned down.",
  "Tristeza / Abatimiento": "Sadness / Dejection",
  "Entusiasmo": "Enthusiasm",
  // G. ABSTRACT_REASONING
  "G. Razonamiento Abstracto y Lógico (Abstract Reasoning)": "G. Abstract & Logical Reasoning",
  "Observar la resolución de problemas de series lógicas, matrices de relaciones y deducción secuencial.":
    "Observe problem solving with logical series, relational matrices and sequential deduction.",
  "Tarea de razonamiento lógico (DEMO). No representa un cociente intelectual ni diagnóstico clínico.":
    "Logical reasoning task (DEMO). It does not represent an IQ score or a clinical diagnosis.",
  "Matrices Lógicas y Series de Símbolos": "Logic Matrices & Symbol Series",
  "1. Examine cómo cambian los elementos en cada fila y columna de la serie.\n2. Deduzca la pieza que completa lógicamente la matriz.":
    "1. Examine how the items change across each row and column of the series.\n2. Deduce the piece that logically completes the matrix.",
  "Ejemplo: Serie [1, 4, 9, 16, ?]. ¿Qué número completa la serie de cuadrados perfectos?":
    "Example: Series [1, 4, 9, 16, ?]. Which number completes the series of perfect squares?",
  "Matriz lógica: Fila 1=[1 círculo, 2 círculos, 3 círculos]; Fila 2=[2 triángulos, 4 triángulos, 6 triángulos]; Fila 3=[3 rombos, 6 rombos, ?]:":
    "Logic matrix: Row 1=[1 circle, 2 circles, 3 circles]; Row 2=[2 triangles, 4 triangles, 6 triangles]; Row 3=[3 diamonds, 6 diamonds, ?]:",
  "7 rombos": "7 diamonds",
  "8 rombos": "8 diamonds",
  "9 rombos": "9 diamonds",
  "12 rombos": "12 diamonds",
  "Serie simbólica: [A1-Z, B2-Y, C3-X, D4-W, ?]. ¿Cuál es el siguiente término?":
    "Symbol series: [A1-Z, B2-Y, C3-X, D4-W, ?]. What is the next term?",
  "Deducción condicional: Si (Soporte Vital Nominal ⇒ Presión = 101 kPa) y actualmente (Presión ≠ 101 kPa), ¿qué conclusión lógica es válida?":
    "Conditional deduction: If (Life Support Nominal ⇒ Pressure = 101 kPa) and currently (Pressure ≠ 101 kPa), which logical conclusion is valid?",
  "El Soporte Vital NO está en estado Nominal": "Life Support is NOT in Nominal state",
  "La temperatura ha subido": "The temperature has risen",
  "El Soporte Vital está Nominal": "Life Support is Nominal",
  "No se puede deducir nada": "Nothing can be deduced",
  // H. COMPLEX_EXPLORATION
  "H. Exploración Compleja y Toma de Decisiones (Complex Exploration)": "H. Complex Exploration & Decision-Making",
  "Observar la planificación de rutas, priorización de múltiples objetivos y adaptación ante restricciones cambiantes.":
    "Observe route planning, prioritization of multiple objectives and adaptation to changing constraints.",
  "Escenario interactivo de planificación operativa (DEMO).": "Interactive operational planning scenario (DEMO).",
  "Planificación de Ruta Lunar Multi-Objetivo": "Multi-Objective Lunar Route Planning",
  "1. Analice el mapa de nodos lunares, consumo de reserva de O₂ y prioridades.\n2. Seleccione la secuencia de decisiones que cumple los objetivos sin agotar márgenes de seguridad.":
    "1. Analyze the lunar node map, O₂ reserve consumption and priorities.\n2. Select the decision sequence that meets the objectives without exhausting safety margins.",
  "Ejemplo: Dispone de 30 min de reserva. Ruta A tarda 18 min y Ruta B tarda 35 min. ¿Cuál ruta respeta el margen de seguridad?":
    "Example: You have 30 min of reserve. Route A takes 18 min and Route B takes 35 min. Which route respects the safety margin?",
  "Ruta A (18 min)": "Route A (18 min)",
  "Ruta B (35 min)": "Route B (35 min)",
  "Ambas": "Both",
  "Ninguna": "Neither",
  "Escenario Lunar: Usted está en Base Selene con 100 unidades de energía. Debe recolectar Muestra Geológica (Nodo Norte: costo 30), reparar Sensor Solar (Nodo Este: costo 25) y regresar a Esclusa (costo 25). Evite el Cráter Sombra (costo 60). ¿Cuál ruta completa ambos objetivos dentro del límite?":
    "Lunar scenario: You are at Selene Base with 100 energy units. You must collect a Geological Sample (North Node: cost 30), repair the Solar Sensor (East Node: cost 25) and return to the Airlock (cost 25). Avoid Shadow Crater (cost 60). Which route completes both objectives within the limit?",
  "Base → Nodo Norte → Nodo Este → Esclusa (Total: 80 u)": "Base → North Node → East Node → Airlock (Total: 80 u)",
  "Base → Cráter Sombra → Nodo Norte → Esclusa (Total: 115 u)": "Base → Shadow Crater → North Node → Airlock (Total: 115 u)",
  "Base → Cráter Sombra → Nodo Este → Esclusa (Total: 110 u)": "Base → Shadow Crater → East Node → Airlock (Total: 110 u)",
  "Permanecer sin recolectar muestras": "Stay put without collecting samples",
  "Cambio dinámico en exploración: A mitad de ruta se detecta incremento de radiación solar. ¿Qué secuencia de decisión prioriza la seguridad según protocolo?":
    "Dynamic change during exploration: Midway along the route, increased solar radiation is detected. Which decision sequence prioritizes safety per protocol?",
  "Guardar coordenada actual, suspender recolección secundaria y dirigirse al refugio presurizado más cercano":
    "Save current coordinates, suspend secondary collection and head to the nearest pressurized shelter",
  "Acelerar hacia el punto más lejano sin avisar a Tierra": "Speed toward the farthest point without notifying the ground",
  "Apagar el dosímetro para ahorrar batería": "Turn off the dosimeter to save battery",
  "Ignorar el aviso hasta terminar todos los objetivos": "Ignore the warning until all objectives are complete",
  "Optimización de recursos en mapa de 4 sectores: Sector 1 (Agua +20), Sector 2 (Sin datos), Sector 3 (Antena +15), Sector 4 (Tormenta de polvo).Si solo puede visitar 2 sectores seguros para maximizar recursos y comunicaciones:":
    "Resource optimization on a 4-sector map: Sector 1 (Water +20), Sector 2 (No data), Sector 3 (Antenna +15), Sector 4 (Dust storm). If you can only visit 2 safe sectors to maximize resources and communications:",
  "Sector 1 y Sector 3": "Sector 1 and Sector 3",
  "Sector 2 y Sector 4": "Sector 2 and Sector 4",
  "Sector 1 y Sector 4": "Sector 1 and Sector 4",
  "Sector 3 y Sector 4": "Sector 3 and Sector 4",
  // I. VISUAL_TRACKING
  "I. Seguimiento Visual Interactivo en Pantalla (Visual Tracking)": "I. Interactive On-Screen Visual Tracking",
  "Observar la capacidad de seguir objetos en movimiento e identificar sus trayectorias y posiciones finales.":
    "Observe the ability to follow moving objects and identify their trajectories and final positions.",
  "IMPORTANTE: Seguimiento visual interactivo basado en pantalla (mouse/teclado/táctil). NO equivale a una medición clínica oculomotora ni utiliza hardware de eye-tracking.":
    "IMPORTANT: Interactive screen-based visual tracking (mouse/keyboard/touch). It is NOT equivalent to a clinical oculomotor measurement and does not use eye-tracking hardware.",
  "Seguimiento de Objetivos Orbitales en Movimiento (Basado en Pantalla)": "Moving Orbital Target Tracking (Screen-Based)",
  "1. Siga visualmente el marcador objetivo en la zona de simulación.\n2. Indique el cuadrante o marcador final al detenerse el movimiento.":
    "1. Visually follow the target marker in the simulation area.\n2. Indicate the final quadrant or marker when the movement stops.",
  "Ejemplo: El satélite Alfa inicia en el Cuadrante I, se desplaza hacia abajo al Cuadrante IV y luego a la izquierda al Cuadrante III. ¿Dónde terminó?":
    "Example: Satellite Alpha starts in Quadrant I, moves down to Quadrant IV and then left to Quadrant III. Where did it end up?",
  "Cuadrante I": "Quadrant I",
  "Cuadrante II": "Quadrant II",
  "Cuadrante III": "Quadrant III",
  "Cuadrante IV": "Quadrant IV",
  "Rastreo de 2 objetos: Sonda-1 (inicia en X=10, Y=20; velocidad +15 en X, +5 en Y por segundo durante 2 s). ¿Cuál es la posición final de Sonda-1?":
    "Tracking 2 objects: Probe-1 (starts at X=10, Y=20; velocity +15 in X, +5 in Y per second for 2 s). What is Probe-1's final position?",
  "Cruce de trayectorias en pantalla: Tres balizas (A, B, C) rotan 90° en sentido antihorario alrededor del centro. Si 'A' estaba ARRIBA (Norte), ¿en qué posición final se detiene 'A'?":
    "On-screen crossing trajectories: Three beacons (A, B, C) rotate 90° counterclockwise around the center. If 'A' was at the TOP (North), where does 'A' finally stop?",
  "IZQUIERDA (Oeste)": "LEFT (West)",
  "DERECHA (Este)": "RIGHT (East)",
  "ABAJO (Sur)": "BOTTOM (South)",
  "ARRIBA (Norte)": "TOP (North)",
  "Seguimiento multi-objetivo: El marcador Objetivo-Alfa se mueve [Centro → Superior-Derecha → Inferior-Derecha → Centro-Izquierda]. ¿Cuál fue su última posición?":
    "Multi-target tracking: The Target-Alpha marker moves [Center → Top-Right → Bottom-Right → Center-Left]. What was its last position?",
  "Centro-Izquierda": "Center-Left",
  "Inferior-Derecha": "Bottom-Right",
  "Superior-Derecha": "Top-Right",
  "Centro": "Center",

  /* ---------------------------------------------------------------------
     Centro Emocional — cuestionario estructurado (EMOTIONAL_CHECKIN_DEMO_V1)
     --------------------------------------------------------------------- */
  "Cuestionario Estructurado de Bienestar Emocional y Acompañamiento en Misión (DEMO)":
    "Structured Emotional Well-being & In-Mission Support Questionnaire (DEMO)",
  "Evaluación preventiva de 12 dimensiones emocionales y preguntas abiertas opcionales solicitada para acompañar la adaptación de la tripulación con privacidad reforzada.":
    "Preventive assessment of 12 emotional dimensions plus optional open questions, requested to support crew adaptation with enhanced privacy.",
  "Últimos 3 a 7 días de misión": "Last 3 to 7 days of the mission",
  "AVISO ÉTICO Y DE PRIVACIDAD: Este cuestionario es una herramienta preventiva de demostración (NO diagnóstica y NO validada clínicamente). Sus respuestas detalladas están protegidas con privacidad reforzada; la administración solo visualiza el estado operativo de cumplimiento.":
    "ETHICS AND PRIVACY NOTICE: This questionnaire is a preventive demonstration tool (NOT diagnostic and NOT clinically validated). Your detailed answers are protected with enhanced privacy; administrators only see the operational completion status.",
  "Evaluación multidimensional sin puntaje único universal de salud mental.":
    "Multidimensional assessment with no single universal mental-health score.",
  // Opciones de escala
  "1 - Muy bajo / Casi nunca": "1 - Very low / Almost never",
  "2 - Bajo / Ocasionalmente": "2 - Low / Occasionally",
  "3 - Moderado / Regularmente": "3 - Moderate / Regularly",
  "4 - Alto / Frecuentemente": "4 - High / Frequently",
  "5 - Muy alto / Casi siempre": "5 - Very high / Almost always",
  "Prefiero no responder": "Prefer not to answer",
  "1 - No requiero acompañamiento adicional por ahora": "1 - I don't need additional support for now",
  "2 - Me gustaría mantener seguimiento preventivo habitual": "2 - I'd like to keep my usual preventive follow-up",
  "3 - Deseo conversar próximamente con apoyo de misión": "3 - I'd like to talk with mission support soon",
  "4 - Solicito revisión prioritaria con especialista autorizado": "4 - I request a priority review with an authorized specialist",
  "5 - Necesito apoyo inmediato / protocolo urgente": "5 - I need immediate support / urgent protocol",
  // Preguntas
  "¿Cómo describirías tu estado de ánimo general durante las últimas 24–48 horas?":
    "How would you describe your overall mood over the last 24–48 hours?",
  "¿Qué nivel de estrés o sobrecarga percibes frente a las tareas actuales?":
    "What level of stress or overload do you feel regarding your current tasks?",
  "¿En qué medida has experimentado sensación de aislamiento o distancia de tus seres queridos?":
    "To what extent have you felt isolated or distant from your loved ones?",
  "¿Qué tan cómoda y fluida sientes tu adaptación al entorno y rutinas de la misión?":
    "How comfortable and smooth does your adaptation to the mission environment and routines feel?",
  "¿Cómo evalúas la calidad reparadora de tu descanso reciente?": "How would you rate how restorative your recent rest has been?",
  "¿Qué nivel de desgaste o fatiga emocional sientes al finalizar la jornada?":
    "What level of emotional wear or fatigue do you feel at the end of the day?",
  "¿Qué tan respaldado te sientes por tu tripulación y por el equipo en Tierra?":
    "How supported do you feel by your crew and by the team on the ground?",
  "¿Cómo describirías tu motivación y sentido de propósito con los objetivos actuales?":
    "How would you describe your motivation and sense of purpose with the current objectives?",
  "¿Qué tanta sensación de control y recursos propios sientes para manejar imprevistos?":
    "How much sense of control and personal resources do you feel you have to handle the unexpected?",
  "¿Qué nivel de preocupación tienes respecto al desarrollo técnico u operativo de la misión?":
    "How concerned are you about the technical or operational progress of the mission?",
  "¿Qué nivel de acompañamiento o conversación con el equipo de apoyo deseas solicitar?":
    "What level of support or conversation with the support team would you like to request?",
  "En conjunto, ¿cómo valoras tu bienestar integral en este momento de la misión?":
    "Overall, how would you rate your general well-being at this point in the mission?",
  "1. ¿Cómo te has sentido durante los últimos días de la misión? (Opcional)":
    "1. How have you been feeling over the last few days of the mission? (Optional)",
  "2. ¿Hay alguna situación que te esté generando preocupación o cansancio? (Opcional)":
    "2. Is any situation causing you worry or fatigue? (Optional)",
  "3. ¿Cómo sientes tu nivel de descanso y concentración? (Opcional)": "3. How do you feel about your rest and concentration? (Optional)",
  "4. ¿Cómo percibes la comunicación con el equipo en tierra? (Opcional)":
    "4. How do you perceive communication with the ground team? (Optional)",
  "5. ¿Necesitas apoyo adicional en este momento? (Opcional)": "5. Do you need additional support right now? (Optional)",
  "6. ¿Deseas conversar de forma privada con el líder o personal autorizado? (Opcional)":
    "6. Would you like to talk privately with the leader or authorized staff? (Optional)",

  /* ---------------------------------------------------------------------
     Usuarios / perfiles de astronauta DEMO
     (nombres de personas y callsigns no se traducen)
     --------------------------------------------------------------------- */
  "Comandante & Fisiología de Superficie": "Commander & Surface Physiology",
  "Especialista de Misión & Geología Lunar": "Mission Specialist & Lunar Geology",
  "Ingeniero de Sistemas en Tránsito Profundo": "Deep-Transit Systems Engineer",
  "Sin restricciones operativas activas": "No active operational restrictions",
  "Vigilar hidratación post-EVA": "Monitor post-EVA hydration",
  "Misión independiente Ares-Pathfinder": "Independent Ares-Pathfinder mission",
  "Perfil ficticio de demostración (SIMULADO).": "Fictional demonstration profile (SIMULATED).",

  /* ---------------------------------------------------------------------
     Misiones, fases y contexto (nombres de misión ya en inglés)
     --------------------------------------------------------------------- */
  "Misión ficticia de 30 días combinando tránsito cislunar, órbita Gateway y operaciones en el Polo Sur Lunar.":
    "Fictional 30-day mission combining cislunar transit, Gateway orbit and Lunar South Pole operations.",
  "Hábitat Presurizado Lunar 'Selene-Base' & Módulo Gateway": "'Selene-Base' Pressurized Lunar Habitat & Gateway Module",
  "1. Línea Base Pre-Misión (Tierra)": "1. Pre-Mission Baseline (Earth)",
  "2. Lanzamiento e Inserción Orbital": "2. Launch & Orbit Insertion",
  "3. Tránsito Cislunar y Órbita Gateway": "3. Cislunar Transit & Gateway Orbit",
  "4. Estancia en Superficie Lunar (Hábitat)": "4. Lunar Surface Stay (Habitat)",
  "5. Actividades Extravehiculares (EVA)": "5. Extravehicular Activities (EVA)",
  "6. Tránsito de Regreso y Recuperación": "6. Return Transit & Recovery",
  "Misión ficticia de crucero en espacio profundo hacia Marte para pruebas de aislamiento y autonomía médica.":
    "Fictional deep-space cruise mission toward Mars for isolation and medical-autonomy testing.",
  "Nave de Tránsito Interplanetario 'Ares-Vanguard'": "'Ares-Vanguard' Interplanetary Transit Vehicle",
  "Crucero de espacio profundo con retardo de comunicación simulado.": "Deep-space cruise with simulated communication delay.",
  // Contextos (location_module) — se respeta la errata "dePreparación" del seed
  "Hábitat Presurizado Selene-Base (Sector Alfa)": "Selene-Base Pressurized Habitat (Sector Alpha)",
  "Laboratorio Biomédico Selene-Base": "Selene-Base Biomedical Laboratory",
  "Esclusa dePreparación EVA-2": "EVA-2 Prep Airlock",
  "Esclusa de Preparación EVA-2": "EVA-2 Prep Airlock",
  "Módulo Crucero Ares-Vanguard": "Ares-Vanguard Cruise Module",

  /* ---------------------------------------------------------------------
     Sensores
     --------------------------------------------------------------------- */
  "Bio-Monitor Óptico & ECG (Elena)": "Optical & ECG Bio-Monitor (Elena)",
  "Dosímetro Personal CPD-Alfa (Elena)": "CPD-Alpha Personal Dosimeter (Elena)",
  "Bio-Monitor Óptico & ECG (Marcus)": "Optical & ECG Bio-Monitor (Marcus)",
  "Analizador Metabólico Portátil (Marcus)": "Portable Metabolic Analyzer (Marcus)",
  "Bio-Monitor Crucero Profundo (Kenji)": "Deep-Cruise Bio-Monitor (Kenji)",

  /* ---------------------------------------------------------------------
     Notas de mediciones DEMO (las de fase variable → PATTERNS)
     --------------------------------------------------------------------- */
  "[SIMULADO] Evaluación de turno en Hábitat Selene-Base.": "[SIMULATED] Shift assessment in Selene-Base Habitat.",
  "[SIMULADO] Telemetría de tránsito profundo Ares Pathfinder.": "[SIMULATED] Ares Pathfinder deep-transit telemetry.",

  /* ---------------------------------------------------------------------
     Telemetría ambiental (EnvironmentalMeasurement)
     --------------------------------------------------------------------- */
  "Temperatura Ambiental de Cabina": "Cabin Ambient Temperature",
  "Nominal": "Nominal",
  "Humedad Relativa": "Relative Humidity",
  "Confortable": "Comfortable",
  "Presión Total de Hábitat": "Total Habitat Pressure",
  "Presión Parcial de Oxígeno (ppO₂)": "Oxygen Partial Pressure (ppO₂)",
  "Concentración de CO₂": "CO₂ Concentration",
  "En observación (<3.5 mmHg)": "Under observation (<3.5 mmHg)",
  "Tasa de Radiación Ambiental": "Ambient Radiation Rate",
  "Flujo solar moderado": "Moderate solar flux",
  "Índice de Calidad del Aire (VOCs)": "Air Quality Index (VOCs)",
  "Óptimo": "Optimal",
  "ICA": "AQI",
  "Partículas y Polvo Lunar (PM2.5)": "Particulates & Lunar Dust (PM2.5)",
  "Filtración HEPA activa": "HEPA filtration active",
  "Iluminación Circadiana del Módulo": "Module Circadian Lighting",
  "Fase diurna activa": "Daytime phase active",
  "Nivel Acústico de Fondo": "Background Noise Level",
  "Ventilación ECLSS continua": "Continuous ECLSS ventilation",
  "Estado de Ventilación": "Ventilation Status",
  "Soporte Vital Regenerativo (ECLSS)": "Regenerative Life Support (ECLSS)",
  "Integración de Trajes EVA": "EVA Suit Integration",
  "STANDBY_IN_AIRLOCK (Sin EVA activa)": "STANDBY_IN_AIRLOCK (No active EVA)",

  /* ---------------------------------------------------------------------
     Evaluaciones de bienestar DEMO (reflexiones privadas sintéticas)
     --------------------------------------------------------------------- */
  "[DEMO PRIVADO - Elena] Buena adaptación al ritmo del hábitat lunar; planeo usar la guía de respiración antes de dormir.":
    "[PRIVATE DEMO - Elena] Adapting well to the lunar habitat's rhythm; I plan to use the breathing guide before sleep.",
  "[DEMO PRIVADO - Marcus] Algo de cansancio acumulado tras la preparación de muestras lunares.":
    "[PRIVATE DEMO - Marcus] Some accumulated fatigue after preparing lunar samples.",

  /* ---------------------------------------------------------------------
     Gamificación DEMO (mensajes de refuerzo y motivos de insignias)
     --------------------------------------------------------------------- */
  "Rutina completada: evaluación registrada.": "Routine completed: assessment logged.",
  "Buen trabajo: registraste tu descanso.": "Nice work: you logged your rest.",
  "Exploraste el módulo cardiovascular.": "You explored the cardiovascular module.",
  "Medición de pulso verificada.": "Pulse measurement verified.",
  "Revisión ambiental completada.": "Environmental review completed.",
  "Omitida durante EVA programada sin penalización.": "Skipped during scheduled EVA, no penalty.",
  "Primer registro fisiológico validado en misión TeleCreation UTS.": "First validated physiological record on the TeleCreation UTS mission.",
  "Racha de 5 días de participación constante.": "5-day streak of consistent participation.",
  "Registro de rutina de descanso completado.": "Rest routine log completed.",
  "Exploración de cápsulas educativas en Body Explorer.": "Explored educational capsules in the Body Explorer.",
  "Primera actividad cognitiva interactiva completada en misión.": "First interactive cognitive activity completed in mission.",
  "Evaluación del dominio MEMORY completada en Hábitat Selene-Base.": "MEMORY domain assessment completed in Selene-Base Habitat.",

  /* ---------------------------------------------------------------------
     Communication Center DEMO (conversaciones, mensajes, solicitudes)
     --------------------------------------------------------------------- */
  "Canal Directo: Cmdr. Elena Rostova ↔ Dir. Carlos Ibáñez": "Direct Channel: Cmdr. Elena Rostova ↔ Dir. Carlos Ibáñez",
  "Canal Directo: Dr. Marcus Vance ↔ Dir. Carlos Ibáñez": "Direct Channel: Dr. Marcus Vance ↔ Dir. Carlos Ibáñez",
  "Nuevo mensaje de Dir. Carlos Ibáñez": "New message from Dir. Carlos Ibáñez",
  "[SIMULADO] Hola Dir. Carlos, finalicé el turno de superficie lunar. Registré pulso ligeramente elevado (93 bpm) e hidratación en 1950 ml; ya inicié pauta de rehidratación fraccionada.":
    "[SIMULATED] Hi Dir. Carlos, I've finished my lunar surface shift. I logged a slightly elevated pulse (93 bpm) and hydration at 1950 ml; I've already started a split rehydration schedule.",
  "[SIMULADO] Recibido Cmdr. Elena. Confirmamos desde Control en Tierra tu lectura en estado MONITOR. Mantén reposo relativo antes del bloque de sueño y avísanos tras tu próxima toma de agua.":
    "[SIMULATED] Copy, Cmdr. Elena. Ground Control confirms your reading in MONITOR state. Keep to light activity before your sleep block and let us know after your next water intake.",
  "[SIMULADO] Equipo en Tierra, dormí 5.1 horas y siento fatiga acumulada tras catalogar muestras. Solicito ajuste preventivo en el cronograma secundario de mañana.":
    "[SIMULATED] Ground team, I slept 5.1 hours and feel accumulated fatigue after cataloging samples. Requesting a preventive adjustment to tomorrow's secondary timeline.",
  "Ajuste preventivo de carga por fatiga de sueño (5.1 h)": "Preventive workload adjustment due to sleep-related fatigue (5.1 h)",
  "[SIMULADO] Solicitud de redistribución de carga operativa y revisión de higiene de sueño tras alerta WARNING de descanso (5.1 h).":
    "[SIMULATED] Request to redistribute operational workload and review sleep hygiene following a WARNING rest alert (5.1 h).",
  "En revisión con planificación de vuelo para ampliar ventana de descanso nocturno.":
    "Under review with flight planning to extend the overnight rest window.",
  // EMERGENCY_PROTOCOL_BANNER (api/v1/expansion_router.py)
  "PROTOCOLO DE EMERGENCIA DE VUELO ACTIVO: El Communication Center complementa pero NO reemplaza el canal prioritario de emergencia médica/operativa. Contacte de inmediato al Oficial Médico de Tripulación (CMO) y a Dirección de Vuelo por bucle de voz prioritario.":
    "IN-FLIGHT EMERGENCY PROTOCOL ACTIVE: The Communication Center supplements but does NOT replace the priority medical/operational emergency channel. Immediately contact the Crew Medical Officer (CMO) and the Flight Director on the priority voice loop.",

  /* ---------------------------------------------------------------------
     Emotional Assessment Center DEMO (solicitudes, resultados, avisos)
     --------------------------------------------------------------------- */
  "Hola Cmdr. Elena, te invitamos a completar tu cuestionario preventivo semanal de adaptación en Selene-Base.":
    "Hi Cmdr. Elena, we invite you to complete your weekly preventive adaptation questionnaire at Selene-Base.",
  "Estado operativo: EMOTIONAL_WELLNESS_STABLE. Cuestionario completado a tiempo sin solicitud de apoyo urgente.":
    "Operational status: EMOTIONAL_WELLNESS_STABLE. Questionnaire completed on time with no urgent support request.",
  "Gracias por completar tu check-in emocional. Tus respuestas reflejan una adaptación estable y buen respaldo interpersonal durante la fase de superficie lunar.":
    "Thank you for completing your emotional check-in. Your answers reflect stable adaptation and good interpersonal support during the lunar surface phase.",
  "Mantener rutina de higiene circadiana pre-sueño y contacto periódico con el líder en Tierra.":
    "Keep up the pre-sleep circadian hygiene routine and regular contact with the leader on the ground.",
  "Estimada Cmdr. Elena: tras las actividades extravehiculares recientes, agradeceremos tu check-in breve sobre descanso, carga percibida y necesidad de apoyo.":
    "Dear Cmdr. Elena: following the recent extravehicular activities, we would appreciate a brief check-in on your rest, perceived workload and need for support.",
  "Nuevo cuestionario emocional solicitado por Administración": "New emotional questionnaire requested by Administration",
  "Se ha solicitado tu participación en el Check-In Emocional Post-EVA Lunar.":
    "Your participation has been requested in the Lunar Post-EVA Emotional Check-In.",
  "Dr. Marcus: te enviamos este cuestionario breve para acompañar tu recuperación tras la jornada de geología lunar.":
    "Dr. Marcus: we're sending you this short questionnaire to support your recovery after the lunar geology shift.",
  "Nuevo cuestionario emocional solicitado: Seguimiento de Descanso": "New emotional questionnaire requested: Rest Follow-up",
  "Por favor completa tu check-in emocional cuando dispongas de 5 minutos.":
    "Please complete your emotional check-in when you have 5 minutes.",

  /* ---------------------------------------------------------------------
     Regiones corporales (BODY_REGIONS_CATALOG, api/v1/router.py)
     --------------------------------------------------------------------- */
  // HEAD_BRAIN
  "Cabeza, Cerebro y Ritmo Circadiano": "Head, Brain & Circadian Rhythm",
  "Regulación neurocognitiva, control autonómico, equilibrio vestibular, vigilia y arquitectura del sueño.":
    "Neurocognitive regulation, autonomic control, vestibular balance, wakefulness and sleep architecture.",
  "Desplazamiento cefálico de fluidos en microgravedad, alteración del ciclo circadiano por órbitas rápidas o iluminación artificial, cinetosis espacial y fatiga cognitiva por aislamiento.":
    "Headward fluid shift in microgravity, circadian disruption from rapid orbits or artificial lighting, space motion sickness and isolation-related cognitive fatigue.",
  "Mantener rutina de higiene circadiana pre-sueño, pausas cognitivas programadas y registro honesto de fatiga antes de actividades críticas.":
    "Keep a pre-sleep circadian hygiene routine, scheduled cognitive breaks and honest fatigue reporting before critical activities.",
  // EYES_VISION
  "Ojos y Sistema Neuro-Ocular": "Eyes & Neuro-Ocular System",
  "Agudeza visual, acomodación, presión intraocular y transmisión óptica al córtex visual.":
    "Visual acuity, accommodation, intraocular pressure and optical transmission to the visual cortex.",
  "Síndrome Neuro-Ocular Asociado a Vuelos Espaciales (SANS) por congestión venosa cefálica, irritación por partículas de polvo lunar/marciano y fosfenos por radiación cósmica.":
    "Spaceflight-Associated Neuro-ocular Syndrome (SANS) from cephalic venous congestion, irritation from lunar/Martian dust particles and cosmic-ray phosphenes (light flashes).",
  "Vigilar presión arterial y niveles de CO₂ ambiental en cabina, realizar pausas visuales de enfoque lejano y usar protección ocular post-EVA.":
    "Monitor blood pressure and cabin CO₂ levels, take distance-focus visual breaks and wear eye protection after EVA.",
  // HEART_CARDIO
  "Corazón y Sistema Cardiovascular": "Heart & Cardiovascular System",
  "Bombeo hemodinámico, perfusión tisular, regulación barorrefleja y transporte de oxígeno.":
    "Hemodynamic pumping, tissue perfusion, baroreflex regulation and oxygen transport.",
  "Redistribución de ~2 litros de fluido hacia el tórax al entrar en microgravedad, disminución del volumen plasmático, remodelado cardíaco e intolerancia ortostática al regresar a gravedad.":
    "Shift of ~2 liters of fluid toward the chest on entering microgravity, reduced plasma volume, cardiac remodeling and orthostatic intolerance on return to gravity.",
  "Completar sesiones aeróbicas autorizadas, mantener hidratación estructurada y registrar pulso y presión arterial en reposo.":
    "Complete authorized aerobic sessions, maintain structured hydration and log resting pulse and blood pressure.",
  // LUNGS_RESP
  "Pulmones y Sistema Respiratorio": "Lungs & Respiratory System",
  "Intercambio alveolar de oxígeno (O₂) y eliminación de dióxido de carbono (CO₂).":
    "Alveolar oxygen (O₂) exchange and carbon dioxide (CO₂) removal.",
  "Homogeneización de ventilación-perfusión en microgravedad, exposición a bolsas de CO₂ en compartimentos mal ventilados, descompresión en EVA e inhalación accidental de polvo regolítico.":
    "More uniform ventilation-perfusion in microgravity, exposure to CO₂ pockets in poorly ventilated compartments, decompression during EVA and accidental inhalation of regolith dust.",
  "Verificar estado de ventilación ECLSS, supervisar SpO₂ y frecuencia respiratoria, y ejecutar protocolos de descontaminación de trajes.":
    "Check ECLSS ventilation status, monitor SpO₂ and respiratory rate, and carry out suit decontamination protocols.",
  // IMMUNE_SYSTEM
  "Sistema Inmunológico y Hematopoyético (Área Funcional Ilustrativa)": "Immune & Hematopoietic System (Illustrative Functional Area)",
  "Defensa frente a patógenos, vigilancia celular, hematopoyesis y respuesta inflamatoria.":
    "Defense against pathogens, cellular surveillance, hematopoiesis and inflammatory response.",
  "Disregulación inmunitaria inducida por estrés, reactivación de virus latentes en confinamiento y daño hematopoyético/celular por radiación cósmica galáctica y eventos solares.":
    "Stress-induced immune dysregulation, latent virus reactivation in confinement and hematopoietic/cellular damage from galactic cosmic radiation and solar events.",
  "Monitorear dosimetría personal de radiación, asegurar descanso reparador, nutrición equilibrada y manejo del estrés.":
    "Monitor personal radiation dosimetry and ensure restorative rest, balanced nutrition and stress management.",
  // DIGESTIVE_NUTRITION
  "Sistema Digestivo, Metabólico y Renal": "Digestive, Metabolic & Renal System",
  "Absorción de nutrientes, homeostasis glucémica, balance hidroelectrolítico y excreción renal.":
    "Nutrient absorption, glucose homeostasis, fluid-electrolyte balance and renal excretion.",
  "Enlentecimiento del tránsito gastrointestinal inicial, resistencia subclínica a la insulina y riesgo elevado de litiasis renal por hipercalciuria e hipohidratación.":
    "Early slowing of gastrointestinal transit, subclinical insulin resistance and elevated kidney-stone risk from hypercalciuria and underhydration.",
  "Cumplir la meta diaria de hidratación (Hydration Routine), fraccionar la ingesta de líquidos y registrar glucosa cuando el protocolo lo indique.":
    "Meet the daily hydration goal (Hydration Routine), split fluid intake throughout the day and log glucose when the protocol calls for it.",
  // BONES_SKELETAL
  "Huesos y Sistema Esquelético": "Bones & Skeletal System",
  "Soporte estructural biomecánico, protección visceral y reservorio mineral de calcio y fósforo.":
    "Biomechanical structural support, protection of internal organs and mineral reservoir of calcium and phosphorus.",
  "Desmineralización ósea acelerada (1–1.5% mensual en cadera y columna lumbar) por ausencia de carga gravitatoria mecánica.":
    "Accelerated bone demineralization (1–1.5% per month in the hip and lumbar spine) due to the absence of gravitational mechanical loading.",
  "Realizar cargas resistivas autorizadas (ARED/Move Safely), mantener ingesta hídrica para proteger el riñón del calcio movilizado y evitar cargas bruscas al reingreso.":
    "Perform authorized resistive loading (ARED/Move Safely), keep up fluid intake to protect the kidneys from mobilized calcium and avoid sudden loads after reentry.",
  // MUSCLES
  "Músculos y Sistema Locomotor": "Muscles & Locomotor System",
  "Generación de fuerza contráctil, control postural antigravitatorio y locomoción en superficie o EVA.":
    "Contractile force generation, antigravity postural control and locomotion on the surface or during EVA.",
  "Atrofia de fibras musculares posturales (sóleo, cuádriceps, paravertebrales) y fatiga muscular de tren superior durante operaciones en traje presurizado.":
    "Atrophy of postural muscle fibers (soleus, quadriceps, paraspinals) and upper-body muscle fatigue during pressurized-suit operations.",
  "Completar la rutina diaria de actividad física autorizada y alternar grupos musculares con periodos de recuperación.":
    "Complete the daily authorized physical activity routine and alternate muscle groups with recovery periods.",
  // SKIN_THERMO
  "Piel y Termorregulación": "Skin & Thermoregulation",
  "Barrera epitelial protectora, sensibilidad táctil y disipación térmica por sudoración y vasodilatación.":
    "Protective epithelial barrier, tactile sensitivity and heat dissipation through sweating and vasodilation.",
  "Menor disipación convectiva del calor en microgravedad, sequedad o abrasión cutánea por baja humedad y puntos de fricción dentro del traje EVA.":
    "Reduced convective heat dissipation in microgravity, skin dryness or abrasion from low humidity, and friction points inside the EVA suit.",
  "Vigilar temperatura corporal antes y después del ejercicio o EVA, revisar humedad ambiental del hábitat e hidratar la piel.":
    "Monitor body temperature before and after exercise or EVA, check habitat humidity and moisturize the skin.",
  // GENERAL_WELLNESS
  "Estado General y Bienestar Psicosocial": "General Status & Psychosocial Well-being",
  "Integración mente-cuerpo, regulación emocional, motivación, cohesión de tripulación y resiliencia.":
    "Mind-body integration, emotional regulation, motivation, crew cohesion and resilience.",
  "Aislamiento y confinamiento, distancia visual y comunicativa de la Tierra, sobrecarga de trabajo y monotonía sensorial.":
    "Isolation and confinement, visual and communication distance from Earth, workload overload and sensory monotony.",
  "Utilizar el Wellness Center privado, practicar respiración guiada, mantener enlaces familiares autorizados y solicitar apoyo sin estigma.":
    "Use the private Wellness Center, practice guided breathing, maintain authorized family links and ask for support without stigma.",

  /* ---------------------------------------------------------------------
     Módulo de aislamiento y confinamiento (docs/CONTRATO_AISLAMIENTO.md).
     Claves = textos LITERALES de backend/app/database/seed.py (LEISURE_ACTIVITIES_DATA,
     CREW_ACTIVITY_TEMPLATES_DATA, ISOLATION_XP_MISSIONS_DATA)
     y de backend/app/api/v1/isolation_router.py (consejos circadianos y detail= de HTTPException).
     tests/test_frontend_integrity.py comprueba que el catálogo y las plantillas estén cubiertos.
     Los source_title (NASA_GARDEN_SOURCE / NASA_HRP_SOURCE) ya están en inglés: no requieren entrada.
     --------------------------------------------------------------------- */
  // Tiempo libre (§2) — LEISURE_ACTIVITIES_DATA: título, descripción y pasos how_to
  // PLANT_CARE
  "Cuidar las plantas del huerto": "Tend the garden plants",
  "Revisar, regar y observar los cultivos del huerto del hábitat. Cuidar algo vivo aporta rutina, propósito y contacto con lo natural.":
    "Check, water and observe the crops in the habitat garden. Caring for something alive brings routine, purpose and contact with nature.",
  "Revisa la humedad del sustrato y el nivel de agua": "Check the substrate moisture and the water level",
  "Observa hojas nuevas o cambios de color": "Look for new leaves or changes in color",
  "Anota en tu diario cómo ha crecido desde la última vez": "Note in your journal how it has grown since last time",
  // PLANT_JOURNAL
  "Diario de crecimiento del huerto": "Garden growth journal",
  "Fotografiar o dibujar una planta y registrar su evolución día a día.":
    "Photograph or draw a plant and record how it changes day by day.",
  "Elige una planta del huerto": "Choose a plant from the garden",
  "Haz una foto o un boceto rápido": "Take a photo or make a quick sketch",
  "Escribe una línea sobre lo que ha cambiado": "Write one line about what has changed",
  // READING_BREAK
  "Lectura libre": "Free reading",
  "Un bloque corto de lectura por placer, sin relación con procedimientos de misión.":
    "A short block of reading for pleasure, unrelated to mission procedures.",
  "Elige un libro o relato de la biblioteca digital": "Choose a book or story from the digital library",
  "Silencia notificaciones no críticas": "Mute non-critical notifications",
  "Lee sin objetivo, solo por disfrutar": "Read with no goal, just for enjoyment",
  // PUZZLE_GAME
  "Rompecabezas o juego de lógica": "Puzzle or logic game",
  "Sudoku, crucigrama o rompecabezas para desconectar de la carga operativa.":
    "Sudoku, crossword or jigsaw puzzle to disconnect from the operational workload.",
  "Elige un nivel de dificultad cómodo": "Choose a comfortable difficulty level",
  "Juega sin cronómetro": "Play without a timer",
  "Para cuando termine el bloque, aunque no acabes": "Stop when the block ends, even if you haven't finished",
  // CARD_GAME
  "Partida rápida de cartas": "Quick card game",
  "Juego de cartas o de mesa breve con otra persona de la tripulación.":
    "A short card or board game with another crew member.",
  "Invita a un compañero o compañera": "Invite a crewmate",
  "Elige un juego de reglas sencillas": "Choose a game with simple rules",
  "Prioriza conversar más que ganar": "Focus more on talking than on winning",
  // MUSIC_LISTENING
  "Escuchar música de casa": "Listen to music from home",
  "Escuchar una lista de canciones que recuerde a la familia o a lugares queridos.":
    "Listen to a playlist that reminds you of your family or of places you love.",
  "Ponte auriculares": "Put on headphones",
  "Elige 2 o 3 canciones significativas": "Choose 2 or 3 meaningful songs",
  "Respira despacio mientras escuchas": "Breathe slowly while you listen",
  // MUSIC_PLAYING
  "Tocar un instrumento": "Play an instrument",
  "Practicar con un instrumento ligero o cantar unas canciones.":
    "Practice on a lightweight instrument or sing a few songs.",
  "Calienta con escalas o una canción conocida": "Warm up with scales or a familiar song",
  "Prueba algo nuevo durante unos minutos": "Try something new for a few minutes",
  "Comparte una pieza con la tripulación si te apetece": "Share a piece with the crew if you feel like it",
  // SKETCHING
  "Dibujo o boceto libre": "Free drawing or sketching",
  "Dibujar el interior del hábitat, una planta o un recuerdo de la Tierra.":
    "Draw the inside of the habitat, a plant or a memory of Earth.",
  "Toma lápiz y papel o una tableta": "Grab pencil and paper or a tablet",
  "Elige un motivo cercano": "Pick a subject close at hand",
  "Dibuja sin buscar perfección": "Draw without aiming for perfection",
  // EARTH_PHOTOGRAPHY
  "Fotografía de la Tierra por la ventana": "Photographing Earth through the window",
  "Fotografiar la Tierra o el paisaje exterior y elegir la mejor imagen del día.":
    "Photograph Earth or the outside landscape and pick the best image of the day.",
  "Consulta cuándo hay buena vista": "Check when there will be a good view",
  "Haz varias tomas": "Take several shots",
  "Guarda una favorita para compartir con tu familia": "Save a favorite to share with your family",
  // GRATITUDE_JOURNAL
  "Diario de gratitud": "Gratitude journal",
  "Escribir tres cosas buenas del día, por pequeñas que sean.":
    "Write down three good things from the day, however small.",
  "Abre tu diario privado": "Open your private journal",
  "Escribe tres cosas concretas": "Write three specific things",
  "Relee la entrada de ayer": "Reread yesterday's entry",
  // LETTER_HOME
  "Carta a casa": "Letter home",
  "Escribir una carta o mensaje largo a la familia para enviarlo en la próxima ventana de comunicaciones.":
    "Write a letter or a long message to your family to send in the next communications window.",
  "Piensa en una anécdota del día": "Think of something that happened today",
  "Escribe como si hablaras en persona": "Write as if you were talking in person",
  "Guárdala para enviarla cuando haya enlace": "Save it to send when there is a link",
  // STRETCH_BREAK
  "Estiramientos suaves": "Gentle stretching",
  "Pausa de estiramientos suaves autorizados para soltar tensión (no sustituye al ejercicio prescrito).":
    "A break for gentle authorized stretches to release tension (does not replace prescribed exercise).",
  "Asegura los pies en los anclajes": "Secure your feet in the foot restraints",
  "Estira cuello, hombros y espalda despacio": "Slowly stretch your neck, shoulders and back",
  "Respira profundamente en cada postura": "Breathe deeply in each position",
  // DANCE_BREAK
  "Pausa de baile": "Dance break",
  "Una canción para moverse libremente y cambiar de energía.": "One song to move freely and shift your energy.",
  "Elige una canción animada": "Choose an upbeat song",
  "Muévete con seguridad en el espacio disponible": "Move safely within the available space",
  "Invita a alguien si te apetece": "Invite someone if you feel like it",

  // Plantillas de actividades de tripulación (§3) — CREW_ACTIVITY_TEMPLATES_DATA
  "Comida compartida": "Shared meal",
  "Comer juntos sin pantallas de trabajo: conversar, compartir comida y celebrar el día.":
    "Eat together away from work screens: talk, share food and celebrate the day.",
  "Noche de película": "Movie night",
  "Ver juntos una película o serie elegida por votación de la tripulación.":
    "Watch a movie or series together, chosen by a crew vote.",
  "Huerto en grupo": "Group gardening",
  "Cuidar juntos el huerto del hábitat: riego, poda y cosecha compartida.":
    "Tend the habitat garden together: watering, pruning and a shared harvest.",
  "Juego de mesa": "Board game",
  "Partida de un juego de mesa o de cartas en equipo.": "A team game of cards or a board game.",
  "Observación de la Tierra": "Earth observation",
  "Reunirse junto a la ventana para observar y fotografiar la Tierra.":
    "Gather by the window to watch and photograph Earth.",
  "Celebración de la tripulación": "Crew celebration",
  "Celebrar un cumpleaños, un hito de misión o una fiesta de casa.":
    "Celebrate a birthday, a mission milestone or a holiday from home.",

  // Misiones de XP del módulo — ISOLATION_XP_MISSIONS_DATA (DailyMission LEISURE_BREAK / CREW_INTEGRATION)
  "Tiempo libre registrado": "Free time logged",
  "Registrar una actividad breve de tiempo libre.": "Log a short free-time activity.",
  "El ocio planificado ayuda a mantener el bienestar en aislamiento y confinamiento.":
    "Planned leisure helps maintain well-being in isolation and confinement.",
  "Actividad de integración de la tripulación": "Crew integration activity",
  "Asistir a una actividad de integración que alcanzó el quórum.": "Attend an integration activity that reached quorum.",
  "La cohesión de la tripulación es un factor protector frente al aislamiento (NASA HRP).":
    "Crew cohesion is a protective factor against isolation (NASA HRP).",

  // Consejos circadianos — isolation_router.py → _circadian_tip()
  "Registra tu sueño unos días para recibir una recomendación circadiana.":
    "Log your sleep for a few days to get a circadian recommendation.",
  "Tu sueño medio está por debajo de 6 h: protege el bloque de descanso, reduce la luz azul 1 h antes y evita cafeína en la segunda mitad del turno.":
    "Your average sleep is below 6 h: protect your rest block, reduce blue light 1 h before bed and avoid caffeine in the second half of your shift.",
  "Vas cerca del objetivo: intenta acostarte a la misma hora y usar la iluminación de tono cálido antes de dormir.":
    "You're close to the goal: try to go to bed at the same time and use warm-toned lighting before sleeping.",
  "Buen descanso: mantén horarios regulares de luz y sueño para sostener tu ritmo circadiano.":
    "Good rest: keep regular light and sleep schedules to sustain your circadian rhythm.",

  // Errores (detail=) — isolation_router.py
  "Clave de deduplicación ya utilizada.": "Deduplication key already used.",
  "Categoría de tiempo libre no válida.": "Invalid free-time category.",
  "Actividad de tiempo libre no encontrada.": "Free-time activity not found.",
  "Indique mission_id: no tiene una misión activa asignada.": "Provide mission_id: you have no active mission assigned.",
  "Misión no encontrada.": "Mission not found.",
  "Acceso denegado: no está asignado a esta misión.": "Access denied: you are not assigned to this mission.",
  "Acceso denegado.": "Access denied.",
  "Actividad no encontrada.": "Activity not found.",
  "Solo los participantes de la actividad pueden hacer esta acción.": "Only the activity's participants can do this.",
  "Estado de actividad no válido.": "Invalid activity status.",
  "Plantilla de actividad no encontrada.": "Activity template not found.",
  "La fecha debe estar entre los últimos 7 días y los próximos 180 días.":
    "The date must be within the last 7 days or the next 180 days.",
  "La misión no tiene tripulación asignada.": "The mission has no crew assigned.",
  "Solo se puede responder a actividades programadas.": "You can only respond to scheduled activities.",
  "Ya registraste tu asistencia a esta actividad.": "You have already recorded your attendance at this activity.",
  "La actividad está cancelada.": "The activity is cancelled.",
  "Debes unirte (JOINED) antes de registrar asistencia.": "You must join (JOINED) before recording attendance.",
  "Solo puedes registrar asistencia desde 15 minutos antes del inicio hasta 24 horas después del final de la actividad.":
    "You can only record attendance from 15 minutes before the start until 24 hours after the end of the activity.",
  "Solo quien creó la actividad, el líder asignado o administración pueden cancelarla.":
    "Only the activity's creator, the assigned leader or administration can cancel it.",
  "Solo se pueden cancelar actividades programadas.": "Only scheduled activities can be cancelled.",

  // Errores de mensajes — expansion_router.py
  "El mensaje citado no pertenece a esta conversación.": "The quoted message does not belong to this conversation.",
};

/* -------------------------------------------------------------------------
   Patrones: textos del seed construidos con f-strings (valores dentro).
   Se evalúan sobre el texto normalizado (saltos de línea → un espacio).
   ------------------------------------------------------------------------- */
export const PATTERNS = [
  // ClinicalRule.name = f"Protocolo Preventivo {indicador} (DEMO)"
  [/^Protocolo Preventivo (.+) \(DEMO\)$/, (m, bt) => `Preventive Protocol: ${bt(m[1])} (DEMO)`],

  // ClinicalRuleVersion.immediate_instructions (bloque completo; también Alert.immediate_action)
  [
    /^1\. Suspenda actividad física exigente y permanezca en observación segura\. 2\. Verifique colocación del sensor o repita la medición de (.+) en 10 minutos\. 3\. Si el estado es CRITICAL, active comunicación prioritaria con el Oficial Médico de Tripulación y Tierra\.$/,
    (m, bt) =>
      "1. Stop strenuous physical activity and remain under safe observation.\n" +
      `2. Check sensor placement or repeat the ${bt(m[1])} measurement in 10 minutes.\n` +
      "3. If the state is CRITICAL, open priority communication with the Crew Medical Officer and the ground.",
  ],
  // ...misma instrucción, línea 2 suelta (btLines)
  [
    /^2\. Verifique colocación del sensor o repita la medición de (.+) en 10 minutos\.$/,
    (m, bt) => `2. Check sensor placement or repeat the ${bt(m[1])} measurement in 10 minutes.`,
  ],

  // ClinicalRuleVersion.followup_instructions (también Alert.followup_recommendation)
  [
    /^Registrar medición de seguimiento de (.+), revisar condiciones ambientales de cabina \(CO₂\/temperatura\) y documentar actuación en el Centro de Alertas\.$/,
    (m, bt) =>
      `Log a follow-up ${bt(m[1])} measurement, review cabin environmental conditions (CO₂/temperature) and document the response in the Alert Center.`,
  ],

  // MissionPhase.description = f"Fase {pname} (Escenario DEMO)."
  [/^Fase (.+) \(Escenario DEMO\)\.$/, (m, bt) => `Phase ${bt(m[1])} (DEMO scenario).`],

  // HealthMeasurement.notes = f"[SIMULADO] Registro histórico de fase {ph}."
  [/^\[SIMULADO\] Registro histórico de fase (\S+)\.$/, (m) => `[SIMULATED] Historical record for phase ${m[1]}.`],

  // CognitiveAssessment.conditions_notes = f"[SIMULADO] Sesión realizada en fase {ph}."
  [/^\[SIMULADO\] Sesión realizada en fase (\S+)\.$/, (m) => `[SIMULATED] Session performed during phase ${m[1]}.`],

  // CognitiveResult.practice_effect_note
  [
    /^Intento #(\d+) en dificultad (\S+) \(([^)]+)\)\. Sólo comparable con evaluaciones del mismo dominio, dificultad y versión\.$/,
    (m) => `Attempt #${m[1]} at ${m[2]} difficulty (${m[3]}). Only comparable with assessments of the same domain, difficulty and version.`,
  ],

  // CognitiveResult.non_diagnostic_summary
  [
    /^\[SIMULADO\] Desempeño en dominio (\S+): ([\d.,]+)% de precisión y ([\d.,]+) ms de tiempo medio\. Evaluación orientativa específica por dominio \(no representa un puntaje global de inteligencia ni un diagnóstico clínico\)\.$/,
    (m) =>
      `[SIMULATED] Performance in domain ${m[1]}: ${m[2]}% accuracy and ${m[3]} ms mean response time. ` +
      "Domain-specific indicative assessment (does not represent an overall intelligence score or a clinical diagnosis).",
  ],

  // Alert.title (Elena) = f"[{state}] {indicador}: {valor} {unidad} (SIMULADO)"
  [
    /^\[(\w+)\] (.+): (\S+) (.+) \(SIMULADO\)$/,
    (m, bt) => `[${m[1]}] ${bt(m[2])}: ${m[3]} ${bt(m[4])} (SIMULATED)`,
  ],

  // Alert.title (Marcus) = f"[WARNING] {indicador} ({nombre}): {valor} {unidad}"
  // Si "indicador (x)" es en sí un nombre de indicador traducible, no hay persona.
  [
    /^\[(\w+)\] (.+) \(([^()]+)\): (\S+) (.+)$/,
    (m, bt) => {
      const whole = `${m[2]} (${m[3]})`;
      const tw = bt(whole);
      if (tw !== whole) return `[${m[1]}] ${tw}: ${m[4]} ${bt(m[5])}`;
      return `[${m[1]}] ${bt(m[2])} (${m[3]}): ${m[4]} ${bt(m[5])}`;
    },
  ],

  // Alert.explanation (Elena)
  [
    /^El indicador (.+) registró (\S+) (.+?), superando el rango habitual \[(\S+)–(\S+) (.+?)\] según protocolo (\S+) \(([^)]+)\)\. Señal operativa preventiva \(no diagnóstica\)\.$/,
    (m, bt) =>
      `The ${bt(m[1])} indicator recorded ${m[2]} ${bt(m[3])}, outside the usual range [${m[4]}–${m[5]} ${bt(m[6])}] ` +
      `per protocol ${m[7]} (${m[8]}). Preventive operational signal (non-diagnostic).`,
  ],

  // Alert.explanation (Marcus)
  [
    /^Lectura de (.+) \((\S+) ([^()]+)\) requiere seguimiento preventivo post-EVA conforme a (\S+) v(\S+)\.$/,
    (m, bt) =>
      `${bt(m[1])} reading (${m[2]} ${bt(m[3])}) requires preventive post-EVA follow-up per ${m[4]} v${m[5]}.`,
  ],

  // Conversation.subject = "Canal Directo: {astronauta} ↔ {líder}"
  [/^Canal Directo: (.+) ↔ (.+)$/, (m) => `Direct Channel: ${m[1]} ↔ ${m[2]}`],

  // MessageNotification.title = "Nuevo mensaje de {remitente}"
  [/^Nuevo mensaje de (.+)$/, (m) => `New message from ${m[1]}`],
];
