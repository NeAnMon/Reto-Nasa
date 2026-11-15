/* SEMSA · Consola de salud de tripulación — vista "Contramedidas de hoy"
 * Misiones diarias y gamificación ética:
 * - se premia la constancia y el aprendizaje, nunca tener constantes "normales"
 * - omitir por restricción operativa (EXCUSED_OPERATIONAL_RESTRICTION) no rompe la racha ni resta
 * - las misiones pausadas por seguridad (PAUSED_FOR_SAFETY / safety_blocked) se muestran con su motivo
 *   y no se pueden completar ni omitir
 * - el servidor registra la misión para el usuario autenticado; por eso solo la propia persona
 *   astronauta puede registrar (vista de supervisión en solo lectura para el resto de roles)
 *
 * Nota: no se usan atributos data-act / data-nav / form[data-form] porque console.js tiene
 * listeners delegados sobre el mismo contenedor que reaccionan a ellos. Aquí todo va con data-cm-act
 * y los listeners se enganchan a la raíz propia (.av-cm-root) en cada pintado.
 *
 * Idiomas: textos en DICT (es / en), resueltos en cada pintado con tr(DICT).
 */
import { escapeHtml, num, gmt } from "../console.js";
import { apiService } from "../../services/api.js";
import { tr, fmt, fmtNum, getLang } from "../../i18n/i18n.js";
import { bt, btLines } from "/src/i18n/backend.js";

const esc = escapeHtml;

/* ───────────────────────── textos ───────────────────────── */

