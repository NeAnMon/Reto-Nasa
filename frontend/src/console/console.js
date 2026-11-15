/*
 * SEMSA · Consola de salud de tripulación
 *
 * Secciones "mission-control" (resumen / detalle de indicador) y "radiation", con:
 *  - encabezado global (#av-chrome, visible en todas las secciones): barra HERA,
 *    barra de estado (GMT/MET DDD/HH:MM:SS, enlace, contadores C&W, sensores) y
 *    barra de alarma con reconocimiento (ACK) → initChrome / renderChrome
 *  - caché de datos compartida (refreshConsoleData) para no pedir dos veces lo mismo
 *  - prioridad 1: radiación, CO₂ de cabina, SpO₂, ejercicio semanal, sueño
 *  - tabla de signos con límites amarillo/rojo, tendencia, hora y fuente
 *  - mapa corporal (cabeza, músculos, huesos, piel) y lista de sistemas
 *  - alertas C&W, tareas de hoy, médico de vuelo
 *    (el seguimiento periódico NASA IMM vive en la Bitácora: views/logbook-followup.js)
 *  - detalle de indicador con procedimiento guiado
 *  - módulo de radiación: HERA (simulado), dosímetro personal (CAD/CPD) manual,
 *    4 riesgos (carcinogénesis, tejidos, SNC, SAR) y procedimiento de refugio
 *  - barra superior global con la alarma de radiación de HERA
 */
import { apiService } from "../services/api.js";
import { FIG, FIG_VIEWBOX, FIG_ATTRIBUTION_I18N, BONES, FIG_HOTSPOTS } from "./body-figure.js";
import { tr, fmt, fmtNum, getLang, onLangChange } from "../i18n/i18n.js";
import { bt, btLines } from "/src/i18n/backend.js";
import { LETTER, RANK, STATE_WORD, STATE_LEGEND, CLASS_PLURAL, HERA_LETTER, alertClassOf, isAlarm, classFromRank } from "./alert-classes.js";

/* ───────────────────────── idioma ─────────────────────────
 * Textos de la consola en DICT ({ es, en }); cada render obtiene el idioma actual con tr(DICT).
 * Las tablas que también usan otros módulos (STATE_WORD, HERA_TEXT, SYS_NAMES) son objetos
 * "por idioma" (byLang) que resuelven el idioma en cada acceso. */
function byLang(dict) {
  const cur = () => dict[getLang()] || dict.es;
  return new Proxy({}, {
    get: (_, k) => (k in cur() ? cur()[k] : dict.es[k]),
    has: (_, k) => k in dict.es,
    ownKeys: () => Reflect.ownKeys(dict.es),
    getOwnPropertyDescriptor: (_, k) => (k in dict.es ? { enumerable: true, configurable: true, writable: false, value: k in cur() ? cur()[k] : dict.es[k] } : undefined),
  });
}
/* Añade a obj getters (campos de texts.es[id]) que devuelven el texto del idioma actual */
function withText(obj, texts, id) {
  Object.keys(texts.es[id] || {}).forEach((f) => {
    Object.defineProperty(obj, f, {
      enumerable: true,
      configurable: true,
      get() {
        const cur = (texts[getLang()] || {})[id];
        return cur && cur[f] !== undefined ? cur[f] : texts.es[id][f];
      },
    });
  });
  return obj;
}

const DICT = {
  es: {
    heraAria: "Alarma de radiación HERA",
    heraEnvTitle: "Línea base simulada para {label}: {note} (≈{dose} mGy/día)",
    heraBase: "base",
    heraSensors: "{n} sensores · act.",
    heraSpe: "SIMULACIÓN DE EVENTO SOLAR (×30)",
    simData: "datos SIMULADOS",
    realData: "datos REALES (HERA Artemis I, reproducción)",
    realBarSource: "HERA real · Artemis I",
    realSource: "Fuente: sensores HERA HSU1/HSU2 dentro de Orion en Artemis I (nov–dic 2022, espacio profundo y órbita lunar; George et al. 2024, Nature, CC BY 4.0). NASA no publica HERA en vivo: se reproduce la misión real en bucle, día {day} de {days}. El entorno elegido solo escala el evento solar simulado",
    ack: "Reconocer",
    radiation: "Radiación",
    loadingConsole: "Cargando consola…",
    loadFailed: "No se pudieron cargar los datos: {msg}",
    toastLocalAck: "Alerta a bordo reconocida.",
    ackNote: "Reconocida desde la consola de salud",
    toastAck: "Alerta reconocida.",
    envLocalOnly: "Entorno: {label}. Aplicado solo en este dispositivo (sin sincronizar).",
    envUpdated: "Entorno actualizado: {label} (simulado). Los límites clínicos no cambian.",
    envPostFailed: "Entorno: {label}. No se pudo registrar en el servidor ({msg}); aplicado solo en este dispositivo.",
    actionFailed: "No se pudo completar la acción: {msg}",
    // barra de estado
    statusAria: "Barra de estado de la misión",
    crewMember: "Tripulante",
    groundLink: "Enlace con Tierra",
    envBannerAlt: "Entorno {label}: {scene}",
    delay: "· retardo",
    countsAria: "Contadores de alertas",
    unacked: "Sin reconocer",
    // celda entorno
    envLabel: "Entorno",
    syncSending: "enviando…",
    syncSendingHelp: "Registrando el cambio en el servidor",
    syncOk: "sinc.",
    syncOkHelp: "Registrado en el servidor: {name}",
    syncLocal: "local",
    syncLocalHelpCtx: "Solo en este dispositivo; el servidor indica: {name}",
    syncLocalHelp: "Solo en este dispositivo (sin contexto del servidor)",
    envHelp: "{label} · {loc}{prof}. Entorno SIMULADO: cambia la línea base de HERA; los límites clínicos no cambian. {sync}.",
    envSrHelp: "Simulado. {sync}.",
    // barra de alarma
    alarmQuiet: "Sin alertas por reconocer.",
    inAlarm: "En alarma:",
    viewProcedure: "Ver procedimiento",
    ackFull: "Reconocer (ACK)",
    // alertas a bordo
    co2Alert: "CO₂ de cabina sobre límite",
    co2Limits: "Y 2,8 / R 3,0",
    sleepDebtAlert: "Deuda de sueño",
    sleepDebtDetail: "{h} h en 3 noches · Y > 2 h (regla demo)",
    heraAlert: "Radiación HERA: {lvl}",
    // tarjeta de radiación
    careerOf: "/ 600 mSv carrera",
    careerAria: "Dosis efectiva acumulada {pct} % del límite de carrera",
    missionDose: "Misión",
    dailyRate: "tasa diaria",
    noCareerHistory: "Sin historial previo de carrera registrado",
    open: "Abrir",
    // Prioridad 1
    p1Aria: "Prioridad 1",
    p1Label: "Prioridad 1 · siempre visible",
    co2Title: "CO₂ en cabina",
    limits: "Límites",
    co2Avg: "(media 1 h, NASA)",
    co2Act: "Revisa la ventilación y el depurador de CO₂; avisa si hay cefalea.",
    co2Ok: "Ventilación nominal.",
    habitat: "Hábitat",
    noHabitatData: "Sin datos del hábitat",
    atmosphere: "Atmósfera",
    noMeasurement: "Sin medición",
    exerciseTitle: "Ejercicio · 7 días",
    weeklyGoalAria: "{pct} % de la meta semanal",
    today: "Hoy",
    issGoal: "meta de referencia ISS",
    exerciseFoot: "Contramedida contra pérdida de músculo y hueso",
    sleepTitle: "Sueño",
    programmedH: "h programadas",
    debt3: "Deuda 3 noches",
    limitWord: "límite",
    demo: "(demo)",
    sleepAdvice: "Con sueño acumulado, evita tareas críticas y avisa al médico de vuelo.",
    openWellbeing: "Check-in de sueño y ánimo",
    noRecord: "Sin registro",
    // tabla de signos
    tableTitle: "Signos y registros",
    clearFilterAria: "Quitar filtro: {name}",
    filter: "Filtro: {name}",
    tableAria: "Tabla de signos, desplazable en horizontal",
    thParam: "Parámetro", thValue: "Valor", thUnit: "Unid.", thState: "Est.", thLimY: "Lím. Y", thLimR: "Lím. R",
    noIndicatorsFilter: "Sin indicadores para este filtro.",
    allNominal: "Todos los parámetros nominales",
    nominalShow: "Mostrar {n} parámetros nominales",
    nominalShowOne: "Mostrar 1 parámetro nominal",
    nominalHide: "Ocultar {n} parámetros nominales",
    nominalHideOne: "Ocultar 1 parámetro nominal",
    // mapa corporal
    agoMin: "hace {n} min",
    agoH: "hace {n} h",
    agoD: "hace {n} d",
    popEmpty: "Pasa el cursor o pulsa una zona del cuerpo para ver sus lecturas aquí.",
    popAria: "Lecturas de la región",
    noData: "Sin datos",
    sensorOffline: "Sensor fuera de línea · ",
    seeDetail: "ver detalle ›",
    week7: "Ejercicio · últimos 7 días",
    week7Meta: "suma de registros diarios · meta de referencia ISS",
    week7None: "sin registros de actividad en 7 días",
    alertOne: "alerta activa",
    alertMany: "alertas activas",
    inRegion: "en esta región",
    popSource: "Fuente: {src} · Calidad: {q}",
    noDataLower: "sin datos",
    tableFiltered: "Tabla de signos filtrada por esta región",
    close: "Cerrar",
    popHint: "Pulsa la zona para fijar la ficha y filtrar la tabla · Esc cierra",
    sysAria: "Estado por sistema",
    sysTitle: "Estado por sistema",
    noColorNominal: "Sin color = nominal",
    layersAria: "Capas del modelo corporal",
    muscles: "Músculos",
    bones: "Huesos",
    bodyHint: "Pasa el cursor o el foco por una zona para ver sus lecturas; púlsala para fijar la ficha y filtrar la tabla.",
    sideL: "Lecturas por zona, columna izquierda",
    sideR: "Lecturas por zona, columna derecha",
    figCredits: "En la figura: cabeza, tórax, abdomen, brazo, piel y huesos; el resto de sistemas, en “Otros sistemas”. Solo capa ósea simplificada: no se dibujan órganos.",
    // columna derecha
    rightAria: "Alertas y actividades",
    cwTitle: "Alertas C&amp;W",
    hideAdv: "Ocultar vigilancia (A)",
    showAdv: "Mostrar vigilancia (A): {n}",
    thClass: "Cl.", thMsg: "Mensaje",
    onboard: "a bordo",
    noActiveAlerts: "Sin alertas activas.",
    tasksTitle: "Tareas de hoy",
    seeAll: "Ver todas",
    noTasks: "Sin tareas.",
    taskStatus: { PENDING: "Pendiente", COMPLETED: "Hecha", EXCUSED_OPERATIONAL_RESTRICTION: "Omitida por operación (no penaliza)", PAUSED_FOR_SAFETY: "Pausada por seguridad" },
    surgeonTitle: "Médico de vuelo",
    unreadMsgs: "Mensajes sin leer",
    unreadPill: "{n} sin leer",
    otherSystems: "Otros sistemas",
    groundLead: "Líder en Tierra",
    openSupport: "Solicitudes de apoyo abiertas",
    offlineNote: "Sin enlace, todo se guarda a bordo y se envía en el próximo contacto.",
    openMessages: "Abrir mensajes",
    // detalle de indicador
    backSummary: "← Resumen",
    idealRange: "Rango ideal",
    yellowLimit: "Límite amarillo",
    redLimit: "Límite rojo",
    lastData: "Último dato",
    sourceQuality: "Fuente · calidad",
    trendAria: "Tendencia",
    trendTitle: "Tendencia",
    trendSub: "Historial completo de la misión",
    loadingHistory: "Cargando historial…",
    explainAria: "Explicación",
    explainTitle: "Qué significa",
    loading: "Cargando…",
    procAria: "Procedimiento guiado",
    procedure: "Procedimiento",
    outOfLimit: "Indicador fuera de límite",
    indicatorCheck: "Control del indicador",
    alert: "Alerta",
    cause: "Causa",
    step: "Paso {n}",
    stepCurrent: "Paso actual",
    stepDone: "Hecho",
    stepTodo: "Pendiente",
    step1: "Verifica cómo se tomó la medición",
    measurementOk: "La medición es correcta",
    step2Hyd: "Bebe y registra el total de hoy",
    step2: "Registra una nueva medición",
    hydNote: "Se registra el total del día (actual {v} mL + lo que bebas).",
    systolic: "Sistólica",
    value: "Valor",
    diastolic: "Diastólica (mmHg)",
    register: "Registrar",
    step3: "Aplica la acción recomendada",
    loadingRec: "Cargando recomendación…",
    done: "Hecho",
    step4: "Seguimiento",
    followupDefault: "Vuelve a medir en el siguiente control programado.",
    ackAlert: "Reconocer alerta",
    closeProc: "Cerrar procedimiento",
    procCompleted: "Procedimiento completado.",
    procSynced: "Quedó registrado y se sincroniza con Tierra en el próximo contacto.",
    escalateIf: "Escalar de inmediato si",
    escalateDefault: "Los síntomas empeoran, aparecen síntomas nuevos o el valor sigue fuera de límite tras la acción.",
    escalate: "Escalar al médico de vuelo",
    contactSurgeon: "Contactar al médico de vuelo",
    historyFailed: "No se pudo cargar el historial.",
    followProtocol: "Sigue el protocolo del indicador.",
    noExplanation: "Sin explicación disponible.",
    notEnoughTrend: "No hay suficientes datos para una tendencia.",
    trendSvgAria: "{name}: {n} mediciones, última {v} {unit}",
    baseline: "línea base",
    // radiación
    meterAria: "{title}: {pct} % del límite",
    heraChartAria: "Tasa de dosis HERA, últimas {n} muestras, escala logarítmica",
    thCaution: "Precaución 17",
    thShelter: "Refugio 75",
    thEmergency: "Emergencia 500",
    heraHead: "HERA · dosimetría activa del vehículo · {n} sensores · cadencia 1 min",
    noaaHead: "Flujo de protones GOES (NOAA, datos reales vía SEMSA) · satélite {sat} · ≥10 MeV {flux} pfu · nivel {s}",
    noaaChartAria: "Flujo de protones GOES ≥10 MeV y ≥100 MeV, últimas 6 h, escala logarítmica",
    noaaLegend10: "≥10 MeV",
    noaaLegend100: "≥100 MeV",
    noaaLoading: "Cargando flujo de protones NOAA desde SEMSA…",
    heraChartSpe: "Evento solar SIMULADO sobre la tasa de dosis HERA (µGy/min) · al terminar vuelve el flujo NOAA",
    noaaOffline: "Sin conexión con SEMSA ({err}): se muestra la tasa de dosis HERA SIMULADA.",
    noaaNote: "Flujo de partículas (pfu), no dosis: las líneas S1–S5 son la escala NOAA de tormentas de radiación solar. Se actualiza cada 5 min.",
    upd: "act.",
    speRunning: "simulación de evento solar en curso (×30)",
    envWord: "Entorno",
    baselineWord: "línea base",
    perDay: "mGy/día",
    speFactor: "evento solar ×",
    simulated: "SIMULADO",
    speStop: "Terminar simulación",
    speStart: "Simular evento solar (demo)",
    thresholdsNote: "Umbrales sobre el sensor con mayor tasa y con persistencia: precaución ≥ 17 µGy/min (≈1 mGy/h) 5 min · refugio ≥ 75 µGy/min 5 min · emergencia ≥ 500 µGy/min o dosis del evento ≥ 250 mGy-Eq. Los valores reales de Orion no son públicos; los de la consola son de diseño y deben validarse con el equipo de radiación (SRAG).",
    shelterAria: "Procedimiento de refugio",
    procedureDemo: "Procedimiento · RAD-SPE-01 · DEMO",
    shelterTitle: "Evento de partículas solares: refugio",
    shelter1: "<strong>1. Prepara.</strong> Avisa a la tripulación y al médico de vuelo, pospón o aborta la EVA y localiza la estiba del refugio.",
    shelter2: "<strong>2. Construye el refugio</strong> con la estiba contra la pared menos blindada (objetivo &lt; 1 h). Ponte el chaleco de protección si hay uno disponible.",
    shelter3: "<strong>3. Entra y quédate</strong> en la zona más blindada hasta el aviso de fin de evento (≤ 24 h). Cubre torso y cabeza.",
    shelter4: "<strong>4. Lee tu dosímetro cada 15 min</strong> y regístralo abajo. Comunica náuseas, vómitos o fatiga inusual.",
    risksAria: "Riesgos por radiación",
    risksLabel: "Riesgos · dosis frente a límites NASA-STD-3001 Vol. 1 Rev C",
    mCarcTitle: "Carcinogénesis",
    mCarcNote: "Dosis efectiva acumulada frente al límite de carrera (600 mSv, igual para cualquier edad y sexo).",
    mTissueTitle: "Tejidos (degenerativos)",
    mTissueNote: "Órganos hematopoyéticos y sistema circulatorio, límite de 30 días. Incluye cataratas y efectos cardiovasculares.",
    mCnsTitle: "Sistema nervioso central",
    mCnsNote: "Dosis absorbida en 30 días frente al límite del hipocampo (500 mGy).",
    mArsTitle: "Síndrome agudo (SAR)",
    mArsNote: "Dosis del evento en curso. Pródromos (náusea, fatiga) desde ~500 mGy.",
    risksNote: "Estimaciones de la consola: dosis de misión integrada desde la tasa diaria registrada (mSv/día); dosis del evento desde HERA con RBE 1,5 para protones; SNC con Q ≈ 2,6 (HERA, Artemis I). No sustituyen la dosimetría oficial.",
    dosimeterAria: "Dosímetro personal",
    dosimeterTitle: "Dosímetro personal",
    manualEntry: "entrada manual",
    device: "Dispositivo",
    readingUtc: "Lectura (UTC)",
    accDose: "Dosis acumulada (mGy)",
    recentRate: "Tasa reciente (µGy/h)",
    location: "Ubicación",
    notes: "Notas",
    saveReading: "Guardar lectura",
    cadNote: "CAD = dosímetro activo de tripulación (muestra dosis total y tasa). El CPD pasivo solo se lee al volver a Tierra. Las lecturas se guardan en este dispositivo hasta que el backend tenga su propio registro.",
    lastReading: "Última lectura",
    over24: "Más de 24 h sin lectura",
    over24Note: " · más de 24 h: registra una nueva",
    differs: "Difiere {pct} % de HERA. Verifica la colocación del dosímetro.",
    noReadings: "Sin lecturas registradas.",
    place: "Lugar",
    limitsAria: "Límites",
    limitsTitle: "Límites de referencia",
    organ: "Órgano",
    year1: "1 año",
    career: "Carrera",
    lens: "Cristalino (mGy-Eq)",
    skin: "Piel (mGy-Eq)",
    bfo: "Hematopoyéticos (mGy-Eq)",
    circulatory: "Circulatorio (mGy-Eq)",
    cns: "SNC (mGy)",
    effective: "Dosis efectiva (mSv)",
    limitsSource: "NASA-STD-3001 Vol. 1 Rev C, tabla 4.8-1.",
    cadLoc: { "Hábitat": "Hábitat", "Refugio": "Refugio", "Rover": "Rover", "EVA": "EVA", "Cabina de la nave": "Cabina de la nave" },
    // eventos
    escalateNote: "Escalada por la tripulación desde el procedimiento guiado",
    toastEscalated: "Alerta escalada al médico de vuelo.",
    hydNoteApi: "+{ml} mL registrados desde el procedimiento guiado",
    measureNoteApi: "Registrado desde el procedimiento guiado",
    badDose: "dosis no válida",
    saveLocalFailed: "no se pudo guardar en este dispositivo",
    toastCadSaved: "Lectura del dosímetro guardada.",
    saveFailed: "No se pudo guardar: {msg}",
    queuedOffline: "Sin enlace: medición en cola ({n}). Se enviará al reconectar.",
    registered: "Registrado:",
    toastMeasured: "Medición registrada.",
  },
  en: {
    heraAria: "HERA radiation alarm",
    heraEnvTitle: "Simulated baseline for {label}: {note} (≈{dose} mGy/day)",
    heraBase: "base",
    heraSensors: "{n} sensors · upd.",
    heraSpe: "SOLAR PARTICLE EVENT SIMULATION (×30)",
    simData: "SIMULATED data",
    realData: "REAL data (HERA Artemis I, replay)",
    realBarSource: "real HERA · Artemis I",
    realSource: "Source: HERA HSU1/HSU2 sensors inside Orion on Artemis I (Nov–Dec 2022, deep space and lunar orbit; George et al. 2024, Nature, CC BY 4.0). NASA does not publish live HERA data: the real mission is replayed in a loop, day {day} of {days}. The selected environment only scales the simulated solar event",
    ack: "Acknowledge",
    radiation: "Radiation",
    loadingConsole: "Loading console…",
    loadFailed: "Could not load data: {msg}",
    toastLocalAck: "Onboard alert acknowledged.",
    ackNote: "Acknowledged from the health console",
    toastAck: "Alert acknowledged.",
    envLocalOnly: "Environment: {label}. Applied on this device only (not synced).",
    envUpdated: "Environment updated: {label} (simulated). Clinical limits do not change.",
    envPostFailed: "Environment: {label}. Could not be recorded on the server ({msg}); applied on this device only.",
    actionFailed: "Could not complete the action: {msg}",
    statusAria: "Mission status bar",
    crewMember: "Crew member",
    groundLink: "Ground link",
    envBannerAlt: "{label} environment: {scene}",
    delay: "· delay",
    countsAria: "Alert counters",
    unacked: "Unacknowledged",
    envLabel: "Environment",
    syncSending: "sending…",
    syncSendingHelp: "Recording the change on the server",
    syncOk: "synced",
    syncOkHelp: "Recorded on the server: {name}",
    syncLocal: "local",
    syncLocalHelpCtx: "On this device only; the server reports: {name}",
    syncLocalHelp: "On this device only (no server context)",
    envHelp: "{label} · {loc}{prof}. SIMULATED environment: changes the HERA baseline; clinical limits do not change. {sync}.",
    envSrHelp: "Simulated. {sync}.",
    alarmQuiet: "No alerts to acknowledge.",
    inAlarm: "In alarm:",
    viewProcedure: "View procedure",
    ackFull: "Acknowledge (ACK)",
    co2Alert: "Cabin CO₂ above limit",
    co2Limits: "Y 2.8 / R 3.0",
    sleepDebtAlert: "Sleep debt",
    sleepDebtDetail: "{h} h over 3 nights · Y > 2 h (demo rule)",
    heraAlert: "HERA radiation: {lvl}",
    careerOf: "/ 600 mSv career",
    careerAria: "Accumulated effective dose {pct} % of the career limit",
    missionDose: "Mission",
    dailyRate: "daily rate",
    noCareerHistory: "No prior career history recorded",
    open: "Open",
    p1Aria: "Priority 1",
    p1Label: "Priority 1 · always visible",
    co2Title: "Cabin CO₂",
    limits: "Limits",
    co2Avg: "(1-h average, NASA)",
    co2Act: "Check ventilation and the CO₂ scrubber; report any headache.",
    co2Ok: "Ventilation nominal.",
    habitat: "Habitat",
    noHabitatData: "No habitat data",
    atmosphere: "Atmosphere",
    noMeasurement: "No measurement",
    exerciseTitle: "Exercise · 7 days",
    weeklyGoalAria: "{pct} % of the weekly goal",
    today: "Today",
    issGoal: "ISS reference goal",
    exerciseFoot: "Countermeasure against muscle and bone loss",
    sleepTitle: "Sleep",
    programmedH: "h scheduled",
    debt3: "3-night debt",
    limitWord: "limit",
    demo: "(demo)",
    sleepAdvice: "With accumulated sleep debt, avoid critical tasks and notify the flight surgeon.",
    openWellbeing: "Sleep and mood check-in",
    noRecord: "No record",
    tableTitle: "Vitals and records",
    clearFilterAria: "Clear filter: {name}",
    filter: "Filter: {name}",
    tableAria: "Vitals table, scrolls horizontally",
    thParam: "Parameter", thValue: "Value", thUnit: "Unit", thState: "St.", thLimY: "Lim. Y", thLimR: "Lim. R",
    noIndicatorsFilter: "No indicators for this filter.",
    allNominal: "All parameters nominal",
    nominalShow: "Show {n} nominal parameters",
    nominalShowOne: "Show 1 nominal parameter",
    nominalHide: "Hide {n} nominal parameters",
    nominalHideOne: "Hide 1 nominal parameter",
    agoMin: "{n} min ago",
    agoH: "{n} h ago",
    agoD: "{n} d ago",
    popEmpty: "Hover over or tap a body zone to see its readings here.",
    popAria: "Region readings",
    noData: "No data",
    sensorOffline: "Sensor offline · ",
    seeDetail: "view detail ›",
    week7: "Exercise · last 7 days",
    week7Meta: "sum of daily records · ISS reference goal",
    week7None: "no activity records in 7 days",
    alertOne: "active alert",
    alertMany: "active alerts",
    inRegion: "in this region",
    popSource: "Source: {src} · Quality: {q}",
    noDataLower: "no data",
    tableFiltered: "Vitals table filtered by this region",
    close: "Close",
    popHint: "Tap the zone to pin this card and filter the table · Esc closes",
    sysAria: "Status by system",
    sysTitle: "Status by system",
    noColorNominal: "No color = nominal",
    layersAria: "Body model layers",
    muscles: "Muscles",
    bones: "Bones",
    bodyHint: "Hover or focus a zone to see its readings; select it to pin the card and filter the table.",
    sideL: "Readings by zone, left column",
    sideR: "Readings by zone, right column",
    figCredits: "On the figure: head, chest, abdomen, arm, skin and bones; other systems are under “Other systems”. Simplified skeletal layer only: no organs are drawn.",
    rightAria: "Alerts and activities",
    cwTitle: "C&amp;W alerts",
    hideAdv: "Hide advisories (A)",
    showAdv: "Show advisories (A): {n}",
    thClass: "Cl.", thMsg: "Message",
    onboard: "onboard",
    noActiveAlerts: "No active alerts.",
    tasksTitle: "Today's tasks",
    seeAll: "View all",
    noTasks: "No tasks.",
    taskStatus: { PENDING: "Pending", COMPLETED: "Done", EXCUSED_OPERATIONAL_RESTRICTION: "Skipped for operations (no penalty)", PAUSED_FOR_SAFETY: "Paused for safety" },
    surgeonTitle: "Flight surgeon",
    unreadMsgs: "Unread messages",
    unreadPill: "{n} unread",
    otherSystems: "Other systems",
    groundLead: "Ground lead",
    openSupport: "Open support requests",
    offlineNote: "Without a link, everything is stored onboard and sent at the next contact.",
    openMessages: "Open messages",
    backSummary: "← Overview",
    idealRange: "Ideal range",
    yellowLimit: "Yellow limit",
    redLimit: "Red limit",
    lastData: "Last reading",
    sourceQuality: "Source · quality",
    trendAria: "Trend",
    trendTitle: "Trend",
    trendSub: "Full mission history",
    loadingHistory: "Loading history…",
    explainAria: "Explanation",
    explainTitle: "What it means",
    loading: "Loading…",
    procAria: "Guided procedure",
    procedure: "Procedure",
    outOfLimit: "Indicator out of limits",
    indicatorCheck: "Indicator check",
    alert: "Alert",
    cause: "Cause",
    step: "Step {n}",
    stepCurrent: "Current step",
    stepDone: "Done",
    stepTodo: "Pending",
    step1: "Verify how the measurement was taken",
    measurementOk: "The measurement is correct",
    step2Hyd: "Drink and log today's total",
    step2: "Log a new measurement",
    hydNote: "The daily total is logged (current {v} mL + what you drink).",
    systolic: "Systolic",
    value: "Value",
    diastolic: "Diastolic (mmHg)",
    register: "Log",
    step3: "Apply the recommended action",
    loadingRec: "Loading recommendation…",
    done: "Done",
    step4: "Follow-up",
    followupDefault: "Measure again at the next scheduled check.",
    ackAlert: "Acknowledge alert",
    closeProc: "Close procedure",
    procCompleted: "Procedure completed.",
    procSynced: "It has been logged and will sync with Ground at the next contact.",
    escalateIf: "Escalate immediately if",
    escalateDefault: "Symptoms worsen, new symptoms appear or the value stays out of limits after the action.",
    escalate: "Escalate to flight surgeon",
    contactSurgeon: "Contact flight surgeon",
    historyFailed: "Could not load the history.",
    followProtocol: "Follow the indicator protocol.",
    noExplanation: "No explanation available.",
    notEnoughTrend: "Not enough data for a trend.",
    trendSvgAria: "{name}: {n} measurements, latest {v} {unit}",
    baseline: "baseline",
    meterAria: "{title}: {pct} % of limit",
    heraChartAria: "HERA dose rate, last {n} samples, logarithmic scale",
    thCaution: "Caution 17",
    thShelter: "Shelter 75",
    thEmergency: "Emergency 500",
    heraHead: "HERA · vehicle active dosimetry · {n} sensors · 1-min cadence",
    noaaHead: "GOES proton flux (NOAA, real data via SEMSA) · satellite {sat} · ≥10 MeV {flux} pfu · level {s}",
    noaaChartAria: "GOES proton flux ≥10 MeV and ≥100 MeV, last 6 h, logarithmic scale",
    noaaLegend10: "≥10 MeV",
    noaaLegend100: "≥100 MeV",
    noaaLoading: "Loading NOAA proton flux from SEMSA…",
    heraChartSpe: "SIMULATED solar event on the HERA dose rate (µGy/min) · NOAA flux returns when it ends",
    noaaOffline: "No connection to SEMSA ({err}): showing the SIMULATED HERA dose rate.",
    noaaNote: "Particle flux (pfu), not dose: the S1–S5 lines are the NOAA solar radiation storm scale. Refreshes every 5 min.",
    upd: "upd.",
    speRunning: "solar particle event simulation running (×30)",
    envWord: "Environment",
    baselineWord: "baseline",
    perDay: "mGy/day",
    speFactor: "solar event ×",
    simulated: "SIMULATED",
    speStop: "End simulation",
    speStart: "Simulate solar event (demo)",
    thresholdsNote: "Thresholds on the highest-rate sensor, with persistence: caution ≥ 17 µGy/min (≈1 mGy/h) 5 min · shelter ≥ 75 µGy/min 5 min · emergency ≥ 500 µGy/min or event dose ≥ 250 mGy-Eq. Actual Orion values are not public; the console values are design values and must be validated with the radiation team (SRAG).",
    shelterAria: "Shelter procedure",
    procedureDemo: "Procedure · RAD-SPE-01 · DEMO",
    shelterTitle: "Solar particle event: shelter",
    shelter1: "<strong>1. Prepare.</strong> Notify the crew and the flight surgeon, postpone or abort the EVA and locate the shelter stowage.",
    shelter2: "<strong>2. Build the shelter</strong> with stowage against the least shielded wall (target &lt; 1 h). Put on the protective vest if one is available.",
    shelter3: "<strong>3. Get in and stay</strong> in the most shielded area until the end-of-event all-clear (≤ 24 h). Cover torso and head.",
    shelter4: "<strong>4. Read your dosimeter every 15 min</strong> and log it below. Report nausea, vomiting or unusual fatigue.",
    risksAria: "Radiation risks",
    risksLabel: "Risks · dose vs. NASA-STD-3001 Vol. 1 Rev C limits",
    mCarcTitle: "Carcinogenesis",
    mCarcNote: "Accumulated effective dose vs. the career limit (600 mSv, same for any age and sex).",
    mTissueTitle: "Tissue (degenerative)",
    mTissueNote: "Blood-forming organs and circulatory system, 30-day limit. Includes cataracts and cardiovascular effects.",
    mCnsTitle: "Central nervous system",
    mCnsNote: "30-day absorbed dose vs. the hippocampus limit (500 mGy).",
    mArsTitle: "Acute radiation syndrome (ARS)",
    mArsNote: "Dose of the ongoing event. Prodromal symptoms (nausea, fatigue) from ~500 mGy.",
    risksNote: "Console estimates: mission dose integrated from the logged daily rate (mSv/day); event dose from HERA with RBE 1.5 for protons; CNS with Q ≈ 2.6 (HERA, Artemis I). They do not replace official dosimetry.",
    dosimeterAria: "Personal dosimeter",
    dosimeterTitle: "Personal dosimeter",
    manualEntry: "manual entry",
    device: "Device",
    readingUtc: "Reading (UTC)",
    accDose: "Accumulated dose (mGy)",
    recentRate: "Recent rate (µGy/h)",
    location: "Location",
    notes: "Notes",
    saveReading: "Save reading",
    cadNote: "CAD = crew active dosimeter (shows total dose and rate). The passive CPD is read only after return to Earth. Readings are stored on this device until the backend has its own log.",
    lastReading: "Last reading",
    over24: "More than 24 h without a reading",
    over24Note: " · over 24 h: log a new one",
    differs: "Differs {pct} % from HERA. Check the dosimeter placement.",
    noReadings: "No readings logged.",
    place: "Location",
    limitsAria: "Limits",
    limitsTitle: "Reference limits",
    organ: "Organ",
    year1: "1 year",
    career: "Career",
    lens: "Lens (mGy-Eq)",
    skin: "Skin (mGy-Eq)",
    bfo: "Blood-forming organs (mGy-Eq)",
    circulatory: "Circulatory (mGy-Eq)",
    cns: "CNS (mGy)",
    effective: "Effective dose (mSv)",
    limitsSource: "NASA-STD-3001 Vol. 1 Rev C, table 4.8-1.",
    cadLoc: { "Hábitat": "Habitat", "Refugio": "Shelter", "Rover": "Rover", "EVA": "EVA", "Cabina de la nave": "Spacecraft cabin" },
    escalateNote: "Escalated by the crew from the guided procedure",
    toastEscalated: "Alert escalated to the flight surgeon.",
    hydNoteApi: "+{ml} mL logged from the guided procedure",
    measureNoteApi: "Logged from the guided procedure",
    badDose: "invalid dose",
    saveLocalFailed: "could not be saved on this device",
    toastCadSaved: "Dosimeter reading saved.",
    saveFailed: "Could not save: {msg}",
    queuedOffline: "No link: measurement queued ({n}). It will be sent on reconnection.",
    registered: "Logged:",
    toastMeasured: "Measurement logged.",
  },
};
const tt = () => tr(DICT);

