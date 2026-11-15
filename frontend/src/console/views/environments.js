/*
 * AstroVital · Consola de salud · Vista "Insights por entorno"
 *
 * Reto NASA Space Apps "Health Monitoring Software for Astronauts": información de salud
 * para astronautas en distintos entornos (nave espacial, estación espacial, rover,
 * base en otro planeta, superficie lunar).
 *
 * Para cada entorno muestra:
 *  - peligros clave con valores de referencia por rango (gravedad, radiación, retardo…)
 *  - prioridades de salud por sistema corporal, con el estado actual de la región del tripulante
 *  - contramedidas recomendadas y cadencia de monitoreo
 *  - insights personalizados por reglas (no diagnósticos) combinando el entorno con los datos
 *    del tripulante (getConsoleData de console.js)
 *  - una tabla comparativa de los 5 entornos con el actual resaltado y previsualización
 *    de otro entorno sin cambiar el real
 *
 * El entorno real lo gestiona console.js (CREW_ENVIRONMENTS / getCrewEnvironment, persistido en
 * localStorage "av_crew_env" y notificado con el evento window "av:environment-change").
 * Se lee de forma defensiva por si esas exportaciones aún no existen.
 *
 * Igual que las demás vistas, solo usa atributos data-env-* (console.js tiene listeners
 * delegados para [data-act], [data-nav] y form[data-form] dentro de .av-console).
 * Los listeners del nodo raíz se descartan con él; el de window se quita al desmontar.
 */
import * as C from "../console.js";
import { tr, getLang, onLangChange } from "../../i18n/i18n.js";
import { bt } from "/src/i18n/backend.js";
import { LETTER, RANK, STATE_WORD, alertClassOf, isAlarm } from "../alert-classes.js";

/* ───────────────────────── textos (es / en) ─────────────────────────
 * Cada función de render obtiene el idioma actual con  const T = tr(DICT);
 * (los objetos anidados de "en" están completos: tr() solo cae a "es" en el primer nivel). */