const DICT = {
  es: {
    category: {
      MEASUREMENT: "Medición",
      SELF_CARE: "Autocuidado",
      WELLNESS: "Bienestar",
      COGNITIVE: "Cognitivo",
      ENVIRONMENT: "Ambiente",
      LEARNING: "Aprendizaje",
      FOLLOW_UP: "Seguimiento",
      COMMUNICATION: "Comunicación",
      OTHER: "Otras",
    },
    /* Títulos por código (si el código no está, se usa el título de la API) */
    title: {
      DAILY_HEALTH_CHECK: "Chequeo de salud diario",
      PULSE_CHECK: "Control de pulso y presión arterial",
      SLEEP_LOG: "Registro de sueño",
      HYDRATION_ROUTINE: "Rutina de hidratación",
      MOVE_SAFELY: "Ejercicio seguro (contrarresistencia)",
      MIND_CHECK: "Chequeo de bienestar psicológico",
      ENVIRONMENTAL_AWARENESS: "Revisión del ambiente de la nave",
      MISSION_REFLECTION: "Reflexión de misión",
      FOLLOW_UP_MISSION: "Seguimiento de alerta preventiva",
      LEARNING_MISSION: "Misión de aprendizaje",
      COMPLETE_COGNITIVE_CHECK: "Chequeo cognitivo",
      COMPLETE_EMOTIONAL_CHECKIN: "Registro emocional",
      REVIEW_MISSION_MESSAGES: "Revisar mensajes de misión",
      RESPOND_SUPPORT_REQUEST: "Responder solicitud de apoyo",
      MEMORY_TRAINING_ACTIVITY: "Entrenamiento de memoria",
      VISUAL_ATTENTION_ACTIVITY: "Actividad de atención visual",
    },
    /* Nombres de insignias (si no está, se usa el nombre de la API) */
    badge: {
      FIRST_HEALTH_CHECK: "Primer chequeo de salud",
      CONSISTENCY_STREAK: "Racha de constancia",
      SLEEP_ROUTINE_COMPLETED: "Rutina de sueño completada",
      LEARNING_EXPLORER: "Exploración del aprendizaje",
      SELF_CARE_COMMITMENT: "Compromiso con el autocuidado",
      FOLLOW_UP_COMPLETED: "Seguimiento completado",
      MISSION_MILESTONE: "Hito de misión",
      MEMORY_EXPLORER: "Exploración de la memoria",
      VISUAL_NAVIGATOR: "Navegación visual",
      COGNITIVE_MISSION_COMPLETED: "Misión cognitiva completada",
      ATTENTION_SPECIALIST: "Especialista en atención",
    },
    section: {
      "my-health-check": "Mi chequeo de salud",
      "wellness-center": "Bienestar psicológico",
      "mission-control": "Consola de salud",
      "alerts-center": "Alertas",
      "cognitive-center": "Evaluación cognitiva",
      "emotional-center": "Check-in emocional",
    },
    excuse: {
      EVA: "Actividad extravehicular (EVA) o tarea operativa prioritaria",
      SENSOR: "Sensor o equipo no disponible",
      MEDICAL: "Restricción médica indicada por el equipo de vuelo",
    },
    fallbackTitle: "Contramedida",
    fallbackCategory: "Otras",
    fallbackBadge: "Insignia",
    markPaused: "PAUSA",
    markQueued: "COLA",
    stPaused: "Pausada por seguridad",
    stDone: "Hecha {t}",
    stExcused: "Omitida por operación",
    stQueued: "En cola sin conexión",
    stPending: "Pendiente",
    stNone: "Sin estado",
    loading: "Cargando contramedidas de hoy…",
    unknownErr: "error desconocido",
    pageTitle: "Contramedidas de hoy",
    loadFail: "No se pudieron cargar las contramedidas: {msg}",
    retry: "Reintentar",
    dayHtml: "Día GMT {doy} · {date}",
    nextRec: "Siguiente recomendada",
    open: "Abrir",
    noneLeft: "No quedan contramedidas pendientes hoy.",
    nPaused: "{n} en pausa por seguridad.",
    roHtmlWho: "<strong>Vista de supervisión (solo lectura).</strong> Estás viendo las contramedidas de {who}. Solo esa persona puede registrarlas.",
    roOtherCrew: "otra persona de la tripulación",
    roHtmlNone: "<strong>Vista de supervisión (solo lectura).</strong> Selecciona a una persona de la tripulación para ver sus contramedidas. Solo las personas astronautas pueden registrarlas.",
    resetNote: "se reinicia a las 00:00 GMT · registro autodeclarado",
    today: "Hoy",
    pct: "{n} %",
    caption: "Lista de contramedidas de hoy agrupadas por categoría. Abre una fila para ver los detalles y las acciones.",
    thStatus: "Estado",
    thCm: "Contramedida",
    thCategory: "Categoría",
    thReward: "Recompensa",
    thAction: "Acción",
    emptyToday: "No hay contramedidas configuradas para hoy.",
    legendHtml: 'Estado: <span class="av-mono">✓</span> hecha · <span class="av-mono">OP</span> omitida por restricción operativa (no rompe la racha) · <span class="av-mono">PAUSA</span> pausada por seguridad · <span class="av-mono">COLA</span> guardada sin conexión · <span class="av-mono">–</span> pendiente.',
    unavailable: "No disponible",
    complete: "Completar",
    sendsOnReconnect: "Se enviará al reconectar",
    readOnly: "Solo lectura",
    noActions: "Sin acciones",
    blockedReason: "Motivo: alerta médica activa incompatible con esta actividad",
    goTo: "Ir a {s}",
    pausedStrong: "Pausada por seguridad.",
    pausedBody: "Hay una alerta médica activa (crítica o de precaución) incompatible con esta actividad. No se puede completar ni omitir hasta que el equipo médico cierre la alerta. Mientras tanto, no afecta a la racha.",
    viewAlerts: "Ver alertas",
    confirmHtml: "<strong>¿Confirmas que realizaste «{title}»?</strong> Es un registro autodeclarado: suma {xp} XP y no se puede deshacer hoy.",
    yesDone: "Sí, registrar como hecha",
    cancel: "Cancelar",
    excuseLegend: "Omitir «{title}» por restricción operativa",
    excuseHelp: "No suma XP y no rompe tu racha. Elige el motivo:",
    confirmExcuse: "Confirmar omisión",
    excuseBtn: "Omitir por restricción operativa",
    excuseBtnTitle: "Por EVA, sensor no disponible o restricción médica, sin perder la racha",
    doneNote: "Registrada como hecha a las {t} GMT.",
    excNote: "Omitida por restricción operativa{at}. No resta XP ni rompe la racha.",
    excAt: " a las {t} GMT",
    queuedNote: "Guardada en la cola local sin conexión. Se enviará en el próximo contacto con Tierra.",
    onlyAstro: "Solo la persona astronauta puede registrar esta contramedida.",
    whyMatters: "Por qué importa",
    autoPause: "Se pausa automáticamente si hay una alerta médica crítica o de precaución activa.",
    code: "Código",
    serverAssigned: "(la asigna el servidor)",
    progressToday: "Progreso de hoy",
    doneOfTotal: "{done} de {total} hechas u omitidas",
    barToday: "Progreso de contramedidas de hoy",
    dlDone: "Hechas",
    dlExcused: "Omitidas por operación",
    dlPaused: "Pausadas por seguridad",
    dlPending: "Pendientes",
    asideAria: "Progreso y reconocimientos",
    profTitle: "Nivel, racha e insignias",
    profFail: "No se pudo cargar el perfil de progreso",
    tagPassed: "superado",
    tagCurrent: "actual",
    level: "Nivel",
    levelOf: "Nivel {n} de {total}",
    maxLevel: "Nivel máximo alcanzado. Sigues sumando XP por constancia y aprendizaje.",
    progressTo: "Progreso hacia {next}",
    xpMissing: "{range} XP · faltan {m} XP para {next}",
    levelsAria: "Niveles y XP mínimo",
    consistency: "Constancia",
    activeStreak: "racha activa",
    streakNote: "Las omisiones por restricción operativa no rompen la racha.",
    routines: "Rutinas completadas",
    modules: "Módulos de aprendizaje",
    followups: "Seguimientos completados",
    remindersPaused: "Recordatorios en pausa por operaciones.",
    earned: "Obtenida",
    notEarned: "Por obtener",
    criteria: "Criterio: {c}",
    badges: "Insignias",
    earnedOf: "{n} de {total} obtenidas",
    noBadges: "Sin insignias configuradas.",
    showBadges: "Ver insignias",
    hideBadges: "Ocultar insignias",
    groupPending: "{n} pendientes",
    groupPendingOne: "1 pendiente",
    groupAllDone: "al día",
    onlyPending: "Solo pendientes",
    expandAll: "Desplegar todo",
    collapseAll: "Plegar todo",
    noPendingLeft: "No quedan contramedidas pendientes hoy.",
    pendAlertOne: "1 contramedida pendiente hoy:",
    pendAlertMany: "{n} contramedidas pendientes hoy:",
    pendAlertMore: "y {n} más",
    pendAlertPaused: "{n} pausadas por seguridad (no se pueden registrar hasta revisar la alerta).",
    pendAlertPausedOne: "1 pausada por seguridad (no se puede registrar hasta revisar la alerta).",
    pendAlertShow: "Ver pendientes",
    ethicHtml: "<strong>Gamificación ética:</strong> se reconoce la constancia y el aprendizaje, nunca tener constantes «normales»; reportar síntomas o restricciones no penaliza.",
    fullPolicy: "Política completa",
    logging: "Registrando…",
    apiNoteExcused: "Omitida por restricción operativa: {r}",
    apiNoteDone: "Completada desde Contramedidas de hoy",
    msgQueued: "Sin conexión: «{t}» guardada en la cola local ({n} pendientes). Se enviará al reconectar.",
    msgAlready: "«{t}»: {m}",
    msgAlreadyDefault: "ya estaba registrada hoy.",
    msgExcused: "«{t}» omitida por restricción operativa. {m}",
    msgExcusedDefault: "Tu racha se conserva sin penalización.",
    msgDone: "«{t}» registrada como hecha: +{xp} XP. {m}",
    msgNewBadge: " Nueva insignia: {b}.",
    msgNewLevel: " Nuevo nivel: {l}.",
    msgFail: "No se pudo registrar «{t}»: {e}",
  },
  en: {
    category: {
      MEASUREMENT: "Measurement",
      SELF_CARE: "Self-care",
      WELLNESS: "Wellness",
      COGNITIVE: "Cognitive",
      ENVIRONMENT: "Environment",
      LEARNING: "Learning",
      FOLLOW_UP: "Follow-up",
      COMMUNICATION: "Communication",
      OTHER: "Other",
    },
    title: {
      DAILY_HEALTH_CHECK: "Daily health check",
      PULSE_CHECK: "Pulse and blood pressure check",
      SLEEP_LOG: "Sleep log",
      HYDRATION_ROUTINE: "Hydration routine",
      MOVE_SAFELY: "Safe exercise (resistive)",
      MIND_CHECK: "Psychological wellbeing check",
      ENVIRONMENTAL_AWARENESS: "Spacecraft environment review",
      MISSION_REFLECTION: "Mission reflection",
      FOLLOW_UP_MISSION: "Preventive alert follow-up",
      LEARNING_MISSION: "Learning mission",
      COMPLETE_COGNITIVE_CHECK: "Cognitive check",
      COMPLETE_EMOTIONAL_CHECKIN: "Emotional check-in",
      REVIEW_MISSION_MESSAGES: "Review mission messages",
      RESPOND_SUPPORT_REQUEST: "Respond to support request",
      MEMORY_TRAINING_ACTIVITY: "Memory training",
      VISUAL_ATTENTION_ACTIVITY: "Visual attention activity",
    },
    badge: {
      FIRST_HEALTH_CHECK: "First health check",
      CONSISTENCY_STREAK: "Consistency streak",
      SLEEP_ROUTINE_COMPLETED: "Sleep routine completed",
      LEARNING_EXPLORER: "Learning explorer",
      SELF_CARE_COMMITMENT: "Self-care commitment",
      FOLLOW_UP_COMPLETED: "Follow-up completed",
      MISSION_MILESTONE: "Mission milestone",
      MEMORY_EXPLORER: "Memory explorer",
      VISUAL_NAVIGATOR: "Visual navigator",
      COGNITIVE_MISSION_COMPLETED: "Cognitive mission completed",
      ATTENTION_SPECIALIST: "Attention specialist",
    },
    section: {
      "my-health-check": "My health check",
      "wellness-center": "Psychological wellbeing",
      "mission-control": "Health console",
      "alerts-center": "Alerts",
      "cognitive-center": "Cognitive assessment",
      "emotional-center": "Emotional check-in",
    },
    excuse: {
      EVA: "Extravehicular activity (EVA) or priority operational task",
      SENSOR: "Sensor or equipment unavailable",
      MEDICAL: "Medical restriction from the flight team",
    },
    fallbackTitle: "Countermeasure",
    fallbackCategory: "Other",
    fallbackBadge: "Badge",
    markPaused: "HOLD",
    markQueued: "QUEUE",
    stPaused: "On safety hold",
    stDone: "Done {t}",
    stExcused: "Excused (ops)",
    stQueued: "Queued offline",
    stPending: "Pending",
    stNone: "No status",
    loading: "Loading today's countermeasures…",
    unknownErr: "unknown error",
    pageTitle: "Today's countermeasures",
    loadFail: "Could not load countermeasures: {msg}",
    retry: "Retry",
    dayHtml: "GMT day {doy} · {date}",
    nextRec: "Recommended next",
    open: "Open",
    noneLeft: "No countermeasures left for today.",
    nPaused: "{n} on safety hold.",
    roHtmlWho: "<strong>Supervision view (read-only).</strong> You are viewing the countermeasures of {who}. Only that person can log them.",
    roOtherCrew: "another crew member",
    roHtmlNone: "<strong>Supervision view (read-only).</strong> Select a crew member to view their countermeasures. Only astronauts can log them.",
    resetNote: "resets at 00:00 GMT · self-reported",
    today: "Today",
    pct: "{n}%",
    caption: "Today's countermeasures grouped by category. Open a row to see details and actions.",
    thStatus: "Status",
    thCm: "Countermeasure",
    thCategory: "Category",
    thReward: "Reward",
    thAction: "Action",
    emptyToday: "No countermeasures configured for today.",
    legendHtml: 'Status: <span class="av-mono">✓</span> done · <span class="av-mono">OP</span> excused for operational constraint (streak kept) · <span class="av-mono">HOLD</span> on safety hold · <span class="av-mono">QUEUE</span> saved offline · <span class="av-mono">–</span> pending.',
    unavailable: "Unavailable",
    complete: "Complete",
    sendsOnReconnect: "Sends on reconnect",
    readOnly: "Read-only",
    noActions: "No actions",
    blockedReason: "Reason: active medical alert incompatible with this activity",
    goTo: "Go to {s}",
    pausedStrong: "On safety hold.",
    pausedBody: "An active medical alert (warning or caution) is incompatible with this activity. It can't be completed or excused until the medical team closes the alert. Meanwhile, it doesn't affect your streak.",
    viewAlerts: "View alerts",
    confirmHtml: "<strong>Confirm you completed “{title}”?</strong> This is a self-reported entry: it adds {xp} XP and can't be undone today.",
    yesDone: "Yes, log as done",
    cancel: "Cancel",
    excuseLegend: "Excuse “{title}” for operational constraint",
    excuseHelp: "No XP is awarded and your streak is kept. Choose the reason:",
    confirmExcuse: "Confirm excusal",
    excuseBtn: "Excuse (operational constraint)",
    excuseBtnTitle: "For EVA, unavailable sensor or medical restriction, without losing your streak",
    doneNote: "Logged as done at {t} GMT.",
    excNote: "Excused for operational constraint{at}. No XP is deducted and the streak is kept.",
    excAt: " at {t} GMT",
    queuedNote: "Saved in the offline local queue. It will be sent at the next contact with Ground.",
    onlyAstro: "Only the astronaut can log this countermeasure.",
    whyMatters: "Why it matters",
    autoPause: "Automatically put on hold while a warning or caution medical alert is active.",
    code: "Code",
    serverAssigned: "(assigned by the server)",
    progressToday: "Today's progress",
    doneOfTotal: "{done} of {total} done or excused",
    barToday: "Today's countermeasure progress",
    dlDone: "Done",
    dlExcused: "Excused (ops)",
    dlPaused: "On safety hold",
    dlPending: "Pending",
    asideAria: "Progress and recognition",
    profTitle: "Level, streak and badges",
    profFail: "Could not load the progress profile",
    tagPassed: "passed",
    tagCurrent: "current",
    level: "Level",
    levelOf: "Level {n} of {total}",
    maxLevel: "Maximum level reached. You keep earning XP for consistency and learning.",
    progressTo: "Progress toward {next}",
    xpMissing: "{range} XP · {m} XP to {next}",
    levelsAria: "Levels and minimum XP",
    consistency: "Consistency",
    activeStreak: "active streak",
    streakNote: "Excusals for operational constraints don't break the streak.",
    routines: "Routines completed",
    modules: "Learning modules",
    followups: "Follow-ups completed",
    remindersPaused: "Reminders paused for operations.",
    earned: "Earned",
    notEarned: "Not yet earned",
    criteria: "Criteria: {c}",
    badges: "Badges",
    earnedOf: "{n} of {total} earned",
    noBadges: "No badges configured.",
    showBadges: "Show badges",
    hideBadges: "Hide badges",
    groupPending: "{n} pending",
    groupPendingOne: "1 pending",
    groupAllDone: "up to date",
    onlyPending: "Pending only",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    noPendingLeft: "No countermeasures left pending today.",
    pendAlertOne: "1 countermeasure pending today:",
    pendAlertMany: "{n} countermeasures pending today:",
    pendAlertMore: "and {n} more",
    pendAlertPaused: "{n} paused for safety (cannot be logged until the alert is reviewed).",
    pendAlertPausedOne: "1 paused for safety (cannot be logged until the alert is reviewed).",
    pendAlertShow: "Show pending",
    ethicHtml: "<strong>Ethical gamification:</strong> consistency and learning are recognized, never having “normal” vitals; reporting symptoms or constraints is never penalized.",
    fullPolicy: "Full policy",
    logging: "Logging…",
    apiNoteExcused: "Excused for operational constraint: {r}",
    apiNoteDone: "Completed from Today's countermeasures",
    msgQueued: "Offline: “{t}” saved to the local queue ({n} pending). It will be sent on reconnect.",
    msgAlready: "“{t}”: {m}",
    msgAlreadyDefault: "already logged today.",
    msgExcused: "“{t}” excused for operational constraint. {m}",
    msgExcusedDefault: "Your streak is kept without penalty.",
    msgDone: "“{t}” logged as done: +{xp} XP. {m}",
    msgNewBadge: " New badge: {b}.",
    msgNewLevel: " New level: {l}.",
    msgFail: "Could not log “{t}”: {e}",
  },
};