/* ───────────────────────── utilidades ───────────────────────── */

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const esc = escapeHtml;

function num(v, dec = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  // en inglés, formato del idioma (1,234.5); en español se conserva "1 234,5"
  if (getLang() !== "es") return fmtNum(v, dec);
  const fixed = Number(v).toFixed(dec);
  const [int, frac] = fixed.split(".");
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac ? `${withSep},${frac}` : withSep;
}
const pad = (n, w = 2) => String(Math.floor(Math.abs(n))).padStart(w, "0");

function dayOfYear(d) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}
function gmt(d, withSeconds = true) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "—";
  const base = `${pad(dayOfYear(d), 3)}/${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getUTCSeconds())}` : base;
}
function met(elapsedDays) {
  if (elapsedDays === null || elapsedDays === undefined) return "—";
  const totalSec = Math.max(0, Math.round(elapsedDays * 86400));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(d, 3)}/${pad(h)}:${pad(m)}:${pad(s)}`;
}
const toDate = (iso) => (iso ? new Date(iso) : null);

/* Valor principal de una tarjeta con coma decimal (la presión arterial conserva "sist/diast") */
function cardValue(c) {
  if (!c) return "—";
  if (c.indicator_code === "BLOOD_PRESSURE" || c.latest_value === null || c.latest_value === undefined) return bt(c.display_value) || "—";
  const v = Number(c.latest_value);
  return num(v, Number.isInteger(v) ? 0 : Math.abs(v) < 1 ? 2 : 1);
}

/* Estados de la app → clases de la consola: LETTER, RANK y STATE_WORD viven en alert-classes.js */
function badge(letter, title) {
  const shown = letter === "N" ? "–" : letter;
  return `<span class="av-badge av-b-${letter}" title="${esc(title || STATE_WORD[letter] || "")}">${shown}</span>`;
}

/* ───────────────────────── HERA (simulado) ─────────────────────────
 * Umbrales sobre el sensor con mayor tasa, con persistencia (N muestras seguidas).
 * Oficial: existen 2 niveles en Orion (precaución y recomendación de refugio);
 * los valores no son públicos. Valores usados aquí (µGy/min):
 *  - aviso/refugio 75 (regla citada en literatura; no verificada en fuente primaria)
 *  - precaución 17 (≈1 mGy/h, inicio de efectos agudos en la herramienta ARRT de NASA) [diseño]
 *  - emergencia 500 (30 mGy/h) o dosis BFO del evento ≥ 250 mGy-Eq (límite 30 d, NASA-STD-3001) [diseño]
 *  - vigilancia: > 3× línea base durante 10 min [diseño]
 */
const HERA_TH = { advisoryFactor: 3, caution: 17, warning: 75, emergency: 500 };
const HERA_LEVELS = ["NOMINAL", "ADVISORY", "CAUTION", "WARNING", "EMERGENCY"];
const HERA_TEXT = byLang({
  es: {
    NOMINAL: { short: "Nominal", msg: "Entorno nominal. Mantén la exposición tan baja como sea razonable." },
    ADVISORY: { short: "Vigilar", msg: "Tasa elevada. Registra una lectura de tu dosímetro y verifica el enlace con Tierra." },
    CAUTION: { short: "PRECAUCIÓN", msg: "Posible evento solar. Prepara la estiba del refugio, evita zonas poco blindadas y pospón la EVA (regreso ≤ 2 h). Avisa al médico de vuelo." },
    WARNING: { short: "AVISO · REFUGIO", msg: "Construye el refugio con la estiba (< 1 h), ponte el chaleco si hay y lee el dosímetro cada 15 min." },
    EMERGENCY: { short: "EMERGENCIA · REFÚGIATE YA", msg: "Entra ya a la zona más blindada, cubre torso y cabeza y quédate hasta el aviso (≤ 24 h). Antiemético según el médico de vuelo." },
  },
  en: {
    NOMINAL: { short: "Nominal", msg: "Nominal environment. Keep exposure as low as reasonably achievable." },
    ADVISORY: { short: "Advisory", msg: "Elevated rate. Log a reading from your dosimeter and check the ground link." },
    CAUTION: { short: "CAUTION", msg: "Possible solar event. Prepare the shelter stowage, avoid lightly shielded areas and postpone EVA (return ≤ 2 h). Notify the flight surgeon." },
    WARNING: { short: "WARNING · SHELTER", msg: "Build the shelter with stowage (< 1 h), put on the vest if available and read the dosimeter every 15 min." },
    EMERGENCY: { short: "EMERGENCY · SHELTER NOW", msg: "Move now to the most shielded area, cover torso and head and stay until the all-clear (≤ 24 h). Antiemetic per flight surgeon." },
  },
});
const SPE_PROFILE = [[0, 0.6], [8, 5], [15, 22], [25, 90], [35, 300], [45, 650], [70, 300], [100, 90], [140, 25], [180, 2], [200, 0.7]];

/* ───────────────────────── entorno de la tripulación ─────────────────────────
 * Selector del encabezado global (celda ENTORNO de la barra de estado). Cambia el contexto
 * de la misión en el backend (POST /missions/{id}/context, confirmación manual, simulado)
 * y la línea base SIMULADA de HERA. Si el POST falla, el cambio se aplica solo en local.
 * Tasas de referencia (dosis absorbida, orden de magnitud; valores de diseño, no oficiales):
 *  - ISS / LEO ~0,3–0,5 mGy/día (la magnetosfera atenúa GCR y eventos solares)
 *  - nave en espacio profundo ~1,8 mGy/día (MSL-RAD en crucero; HERA/Artemis I)
 *  - superficie lunar ~1,4 mGy/día (sin atmósfera ni magnetosfera; la Luna tapa media esfera)
 *  - superficie de Marte ~0,7 mGy/día (MSL-RAD en Gale; la atmósfera atenúa los SPE)
 *  - rover presurizado: paredes más finas que un hábitat → más exposición; base enterrada/
 *    cubierta de regolito → menos.
 * shielding multiplica la referencia; speFactor escala el perfil del evento solar simulado.
 * label / short / locationModule / note son getters que devuelven el texto del idioma actual;
 * al backend se envía siempre serverLocation (el módulo en español, estable entre idiomas). */
const ENV_TEXT = {
  es: {
    spacecraft: { label: "Nave espacial", short: "Nave", locationModule: "Cabina de la nave (tránsito en espacio profundo)", note: "espacio profundo, fuera de la magnetosfera", scene: "nave espacial en tránsito con la Tierra al fondo" },
    station: { label: "Estación espacial", short: "Estación", locationModule: "Módulo de la estación orbital (LEO)", note: "órbita baja, protegida en parte por la magnetosfera", scene: "vehículo orbital sobre la Tierra" },
    rover: { label: "Rover", short: "Rover", locationModule: "Rover presurizado (superficie lunar)", note: "superficie lunar, blindaje ligero del rover", scene: "rover presurizado sobre la superficie" },
    base: { label: "Base planetaria (Marte)", short: "Base Marte", locationModule: "Base marciana (hábitat presurizado)", note: "superficie de Marte, hábitat cubierto de regolito", scene: "base de cúpulas presurizadas en la superficie de Marte" },
    moon: { label: "Luna (superficie)", short: "Luna", locationModule: "Superficie lunar (base Polo Sur)", note: "superficie lunar, sin atmósfera ni magnetosfera", scene: "paisaje de la superficie lunar" },
  },
  en: {
    spacecraft: { label: "Spacecraft", short: "Spacecraft", locationModule: "Spacecraft cabin (deep-space transit)", note: "deep space, outside the magnetosphere", scene: "spacecraft in transit with Earth in the background" },
    station: { label: "Space station", short: "Station", locationModule: "Orbital station module (LEO)", note: "low Earth orbit, partly shielded by the magnetosphere", scene: "orbital vehicle above Earth" },
    rover: { label: "Rover", short: "Rover", locationModule: "Pressurized rover (lunar surface)", note: "lunar surface, light rover shielding", scene: "pressurized rover on the surface" },
    base: { label: "Planetary base (Mars)", short: "Mars base", locationModule: "Martian base (pressurized habitat)", note: "Martian surface, regolith-covered habitat", scene: "pressurized dome base on the Martian surface" },
    moon: { label: "Moon (surface)", short: "Moon", locationModule: "Lunar surface (South Pole base)", note: "lunar surface, no atmosphere or magnetosphere", scene: "lunar surface landscape" },
  },
};
export const CREW_ENVIRONMENTS = [
  { key: "spacecraft", code: "SPACECRAFT_CABIN", phaseCode: "TRANSIT", refMGyDay: 1.8, shielding: 1.0, speFactor: 1.0, cadLoc: "Cabina de la nave" },
  { key: "station", code: "LOW_EARTH_ORBIT", phaseCode: "ORBIT", refMGyDay: 0.4, shielding: 1.0, speFactor: 0.15, cadLoc: "Cabina de la nave" },
  { key: "rover", code: "LUNAR_SURFACE", phaseCode: "SURFACE", refMGyDay: 1.4, shielding: 1.25, speFactor: 1.3, cadLoc: "Rover" },
  { key: "base", code: "MARS_SURFACE", phaseCode: "SURFACE", refMGyDay: 0.7, shielding: 0.8, speFactor: 0.35, cadLoc: "Hábitat" },
  { key: "moon", code: "LUNAR_SURFACE", phaseCode: "SURFACE", refMGyDay: 1.4, shielding: 1.0, speFactor: 1.0, cadLoc: "Hábitat" },
].map((e) => withText({ ...e, serverLocation: ENV_TEXT.es[e.key].locationModule }, ENV_TEXT, e.key));
const ENV_BY_KEY = Object.fromEntries(CREW_ENVIRONMENTS.map((e) => [e.key, e]));
/* Banner del entorno en la barra de estado (tras "Enlace con Tierra"): entorno → imagen en
 * frontend/src/assets/env/. "station" no tiene imagen propia y reutiliza la de la nave; para darle
 * una, basta con añadir el archivo y cambiar su entrada aquí. */
const ENV_BANNER_FILE = {
  spacecraft: "env-spacecraft.webp",
  station: "env-spacecraft.webp",
  rover: "env-rover.webp",
  base: "env-base.webp",
  moon: "env-moon.webp",
};
/* Sube este sello al cambiar las imágenes: Cloudflare cachea por URL (max-age 4 h) */
const ENV_BANNER_VER = "2";
const envBannerSrc = (key) =>
  new URL(`../assets/env/${ENV_BANNER_FILE[key] || ENV_BANNER_FILE.spacecraft}?v=${ENV_BANNER_VER}`, import.meta.url).href;
/* Logo SEMSA con fondo transparente, fijo a la izquierda del banner (la escena llena el resto).
 * Versión aclarada para la barra oscura; el tema claro la cambia por la original en console.css. */
const ENV_BANNER_LOGO = new URL(`../assets/env/semsa-logo-dark.webp?v=${ENV_BANNER_VER}`, import.meta.url).href;
/* Encuadre vertical de cada escena al recortarla a lo ancho de la barra */
const ENV_BANNER_FOCUS = { spacecraft: "50% 45%", station: "50% 45%", rover: "50% 62%", base: "50% 55%", moon: "50% 70%" };
const ENV_STORAGE_KEY = "av_crew_env";
const DEFAULT_ENV_KEY = "moon";
/* mGy/día × blindaje → µGy/min (línea base simulada de HERA) */
const envBaseline = (e) => (e.refMGyDay * e.shielding * 1000) / 1440;

function readStoredEnv() {
  try {
    const k = localStorage.getItem(ENV_STORAGE_KEY);
    return k && ENV_BY_KEY[k] ? k : null;
  } catch {
    return null;
  }
}
function storeEnv(key) {
  try { localStorage.setItem(ENV_STORAGE_KEY, key); } catch { /* almacenamiento no disponible */ }
}

/* Código de entorno del backend (+ módulo) → clave del selector; null si no corresponde a ninguna */
function envKeyFromContext(ctx) {
  if (!ctx || !ctx.environment_code) return null;
  const code = String(ctx.environment_code).toUpperCase();
  const loc = String(ctx.location_module || "");
  if (/rover/i.test(loc)) return "rover";
  if (["SPACECRAFT_CABIN", "DEEP_SPACE_TRANSIT", "MARS_TRANSIT", "LUNAR_ORBIT", "MARS_ORBIT"].includes(code)) return "spacecraft";
  if (code === "LOW_EARTH_ORBIT") return "station";
  if (code === "MARS_SURFACE") return "base";
  if (code === "LUNAR_SURFACE") return "moon";
  if (code === "PRESSURIZED_HABITAT") return /mart|mars|marc/i.test(loc) ? "base" : "moon";
  return null;
}

const envState = {
  key: readStoredEnv() || DEFAULT_ENV_KEY,
  pending: false, // POST en curso
  localFor: null, // "aid|mid" con un cambio local sin sincronizar (el backend no lo pisa)
  ctxSig: null, // último contexto del backend visto (id|recorded_at|código|módulo)
  fromBackend: false, // ya se tomó el entorno inicial del backend
  profiles: null, // { CODE: nombre } desde GET /environment/profiles
};

/* Clave del entorno actual de la tripulación (spacecraft | station | rover | base | moon) */
export function getCrewEnvironment() {
  return envState.key;
}

const hera = {
  started: false,
  baseline: envBaseline(ENV_BY_KEY[envState.key]),
  history: [], // {t: Date, v: µGy/min}
  timer: null,
  spe: null, // {k: minuto simulado}
  eventDoseUGy: 0,
  level: "NOMINAL",
  ackedLevel: null,
  sensors: 6,
  listeners: new Set(),
  navigate: null,
};

function speRate(k) {
  for (let i = 1; i < SPE_PROFILE.length; i++) {
    const [k0, v0] = SPE_PROFILE[i - 1];
    const [k1, v1] = SPE_PROFILE[i];
    if (k <= k1) {
      const f = (k - k0) / (k1 - k0);
      return Math.exp(Math.log(v0) + f * (Math.log(v1) - Math.log(v0)));
    }
  }
  return null;
}
function heraEvaluate() {
  const h = hera.history;
  const last = (n) => h.slice(-n).map((p) => p.v);
  const all = (arr, th) => arr.length > 0 && arr.every((v) => v >= th);
  const eventBfo = (hera.eventDoseUGy * 1.5) / 1000; // mGy-Eq (RBE 1,5 protones)
  let level = "NOMINAL";
  if (all(last(10), hera.baseline * HERA_TH.advisoryFactor)) level = "ADVISORY";
  if (all(last(5), HERA_TH.caution)) level = "CAUTION";
  if (all(last(5), HERA_TH.warning)) level = "WARNING";
  if (all(last(3), HERA_TH.emergency) || eventBfo >= 250) level = "EMERGENCY";
  if (HERA_LEVELS.indexOf(level) > HERA_LEVELS.indexOf(hera.ackedLevel || "NOMINAL")) hera.ackedLevel = null;
  hera.level = level;
}
/* ───────── HERA real: dosimetría de Artemis I reproducida por SEMSA ─────────
 * GET {SEMSA}/spaceweather/hera/?minutes=360&ahead=120 → tasa por minuto (máx. de HSU1/HSU2)
 * alineada al reloj. NASA no publica HERA en vivo: es la misión real Artemis I en bucle
 * (George et al. 2024, Nature 634:48, CC BY 4.0). Si SEMSA no responde, sigue la simulación. */
const heraReal = { on: false, buf: new Map(), info: null, loading: false, lastMin: 0, error: null };
const minuteKey = (ms) => Math.floor(ms / 60000);
async function heraRealFetch() {
  if (heraReal.loading) return;
  heraReal.loading = true;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${SEMSA_API}/spaceweather/hera/?minutes=360&ahead=120`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.points) || !data.points.length) throw new Error("formato");
    heraReal.buf = new Map(data.points.map((p) => [minuteKey(Date.parse(p.time)), p.rate]));
    heraReal.lastMin = Math.max(...heraReal.buf.keys());
    heraReal.info = data;
    heraReal.error = null;
    const first = !heraReal.on;
    heraReal.on = true;
    hera.sensors = (data.sensors || []).length || 2;
    hera.baseline = data.typical_rate || hera.baseline;
    if (first && !hera.spe) heraRealRebuild();
  } catch (e) {
    heraReal.error = (e && e.message) || "error";
  } finally {
    heraReal.loading = false;
  }
}
/* Historial = últimas 6 h reales (sin los huecos del instrumento) */
function heraRealRebuild() {
  const nowMin = minuteKey(Date.now());
  hera.history = [...heraReal.buf.entries()]
    .filter(([m, v]) => m <= nowMin && v != null)
    .sort((a, b) => a[0] - b[0])
    .map(([m, v]) => ({ t: new Date(m * 60000), v }));
  if (!hera.history.length) hera.history.push({ t: new Date(), v: hera.baseline });
  heraEvaluate();
  renderHeraBar();
  hera.listeners.forEach((fn) => {
    try { fn(); } catch (e) { /* vista cerrada */ }
  });
}
/* Tasa real del minuto actual (o la última conocida); pide más datos cuando quedan < 30 min */
function heraRealNow() {
  const m = minuteKey(Date.now());
  if (heraReal.lastMin - m < 30) heraRealFetch();
  const v = heraReal.buf.get(m);
  return v == null ? null : v;
}