const DICT = {
 es: {
  title: "Insights por entorno",
  subtitle: "Riesgos, prioridades y contramedidas según dónde está el tripulante",
  current: "Entorno actual",
  previewing: "Previsualizando",
  currentTag: "ACTUAL",
  previewTag: "VISTA",
  selectorLabel: "Previsualizar entorno (no cambia el entorno real)",
  backToCurrent: "Volver al entorno actual",
  previewNote: (label) => `Vista previa de «${label}»: el entorno real no cambia.`,
  announcePreview: (label) => `Mostrando insights de ${label}.`,
  announceCurrent: (label) => `Entorno actual cambiado a ${label}.`,
  hazardsH: "Peligros clave",
  systemsH: "Prioridades de salud por sistema",
  systemsYour: "Tu estado",
  thSystem: "Sistema",
  thPriority: "Prioridad",
  thWhy: "Por qué en este entorno",
  cmH: "Contramedidas y cadencia de monitoreo",
  insightsH: "Insights personalizados",
  insightsSub: "Reglas sobre tus datos + el entorno. Orientativo: no diagnostica.",
  insightsLoading: "Cargando tus datos…",
  insightsNoData: "Sin datos del tripulante disponibles: se muestran solo las recomendaciones generales del entorno.",
  insightsError: "No se pudieron cargar tus datos; se muestran las recomendaciones generales.",
  insightsNone: "Sin hallazgos particulares en tus datos para este entorno. Sigue las contramedidas generales.",
  basis: "Basado en",
  serverCtx: (name, delay) => `Contexto de misión registrado en el servidor: ${name}${delay ? ` · retardo ${delay}` : ""}.`,
  compareH: "Comparativa de entornos",
  compareSub: "Diferencias de un vistazo. Pulsa la cabecera de un entorno para previsualizarlo.",
  compareCaption: "Comparativa de peligros, ejercicio y prioridad principal en los cinco entornos",
  rowHazard: "Peligro",
  rowExercise: "Ejercicio orientativo",
  rowTop: "Prioridad principal",
  exUnit: "min/día",
  exNote: "objetivo orientativo de la app (demo), no prescripción",
  level: { 1: "Bajo", 2: "Medio", 3: "Alto" },
  levelWord: "Nivel",
  disclaimer: "AstroVital ayuda a observar, registrar y comunicar información de salud; no diagnostica ni sustituye al personal médico. Ante cualquier duda, consulta al médico de vuelo.",
  sources: "Fuentes: NASA-STD-3001 Vol. 1 y 2 (salud de tripulación y habitabilidad) y riesgos del NASA Human Research Program (radiación espacial, SANS, pérdida ósea y muscular, desacondicionamiento cardiovascular, sensoriomotor, sueño, aislamiento y confinamiento, polvo de regolito). Valores por rango y orientativos: varían con la misión, el blindaje, la actividad solar y la actividad del tripulante.",

  cm: {
    exercise: "Ejercicio",
    watch: "Indicadores a vigilar",
    dosimeter: "Dosímetro",
    sleep: "Sueño y ritmo circadiano",
    autonomy: "Autonomía frente a Tierra",
    extra: "Específico del entorno",
  },

  hz: {
    grav: "Gravedad",
    rad: "Radiación (tasa típica)",
    comm: "Retardo de comunicación",
    vol: "Volumen habitable / confinamiento",
    eclss: "CO₂ / soporte vital (ECLSS)",
    dust: "Polvo (regolito)",
    eva: "Frecuencia de EVA",
    light: "Ciclo luz-oscuridad",
    iso: "Aislamiento",
  },

  sys: {
    msk: "Hueso y músculo",
    sans: "Visión (SANS)",
    cardio: "Cardiovascular",
    rad: "Radiación",
    sleep: "Sueño / circadiano",
    psych: "Aislamiento psicológico",
    dust: "Inhalación de polvo",
    sensor: "Sensoriomotor (transiciones de gravedad)",
  },

  ind: {
    HEART_RATE: "Frecuencia cardiaca",
    BLOOD_PRESSURE: "Presión arterial",
    RESP_RATE: "Frecuencia respiratoria",
    SLEEP_DURATION: "Duración del sueño",
    PERCEIVED_FATIGUE: "Fatiga percibida",
    MOOD_WELLNESS: "Estado de ánimo",
    PHYSICAL_ACTIVITY: "Actividad física",
    RADIATION_EXPOSURE: "Exposición a radiación",
    BODY_TEMP: "Temperatura corporal",
    HYDRATION: "Hidratación",
  },

  env: {
    spacecraft: {
      label: "Nave espacial",
      ctx: "Tránsito en espacio profundo (p. ej., hacia la Luna o Marte), fuera de la magnetosfera terrestre.",
      place: "En la nave",
      delayPhrase: "En tránsito a Marte el retardo llega a 24 min",
      hz: {
        grav: ["0 g", "Microgravedad continua"],
        rad: ["~1,8 mGy/día", "Rayos cósmicos sin protección magnetosférica; riesgo de eventos solares"],
        comm: ["1,3 s → 24 min", "Crece con la distancia (cislunar → tránsito a Marte)"],
        vol: ["Muy reducido", "Cápsula o hábitat de tránsito; poca privacidad"],
        eclss: ["Cerrado, sin reabastecimiento", "Fallo de ECLSS = riesgo inmediato; CO₂ a vigilar"],
        dust: ["No aplica", "Salvo retorno con muestras de superficie"],
        eva: ["Rara", "Solo por contingencia"],
        light: ["Sin ciclo natural", "Iluminación artificial programada"],
        iso: ["Extrema", "La Tierra se reduce a un punto; sin rescate"],
      },
      sys: {
        msk: "Pérdida ósea y muscular continua en 0 g con equipo de ejercicio compacto.",
        sans: "Desplazamiento de fluidos hacia la cabeza: riesgo de SANS en estancias largas.",
        cardio: "Desacondicionamiento cardiovascular; intolerancia ortostática al llegar a destino.",
        rad: "Mayor exposición de los cinco entornos; refugio ante eventos solares.",
        sleep: "Sin día natural: el horario depende de la iluminación programada.",
        psych: "Confinamiento prolongado y lejanía extrema de la Tierra.",
        dust: "Sin polvo de regolito en tránsito.",
        sensor: "Adaptación a 0 g al inicio y readaptación brusca en el aterrizaje.",
      },
      cm: {
        exercise: "Resistencia + aeróbico diario con dispositivo compacto; registrar cada sesión.",
        watch: [["HEART_RATE", "diaria"], ["BLOOD_PRESSURE", "diaria"], ["SLEEP_DURATION", "diaria"], ["RADIATION_EXPOSURE", "continua (dosímetro activo)"], ["MOOD_WELLNESS", "2–3 veces/semana"]],
        dosimeter: "Lectura diaria del dosímetro personal y alarma activa de eventos solares (refugio).",
        sleep: "Horario fijo con luz programada (más azul al despertar, cálida antes de dormir).",
        autonomy: "Con retardo de minutos, aplicar primero los procedimientos a bordo; Tierra confirma después.",
        extra: "Ensayar el protocolo de refugio ante tormenta solar y vigilar visión cada semana.",
      },
    },
    station: {
      label: "Estación espacial",
      ctx: "Órbita baja terrestre (LEO), tipo ISS, dentro de la magnetosfera y con reabastecimiento.",
      place: "En la estación",
      delayPhrase: "En la estación el retardo es inferior a 1 s",
      hz: {
        grav: ["0 g", "Microgravedad continua"],
        rad: ["~0,3–0,5 mGy/día", "Parcialmente protegida por la magnetosfera; picos en la Anomalía del Atlántico Sur"],
        comm: ["< 1 s", "Casi en tiempo real, con pérdidas de señal (LOS) breves"],
        vol: ["El mayor", "Varios módulos; misiones de meses"],
        eclss: ["Con reabastecimiento", "CO₂ de cabina más alto que en Tierra: cefalea y fatiga posibles"],
        dust: ["No aplica", "Partículas flotantes en 0 g (limpieza de filtros)"],
        eva: ["Periódica", "Programada para mantenimiento"],
        light: ["~16 amaneceres/día", "Órbita de ~90 min; ciclo artificial"],
        iso: ["Moderado", "Contacto frecuente con Tierra, visitas y carga"],
      },
      sys: {
        msk: "Pérdida ósea y muscular en 0 g; requiere ejercicio diario de resistencia.",
        sans: "SANS documentado en estancias largas: control visual periódico.",
        cardio: "Desacondicionamiento cardiovascular durante meses en 0 g.",
        rad: "Exposición menor que en espacio profundo, pero acumulativa en misiones largas.",
        sleep: "Amaneceres cada ~90 min y ruido de equipos alteran el sueño.",
        psych: "Confinamiento con apoyo cercano de Tierra.",
        dust: "Sin regolito; solo partículas en suspensión.",
        sensor: "Cinetosis al llegar y readaptación al regresar a Tierra.",
      },
      cm: {
        exercise: "Resistencia (tipo ARED) + cinta y cicloergómetro; ~600 min/semana en la app.",
        watch: [["HEART_RATE", "diaria"], ["BLOOD_PRESSURE", "2–3 veces/semana"], ["SLEEP_DURATION", "diaria"], ["PHYSICAL_ACTIVITY", "diaria"], ["RADIATION_EXPOSURE", "semanal"]],
        dosimeter: "Revisión semanal del dosímetro personal; seguir los avisos de paso por la Anomalía del Atlántico Sur.",
        sleep: "Antifaz y tapones; iluminación de estación ajustada al horario de misión.",
        autonomy: "Coordinación casi en tiempo real con Tierra; durante LOS seguir el procedimiento a bordo.",
        extra: "Control visual periódico (SANS) y vigilancia de síntomas asociados al CO₂.",
      },
    },
    rover: {
      label: "Rover presurizado",
      ctx: "Rover presurizado en superficie lunar o marciana, en salidas de varios días lejos del hábitat.",
      place: "En el rover",
      delayPhrase: "En el rover, lejos del hábitat, el retardo llega a 24 min si opera en Marte",
      hz: {
        grav: ["0,16–0,38 g", "Gravedad parcial (Luna / Marte)"],
        rad: ["~0,7–1,4 mGy/día", "Marte ~0,7 · Luna ~1,4; blindaje del vehículo limitado"],
        comm: ["1,3 s – 24 min", "Luna ~1,3 s; Marte 4–24 min; relés con cobertura irregular"],
        vol: ["Mínimo", "Cabina compacta para 2; varios días seguidos"],
        eclss: ["Compacto, autonomía limitada", "Consumibles por días; CO₂ crítico"],
        dust: ["Alto", "Entradas y salidas frecuentes con traje"],
        eva: ["Muy frecuente", "Exploración y muestreo"],
        light: ["Según emplazamiento", "Luna: ~14 días de luz/oscuridad · Marte: sol de ~24 h 39 min"],
        iso: ["Alta", "Lejos del hábitat; rescate limitado"],
      },
      sys: {
        msk: "La gravedad parcial no basta para mantener hueso y músculo; la carga de EVA ayuda pero cansa.",
        sans: "Menos estudiado en gravedad parcial; mantener control visual tras el tránsito.",
        cardio: "Esfuerzo alto en EVA tras meses de desacondicionamiento.",
        rad: "Blindaje del vehículo limitado; buscar refugio ante eventos solares.",
        sleep: "Turnos de exploración y cabina reducida fragmentan el sueño.",
        psych: "Espacio mínimo y convivencia estrecha durante días.",
        dust: "Regolito arrastrado a cabina en cada entrada: irritación respiratoria y ocular.",
        sensor: "Riesgo de caídas y desorientación al operar en gravedad parcial.",
      },
      cm: {
        exercise: "Mantener una sesión diaria corta en cabina; la EVA cuenta como carga, no como sustituto.",
        watch: [["HEART_RATE", "antes y después de cada EVA"], ["RESP_RATE", "tras cada EVA"], ["PERCEIVED_FATIGUE", "diaria"], ["SLEEP_DURATION", "diaria"], ["RADIATION_EXPOSURE", "diaria"]],
        dosimeter: "Lectura diaria y plan de regreso o refugio si hay alerta de evento solar.",
        sleep: "Turnos de sueño fijos entre salidas; oscurecer la cabina durante el día lunar.",
        autonomy: "Planificar decisiones sin Tierra: procedimientos y botiquín a bordo, umbrales de regreso al hábitat.",
        extra: "Limpieza del traje antes de entrar (suitport/esclusa) y filtros de cabina revisados.",
      },
    },
    base: {
      label: "Base en otro planeta",
      ctx: "Base de larga duración en la superficie de Marte.",
      place: "En la base marciana",
      delayPhrase: "En Marte el retardo es de hasta 24 min",
      hz: {
        grav: ["0,38 g", "Gravedad marciana tras meses en 0 g"],
        rad: ["~0,7 mGy/día", "Atmósfera fina y el planeta bloquean parte de la radiación"],
        comm: ["4–24 min", "Sin enlace durante la conjunción solar"],
        vol: ["Moderado", "Hábitat de larga duración"],
        eclss: ["ECLSS + recursos locales", "Reabastecimiento solo en ventanas de lanzamiento"],
        dust: ["Alto", "Polvo marciano fino con percloratos; tormentas de polvo"],
        eva: ["Frecuente", "Exploración y mantenimiento"],
        light: ["Sol de ~24 h 39 min", "Desfase diario leve frente al reloj terrestre"],
        iso: ["Máximo", "Retorno solo en ventanas orbitales"],
      },
      sys: {
        msk: "Gravedad parcial tras el tránsito en 0 g: recuperar y mantener masa ósea y muscular.",
        sans: "Seguir la evolución de cambios visuales iniciados en el tránsito.",
        cardio: "Readaptación cardiovascular a 0,38 g tras meses en 0 g.",
        rad: "Menor que en la Luna, pero acumulativa durante una misión de años.",
        sleep: "El sol marciano desplaza el horario ~40 min al día respecto a Tierra.",
        psych: "Aislamiento máximo, comunicación diferida y sin retorno rápido.",
        dust: "Polvo fino con percloratos: posible toxicidad respiratoria.",
        sensor: "Readaptación al aterrizar: equilibrio y orientación.",
      },
      cm: {
        exercise: "Resistencia + aeróbico diario; carga progresiva tras el aterrizaje.",
        watch: [["HEART_RATE", "diaria"], ["BLOOD_PRESSURE", "diaria la 1.ª semana tras aterrizar"], ["RESP_RATE", "tras cada EVA"], ["MOOD_WELLNESS", "2–3 veces/semana"], ["SLEEP_DURATION", "diaria"]],
        dosimeter: "Revisión semanal; diaria durante eventos solares (refugio en el hábitat).",
        sleep: "Horario anclado al sol marciano con luz artificial para compensar el desfase.",
        autonomy: "Alta: decisiones médicas iniciales a bordo; Tierra asesora con 8–48 min de ida y vuelta.",
        extra: "Esclusa de polvo y control de percloratos en el hábitat; plan para la conjunción solar.",
      },
    },
    moon: {
      label: "Superficie lunar",
      ctx: "Base lunar en el polo sur de la Luna.",
      place: "En la Luna",
      delayPhrase: "En la Luna el retardo es de ~1,3 s",
      hz: {
        grav: ["0,16 g", "Gravedad lunar"],
        rad: ["~1,4 mGy/día", "Sin atmósfera ni campo magnético; eventos solares"],
        comm: ["~1,3 s", "Casi en tiempo real; zonas sin línea de vista en cráteres"],
        vol: ["Moderado", "Hábitat de superficie"],
        eclss: ["ECLSS con reabastecimiento", "Reabastecimiento en días"],
        dust: ["Muy alto", "Regolito lunar abrasivo y afilado"],
        eva: ["Frecuente", "Exploración del polo sur"],
        light: ["Luz rasante", "Polo sur: sombras largas y ciclo de ~29,5 días"],
        iso: ["Alto", "Regreso a la Tierra en días"],
      },
      sys: {
        msk: "La gravedad lunar no evita la pérdida ósea y muscular.",
        sans: "Seguir cambios visuales del tránsito; el polvo irrita los ojos.",
        cardio: "Esfuerzo de EVA en gravedad parcial tras el tránsito.",
        rad: "Exposición alta sin atmósfera; refugio ante eventos solares.",
        sleep: "Luz solar rasante casi continua: el ritmo depende de la luz artificial.",
        psych: "Aislamiento alto pero con comunicación casi inmediata.",
        dust: "Regolito afilado y electrostático: irritación respiratoria y ocular.",
        sensor: "Marcha y equilibrio distintos en 0,16 g; riesgo de caídas.",
      },
      cm: {
        exercise: "Resistencia + aeróbico diario; la EVA no sustituye al entrenamiento.",
        watch: [["RESP_RATE", "tras cada EVA"], ["HEART_RATE", "diaria"], ["SLEEP_DURATION", "diaria"], ["RADIATION_EXPOSURE", "diaria"], ["PERCEIVED_FATIGUE", "diaria"]],
        dosimeter: "Lectura diaria y alerta de eventos solares con tiempo de llegada al refugio.",
        sleep: "Oscurecer el hábitat y fijar el horario con luz artificial, no con el sol.",
        autonomy: "Coordinación casi en tiempo real con Tierra; preparar respuesta local en zonas sin enlace.",
        extra: "Control de polvo: limpieza del traje, esclusa y filtros; protección ocular.",
      },
    },
  },

  /* Plantillas de insights personalizados (reglas, no diagnóstico) */
  ins: {
    sleepAuto: (phrase) => `${phrase}: tu última alerta de sueño debe gestionarse de forma autónoma con el protocolo de a bordo, sin esperar respuesta de Tierra.`,
    sleepNear: (phrase) => `${phrase}: tu alerta de sueño puede coordinarse con Tierra casi en tiempo real. Revisa la higiene de sueño de este entorno.`,
    sleepDebt: (h, n) => `Deuda de sueño de ${h} h en las últimas ${n} noches frente a 8,5 h programadas.`,
    sleepOk: (n, light) => `Sin deuda de sueño relevante en las últimas ${n} noches. Mantén el horario fijo (${light}).`,
    exLow0g: (week, target) => `En 0 g la pérdida ósea y muscular es más rápida: llevas ${week} min de ejercicio esta semana frente a un objetivo orientativo de ${target} min.`,
    exLowPartial: (week, target, g) => `Con ${g} la gravedad no basta para mantener hueso y músculo: llevas ${week} min de ejercicio esta semana (objetivo orientativo ${target} min).`,
    exOk: (week, target) => `Ejercicio semanal en línea con el objetivo orientativo del entorno (${week} de ${target} min).`,
    exNone: "Sin registros de actividad física en los últimos 7 días: registra tus sesiones para poder compararlas con el objetivo del entorno.",
    radHigh: (ref, last, cad) => `En este entorno la tasa típica es ${ref}; tu última tasa registrada es ${last} mSv/día (dosis equivalente; no comparable 1:1 con mGy). Dosímetro: ${cad}.`,
    radState: (state) => `Tu indicador de radiación está en «${state}»: sigue el procedimiento de radiación y reduce el tiempo fuera del refugio.`,
    region: (place, sys, lvl, state) => `${place} la prioridad «${sys}» es de nivel ${lvl}, y tu región correspondiente está en «${state}». Refuerza las contramedidas y coméntalo con el médico de vuelo si persiste.`,
    alertsAuto: (n, phrase) => `Tienes ${n} alerta(s) crítica(s) o de precaución sin reconocer. ${phrase}: aplica primero el procedimiento a bordo.`,
    alertsNear: (n) => `Tienes ${n} alerta(s) crítica(s) o de precaución sin reconocer; con enlace casi inmediato, reconócelas y contacta con el líder en Tierra si lo necesitas.`,
    stale: (n, phrase) => `${n} indicador(es) sin actualizar o sin dato. ${phrase}: regístralos a bordo sin esperar indicaciones de Tierra.`,
    co2: (v, eclss) => `CO₂ de cabina en ${v} mmHg (límite NASA de 1 h: 3 mmHg). Soporte vital de este entorno: ${eclss}. Revisa el ECLSS y los síntomas (cefalea, fatiga).`,
  },
  basisText: {
    sleep: "alertas y serie de sueño",
    ex: "actividad física de 7 días",
    rad: "serie de radiación y rango del entorno",
    region: "estado de regiones corporales",
    alerts: "alertas activas y retardo del entorno",
    stale: "tarjetas de indicadores",
    co2: "telemetría ambiental",
  },
 },

 en: {
  title: "Environment insights",
  subtitle: "Risks, priorities and countermeasures for where the crew member is",
  current: "Current environment",
  previewing: "Previewing",
  currentTag: "CURRENT",
  previewTag: "PREVIEW",
  selectorLabel: "Preview environment (does not change the actual environment)",
  backToCurrent: "Back to current environment",
  previewNote: (label) => `Preview of “${label}”: the actual environment does not change.`,
  announcePreview: (label) => `Showing insights for ${label}.`,
  announceCurrent: (label) => `Current environment changed to ${label}.`,
  hazardsH: "Key hazards",
  systemsH: "Health priorities by system",
  systemsYour: "Your status",
  thSystem: "System",
  thPriority: "Priority",
  thWhy: "Why in this environment",
  cmH: "Countermeasures and monitoring cadence",
  insightsH: "Personalized insights",
  insightsSub: "Rules on your data + the environment. Guidance only: not a diagnosis.",
  insightsLoading: "Loading your data…",
  insightsNoData: "No crew member data available: showing only the general recommendations for this environment.",
  insightsError: "Could not load your data; showing the general recommendations.",
  insightsNone: "No specific findings in your data for this environment. Follow the general countermeasures.",
  basis: "Based on",
  serverCtx: (name, delay) => `Mission context recorded on the server: ${name}${delay ? ` · delay ${delay}` : ""}.`,
  compareH: "Environment comparison",
  compareSub: "Differences at a glance. Select an environment header to preview it.",
  compareCaption: "Comparison of hazards, exercise and top priority across the five environments",
  rowHazard: "Hazard",
  rowExercise: "Suggested exercise",
  rowTop: "Top priority",
  exUnit: "min/day",
  exNote: "app guidance target (demo), not a prescription",
  level: { 1: "Low", 2: "Medium", 3: "High" },
  levelWord: "Level",
  disclaimer: "AstroVital helps observe, log and communicate health information; it does not diagnose or replace medical staff. If in doubt, consult the flight surgeon.",
  sources: "Sources: NASA-STD-3001 Vol. 1 and 2 (crew health and habitability) and NASA Human Research Program risks (space radiation, SANS, bone and muscle loss, cardiovascular deconditioning, sensorimotor, sleep, isolation and confinement, regolith dust). Values are ranges and indicative: they vary with the mission, shielding, solar activity and crew activity.",

  cm: {
    exercise: "Exercise",
    watch: "Indicators to watch",
    dosimeter: "Dosimeter",
    sleep: "Sleep and circadian rhythm",
    autonomy: "Autonomy from Ground",
    extra: "Environment-specific",
  },

  hz: {
    grav: "Gravity",
    rad: "Radiation (typical rate)",
    comm: "Communication delay",
    vol: "Habitable volume / confinement",
    eclss: "CO₂ / life support (ECLSS)",
    dust: "Dust (regolith)",
    eva: "EVA frequency",
    light: "Light-dark cycle",
    iso: "Isolation",
  },

  sys: {
    msk: "Bone and muscle",
    sans: "Vision (SANS)",
    cardio: "Cardiovascular",
    rad: "Radiation",
    sleep: "Sleep / circadian",
    psych: "Psychological isolation",
    dust: "Dust inhalation",
    sensor: "Sensorimotor (gravity transitions)",
  },

  ind: {
    HEART_RATE: "Heart rate",
    BLOOD_PRESSURE: "Blood pressure",
    RESP_RATE: "Respiratory rate",
    SLEEP_DURATION: "Sleep duration",
    PERCEIVED_FATIGUE: "Perceived fatigue",
    MOOD_WELLNESS: "Mood",
    PHYSICAL_ACTIVITY: "Physical activity",
    RADIATION_EXPOSURE: "Radiation exposure",
    BODY_TEMP: "Body temperature",
    HYDRATION: "Hydration",
  },

  env: {
    spacecraft: {
      label: "Spacecraft",
      ctx: "Deep-space transit (e.g., to the Moon or Mars), outside Earth's magnetosphere.",
      place: "On the spacecraft",
      delayPhrase: "In transit to Mars the delay reaches 24 min",
      hz: {
        grav: ["0 g", "Continuous microgravity"],
        rad: ["~1.8 mGy/day", "Cosmic rays without magnetospheric protection; risk of solar events"],
        comm: ["1.3 s → 24 min", "Grows with distance (cislunar → Mars transit)"],
        vol: ["Very small", "Capsule or transit habitat; little privacy"],
        eclss: ["Closed, no resupply", "ECLSS failure = immediate risk; watch CO₂"],
        dust: ["N/A", "Except on return with surface samples"],
        eva: ["Rare", "Contingency only"],
        light: ["No natural cycle", "Scheduled artificial lighting"],
        iso: ["Extreme", "Earth shrinks to a dot; no rescue"],
      },
      sys: {
        msk: "Continuous bone and muscle loss in 0 g with compact exercise equipment.",
        sans: "Headward fluid shift: SANS risk on long stays.",
        cardio: "Cardiovascular deconditioning; orthostatic intolerance on arrival.",
        rad: "Highest exposure of the five environments; shelter during solar events.",
        sleep: "No natural day: the schedule depends on programmed lighting.",
        psych: "Prolonged confinement and extreme distance from Earth.",
        dust: "No regolith dust in transit.",
        sensor: "Adaptation to 0 g at the start and abrupt readaptation at landing.",
      },
      cm: {
        exercise: "Daily resistance + aerobic training on a compact device; log every session.",
        watch: [["HEART_RATE", "daily"], ["BLOOD_PRESSURE", "daily"], ["SLEEP_DURATION", "daily"], ["RADIATION_EXPOSURE", "continuous (active dosimeter)"], ["MOOD_WELLNESS", "2–3 times/week"]],
        dosimeter: "Daily personal dosimeter reading and active solar-event alarm (shelter).",
        sleep: "Fixed schedule with programmed light (bluer on waking, warm before sleep).",
        autonomy: "With minutes of delay, apply onboard procedures first; Ground confirms later.",
        extra: "Rehearse the solar-storm shelter protocol and check vision weekly.",
      },
    },
    station: {
      label: "Space station",
      ctx: "Low Earth orbit (LEO), ISS-like, inside the magnetosphere and with resupply.",
      place: "On the station",
      delayPhrase: "On the station the delay is under 1 s",
      hz: {
        grav: ["0 g", "Continuous microgravity"],
        rad: ["~0.3–0.5 mGy/day", "Partly shielded by the magnetosphere; peaks in the South Atlantic Anomaly"],
        comm: ["< 1 s", "Near real time, with brief loss of signal (LOS)"],
        vol: ["Largest", "Several modules; months-long missions"],
        eclss: ["With resupply", "Cabin CO₂ higher than on Earth: possible headache and fatigue"],
        dust: ["N/A", "Floating particles in 0 g (filter cleaning)"],
        eva: ["Periodic", "Scheduled for maintenance"],
        light: ["~16 sunrises/day", "~90-min orbit; artificial cycle"],
        iso: ["Moderate", "Frequent contact with Earth, visitors and cargo"],
      },
      sys: {
        msk: "Bone and muscle loss in 0 g; requires daily resistance exercise.",
        sans: "SANS documented on long stays: periodic vision checks.",
        cardio: "Cardiovascular deconditioning over months in 0 g.",
        rad: "Lower exposure than deep space, but cumulative on long missions.",
        sleep: "Sunrises every ~90 min and equipment noise disrupt sleep.",
        psych: "Confinement with close support from Ground.",
        dust: "No regolith; only airborne particles.",
        sensor: "Motion sickness on arrival and readaptation on return to Earth.",
      },
      cm: {
        exercise: "Resistance (ARED-type) + treadmill and cycle ergometer; ~600 min/week in the app.",
        watch: [["HEART_RATE", "daily"], ["BLOOD_PRESSURE", "2–3 times/week"], ["SLEEP_DURATION", "daily"], ["PHYSICAL_ACTIVITY", "daily"], ["RADIATION_EXPOSURE", "weekly"]],
        dosimeter: "Weekly personal dosimeter review; follow South Atlantic Anomaly pass advisories.",
        sleep: "Eye mask and earplugs; station lighting matched to the mission schedule.",
        autonomy: "Near real-time coordination with Ground; during LOS follow the onboard procedure.",
        extra: "Periodic vision checks (SANS) and monitoring for CO₂-related symptoms.",
      },
    },
    rover: {
      label: "Pressurized rover",
      ctx: "Pressurized rover on the lunar or Martian surface, on multi-day sorties away from the habitat.",
      place: "In the rover",
      delayPhrase: "In the rover, away from the habitat, the delay reaches 24 min if operating on Mars",
      hz: {
        grav: ["0.16–0.38 g", "Partial gravity (Moon / Mars)"],
        rad: ["~0.7–1.4 mGy/day", "Mars ~0.7 · Moon ~1.4; limited vehicle shielding"],
        comm: ["1.3 s – 24 min", "Moon ~1.3 s; Mars 4–24 min; relays with patchy coverage"],
        vol: ["Minimal", "Compact cabin for 2; several days in a row"],
        eclss: ["Compact, limited endurance", "Consumables for days; CO₂ critical"],
        dust: ["High", "Frequent suited ingress and egress"],
        eva: ["Very frequent", "Exploration and sampling"],
        light: ["Depends on site", "Moon: ~14 days of light/dark · Mars: ~24 h 39 min sol"],
        iso: ["High", "Far from the habitat; limited rescue"],
      },
      sys: {
        msk: "Partial gravity is not enough to maintain bone and muscle; EVA load helps but tires.",
        sans: "Less studied in partial gravity; keep vision checks after transit.",
        cardio: "High EVA exertion after months of deconditioning.",
        rad: "Limited vehicle shielding; seek shelter during solar events.",
        sleep: "Exploration shifts and a small cabin fragment sleep.",
        psych: "Minimal space and close quarters for days.",
        dust: "Regolith carried into the cabin at every ingress: respiratory and eye irritation.",
        sensor: "Risk of falls and disorientation when operating in partial gravity.",
      },
      cm: {
        exercise: "Keep a short daily session in the cabin; EVA counts as load, not as a substitute.",
        watch: [["HEART_RATE", "before and after each EVA"], ["RESP_RATE", "after each EVA"], ["PERCEIVED_FATIGUE", "daily"], ["SLEEP_DURATION", "daily"], ["RADIATION_EXPOSURE", "daily"]],
        dosimeter: "Daily reading and a return or shelter plan if there is a solar-event alert.",
        sleep: "Fixed sleep shifts between sorties; darken the cabin during the lunar day.",
        autonomy: "Plan decisions without Ground: onboard procedures and medical kit, thresholds for returning to the habitat.",
        extra: "Clean the suit before ingress (suitport/airlock) and check cabin filters.",
      },
    },
    base: {
      label: "Base on another planet",
      ctx: "Long-duration base on the surface of Mars.",
      place: "At the Martian base",
      delayPhrase: "On Mars the delay is up to 24 min",
      hz: {
        grav: ["0.38 g", "Martian gravity after months in 0 g"],
        rad: ["~0.7 mGy/day", "The thin atmosphere and the planet block part of the radiation"],
        comm: ["4–24 min", "No link during solar conjunction"],
        vol: ["Moderate", "Long-duration habitat"],
        eclss: ["ECLSS + local resources", "Resupply only in launch windows"],
        dust: ["High", "Fine Martian dust with perchlorates; dust storms"],
        eva: ["Frequent", "Exploration and maintenance"],
        light: ["~24 h 39 min sol", "Slight daily drift vs. Earth clock"],
        iso: ["Maximum", "Return only in orbital windows"],
      },
      sys: {
        msk: "Partial gravity after 0 g transit: recover and maintain bone and muscle mass.",
        sans: "Track the vision changes that began during transit.",
        cardio: "Cardiovascular readaptation to 0.38 g after months in 0 g.",
        rad: "Lower than on the Moon, but cumulative over a multi-year mission.",
        sleep: "The Martian sol shifts the schedule ~40 min per day relative to Earth.",
        psych: "Maximum isolation, delayed communication and no quick return.",
        dust: "Fine dust with perchlorates: possible respiratory toxicity.",
        sensor: "Readaptation on landing: balance and orientation.",
      },
      cm: {
        exercise: "Daily resistance + aerobic training; progressive loading after landing.",
        watch: [["HEART_RATE", "daily"], ["BLOOD_PRESSURE", "daily in the 1st week after landing"], ["RESP_RATE", "after each EVA"], ["MOOD_WELLNESS", "2–3 times/week"], ["SLEEP_DURATION", "daily"]],
        dosimeter: "Weekly review; daily during solar events (shelter in the habitat).",
        sleep: "Schedule anchored to the Martian sol with artificial light to offset the drift.",
        autonomy: "High: initial medical decisions onboard; Ground advises with 8–48 min round trip.",
        extra: "Dust airlock and perchlorate control in the habitat; plan for solar conjunction.",
      },
    },
    moon: {
      label: "Lunar surface",
      ctx: "Lunar base at the Moon's south pole.",
      place: "On the Moon",
      delayPhrase: "On the Moon the delay is ~1.3 s",
      hz: {
        grav: ["0.16 g", "Lunar gravity"],
        rad: ["~1.4 mGy/day", "No atmosphere or magnetic field; solar events"],
        comm: ["~1.3 s", "Near real time; no line of sight in craters"],
        vol: ["Moderate", "Surface habitat"],
        eclss: ["ECLSS with resupply", "Resupply within days"],
        dust: ["Very high", "Abrasive, sharp lunar regolith"],
        eva: ["Frequent", "South pole exploration"],
        light: ["Low-angle light", "South pole: long shadows and ~29.5-day cycle"],
        iso: ["High", "Return to Earth within days"],
      },
      sys: {
        msk: "Lunar gravity does not prevent bone and muscle loss.",
        sans: "Track vision changes from transit; dust irritates the eyes.",
        cardio: "EVA exertion in partial gravity after transit.",
        rad: "High exposure with no atmosphere; shelter during solar events.",
        sleep: "Almost continuous low-angle sunlight: rhythm depends on artificial light.",
        psych: "High isolation but near-immediate communication.",
        dust: "Sharp, electrostatic regolith: respiratory and eye irritation.",
        sensor: "Different gait and balance at 0.16 g; risk of falls.",
      },
      cm: {
        exercise: "Daily resistance + aerobic training; EVA does not replace training.",
        watch: [["RESP_RATE", "after each EVA"], ["HEART_RATE", "daily"], ["SLEEP_DURATION", "daily"], ["RADIATION_EXPOSURE", "daily"], ["PERCEIVED_FATIGUE", "daily"]],
        dosimeter: "Daily reading and solar-event alert with time to reach the shelter.",
        sleep: "Darken the habitat and set the schedule with artificial light, not the sun.",
        autonomy: "Near real-time coordination with Ground; prepare a local response for areas without a link.",
        extra: "Dust control: suit cleaning, airlock and filters; eye protection.",
      },
    },
  },

  ins: {
    sleepAuto: (phrase) => `${phrase}: your latest sleep alert must be handled autonomously with the onboard protocol, without waiting for a reply from Ground.`,
    sleepNear: (phrase) => `${phrase}: your sleep alert can be coordinated with Ground in near real time. Review this environment's sleep hygiene.`,
    sleepDebt: (h, n) => `Sleep debt of ${h} h over the last ${n} nights vs. 8.5 h scheduled.`,
    sleepOk: (n, light) => `No significant sleep debt over the last ${n} nights. Keep a fixed schedule (${light}).`,
    exLow0g: (week, target) => `In 0 g bone and muscle loss is faster: you have ${week} min of exercise this week vs. a suggested target of ${target} min.`,
    exLowPartial: (week, target, g) => `At ${g} gravity is not enough to maintain bone and muscle: you have ${week} min of exercise this week (suggested target ${target} min).`,
    exOk: (week, target) => `Weekly exercise in line with the environment's suggested target (${week} of ${target} min).`,
    exNone: "No physical activity records in the last 7 days: log your sessions so they can be compared with the environment target.",
    radHigh: (ref, last, cad) => `In this environment the typical rate is ${ref}; your latest logged rate is ${last} mSv/day (equivalent dose; not directly comparable with mGy). Dosimeter: ${cad}`,
    radState: (state) => `Your radiation indicator is at “${state}”: follow the radiation procedure and reduce time outside the shelter.`,
    region: (place, sys, lvl, state) => `${place} the “${sys}” priority is ${lvl}, and your corresponding region is at “${state}”. Reinforce the countermeasures and discuss it with the flight surgeon if it persists.`,
    alertsAuto: (n, phrase) => `You have ${n} unacknowledged caution or warning alert(s). ${phrase}: apply the onboard procedure first.`,
    alertsNear: (n) => `You have ${n} unacknowledged caution or warning alert(s); with a near-immediate link, acknowledge them and contact the ground lead if needed.`,
    stale: (n, phrase) => `${n} indicator(s) stale or missing. ${phrase}: log them onboard without waiting for instructions from Ground.`,
    co2: (v, eclss) => `Cabin CO₂ at ${v} mmHg (NASA 1-h limit: 3 mmHg). Life support in this environment: ${eclss}. Check the ECLSS and symptoms (headache, fatigue).`,
  },
  basisText: {
    sleep: "sleep alerts and series",
    ex: "7-day physical activity",
    rad: "radiation series and environment range",
    region: "body region status",
    alerts: "active alerts and environment delay",
    stale: "indicator cards",
    co2: "environmental telemetry",
  },
 },
};