/* Niveles (espejo de LEVEL_THRESHOLDS en backend/app/services/gamification.py) */
const LEVELS = [
  { name: "Cadet", xp: 0 },
  { name: "Explorer", xp: 120 },
  { name: "Specialist", xp: 280 },
  { name: "Mission Expert", xp: 500 },
  { name: "Wellbeing Champion", xp: 800 },
];

/* Orden de categorías */
const CATEGORY_ORDER = ["MEASUREMENT", "SELF_CARE", "WELLNESS", "COGNITIVE", "ENVIRONMENT", "LEARNING", "FOLLOW_UP", "COMMUNICATION"];

/* Pestaña donde se realiza cada contramedida (botón "Ir a …") */
const MISSION_ROUTE = {
  DAILY_HEALTH_CHECK: "my-health-check",
  PULSE_CHECK: "my-health-check",
  SLEEP_LOG: "my-health-check",
  HYDRATION_ROUTINE: "my-health-check",
  MIND_CHECK: "wellness-center",
  ENVIRONMENTAL_AWARENESS: "mission-control",
  FOLLOW_UP_MISSION: "alerts-center",
  LEARNING_MISSION: "mission-control",
  COMPLETE_COGNITIVE_CHECK: "cognitive-center",
  MEMORY_TRAINING_ACTIVITY: "cognitive-center",
  VISUAL_ATTENTION_ACTIVITY: "cognitive-center",
  COMPLETE_EMOTIONAL_CHECKIN: "emotional-center",
};

/* Motivos de omisión (la vista anterior los citaba: EVA, sensor no disponible o restricción médica) */
const EXCUSE_IDS = ["EVA", "SENSOR", "MEDICAL"];

const ST_DONE = "COMPLETED";
const ST_EXCUSED = "EXCUSED_OPERATIONAL_RESTRICTION";
const ST_PAUSED = "PAUSED_FOR_SAFETY";
const ST_PENDING = "PENDING";

/* Estado de la vista (persiste entre repintados) */
const cmState = {
  open: new Set(), // códigos de misión con la fila expandida
  confirm: null, // { code, mode: "complete" | "excuse" }
  reason: "EVA",
  queued: new Set(), // "astronauta|fecha|código" guardadas en cola sin conexión
  busy: false,
  result: "", // último resultado (texto plano)
  announce: false, // anunciar el resultado en la región aria-live tras el próximo pintado
  focusKey: null, // data-cm-key del elemento que recupera el foco tras repintar
  lang: null, // idioma del último resultado (al cambiar de idioma se descarta)
  groups: new Map(), // categoría → abierta (true) / plegada (false) elegida a mano; si no, se abre si tiene pendientes
  onlyPending: false, // filtro "Solo pendientes"
  badgesOpen: false, // lista de insignias desplegada (plegada por defecto para no desbordar la columna)
};