function heraRealSourceText(T) {
  const m = (heraReal.info && heraReal.info.mission) || {};
  const day = m.replay_day == null ? "—" : num(m.replay_day, 1);
  const days = m.cycle_days == null ? "—" : num(m.cycle_days, 1);
  return fmt(T.realSource, { day, days });
}

function heraTick() {
  const last = hera.history[hera.history.length - 1];
  let t;
  let v;
  if (hera.spe) {
    t = new Date(last.t.getTime() + 60000);
    const r = speRate(hera.spe.k);
    if (r === null) return heraStopSpe(); // terminó el evento: vuelve al reloj (datos reales si hay)
    // el blindaje del entorno (magnetosfera, atmósfera, paredes) escala el evento; nunca baja del fondo
    // (con HERA real, el fondo es la tasa medida en Artemis I en este minuto)
    const f = ENV_BY_KEY[envState.key].speFactor;
    const base = (heraReal.on && heraRealNow()) || hera.baseline;
    v = Math.max(base, r * f) * (1 + (Math.random() - 0.5) * 0.12);
    hera.spe.k += 1;
    hera.eventDoseUGy += v; // 1 min por muestra
  } else if (heraReal.on) {
    t = new Date(minuteKey(Date.now()) * 60000);
    v = heraRealNow() ?? (last ? last.v : hera.baseline); // hueco del instrumento: se mantiene el último valor
    if (last && last.t.getTime() === t.getTime()) hera.history.pop(); // un punto por minuto
  } else {
    t = new Date();
    v = hera.baseline * (1 + (Math.random() - 0.5) * 0.25);
  }
  hera.history.push({ t, v });
  if (hera.history.length > 720) hera.history.shift();
  heraEvaluate();
  renderHeraBar();
  hera.listeners.forEach((fn) => {
    try { fn(); } catch (e) { /* vista cerrada */ }
  });
}
function heraSchedule() {
  clearInterval(hera.timer);
  hera.timer = setInterval(heraTick, hera.spe ? 2000 : 60000);
}
export function startHera(navigateToSection) {
  hera.navigate = navigateToSection;
  if (hera.started) {
    renderHeraBar();
    return;
  }
  hera.started = true;
  const now = Date.now();
  for (let i = 360; i >= 1; i--) {
    hera.history.push({ t: new Date(now - i * 60000), v: hera.baseline * (1 + (Math.random() - 0.5) * 0.25) });
  }
  heraEvaluate();
  renderHeraBar();
  heraSchedule();
  heraRealFetch(); // si SEMSA responde, el historial simulado se sustituye por HERA real
}
function heraStartSpe() {
  hera.spe = { k: 0 };
  hera.eventDoseUGy = 0;
  heraSchedule();
  heraTick();
}
function heraStopSpe() {
  hera.spe = null;
  hera.eventDoseUGy = 0;
  if (heraReal.on) {
    // vuelve al reloj: las últimas 6 h de HERA real
    heraRealRebuild();
    heraSchedule();
    return;
  }
  // vuelve al reloj real: se reconstruye la última hora a línea base
  const now = Date.now();
  hera.history = hera.history.filter((p) => p.t.getTime() < now - 3600000);
  for (let i = 60; i >= 1; i--) hera.history.push({ t: new Date(now - i * 60000), v: hera.baseline * (1 + (Math.random() - 0.5) * 0.25) });
  heraSchedule();
  heraTick();
}
function heraCurrent() {
  return hera.history[hera.history.length - 1] || { t: new Date(), v: hera.baseline };
}
/* Ajusta la línea base simulada al entorno actual.
 * rebuild: reconstruye el historial (entorno inicial tomado del backend: la tripulación ya estaba ahí);
 * si no, el cambio aparece como un escalón con una muestra nueva (salvo durante un evento solar). */
function heraApplyEnvironment(rebuild = false) {
  if (heraReal.on) return; // con HERA real el fondo es el medido; el entorno solo escala el evento solar
  hera.baseline = envBaseline(ENV_BY_KEY[envState.key]);
  if (!hera.started || hera.spe) return;
  if (rebuild) {
    const now = Date.now();
    const n = hera.history.length;
    hera.history = [];
    for (let i = n; i >= 1; i--) hera.history.push({ t: new Date(now - i * 60000), v: hera.baseline * (1 + (Math.random() - 0.5) * 0.25) });
  }
  heraTick();
}

function renderHeraBar() {
  // Primera fila del encabezado global (#av-chrome); si no existe, al inicio de .main-area
  const area = document.getElementById("av-chrome") || document.querySelector(".main-area");
  if (!area) return;
  let bar = document.getElementById("av-hera-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "av-hera-bar";
    bar.addEventListener("click", (ev) => {
      const act = ev.target.closest("[data-hera]")?.getAttribute("data-hera");
      if (act === "open") {
        if (hera.navigate) hera.navigate("radiation");
      } else if (act === "ack") {
        hera.ackedLevel = hera.level;
        renderHeraBar();
        renderChrome();
        repaintConsole();
      }
    });
    area.prepend(bar);
  }
  const cur = heraCurrent();
  const lvl = hera.level;
  const env = ENV_BY_KEY[envState.key];
  const alarm = HERA_LEVELS.indexOf(lvl) >= 2;
  const acked = hera.ackedLevel === lvl;
  // La barra solo se muestra desde precaución (CAUTION, WARNING, EMERGENCY); en el resto queda oculta
  if (!alarm) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }
  bar.style.display = "";
  bar.className = `av-hera av-hera-${lvl}`;
  bar.setAttribute("role", alarm ? "alert" : "status");
  const T = tt();
  const dose = num(env.refMGyDay * env.shielding, 2);
  bar.setAttribute("aria-label", T.heraAria);
  bar.innerHTML = `
    <strong class="${alarm && !acked && lvl !== "CAUTION" ? "av-hera-flash" : ""}">HERA</strong>
    <span><span class="av-mono">${num(cur.v, cur.v < 10 ? 2 : 0)}</span> µGy/min</span>
    <strong>${esc(HERA_TEXT[lvl].short)}</strong>
    <span class="av-hera-sep" aria-hidden="true">·</span>
    ${heraReal.on
      ? `<span class="av-hera-env" title="${esc(heraRealSourceText(T))}">${esc(env.short)} · ${esc(T.realBarSource)}</span>`
      : `<span class="av-hera-env" title="${esc(fmt(T.heraEnvTitle, { label: env.label, note: env.note, dose }))}">${esc(env.short)} · ${esc(T.heraBase)} <span class="av-mono">${dose}</span> mGy/d</span>`}
    <span class="av-hera-sep" aria-hidden="true">·</span>
    <span>${esc(fmt(T.heraSensors, { n: hera.sensors }))} <span class="av-mono">${gmt(cur.t, false)}</span></span>
    <span class="av-hera-sep" aria-hidden="true">·</span>
    <span>${esc(hera.spe ? T.heraSpe : heraReal.on ? T.realData : T.simData)}</span>
    <span style="flex:1 1 0"></span>
    ${alarm && !acked ? `<button type="button" class="av-btn" data-hera="ack">${esc(T.ack)}</button>` : ""}
    <button type="button" class="av-btn" data-hera="open">${esc(T.radiation)}</button>`;
}

/* Cambio de idioma: la barra HERA y el encabezado global se repintan aquí (app.js repinta la sección).
 * Si estaba abierto el detalle de un indicador, se conserva al volver a pintar el Resumen. */
onLangChange(() => {
  if (consoleState.view === "indicator" && consoleState.indicator && chromeState.appState?.currentSection === "mission-control") {
    consoleState.pendingView = "indicator";
  }
  if (hera.started) renderHeraBar();
  if (chromeState.appState) renderChrome();
});

/* ───────────────────────── estado de la consola ───────────────────────── */

/* Tabla de signos: sección de parámetros nominales desplegada (persiste entre repintados y refrescos) */
let nominalOpen = false;

const consoleState = {
  view: "summary", // summary | indicator | radiation
  pendingView: null, // vista pedida desde fuera (p. ej. "indicator" desde la barra de alarma)
  indicator: null,
  sys: null,
  pop: null, // región del mapa corporal con la ficha fijada (solo se muestra si coincide con sys)
  popFrom: null, // data-focus-id del control que fijó la ficha (para devolverle el foco)
  showAdv: false,
  radFold: {}, // secciones plegadas de la vista Radiación (clave → false si está cerrada)
  layers: { mus: true, bon: true },
  proc: { step: 1, result: null },
  heraListener: null, // oyente HERA de la vista abierta (el del encabezado global es aparte)
  localAcks: new Set(), // alertas a bordo (CO₂, sueño) reconocidas en esta sesión
};

/* Caché de datos compartida por el encabezado global y las secciones de la consola.
 * Se refresca con refreshConsoleData (desde refreshGlobalHeaderAndSummary en app.js,
 * tras un ACK o una medición) y las vistas la leen con getConsoleData. */
const CACHE_MAX_AGE_MS = 30000;
const EMPTY_DATA = { summary: {}, alerts: [], regions: [], missions: [], act: [], sleep: [], rad: [], errors: 0 };
const cache = { key: null, data: null, at: 0, pending: null, pendingKey: null };
const cacheKey = (appState) => `${appState.selectedAstronautId ?? ""}|${appState.selectedMissionId ?? ""}`;

/* Estado del encabezado global (fuera de #section-view-container) */
const chromeState = {
  appState: null,
  helpers: {},
  bound: false,
  clockTimer: null,
  clockOffset: 0, // hora del sistema (resumen) − hora local, en ms
  offsetFor: null, // resumen con el que se calculó clockOffset
  lastLevel: null,
  lastAcked: null,
};

const PROGRAMMED_SLEEP_H = 8.5; // ISS: 8,5 h programadas
const WEEKLY_EXERCISE_MIN = 600; // ISS: ~600 min/semana (ARED + T2 + CEVIS)
const CAREER_LIMIT_MSV = 600; // NASA-STD-3001 Vol. 1 Rev C
const SYS_NAMES = byLang({
  es: {
    HEAD_BRAIN: "Cabeza y sueño", EYES_VISION: "Ojos y visión", GENERAL_WELLNESS: "Bienestar general",
    IMMUNE_SYSTEM: "Sistema inmune", LUNGS_RESP: "Pulmones", HEART_CARDIO: "Corazón",
    DIGESTIVE_NUTRITION: "Digestivo y renal", SKIN_THERMO: "Piel y temperatura", MUSCLES: "Músculos", BONES_SKELETAL: "Huesos",
  },
  en: {
    HEAD_BRAIN: "Head & sleep", EYES_VISION: "Eyes & vision", GENERAL_WELLNESS: "General well-being",
    IMMUNE_SYSTEM: "Immune system", LUNGS_RESP: "Lungs", HEART_CARDIO: "Heart",
    DIGESTIVE_NUTRITION: "Digestive & renal", SKIN_THERMO: "Skin & temperature", MUSCLES: "Muscles", BONES_SKELETAL: "Bones",
  },
});

function ruleOf(appState, code) {
  return (appState.indicatorsCatalog || []).find((i) => i.code === code) || null;
}
function limitsText(rule, kind) {
  if (!rule || !rule.rule) return "—";
  const r = rule.rule;
  const lo = kind === "Y" ? r.monitor_min : r.warning_min;
  const hi = kind === "Y" ? r.monitor_max : r.warning_max;
  const parts = [];
  if (lo !== null && lo !== undefined && lo > (rule.min_valid_value ?? -Infinity) && lo < r.normal_min) parts.push(`<${num(lo, lo % 1 ? 1 : 0)}`);
  if (hi !== null && hi !== undefined && hi > r.normal_max) parts.push(`>${num(hi, hi % 1 ? 1 : 0)}`);
  return parts.length ? parts.join(" ") : "—";
}
function sparkPoints(values, w = 132, h = 34) {
  const v = values.filter((x) => x !== null && x !== undefined);
  if (v.length < 2) return "";
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const sp = hi - lo || 1;
  return v.map((x, i) => `${(4 + (i * (w - 8)) / (v.length - 1)).toFixed(1)},${(h - 5 - ((x - lo) / sp) * (h - 10)).toFixed(1)}`).join(" ");
}

/* Integra una serie de tasas diarias (mSv/día) muestreadas de forma irregular:
 * valor constante hasta la siguiente muestra, la última hasta "ahora". */
function integrateDaily(points, now, fromDate = null) {
  const pts = (points || []).filter((p) => p.value !== null && p.value !== undefined && !p.is_gap_marker)
    .map((p) => ({ t: new Date(p.measured_at).getTime(), v: Number(p.value) }))
    .sort((a, b) => a.t - b.t);
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    let t0 = pts[i].t;
    const t1 = i + 1 < pts.length ? pts[i + 1].t : now.getTime();
    if (fromDate && t1 <= fromDate.getTime()) continue;
    if (fromDate && t0 < fromDate.getTime()) t0 = fromDate.getTime();
    total += (pts[i].v * Math.max(0, t1 - t0)) / 86400000;
  }
  return total;
}

async function loadData(appState) {
  const aid = appState.selectedAstronautId;
  const mid = appState.selectedMissionId;
  const ts = (code) => apiService.getAnalyticsTimeseries({ astronaut_id: aid, mission_id: mid, indicator_code: code });
  const [sum, alerts, regions, missions, act, sleep, rad] = await Promise.allSettled([
    appState.healthSummary ? Promise.resolve(appState.healthSummary) : apiService.getHealthSummary(aid, mid),
    apiService.getAlerts(aid),
    apiService.getBodyRegions(aid, mid),
    apiService.getDailyMissions(aid),
    ts("PHYSICAL_ACTIVITY"),
    ts("SLEEP_DURATION"),
    ts("RADIATION_EXPOSURE"),
  ]);
  const ok = (r, fb) => (r.status === "fulfilled" && r.value ? r.value : fb);
  return {
    summary: ok(sum, {}),
    alerts: ok(alerts, { alerts: [] }).alerts || [],
    regions: ok(regions, { regions: [] }).regions || [],
    missions: ok(missions, { missions: [] }).missions || [],
    act: ok(act, { points: [] }).points || [],
    sleep: ok(sleep, { points: [] }).points || [],
    rad: ok(rad, { points: [] }).points || [],
    errors: [sum, alerts, regions, missions].filter((r) => r.status === "rejected").length,
  };
}

/* Vuelve a pedir los datos de la consola y los deja en caché (una sola carga en curso por clave). */
export function refreshConsoleData(appState) {
  const key = cacheKey(appState);
  const p = loadData(appState).then(
    (data) => {
      if (cache.pending === p) {
        cache.key = key;
        cache.data = data;
        cache.at = Date.now();
        cache.pending = null;
        cache.pendingKey = null;
      }
      return data;
    },
    (err) => {
      if (cache.pending === p) {
        cache.pending = null;
        cache.pendingKey = null;
      }
      throw err;
    }
  );
  cache.pending = p;
  cache.pendingKey = key;
  return p;
}

/* Datos en caché para el tripulante/misión actuales; recarga si no hay o tienen más de maxAgeMs. */
export async function getConsoleData(appState, maxAgeMs = CACHE_MAX_AGE_MS) {
  const key = cacheKey(appState);
  if (cache.pending && cache.pendingKey === key) return cache.pending;
  if (cache.data && cache.key === key && Date.now() - cache.at <= maxAgeMs) return cache.data;
  return refreshConsoleData(appState);
}

/* Lectura síncrona de la caché (vacía si es de otro tripulante o aún no hay datos) */
function dataFor(appState) {
  return cache.data && cache.key === cacheKey(appState) ? cache.data : EMPTY_DATA;
}

/* Valores derivados que usan varias vistas */
function derive(appState, data) {
  // el resumen más reciente es el de appState (lo refresca app.js); la caché es el respaldo
  const s = appState.healthSummary || data.summary || {};
  const now = s.system_time_utc ? new Date(s.system_time_utc) : new Date();
  const cards = s.indicator_cards || [];
  const card = (code) => cards.find((c) => c.indicator_code === code) || null;
  const env = s.environmental_telemetry || [];
  const envParam = (code) => env.filter((e) => e.parameter_code === code)
    .sort((a, b) => new Date(b.measured_at) - new Date(a.measured_at))[0] || null;

  // Radiación: dosis de misión estimada desde la tasa diaria registrada + evento HERA simulado
  const missionDose = integrateDaily(data.rad, now);
  const last30 = integrateDaily(data.rad, now, new Date(now.getTime() - 30 * 86400000));
  const eventMGyEq = (hera.eventDoseUGy * 1.5) / 1000;
  const eventMGy = hera.eventDoseUGy / 1000;
  const priorCareer = 0; // sin historial previo registrado en la app
  const career = priorCareer + missionDose + eventMGyEq;
  const radCard = card("RADIATION_EXPOSURE");

  // CO2 (límite NASA: media de 1 h ≤ 3 mmHg)
  const co2 = envParam("CO2_LEVEL");
  const co2v = co2 ? Number(co2.value) : null;
  const co2Letter = co2v === null ? "M" : co2v >= 3.0 ? "W" : co2v >= 2.8 ? "C" : co2v >= 2.5 ? "A" : "N";

  // Ejercicio semanal: suma de min/día de los últimos 7 días (último registro de cada día)
  const byDay = {};
  (data.act || []).forEach((p) => {
    if (p.value === null || p.is_gap_marker) return;
    const t = new Date(p.measured_at);
    if (now - t > 7 * 86400000) return;
    byDay[t.toISOString().slice(0, 10)] = Number(p.value);
  });
  const weekMin = Object.values(byDay).reduce((a, b) => a + b, 0);
  const weekLetter = weekMin < WEEKLY_EXERCISE_MIN * 0.5 ? "C" : weekMin < WEEKLY_EXERCISE_MIN * 0.75 ? "A" : "N";

  // Sueño: deuda de las últimas 3 noches frente a 8,5 h programadas (regla DEMO: > 2 h = precaución)
  const nights = (data.sleep || []).filter((p) => p.value !== null && !p.is_gap_marker).slice(-3);
  const sleepDebt = nights.reduce((a, p) => a + Math.max(0, PROGRAMMED_SLEEP_H - Number(p.value)), 0);
  const sleepCard = card("SLEEP_DURATION");
  const debtLetter = sleepDebt > 2 ? "C" : "N"; // regla de diseño; NASA no publica un límite

  return { s, now, cards, card, env, envParam, missionDose, last30, eventMGyEq, eventMGy, career, radCard,
    co2, co2v, co2Letter, weekMin, weekLetter, nights, sleepDebt, sleepCard, debtLetter };
}

/* Alertas: API + alertas derivadas a bordo (CO2, deuda de sueño, HERA) */
function buildAlerts(d, data) {
  const T = tt();
  const list = (data.alerts || [])
    .filter((a) => a.status !== "RESOLVED")
    .map((a) => ({
      id: a.id,
      cls: alertClassOf(a.operational_state),
      // Las CRITICAL nacen ESCALATED por el motor sin ACK: siguen sin reconocer (misma regla que alerts.js)
      acked: !(a.status === "NEW" ||
        (a.status === "ESCALATED" && !(a.acknowledgements || []).length && !(a.followups || []).length)),
      msg: bt(a.title),
      detail: `${a.value_recorded ?? ""} ${bt(a.unit ?? "")}`.trim(),
      t: toDate(a.created_at),
      indicator: a.indicator_code,
      api: true,
      raw: a,
    }));
  if (isAlarm(d.co2Letter)) {
    list.push({ id: "co2", cls: d.co2Letter, acked: consoleState.localAcks.has("co2"), msg: T.co2Alert, detail: `${num(d.co2v, 1)} mmHg · ${T.co2Limits}`, t: toDate(d.co2.measured_at), local: true });
  }
  if (d.debtLetter !== "N") {
    list.push({ id: "sleep-debt", cls: d.debtLetter, acked: consoleState.localAcks.has("sleep-debt"), msg: T.sleepDebtAlert, detail: fmt(T.sleepDebtDetail, { h: num(d.sleepDebt, 1) }), t: d.nights.length ? toDate(d.nights[d.nights.length - 1].measured_at) : null, local: true });
  }
  const hl = HERA_LEVELS.indexOf(hera.level);
  if (hl >= 1) {
    list.push({ id: "hera", cls: classFromRank(Math.min(hl, 3)), acked: hera.ackedLevel === hera.level, msg: fmt(T.heraAlert, { lvl: HERA_TEXT[hera.level].short }), detail: `${num(heraCurrent().v, 1)} µGy/min`, t: heraCurrent().t, local: true, hera: true, heraLevel: hera.level });
  }
  list.sort((a, b) => RANK[b.cls] - RANK[a.cls] || (a.t && b.t ? a.t - b.t : 0));
  return list;
}

/* ───────────────────────── render principal ───────────────────────── */

/* Raíz propia de la consola: los listeners delegados solo actúan dentro de ella
 * (las vistas de src/console/views/ también usan .av-console como raíz). */