/* ───────────────────────── datos (no texto) ───────────────────────── */

const ENV_KEYS = ["spacecraft", "station", "rover", "base", "moon"];
const ENV_CODE = { spacecraft: "SC", station: "LEO", rover: "RVR", base: "MARS", moon: "LUNA" };
const HZ_KEYS = ["grav", "rad", "comm", "vol", "eclss", "dust", "eva", "light", "iso"];
const SYS_KEYS = ["msk", "sans", "cardio", "rad", "sleep", "psych", "dust", "sensor"];

/* Niveles relativos 1 bajo · 2 medio · 3 alto (comparativos entre entornos, orientativos) */
const ENV_DATA = {
  spacecraft: {
    hz: { grav: 3, rad: 3, comm: 3, vol: 3, eclss: 3, dust: 1, eva: 1, light: 2, iso: 3 },
    sys: { msk: 3, sans: 3, cardio: 3, rad: 3, sleep: 2, psych: 3, dust: 1, sensor: 2 },
    exMin: 90, delayMaxS: 1440, microG: true,
  },
  station: {
    hz: { grav: 3, rad: 1, comm: 1, vol: 1, eclss: 2, dust: 1, eva: 2, light: 3, iso: 1 },
    sys: { msk: 3, sans: 3, cardio: 2, rad: 1, sleep: 3, psych: 1, dust: 1, sensor: 2 },
    exMin: 90, delayMaxS: 1, microG: true,
  },
  rover: {
    hz: { grav: 2, rad: 2, comm: 3, vol: 3, eclss: 3, dust: 3, eva: 3, light: 2, iso: 3 },
    sys: { msk: 2, sans: 1, cardio: 3, rad: 2, sleep: 2, psych: 3, dust: 3, sensor: 3 },
    exMin: 45, delayMaxS: 1440, microG: false,
  },
  base: {
    hz: { grav: 2, rad: 2, comm: 3, vol: 2, eclss: 2, dust: 3, eva: 2, light: 1, iso: 3 },
    sys: { msk: 2, sans: 2, cardio: 2, rad: 2, sleep: 2, psych: 3, dust: 3, sensor: 3 },
    exMin: 60, delayMaxS: 1440, microG: false,
  },
  moon: {
    hz: { grav: 2, rad: 3, comm: 1, vol: 2, eclss: 2, dust: 3, eva: 2, light: 3, iso: 2 },
    sys: { msk: 2, sans: 1, cardio: 2, rad: 3, sleep: 3, psych: 2, dust: 3, sensor: 3 },
    exMin: 60, delayMaxS: 1.3, microG: false,
  },
};