/* Queda algo por hacer hoy (pendiente, en cola o pausada por seguridad) */
const isOutstanding = (m) => m.status_today !== ST_DONE && m.status_today !== ST_EXCUSED;
function groupOpen(k, list) {
  if (cmState.groups.has(k)) return cmState.groups.get(k);
  return list.some(({ m }) => isOutstanding(m));
}

/* ───────────────────────── utilidades ───────────────────────── */

function ensureCss() {
  if (document.querySelector("link[data-av-cm-css]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./countermeasures.css", import.meta.url).href;
  link.setAttribute("data-av-cm-css", "");
  document.head.appendChild(link);
}

/* Número según idioma: en español se conserva el formato de la consola */
const nm = (v, dec = 0) => (getLang() === "es" ? num(v, dec) : fmtNum(v, dec));

const titleOf = (m) => tr(DICT).title[m.code] || bt(m.title) || m.code || tr(DICT).fallbackTitle;
const categoryOf = (c) => tr(DICT).category[c] || bt(c) || tr(DICT).fallbackCategory;
const badgeNameOf = (b) => tr(DICT).badge[b.code] || bt(b.name) || b.code || tr(DICT).fallbackBadge;
const gmtOf = (iso) => (iso ? gmt(new Date(iso), false) : "—");

function isBlocked(m) {
  return m.status_today === ST_PAUSED || (!!m.safety_blocked && m.status_today !== ST_DONE && m.status_today !== ST_EXCUSED);
}
function queueKey(ctx, m) {
  return `${ctx.astronautId ?? "yo"}|${ctx.missionsRes.date || ""}|${m.code}`;
}
function isQueued(ctx, m) {
  return m.status_today === ST_PENDING && cmState.queued.has(queueKey(ctx, m));
}
/* Se puede completar u omitir: pendiente, sin bloqueo de seguridad y sin envío en cola */
function isActionable(ctx, m) {
  return m.status_today === ST_PENDING && !isBlocked(m) && !isQueued(ctx, m);
}

/* Siguiente recomendada: la que indica el servidor; si quedó en cola sin conexión, la primera pendiente */
function nextIndex(ctx) {
  const idx = ctx.missions.findIndex((m) => m.code === ctx.missionsRes.next_recommended_mission_code);
  if (idx >= 0 && isActionable(ctx, ctx.missions[idx])) return idx;
  return idx >= 0 ? ctx.missions.findIndex((m) => isActionable(ctx, m)) : -1;
}

function statusInfo(ctx, m) {
  const T = tr(DICT);
  if (isBlocked(m)) return { cls: "av-b-A", mark: T.markPaused, text: T.stPaused };
  if (m.status_today === ST_DONE) return { cls: "av-b-A", mark: "✓", text: fmt(T.stDone, { t: gmtOf(m.completed_at) }) };
  if (m.status_today === ST_EXCUSED) return { cls: "av-b-N", mark: "OP", text: T.stExcused };
  if (isQueued(ctx, m)) return { cls: "av-b-S", mark: T.markQueued, text: T.stQueued };
  if (m.status_today === ST_PENDING) return { cls: "av-b-N", mark: "–", text: T.stPending };
  return { cls: "av-b-N", mark: "?", text: String(m.status_today || T.stNone) };
}

function levelIndex(li) {
  const byName = LEVELS.findIndex((l) => l.name === li.current_level);
  if (byName >= 0) return byName;
  let idx = 0;
  LEVELS.forEach((l, i) => { if (Number(li.total_xp) >= l.xp) idx = i; });
  return idx;
}

function bar(pct, label) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return `<div class="av-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" aria-label="${esc(label)}"><span style="width:${v}%"></span></div>`;
}

function stale(ctx) {
  return (
    !document.body.contains(ctx.container) ||
    ctx.appState.currentSection !== ctx.section ||
    ctx.appState.selectedAstronautId !== ctx.astronautId
  );
}

/* ───────────────────────── render principal ───────────────────────── */

export async function renderCountermeasuresView(container, appState, helpers) {
  ensureCss();
  const ctx = {
    container,
    appState,
    helpers,
    section: appState.currentSection,
    astronautId: appState.selectedAstronautId,
  };
  // cambio de idioma: el último resultado estaba en el otro idioma
  if (cmState.lang !== getLang()) {
    cmState.lang = getLang();
    cmState.result = "";
    cmState.announce = false;
  }
  // primera carga: aviso de carga; en recargas tras una acción se mantiene la vista actual
  if (!container.querySelector(".av-cm-root")) {
    // entrada nueva a la pestaña: no arrastrar mensajes ni confirmaciones de la visita anterior
    cmState.result = "";
    cmState.announce = false;
    cmState.confirm = null;
    if (cmState.astronautId !== ctx.astronautId) {
      cmState.open.clear();
      cmState.groups.clear();
    }
    cmState.astronautId = ctx.astronautId;
    container.innerHTML = `<div class="av-console av-cm-root"><div class="av-sub" style="padding:24px" role="status">${esc(tr(DICT).loading)}</div></div>`;
  }

  const [mRes, pRes] = await Promise.allSettled([
    apiService.getDailyMissions(ctx.astronautId),
    apiService.getGamificationProfile(ctx.astronautId),
  ]);
  if (stale(ctx)) return;
  const T = tr(DICT);

  if (mRes.status === "rejected") {
    const msg = mRes.reason && mRes.reason.message ? bt(mRes.reason.message) : T.unknownErr;
    container.innerHTML = `<div class="av-console av-cm-root"><div class="av-grid"><section class="av-panel av-col-b" style="padding:16px;gap:12px">
        <h2 class="av-h2">${esc(T.pageTitle)}</h2>
        <p style="margin:0" role="alert">${esc(fmt(T.loadFail, { msg }))}</p>
        <div><button type="button" class="av-btn" data-cm-act="reload" data-cm-key="reload">${esc(T.retry)}</button></div>
      </section></div></div>`;
    bindRoot(ctx);
    return;
  }

  ctx.missionsRes = mRes.value || {};
  ctx.missions = Array.isArray(ctx.missionsRes.missions) ? ctx.missionsRes.missions : [];
  ctx.prof = pRes.status === "fulfilled" ? pRes.value : null;
  ctx.profError = pRes.status === "rejected" ? bt(pRes.reason && pRes.reason.message) || T.unknownErr : null;

  const me = appState.currentUser;
  // el servidor acredita al usuario autenticado: solo una persona astronauta registra, y solo las suyas
  ctx.canAct =
    !!me &&
    (!me.role_code || me.role_code === "ASTRONAUT") &&
    (!ctx.astronautId || Number(me.id) === Number(ctx.astronautId));

  // limpiar estados que ya no aplican
  if (cmState.confirm && !ctx.missions.some((m) => m.code === cmState.confirm.code && isActionable(ctx, m))) cmState.confirm = null;

  paint(ctx);
}

function paint(ctx) {
  const { container } = ctx;
  container.innerHTML = `<div class="av-console av-cm-root"><div class="av-grid">${mainHTML(ctx)}${sideHTML(ctx)}</div></div>`;
  bindRoot(ctx);

  const root = container.querySelector(".av-cm-root");
  if (cmState.focusKey) {
    const el = root.querySelector(`[data-cm-key="${cmState.focusKey}"]`);
    cmState.focusKey = null;
    if (el) el.focus();
  }
  if (cmState.announce) {
    cmState.announce = false;
    // la región ya existe vacía: rellenarla después del pintado hace que se anuncie
    setTimeout(() => {
      const live = root.querySelector("#av-cm-live");
      if (live) live.textContent = cmState.result;
    }, 80);
  }
}

function bindRoot(ctx) {
  const root = ctx.container.querySelector(".av-cm-root");
  if (!root) return;
  ctx.root = root;
  root.addEventListener("click", (ev) => onClick(ev, ctx));
  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t && t.name === "av-cm-reason") cmState.reason = t.value;
  });
}