const ROOT_ATTR = 'data-av-root="console"';
const ROOT_SEL = '[data-av-root="console"]';
const CONSOLE_SECTIONS = ["mission-control", "radiation"];

/* opts.view: "summary" (por defecto) | "radiation" | "indicator" (requiere consoleState.indicator) */
export async function renderConsole(container, appState, helpers, opts = {}) {
  document.body.classList.add("av-console-on");
  const view = opts.view || consoleState.pendingView || "summary";
  consoleState.pendingView = null;
  consoleState.view = view === "indicator" && !consoleState.indicator ? "summary" : view;
  container.innerHTML = `<div class="av-console" ${ROOT_ATTR}><div style="padding:24px" class="av-sub">${esc(tt().loadingConsole)}</div></div>`;
  bindOnce(container, appState, helpers);
  try {
    await getConsoleData(appState);
  } catch (e) {
    container.innerHTML = `<div class="av-console" ${ROOT_ATTR}><div class="av-panel" style="margin:12px;padding:16px">${esc(fmt(tt().loadFailed, { msg: bt(e.message) }))}</div></div>`;
    return;
  }
  // si la caché se recargó aquí, el encabezado global también se actualiza (no vuelve a pedir datos)
  renderChrome(appState);
  // solo se sustituye el oyente HERA de la vista; el del encabezado global se mantiene
  if (consoleState.heraListener) hera.listeners.delete(consoleState.heraListener);
  let lastLevel = hera.level;
  consoleState.heraListener = () => {
    if (!document.body.contains(container) || !CONSOLE_SECTIONS.includes(appState.currentSection) || !container.querySelector(ROOT_SEL)) return;
    const changed = hera.level !== lastLevel;
    lastLevel = hera.level;
    // cambio de nivel: repintado completo de la vista (alertas, tarjetas);
    // si no, solo las partes en vivo para no borrar lo que se está escribiendo
    if (changed) return paint(container, appState);
    const d = derive(appState, dataFor(appState));
    if (consoleState.view === "radiation") {
      const live = container.querySelector("#av-rad-live");
      if (live) live.innerHTML = radLiveInner(d);
      const folds = container.querySelector("#av-rad-live-folds");
      if (folds) folds.innerHTML = radLiveFolds(d);
    } else {
      const el = container.querySelector("#av-p1-rad");
      if (el) el.outerHTML = radCardHTML(d);
    }
  };
  hera.listeners.add(consoleState.heraListener);
  paint(container, appState);
}

function paint(container, appState) {
  const data = dataFor(appState);
  const d = derive(appState, data);
  const alerts = buildAlerts(d, data);
  let body = "";
  if (consoleState.view === "indicator" && consoleState.indicator) body = indicatorHTML(appState, d, alerts);
  else if (consoleState.view === "radiation") body = radiationHTML(appState, d);
  else body = summaryHTML(appState, d, data, alerts);
  // la barra de estado, la de alarma y las pestañas viven en el encabezado global (#av-chrome)
  container.innerHTML = `<div class="av-console" ${ROOT_ATTR}>${body}</div>`;
  if (consoleState.view === "indicator") loadIndicatorExtras(container, appState);
  else if (consoleState.view === "summary") placeBodyPop(container);
}

/* Repinta la sección de consola abierta (si la hay) tras un cambio hecho desde el encabezado */
function repaintConsole() {
  const st = chromeState.appState;
  const c = document.getElementById("section-view-container");
  if (!st || !c || !CONSOLE_SECTIONS.includes(st.currentSection) || !c.querySelector(ROOT_SEL)) return;
  paint(c, st);
}

/* ───────────────────────── encabezado global ───────────────────────── */

const chromeNow = () => new Date(Date.now() + chromeState.clockOffset);

function tickChromeClock() {
  const el = document.getElementById("av-gmt");
  if (el) el.textContent = gmt(chromeNow());
}

/* Banner del entorno: un nodo persistente (dos <img> superpuestas para el fundido) que se
 * vuelve a colocar en su hueco cada vez que se reescribe la barra de estado. */
const envBanner = { node: null, preloaded: [] };

function preloadEnvBanners() {
  if (envBanner.preloaded.length) return;
  [...new Set([ENV_BANNER_LOGO, ...Object.keys(ENV_BANNER_FILE).map(envBannerSrc)])].forEach((src) => {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    if (img.decode) img.decode().catch(() => { /* se reintenta al mostrarla */ });
    envBanner.preloaded.push(img);
  });
}

function placeEnvBanner() {
  const slot = document.getElementById("av-env-banner-slot");
  if (!slot) return;
  if (!envBanner.node) {
    const box = document.createElement("div");
    box.className = "av-env-banner";
    box.innerHTML = `<img class="av-env-banner-logo" decoding="async" alt="SEMSA" src="${ENV_BANNER_LOGO}"><div class="av-env-banner-scene"><img class="av-env-banner-img" decoding="async" alt=""><img class="av-env-banner-img" decoding="async" alt="" aria-hidden="true"></div>`;
    envBanner.node = box;
  }
  envBanner.node.style.setProperty("--av-env-focus", ENV_BANNER_FOCUS[envState.key] || "50% 50%");
  const env = ENV_BY_KEY[envState.key];
  const src = envBannerSrc(envState.key);
  const alt = env ? fmt(tt().envBannerAlt, { label: env.label, scene: env.scene }) : "";
  const [a, b] = envBanner.node.querySelectorAll(".av-env-banner-img");
  const on = a.classList.contains("is-on") ? a : b.classList.contains("is-on") ? b : null;
  if (!on) {
    a.src = src; a.alt = alt; a.removeAttribute("aria-hidden"); a.classList.add("is-on");
  } else if (on.getAttribute("src") === src) {
    on.alt = alt; // mismo archivo (p. ej. nave ↔ estación): solo cambia el texto alternativo
  } else {
    const next = on === a ? b : a;
    next.src = src;
    next.alt = alt;
    next.removeAttribute("aria-hidden");
    on.alt = "";
    on.setAttribute("aria-hidden", "true");
    next.classList.add("is-on");
    on.classList.remove("is-on");
  }
  if (envBanner.node.parentNode !== slot) slot.appendChild(envBanner.node);
}

/* Solo reescribe el HTML si cambió (evita repetir el anuncio de role="alert") */
function setHTML(el, html) {
  if (!el || el.__avHtml === html) return;
  el.innerHTML = html;
  el.__avHtml = html;
}

function chromeHeraListener() {
  if (hera.level === chromeState.lastLevel && hera.ackedLevel === chromeState.lastAcked) return;
  renderChrome();
}

/* Reconoce una alerta (API o a bordo) desde la barra de alarma o desde el procedimiento */
async function ackAlert(id, st, hp, btn) {
  if (id === "hera") {
    hera.ackedLevel = hera.level;
    renderHeraBar();
    renderChrome(st);
    repaintConsole();
    return;
  }
  if (id === "co2" || id === "sleep-debt") {
    consoleState.localAcks.add(id);
    if (hp.showToast) hp.showToast(tt().toastLocalAck);
    renderChrome(st);
    repaintConsole();
    return;
  }
  if (btn) btn.disabled = true;
  await apiService.acknowledgeAlert(Number(id), tt().ackNote);
  if (hp.showToast) hp.showToast(tt().toastAck);
  // fuerza el repintado de la barra de alarma aunque su HTML no cambie (el botón quedó deshabilitado)
  const alarmEl = document.getElementById("av-chrome-alarm");
  if (alarmEl) alarmEl.__avHtml = null;
  // refresca resumen + caché + encabezado (app.js) y después la vista de consola abierta
  if (hp.refreshGlobalHeaderAndSummary) {
    await hp.refreshGlobalHeaderAndSummary();
  } else {
    await refreshConsoleData(st);
    renderChrome(st);
  }
  repaintConsole();
}

/* Aplica un entorno en la app: HERA, localStorage, evento, caché y repintado (no habla con el backend) */
function applyCrewEnvironment(key, { rebuildHera = false } = {}) {
  const env = ENV_BY_KEY[key];
  if (!env) return false;
  const changed = envState.key !== key;
  envState.key = key;
  storeEnv(key);
  if (!changed) return false;
  heraApplyEnvironment(rebuildHera);
  cache.at = 0; // la caché queda vieja: la próxima lectura con getConsoleData vuelve a pedir
  window.dispatchEvent(new CustomEvent("av:environment-change", { detail: { key, code: env.code } }));
  renderHeraBar();
  return true;
}

const selKey = (st) => `${st?.selectedAstronautId ?? ""}|${st?.selectedMissionId ?? ""}`;

/* Cambio pedido desde el selector: se aplica ya en local y se intenta registrar en el backend */
async function setCrewEnvironment(key) {
  const env = ENV_BY_KEY[key];
  const st = chromeState.appState;
  const hp = chromeState.helpers || {};
  if (!env || !st) return;
  applyCrewEnvironment(key);
  const sk = selKey(st);
  envState.localFor = sk;
  const knownCode = !envState.profiles || envState.profiles[env.code];
  if (!st.selectedMissionId || apiService.simulatedOfflineMode || !knownCode) {
    renderChrome(st);
    repaintConsole();
    if (hp.showToast) hp.showToast(fmt(tt().envLocalOnly, { label: env.label }));
    return;
  }
  envState.pending = true;
  renderChrome(st);
  repaintConsole();
  try {
    const res = await apiService.updateMissionContext(st.selectedMissionId, {
      astronaut_id: st.selectedAstronautId ?? null,
      environment_code: env.code,
      phase_code: env.phaseCode,
      location_module: env.serverLocation,
      determination_source: "MANUAL_CONFIRMATION",
      is_simulated: true,
    });
    envState.pending = false;
    // el selector puede haber cambiado mientras tanto, o el tripulante seleccionado
    if (envState.key !== key || selKey(st) !== sk) return;
    envState.localFor = null;
    if (res && res.context && st.healthSummary) st.healthSummary = { ...st.healthSummary, context: res.context };
    if (hp.showToast) hp.showToast(fmt(tt().envUpdated, { label: env.label }));
    if (hp.refreshGlobalHeaderAndSummary) {
      try { await hp.refreshGlobalHeaderAndSummary(); } catch { renderChrome(st); }
    } else {
      try { await refreshConsoleData(st); } catch { /* se pinta con lo disponible */ }
      renderChrome(st);
    }
    repaintConsole();
  } catch (e) {
    envState.pending = false;
    renderChrome(st);
    repaintConsole();
    if (hp.showToast) hp.showToast(fmt(tt().envPostFailed, { label: env.label, msg: bt(e.message) }));
  }
}

/* Toma el entorno del contexto activo del backend cuando ese contexto cambia (o al inicio).
 * Un cambio local sin sincronizar del mismo tripulante/misión tiene prioridad. */
function syncEnvFromBackend(st) {
  const ctx = st?.healthSummary?.context;
  if (!ctx) return;
  const sig = `${selKey(st)}|${ctx.id ?? ""}|${ctx.recorded_at ?? ""}|${ctx.environment_code ?? ""}|${ctx.location_module ?? ""}`;
  if (sig === envState.ctxSig) return;
  envState.ctxSig = sig;
  const k = envKeyFromContext(ctx);
  if (envState.localFor && envState.localFor !== selKey(st)) envState.localFor = null;
  if (envState.localFor) {
    if (k === envState.key) envState.localFor = null; // el servidor ya coincide
    return;
  }
  if (!k) return;
  const first = !envState.fromBackend;
  envState.fromBackend = true;
  if (applyCrewEnvironment(k, { rebuildHera: first })) repaintConsole();
}

/* Delegación de eventos del encabezado global (una sola vez), oyente HERA y reloj GMT */
export function initChrome(appState, helpers = {}) {
  chromeState.appState = appState;
  chromeState.helpers = helpers;
  if (chromeState.bound) return;
  const root = document.getElementById("av-chrome");
  if (!root) return;
  chromeState.bound = true;

  root.addEventListener("click", async (ev) => {
    // la barra HERA tiene su propio manejador (data-hera); las pestañas las enlaza app.js (data-nav-section)
    const el = ev.target.closest("#av-chrome-status [data-act], #av-chrome-alarm [data-act]");
    if (!el) return;
    const st = chromeState.appState;
    const hp = chromeState.helpers;
    const act = el.getAttribute("data-act");
    try {
      if (act === "ack") {
        const id = el.getAttribute("data-alert");
        await ackAlert(id, st, hp, el);
        // la lista del centro de alertas se recarga para reflejar el ACK
        if (/^\d+$/.test(String(id)) && st.currentSection === "alerts-center" && hp.navigateToSection) {
          await hp.navigateToSection("alerts-center");
        }
      } else if (act === "open-indicator") {
        const code = el.getAttribute("data-code");
        if (code) {
          consoleState.indicator = code;
          consoleState.proc = { step: 1, result: null };
          consoleState.pendingView = "indicator";
        }
        if (hp.navigateToSection) await hp.navigateToSection("mission-control");
      } else if (act === "view-radiation") {
        if (hp.navigateToSection) await hp.navigateToSection("radiation");
      }
    } catch (e) {
      if (hp.showToast) hp.showToast(fmt(tt().actionFailed, { msg: bt(e.message) }));
      el.disabled = false;
    }
  });

  // selector de entorno de la tripulación (celda ENTORNO de la barra de estado)
  root.addEventListener("change", (ev) => {
    const sel = ev.target.closest && ev.target.closest("#av-env-select");
    if (!sel || !ENV_BY_KEY[sel.value]) return;
    setCrewEnvironment(sel.value);
  });
  // nombres de los perfiles del backend (para la ayuda y para no enviar códigos desconocidos)
  apiService.getEnvironmentProfiles().then(
    (r) => {
      const list = (r && r.profiles) || [];
      if (!list.length) return;
      envState.profiles = Object.fromEntries(list.map((p) => [p.code, p.name || p.code]));
      if (chromeState.appState) renderChrome();
    },
    () => { /* sin perfiles: se usan los nombres locales */ }
  );

  preloadEnvBanners();
  hera.listeners.add(chromeHeraListener);
  clearInterval(chromeState.clockTimer);
  chromeState.clockTimer = setInterval(tickChromeClock, 1000);
}

/* Pinta la barra de estado y la de alarma C&W en el encabezado global (cualquier sección).
 * Usa appState.healthSummary + la caché (alertas, sueño, radiación) + HERA; no pide datos. */
export function renderChrome(appState) {
  if (appState) chromeState.appState = appState;
  const st = chromeState.appState;
  if (!st) return;
  const statusEl = document.getElementById("av-chrome-status");
  const alarmEl = document.getElementById("av-chrome-alarm");
  if (!statusEl && !alarmEl) return;
  const s = st.healthSummary;
  if (s && s !== chromeState.offsetFor) {
    chromeState.offsetFor = s;
    const t = s.system_time_utc ? new Date(s.system_time_utc).getTime() : NaN;
    chromeState.clockOffset = Number.isNaN(t) ? 0 : t - Date.now();
  }
  syncEnvFromBackend(st);
  const data = dataFor(st);
  const d = derive(st, data);
  const alerts = buildAlerts(d, data);
  // si el selector de entorno tenía el foco, se le devuelve tras reescribir la barra
  const envFocused = document.activeElement && document.activeElement.id === "av-env-select";
  setHTML(statusEl, statusBarHTML(st, d, alerts));
  if (envFocused && document.activeElement?.id !== "av-env-select") document.getElementById("av-env-select")?.focus({ preventScroll: true });
  placeEnvBanner();
  setHTML(alarmEl, alarmBarHTML(alerts));
  chromeState.lastLevel = hera.level;
  chromeState.lastAcked = hera.ackedLevel;
}

/* Primera celda de la barra de estado: rótulo = misión, valor = nombre de la app
 * (antes "Misión · DEMO" + código de misión; issues #5 y #14). El código y nombre
 * de la misión del backend quedan en el tooltip. */
const BRAND_LABEL = "TeleCreation UTS";
const APP_NAME = "SEMSA";

function statusBarHTML(appState, d, alerts) {
  const s = d.s;
  const mission = s.mission || {};
  // Tripulante = usuario con la sesión iniciada (issue #5), no el astronauta seleccionado
  const astro = appState.currentUser || s.astronaut || {};
  const ctx = s.context || {};
  const w = alerts.filter((a) => a.cls === "W").length;
  const c = alerts.filter((a) => a.cls === "C").length;
  const unack = alerts.filter((a) => isAlarm(a.cls) && !a.acked).length;
  const link = ctx.connectivity_status || "—";
  const crew = `${astro.full_name || "—"}${astro.crew_code ? ` · ${astro.crew_code}` : ""}`;
  const envName = bt(ctx.environment_name) || ctx.environment_code || "";
  const delay = ctx.comms_delay_seconds !== undefined && ctx.comms_delay_seconds !== null ? `${num(ctx.comms_delay_seconds, 1)} s` : "—";
  const T = tt();
  return `
  <div class="av-status" role="group" aria-label="${esc(T.statusAria)}">
    <div class="av-st av-st-brand"><span class="av-lbl">${esc(BRAND_LABEL)}</span><span class="av-v" title="${esc([mission.code, bt(mission.name)].filter(Boolean).join(" — "))}">${esc(APP_NAME)}</span></div>
    <div class="av-st"><span class="av-lbl">${esc(T.crewMember)}</span><span class="av-v" title="${esc(crew)}">${esc(crew)}</span></div>
    <div class="av-st av-st-row av-st-fixed">
      <div><div class="av-lbl">GMT</div><div class="av-mono av-v av-st-clock" id="av-gmt">${gmt(chromeNow())}</div></div>
      <div><div class="av-lbl">MET</div><div class="av-mono av-v av-st-clock">${met(mission.elapsed_days)}</div></div>
    </div>
    ${envCellHTML(ctx, envName)}
    <div class="av-st"><span class="av-lbl">${esc(T.groundLink)}</span><span class="av-st-line"><span class="av-mono av-v">${esc(link === "ONLINE" ? "AOS" : link === "OFFLINE" ? "LOS" : link)}</span> <span class="av-sub">${esc(T.delay)}</span> <span class="av-mono">${delay}</span></span></div>
    <div class="av-st av-st-fixed av-st-banner" id="av-env-banner-slot"></div>
    <div class="av-grow"></div>
    <div class="av-st av-st-row av-st-fixed av-st-counts" role="group" aria-label="${esc(T.countsAria)}">
      <span class="av-st-count">${w ? badge("W", CLASS_PLURAL.W) : `<span class="av-badge" style="color:var(--av-r-text);border-color:var(--av-r)" title="${esc(CLASS_PLURAL.W)}">W</span>`}<span class="av-mono av-v">${w}</span></span>
      <span class="av-st-count">${c ? badge("C", CLASS_PLURAL.C) : `<span class="av-badge" style="color:var(--av-y);border-color:var(--av-y)" title="${esc(CLASS_PLURAL.C)}">C</span>`}<span class="av-mono av-v">${c}</span></span>
      <span class="av-st-col"><span class="av-lbl">${esc(T.unacked)}</span><span class="av-mono av-v">${unack}</span></span>
    </div>
  </div>`;
}

/* Celda ENTORNO: selector del entorno de la tripulación + estado de sincronización con el backend */
function envCellHTML(ctx, envName) {
  const env = ENV_BY_KEY[envState.key];
  const hasCtx = !!(ctx && ctx.environment_code);
  const synced = hasCtx && !envState.localFor && envKeyFromContext(ctx) === envState.key;
  const T = tt();
  const sync = envState.pending
    ? { cls: "pending", text: T.syncSending, help: T.syncSendingHelp }
    : synced
      ? { cls: "ok", text: T.syncOk, help: fmt(T.syncOkHelp, { name: `${envName || ctx.environment_code}${ctx.location_module ? ` · ${bt(ctx.location_module)}` : ""}` }) }
      : { cls: "local", text: T.syncLocal, help: hasCtx ? fmt(T.syncLocalHelpCtx, { name: envName || ctx.environment_code }) : T.syncLocalHelp };
  const profName = bt(envState.profiles && envState.profiles[env.code]);
  const help = fmt(T.envHelp, { label: env.label, loc: env.locationModule, prof: profName ? ` (${profName})` : "", sync: sync.help });
  return `<div class="av-st av-st-env" title="${esc(help)}">
      <span class="av-st-envhead"><label class="av-lbl" for="av-env-select">${esc(T.envLabel)}</label><span class="av-env-sync av-env-sync-${sync.cls}" aria-hidden="true">SIM · ${sync.text}</span></span>
      <select id="av-env-select" class="av-input av-env-select" aria-describedby="av-env-help" ${envState.pending ? 'aria-busy="true"' : ""}>
        ${CREW_ENVIRONMENTS.map((e) => `<option value="${e.key}" ${e.key === env.key ? "selected" : ""}>${esc(e.label)}</option>`).join("")}
      </select>
      <span id="av-env-help" class="av-env-help">${esc(fmt(T.envSrHelp, { sync: sync.help }))}</span>
    </div>`;
}

function alarmBarHTML(alerts) {
  const T = tt();
  const top = alerts.find((a) => isAlarm(a.cls) && !a.acked);
  if (!top) {
    const inAlarm = alerts.filter((a) => isAlarm(a.cls)).length;
    return `<div class="av-alarm av-alarm-quiet" role="status"><span>${esc(T.alarmQuiet)}</span><span>${esc(T.inAlarm)} <span class="av-mono">${inAlarm}</span></span></div>`;
  }
  const canProc = top.indicator || top.hera;
  // HERA en refugio (WARNING): naranja rojizo; el rojo queda para la emergencia
  const shelter = top.hera && top.heraLevel === "WARNING";
  return `
  <div class="av-alarm av-alarm-${top.cls}${shelter ? " av-alarm-shelter" : ""}" role="alert">
    <span class="av-badge" style="background:currentColor" title="${esc(STATE_WORD[top.cls])}"><span style="color:${shelter ? "#E8541C" : top.cls === "W" ? "#D13438" : "#F2C94C"}">${top.cls}</span></span>
    <strong style="letter-spacing:.04em;text-transform:uppercase">${esc(top.msg)}</strong>
    <span class="av-mono">${esc(top.detail)}</span>
    <span class="av-mono">${top.t ? gmt(top.t, false) : ""}</span>
    <span style="flex:1 1 0"></span>
    ${canProc ? `<button type="button" class="av-btn" data-act="${top.hera ? "view-radiation" : "open-indicator"}" data-code="${esc(top.indicator || "")}">${esc(T.viewProcedure)}</button>` : ""}
    <button type="button" class="av-btn" data-act="ack" data-alert="${esc(top.id)}">${esc(T.ackFull)}</button>
  </div>`;
}

/* ───────────────────────── resumen ───────────────────────── */

function radCardHTML(d) {
  const lvl = hera.level;
  const cur = heraCurrent();
  const frac = Math.min(1, d.career / CAREER_LIMIT_MSV);
  const radLetter = d.radCard ? LETTER[d.radCard.state] || "M" : "M";
  const heraLetter = HERA_LETTER[lvl];
  const cardCls = RANK[heraLetter] >= 2 ? `av-card-${heraLetter}` : "";
  const T = tt();
  return `<article class="av-panel av-card ${cardCls}" id="av-p1-rad">
    <div class="av-card-head"><h3 class="av-h3">${esc(T.radiation)}</h3>${badge(heraLetter !== "N" ? heraLetter : radLetter === "S" ? "S" : RANK[radLetter] > 0 ? radLetter : "N")}</div>
    <div><span class="av-big">${num(d.career, 1)}</span> <span class="av-sub">${esc(T.careerOf)}</span></div>
    <div class="av-bar" role="img" aria-label="${esc(fmt(T.careerAria, { pct: num(frac * 100, 1) }))}"><span style="width:${(frac * 100).toFixed(2)}%"></span></div>
    <div class="av-sub">${esc(T.missionDose)} <span class="av-mono" style="color:var(--av-text)">${num(d.missionDose, 2)} mSv</span> · ${esc(T.dailyRate)} <span class="av-mono" style="color:var(--av-text)">${esc(cardValue(d.radCard))} mSv/d</span></div>
    <div class="av-sub">HERA <span class="av-mono" style="color:var(--av-text)">${num(cur.v, cur.v < 10 ? 2 : 0)} µGy/min</span> · ${esc(HERA_TEXT[lvl].short)}</div>
    <div class="av-foot" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <span>${esc(T.noCareerHistory)}</span>
      <button type="button" class="av-btn av-btn-sm" data-act="view-radiation">${esc(T.open)}</button>
    </div>
  </article>`;
}