/* Sistema → regiones corporales / indicadores del tripulante */
const SYS_REGIONS = {
  msk: ["BONES_SKELETAL", "MUSCLES"],
  sans: ["EYES_VISION"],
  cardio: ["HEART_CARDIO"],
  rad: [],
  sleep: ["HEAD_BRAIN"],
  psych: ["GENERAL_WELLNESS"],
  dust: ["LUNGS_RESP"],
  sensor: [],
};
const SYS_CARDS = { rad: ["RADIATION_EXPOSURE"], sleep: ["SLEEP_DURATION"], psych: ["MOOD_WELLNESS", "PERCEIVED_FATIGUE"], cardio: ["HEART_RATE", "BLOOD_PRESSURE"], dust: ["RESP_RATE"] };

const PROGRAMMED_SLEEP_H = 8.5;
const STORAGE_KEY = "av_crew_env";
const EVENT_NAME = "av:environment-change";

/* Estado de la vista que se conserva al volver a la sección */
const ui = { preview: null, data: null, dataKey: null, listener: null, langOff: null };

/* ───────────────────────── utilidades ───────────────────────── */

const esc = (v) => (typeof C.escapeHtml === "function" ? C.escapeHtml(v) : String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])));
const fmt = (v, dec = 1) => Number(v).toLocaleString(getLang() === "en" ? "en-US" : "es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });

function badge(letter, title) {
  if (typeof C.badge === "function") return C.badge(letter, title);
  return `<span class="av-badge av-b-${letter}" title="${esc(title || "")}">${letter === "N" ? "–" : letter}</span>`;
}

function envLabel(key) {
  const list = Array.isArray(C.CREW_ENVIRONMENTS) ? C.CREW_ENVIRONMENTS : [];
  const hit = list.find((e) => e && e.key === key);
  return (hit && hit.label) || tr(DICT).env[key].label;
}
/* Código corto de pantalla (el `code` del contrato es el del backend y se repite entre rover y luna) */
function envCode(key) {
  return ENV_CODE[key];
}

/* Entorno real: console.js → localStorage → luna */
function currentEnv() {
  let key = null;
  try {
    if (typeof C.getCrewEnvironment === "function") key = C.getCrewEnvironment();
  } catch {
    key = null;
  }
  if (!ENV_KEYS.includes(key)) {
    try {
      key = localStorage.getItem(STORAGE_KEY);
    } catch {
      key = null;
    }
  }
  return ENV_KEYS.includes(key) ? key : "moon";
}

function levelHTML(lvl) {
  const T = tr(DICT);
  return `<span class="av-env-lv av-env-lv-${lvl}"><span class="av-env-lv-bars" aria-hidden="true"><i></i><i></i><i></i></span><span class="av-env-lv-txt">${esc(T.level[lvl])}</span></span>`;
}

/* ───────────────────────── render ───────────────────────── */

export async function renderEnvironmentsView(container, appState, helpers) {
  // Sin listener de una visita anterior
  if (ui.listener) {
    window.removeEventListener(EVENT_NAME, ui.listener);
    ui.listener = null;
  }
  if (ui.langOff) {
    ui.langOff();
    ui.langOff = null;
  }
  // Al entrar a la sección siempre se muestra el entorno general seleccionado (issue #5):
  // una vista previa de una visita anterior no sobrevive a la navegación
  ui.preview = null;
  const T = tr(DICT);

  container.innerHTML = `
  <div class="av-console av-env-root" data-env-root>
    <section class="av-env-wrap" aria-labelledby="av-env-h">
      <div class="av-panel">
        <div class="av-panel-head">
          <div>
            <h2 id="av-env-h" class="av-h2">${esc(T.title)}</h2>
            <div class="av-sub">${esc(T.subtitle)}</div>
          </div>
          <div class="av-env-now" data-env-zone="now"></div>
        </div>
        <div class="av-env-selrow">
          <span class="av-lbl" id="av-env-sel-l">${esc(T.selectorLabel)}</span>
          <div class="av-env-sel" role="radiogroup" aria-labelledby="av-env-sel-l" data-env-zone="selector"></div>
        </div>
        <p class="av-env-status" role="status" aria-live="polite" data-env-live></p>
      </div>
      <div class="av-env-grid">
        <div class="av-env-main" data-env-zone="main"></div>
        <aside class="av-env-side" aria-labelledby="av-env-ins-h">
          <div class="av-panel">
            <div class="av-panel-head">
              <div>
                <h3 id="av-env-ins-h" class="av-h3">${esc(T.insightsH)}</h3>
                <div class="av-sub">${esc(T.insightsSub)}</div>
              </div>
            </div>
            <div data-env-zone="insights"><p class="av-sub av-env-pad">${esc(T.insightsLoading)}</p></div>
          </div>
        </aside>
      </div>
      <section class="av-panel av-env-cmp" aria-labelledby="av-env-cmp-h">
        <div class="av-panel-head">
          <div>
            <h3 id="av-env-cmp-h" class="av-h3">${esc(T.compareH)}</h3>
            <div class="av-sub">${esc(T.compareSub)}</div>
          </div>
        </div>
        <div class="av-hscroll" data-env-zone="compare"></div>
      </section>
      <footer class="av-env-foot">
        <p class="av-env-disc">${esc(T.disclaimer)}</p>
        <p class="av-sub">${esc(T.sources)}</p>
      </footer>
    </section>
  </div>`;

  const root = container.querySelector("[data-env-root]");
  const ctx = { root, appState, helpers, loading: true, error: null };
  bind(ctx);
  renderAll(ctx);

  // Cambio del entorno real desde console.js (selector global)
  const onEnvChange = () => {
    if (!root.isConnected) {
      window.removeEventListener(EVENT_NAME, onEnvChange);
      if (ui.listener === onEnvChange) ui.listener = null;
      return;
    }
    const cur = currentEnv();
    // El entorno general manda: un cambio global descarta cualquier vista previa local
    ui.preview = null;
    renderAll(ctx);
    announce(ctx, tr(DICT).announceCurrent(envLabel(cur)));
  };
  ui.listener = onEnvChange;
  window.addEventListener(EVENT_NAME, onEnvChange);

  // Cambio de idioma mientras la vista está montada: se repintan los textos fijos y las zonas
  // (app.js también vuelve a navegar a la sección; si eso ocurre, este oyente se descarta al desmontar)
  const offLang = onLangChange(() => {
    if (!root.isConnected) {
      offLang();
      if (ui.langOff === offLang) ui.langOff = null;
      return;
    }
    renderShell(ctx);
    renderAll(ctx);
  });
  ui.langOff = offLang;

  // Datos del tripulante (caché compartida de la consola)
  const key = `${appState.selectedAstronautId ?? ""}|${appState.selectedMissionId ?? ""}`;
  if (ui.dataKey !== key) ui.data = null;
  try {
    if (typeof C.getConsoleData === "function") {
      ui.data = await C.getConsoleData(appState);
      ui.dataKey = key;
    }
  } catch (e) {
    ctx.error = e;
  }
  ctx.loading = false;
  if (!root.isConnected) return;
  renderMain(ctx);
  renderInsights(ctx);
}

function zone(ctx, name) {
  return ctx.root.querySelector(`[data-env-zone="${name}"]`);
}

function viewEnv() {
  return ui.preview && ENV_KEYS.includes(ui.preview) ? ui.preview : currentEnv();
}

/* Textos fijos del esqueleto (títulos, pie) sin rehacer el DOM (conserva zonas y listeners) */
function renderShell(ctx) {
  const T = tr(DICT);
  const set = (sel, text) => {
    const el = ctx.root.querySelector(sel);
    if (el) el.textContent = text;
  };
  set("#av-env-h", T.title);
  set("#av-env-h + .av-sub", T.subtitle);
  set("#av-env-sel-l", T.selectorLabel);
  set("#av-env-ins-h", T.insightsH);
  set("#av-env-ins-h + .av-sub", T.insightsSub);
  set("#av-env-cmp-h", T.compareH);
  set("#av-env-cmp-h + .av-sub", T.compareSub);
  set(".av-env-disc", T.disclaimer);
  set(".av-env-foot .av-sub", T.sources);
}

function renderAll(ctx) {
  renderNow(ctx);
  renderSelector(ctx);
  renderMain(ctx);
  renderInsights(ctx);
  renderCompare(ctx);
}

function renderNow(ctx) {
  const T = tr(DICT);
  const cur = currentEnv();
  const view = viewEnv();
  const z = zone(ctx, "now");
  z.innerHTML = `
    <div class="av-env-nowbox">
      <span class="av-lbl">${esc(T.current)}</span>
      <span class="av-env-nowval"><span class="av-mono av-env-code">${esc(envCode(cur))}</span> ${esc(envLabel(cur))}</span>
    </div>
    ${view !== cur ? `
    <div class="av-env-nowbox av-env-nowbox-prev">
      <span class="av-lbl">${esc(T.previewing)}</span>
      <span class="av-env-nowval"><span class="av-mono av-env-code">${esc(envCode(view))}</span> ${esc(envLabel(view))}</span>
    </div>
    <button type="button" class="av-btn av-btn-sm" data-env-act="reset">${esc(T.backToCurrent)}</button>` : ""}`;
}

function renderSelector(ctx) {
  const T = tr(DICT);
  const cur = currentEnv();
  const view = viewEnv();
  zone(ctx, "selector").innerHTML = ENV_KEYS.map((k) => {
    const on = k === view;
    return `<button type="button" role="radio" class="av-env-opt${k === cur ? " av-env-opt-cur" : ""}"
      aria-checked="${on}" tabindex="${on ? 0 : -1}" data-env-pick="${k}">
      <span class="av-mono av-env-code">${esc(envCode(k))}</span>
      <span class="av-env-opt-l">${esc(envLabel(k))}</span>
      ${k === cur ? `<span class="av-env-tag">${esc(T.currentTag)}</span>` : ""}
    </button>`;
  }).join("");
}

function renderMain(ctx) {
  const T = tr(DICT);
  const key = viewEnv();
  const t = T.env[key];
  const d = ENV_DATA[key];
  const cur = currentEnv();
  const regions = (ui.data && ui.data.regions) || [];
  const s = (ctx.appState && ctx.appState.healthSummary) || (ui.data && ui.data.summary) || {};
  const cards = s.indicator_cards || [];

  const hazards = HZ_KEYS.map((h) => {
    const [val, note] = t.hz[h];
    const lvl = d.hz[h];
    return `<li class="av-env-hz av-env-hz-${lvl}">
      <span class="av-lbl">${esc(T.hz[h])}</span>
      <span class="av-mono av-env-hzval">${esc(val)}</span>
      <span class="av-sub">${esc(note)}</span>
      <span class="av-env-hzlv"><span class="av-env-sr">${esc(T.levelWord)}: </span>${levelHTML(lvl)}</span>
    </li>`;
  }).join("");

  const systems = SYS_KEYS.slice().sort((a, b) => d.sys[b] - d.sys[a]).map((k) => {
    const lt = systemLetter(k, regions, cards);
    return `<tr>
      <th scope="row" class="av-env-sysname">${esc(T.sys[k])}</th>
      <td>${levelHTML(d.sys[k])}</td>
      <td class="av-env-systxt">${esc(t.sys[k])}</td>
      <td class="av-env-sysst">${lt ? `${badge(lt, STATE_WORD[lt])}<span class="av-env-sr"> ${esc(STATE_WORD[lt])}</span>` : `<span class="av-sub">—</span>`}</td>
    </tr>`;
  }).join("");

  const watch = t.cm.watch.map(([code, cad]) => {
    const card = cards.find((c) => c.indicator_code === code);
    const name = T.ind[code] || bt(card && card.name) || code;
    const lt = card ? LETTER[card.state] || "M" : null;
    return `<li><span>${esc(name)}</span> <span class="av-mono av-sub">· ${esc(cad)}</span>${lt && RANK[lt] > 0 ? ` ${badge(lt, STATE_WORD[lt])}` : ""}</li>`;
  }).join("");

  zone(ctx, "main").innerHTML = `
    <section class="av-panel" aria-labelledby="av-env-hz-h">
      <div class="av-panel-head">
        <div>
          <h3 id="av-env-hz-h" class="av-h3">${esc(T.hazardsH)} · ${esc(envLabel(key))}${key === cur ? ` <span class="av-env-tag">${esc(T.currentTag)}</span>` : ` <span class="av-env-tag av-env-tag-prev">${esc(T.previewTag)}</span>`}</h3>
          <div class="av-sub">${esc(t.ctx)}</div>
        </div>
      </div>
      ${key !== cur ? `<p class="av-env-prevnote">${esc(T.previewNote(envLabel(key)))}</p>` : ""}
      <ul class="av-env-hzlist">${hazards}</ul>
    </section>
    <section class="av-panel" aria-labelledby="av-env-sys-h">
      <div class="av-panel-head"><h3 id="av-env-sys-h" class="av-h3">${esc(T.systemsH)}</h3></div>
      <div class="av-hscroll">
        <table class="av-table av-env-systable">
          <thead><tr><th scope="col">${esc(T.thSystem)}</th><th scope="col">${esc(T.thPriority)}</th><th scope="col">${esc(T.thWhy)}</th><th scope="col">${esc(T.systemsYour)}</th></tr></thead>
          <tbody>${systems}</tbody>
        </table>
      </div>
    </section>
    <section class="av-panel" aria-labelledby="av-env-cm-h">
      <div class="av-panel-head"><h3 id="av-env-cm-h" class="av-h3">${esc(T.cmH)}</h3></div>
      <dl class="av-env-cm">
        <dt>${esc(T.cm.exercise)}</dt>
        <dd><span class="av-mono av-env-big">${d.exMin} ${esc(T.exUnit)}</span> <span class="av-sub">(${esc(T.exNote)})</span><br />${esc(t.cm.exercise)}</dd>
        <dt>${esc(T.cm.watch)}</dt>
        <dd><ul class="av-env-watch">${watch}</ul></dd>
        <dt>${esc(T.cm.dosimeter)}</dt><dd>${esc(t.cm.dosimeter)}</dd>
        <dt>${esc(T.cm.sleep)}</dt><dd>${esc(t.cm.sleep)}</dd>
        <dt>${esc(T.cm.autonomy)}</dt><dd>${esc(t.cm.autonomy)}</dd>
        <dt>${esc(T.cm.extra)}</dt><dd>${esc(t.cm.extra)}</dd>
      </dl>
    </section>`;
}

/* Peor estado entre regiones e indicadores asociados al sistema (null si no hay dato) */
function systemLetter(sysKey, regions, cards) {
  const letters = [];
  (SYS_REGIONS[sysKey] || []).forEach((code) => {
    const r = regions.find((x) => x.code === code);
    if (r && r.region_state) letters.push(LETTER[r.region_state] || "M");
  });
  (SYS_CARDS[sysKey] || []).forEach((code) => {
    const c = cards.find((x) => x.indicator_code === code);
    if (c && c.state) letters.push(LETTER[c.state] || "M");
  });
  if (!letters.length) return null;
  const real = letters.filter((l) => l !== "M" && l !== "S");
  if (!real.length) return letters.includes("S") ? "S" : "M";
  return real.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "N");
}