/* ───────────────────────── columna principal ───────────────────────── */

function mainHTML(ctx) {
  const T = tr(DICT);
  const r = ctx.missionsRes;
  const pct = Number(r.daily_progress_percent) || 0;
  const done = Number(r.completed_or_excused_today) || 0;
  const total = Number(r.total_missions) || ctx.missions.length;
  const dayDate = r.date ? new Date(`${r.date}T00:00:00Z`) : null;
  const doy = dayDate ? gmt(dayDate, false) : "—";
  const dayTxt = doy === "—"
    ? esc(r.date || "—")
    : fmt(esc(T.dayHtml), { doy: `<span class="av-mono">${doy.slice(0, 3)}</span>`, date: `<span class="av-mono">${esc(r.date)}</span>` });

  // agrupar por categoría en el orden definido; las desconocidas al final
  const groups = new Map();
  ctx.missions.forEach((m, i) => {
    const k = m.category || "OTHER";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ m, i });
  });
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  // cada categoría es una sección plegable; por defecto solo se despliegan las que tienen pendientes
  const body = keys.map((k) => {
    const all = groups.get(k);
    const list = cmState.onlyPending ? all.filter(({ m }) => isOutstanding(m)) : all;
    if (!list.length) return "";
    const nDone = all.filter(({ m }) => !isOutstanding(m)).length;
    const nOut = all.length - nDone;
    const open = groupOpen(k, all);
    const gid = `av-cm-g-${esc(k)}`;
    const state = nOut === 0 ? T.groupAllDone : nOut === 1 ? T.groupPendingOne : fmt(T.groupPending, { n: nm(nOut) });
    return `<tbody class="av-cm-gbody${open ? "" : " av-cm-gclosed"}">
      <tr class="av-cm-group"><th scope="colgroup" colspan="5">
        <button type="button" class="av-cm-gtoggle" aria-expanded="${open}" aria-controls="${gid}" data-cm-act="group" data-g="${esc(k)}" data-cm-key="group-${esc(k)}">
          <span class="av-cm-chev av-mono" aria-hidden="true">${open ? "▾" : "▸"}</span>
          <span>${esc(categoryOf(k))}</span>
          <span class="av-mono av-cm-group-n">${nDone}/${all.length}</span>
          <span class="av-cm-gstate${nOut ? " av-cm-gstate-pend" : ""}">${esc(state)}</span>
        </button>
      </th></tr>
    </tbody>
    <tbody id="${gid}" ${open ? "" : "hidden"}>
      ${open ? list.map(({ m, i }) => rowHTML(ctx, m, i)).join("") : ""}
    </tbody>`;
  }).join("");

  const anyOpen = keys.some((k) => groupOpen(k, groups.get(k)));
  const toolbar = ctx.missions.length
    ? `<div class="av-cm-toolbar" role="group" aria-label="${esc(T.caption)}">
        <button type="button" class="av-btn av-cm-filter" aria-pressed="${cmState.onlyPending}" data-cm-act="only-pending" data-cm-key="only-pending">${esc(T.onlyPending)}</button>
        <button type="button" class="av-btn" data-cm-act="${anyOpen ? "collapse-all" : "expand-all"}" data-cm-key="all-groups">${esc(anyOpen ? T.collapseAll : T.expandAll)}</button>
      </div>`
    : "";

  // aviso de pendientes: lo que queda por registrar hoy (las pausadas se cuentan aparte)
  const pend = ctx.missions.filter((m) => m.status_today === ST_PENDING && !isBlocked(m));
  const nBlocked = ctx.missions.filter(isBlocked).length;
  const SHOWN = 3;
  const pendAlert = pend.length || nBlocked
    ? `<div class="av-cm-pend-alert" role="status">
        <div class="av-cm-pend-txt">
          ${pend.length ? `<strong>${esc(pend.length === 1 ? T.pendAlertOne : fmt(T.pendAlertMany, { n: nm(pend.length) }))}</strong>
          <span>${esc(pend.slice(0, SHOWN).map(titleOf).join(", "))}${pend.length > SHOWN ? ` ${esc(fmt(T.pendAlertMore, { n: nm(pend.length - SHOWN) }))}` : ""}.</span>` : ""}
          ${nBlocked ? `<span class="av-sub">${esc(nBlocked === 1 ? T.pendAlertPausedOne : fmt(T.pendAlertPaused, { n: nm(nBlocked) }))}</span>` : ""}
        </div>
        ${pend.length && !cmState.onlyPending ? `<button type="button" class="av-btn" data-cm-act="only-pending" data-cm-key="pend-show">${esc(T.pendAlertShow)}</button>` : ""}
      </div>`
    : "";

  const emptyBody = cmState.onlyPending && ctx.missions.length ? T.noPendingLeft : T.emptyToday;

  const nextIdx = nextIndex(ctx);
  const next = nextIdx >= 0 ? ctx.missions[nextIdx] : null;
  const nPaused = ctx.missions.filter(isBlocked).length;
  const nextStrip = next
    ? `<div class="av-cm-next-strip">
        <span class="av-lbl">${esc(T.nextRec)}</span>
        <span class="av-cm-next-title">${esc(titleOf(next))}</span>
        <span class="av-sub">${esc(categoryOf(next.category))} · <span class="av-mono">+${nm(next.xp_reward)}</span> XP</span>
        <button type="button" class="av-btn" data-cm-act="open" data-i="${nextIdx}" data-cm-key="open-next">${esc(T.open)}</button>
      </div>`
    : `<div class="av-cm-next-strip av-cm-next-none"><span class="av-lbl">${esc(T.nextRec)}</span><span>${esc(T.noneLeft)}${nPaused ? ` <span class="av-sub">${esc(fmt(T.nPaused, { n: nPaused }))}</span>` : ""}</span></div>`;

  const who = (ctx.appState.usersList || []).find((u) => Number(u.id) === Number(ctx.astronautId));
  const readOnly = ctx.canAct
    ? ""
    : ctx.astronautId
      ? `<div class="av-cm-banner" role="note">${fmt(T.roHtmlWho, { who: who ? `${esc(who.full_name)} <span class="av-mono">(${esc(who.crew_code)})</span>` : esc(T.roOtherCrew) })}</div>`
      : `<div class="av-cm-banner" role="note">${T.roHtmlNone}</div>`;

  const liveContent = cmState.announce ? "" : esc(cmState.result);

  return `
  <section class="av-col-b" aria-labelledby="av-cm-title">
    <section class="av-panel">
      <div class="av-panel-head">
        <div>
          <h2 class="av-h2" id="av-cm-title">${esc(T.pageTitle)}</h2>
          <div class="av-sub">${dayTxt} · ${esc(T.resetNote)}</div>
        </div>
        <div class="av-cm-head-prog"><span class="av-lbl">${esc(T.today)}</span> <span class="av-mono">${done}/${total} · ${esc(fmt(T.pct, { n: nm(pct) }))}</span></div>
      </div>
      ${readOnly}
      ${pendAlert}
      ${nextStrip}
      <div id="av-cm-live" class="av-cm-live" role="status" aria-live="polite">${liveContent}</div>
      ${toolbar}
      <div class="av-hscroll">
        <table class="av-table av-cm-table">
          <caption class="av-cm-sr">${esc(T.caption)}</caption>
          <thead><tr>
            <th scope="col" style="padding-left:12px">${esc(T.thStatus)}</th>
            <th scope="col">${esc(T.thCm)}</th>
            <th scope="col" class="av-cm-cat">${esc(T.thCategory)}</th>
            <th scope="col" style="text-align:right">${esc(T.thReward)}</th>
            <th scope="col">${esc(T.thAction)}</th>
          </tr></thead>
          ${body || `<tbody><tr><td colspan="5" class="av-sub" style="padding:12px">${esc(emptyBody)}</td></tr></tbody>`}
        </table>
      </div>
      <p class="av-sub av-cm-legend">${T.legendHtml}</p>
    </section>
  </section>`;
}