function summaryHTML(appState, d, data, alerts) {
  const spo2 = d.card("SPO2");
  const ppo2 = d.envParam("PPO2");
  const press = d.envParam("CABIN_PRESSURE");
  const sleep = d.sleepCard;
  const co2 = d.co2;
  const T = tt();
  const p1 = `
  <section aria-label="${esc(T.p1Aria)}">
    <div class="av-lbl" style="margin:0 0 6px 2px">${esc(T.p1Label)}</div>
    <div class="av-cards av-cards-3x2">
      ${radCardHTML(d)}
      <article class="av-panel av-card ${RANK[d.co2Letter] >= 2 ? `av-card-${d.co2Letter}` : ""}">
        <div class="av-card-head"><h3 class="av-h3">${esc(T.co2Title)}</h3>${badge(d.co2Letter)}</div>
        <div><span class="av-big">${co2 ? num(co2.value, 1) : "—"}</span> <span class="av-sub">mmHg</span></div>
        <div class="av-sub">${esc(T.limits)} <span class="av-mono" style="color:var(--av-y)">Y ${num(2.8, 1)}</span> · <span class="av-mono" style="color:var(--av-r-text)">R ${num(3, 1)}</span> ${esc(T.co2Avg)}</div>
        <div class="av-sub">${esc(co2 && RANK[d.co2Letter] >= 2 ? T.co2Act : T.co2Ok)}</div>
        <div class="av-foot">${co2 ? `${esc(co2.source_code || T.habitat)} · <span class="av-mono">${gmt(toDate(co2.measured_at), false)}</span>` : esc(T.noHabitatData)}</div>
      </article>
      <article class="av-panel av-card ${spo2 && RANK[LETTER[spo2.state]] >= 2 ? `av-card-${LETTER[spo2.state]}` : ""}">
        <div class="av-card-head"><h3 class="av-h3">SpO₂</h3>${badge(spo2 ? LETTER[spo2.state] || "M" : "M")}</div>
        <div><span class="av-big">${spo2 ? esc(bt(spo2.display_value)) : "—"}</span> <span class="av-sub">%</span></div>
        <div class="av-sub">${esc(T.limits)} ${esc(limitsText(ruleOf(appState, "SPO2"), "Y"))} · ${esc(limitsText(ruleOf(appState, "SPO2"), "R"))}</div>
        <div class="av-sub">${esc(T.atmosphere)} ${press ? `<span class="av-mono" style="color:var(--av-text)">${num(press.value, 1)} ${esc(bt(press.unit || ""))}</span>` : "—"}${ppo2 ? ` · ppO₂ <span class="av-mono" style="color:var(--av-text)">${num(ppo2.value, 1)} ${esc(bt(ppo2.unit || ""))}</span>` : ""}</div>
        <div class="av-foot">${spo2 && spo2.measured_at ? `${esc(spo2.source_code || "")} · <span class="av-mono">${gmt(toDate(spo2.measured_at), false)}</span>` : esc(T.noMeasurement)}</div>
      </article>
      <article class="av-panel av-card ${RANK[d.weekLetter] >= 2 ? `av-card-${d.weekLetter}` : ""}">
        <div class="av-card-head"><h3 class="av-h3">${esc(T.exerciseTitle)}</h3>${badge(d.weekLetter)}</div>
        <div><span class="av-big">${num(d.weekMin)}</span> <span class="av-sub">/ ${WEEKLY_EXERCISE_MIN} min</span></div>
        <div class="av-bar" role="img" aria-label="${esc(fmt(T.weeklyGoalAria, { pct: num((d.weekMin / WEEKLY_EXERCISE_MIN) * 100) }))}"><span style="width:${Math.min(100, (d.weekMin / WEEKLY_EXERCISE_MIN) * 100).toFixed(1)}%"></span></div>
        <div class="av-sub">${esc(T.today)} <span class="av-mono" style="color:var(--av-text)">${esc(cardValue(d.card("PHYSICAL_ACTIVITY")))} min</span> · ${esc(T.issGoal)}</div>
        <div class="av-foot">${esc(T.exerciseFoot)}</div>
      </article>
      <article class="av-panel av-card ${RANK[d.debtLetter] >= 2 ? `av-card-${d.debtLetter}` : ""}">
        <div class="av-card-head"><h3 class="av-h3">${esc(T.sleepTitle)}</h3>${badge(RANK[d.debtLetter] >= RANK[LETTER[sleep?.state] || "N"] ? d.debtLetter : LETTER[sleep.state])}</div>
        <div><span class="av-big">${esc(cardValue(sleep))}</span> <span class="av-sub">/ ${num(PROGRAMMED_SLEEP_H, 1)} ${esc(T.programmedH)}</span></div>
        <div class="av-sub">${esc(T.debt3)} <span class="av-mono" style="color:${d.debtLetter === "N" ? "var(--av-text)" : "var(--av-y)"};font-weight:600">${num(d.sleepDebt, 1)} h</span> · ${esc(T.limitWord)} <span class="av-mono" style="color:var(--av-y)">Y 2 h</span> ${esc(T.demo)}</div>
        ${d.debtLetter !== "N" ? `<div class="av-sub" style="color:var(--av-text)">${esc(T.sleepAdvice)}</div>` : ""}
        <div><button type="button" class="av-btn av-btn-sm" data-nav="wellbeing-hub">${esc(T.openWellbeing)}</button></div>
        <div class="av-foot">${sleep && sleep.measured_at ? `${esc(sleep.source_code || "")} · <span class="av-mono">${gmt(toDate(sleep.measured_at), false)}</span>` : esc(T.noRecord)}</div>
      </article>
      ${alertsCardHTML(alerts)}
    </div>
  </section>`;

  // tabla
  const regionMap = {};
  (data.regions || []).forEach((r) => { regionMap[r.code] = r; });
  const filterCodes = consoleState.sys && regionMap[consoleState.sys] ? regionMap[consoleState.sys].indicator_codes || [] : null;
  const rows = d.cards
    .filter((c) => !filterCodes || filterCodes.includes(c.indicator_code))
    .map((c) => ({ c, l: LETTER[c.state] || "M" }))
    .sort((a, b) => RANK[b.l] - RANK[a.l]);
  const rowOf = ({ c, l }) => {
    const rule = ruleOf(appState, c.indicator_code);
    const alarm = isAlarm(l);
    const valCls = alarm ? `av-val-${l}` : l === "S" ? "av-val-S" : "";
    return `<tr class="${alarm ? "av-row-alarm" : ""}">
      <th scope="row" style="padding:0 12px;font-weight:500"><button type="button" class="av-link-row" data-act="open-indicator" data-code="${esc(c.indicator_code)}">${esc(bt(c.name))}</button></th>
      <td class="av-num"><span class="${valCls}">${esc(cardValue(c))}</span></td>
      <td class="av-sub" style="padding:0 4px">${esc(bt(c.unit || ""))}</td>
      <td>${badge(l, `${STATE_WORD[l]}${c.trend_label ? " · " + bt(c.trend_label) : ""}`)}</td>
      <td class="av-mono av-sub">${esc(limitsText(rule, "Y"))}</td>
      <td class="av-mono av-sub">${esc(limitsText(rule, "R"))}</td>
      <td class="av-mono" style="font-size:13px;padding-right:12px;color:${l === "S" ? "var(--av-s)" : "var(--av-text2)"}">${c.measured_at ? gmt(toDate(c.measured_at), false) : "—"}${l === "S" && c.age_hours ? ` · ${num(c.age_hours, 0)} h` : ""}</td>
    </tr>`;
  };
  // Por defecto solo se ven las filas no nominales (cualquier estado con letra: A, C, W, S, M, I);
  // las nominales (N) van en una sección plegable debajo.
  const offRows = rows.filter((r) => r.l !== "N");
  const nomRows = rows.filter((r) => r.l === "N");
  const nomN = nomRows.length;
  const nomLabel = nominalOpen
    ? (nomN === 1 ? T.nominalHideOne : fmt(T.nominalHide, { n: nomN }))
    : (nomN === 1 ? T.nominalShowOne : fmt(T.nominalShow, { n: nomN }));
  const rowHTML = !rows.length ? "" : `${offRows.map(rowOf).join("")}${!offRows.length ? `
    <tr class="av-allnom-row"><td colspan="7"><span class="av-badge av-b-N" aria-hidden="true">–</span> ${esc(T.allNominal)}</td></tr>` : ""}${nomN ? `
    <tr class="av-nom-toggle-row"><td colspan="7"><button type="button" class="av-nom-toggle" data-act="toggle-nominal" data-focus-id="nom-toggle" aria-expanded="${nominalOpen}" aria-controls="av-nom-rows"><span>${esc(nomLabel)}</span> <span class="av-nom-caret" aria-hidden="true">▾</span></button></td></tr>` : ""}`;
  const nomBody = nomN ? `<tbody id="av-nom-rows" class="av-nom-rows"${nominalOpen ? "" : " hidden"}>${nomRows.map(rowOf).join("")}</tbody>` : "";
  const table = `
  <section class="av-panel av-table-panel" aria-label="${esc(T.tableTitle)}">
    <div class="av-panel-head">
      <h2 class="av-h2">${esc(T.tableTitle)}</h2>
      ${filterCodes ? `<button type="button" class="av-btn av-btn-sm" data-act="clear-sys" aria-label="${esc(fmt(T.clearFilterAria, { name: SYS_NAMES[consoleState.sys] || consoleState.sys }))}">${esc(fmt(T.filter, { name: SYS_NAMES[consoleState.sys] || consoleState.sys }))} <span aria-hidden="true">×</span></button>` : ""}
    </div>
    <div class="av-hscroll" tabindex="0" role="region" aria-label="${esc(T.tableAria)}">
      <table class="av-table" style="min-width:600px">
        <thead><tr><th scope="col" style="padding-left:12px">${esc(T.thParam)}</th><th scope="col" style="text-align:right">${esc(T.thValue)}</th><th scope="col">${esc(T.thUnit)}</th><th scope="col">${esc(T.thState)}</th><th scope="col">${esc(T.thLimY)}</th><th scope="col">${esc(T.thLimR)}</th><th scope="col" style="padding-right:12px">GMT</th></tr></thead>
        <tbody>${rowHTML || `<tr><td colspan="7" class="av-sub" style="padding:12px">${esc(T.noIndicatorsFilter)}</td></tr>`}</tbody>${nomBody}
      </table>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px 16px;padding:8px 12px;border-top:1px solid var(--av-border)" class="av-sub">
      <span>${badge("C")} ${esc(STATE_LEGEND.C)}</span><span>${badge("W")} ${esc(STATE_LEGEND.W)}</span>
      <span>${badge("A")} ${esc(STATE_LEGEND.A)}</span><span>${badge("S")} ${esc(STATE_WORD.S)}</span><span>${badge("M")} ${esc(STATE_WORD.M)}</span>
    </div>
  </section>`;

  // "Seguimiento periódico" (NASA IMM) se movió a la Bitácora: views/logbook-followup.js
  return `<div class="av-grid av-grid-sum">
    ${systemsHTML(appState, data, d)}
    <main class="av-col-b">${p1}${table}</main>
    ${rightColHTML(appState, d, data, alerts)}
  </div>`;
}

/* ───── Mapa corporal interactivo (Resumen) ─────
 * Cada zona de la figura es una región del API (mismo catálogo que BODY_REGIONS_CATALOG del
 * backend; si el API no devuelve la región, se usan estos indicadores). Solo figura y esqueleto
 * simplificado: no se dibujan órganos porque no hay datos de órganos.
 *  zone: etiqueta corta en la figura (lbl: l/b = a la izquierda / debajo del anillo) · side: columna de la métrica lateral (L/R)
 *  metric: indicador principal de la métrica lateral (WEEK_EXERCISE = ejercicio de 7 días, derivado) */
/* zone / metricLbl / desc: textos por idioma (getters) */
const ZONE_TEXT = {
  es: {
    HEAD_BRAIN: { zone: "NEURO", metricLbl: "Sueño", desc: "Sueño y fatiga percibida: base del rendimiento cognitivo en misión." },
    HEART_CARDIO: { zone: "CARDIO", metricLbl: "Pulso", desc: "Pulso y presión arterial ante el desplazamiento de fluidos en microgravedad." },
    MUSCLES: { zone: "ACTIV.", metricLbl: "Actividad", desc: "Actividad física y fatiga: contramedida contra la atrofia muscular." },
    DIGESTIVE_NUTRITION: { zone: "METAB.", metricLbl: "Hidrat.", desc: "Hidratación y glucosa; el agua protege el riñón del calcio que libera el hueso." },
    SKIN_THERMO: { zone: "PIEL", metricLbl: "Temp.", desc: "Temperatura corporal e hidratación de la piel." },
    BONES_SKELETAL: { zone: "ÓSEO", metricLbl: "Carga 7 d", desc: "Sin medición directa de densidad ósea: se vigilan la carga de ejercicio y la hidratación." },
  },
  en: {
    HEAD_BRAIN: { zone: "NEURO", metricLbl: "Sleep", desc: "Sleep and perceived fatigue: the basis of cognitive performance in flight." },
    HEART_CARDIO: { zone: "CARDIO", metricLbl: "Pulse", desc: "Pulse and blood pressure under the fluid shift of microgravity." },
    MUSCLES: { zone: "ACTIV.", metricLbl: "Activity", desc: "Physical activity and fatigue: countermeasure against muscle atrophy." },
    DIGESTIVE_NUTRITION: { zone: "METAB.", metricLbl: "Hydr.", desc: "Hydration and glucose; water protects the kidneys from the calcium released by bone." },
    SKIN_THERMO: { zone: "SKIN", metricLbl: "Temp.", desc: "Body temperature and skin hydration." },
    BONES_SKELETAL: { zone: "BONE", metricLbl: "Load 7 d", desc: "No direct bone density measurement: exercise load and hydration are tracked instead." },
  },
};
const BODY_ZONES = [
  { code: "HEAD_BRAIN", side: "L", metric: "SLEEP_DURATION", codes: ["SLEEP_DURATION", "PERCEIVED_FATIGUE"] },
  { code: "HEART_CARDIO", side: "L", metric: "HEART_RATE", codes: ["HEART_RATE", "BLOOD_PRESSURE"] },
  { code: "MUSCLES", lbl: "b", side: "L", metric: "PHYSICAL_ACTIVITY", codes: ["PHYSICAL_ACTIVITY", "PERCEIVED_FATIGUE"] },
  { code: "DIGESTIVE_NUTRITION", side: "R", metric: "HYDRATION", codes: ["HYDRATION", "BLOOD_GLUCOSE"] },
  { code: "SKIN_THERMO", lbl: "l", side: "R", metric: "BODY_TEMP", codes: ["BODY_TEMP", "HYDRATION"] },
  { code: "BONES_SKELETAL", side: "R", metric: "WEEK_EXERCISE", codes: ["PHYSICAL_ACTIVITY", "HYDRATION"] },
].map((z) => withText(z, ZONE_TEXT, z.code));
const ZONE_BY_CODE = Object.fromEntries(BODY_ZONES.map((z) => [z.code, z]));
const FIG_W = 210; // px: ancho fijo de la figura en el mapa (en escritorio)
const FIG_H = Math.round((FIG_W * 1440) / 660);

const hasValue = (c) => !!c && c.latest_value !== null && c.latest_value !== undefined;

function ageText(h) {
  if (h === null || h === undefined || Number.isNaN(Number(h))) return "";
  const v = Number(h);
  const T = tt();
  if (v < 1) return fmt(T.agoMin, { n: Math.max(1, Math.round(v * 60)) });
  if (v < 48) return fmt(T.agoH, { n: num(v, v < 10 ? 1 : 0) });
  return fmt(T.agoD, { n: num(v / 24, 0) });
}

function regionOf(data, code) {
  return (data.regions || []).find((r) => r.code === code) || null;
}
function regionCodes(data, code) {
  const r = regionOf(data, code);
  return r && Array.isArray(r.indicator_codes) && r.indicator_codes.length ? r.indicator_codes : (ZONE_BY_CODE[code]?.codes || []);
}
/* Estado de la región: el del API; si no llegó, el peor de sus indicadores */
function regionLetter(data, d, code) {
  const r = regionOf(data, code);
  if (r) return LETTER[r.region_state] || "M";
  const ls = regionCodes(data, code).map((ic) => {
    const c = d.card(ic);
    return hasValue(c) ? LETTER[c.state] || "M" : "M";
  });
  if (!ls.length) return "M";
  const worst = ls.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "N");
  if (RANK[worst] > 0) return worst;
  return ls.every((l) => l === "M" || l === "S") ? "M" : "N";
}

function weekHasData(d, data) {
  return (data.act || []).some((p) => p.value !== null && p.value !== undefined && !p.is_gap_marker && d.now - new Date(p.measured_at) <= 7 * 86400000);
}
/* Valor de la métrica lateral de una zona (null = sin datos; nunca se inventa) */
function zoneMetric(z, d, data) {
  if (z.metric === "WEEK_EXERCISE") {
    return weekHasData(d, data) ? { value: num(d.weekMin), unit: "min", l: d.weekLetter } : { value: null, unit: "", l: "M" };
  }
  const c = d.card(z.metric);
  return hasValue(c) ? { value: cardValue(c), unit: bt(c.unit || ""), l: LETTER[c.state] || "M" } : { value: null, unit: "", l: "M" };
}

/* Ficha de región (#av-bodypop): popover anclado a la zona o métrica lateral que lo abrió.
 * Sale al lado de la figura (nunca encima del cuerpo), con una flecha que apunta a la zona. */
const POP_GAP = 12; // separación entre la figura (o la métrica) y la ficha
const POP_MARGIN = 8; // margen mínimo con los bordes de la ventana y con el encabezado
const POP_ARROW_Y = 30; // posición preferida de la flecha desde el borde superior de la ficha
const POP_ARROW_PAD = 16; // la flecha nunca se acerca más que esto a las esquinas
const POP_MIN_W = 260; // con menos sitio a ambos lados, la ficha pasa a hoja inferior
const POP_SHEET_MQ = "(max-width: 650px)";
const popWrap = (inner) => `<div class="av-pop-body">${inner}</div><span class="av-pop-arrow" aria-hidden="true"></span>`;
function closeBodyPop(pop) {
  pop.hidden = true;
  pop.className = "av-pop";
  ["data-pop-region", "data-anchor", "data-pinned", "data-side"].forEach((a) => pop.removeAttribute(a));
  pop.innerHTML = "";
}

/* Contenido de la ficha de una región: lecturas reales (valor, unidad, hora, antigüedad, estado, fuente) */
function bodyPopInner(appState, d, data, code, pinned) {
  const z = ZONE_BY_CODE[code];
  if (!z) return "";
  const r = regionOf(data, code);
  const l = regionLetter(data, d, code);
  const T = tt();
  const withData = [];
  const rows = regionCodes(data, code).map((ic) => {
    const c = d.card(ic);
    const name = bt(c?.name || ruleOf(appState, ic)?.name) || ic;
    if (!hasValue(c)) {
      return `<li><button type="button" class="av-pop-row" data-act="open-indicator" data-code="${esc(ic)}">
        <span class="av-pop-name">${esc(name)}</span><span class="av-pop-val">${esc(T.noData)}</span>${badge("M")}
        <span class="av-pop-meta">${c?.sensor_offline ? esc(T.sensorOffline) : ""}${esc(STATE_WORD.M)} · ${esc(T.seeDetail)}</span></button></li>`;
    }
    withData.push(c);
    const cl = LETTER[c.state] || "M";
    const valCls = isAlarm(cl) ? `av-val-${cl}` : cl === "S" ? "av-val-S" : "";
    const meta = [
      STATE_WORD[cl],
      c.measured_at ? `GMT ${gmt(toDate(c.measured_at), false)}` : "",
      ageText(c.age_hours),
      c.source_code && c.source_code !== "NONE" ? c.source_code : "",
    ].filter(Boolean);
    return `<li><button type="button" class="av-pop-row" data-act="open-indicator" data-code="${esc(ic)}">
      <span class="av-pop-name">${esc(name)}</span>
      <span class="av-pop-val av-mono"><span class="${valCls}">${esc(cardValue(c))}</span> <span class="av-pop-unit">${esc(bt(c.unit || ""))}</span></span>
      ${badge(cl, `${STATE_WORD[cl]}${c.trend_label ? " · " + bt(c.trend_label) : ""}`)}
      <span class="av-pop-meta">${meta.map(esc).join(" · ")} · ${esc(T.seeDetail)}</span></button></li>`;
  });
  if (z.metric === "WEEK_EXERCISE") {
    rows.unshift(weekHasData(d, data)
      ? `<li class="av-pop-row av-pop-static"><span class="av-pop-name">${esc(T.week7)}</span>
          <span class="av-pop-val av-mono">${num(d.weekMin)} <span class="av-pop-unit">/ ${WEEKLY_EXERCISE_MIN} min</span></span>${badge(d.weekLetter)}
          <span class="av-pop-meta">${esc(STATE_WORD[d.weekLetter])} · ${esc(T.week7Meta)}</span></li>`
      : `<li class="av-pop-row av-pop-static"><span class="av-pop-name">${esc(T.week7)}</span><span class="av-pop-val">${esc(T.noData)}</span>${badge("M")}
          <span class="av-pop-meta">${esc(STATE_WORD.M)} · ${esc(T.week7None)}</span></li>`);
  }
  const uniq = (arr) => [...new Set(arr.filter((x) => x && x !== "NONE"))];
  const src = uniq(withData.map((c) => c.source_code));
  const qual = uniq(withData.map((c) => c.data_quality));
  const regAlerts = r?.active_alerts || [];
  const alertL = classFromRank(Math.max(1, ...regAlerts.map((a) => RANK[alertClassOf(a.operational_state)])));
  return `
    <div class="av-pop-head"><span class="av-pop-zone">${esc(z.zone)}</span>${badge(l)}<span class="av-pop-state">${esc(STATE_WORD[l])}</span></div>
    <h3 class="av-pop-title" id="av-pop-title" tabindex="-1">${esc(bt(r?.name) || SYS_NAMES[code] || code)}</h3>
    <p class="av-pop-desc">${esc(z.desc)}</p>
    <ul class="av-pop-list" role="list">${rows.join("")}</ul>
    ${regAlerts.length ? `<p class="av-pop-alerts">${badge(alertL)} ${regAlerts.length} ${esc(regAlerts.length === 1 ? T.alertOne : T.alertMany)} ${esc(T.inRegion)}</p>` : ""}
    <div class="av-pop-foot">${esc(fmt(T.popSource, { src: src.join(", ") || T.noDataLower, q: qual.join(", ") || "—" }))}</div>
    ${pinned
      ? `<div class="av-pop-actions"><span class="av-sub">${r ? esc(T.tableFiltered) : ""}</span><button type="button" class="av-btn av-btn-sm" data-act="pop-close">${esc(T.close)}</button></div>`
      : `<div class="av-pop-hint">${esc(T.popHint)}</div>`}`;
}

const pinnedRegion = () => (consoleState.pop && consoleState.pop === consoleState.sys && ZONE_BY_CODE[consoleState.pop] ? consoleState.pop : null);

/* Rellena la ficha (#av-bodypop) sin repintar la vista y la coloca junto a su ancla.
 * anchorId: data-focus-id de la zona o métrica que la abre (por defecto, la que la fijó o la zona). */
function fillBodyPop(container, code, anchorId) {
  const pop = container.querySelector("#av-bodypop");
  if (!pop || !ZONE_BY_CODE[code]) return;
  const { appState: st } = container.__avCtx;
  const data = dataFor(st);
  const d = derive(st, data);
  const pinned = pinnedRegion() === code;
  pop.hidden = false;
  pop.className = `av-pop av-pop-${regionLetter(data, d, code)}`;
  pop.setAttribute("data-pop-region", code);
  pop.setAttribute("data-pinned", String(pinned));
  pop.setAttribute("data-anchor", (pinned && consoleState.popFrom) || anchorId || `hot-${code}`);
  pop.innerHTML = popWrap(bodyPopInner(st, d, data, code, pinned));
  placeBodyPop(container);
}