/* ───────────────────────── insights personalizados ───────────────────────── */

function buildInsights(appState, data, key) {
  const T = tr(DICT);
  const t = T.env[key];
  const d = ENV_DATA[key];
  const s = appState.healthSummary || data.summary || {};
  const cards = s.indicator_cards || [];
  const card = (code) => cards.find((c) => c.indicator_code === code) || null;
  const regions = data.regions || [];
  const alerts = (data.alerts || []).filter((a) => a.status !== "RESOLVED");
  const now = s.system_time_utc ? new Date(s.system_time_utc) : new Date();
  const remote = d.delayMaxS >= 60;
  const out = [];
  const push = (lvl, text, basis) => out.push({ lvl, text, basis });

  // 1. Sueño + retardo de comunicación
  const nights = (data.sleep || []).filter((p) => p.value !== null && p.value !== undefined && !p.is_gap_marker).slice(-3);
  const debt = nights.reduce((a, p) => a + Math.max(0, PROGRAMMED_SLEEP_H - Number(p.value)), 0);
  const sleepCard = card("SLEEP_DURATION");
  const sleepAlert = alerts.some((a) => a.indicator_code === "SLEEP_DURATION") ||
    (sleepCard && (sleepCard.state === "WARNING" || sleepCard.state === "CRITICAL")) || debt > 2;
  if (sleepAlert) {
    const extra = debt > 2 ? ` ${T.ins.sleepDebt(fmt(debt), nights.length)}` : "";
    push(remote ? "C" : "A", (remote ? T.ins.sleepAuto(t.delayPhrase) : T.ins.sleepNear(t.delayPhrase)) + extra, T.basisText.sleep);
  } else if (nights.length) {
    push("N", T.ins.sleepOk(nights.length, t.hz.light[0]), T.basisText.sleep);
  }

  // 2. Alertas activas sin reconocer + retardo
  const isUnacked = (a) => a.status === "NEW" ||
    (a.status === "ESCALATED" && !(a.acknowledgements || []).length && !(a.followups || []).length);
  const serious = alerts.filter((a) => isAlarm(alertClassOf(a.operational_state)) && isUnacked(a));
  if (serious.length) {
    push(remote ? "C" : "A", remote ? T.ins.alertsAuto(serious.length, t.delayPhrase) : T.ins.alertsNear(serious.length), T.basisText.alerts);
  }

  // 3. Ejercicio semanal frente al objetivo orientativo del entorno
  const byDay = {};
  (data.act || []).forEach((p) => {
    if (p.value === null || p.value === undefined || p.is_gap_marker) return;
    const at = new Date(p.measured_at);
    if (now - at > 7 * 86400000) return;
    byDay[at.toISOString().slice(0, 10)] = Number(p.value);
  });
  const days = Object.keys(byDay).length;
  const week = Math.round(Object.values(byDay).reduce((a, b) => a + b, 0));
  const target = d.exMin * 7;
  if (!days) push("M", T.ins.exNone, T.basisText.ex);
  else if (week < target * 0.75) push(d.microG ? "C" : "A", d.microG ? T.ins.exLow0g(week, target) : T.ins.exLowPartial(week, target, t.hz.grav[0]), T.basisText.ex);
  else push("N", T.ins.exOk(week, target), T.basisText.ex);

  // 4. Radiación
  const radCard = card("RADIATION_EXPOSURE");
  if (radCard && (radCard.state === "WARNING" || radCard.state === "CRITICAL")) {
    push(LETTER[radCard.state], T.ins.radState(STATE_WORD[LETTER[radCard.state]]), T.basisText.rad);
  } else if (d.hz.rad >= 2) {
    const pts = (data.rad || []).filter((p) => p.value !== null && p.value !== undefined && !p.is_gap_marker);
    const last = pts.length ? Number(pts[pts.length - 1].value) : null;
    if (last !== null && Number.isFinite(last)) push("A", T.ins.radHigh(t.hz.rad[0], fmt(last, 2), t.cm.dosimeter), T.basisText.rad);
  }

  // 5. CO₂ de cabina en entornos con ECLSS exigente
  const co2 = (s.environmental_telemetry || []).filter((e) => e.parameter_code === "CO2_LEVEL")
    .sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at))[0];
  const co2v = co2 ? Number(co2.value) : null;
  if (co2v !== null && Number.isFinite(co2v) && co2v >= 2.5 && d.hz.eclss >= 2) {
    push(co2v >= 2.8 ? "C" : "A", T.ins.co2(fmt(co2v), t.hz.eclss[0]), T.basisText.co2);
  }

  // 6. Sistemas con prioridad media/alta en el entorno y región fuera de rango
  SYS_KEYS.filter((k) => k !== "rad" && k !== "sleep" && d.sys[k] >= 2).forEach((k) => {
    const lt = systemLetter(k, regions, cards);
    if (lt && RANK[lt] >= 1 && lt !== "I") push(RANK[lt] >= 2 ? "C" : "A", T.ins.region(t.place, T.sys[k], T.level[d.sys[k]].toLowerCase(), STATE_WORD[lt]), T.basisText.region);
  });

  // 7. Datos sin actualizar con retardo alto
  const stale = cards.filter((c) => c.state === "STALE" || c.state === "UNKNOWN").length;
  if (stale && remote) push("A", T.ins.stale(stale, t.delayPhrase), T.basisText.stale);

  out.sort((a, b) => (RANK[b.lvl] ?? 0) - (RANK[a.lvl] ?? 0));
  return out;
}