function rowHTML(ctx, m, i) {
  const T = tr(DICT);
  const st = statusInfo(ctx, m);
  const open = cmState.open.has(m.code);
  const isNext = i === nextIndex(ctx);
  const blocked = isBlocked(m);
  const done = m.status_today === ST_DONE || m.status_today === ST_EXCUSED;

  let action;
  if (blocked) action = `<span class="av-sub">${esc(T.unavailable)}</span>`;
  else if (isActionable(ctx, m) && ctx.canAct) action = `<button type="button" class="av-btn" data-cm-act="ask-complete" data-i="${i}" data-cm-key="row-complete-${i}">${esc(T.complete)}</button>`;
  else if (isQueued(ctx, m)) action = `<span class="av-sub">${esc(T.sendsOnReconnect)}</span>`;
  else if (isActionable(ctx, m)) action = `<span class="av-sub">${esc(T.readOnly)}</span>`;
  else action = `<span class="av-sub"><span aria-hidden="true">—</span><span class="av-cm-sr">${esc(T.noActions)}</span></span>`;

  const cls = ["av-cm-row", isNext ? "av-cm-next" : "", blocked ? "av-cm-blocked" : "", done ? "av-cm-done" : ""].filter(Boolean).join(" ");
  return `
  <tr class="${cls}">
    <td class="av-cm-st"><span class="av-badge ${st.cls}" aria-hidden="true">${st.mark}</span><span class="av-cm-st-txt">${esc(st.text)}</span></td>
    <td class="av-cm-mcell">
      <button type="button" class="av-link-row av-cm-toggle" aria-expanded="${open}" aria-controls="av-cm-d-${i}" data-cm-act="toggle" data-i="${i}" data-cm-key="toggle-${i}">
        <span class="av-cm-chev av-mono" aria-hidden="true">${open ? "▾" : "▸"}</span>
        <span class="av-cm-tcol">
          <span class="av-cm-title">${esc(titleOf(m))}</span>
          ${isNext ? `<span class="av-cm-tag">${esc(T.nextRec)}</span>` : ""}
          ${blocked ? `<span class="av-cm-reason">${esc(T.blockedReason)}</span>` : ""}
        </span>
      </button>
    </td>
    <td class="av-cm-cat av-sub">${esc(categoryOf(m.category))}</td>
    <td class="av-num av-cm-xp">+${nm(m.xp_reward)} <span class="av-cm-unit">XP</span></td>
    <td class="av-cm-act">${action}</td>
  </tr>
  <tr class="av-cm-detail" id="av-cm-d-${i}" ${open ? "" : "hidden"}><td colspan="5">${open ? detailHTML(ctx, m, i) : ""}</td></tr>`;
}

function detailHTML(ctx, m, i) {
  const T = tr(DICT);
  const blocked = isBlocked(m);
  const route = MISSION_ROUTE[m.code];
  const goBtn = route
    ? `<button type="button" class="av-btn" data-cm-act="go" data-section="${esc(route)}" data-cm-key="go-${i}">${esc(fmt(T.goTo, { s: T.section[route] || route }))}</button>`
    : "";

  let actions = "";
  if (blocked) {
    actions = `<div class="av-cm-blockbox" role="note">
        <div><span class="av-badge av-b-A" aria-hidden="true">${esc(T.markPaused)}</span> <strong>${esc(T.pausedStrong)}</strong></div>
        <p>${esc(T.pausedBody)}</p>
        <div class="av-cm-actions"><button type="button" class="av-btn" data-cm-act="go" data-section="alerts-center" data-cm-key="go-alerts-${i}">${esc(T.viewAlerts)}</button></div>
      </div>`;
  } else if (isActionable(ctx, m) && ctx.canAct) {
    const c = cmState.confirm && cmState.confirm.code === m.code ? cmState.confirm.mode : null;
    if (c === "complete") {
      actions = `<div class="av-cm-confirm" role="group" aria-labelledby="av-cm-cq-${i}">
          <p id="av-cm-cq-${i}">${fmt(T.confirmHtml, { title: esc(titleOf(m)), xp: `<span class="av-mono">+${nm(m.xp_reward)}</span>` })}</p>
          <div class="av-cm-actions">
            <button type="button" class="av-btn av-btn-primary" data-cm-act="do-complete" data-i="${i}" data-cm-key="do-complete-${i}">${esc(T.yesDone)}</button>
            <button type="button" class="av-btn" data-cm-act="cancel" data-i="${i}" data-cm-key="cancel-${i}">${esc(T.cancel)}</button>
          </div>
        </div>`;
    } else if (c === "excuse") {
      // el foco va a la opción marcada (la del último motivo usado), no siempre a la primera
      const checkedId = EXCUSE_IDS.includes(cmState.reason) ? cmState.reason : EXCUSE_IDS[0];
      const radios = EXCUSE_IDS.map((id) => `<label class="av-cm-radio"><input type="radio" name="av-cm-reason" value="${id}" ${checkedId === id ? `checked data-cm-key="reason-${i}"` : ""} /> <span>${esc(T.excuse[id])}</span></label>`).join("");
      actions = `<div class="av-cm-confirm">
          <fieldset>
            <legend><strong>${esc(fmt(T.excuseLegend, { title: titleOf(m) }))}</strong></legend>
            <p class="av-sub">${esc(T.excuseHelp)}</p>
            ${radios}
          </fieldset>
          <div class="av-cm-actions">
            <button type="button" class="av-btn av-btn-primary" data-cm-act="do-excuse" data-i="${i}" data-cm-key="do-excuse-${i}">${esc(T.confirmExcuse)}</button>
            <button type="button" class="av-btn" data-cm-act="cancel" data-i="${i}" data-cm-key="cancel-${i}">${esc(T.cancel)}</button>
          </div>
        </div>`;
    } else {
      actions = `<div class="av-cm-actions">
          <button type="button" class="av-btn av-btn-primary" data-cm-act="ask-complete" data-i="${i}" data-cm-key="ask-complete-${i}">${esc(T.complete)}</button>
          <button type="button" class="av-btn" data-cm-act="ask-excuse" data-i="${i}" data-cm-key="ask-excuse-${i}" title="${esc(T.excuseBtnTitle)}">${esc(T.excuseBtn)}</button>
          ${goBtn}
        </div>`;
    }
  } else {
    let note = "";
    const at = (iso) => `<span class="av-mono">${gmtOf(iso)}</span>`;
    if (m.status_today === ST_DONE) note = fmt(esc(T.doneNote), { t: at(m.completed_at) });
    else if (m.status_today === ST_EXCUSED) note = fmt(esc(T.excNote), { at: m.completed_at ? fmt(esc(T.excAt), { t: at(m.completed_at) }) : "" });
    else if (isQueued(ctx, m)) note = esc(T.queuedNote);
    else if (!ctx.canAct) note = esc(T.onlyAstro);
    actions = `${note ? `<p class="av-sub">${note}</p>` : ""}${goBtn ? `<div class="av-cm-actions">${goBtn}</div>` : ""}`;
  }

  return `<div class="av-cm-detail-in">
      ${m.description ? `<p>${esc(btLines(m.description))}</p>` : ""}
      ${m.educational_content ? `<div class="av-cm-edu"><div class="av-lbl">${esc(T.whyMatters)}</div><p>${esc(btLines(m.educational_content))}</p></div>` : ""}
      ${m.contraindicated_on_critical_alert && !blocked ? `<p class="av-sub">${esc(T.autoPause)}</p>` : ""}
      <dl class="av-cm-meta">
        <div><dt>${esc(T.code)}</dt><dd class="av-mono">${esc(m.code)}</dd></div>
        <div><dt>${esc(T.thCategory)}</dt><dd>${esc(categoryOf(m.category))}</dd></div>
        <div><dt>${esc(T.thReward)}</dt><dd><span class="av-mono">+${nm(m.xp_reward)}</span> XP ${esc(T.serverAssigned)}</dd></div>
      </dl>
      ${actions}
    </div>`;
}