/* Coloca la ficha (position: fixed) con coordenadas de ventana calculadas desde su ancla:
 *  - a la derecha de la figura (o de la métrica derecha que la abrió); si no cabe, a la izquierda;
 *  - alineada en vertical con la zona y acotada entre el encabezado fijo y el borde inferior;
 *  - más alta que el hueco visible: se limita su alto y el contenido se desplaza por dentro;
 *  - en móvil, o si no cabe a ningún lado, hoja fija al borde inferior de la ventana.
 * root: contenedor de la vista (o document). Se llama al abrir, repintar, desplazar y redimensionar. */
function placeBodyPop(root) {
  const pop = root.querySelector("#av-bodypop");
  if (!pop || pop.hidden) return;
  const map = pop.closest(".av-bodymap");
  const fig = map?.querySelector(".av-figure");
  const code = pop.getAttribute("data-pop-region");
  const byId = (id) => (id ? map.querySelector(`[data-focus-id="${id}"]`) : null);
  const hot = fig && byId(`hot-${code}`);
  const opener = fig && (byId(pop.getAttribute("data-anchor")) || hot);
  const body = pop.querySelector(".av-pop-body");
  if (!fig || !opener || !body) return;

  // el encabezado global cambia de alto (barra HERA, alarmas, ancho): la ficha lo sigue
  const chrome = document.getElementById("av-chrome");
  if (chrome && placeBodyPop.chrome !== chrome && "ResizeObserver" in window) {
    placeBodyPop.ro?.disconnect();
    placeBodyPop.chrome = chrome;
    placeBodyPop.ro = new ResizeObserver(() => placeBodyPop(document));
    placeBodyPop.ro.observe(chrome);
  }

  const s = pop.style;
  s.left = ""; s.top = ""; s.width = ""; body.style.maxHeight = "";
  pop.classList.remove("av-pop-sheet");
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const f = fig.getBoundingClientRect();
  const o = opener.getBoundingClientRect();
  const roomR = vw - POP_MARGIN - (Math.max(f.right, o.right) + POP_GAP);
  const roomL = Math.min(f.left, o.left) - POP_GAP - POP_MARGIN;
  if (window.matchMedia(POP_SHEET_MQ).matches || Math.max(roomR, roomL) < POP_MIN_W) {
    pop.classList.add("av-pop-sheet");
    pop.removeAttribute("data-side");
    return;
  }

  // lado: derecha por defecto; una métrica de la columna izquierda prefiere su propio lado si cabe
  const want = pop.offsetWidth;
  const openerLeft = o.right <= f.left + 1;
  const side = openerLeft && roomL >= want ? "left"
    : roomR >= want ? "right"
    : roomL >= want ? "left"
    : roomR >= roomL ? "right" : "left";
  const w = Math.min(want, side === "right" ? roomR : roomL);
  if (w < want) s.width = `${w}px`;
  const left = Math.round(side === "right" ? Math.max(f.right, o.right) + POP_GAP : Math.min(f.left, o.left) - POP_GAP - w);

  // la flecha apunta al ancla; si este queda al otro lado de la figura, a la zona de la región
  const far = side === "right" ? openerLeft : o.left >= f.right - 1;
  const a = far && hot ? hot.getBoundingClientRect() : o;
  const cy = a.top + a.height / 2;
  const minTop = Math.max(0, chrome ? chrome.getBoundingClientRect().bottom : 0) + POP_MARGIN;
  body.style.maxHeight = `${Math.max(140, vh - minTop - POP_MARGIN - 2)}px`;
  const h = pop.offsetHeight;
  // dentro de la ventana mientras la zona se vea; si la zona sale de la vista, la ficha la acompaña
  let top = Math.max(minTop, Math.min(cy - POP_ARROW_Y, vh - POP_MARGIN - h));
  top = Math.round(Math.max(Math.min(top, cy - POP_ARROW_PAD), cy - (h - POP_ARROW_PAD)));
  s.left = `${left}px`;
  s.top = `${top}px`;
  s.setProperty("--av-arrow-y", `${Math.round(cy - top)}px`);
  pop.setAttribute("data-side", side);
  // si algún ancestro crea un bloque contenedor (transform, filter…), "fixed" deja de ser
  // relativo a la ventana: se corrige con la posición realmente medida
  const r = pop.getBoundingClientRect();
  if (Math.abs(r.left - left) > 1 || Math.abs(r.top - top) > 1) {
    s.left = `${left * 2 - r.left}px`;
    s.top = `${top * 2 - r.top}px`;
  }
}

/* Hoja inferior (móvil): al fijar la ficha, la zona pulsada queda visible por encima de ella */
function revealAboveSheet(container, opener) {
  const pop = container.querySelector("#av-bodypop");
  if (!opener || !pop || pop.hidden || !pop.classList.contains("av-pop-sheet")) return;
  opener.style.scrollMarginBottom = `${pop.offsetHeight + 12}px`;
  opener.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/* Vista previa (hover / foco) de una región: resalta zona + métrica lateral y muestra su ficha
 * junto al elemento que la abre (anchorId = su data-focus-id) */
function bodyPreview(container, code, anchorId) {
  if (!ZONE_BY_CODE[code]) return;
  clearTimeout(container.__avPopHide);
  const pop = container.querySelector("#av-bodypop");
  // con el foco dentro de la ficha, el hover no la sustituye (no se pierde el foco)
  if (pop?.contains(document.activeElement)) return;
  container.querySelectorAll(".av-bodymap [data-region].is-hover").forEach((e) => e.classList.remove("is-hover"));
  container.querySelectorAll(`.av-bodymap [data-region="${code}"]`).forEach((e) => e.classList.add("is-hover"));
  if (pop && !pop.hidden && pop.getAttribute("data-pop-region") === code) {
    // misma región: la ficha fijada no se mueve; la vista previa sigue al elemento apuntado
    if (anchorId && pop.getAttribute("data-pinned") !== "true" && pop.getAttribute("data-anchor") !== anchorId) {
      pop.setAttribute("data-anchor", anchorId);
      placeBodyPop(container);
    }
    return;
  }
  fillBodyPop(container, code, anchorId);
}
/* Fin de la vista previa: vuelve a la zona con foco de teclado, a la ficha fijada o se cierra */
function bodyPreviewEnd(container) {
  clearTimeout(container.__avPopHide);
  const f = document.activeElement;
  if (f && container.contains(f)) {
    if (f.closest("#av-bodypop")) return;
    const t = f.closest(".av-bodymap [data-region]");
    // solo el foco visible (teclado) mantiene la vista previa; tras un clic de ratón no se queda abierta
    if (t && t.matches(":focus-visible")) return bodyPreview(container, t.getAttribute("data-region"), t.getAttribute("data-focus-id"));
  }
  container.querySelectorAll(".av-bodymap [data-region].is-hover").forEach((e) => e.classList.remove("is-hover"));
  const pop = container.querySelector("#av-bodypop");
  if (!pop) return;
  const pinned = pinnedRegion();
  if (!pinned) closeBodyPop(pop);
  else if (pop.getAttribute("data-pop-region") !== pinned) fillBodyPop(container, pinned);
}
/* Devuelve el foco tras repintar sin abrir la vista previa por el focusin */
function focusQuiet(container, el) {
  if (!el) return;
  container.__avNoPreview = true;
  el.focus({ preventScroll: true });
  container.__avNoPreview = false;
}

function systemsHTML(appState, data, d) {
  const st = (code) => regionLetter(data, d, code);
  const tone = (l) => l === "W" ? { fill: "#D13438", op: "0.45", stroke: "#FF8A8D" }
    : l === "C" ? { fill: "#F2C94C", op: "0.32", stroke: "#F2C94C" }
    : l === "A" ? { fill: "#1A212B", op: "1", stroke: "#A7B0BD" }
    : { fill: "#1A212B", op: "1", stroke: "#3A4452" };
  const head = tone(st("HEAD_BRAIN"));
  const mus = tone(st("MUSCLES"));
  const skinL = st("SKIN_THERMO");
  const skin = RANK[skinL] > 0 ? tone(skinL).stroke : "#5A6473";
  const boneL = st("BONES_SKELETAL");
  const bone = RANK[boneL] > 0 ? tone(boneL).stroke : "#8B95A3";
  const boneSoft = boneL === "C" ? "rgba(242,201,76,0.16)" : boneL === "W" ? "rgba(209,52,56,0.2)" : "rgba(167,176,189,0.08)";
  const sel = consoleState.sys && FIG_HOTSPOTS[consoleState.sys];
  const L = consoleState.layers;
  const T = tt();
  // zonas sobre la figura: anillo con la letra de estado (nunca solo color) + etiqueta corta
  const hots = BODY_ZONES.map((z) => {
    const p = FIG_HOTSPOTS[z.code];
    if (!p) return "";
    const l = st(z.code);
    const on = consoleState.sys === z.code;
    return `<button type="button" class="av-hot av-hot-${l}" data-act="region" data-region="${z.code}" data-focus-id="hot-${z.code}" aria-pressed="${on}" aria-controls="av-bodypop" aria-label="${esc(`${SYS_NAMES[z.code]} (${z.zone}): ${STATE_WORD[l]}`)}" style="left:${(((p.x + 10) / 660) * 100).toFixed(2)}%;top:${((p.y / 1440) * 100).toFixed(2)}%">
      <span class="av-hot-ring" aria-hidden="true">${l !== "N" ? l : ""}</span><span class="av-hot-lbl${z.lbl ? ` av-hot-lbl-${z.lbl}` : ""}" aria-hidden="true">${esc(z.zone)}</span></button>`;
  }).join("");
  // métricas laterales alineadas con su zona (separación mínima de 56 px para objetivos de 44 px)
  const sideCol = (side) => {
    let prev = -Infinity;
    return BODY_ZONES.filter((z) => z.side === side && FIG_HOTSPOTS[z.code])
      .sort((a, b) => FIG_HOTSPOTS[a.code].y - FIG_HOTSPOTS[b.code].y)
      .map((z) => {
        const top = Math.max(0, Math.round((FIG_HOTSPOTS[z.code].y / 1440) * FIG_H - 26), prev + 56);
        prev = top;
        const m = zoneMetric(z, d, data);
        const on = consoleState.sys === z.code;
        const valTxt = m.value === null ? T.noData : `${m.value} ${m.unit}`.trim();
        return `<button type="button" class="av-side-btn av-side-${m.l}" data-act="region" data-region="${z.code}" data-focus-id="side-${z.code}" aria-pressed="${on}" aria-controls="av-bodypop" aria-label="${esc(`${z.metricLbl}: ${valTxt}, ${STATE_WORD[m.l]}. ${SYS_NAMES[z.code]}`)}" style="top:${top}px">
          <span class="av-side-lbl" aria-hidden="true"><span>${esc(z.metricLbl)}</span>${badge(m.l)}</span>
          <span class="av-side-val" aria-hidden="true">${m.value === null ? `<span class="av-side-none">${esc(T.noData)}</span>` : `${esc(m.value)}<span class="av-side-unit"> ${esc(bt(m.unit))}</span>`}</span></button>`;
      }).join("");
  };
  const pinned = pinnedRegion();
  // popover no modal: oculto hasta que una zona lo abre; paint() lo coloca con placeBodyPop
  const popAttrs = `id="av-bodypop" role="dialog" aria-modal="false" aria-labelledby="av-pop-title"`;
  const pop = pinned
    ? `<div class="av-pop av-pop-${st(pinned)}" ${popAttrs} data-pop-region="${pinned}" data-anchor="${esc(consoleState.popFrom || `hot-${pinned}`)}" data-pinned="true">${popWrap(bodyPopInner(appState, d, data, pinned, true))}</div>`
    : `<div class="av-pop" ${popAttrs} hidden></div>`;
  // La lista completa de sistemas se quitó (issue #3: repetía la figura). Solo quedan, en una fila
  // compacta, los sistemas que no tienen zona en la figura, para no perder el acceso a ellos.
  const others = Object.keys(SYS_NAMES).filter((code) => !FIG_HOTSPOTS[code])
    .sort((a, b) => RANK[st(b)] - RANK[st(a)])
    .map((code) => `<button type="button" class="av-sys-chip" data-act="sys" data-code="${code}" data-focus-id="sys-${code}" aria-pressed="${consoleState.sys === code}">${badge(st(code))}<span>${esc(SYS_NAMES[code])}</span></button>`)
    .join("");
  return `
  <section class="av-panel av-col-a av-col-body" aria-label="${esc(T.sysAria)}">
    <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 class="av-h2">${esc(T.sysTitle)}</h2><span class="av-sub">${esc(T.noColorNominal)}</span></div>
    <div role="group" aria-label="${esc(T.layersAria)}" style="display:flex;gap:6px">
      <button type="button" class="av-btn av-btn-sm" style="flex:1 1 0" data-act="layer" data-layer="mus" data-focus-id="layer-mus" aria-pressed="${L.mus}">${esc(T.muscles)}</button>
      <button type="button" class="av-btn av-btn-sm" style="flex:1 1 0" data-act="layer" data-layer="bon" data-focus-id="layer-bon" aria-pressed="${L.bon}">${esc(T.bones)}</button>
    </div>
    <p class="av-sub" style="margin:0">${esc(T.bodyHint)}</p>
    <div class="av-bodymap">
    <div class="av-figure">
      <svg viewBox="${FIG_VIEWBOX}" aria-hidden="true">
        <ellipse class="av-orbit" cx="320" cy="690" rx="318" ry="104" transform="rotate(-14 320 690)"></ellipse>
        <path class="av-fig-outline" d="${FIG.outline}" fill="#141A22" stroke="${skin}" stroke-width="3" stroke-linejoin="round"></path>
        <path d="${FIG.hair}" fill="#1E2630" stroke="#3A4452" stroke-width="1.5"></path>
        <path d="${FIG.head}" fill="${head.fill}" fill-opacity="${head.op}" stroke="${head.stroke}" stroke-width="2"></path>
        <path d="${FIG.joints}" fill="#1A212B" stroke="#3A4452" stroke-width="1.5"></path>
        <g opacity="${L.mus ? 1 : 0}"><path d="${FIG.muscles}" fill="${mus.fill}" fill-opacity="${mus.op}" stroke="${mus.stroke}" stroke-width="1.5" stroke-linejoin="round"></path></g>
        <g class="av-bones av-bones-${boneL}" opacity="${L.bon ? 1 : 0}" fill="none" stroke="${bone}" stroke-linecap="round" stroke-linejoin="round">
          <path d="${BONES.skull}" stroke-width="5" fill="${boneSoft}"></path>
          <path d="${BONES.spine}" stroke-width="3" fill="${boneSoft}"></path>
          <path d="${BONES.pelvis}" stroke-width="5" fill="${boneSoft}"></path>
          <path d="${BONES.thin}" stroke-width="5"></path>
          <path d="${BONES.long}" stroke-width="13"></path>
          <path d="${BONES.ends}" stroke-width="4" fill="#141A22"></path>
        </g>
        ${sel ? `<circle cx="${sel.x}" cy="${sel.y}" r="46" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-dasharray="10 8"></circle>` : ""}
      </svg>
      ${hots}
    </div>
    <div class="av-side av-side-L" role="group" aria-label="${esc(T.sideL)}">${sideCol("L")}</div>
    <div class="av-side av-side-R" role="group" aria-label="${esc(T.sideR)}">${sideCol("R")}</div>
    ${pop}
    </div>
    ${others ? `<div class="av-sys-chips" role="group" aria-label="${esc(T.otherSystems)}"><span class="av-lbl">${esc(T.otherSystems)}</span>${others}</div>` : ""}
    <p class="av-credits">${esc(T.figCredits)} ${esc(FIG_ATTRIBUTION_I18N[getLang()] || FIG_ATTRIBUTION_I18N.es)}</p>
  </section>`;
}

/* Tarjeta de alertas C&W dentro de la grilla de Prioridad 1 (3×2). El borde toma el color de la
 * alerta más grave sin reconocer, igual que las demás tarjetas; la insignia lleva la letra. */
function alertsCardHTML(alerts) {
  const shown = alerts.filter((a) => consoleState.showAdv || a.cls !== "A");
  const nAdv = alerts.filter((a) => a.cls === "A").length;
  const T = tt();
  const top = alerts.filter((a) => !a.acked).reduce((m, a) => (!m || RANK[a.cls] > RANK[m.cls] ? a : m), null);
  const topL = top ? top.cls : "N";
  const rows = shown.map((a) => `<li class="av-alert-row">
      ${badge(a.cls)}
      <span style="min-width:0"><span style="font-weight:600;display:block">${esc(a.msg)}</span><span class="av-sub">${esc(a.detail)}${a.local ? ` · ${esc(T.onboard)}` : ""}</span></span>
      <span class="av-mono av-sub" style="text-align:right">${a.t ? gmt(a.t, false) : ""}${a.acked ? `<span style="display:block" title="ACK">ACK</span>` : ""}</span>
    </li>`).join("");
  return `<article class="av-panel av-card av-card-alerts ${RANK[topL] >= 2 ? `av-card-${topL}` : ""}" aria-label="${esc(T.cwTitle.replace("&amp;", "&"))}">
    <div class="av-card-head"><h3 class="av-h3">${T.cwTitle}</h3>${badge(topL)}</div>
    <ul class="av-alert-list" role="list">${rows || `<li class="av-sub" style="padding:8px 0">${esc(T.noActiveAlerts)}</li>`}</ul>
    <div class="av-foot"><button type="button" class="av-btn av-btn-sm" data-act="toggle-adv" aria-pressed="${consoleState.showAdv}">${esc(consoleState.showAdv ? T.hideAdv : fmt(T.showAdv, { n: nAdv }))}</button></div>
  </article>`;
}

function rightColHTML(appState, d, data, alerts) {
  const T = tt();
  const missions = (data.missions || []).slice(0, 5);
  const statusTxt = T.taskStatus;
  const tasks = missions.map((m) => {
    const done = m.status_today === "COMPLETED";
    return `<li style="display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid var(--av-row)">
      <span class="av-badge ${done ? "av-b-A" : "av-b-N"}" style="min-width:18px;height:18px">${done ? "✓" : ""}</span>
      <span><span style="font-weight:600;${done ? "color:var(--av-text2)" : ""}">${esc(bt(m.title))}</span><span class="av-sub" style="display:block">${esc(statusTxt[m.status_today] || m.status_today || "")}</span></span>
      <span class="av-mono av-sub">+${esc(m.xp_reward)}</span>
    </li>`;
  }).join("");
  const comm = (d.s.expansion_cards || {}).communication_center || {};
  const unread = Number(comm.unread_messages_count) || 0;
  // mensajes sin leer: el cuadro cambia de color (borde amarillo) como las tarjetas de Prioridad;
  // nunca solo color: la insignia "N sin leer" lo dice en texto
  return `
  <aside class="av-col-c av-col-sum" aria-label="${esc(T.rightAria)}">
    <section class="av-panel av-sum-box">
      <div class="av-panel-head"><h2 class="av-h2">${esc(T.tasksTitle)}</h2><button type="button" class="av-btn av-btn-sm" data-nav="daily-missions">${esc(T.seeAll)}</button></div>
      <ol class="av-sum-scroll" style="list-style:none;margin:0;padding:0">${tasks || `<li class="av-sub" style="padding:12px">${esc(T.noTasks)}</li>`}</ol>
    </section>
    <section class="av-panel av-sum-box av-msg-box${unread > 0 ? " av-card-C av-msg-unread" : ""}">
      <div class="av-panel-head"><h2 class="av-h2">${esc(T.unreadMsgs)}</h2>${unread > 0 ? `<span class="av-badge av-b-C av-pill">${esc(fmt(T.unreadPill, { n: num(unread) }))}</span>` : badge("N")}</div>
      <div class="av-sum-scroll" style="padding:12px;display:flex;flex-direction:column;gap:8px">
        <div><span class="av-big">${num(unread)}</span> <span class="av-sub">${esc(T.surgeonTitle)}</span></div>
        <div style="display:flex;justify-content:space-between" class="av-sub"><span>${esc(T.groundLead)}</span><span>${esc(comm.assigned_leader_name || "—")}</span></div>
        <div style="display:flex;justify-content:space-between" class="av-sub"><span>${esc(T.openSupport)}</span><span class="av-mono">${esc(comm.open_support_requests_count ?? comm.active_support_requests_count ?? 0)}</span></div>
        <p class="av-sub" style="margin:0">${esc(T.offlineNote)}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:auto"><button type="button" class="av-btn av-btn-primary" data-nav="communication-center">${esc(T.openMessages)}</button></div>
      </div>
    </section>
  </aside>`;
}

/* ───────────────────────── detalle de indicador ───────────────────────── */

function indicatorHTML(appState, d, alerts) {
  const code = consoleState.indicator;
  const T = tt();
  const c = d.card(code) || { indicator_code: code, name: code, display_value: T.noData, state: "UNKNOWN", unit: "" };
  const rule = ruleOf(appState, code);
  const r = rule?.rule || {};
  const l = LETTER[c.state] || "M";
  const alert = alerts.find((a) => a.api && a.indicator === code);
  const P = consoleState.proc;
  const stepCls = (n) => (P.step === n ? "av-step av-step-active" : P.step > n ? "av-step av-step-done" : "av-step av-step-todo");
  const stepTag = (n) => (P.step === n ? T.stepCurrent : P.step > n ? T.stepDone : T.stepTodo);
  const howSteps = String(btLines(rule?.step_by_step_instructions) || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const isHyd = code === "HYDRATION";
  const isBP = code === "BLOOD_PRESSURE";
  const rangeTxt = (lo, hi) => (lo === null || lo === undefined ? "—" : `${num(lo, lo % 1 ? 1 : 0)} – ${num(hi, hi % 1 ? 1 : 0)}`);
  return `
  <div style="padding:12px 16px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap" class="av-sub">
    <button type="button" class="av-btn av-btn-sm" data-act="view-summary">${esc(T.backSummary)}</button>
    <span aria-hidden="true">/</span><span style="color:var(--av-text);font-weight:600">${esc(bt(c.name))}</span>
  </div>
  <div class="av-grid">
    <main class="av-col-b">
      <section class="av-panel" style="padding:16px;display:flex;flex-wrap:wrap;gap:16px 32px;align-items:flex-start">
        <div style="flex:1 1 260px;min-width:0">
          <div style="display:flex;align-items:center;gap:10px"><h1 style="margin:0;font-size:22px;font-weight:600">${esc(bt(c.name))}</h1>${badge(l)}</div>
          <div style="margin-top:8px;display:flex;align-items:baseline;gap:8px">
            <span class="av-mono ${isAlarm(l) ? `av-val-${l}` : ""}" style="font-size:44px;font-weight:600;line-height:1">${esc(cardValue(c))}</span>
            <span class="av-sub" style="font-size:18px">${esc(bt(c.unit || ""))}</span>
          </div>
          <div class="av-sub" style="margin-top:8px">${esc(STATE_WORD[l])}${c.trend_label ? ` · ${esc(bt(c.trend_label))}` : ""}</div>
        </div>
        <table class="av-table" style="flex:1 1 320px;width:auto">
          <tbody>
            <tr><th scope="row" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:14px">${esc(T.idealRange)}</th><td class="av-mono" style="text-align:right">${rangeTxt(r.normal_min, r.normal_max)}</td><td class="av-sub">${esc(bt(c.unit || ""))}</td></tr>
            <tr><th scope="row" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:14px">${esc(T.yellowLimit)}</th><td class="av-mono" style="text-align:right;color:var(--av-y)">${esc(limitsText(rule, "Y"))}</td><td class="av-sub">${esc(bt(c.unit || ""))}</td></tr>
            <tr><th scope="row" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:14px">${esc(T.redLimit)}</th><td class="av-mono" style="text-align:right;color:var(--av-r-text)">${esc(limitsText(rule, "R"))}</td><td class="av-sub">${esc(bt(c.unit || ""))}</td></tr>
            <tr><th scope="row" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:14px">${esc(T.lastData)}</th><td class="av-mono" style="text-align:right">${c.measured_at ? gmt(toDate(c.measured_at), false) : "—"}</td><td class="av-sub">GMT</td></tr>
            <tr><th scope="row" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:14px">${esc(T.sourceQuality)}</th><td colspan="2" style="text-align:right">${esc(c.source_code || "—")} · ${esc(c.data_quality || "—")}</td></tr>
          </tbody>
        </table>
      </section>
      <section class="av-panel" style="padding:16px;display:flex;flex-direction:column;gap:8px" aria-label="${esc(T.trendAria)}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px"><h2 class="av-h2">${esc(T.trendTitle)}</h2><span class="av-sub">${esc(T.trendSub)} · ${esc(bt(c.unit || ""))}</span></div>
        <div id="av-ind-chart" class="av-sub">${esc(T.loadingHistory)}</div>
      </section>
      <section class="av-panel" style="padding:16px;display:flex;flex-direction:column;gap:6px" aria-label="${esc(T.explainAria)}">
        <h2 class="av-h2">${esc(T.explainTitle)}</h2>
        <div id="av-ind-explain" class="av-sub">${esc(T.loading)}</div>
      </section>
    </main>
    <aside class="av-panel av-col-c" style="padding:0" aria-label="${esc(T.procAria)}">
      <div style="padding:14px 16px;border-bottom:1px solid var(--av-border)">
        <div class="av-lbl">${esc(T.procedure)} · ${esc(r.rule_code || code)}${r.is_demo_rule ? " · DEMO" : ""}</div>
        <h2 style="margin:4px 0 0;font-size:18px;font-weight:600">${esc(isAlarm(l) ? T.outOfLimit : T.indicatorCheck)}</h2>
        <div style="margin-top:6px;display:flex;align-items:center;gap:10px"><div class="av-bar" style="flex:1"><span style="width:${(Math.min(4, P.step - 1) / 4) * 100}%"></span></div><span class="av-mono" style="font-size:13px">${Math.min(4, P.step - 1)}/4</span></div>
      </div>
      ${alert ? `<div style="padding:12px 16px;border-bottom:1px solid var(--av-border);display:grid;grid-template-columns:72px minmax(0,1fr);gap:6px 10px">
        <span class="av-lbl">${esc(T.alert)}</span><span>${esc(bt(alert.raw.title))}</span>
        <span class="av-lbl">${esc(T.cause)}</span><span>${esc(bt(alert.raw.explanation) || "—")}</span></div>` : ""}
      <ol class="av-steps">
        <li class="${stepCls(1)}">
          <span class="av-lbl">${esc(fmt(T.step, { n: 1 }))} · ${esc(stepTag(1))}</span>
          <div style="font-weight:600;margin:4px 0 8px">${esc(T.step1)}</div>
          ${P.step === 1 ? `${howSteps.length ? `<ol style="margin:0 0 8px;padding-left:18px" class="av-sub">${howSteps.slice(0, 6).map((x) => `<li>${esc(bt(x.replace(/^\d+[.)]\s*/, "")))}</li>`).join("")}</ol>` : ""}
          <button type="button" class="av-btn av-btn-primary" data-act="proc-next">${esc(T.measurementOk)}</button>` : ""}
        </li>
        <li class="${stepCls(2)}">
          <span class="av-lbl">${esc(fmt(T.step, { n: 2 }))} · ${esc(stepTag(2))}</span>
          <div style="font-weight:600;margin:4px 0 8px">${esc(isHyd ? T.step2Hyd : T.step2)}</div>
          ${P.step === 2 ? (isHyd ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <button type="button" class="av-btn" data-act="hyd-add" data-ml="250">+250 mL</button>
              <button type="button" class="av-btn av-btn-primary" data-act="hyd-add" data-ml="500">+500 mL</button>
              <span class="av-sub">${esc(fmt(T.hydNote, { v: cardValue(c) }))}</span></div>`
            : `<form data-form="measure" class="av-form-grid" style="align-items:end">
              <div class="av-field"><label for="av-m-val">${esc(isBP ? T.systolic : T.value)} (${esc(bt(c.unit || ""))})</label><input id="av-m-val" name="value" class="av-input" type="number" step="any" required></div>
              ${isBP ? `<div class="av-field"><label for="av-m-sec">${esc(T.diastolic)}</label><input id="av-m-sec" name="secondary" class="av-input" type="number" step="any" required></div>` : ""}
              <button type="submit" class="av-btn av-btn-primary">${esc(T.register)}</button></form>`) : ""}
          ${P.result ? `<div class="av-sub" role="status" style="margin-top:8px;color:var(--av-text)">${P.result}</div>` : ""}
        </li>
        <li class="${stepCls(3)}">
          <span class="av-lbl">${esc(fmt(T.step, { n: 3 }))} · ${esc(stepTag(3))}</span>
          <div style="font-weight:600;margin:4px 0 8px">${esc(T.step3)}</div>
          ${P.step === 3 ? `<div id="av-ind-action" style="margin-bottom:8px"${alert?.raw?.immediate_action ? "" : ' data-loading="1"'}>${esc(bt(alert?.raw?.immediate_action) || T.loadingRec)}</div>
          <button type="button" class="av-btn av-btn-primary" data-act="proc-next">${esc(T.done)}</button>` : ""}
        </li>
        <li class="${stepCls(4)}">
          <span class="av-lbl">${esc(fmt(T.step, { n: 4 }))} · ${esc(stepTag(4))}</span>
          <div style="font-weight:600;margin:4px 0 8px">${esc(T.step4)}</div>
          ${P.step === 4 ? `<div class="av-sub" style="margin-bottom:8px;color:var(--av-text)">${esc(bt(alert?.raw?.followup_recommendation) || T.followupDefault)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${alert && !alert.acked ? `<button type="button" class="av-btn" data-act="ack" data-alert="${esc(alert.id)}">${esc(T.ackAlert)}</button>` : ""}
            <button type="button" class="av-btn av-btn-primary" data-act="proc-next">${esc(T.closeProc)}</button></div>` : ""}
        </li>
      </ol>
      ${P.step > 4 ? `<div role="status" style="margin:12px 16px 0;padding:10px 12px;border:1px solid var(--av-text2)"><strong>${esc(T.procCompleted)}</strong><div class="av-sub">${esc(T.procSynced)}</div></div>` : ""}
      <div style="margin:12px 16px 16px;padding:12px;border:1px solid var(--av-r-text);display:flex;flex-direction:column;gap:8px">
        <span class="av-lbl" style="color:var(--av-r-text)">${esc(T.escalateIf)}</span>
        <span>${esc(bt(r.escalation_conditions) || T.escalateDefault)}</span>
        ${alert ? `<button type="button" class="av-btn av-btn-danger" style="align-self:flex-start" data-act="escalate" data-alert="${esc(alert.id)}">${esc(T.escalate)}</button>`
          : `<button type="button" class="av-btn av-btn-danger" style="align-self:flex-start" data-nav="communication-center">${esc(T.contactSurgeon)}</button>`}
      </div>
    </aside>
  </div>`;
}

async function loadIndicatorExtras(container, appState) {
  const code = consoleState.indicator;
  const aid = appState.selectedAstronautId;
  const mid = appState.selectedMissionId;
  const [tsR, exR] = await Promise.allSettled([
    apiService.getAnalyticsTimeseries({ astronaut_id: aid, mission_id: mid, indicator_code: code }),
    apiService.explainIndicator(code, aid, mid),
  ]);
  if (consoleState.view !== "indicator" || consoleState.indicator !== code) return;
  const T = tt();
  const chartEl = container.querySelector("#av-ind-chart");
  if (chartEl) chartEl.innerHTML = tsR.status === "fulfilled" ? trendSVG(appState, code, tsR.value) : esc(T.historyFailed);
  const exEl = container.querySelector("#av-ind-explain");
  if (exEl && exR.status === "fulfilled") {
    const e = exR.value;
    exEl.innerHTML = `<p style="margin:0;color:var(--av-text)">${esc(bt(e.plain_explanation) || "")}</p>
      ${e.spaceflight_context ? `<p style="margin:6px 0 0">${esc(bt(e.spaceflight_context))}</p>` : ""}
      ${e.disclaimer ? `<p style="margin:6px 0 0;font-size:11px;color:var(--av-muted)">${esc(bt(e.disclaimer))}</p>` : ""}`;
    const act = container.querySelector("#av-ind-action");
    if (act && act.hasAttribute("data-loading")) { act.textContent = bt(e.recommended_protocol_action) || T.followProtocol; act.removeAttribute("data-loading"); }
  } else if (exEl) exEl.textContent = T.noExplanation;
}

function trendSVG(appState, code, ts) {
  const pts = (ts.points || []).filter((p) => !p.is_gap_marker && p.value !== null);
  const T = tt();
  if (pts.length < 2) return `<span class="av-sub">${esc(T.notEnoughTrend)}</span>`;
  const r = ruleOf(appState, code)?.rule || {};
  const vals = pts.map((p) => Number(p.value));
  const lims = [r.normal_min, r.normal_max, r.monitor_min, r.monitor_max].filter((x) => x !== null && x !== undefined);
  let lo = Math.min(...vals, ...lims);
  let hi = Math.max(...vals, ...lims);
  const padv = (hi - lo) * 0.08 || 1;
  lo -= padv; hi += padv;
  const X0 = 56, X1 = 748, Y0 = 12, Y1 = 220;
  const t0 = new Date(pts[0].measured_at).getTime();
  const t1 = new Date(pts[pts.length - 1].measured_at).getTime();
  const xv = (t) => X0 + 8 + ((t - t0) / (t1 - t0 || 1)) * (X1 - X0 - 16);
  const yv = (v) => Y1 - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (Y1 - Y0);
  const band = (a, b, fill) => (a === null || a === undefined || b === null || b === undefined) ? "" :
    `<rect x="${X0}" y="${yv(Math.max(a, b)).toFixed(1)}" width="${X1 - X0}" height="${Math.max(0, yv(Math.min(a, b)) - yv(Math.max(a, b))).toFixed(1)}" fill="${fill}"></rect>`;
  const hline = (v, color, dash, label) => (v === null || v === undefined || v <= lo || v >= hi) ? "" :
    `<line x1="${X0}" x2="${X1}" y1="${yv(v).toFixed(1)}" y2="${yv(v).toFixed(1)}" stroke="${color}" stroke-width="1.5" ${dash ? `stroke-dasharray="${dash}"` : ""}></line><text x="${X1 - 4}" y="${(yv(v) - 5).toFixed(1)}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="12" fill="${color}">${label}</text>`;
  const dots = pts.map((p) => {
    const l = LETTER[p.state] || "N";
    const fill = l === "W" ? "#D13438" : l === "C" ? "#F2C94C" : "#E6EAF0";
    return `<circle cx="${xv(new Date(p.measured_at).getTime()).toFixed(1)}" cy="${yv(Number(p.value)).toFixed(1)}" r="4" fill="${fill}" stroke="#0E1116" stroke-width="1.5"></circle>`;
  }).join("");
  const ticks = [lo + padv, (lo + hi) / 2, hi - padv].map((v) => `<text x="48" y="${(yv(v) + 4).toFixed(1)}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="12" fill="#A7B0BD">${num(v, Math.abs(hi - lo) < 10 ? 1 : 0)}</text>`).join("");
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 760 248" width="100%" role="img" aria-label="${esc(fmt(T.trendSvgAria, { name: bt(ts.indicator_name) || code, n: pts.length, v: num(last.value, 1), unit: bt(ts.unit || "") }))}">
    ${band(r.normal_min, r.normal_max, "rgba(230,234,240,0.06)")}
    ${hline(r.monitor_min, "#F2C94C", "6 4", `Y ${num(r.monitor_min, r.monitor_min % 1 ? 1 : 0)}`)}
    ${hline(r.monitor_max, "#F2C94C", "6 4", `Y ${num(r.monitor_max, r.monitor_max % 1 ? 1 : 0)}`)}
    ${hline(r.warning_min, "#FF8A8D", "", `R ${num(r.warning_min, r.warning_min % 1 ? 1 : 0)}`)}
    ${hline(r.warning_max, "#FF8A8D", "", `R ${num(r.warning_max, r.warning_max % 1 ? 1 : 0)}`)}
    ${ts.baseline_value !== null && ts.baseline_value !== undefined ? hline(ts.baseline_value, "#5A6473", "2 4", esc(T.baseline)) : ""}
    ${ticks}
    <polyline points="${pts.map((p) => `${xv(new Date(p.measured_at).getTime()).toFixed(1)},${yv(Number(p.value)).toFixed(1)}`).join(" ")}" fill="none" stroke="#E6EAF0" stroke-width="2" stroke-linejoin="round"></polyline>
    ${dots}
    <text x="${X0}" y="242" font-family="IBM Plex Mono, monospace" font-size="11" fill="#8B95A3">${gmt(new Date(t0), false)}</text>
    <text x="${X1}" y="242" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="11" fill="#8B95A3">${gmt(new Date(t1), false)}</text>
  </svg>`;
}

/* ───────────────────────── radiación ───────────────────────── */

const CAD_KEY = (aid) => `av_cad_entries_${aid}`;
function cadEntries(aid) {
  try { return JSON.parse(localStorage.getItem(CAD_KEY(aid)) || "[]"); } catch (e) { return []; }
}
function saveCad(aid, list) {
  try { localStorage.setItem(CAD_KEY(aid), JSON.stringify(list.slice(-50))); return true; } catch (e) { return false; }
}

function meterHTML(title, value, limit, unit, note, marks = []) {
  const frac = limit ? value / limit : 0;
  const l = frac >= 1 ? "W" : frac >= 0.75 ? "C" : frac >= 0.5 ? "A" : "N";
  const fill = l === "W" ? "#D13438" : l === "C" ? "#F2C94C" : "#E6EAF0";
  const marksSvg = marks.map(([v, lab]) => {
    const x = Math.min(200, (v / (limit * 1.2)) * 200);
    return `<line x1="${x}" x2="${x}" y1="4" y2="20" stroke="#A7B0BD" stroke-dasharray="2 2"></line><text x="${x}" y="29" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="8" fill="#A7B0BD">${lab}</text>`;
  }).join("");
  const scale = limit * 1.2;
  return `<div class="av-panel av-card ${isAlarm(l) ? `av-card-${l}` : ""}">
    <div class="av-card-head"><h3 class="av-h3">${title}</h3>${badge(l)}</div>
    <div><span class="av-mono" style="font-size:22px;font-weight:600">${num(value, value < 10 ? 2 : 1)}</span> <span class="av-sub">/ ${num(limit)} ${unit}</span></div>
    <svg viewBox="0 0 200 30" width="100%" height="30" role="img" aria-label="${esc(fmt(tt().meterAria, { title, pct: num(frac * 100, 1) }))}">
      <rect x="0" y="8" width="200" height="8" fill="#0E1116" stroke="#2A313C"></rect>
      <rect x="0" y="8" width="${Math.min(200, (value / scale) * 200).toFixed(1)}" height="8" fill="${fill}"></rect>
      <line x1="${((limit / scale) * 200).toFixed(1)}" x2="${((limit / scale) * 200).toFixed(1)}" y1="2" y2="22" stroke="#FF8A8D" stroke-width="2"></line>
      ${marksSvg}
    </svg>
    <div class="av-sub">${note}</div>
  </div>`;
}

/* ───────────────────────── NOAA GOES (real, vía backend SEMSA) ─────────────────────────
 * GET {SEMSA}/spaceweather/protons/?range=6-hour → flujo integral de protones ≥10 y ≥100 MeV
 * (pfu) y nivel S0–S5. Es flujo de partículas, no dosis: no alimenta los umbrales HERA.
 * URL configurable con localStorage "av_semsa_api". Por defecto: en producción el mismo dominio
 * (nginx reenvía /api/spaceweather/ a SEMSA); en local, Django en el puerto 8001 (el 8000 lo
 * ocupa esta app). */
const SEMSA_API = (() => {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const def = local ? "http://127.0.0.1:8001/api" : "/api";
  try { return localStorage.getItem("av_semsa_api") || def; } catch { return def; }
})();
const NOAA_REFRESH_MS = 5 * 60 * 1000;
const noaa = { data: null, error: null, loading: false, fetchedAt: 0, timer: null };

async function noaaFetch() {
  if (noaa.loading) return;
  noaa.loading = true;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${SEMSA_API}/spaceweather/protons/?range=6-hour`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.series || !Array.isArray(data.series["10mev"])) throw new Error("formato");
    noaa.data = data;
    noaa.error = null;
  } catch (e) {
    noaa.error = e && e.name === "AbortError" ? "timeout" : (e && e.message) || "error";
  } finally {
    noaa.loading = false;
    noaa.fetchedAt = Date.now();
    hera.listeners.forEach((fn) => {
      try { fn(); } catch (err) { /* vista cerrada */ }
    });
  }
}
function noaaEnsure() {
  if (!noaa.timer) noaa.timer = setInterval(noaaFetch, NOAA_REFRESH_MS);
  if (!noaa.fetchedAt && !noaa.loading) noaaFetch();
}