function renderInsights(ctx) {
  const T = tr(DICT);
  const z = zone(ctx, "insights");
  if (!z) return;
  if (ctx.loading && !ui.data) {
    z.innerHTML = `<p class="av-sub av-env-pad">${esc(T.insightsLoading)}</p>`;
    return;
  }
  const key = viewEnv();
  const data = ui.data;
  const s = (ctx.appState && ctx.appState.healthSummary) || (data && data.summary) || {};
  const hasData = !!data && ((s.indicator_cards || []).length || (data.alerts || []).length || (data.regions || []).length ||
    (data.sleep || []).length || (data.act || []).length || (data.rad || []).length);
  const sctx = s.context || {};
  const srvName = bt(sctx.environment_name) || sctx.environment_code || "";
  const srvDelay = sctx.comms_delay_seconds !== undefined && sctx.comms_delay_seconds !== null ? `${fmt(sctx.comms_delay_seconds)} s` : "";
  const head = srvName ? `<p class="av-sub av-env-pad av-env-srv">${esc(T.serverCtx(srvName, srvDelay))}</p>` : "";

  if (!hasData) {
    z.innerHTML = `${head}<p class="av-sub av-env-pad">${esc(ctx.error ? T.insightsError : T.insightsNoData)}</p>`;
    return;
  }
  const items = buildInsights(ctx.appState, data, key);
  z.innerHTML = `${head}${items.length ? `<ul class="av-env-ins">${items.map((i) => `
    <li class="av-env-ins-${i.lvl}">
      <span class="av-env-ins-b">${badge(i.lvl, STATE_WORD[i.lvl])}<span class="av-env-sr">${esc(STATE_WORD[i.lvl])}: </span></span>
      <span class="av-env-ins-t">${esc(i.text)}<span class="av-env-basis">${esc(T.basis)}: ${esc(i.basis)}</span></span>
    </li>`).join("")}</ul>` : `<p class="av-sub av-env-pad">${esc(T.insightsNone)}</p>`}`;
}