/* ───────────────────────── columna lateral ───────────────────────── */

function sideHTML(ctx) {
  const T = tr(DICT);
  const r = ctx.missionsRes;
  const pct = Number(r.daily_progress_percent) || 0;
  const total = Number(r.total_missions) || ctx.missions.length;
  const nDone = ctx.missions.filter((m) => m.status_today === ST_DONE).length;
  const nExc = ctx.missions.filter((m) => m.status_today === ST_EXCUSED).length;
  const nPaused = ctx.missions.filter(isBlocked).length;
  const nPend = ctx.missions.filter((m) => m.status_today === ST_PENDING && !isBlocked(m)).length;
  const pctUnit = getLang() === "es" ? " %" : "%";

  const progress = `
    <section class="av-panel">
      <div class="av-panel-head"><h2 class="av-h2">${esc(T.progressToday)}</h2></div>
      <div class="av-cm-pad">
        <div class="av-cm-kv"><span class="av-big">${nm(pct)}<span class="av-cm-unit">${pctUnit}</span></span><span class="av-sub">${fmt(esc(T.doneOfTotal), { done: `<span class="av-mono">${nm(r.completed_or_excused_today)}</span>`, total: `<span class="av-mono">${nm(total)}</span>` })}</span></div>
        ${bar(pct, T.barToday)}
        <dl class="av-cm-dl">
          <dt>${esc(T.dlDone)}</dt><dd>${nDone}</dd>
          <dt>${esc(T.dlExcused)}</dt><dd>${nExc}</dd>
          <dt>${esc(T.dlPaused)}</dt><dd>${nPaused}</dd>
          <dt>${esc(T.dlPending)}</dt><dd>${nPend}</dd>
        </dl>
      </div>
    </section>`;

  if (!ctx.prof) {
    return `<aside class="av-col-c" aria-label="${esc(T.asideAria)}">
      ${progress}
      <section class="av-panel av-cm-pad">
        <h2 class="av-h2">${esc(T.profTitle)}</h2>
        <p style="margin:0">${esc(T.profFail)}${ctx.profError ? `: ${esc(ctx.profError)}` : ""}.</p>
        <div><button type="button" class="av-btn" data-cm-act="reload" data-cm-key="reload">${esc(T.retry)}</button></div>
      </section>
      ${ethicHTML(null)}
    </aside>`;
  }

  const p = ctx.prof;
  const li = p.level_info || { current_level: "Cadet", total_xp: 0, next_level: "Explorer", next_level_xp: 120, level_progress_percent: 0 };
  const idx = levelIndex(li);
  const isMax = idx >= LEVELS.length - 1 || li.next_level === li.current_level;
  const missing = Math.max(0, Number(li.next_level_xp) - Number(li.total_xp));
  const levelRows = LEVELS.map((l, k) => {
    const cls = k < idx ? "av-step-done" : k === idx ? "av-step-active" : "av-step-todo";
    const tag = k < idx ? T.tagPassed : k === idx ? T.tagCurrent : "";
    return `<li class="av-step ${cls}"${k === idx ? ' aria-current="step"' : ""}><span>${esc(l.name)}${tag ? ` <span class="av-sub">· ${esc(tag)}</span>` : ""}</span><span class="av-mono av-sub">${nm(l.xp)} XP</span></li>`;
  }).join("");

  const level = `
    <section class="av-panel">
      <div class="av-panel-head"><h2 class="av-h2">${esc(T.level)}</h2><span class="av-sub">${fmt(esc(T.levelOf), { n: `<span class="av-mono">${idx + 1}</span>`, total: `<span class="av-mono">${LEVELS.length}</span>` })}</span></div>
      <div class="av-cm-pad">
        <div class="av-cm-kv"><span class="av-cm-level-name">${esc(bt(li.current_level))}</span><span class="av-mono av-cm-xp-total">${nm(li.total_xp)} XP</span></div>
        ${isMax
          ? `<p class="av-sub" style="margin:0">${esc(T.maxLevel)}</p>`
          : `${bar(li.level_progress_percent, fmt(T.progressTo, { next: bt(li.next_level) }))}
             <div class="av-sub">${fmt(esc(T.xpMissing), { range: `<span class="av-mono">${nm(li.total_xp)} / ${nm(li.next_level_xp)}</span>`, m: `<span class="av-mono">${nm(missing)}</span>`, next: esc(bt(li.next_level)) })}</div>`}
        <ol class="av-steps av-cm-levels" aria-label="${esc(T.levelsAria)}">${levelRows}</ol>
      </div>
    </section>`;

  const streak = `
    <section class="av-panel">
      <div class="av-panel-head"><h2 class="av-h2">${esc(T.consistency)}</h2></div>
      <div class="av-cm-pad">
        <div class="av-cm-kv"><span class="av-big">${nm(p.active_streak_days)}<span class="av-cm-unit"> d</span></span><span class="av-sub">${esc(T.activeStreak)}</span></div>
        <p class="av-sub" style="margin:0">${esc(T.streakNote)}</p>
        <dl class="av-cm-dl">
          <dt>${esc(T.routines)}</dt><dd>${nm(p.routines_completed_count)}</dd>
          <dt>${esc(T.modules)}</dt><dd>${nm(p.learning_modules_completed)}</dd>
          <dt>${esc(T.followups)}</dt><dd>${nm(p.followups_completed)}</dd>
        </dl>
        ${p.reminders_paused_for_operations ? `<p class="av-sub" style="margin:0">${esc(T.remindersPaused)}</p>` : ""}
      </div>
    </section>`;

  const badges = Array.isArray(p.badges) ? p.badges.slice() : [];
  badges.sort((a, b) => (b.earned ? 1 : 0) - (a.earned ? 1 : 0));
  const nEarned = badges.filter((b) => b.earned).length;
  const badgeItems = badges.map((b) => `
      <li class="${b.earned ? "av-cm-earned" : "av-cm-locked"}">
        <span class="av-badge ${b.earned ? "av-b-A" : "av-b-N"}" aria-hidden="true">${b.earned ? "✓" : "–"}</span>
        <div>
          <div class="av-cm-bname">${esc(badgeNameOf(b))}</div>
          <div class="av-sub">${b.earned ? `${esc(T.earned)}${b.awarded_at ? ` <span class="av-mono">${gmtOf(b.awarded_at)}</span> GMT` : ""}` : esc(T.notEarned)}${b.description ? ` · ${esc(bt(b.description))}` : ""}</div>
          <div class="av-sub">${b.earned ? esc(bt(b.awarded_reason || "")) : esc(fmt(T.criteria, { c: bt(b.criteria_description) || "—" }))}</div>
        </div>
      </li>`).join("");

  // plegada por defecto: con muchas insignias la lista desbordaba la columna lateral
  const bOpen = cmState.badgesOpen && badges.length > 0;
  const badgesPanel = `
    <section class="av-panel">
      <div class="av-panel-head"><h2 class="av-h2">${esc(T.badges)}</h2><span class="av-sub">${fmt(esc(T.earnedOf), { n: `<span class="av-mono">${nEarned}</span>`, total: `<span class="av-mono">${badges.length}</span>` })}</span></div>
      ${badges.length
        ? `<button type="button" class="av-link-row av-cm-btoggle" aria-expanded="${bOpen}" aria-controls="av-cm-badge-list" data-cm-act="badges" data-cm-key="badges">
            <span class="av-cm-chev av-mono" aria-hidden="true">${bOpen ? "▾" : "▸"}</span><span>${esc(bOpen ? T.hideBadges : T.showBadges)}</span>
          </button>
          <ul class="av-cm-badges" id="av-cm-badge-list" ${bOpen ? "" : "hidden"}>${bOpen ? badgeItems : ""}</ul>`
        : `<ul class="av-cm-badges"><li class="av-sub">${esc(T.noBadges)}</li></ul>`}
    </section>`;

  return `<aside class="av-col-c" aria-label="${esc(T.asideAria)}">${progress}${level}${streak}${badgesPanel}${ethicHTML(p.ethical_gamification_policy)}</aside>`;
}