function noaaChartSVG() {
  const toPts = (arr) => (arr || []).map((p) => ({ t: new Date(p.time), v: p.flux })).filter((p) => !Number.isNaN(p.t.getTime()) && p.v > 0);
  const p10 = toPts(noaa.data.series["10mev"]);
  const p100 = toPts(noaa.data.series["100mev"]);
  if (p10.length < 2) return "";
  const X0 = 56, X1 = 748, Y0 = 26, Y1 = 216;
  const lmin = -2, lmax = 5; // 0,01 – 100 000 pfu
  const yv = (v) => Y1 - ((Math.log10(Math.max(1e-2, Math.min(1e5, v))) - lmin) / (lmax - lmin)) * (Y1 - Y0);
  const t0 = p10[0].t.getTime(), t1 = p10[p10.length - 1].t.getTime();
  const xv = (t) => X0 + ((t - t0) / (t1 - t0 || 1)) * (X1 - X0);
  const font = 'font-family="IBM Plex Mono, monospace" font-size="11"';
  const tickLab = { "-2": "0.01", "-1": "0.1", 0: "1", 1: "10", 2: "100", 3: "1k", 4: "10k", 5: "100k" };
  const ticks = [-2, -1, 0, 1, 2, 3, 4, 5].map((e) => `<text x="48" y="${(yv(10 ** e) + 4).toFixed(1)}" text-anchor="end" ${font} fill="#A7B0BD">${tickLab[e]}</text><line x1="${X0}" x2="${X1}" y1="${yv(10 ** e).toFixed(1)}" y2="${yv(10 ** e).toFixed(1)}" stroke="#222934"></line>`).join("");
  const sLines = [[10, "S1", "#F2C94C", "6 4"], [100, "S2", "#F2C94C", ""], [1e3, "S3", "#FF8A8D", "6 4"], [1e4, "S4", "#FF8A8D", ""], [1e5, "S5", "#FF8A8D", "2 3"]]
    .map(([v, lab, c, dash]) => `<line x1="${X0}" x2="${X1}" y1="${yv(v).toFixed(1)}" y2="${yv(v).toFixed(1)}" stroke="${c}" stroke-width="1.2" ${dash ? `stroke-dasharray="${dash}"` : ""}></line><text x="${X1 - 4}" y="${(yv(v) - 4).toFixed(1)}" text-anchor="end" ${font} fill="${c}">${lab}</text>`).join("");
  const poly = (pts, color, w) => (pts.length > 1 ? `<polyline points="${pts.filter((p) => p.t.getTime() >= t0).map((p) => `${xv(p.t.getTime()).toFixed(1)},${yv(p.v).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"></polyline>` : "");
  const T = tt();
  return `<svg viewBox="0 0 760 242" width="100%" role="img" aria-label="${esc(T.noaaChartAria)}">
    ${ticks}
    ${sLines}
    ${poly(p100, "#8B95A3", 1.2)}
    ${poly(p10, "#E6EAF0", 1.6)}
    <text x="8" y="12" ${font} fill="#8B95A3">pfu</text>
    <line x1="${X0}" x2="${X0 + 16}" y1="8" y2="8" stroke="#E6EAF0" stroke-width="1.6"></line><text x="${X0 + 20}" y="12" ${font} fill="#A7B0BD">${esc(T.noaaLegend10)}</text>
    <line x1="${X0 + 96}" x2="${X0 + 112}" y1="8" y2="8" stroke="#8B95A3" stroke-width="1.2"></line><text x="${X0 + 116}" y="12" ${font} fill="#A7B0BD">${esc(T.noaaLegend100)}</text>
    <text x="${X0}" y="236" ${font} fill="#8B95A3">${gmt(p10[0].t, false)}</text>
    <text x="${X1}" y="236" text-anchor="end" ${font} fill="#8B95A3">${gmt(p10[p10.length - 1].t, false)}</text>
  </svg>`;
}

/* Bloque de la gráfica de radiación: durante un evento solar simulado, la tasa HERA (para ver
 * cómo sube y cruza los umbrales); si no, el flujo NOAA real; si SEMSA no responde, HERA. */
function radChartBlock() {
  noaaEnsure();
  const T = tt();
  if (hera.spe) {
    return `<div class="av-lbl" style="margin-top:4px">${esc(T.heraChartSpe)}</div>
        ${heraChartSVG()}`;
  }
  const chart = noaa.data ? noaaChartSVG() : "";
  if (chart) {
    const c = noaa.data.current || {};
    const head = fmt(T.noaaHead, { sat: noaa.data.satellite ?? "—", flux: c.flux_10mev == null ? "—" : num(c.flux_10mev, c.flux_10mev < 10 ? 2 : 0), s: c.s_scale || "—" });
    return `<div class="av-lbl" style="margin-top:4px">${esc(head)}</div>
        ${chart}
        <p class="av-sub" style="margin:0;font-size:12px">${esc(T.noaaNote)}</p>`;
  }
  const status = noaa.error ? fmt(T.noaaOffline, { err: noaa.error }) : T.noaaLoading;
  return `<div class="av-sub" style="font-size:12px">${esc(status)}</div>
        ${heraChartSVG()}`;
}

function heraChartSVG() {
  const pts = hera.history.slice(-360);
  if (pts.length < 2) return "";
  const X0 = 56, X1 = 748, Y0 = 26, Y1 = 216;
  const lmin = Math.log10(0.1), lmax = Math.log10(1000);
  const yv = (v) => Y1 - ((Math.log10(Math.max(0.1, Math.min(1000, v))) - lmin) / (lmax - lmin)) * (Y1 - Y0);
  const t0 = pts[0].t.getTime(), t1 = pts[pts.length - 1].t.getTime();
  const xv = (t) => X0 + ((t - t0) / (t1 - t0 || 1)) * (X1 - X0);
  const line = (v, color, label, dash = "") => `<line x1="${X0}" x2="${X1}" y1="${yv(v).toFixed(1)}" y2="${yv(v).toFixed(1)}" stroke="${color}" stroke-width="1.5" ${dash ? `stroke-dasharray="${dash}"` : ""}></line><text x="${X1 - 4}" y="${(yv(v) - 4).toFixed(1)}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="11" fill="${color}">${label}</text>`;
  const ticks = [0.1, 1, 10, 100, 1000].map((v) => `<text x="48" y="${(yv(v) + 4).toFixed(1)}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="11" fill="#A7B0BD">${num(v, v < 1 ? 1 : 0)}</text><line x1="${X0}" x2="${X1}" y1="${yv(v).toFixed(1)}" y2="${yv(v).toFixed(1)}" stroke="#222934"></line>`).join("");
  return `<svg viewBox="0 0 760 242" width="100%" role="img" aria-label="${esc(fmt(tt().heraChartAria, { n: pts.length }))}">
    ${ticks}
    ${line(HERA_TH.caution, "#F2C94C", esc(tt().thCaution), "6 4")}
    ${line(HERA_TH.warning, "#E8541C", esc(tt().thShelter))}
    ${line(HERA_TH.emergency, "#FF8A8D", esc(tt().thEmergency), "2 3")}
    <polyline points="${pts.map((p) => `${xv(p.t.getTime()).toFixed(1)},${yv(p.v).toFixed(1)}`).join(" ")}" fill="none" stroke="#E6EAF0" stroke-width="1.6" stroke-linejoin="round"></polyline>
    <text x="${X0}" y="236" font-family="IBM Plex Mono, monospace" font-size="11" fill="#8B95A3">${gmt(pts[0].t, false)}</text>
    <text x="${X1}" y="236" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="11" fill="#8B95A3">${gmt(pts[pts.length - 1].t, false)}</text>
    <text x="8" y="12" font-family="IBM Plex Mono, monospace" font-size="11" fill="#8B95A3">µGy/min</text>
  </svg>`;
}

function radLiveInner(d) {
  const cur = heraCurrent();
  const lvl = hera.level;
  const lvlLetter = HERA_LETTER[lvl];
  const env = ENV_BY_KEY[envState.key];
  const T = tt();
  return `      <section class="av-panel ${RANK[lvlLetter] >= 2 ? `av-card-${lvlLetter}` : ""}" style="padding:16px;display:flex;flex-direction:column;gap:10px" aria-label="HERA">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <div class="av-lbl">${esc(fmt(T.heraHead, { n: hera.sensors }))}</div>
            <div style="display:flex;align-items:baseline;gap:10px;margin-top:4px">
              <span class="av-mono" style="font-size:40px;font-weight:600;line-height:1">${num(cur.v, cur.v < 10 ? 2 : 0)}</span><span class="av-sub" style="font-size:16px">µGy/min</span>${badge(lvlLetter)}
              <strong>${esc(HERA_TEXT[lvl].short)}</strong>
            </div>
            <div class="av-sub" style="margin-top:4px">${num((cur.v * 60) / 1000, 3)} mGy/h · ${esc(T.upd)} <span class="av-mono">${gmt(cur.t)}</span> · ${esc(hera.spe ? T.speRunning : heraReal.on ? T.realData : T.simData)}</div>
            ${heraReal.on ? `<div class="av-sub av-rad-env" style="margin-top:2px">${esc(T.envWord)} <strong style="color:var(--av-text)">${esc(env.label)}</strong> · ${esc(heraRealSourceText(T))} · ${esc(T.speFactor)}<span class="av-mono">${num(env.speFactor, 2)}</span></div>` : `<div class="av-sub av-rad-env" style="margin-top:2px">${esc(T.envWord)} <strong style="color:var(--av-text)">${esc(env.label)}</strong> · ${esc(env.note)} · ${esc(T.baselineWord)} <span class="av-mono">${num(hera.baseline, 2)}</span> µGy/min (≈<span class="av-mono">${num(env.refMGyDay * env.shielding, 2)}</span> ${esc(T.perDay)}) · ${esc(T.speFactor)}<span class="av-mono">${num(env.speFactor, 2)}</span> · ${esc(T.simulated)}</div>`}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${hera.spe ? `<button type="button" class="av-btn" data-act="spe-stop">${esc(T.speStop)}</button>` : `<button type="button" class="av-btn" data-act="spe-start">${esc(T.speStart)}</button>`}
          </div>
        </div>
        <p style="margin:0;color:var(--av-text)">${esc(HERA_TEXT[lvl].msg)}</p>
        ${radChartBlock()}
        <p class="av-sub" style="margin:0;font-size:12px">${esc(T.thresholdsNote)}</p>
      </section>`;
}

/* Secciones plegables que dependen de la lectura HERA (refugio y riesgos): se
   repintan en vivo junto con la gráfica, pero dentro de la cuadrícula de secciones. */
function radLiveFolds(d) {
  const lvl = hera.level;
  const lvlLetter = HERA_LETTER[lvl];
  const shelter = HERA_LEVELS.indexOf(lvl) >= 2;
  const bfo30 = d.last30 + d.eventMGyEq;
  const cns30 = d.last30 / 2.6 + d.eventMGy; // mGy (Q≈2,6 medido por HERA en Artemis I para GCR)
  const T = tt();
  return `
      ${shelter ? radFold("shelter", esc(T.shelterTitle), esc(T.procedureDemo), `
        <ol class="av-steps">
          <li class="av-step ${lvl === "CAUTION" ? "av-step-active" : "av-step-done"}">${T.shelter1}</li>
          <li class="av-step ${lvl === "WARNING" ? "av-step-active" : lvl === "EMERGENCY" ? "av-step-done" : "av-step-todo"}">${T.shelter2}</li>
          <li class="av-step ${lvl === "EMERGENCY" ? "av-step-active" : "av-step-todo"}">${T.shelter3}</li>
          <li class="av-step av-step-todo">${T.shelter4}</li>
        </ol>`, `border-color:${lvlLetter === "W" ? "var(--av-r)" : "var(--av-y)"}`) : ""}

      ${radFold("risks", esc(T.risksLabel), "", `
        <div class="av-cards" style="padding:12px 12px 0">
          ${meterHTML(esc(T.mCarcTitle), d.career, CAREER_LIMIT_MSV, "mSv", esc(T.mCarcNote))}
          ${meterHTML(esc(T.mTissueTitle), bfo30, 250, "mGy-Eq", esc(T.mTissueNote))}
          ${meterHTML(esc(T.mCnsTitle), cns30, 500, "mGy", esc(T.mCnsNote))}
          ${meterHTML(esc(T.mArsTitle), d.eventMGyEq, 250, "mGy-Eq", esc(T.mArsNote), [[100, "100"]])}
        </div>
        <p class="av-sub" style="font-size:12px;margin:0;padding:6px 12px 12px">${esc(T.risksNote)}</p>`)}
  `;
}

/* Sección plegable de la vista Radiación (todas menos la gráfica HERA). El estado
   abierto/cerrado vive en consoleState.radFold para sobrevivir al repintado en vivo. */
function radFold(key, title, sub, inner, style = "") {
  const open = consoleState.radFold[key] !== false;
  return `<details class="av-panel av-fold" data-fold="${key}" ${open ? "open" : ""}${style ? ` style="${style}"` : ""}>
        <summary class="av-panel-head av-fold-head" title="${title}${sub ? ` · ${sub}` : ""}"><h2 class="av-h2">${title}</h2>${sub ? `<span class="av-sub">${sub}</span>` : ""}</summary>
        ${inner}
      </details>`;
}

function radiationHTML(appState, d) {
  const cur = heraCurrent();
  const lvl = hera.level;
  const lvlLetter = HERA_LETTER[lvl];
  const aid = appState.selectedAstronautId;
  const entries = cadEntries(aid);
  const lastCad = entries[entries.length - 1];
  const cadAgeH = lastCad ? (Date.now() - new Date(lastCad.utc).getTime()) / 3600000 : null;
  const discrepancy = lastCad && lastCad.rate ? Math.abs(lastCad.rate / 60 - cur.v) / Math.max(cur.v, 0.01) : null; // µGy/h → µGy/min
  const shelter = HERA_LEVELS.indexOf(lvl) >= 2;
  const bfo30 = d.last30 + d.eventMGyEq;
  const cns30 = d.last30 / 2.6 + d.eventMGy; // mGy (Q≈2,6 medido por HERA en Artemis I para GCR)
  const nowIso = new Date().toISOString().slice(0, 16);
  const T = tt();
  const lim = (v) => (v === null ? "—" : num(v));
  const limRow = (label, a, b, c) => `<tr><td>${esc(label)}</td><td class="av-mono" style="text-align:right">${lim(a)}</td><td class="av-mono" style="text-align:right">${lim(b)}</td><td class="av-mono" style="text-align:right">${lim(c)}</td></tr>`;
  return `
  <div class="av-rad">
    <main id="av-rad-live">${radLiveInner(d)}</main>

    <div class="av-rad-folds">
      <div id="av-rad-live-folds" style="display:contents">${radLiveFolds(d)}</div>
      ${radFold("dosimeter", esc(T.dosimeterTitle), esc(T.manualEntry), `
        <form data-form="cad" style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <div class="av-form-grid">
            <div class="av-field"><label for="av-cad-dev">${esc(T.device)}</label><input id="av-cad-dev" name="device" class="av-input" required value="${esc(lastCad?.device || "CAD-0082")}"></div>
            <div class="av-field"><label for="av-cad-utc">${esc(T.readingUtc)}</label><input id="av-cad-utc" name="utc" class="av-input" type="datetime-local" required value="${nowIso}"></div>
            <div class="av-field"><label for="av-cad-mgy">${esc(T.accDose)}</label><input id="av-cad-mgy" name="mgy" class="av-input" type="number" step="0.001" min="0" required></div>
            <div class="av-field"><label for="av-cad-rate">${esc(T.recentRate)}</label><input id="av-cad-rate" name="rate" class="av-input" type="number" step="0.1" min="0"></div>
            <div class="av-field"><label for="av-cad-loc">${esc(T.location)}</label><select id="av-cad-loc" name="loc" class="av-input">${["Hábitat", "Refugio", "Rover", "EVA", "Cabina de la nave"].map((o) => `<option value="${esc(o)}" ${o === ENV_BY_KEY[envState.key].cadLoc ? "selected" : ""}>${esc(T.cadLoc[o] || o)}</option>`).join("")}</select></div>
          </div>
          <div class="av-field"><label for="av-cad-notes">${esc(T.notes)}</label><input id="av-cad-notes" name="notes" class="av-input" maxlength="140"></div>
          <button type="submit" class="av-btn av-btn-primary">${esc(T.saveReading)}</button>
          <p class="av-sub" style="margin:0;font-size:12px">${esc(T.cadNote)}</p>
        </form>
        <div style="border-top:1px solid var(--av-border);padding:10px 12px;display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:center"><span class="av-lbl">${esc(T.lastReading)}</span>${lastCad ? (cadAgeH > 24 ? badge("S", T.over24) : badge("N")) : badge("M")}</div>
          ${lastCad ? `<div><span class="av-mono">${num(lastCad.mgy, 3)} mGy</span>${lastCad.rate ? ` · <span class="av-mono">${num(lastCad.rate, 1)} µGy/h</span>` : ""} · ${esc(T.cadLoc[lastCad.loc] || lastCad.loc)}</div>
          <div class="av-sub">${esc(lastCad.device)} · <span class="av-mono">${gmt(new Date(lastCad.utc), false)}</span>${cadAgeH > 24 ? esc(T.over24Note) : ""}</div>
          ${discrepancy !== null && discrepancy > 0.3 ? `<div>${badge("A")} <span class="av-sub" style="color:var(--av-text)">${esc(fmt(T.differs, { pct: num(discrepancy * 100) }))}</span></div>` : ""}` : `<div class="av-sub">${esc(T.noReadings)}</div>`}
        </div>
        ${entries.length ? `<div class="av-hscroll" style="border-top:1px solid var(--av-border)"><table class="av-table" style="font-size:13px"><thead><tr><th scope="col" style="padding-left:12px">GMT</th><th scope="col" style="text-align:right">mGy</th><th scope="col" style="text-align:right">µGy/h</th><th scope="col">${esc(T.place)}</th></tr></thead><tbody>
          ${entries.slice(-6).reverse().map((e) => `<tr><td class="av-mono" style="padding-left:12px">${gmt(new Date(e.utc), false)}</td><td class="av-mono" style="text-align:right">${num(e.mgy, 3)}</td><td class="av-mono" style="text-align:right">${e.rate ? num(e.rate, 1) : "—"}</td><td>${esc(T.cadLoc[e.loc] || e.loc)}</td></tr>`).join("")}
        </tbody></table></div>` : ""}`)}
      ${radFold("limits", esc(T.limitsTitle), "", `<div style="padding:12px;display:flex;flex-direction:column;gap:6px">
        <table class="av-table" style="font-size:12px">
          <thead><tr><th scope="col">${esc(T.organ)}</th><th scope="col" style="text-align:right">30 d</th><th scope="col" style="text-align:right">${esc(T.year1)}</th><th scope="col" style="text-align:right">${esc(T.career)}</th></tr></thead>
          <tbody>
            ${limRow(T.lens, 1000, 2000, 4000)}
            ${limRow(T.skin, 1500, 3000, 6000)}
            ${limRow(T.bfo, 250, 500, null)}
            ${limRow(T.circulatory, 250, 500, 1000)}
            ${limRow(T.cns, 500, 1000, 1500)}
            ${limRow(T.effective, null, null, 600)}
          </tbody>
        </table>
        <span style="font-size:11px;color:var(--av-muted)">${esc(T.limitsSource)}</span>
      </div>`)}
    </div>
  </div>`;
}

/* ───────────────────────── eventos ───────────────────────── */

function bindOnce(container, appState, helpers) {
  if (container.__avBound) {
    container.__avCtx = { appState, helpers };
    return;
  }
  container.__avBound = true;
  container.__avCtx = { appState, helpers };

  // "toggle" no burbujea: se escucha en captura para recordar las secciones plegadas
  container.addEventListener("toggle", (ev) => {
    const fold = ev.target instanceof Element ? ev.target.closest("details[data-fold]") : null;
    if (fold === ev.target) consoleState.radFold[fold.dataset.fold] = fold.open;
  }, true);

  container.addEventListener("click", async (ev) => {
    // solo dentro de la raíz propia de la consola (no en las vistas de src/console/views/)
    if (!ev.target.closest(ROOT_SEL)) return;
    const { appState: st, helpers: hp } = container.__avCtx;
    const navBtn = ev.target.closest("[data-nav]");
    if (navBtn) {
      document.body.classList.remove("av-console-on");
      hp.navigateToSection(navBtn.getAttribute("data-nav"));
      return;
    }
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    const act = el.getAttribute("data-act");
    const code = el.getAttribute("data-code");
    try {
      // Resumen y Radiación son secciones: se navega (la pestaña global queda marcada)
      if (act === "view-summary") { await hp.navigateToSection("mission-control"); }
      else if (act === "view-radiation") { await hp.navigateToSection("radiation"); }
      else if (act === "open-indicator" && code) {
        consoleState.view = "indicator"; consoleState.indicator = code; consoleState.proc = { step: 1, result: null }; paint(container, st);
      } else if (act === "region") {
        // zona o métrica lateral del mapa corporal: fija su ficha y filtra la tabla (como "sys");
        // si ya estaba fijada, la suelta. Con teclado (detail 0) el foco entra en la ficha.
        const reg = el.getAttribute("data-region");
        const fid = el.getAttribute("data-focus-id");
        const byKeyboard = ev.detail === 0;
        if (consoleState.sys === reg && consoleState.pop === reg) { consoleState.sys = null; consoleState.pop = null; }
        else { consoleState.sys = reg; consoleState.pop = reg; consoleState.popFrom = fid; }
        paint(container, st);
        const title = container.querySelector("#av-pop-title");
        const opener = container.querySelector(`[data-focus-id="${fid}"]`);
        if (consoleState.pop) revealAboveSheet(container, opener);
        if (byKeyboard && consoleState.pop && title) title.focus({ preventScroll: true });
        else focusQuiet(container, opener);
      } else if (act === "pop-close") {
        const reg = consoleState.pop;
        consoleState.pop = null;
        paint(container, st);
        focusQuiet(container, container.querySelector(`[data-focus-id="${consoleState.popFrom || `hot-${reg}`}"]`));
      } else if (act === "sys") {
        // fila "Otros sistemas" (sistemas sin zona en la figura): filtra la tabla
        consoleState.sys = consoleState.sys === code ? null : code;
        if (consoleState.pop !== consoleState.sys) consoleState.pop = null;
        paint(container, st);
        focusQuiet(container, container.querySelector(`[data-focus-id="sys-${code}"]`));
      } else if (act === "clear-sys") { consoleState.sys = null; consoleState.pop = null; paint(container, st); }
      else if (act === "toggle-nominal") {
        nominalOpen = !nominalOpen;
        paint(container, st);
        focusQuiet(container, container.querySelector('[data-focus-id="nom-toggle"]'));
      }
      else if (act === "layer") {
        const k = el.getAttribute("data-layer"); consoleState.layers[k] = !consoleState.layers[k]; paint(container, st);
        focusQuiet(container, container.querySelector(`[data-focus-id="layer-${k}"]`));
      }
      else if (act === "toggle-adv") { consoleState.showAdv = !consoleState.showAdv; paint(container, st); }
      else if (act === "spe-start") { heraStartSpe(); paint(container, st); }
      else if (act === "spe-stop") { heraStopSpe(); paint(container, st); }
      else if (act === "proc-next") { consoleState.proc.step += 1; paint(container, st); }
      else if (act === "ack") {
        // mismo flujo que la barra de alarma: actualiza encabezado global y vista
        await ackAlert(el.getAttribute("data-alert"), st, hp, el);
      } else if (act === "escalate") {
        el.disabled = true;
        await apiService.request(`/alerts/${Number(el.getAttribute("data-alert"))}/escalate`, { method: "POST", body: JSON.stringify({ notes: tt().escalateNote }) });
        hp.showToast(tt().toastEscalated);
        await refresh(container, st, hp);
      } else if (act === "hyd-add") {
        const ml = Number(el.getAttribute("data-ml"));
        const c = (st.healthSummary?.indicator_cards || []).find((x) => x.indicator_code === "HYDRATION");
        const base = c && c.latest_value !== null && c.latest_value !== undefined && c.age_hours !== null && c.age_hours < 24 ? Number(c.latest_value) : 0;
        await submitMeasurement(container, st, hp, { indicator_code: "HYDRATION", value: base + ml, notes: fmt(tt().hydNoteApi, { ml }) });
      }
    } catch (e) {
      hp.showToast(fmt(tt().actionFailed, { msg: bt(e.message) }));
      el.disabled = false;
    }
  });

  /* Mapa corporal: vista previa con hover / foco, Esc para cerrar (solo dentro de la raíz de la consola) */
  const inBodymap = (t) => !!(t && t.closest && t.closest(ROOT_SEL) && t.closest(".av-bodymap"));
  container.addEventListener("mouseover", (ev) => {
    if (!inBodymap(ev.target)) return;
    if (ev.target.closest("#av-bodypop")) { clearTimeout(container.__avPopHide); return; }
    const trg = ev.target.closest("[data-region]");
    if (trg) bodyPreview(container, trg.getAttribute("data-region"), trg.getAttribute("data-focus-id"));
  });
  container.addEventListener("mouseout", (ev) => {
    if (!inBodymap(ev.target)) return;
    if (!ev.target.closest("[data-region], #av-bodypop")) return;
    const to = ev.relatedTarget && ev.relatedTarget.closest ? ev.relatedTarget.closest(".av-bodymap [data-region], #av-bodypop") : null;
    if (to) return; // de la zona a su ficha (o entre partes de la misma zona)
    clearTimeout(container.__avPopHide);
    // margen para que el puntero cruce de la zona a la ficha sin que se cierre
    container.__avPopHide = setTimeout(() => bodyPreviewEnd(container), 320);
  });
  container.addEventListener("focusin", (ev) => {
    if (!inBodymap(ev.target)) return;
    if (ev.target.closest("#av-bodypop")) { clearTimeout(container.__avPopHide); return; }
    const trg = ev.target.closest("[data-region]");
    if (trg && !container.__avNoPreview) bodyPreview(container, trg.getAttribute("data-region"), trg.getAttribute("data-focus-id"));
  });
  container.addEventListener("focusout", (ev) => {
    if (!inBodymap(ev.target)) return;
    const to = ev.relatedTarget;
    if (to && to.closest && to.closest(".av-bodymap [data-region], #av-bodypop")) return;
    bodyPreviewEnd(container);
  });
  container.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !ev.target.closest || !ev.target.closest(ROOT_SEL)) return;
    const pop = container.querySelector("#av-bodypop");
    if (!pop || pop.hidden || !pop.hasAttribute("data-pop-region")) return;
    const shown = pop.getAttribute("data-pop-region");
    const pinned = pinnedRegion();
    ev.preventDefault();
    container.querySelectorAll(".av-bodymap [data-region].is-hover").forEach((e) => e.classList.remove("is-hover"));
    if (shown !== pinned) {
      // vista previa: se cierra (o vuelve a la ficha fijada) sin mover el foco
      clearTimeout(container.__avPopHide);
      if (pinned) fillBodyPop(container, pinned);
      else closeBodyPop(pop);
      return;
    }
    // ficha fijada: se cierra (la tabla sigue filtrada) y el foco vuelve a su zona
    const fid = ev.target.closest(".av-bodymap [data-focus-id]")?.getAttribute("data-focus-id") || consoleState.popFrom || `hot-${shown}`;
    consoleState.pop = null;
    paint(container, container.__avCtx.appState);
    focusQuiet(container, container.querySelector(`[data-focus-id="${fid}"]`));
  });
  /* La ficha es "fixed": se recoloca junto a su zona al desplazar (cualquier contenedor) o redimensionar */
  let popRaf = 0;
  const reflowPop = (ev) => {
    if (popRaf || (ev && ev.target && ev.target.closest && ev.target.closest("#av-bodypop"))) return;
    popRaf = requestAnimationFrame(() => {
      popRaf = 0;
      if (document.body.contains(container) && container.querySelector(ROOT_SEL)) placeBodyPop(container);
    });
  };
  window.addEventListener("scroll", reflowPop, { passive: true, capture: true });
  window.addEventListener("resize", reflowPop);

  container.addEventListener("submit", async (ev) => {
    const form = ev.target.closest("form[data-form]");
    if (!form || !form.closest(ROOT_SEL)) return;
    ev.preventDefault();
    const { appState: st, helpers: hp } = container.__avCtx;
    const fd = new FormData(form);
    try {
      if (form.getAttribute("data-form") === "measure") {
        const payload = { indicator_code: consoleState.indicator, value: Number(fd.get("value")), notes: tt().measureNoteApi };
        if (fd.get("secondary")) payload.secondary_value = Number(fd.get("secondary"));
        await submitMeasurement(container, st, hp, payload);
      } else if (form.getAttribute("data-form") === "cad") {
        const entry = {
          device: String(fd.get("device") || "").slice(0, 32),
          utc: new Date(`${fd.get("utc")}:00Z`).toISOString(),
          mgy: Number(fd.get("mgy")),
          rate: fd.get("rate") ? Number(fd.get("rate")) : null,
          loc: String(fd.get("loc") || ""),
          notes: String(fd.get("notes") || "").slice(0, 140),
          savedAt: new Date().toISOString(),
        };
        if (!Number.isFinite(entry.mgy) || entry.mgy < 0) throw new Error(tt().badDose);
        const list = cadEntries(st.selectedAstronautId);
        list.push(entry);
        list.sort((a, b) => new Date(a.utc) - new Date(b.utc));
        if (!saveCad(st.selectedAstronautId, list)) throw new Error(tt().saveLocalFailed);
        hp.showToast(tt().toastCadSaved);
        paint(container, st);
      }
    } catch (e) {
      hp.showToast(fmt(tt().saveFailed, { msg: bt(e.message) }));
    }
  });
}