/* ───────────────────────── comparativa ───────────────────────── */

function renderCompare(ctx) {
  const T = tr(DICT);
  const cur = currentEnv();
  const view = viewEnv();
  const colCls = (k) => `${k === cur ? " av-env-col-cur" : ""}${k === view ? " av-env-col-view" : ""}`;
  const head = ENV_KEYS.map((k) => `
    <th scope="col" class="av-env-colh${colCls(k)}">
      <button type="button" class="av-env-colbtn" data-env-pick="${k}" aria-pressed="${k === view}">
        <span class="av-mono av-env-code">${esc(envCode(k))}</span>
        <span>${esc(envLabel(k))}</span>
        ${k === cur ? `<span class="av-env-tag">${esc(T.currentTag)}</span>` : ""}
      </button>
    </th>`).join("");
  const rows = HZ_KEYS.map((h) => `
    <tr>
      <th scope="row">${esc(T.hz[h])}</th>
      ${ENV_KEYS.map((k) => `<td class="av-env-cell av-env-cell-${ENV_DATA[k].hz[h]}${colCls(k)}">
        <span class="av-mono">${esc(T.env[k].hz[h][0])}</span>${levelHTML(ENV_DATA[k].hz[h])}</td>`).join("")}
    </tr>`).join("");
  const exRow = `<tr><th scope="row">${esc(T.rowExercise)}</th>${ENV_KEYS.map((k) =>
    `<td class="av-env-cell${colCls(k)}"><span class="av-mono">${ENV_DATA[k].exMin} ${esc(T.exUnit)}</span></td>`).join("")}</tr>`;
  const topRow = `<tr><th scope="row">${esc(T.rowTop)}</th>${ENV_KEYS.map((k) => {
    const top = SYS_KEYS.filter((s) => ENV_DATA[k].sys[s] === 3).map((s) => T.sys[s]).join(" · ");
    return `<td class="av-env-cell${colCls(k)}">${esc(top || "—")}</td>`;
  }).join("")}</tr>`;
  zone(ctx, "compare").innerHTML = `
    <table class="av-table av-env-cmptable">
      <caption class="av-env-sr">${esc(T.compareCaption)}</caption>
      <thead><tr><th scope="col">${esc(T.rowHazard)}</th>${head}</tr></thead>
      <tbody>${rows}${exRow}${topRow}</tbody>
    </table>`;
}