function ethicHTML(policy) {
  const T = tr(DICT);
  return `<div class="av-cm-ethic">
      <p class="av-sub" style="margin:0">${T.ethicHtml}</p>
      ${policy ? `<details class="av-cm-details"><summary>${esc(T.fullPolicy)}</summary><p class="av-sub">${esc(btLines(policy))}</p></details>` : ""}
    </div>`;
}

/* ───────────────────────── eventos ───────────────────────── */

async function onClick(ev, ctx) {
  const el = ev.target.closest("[data-cm-act]");
  if (!el || !ctx.root || !ctx.root.contains(el)) return;
  const act = el.getAttribute("data-cm-act");
  const i = Number(el.getAttribute("data-i"));
  const m = Number.isInteger(i) && i >= 0 ? ctx.missions?.[i] : null;

  if (act === "reload") {
    cmState.focusKey = null;
    await renderCountermeasuresView(ctx.container, ctx.appState, ctx.helpers);
    return;
  }
  if (act === "go") {
    const sec = el.getAttribute("data-section");
    if (sec) ctx.helpers.navigateToSection(sec);
    return;
  }
  if (act === "badges") {
    cmState.badgesOpen = !cmState.badgesOpen;
    cmState.focusKey = "badges";
    paint(ctx);
    return;
  }
  if (act === "group") {
    const k = el.getAttribute("data-g");
    const list = ctx.missions.map((mm, j) => ({ m: mm, i: j })).filter(({ m: mm }) => (mm.category || "OTHER") === k);
    cmState.groups.set(k, !groupOpen(k, list));
    cmState.focusKey = `group-${k}`;
    paint(ctx);
    return;
  }
  if (act === "expand-all" || act === "collapse-all") {
    const open = act === "expand-all";
    ctx.missions.forEach((mm) => cmState.groups.set(mm.category || "OTHER", open));
    cmState.focusKey = "all-groups";
    paint(ctx);
    return;
  }
  if (act === "only-pending") {
    cmState.onlyPending = !cmState.onlyPending;
    // al filtrar, desplegar las categorías con pendientes para que se vean de inmediato
    if (cmState.onlyPending) {
      ctx.missions.forEach((mm) => { if (isOutstanding(mm)) cmState.groups.set(mm.category || "OTHER", true); });
    }
    cmState.focusKey = "only-pending";
    paint(ctx);
    return;
  }
  if (!m || cmState.busy) return;

  if (act === "toggle") {
    if (cmState.open.has(m.code)) {
      cmState.open.delete(m.code);
      if (cmState.confirm && cmState.confirm.code === m.code) cmState.confirm = null;
    } else {
      cmState.open.add(m.code);
    }
    cmState.focusKey = `toggle-${i}`;
    paint(ctx);
  } else if (act === "open") {
    cmState.open.add(m.code);
    cmState.groups.set(m.category || "OTHER", true);
    if (cmState.onlyPending && !isOutstanding(m)) cmState.onlyPending = false;
    cmState.focusKey = `toggle-${i}`;
    paint(ctx);
    const row = ctx.container.querySelector(`[data-cm-key="toggle-${i}"]`);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: "center" });
  } else if (act === "ask-complete" || act === "ask-excuse") {
    if (!ctx.canAct || !isActionable(ctx, m)) return;
    cmState.open.add(m.code);
    cmState.confirm = { code: m.code, mode: act === "ask-complete" ? "complete" : "excuse" };
    cmState.focusKey = act === "ask-complete" ? `do-complete-${i}` : `reason-${i}`;
    paint(ctx);
  } else if (act === "cancel") {
    cmState.confirm = null;
    cmState.focusKey = `ask-complete-${i}`;
    paint(ctx);
  } else if (act === "do-complete" || act === "do-excuse") {
    await submitMission(ctx, m, i, act === "do-complete" ? ST_DONE : ST_EXCUSED);
  }
}

async function submitMission(ctx, m, i, mode) {
  if (cmState.busy || !ctx.canAct || !isActionable(ctx, m)) return;
  const T = tr(DICT);
  cmState.busy = true;
  ctx.root.querySelectorAll('[data-cm-act^="do-"], [data-cm-act="cancel"]').forEach((b) => { b.disabled = true; });
  const live = ctx.root.querySelector("#av-cm-live");
  if (live) live.textContent = T.logging;

  const title = titleOf(m);
  const prevLevel = ctx.prof && ctx.prof.level_info ? ctx.prof.level_info.current_level : null;
  let msg;
  try {
    const reasonId = EXCUSE_IDS.includes(cmState.reason) ? cmState.reason : EXCUSE_IDS[0];
    const note = mode === ST_EXCUSED
      ? fmt(T.apiNoteExcused, { r: T.excuse[reasonId] })
      : T.apiNoteDone;
    const res = (await apiService.completeDailyMission(m.code, mode, note)) || {};
    const T2 = tr(DICT);

    if (res.queued_offline) {
      cmState.queued.add(queueKey(ctx, m));
      msg = fmt(T2.msgQueued, { t: title, n: res.queue_size ?? "?" });
    } else if (res.already_recorded_today) {
      msg = fmt(T2.msgAlready, { t: title, m: bt(res.reinforcement_message) || T2.msgAlreadyDefault });
    } else if (mode === ST_EXCUSED) {
      msg = fmt(T2.msgExcused, { t: title, m: bt(res.reinforcement_message) || T2.msgExcusedDefault });
    } else {
      msg = fmt(T2.msgDone, { t: title, xp: nm(res.xp_awarded), m: bt(res.reinforcement_message) || "" }).trim();
      const nb = Array.isArray(res.newly_awarded_badges) ? res.newly_awarded_badges : [];
      if (nb.length) msg += fmt(T2.msgNewBadge, { b: nb.map((b) => T2.badge[b.code] || bt(b.name)).join(", ") });
      const newLevel = res.level_info && res.level_info.current_level;
      if (newLevel && prevLevel && newLevel !== prevLevel) msg += fmt(T2.msgNewLevel, { l: bt(newLevel) });
    }
    cmState.confirm = null;
  } catch (e) {
    const T2 = tr(DICT);
    msg = fmt(T2.msgFail, { t: title, e: bt(e && e.message) || T2.unknownErr });
  } finally {
    cmState.busy = false;
  }

  // El toast global (role="status" dentro de un contenedor aria-live) ya anuncia el resultado;
  // la región propia solo se anuncia si no hay toast, para no leerlo dos veces.
  let toasted = false;
  try {
    if (ctx.helpers && typeof ctx.helpers.showToast === "function") {
      ctx.helpers.showToast(msg);
      toasted = true;
    }
  } catch {
    toasted = false;
  }

  cmState.result = msg;
  cmState.lang = getLang();
  // Si la persona cambió de pestaña o de tripulante mientras se registraba, no repintar esta vista
  // encima de la otra (el contenedor es compartido); solo refrescar la cabecera global.
  if (!stale(ctx)) {
    cmState.announce = !toasted;
    cmState.focusKey = `toggle-${i}`;
    await renderCountermeasuresView(ctx.container, ctx.appState, ctx.helpers);
  } else {
    cmState.announce = false;
    cmState.focusKey = null;
  }
  try {
    await ctx.helpers.refreshGlobalHeaderAndSummary();
  } catch {
    /* la cabecera global se actualizará en la próxima navegación */
  }
}