async function submitMeasurement(container, st, hp, payload) {
  payload.astronaut_id = st.selectedAstronautId;
  payload.mission_id = st.selectedMissionId;
  payload.source_code = "MANUAL_ENTRY";
  const res = await apiService.createMeasurement(payload);
  if (res && res.queued_offline) {
    consoleState.proc.result = esc(fmt(tt().queuedOffline, { n: res.queue_size }));
  } else if (res && res.measurement) {
    const m = res.measurement;
    const l = LETTER[m.calculated_state] || "N";
    consoleState.proc.result = `${badge(l)} ${esc(tt().registered)} <span class="av-mono">${esc(num(m.value, m.value % 1 ? 1 : 0))} ${esc(bt(m.unit || ""))}</span> · ${esc(STATE_WORD[l])}. ${esc(bt(res.recommended_next_step) || "")}`;
  }
  consoleState.proc.step = Math.max(consoleState.proc.step, 3);
  hp.showToast(tt().toastMeasured);
  await refresh(container, st, hp);
}

/* Tras escalar o registrar: refreshGlobalHeaderAndSummary (app.js) ya recarga la caché
 * y el encabezado global; aquí solo se repinta la vista (sin volver a pedir datos). */
async function refresh(container, st, hp) {
  if (hp.refreshGlobalHeaderAndSummary) {
    await hp.refreshGlobalHeaderAndSummary();
  } else {
    await refreshConsoleData(st);
    renderChrome(st);
  }
  if (container.querySelector(ROOT_SEL)) paint(container, st);
}

/* Utilidades compartidas con las vistas de la consola (src/console/views/*). */
export { num, gmt, met, badge, cardValue, sparkPoints, limitsText, ruleOf, LETTER, RANK, STATE_WORD };