/* ───────────────────────── interacción ───────────────────────── */

function announce(ctx, msg) {
  const live = ctx.root.querySelector("[data-env-live]");
  if (!live) return;
  live.textContent = "";
  setTimeout(() => {
    if (live.isConnected) live.textContent = msg;
  }, 30);
}

function setPreview(ctx, key, { focusSelector = false } = {}) {
  if (!ENV_KEYS.includes(key)) return;
  const cur = currentEnv();
  ui.preview = key === cur ? null : key;
  renderNow(ctx);
  renderSelector(ctx);
  renderMain(ctx);
  renderInsights(ctx);
  renderCompare(ctx);
  if (focusSelector) ctx.root.querySelector(`[data-env-zone="selector"] [data-env-pick="${key}"]`)?.focus();
  announce(ctx, tr(DICT).announcePreview(envLabel(key)));
}

function bind(ctx) {
  const { root } = ctx;
  root.addEventListener("click", (ev) => {
    const pick = ev.target.closest("[data-env-pick]");
    if (pick && root.contains(pick)) {
      const inSelector = !!pick.closest('[data-env-zone="selector"]');
      const k = pick.getAttribute("data-env-pick");
      setPreview(ctx, k, { focusSelector: inSelector });
      if (!inSelector) root.querySelector(`.av-env-colbtn[data-env-pick="${k}"]`)?.focus();
      return;
    }
    const act = ev.target.closest("[data-env-act]");
    if (act && act.getAttribute("data-env-act") === "reset") {
      setPreview(ctx, currentEnv(), { focusSelector: true });
    }
  });
  // Teclado del grupo de radio: flechas, Inicio y Fin mueven y seleccionan
  root.addEventListener("keydown", (ev) => {
    const opt = ev.target.closest('[data-env-zone="selector"] [data-env-pick]');
    if (!opt) return;
    const i = ENV_KEYS.indexOf(opt.getAttribute("data-env-pick"));
    let n = null;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") n = (i + 1) % ENV_KEYS.length;
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") n = (i - 1 + ENV_KEYS.length) % ENV_KEYS.length;
    else if (ev.key === "Home") n = 0;
    else if (ev.key === "End") n = ENV_KEYS.length - 1;
    if (n === null) return;
    ev.preventDefault();
    setPreview(ctx, ENV_KEYS[n], { focusSelector: true });
  });
}
