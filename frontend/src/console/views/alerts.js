/*
 * SEMSA · Consola de salud · Vista "Alertas" (resumen C&W)
 *
 * Resumen de alertas críticas y de precaución según ISS SSP 50313 §11 y NASA-STD-3001 Vol. 2:
 *  - columnas Estado (ALARM/NORM), Clase (W crítico, C precaución, A vigilar; ver alert-classes.js), ACK (X),
 *    Mensaje y GMT DDD/HH:MM:SS
 *  - orden: condición activa primero, luego clase (W > C > A) y hora (la más reciente arriba)
 *  - las de vigilancia (A) se ocultan por defecto con un botón para mostrarlas
 *  - una alerta nueva (sin reconocer) aparece siempre, aunque un filtro la excluya
 *  - reconocer o resolver nunca borra: la alerta queda en el historial
 *  - desde la alerta se llega al procedimiento en un paso (panel de detalle)
 *  - el color nunca va solo: siempre letra o texto
 *
 * Reemplaza a renderAlertsCenter (app.js) y conserva todas sus funciones: listado,
 * explicación, acción inmediata, seguimiento recomendado, reconocer, resolver, escalar,
 * contactar al líder en Tierra (prefill de mensaje) e historial de actuaciones.
 *
 * Importante: el contenedor de secciones es compartido y console.js tiene listeners
 * delegados que reaccionan a [data-act], [data-nav] y form[data-form] dentro de
 * cualquier .av-console. Por eso esta vista usa solo atributos data-al-* y sus
 * listeners viven en su propio nodo raíz (se descartan con él al cambiar de sección).
 *
 * Idiomas: textos en DICT (es / en), resueltos en cada pintado con tr(DICT). El sondeo
 * se reinicia en cada render, así que un cambio de idioma lo recoge al volver a pintar.
 */
import { escapeHtml, gmt, badge, RANK, ruleOf } from "../console.js";
import { apiService } from "../../services/api.js";
import { tr, fmt } from "../../i18n/i18n.js";
import { bt, btLines } from "/src/i18n/backend.js";
import { CLS, ALERT_CLASSES, STATE_WORD, alertClassOf, isAlarm } from "../alert-classes.js";

const esc = escapeHtml;

/* ───────────────────────── vocabulario ───────────────────────── */

const DICT = {
  es: {
    status: {
      NEW: "Nueva · sin reconocer",
      ACKNOWLEDGED: "Reconocida",
      IN_FOLLOWUP: "En seguimiento",
      ESCALATED: "Escalada",
      RESOLVED: "Resuelta",
    },
    priority: { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" },
    quality: { VALIDATED: "Validado", SYNTHETIC_DEMO: "Sintético (demo)", INVALID: "Inválido", UNAVAILABLE: "No disponible" },
    role: { ASTRONAUT: "Tripulación", MISSION_LEADER: "Líder de misión", ADMINISTRATOR: "Administración" },
    followup: {
      FOLLOW_UP_NOTE: "Nota de seguimiento",
      RECHECK_COMPLETED: "Nueva medición hecha",
      RESOLVED: "Marcada como resuelta",
      ESCALATED_TO_FLIGHT_SURGEON: "Escalada al médico de vuelo",
    },
    stateFilter: {
      ACTIVE: "Activas (sin resolver)",
      NEW: "Sin reconocer",
      ACKNOWLEDGED: "Reconocidas",
      IN_FOLLOWUP: "En seguimiento",
      ESCALATED: "Escaladas",
      RESOLVED: "Resueltas",
      ALL: "Todas",
    },
    classFilter: { ALL: "Todas las clases", W: "W · crítico", C: "C · precaución", A: "A · vigilar" },
    userFallback: "Usuario #{id}",
    autoEscalated: "Escalada automática · sin reconocer",
    title: "Resumen de alertas C&W",
    loading: "Cargando…",
    refresh: "Actualizar",
    loadingAlerts: "Cargando alertas…",
    legendHtml: '<span class="av-mono">ALARM</span> condición activa · <span class="av-mono">NORM</span> resuelta ·\n            <span class="av-mono">W</span> crítico · <span class="av-mono">C</span> precaución · <span class="av-mono">A</span> vigilar ·\n            <span class="av-mono">X</span> reconocida. Las alertas nuevas aparecen siempre, aunque un filtro las excluya.',
    detailAria: "Detalle de la alerta",
    loadFail: "No se pudieron cargar las alertas: {msg}",
    retry: "Reintentar",
    noData: "Sin datos",
    yourAlerts: "Tus alertas",
    allCrew: "Toda la tripulación",
    crewFallback: "Tripulante #{id}",
    scopeLine: "{who} · actualizado {t} GMT",
    countersAria: "Contadores de alertas",
    clsActive: "activas · {w}:",
    inAlarm: "En alarma",
    unackWC: "Sin reconocer W/C",
    totalLoaded: "Total cargadas",
    newOther: "Nuevas de otro tripulante",
    filtersAria: "Filtros del resumen",
    fState: "Estado",
    fClass: "Clase",
    fCrew: "Tripulante",
    hideAdv: "Ocultar vigilancia (A)",
    showAdv: "Mostrar vigilancia (A): {n}",
    emptyScope: "No hay alertas registradas en este ámbito.",
    noMatch: "Ninguna alerta coincide con los filtros. Las alertas nuevas aparecerían aquí igualmente.",
    simulated: "SIMULADO",
    newOtherTag: "Nueva · otro tripulante",
    newOutTag: "Nueva · fuera del filtro",
    srAcked: "reconocida",
    srUnacked: "sin reconocer",
    untitled: "Alerta sin título",
    caption: "Resumen de alertas ordenado por condición, clase y hora. Elige una alerta para ver su detalle y procedimiento.",
    thState: "Estado",
    thClass: "Clase",
    thMsg: "Mensaje",
    thHandling: "Gestión",
    detail: "Detalle",
    detailEmpty: "Elige una alerta del resumen para ver qué pasó, el procedimiento y las acciones.",
    noImmediate: "Sin acción inmediata registrada.",
    evGenerated: "Alerta generada",
    rulesEngine: "Motor de reglas",
    evAcked: "Reconocida (ACK)",
    ackLabel: "Qué hiciste o vas a hacer",
    ackDefault: "Alerta revisada; aplico la acción inmediata.",
    ackBtn: "Reconocer (ACK)",
    fuType: "Tipo de seguimiento",
    fuNote: "Nota de seguimiento",
    fuRecheck: "Volví a medir",
    fuResolve: "Marcar como resuelta",
    notes: "Notas",
    fuPh: "Ej.: medición de control dentro del rango.",
    fuBtn: "Registrar seguimiento",
    escLabel: "Motivo para el médico de vuelo",
    escDefault: "Solicito evaluación del médico de vuelo.",
    escIf: "Escala de inmediato si los síntomas empeoran, aparecen síntomas nuevos o el valor sigue fuera de límite tras la acción.",
    escBtn: "Escalar al médico de vuelo",
    noteResolved: "Resuelta. La alerta queda en el historial: reconocer o resolver nunca la borra.",
    noteAutoEsc: "Escalada automáticamente al médico de vuelo por el motor de reglas (aviso crítico). Nadie la ha reconocido todavía: reconócela (ACK) con lo que hiciste.",
    noteEscalated: "Escalada al médico de vuelo. Puedes seguir registrando seguimiento.",
    alertN: "Alerta #{id}",
    classLine: "Clase {c} · {w}",
    kvIndicator: "Indicador",
    kvRule: "Regla",
    kvPriority: "Prioridad",
    kvQuality: "Calidad del dato",
    kvEnv: "Entorno · fase",
    kvCreated: "Creada",
    kvUpdated: "Actualizada",
    whatHappened: "Qué pasó",
    noExplanation: "Sin explicación registrada.",
    procedure: "Procedimiento",
    immediate: "Acción inmediata",
    recFollowup: "Seguimiento recomendado",
    recFollowupDefault: "Vuelve a medir en el siguiente control programado.",
    openCrewConsole: "Abrir la consola de este tripulante",
    openConsole: "Abrir la consola de salud",
    remeasure: "Volver a medir",
    openMessages: "Abrir mensajes sobre esta alerta",
    contactLead: "Contactar al líder en Tierra",
    actions: "Acciones",
    minNote: "Las notas necesitan al menos 3 caracteres. Todo queda en el historial y en la auditoría.",
    history: "Historial",
    annRefreshing: "Actualizando alertas…",
    annRefreshFail: "No se pudieron actualizar las alertas.",
    annRefreshed: "Alertas actualizadas.",
    prefillLeader: "[Consulta sobre Alerta #{id}: {title}] Te escribo para revisar esta alerta contigo.",
    prefillCrew: "[Consulta sobre Alerta #{id}: {title}] Solicito revisión u orientación operativa al equipo en Tierra.",
    filterApplied: "Filtro aplicado: {n} {w} en el resumen.",
    alertOne: "alerta",
    alertMany: "alertas",
    noteMin: "Escribe una nota de al menos 3 caracteres.",
    sending: "Enviando…",
    ackOk: "Alerta #{id} reconocida.",
    badType: "tipo de seguimiento no válido",
    resolvedOk: "Alerta #{id} marcada como resuelta. Queda en el historial.",
    fuOk: "Seguimiento registrado en la alerta #{id}.",
    escOk: "Alerta #{id} escalada al médico de vuelo.",
    actionFail: "No se pudo completar la acción: {msg}",
    newAlert: "Nueva alerta {c} ({w}): {t}{more}.",
    newMore: " y {n} más",
  },
  en: {
    status: {
      NEW: "New · unacknowledged",
      ACKNOWLEDGED: "Acknowledged",
      IN_FOLLOWUP: "In follow-up",
      ESCALATED: "Escalated",
      RESOLVED: "Resolved",
    },
    priority: { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" },
    quality: { VALIDATED: "Validated", SYNTHETIC_DEMO: "Synthetic (demo)", INVALID: "Invalid", UNAVAILABLE: "Unavailable" },
    role: { ASTRONAUT: "Crew", MISSION_LEADER: "Mission lead", ADMINISTRATOR: "Administration" },
    followup: {
      FOLLOW_UP_NOTE: "Follow-up note",
      RECHECK_COMPLETED: "Re-measurement done",
      RESOLVED: "Marked as resolved",
      ESCALATED_TO_FLIGHT_SURGEON: "Escalated to flight surgeon",
    },
    stateFilter: {
      ACTIVE: "Active (unresolved)",
      NEW: "Unacknowledged",
      ACKNOWLEDGED: "Acknowledged",
      IN_FOLLOWUP: "In follow-up",
      ESCALATED: "Escalated",
      RESOLVED: "Resolved",
      ALL: "All",
    },
    classFilter: { ALL: "All classes", W: "W · warning", C: "C · caution", A: "A · advisory" },
    userFallback: "User #{id}",
    autoEscalated: "Auto-escalated · unacknowledged",
    title: "C&W alert summary",
    loading: "Loading…",
    refresh: "Refresh",
    loadingAlerts: "Loading alerts…",
    legendHtml: '<span class="av-mono">ALARM</span> active condition · <span class="av-mono">NORM</span> resolved ·\n            <span class="av-mono">W</span> warning · <span class="av-mono">C</span> caution · <span class="av-mono">A</span> advisory ·\n            <span class="av-mono">X</span> acknowledged. New alerts always appear, even if a filter excludes them.',
    detailAria: "Alert detail",
    loadFail: "Could not load alerts: {msg}",
    retry: "Retry",
    noData: "No data",
    yourAlerts: "Your alerts",
    allCrew: "All crew",
    crewFallback: "Crew member #{id}",
    scopeLine: "{who} · updated {t} GMT",
    countersAria: "Alert counters",
    clsActive: "active {w}:",
    inAlarm: "In alarm",
    unackWC: "Unack W/C",
    totalLoaded: "Total loaded",
    newOther: "New · other crew",
    filtersAria: "Summary filters",
    fState: "Status",
    fClass: "Class",
    fCrew: "Crew member",
    hideAdv: "Hide advisories (A)",
    showAdv: "Show advisories (A): {n}",
    emptyScope: "No alerts recorded in this scope.",
    noMatch: "No alerts match the filters. New alerts would still appear here.",
    simulated: "SIMULATED",
    newOtherTag: "New · other crew member",
    newOutTag: "New · outside filter",
    srAcked: "acknowledged",
    srUnacked: "unacknowledged",
    untitled: "Untitled alert",
    caption: "Alert summary sorted by condition, class and time. Select an alert to see its detail and procedure.",
    thState: "State",
    thClass: "Class",
    thMsg: "Message",
    thHandling: "Handling",
    detail: "Detail",
    detailEmpty: "Select an alert from the summary to see what happened, the procedure and the actions.",
    noImmediate: "No immediate action recorded.",
    evGenerated: "Alert generated",
    rulesEngine: "Rules engine",
    evAcked: "Acknowledged (ACK)",
    ackLabel: "What you did or will do",
    ackDefault: "Alert reviewed; applying the immediate action.",
    ackBtn: "Acknowledge (ACK)",
    fuType: "Follow-up type",
    fuNote: "Follow-up note",
    fuRecheck: "Re-measured",
    fuResolve: "Mark as resolved",
    notes: "Notes",
    fuPh: "E.g. control measurement within range.",
    fuBtn: "Log follow-up",
    escLabel: "Reason for the flight surgeon",
    escDefault: "Requesting flight surgeon evaluation.",
    escIf: "Escalate immediately if symptoms worsen, new symptoms appear or the value stays out of limits after the action.",
    escBtn: "Escalate to flight surgeon",
    noteResolved: "Resolved. The alert stays in the history: acknowledging or resolving never deletes it.",
    noteAutoEsc: "Automatically escalated to the flight surgeon by the rules engine (critical warning). No one has acknowledged it yet: acknowledge it (ACK) with what you did.",
    noteEscalated: "Escalated to the flight surgeon. You can keep logging follow-ups.",
    alertN: "Alert #{id}",
    classLine: "Class {c} · {w}",
    kvIndicator: "Indicator",
    kvRule: "Rule",
    kvPriority: "Priority",
    kvQuality: "Data quality",
    kvEnv: "Environment · phase",
    kvCreated: "Created",
    kvUpdated: "Updated",
    whatHappened: "What happened",
    noExplanation: "No explanation recorded.",
    procedure: "Procedure",
    immediate: "Immediate action",
    recFollowup: "Recommended follow-up",
    recFollowupDefault: "Re-measure at the next scheduled check.",
    openCrewConsole: "Open this crew member's console",
    openConsole: "Open health console",
    remeasure: "Re-measure",
    openMessages: "Open messages about this alert",
    contactLead: "Contact ground lead",
    actions: "Actions",
    minNote: "Notes need at least 3 characters. Everything is kept in the history and the audit log.",
    history: "History",
    annRefreshing: "Refreshing alerts…",
    annRefreshFail: "Could not refresh alerts.",
    annRefreshed: "Alerts refreshed.",
    prefillLeader: "[Query about Alert #{id}: {title}] Writing to review this alert with you.",
    prefillCrew: "[Query about Alert #{id}: {title}] Requesting review or operational guidance from the ground team.",
    filterApplied: "Filter applied: {n} {w} in the summary.",
    alertOne: "alert",
    alertMany: "alerts",
    noteMin: "Write a note of at least 3 characters.",
    sending: "Sending…",
    ackOk: "Alert #{id} acknowledged.",
    badType: "invalid follow-up type",
    resolvedOk: "Alert #{id} marked as resolved. It stays in the history.",
    fuOk: "Follow-up logged on alert #{id}.",
    escOk: "Alert #{id} escalated to the flight surgeon.",
    actionFail: "Could not complete the action: {msg}",
    newAlert: "New {c} alert ({w}): {t}{more}.",
    newMore: " and {n} more",
  },
};

const FOLLOWUP_TYPES = ["FOLLOW_UP_NOTE", "RECHECK_COMPLETED", "RESOLVED"];
const STATE_FILTERS = ["ACTIVE", "NEW", "ACKNOWLEDGED", "IN_FOLLOWUP", "ESCALATED", "RESOLVED", "ALL"];
const CLASS_FILTERS = ["ALL", ...ALERT_CLASSES];
const POLL_MS = 30000;

/* Estado de la vista que se conserva al cambiar de sección y volver */
const ui = {
  state: "ACTIVE",
  cls: "ALL",
  showAdv: false,
  crew: null,
  crewPicked: false,
  selectedId: null,
  busy: false,
  timer: null,
  knownIds: null,
  userId: null,
  sig: null,
  drafts: {},
};

/* Al cambiar de usuario (cerrar sesión y entrar con otro) se vuelve al estado inicial:
 * filtros, selección y borradores no pasan de una cuenta a otra. */
function resetUiFor(appState) {
  const uid = appState.currentUser?.id ?? null;
  if (ui.userId === uid) return;
  Object.assign(ui, { state: "ACTIVE", cls: "ALL", showAdv: false, crew: null, crewPicked: false,
    selectedId: null, knownIds: null, sig: null, drafts: {}, userId: uid });
}

/* ───────────────────────── utilidades ───────────────────────── */

const toDate = (iso) => (iso ? new Date(iso) : null);
const isLeader = (appState) => (appState.currentUser?.role_code || "ASTRONAUT") !== "ASTRONAUT";
const classOf = (a) => alertClassOf(a.operational_state);
/* Sin reconocer: NEW, o ESCALATED por el motor de reglas (las CRITICAL nacen escaladas)
 * sin que nadie haya hecho ACK ni seguimiento. Un escalado manual deja un seguimiento. */
const isUnacked = (a) => a.status === "NEW" ||
  (a.status === "ESCALATED" && !(a.acknowledgements || []).length && !(a.followups || []).length);

function ensureCss() {
  if (document.getElementById("av-al-css")) return;
  const link = document.createElement("link");
  link.id = "av-al-css";
  link.rel = "stylesheet";
  link.href = new URL("./alerts.css", import.meta.url).href;
  document.head.appendChild(link);
}

/* Letra de clase con su palabra para lectores de pantalla (nunca solo color) */
function clsBadge(cls) {
  const w = STATE_WORD[cls];
  return `${badge(cls, w)}<span class="av-al-sr"> ${esc(w)}</span>`;
}
function tag(text, extra = "") {
  return `<span class="av-al-tag ${extra}">${esc(text)}</span>`;
}
function userName(appState, id) {
  const u = (appState.usersList || []).find((x) => Number(x.id) === Number(id));
  if (u) return u.full_name;
  if (appState.currentUser && Number(appState.currentUser.id) === Number(id)) return appState.currentUser.full_name;
  return fmt(tr(DICT).userFallback, { id });
}
function isDemoRule(appState, a) {
  const cat = ruleOf(appState, a.indicator_code);
  return /demo/i.test(String(a.rule_version_label || "")) || /demo/i.test(String(a.rule_code || "")) || Boolean(cat?.rule?.is_demo_rule);
}
function timeHTML(iso) {
  const d = toDate(iso);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return `<time datetime="${esc(d.toISOString())}">${gmt(d)}</time>`;
}

/* ───────────────────────── datos ───────────────────────── */

/* Ámbito por tripulante: la tripulación ve lo suyo; líder y administración, su tripulación */
function scopeId(appState) {
  if (!isLeader(appState)) return appState.selectedAstronautId || appState.currentUser?.id || null;
  return ui.crew && ui.crew !== "ALL" ? Number(ui.crew) : null;
}

async function loadData(ctx) {
  const { appState } = ctx;
  const sid = scopeId(appState);
  // Las alertas nuevas se piden aparte para toda la tripulación autorizada:
  // deben aparecer aunque el filtro de tripulante las excluya (o el límite de 100 del servidor).
  const newScope = isLeader(appState) ? null : sid;
  // ESCALATED también: las CRITICAL nacen escaladas por el motor y siguen sin reconocer
  const [main, fresh, escalated] = await Promise.allSettled([
    apiService.getAlerts(sid),
    apiService.getAlerts(newScope, "NEW"),
    apiService.getAlerts(newScope, "ESCALATED"),
  ]);
  if (main.status === "rejected") throw main.reason;
  const byId = new Map();
  (main.value?.alerts || []).forEach((a) => byId.set(a.id, { a, outOfScope: false }));
  [fresh, escalated].forEach((r) => {
    if (r.status !== "fulfilled") return;
    (r.value?.alerts || []).forEach((a) => {
      if (byId.has(a.id) || !isUnacked(a)) return;
      byId.set(a.id, { a, outOfScope: sid !== null && Number(a.astronaut_id) !== Number(sid) });
    });
  });
  ctx.list = [...byId.values()].map(({ a, outOfScope }) => ({
    a,
    outOfScope,
    cls: classOf(a),
    acked: !isUnacked(a),
    active: a.status !== "RESOLVED",
    t: toDate(a.created_at),
  }));
  ctx.list.sort((x, y) =>
    Number(y.active) - Number(x.active) ||
    RANK[y.cls] - RANK[x.cls] ||
    (y.t?.getTime() || 0) - (x.t?.getTime() || 0));
  ctx.loadedAt = new Date();
  ctx.error = null;
  // Huella de la lista: si cambió (alerta nueva, ACK o resolución hechos en otro sitio),
  // la cabecera global (badge, contadores, barra de alarma) se refresca para coincidir.
  const sig = ctx.list.map((v) => `${v.a.id}:${v.a.status}:${(v.a.acknowledgements || []).length}:${(v.a.followups || []).length}`).sort().join(",");
  const changed = ui.sig !== null && ui.sig !== sig;
  ui.sig = sig;
  return changed;
}

/* Refresca la cabecera global sin bloquear la vista */
function syncHeader(ctx) {
  const fn = ctx.helpers?.refreshGlobalHeaderAndSummary;
  if (typeof fn !== "function") return;
  Promise.resolve().then(fn).catch(() => {
    // la cabecera global se actualizará en la próxima navegación
  });
}

function matchesFilters(v) {
  const s = v.a.status;
  const stateOk = ui.state === "ALL" || (ui.state === "ACTIVE" ? s !== "RESOLVED" : s === ui.state);
  const classOk = ui.cls === "ALL" ? ui.showAdv || v.cls !== CLS.ADVISORY : v.cls === ui.cls;
  return stateOk && classOk && !v.outOfScope;
}
/* Visible = cumple los filtros, o está sin reconocer: esas no se ocultan nunca */
const isVisible = (v) => matchesFilters(v) || !v.acked;
const forcedIn = (v) => !matchesFilters(v) && !v.acked;
/* Texto de gestión: una escalada automática sin ACK lo dice expresamente */
const statusText = (v) => {
  const T = tr(DICT);
  return v.a.status === "ESCALATED" && !v.acked
    ? T.autoEscalated
    : T.status[v.a.status] || v.a.status || "—";
};

/* ───────────────────────── render ───────────────────────── */

export async function renderAlertsView(container, appState, helpers) {
  ensureCss();
  clearInterval(ui.timer);
  ui.busy = false;
  resetUiFor(appState);
  if (isLeader(appState) && !ui.crewPicked) ui.crew = appState.selectedAstronautId ? String(appState.selectedAstronautId) : "ALL";
  const T = tr(DICT);

  container.innerHTML = `
  <div class="av-console av-al-root">
    <div class="av-grid">
      <section class="av-col-b" aria-labelledby="av-al-h">
        <div class="av-panel">
          <div class="av-panel-head">
            <div>
              <h2 id="av-al-h" class="av-h2">${esc(T.title)}</h2>
              <div class="av-sub" data-al-zone="scope">${esc(T.loading)}</div>
            </div>
            <button type="button" class="av-btn av-btn-sm" data-al-act="reload">${esc(T.refresh)}</button>
          </div>
          <div data-al-zone="counters"></div>
          <div data-al-zone="filters"></div>
          <div class="av-hscroll" data-al-zone="table"><p class="av-sub av-al-pad">${esc(T.loadingAlerts)}</p></div>
          <p class="av-sub av-al-legend">
            ${T.legendHtml}
          </p>
        </div>
      </section>
      <aside class="av-al-detail" id="av-al-detail" aria-label="${esc(T.detailAria)}">
        <p class="av-al-status" role="status" aria-live="polite" data-al-live></p>
        <div data-al-zone="detail"></div>
      </aside>
    </div>
  </div>`;

  const root = container.querySelector(".av-al-root");
  const ctx = { container, root, appState, helpers, list: [], loadedAt: null, error: null };
  bind(ctx);
  renderFilters(ctx);
  await reload(ctx, { first: true });
  if (!root.isConnected) return;

  // Sondeo ligero mientras la vista está en pantalla: las alertas nuevas aparecen solas
  ui.timer = setInterval(() => poll(ctx), POLL_MS);
}

function zone(ctx, name) {
  return ctx.root.querySelector(`[data-al-zone="${name}"]`);
}

async function reload(ctx, { first = false, focusDetail = false, headerFresh = false } = {}) {
  const { root } = ctx;
  let changed = false;
  try {
    changed = await loadData(ctx);
  } catch (e) {
    ctx.error = e;
  }
  if (changed && !headerFresh) syncHeader(ctx);
  if (!root.isConnected) return;
  if (ctx.error) {
    const T = tr(DICT);
    zone(ctx, "table").innerHTML = `<div class="av-al-pad" role="alert">${esc(fmt(T.loadFail, { msg: bt(ctx.error.message) }))}
      <div style="margin-top:8px"><button type="button" class="av-btn av-btn-sm" data-al-act="reload">${esc(T.retry)}</button></div></div>`;
    zone(ctx, "scope").textContent = T.noData;
    return;
  }
  // Las alertas ya pintadas no se vuelven a anunciar como nuevas en el sondeo
  if (first || !ui.knownIds) ui.knownIds = new Set();
  ctx.list.forEach((v) => ui.knownIds.add(v.a.id));
  // Mantiene la selección; si no hay, abre la primera alerta visible sin reconocer
  if (ui.selectedId !== null && !ctx.list.some((v) => v.a.id === ui.selectedId)) ui.selectedId = null;
  if (ui.selectedId === null) {
    const firstNew = ctx.list.find((v) => isVisible(v) && !v.acked);
    if (firstNew) ui.selectedId = firstNew.a.id;
  }
  renderAll(ctx);
  if (focusDetail) focusDetailHeading(ctx);
}

function renderAll(ctx) {
  renderScope(ctx);
  renderCounters(ctx);
  renderFilters(ctx);
  renderTable(ctx);
  renderDetail(ctx);
}

function renderScope(ctx) {
  const T = tr(DICT);
  const { appState } = ctx;
  let who = "";
  if (!isLeader(appState)) who = T.yourAlerts;
  else if (!ui.crew || ui.crew === "ALL") who = T.allCrew;
  else {
    const u = (appState.usersList || []).find((x) => String(x.id) === String(ui.crew));
    who = u ? `${u.full_name}${u.crew_code ? ` (${u.crew_code})` : ""}` : fmt(T.crewFallback, { id: ui.crew });
  }
  zone(ctx, "scope").innerHTML = fmt(esc(T.scopeLine), { who: esc(who), t: `<span class="av-mono">${ctx.loadedAt ? gmt(ctx.loadedAt) : "—"}</span>` });
}

function renderCounters(ctx) {
  const T = tr(DICT);
  // Los contadores son del ámbito elegido; las nuevas de otro tripulante se cuentan aparte
  const inScope = ctx.list.filter((v) => !v.outOfScope);
  const others = ctx.list.filter((v) => v.outOfScope).length;
  const act = inScope.filter((v) => v.active);
  const n = (cls) => act.filter((v) => v.cls === cls).length;
  const inAlarm = act.filter((v) => isAlarm(v.cls)).length;
  // Igual que la cabecera global: "sin reconocer" cuenta solo alarmas (W/C)
  const unack = inScope.filter((v) => !v.acked && isAlarm(v.cls)).length;
  const unackA = inScope.filter((v) => !v.acked && v.cls === CLS.ADVISORY).length;
  const clsCounter = (cls) => {
    const c = n(cls);
    const w = STATE_WORD[cls];
    const b = c ? badge(cls, w) : `<span class="av-badge av-al-b0-${cls}" title="${esc(w)}">${cls}</span>`;
    return `<li class="av-al-cnt-cls">${b}<span class="av-al-sr"> ${esc(fmt(T.clsActive, { w }))}</span><span class="av-mono av-al-cnt">${c}</span></li>`;
  };
  zone(ctx, "counters").innerHTML = `
    <ul class="av-al-counters" aria-label="${esc(T.countersAria)}">
      <li><span class="av-lbl">${esc(T.inAlarm)}</span><span class="av-mono av-al-cnt">${inAlarm}</span></li>
      <li><span class="av-lbl">${esc(T.unackWC)}</span><span class="av-mono av-al-cnt">${unack}</span>${unackA ? `<span class="av-sub">+${unackA} A</span>` : ""}</li>
      ${ALERT_CLASSES.map(clsCounter).join("")}
      <li><span class="av-lbl">${esc(T.totalLoaded)}</span><span class="av-mono av-al-cnt">${inScope.length}</span></li>
      ${others ? `<li><span class="av-lbl">${esc(T.newOther)}</span><span class="av-mono av-al-cnt">${others}</span></li>` : ""}
    </ul>`;
}

function renderFilters(ctx) {
  const T = tr(DICT);
  const { appState } = ctx;
  const opt = (pairs, cur) => pairs.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("");
  const astronauts = (appState.usersList || []).filter((u) => u.role_code === "ASTRONAUT");
  const crewSel = isLeader(appState)
    ? `<div class="av-field"><label for="av-al-f-crew">${esc(T.fCrew)}</label>
        <select id="av-al-f-crew" class="av-input" data-al-filter="crew">
          ${opt([["ALL", T.allCrew], ...astronauts.map((u) => [String(u.id), `${u.full_name}${u.crew_code ? ` (${u.crew_code})` : ""}`])], ui.crew)}
        </select></div>`
    : "";
  const advCount = ctx.list.filter((v) => v.cls === CLS.ADVISORY && !v.outOfScope &&
    (ui.state === "ALL" || (ui.state === "ACTIVE" ? v.a.status !== "RESOLVED" : v.a.status === ui.state))).length;
  zone(ctx, "filters").innerHTML = `
    <div class="av-al-filters" role="group" aria-label="${esc(T.filtersAria)}">
      <div class="av-field"><label for="av-al-f-state">${esc(T.fState)}</label>
        <select id="av-al-f-state" class="av-input" data-al-filter="state">${opt(STATE_FILTERS.map((k) => [k, T.stateFilter[k]]), ui.state)}</select></div>
      <div class="av-field"><label for="av-al-f-cls">${esc(T.fClass)}</label>
        <select id="av-al-f-cls" class="av-input" data-al-filter="cls">${opt(CLASS_FILTERS.map((k) => [k, T.classFilter[k]]), ui.cls)}</select></div>
      ${crewSel}
      <div class="av-al-filter-btn">
        <button type="button" class="av-btn av-btn-sm" data-al-act="toggle-adv" aria-pressed="${ui.showAdv}" ${ui.cls !== "ALL" ? "disabled" : ""}>
          ${esc(ui.showAdv ? T.hideAdv : fmt(T.showAdv, { n: advCount }))}</button>
      </div>
    </div>`;
}

function renderTable(ctx) {
  const T = tr(DICT);
  const z = zone(ctx, "table");
  // Conserva el foco si estaba en una fila (p. ej., durante el sondeo)
  const active = document.activeElement;
  const focusedPick = active && z.contains(active) ? active.getAttribute("data-al-pick") : null;
  const leader = isLeader(ctx.appState);
  const rows = ctx.list.filter(isVisible);
  if (!ctx.list.length) {
    z.innerHTML = `<p class="av-sub av-al-pad">${esc(T.emptyScope)}</p>`;
    return;
  }
  if (!rows.length) {
    z.innerHTML = `<p class="av-sub av-al-pad">${esc(T.noMatch)}</p>`;
    return;
  }
  const body = rows.map((v) => {
    const a = v.a;
    const sel = ui.selectedId === a.id;
    const val = `${a.value_recorded ?? ""} ${bt(a.unit ?? "")}`.trim();
    const sub = [
      val ? `<span class="av-mono">${esc(val)}</span>` : "",
      leader ? esc(a.crew_code || a.astronaut_name || "") : "",
      a.is_simulated ? tag(T.simulated) : "",
      forcedIn(v) ? tag(v.outOfScope ? T.newOtherTag : T.newOutTag, "av-al-tag-strong") : "",
    ].filter(Boolean).join(" · ");
    const rowCls = [sel ? "av-al-sel" : "", !v.acked && isAlarm(v.cls) ? "av-row-alarm" : "", !v.active ? "av-al-norm" : ""].join(" ").trim();
    return `<tr class="${rowCls}">
      <td><span class="av-al-state ${v.active ? "av-al-state-on" : ""}">${v.active ? "ALARM" : "NORM"}</span></td>
      <td>${clsBadge(v.cls)}</td>
      <td class="av-mono av-al-ack">${v.acked ? `X<span class="av-al-sr"> ${esc(T.srAcked)}</span>` : `<span class="av-al-sr">${esc(T.srUnacked)}</span>`}</td>
      <td class="av-al-msgcell">
        <button type="button" class="av-link-row av-al-pick" data-al-pick="${Number(a.id)}" aria-controls="av-al-detail" ${sel ? 'aria-current="true"' : ""}>
          <span class="av-al-msg">${esc(bt(a.title) || T.untitled)}</span>
          ${sub ? `<span class="av-sub av-al-msgsub">${sub}</span>` : ""}
        </button>
      </td>
      <td class="av-al-statuscell">${esc(statusText(v))}</td>
      <td class="av-mono av-sub av-al-gmt">${timeHTML(a.created_at)}</td>
    </tr>`;
  }).join("");
  z.innerHTML = `
    <table class="av-table av-al-table">
      <caption class="av-al-sr">${esc(T.caption)}</caption>
      <thead><tr>
        <th scope="col">${esc(T.thState)}</th><th scope="col">${esc(T.thClass)}</th><th scope="col">ACK</th>
        <th scope="col">${esc(T.thMsg)}</th><th scope="col">${esc(T.thHandling)}</th><th scope="col" class="av-al-gmt">GMT</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  if (focusedPick) z.querySelector(`[data-al-pick="${CSS.escape(focusedPick)}"]`)?.focus({ preventScroll: true });
}

function renderDetail(ctx) {
  const T = tr(DICT);
  const z = zone(ctx, "detail");
  const v = ctx.list.find((x) => x.a.id === ui.selectedId);
  if (!v) {
    z.innerHTML = `<section class="av-panel av-al-card"><h2 class="av-h2">${esc(T.detail)}</h2>
      <p class="av-sub" style="margin:0">${esc(T.detailEmpty)}</p></section>`;
    return;
  }
  z.innerHTML = detailHTML(ctx, v);
  restoreDrafts(z);
}

/* Borradores de los formularios del detalle: sobreviven a cualquier repintado de la vista
 * (sondeo, ACK desde la barra global, que vuelve a abrir la sección, o ir y volver). */
const draftKey = (el) => {
  const form = el.closest("form[data-al-form]");
  return form && el.name ? `${form.getAttribute("data-al-id")}|${form.getAttribute("data-al-form")}|${el.name}` : null;
};
function restoreDrafts(z) {
  z.querySelectorAll("form[data-al-form] [name]").forEach((el) => {
    const k = draftKey(el);
    if (k && Object.prototype.hasOwnProperty.call(ui.drafts, k)) el.value = ui.drafts[k];
  });
}
function clearDrafts(id, kind) {
  Object.keys(ui.drafts).forEach((k) => {
    if (k.startsWith(`${id}|${kind}|`)) delete ui.drafts[k];
  });
}

function detailHTML(ctx, v) {
  const T = tr(DICT);
  const { appState } = ctx;
  const a = v.a;
  const id = Number(a.id);
  const cat = ruleOf(appState, a.indicator_code);
  const demo = isDemoRule(appState, a);
  const val = a.value_recorded ?? "—";
  const steps = String(btLines(a.immediate_action) || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const stepsHTML = steps.length > 1
    ? `<ol class="av-al-steps">${steps.map((x) => `<li>${esc(bt(x.replace(/^\d+[.)]\s*/, "")))}</li>`).join("")}</ol>`
    : `<p class="av-al-p">${esc(bt(steps[0]) || T.noImmediate)}</p>`;
  const fmtDate = ctx.helpers.formatDateUTC || ((x) => x);
  const leader = isLeader(appState);
  const clsWord = STATE_WORD[v.cls];

  // Historial: generación, reconocimientos y seguimientos en orden cronológico
  const events = [
    { t: a.created_at, what: T.evGenerated, who: T.rulesEngine, note: `${a.rule_code || ""}${a.rule_version_label ? ` v${a.rule_version_label}` : ""}` },
    ...(a.acknowledgements || []).map((k) => ({ t: k.created_at, what: T.evAcked, who: `${userName(appState, k.user_id)} · ${T.role[k.role_at_time] || k.role_at_time || ""}`, note: k.action_taken })),
    ...(a.followups || []).map((f) => ({ t: f.created_at, what: T.followup[f.action_type] || f.action_type, who: `${userName(appState, f.author_user_id)} · ${T.role[f.author_role] || f.author_role || ""}`, note: f.notes })),
  ].sort((x, y) => (toDate(x.t)?.getTime() || 0) - (toDate(y.t)?.getTime() || 0));

  const busy = ui.busy ? "disabled" : "";
  const ackForm = !v.acked ? `
    <form class="av-al-form" data-al-form="ack" data-al-id="${id}" novalidate>
      <div class="av-field"><label for="av-al-ack-note">${esc(T.ackLabel)}</label>
        <input id="av-al-ack-note" name="note" class="av-input" type="text" required minlength="3" maxlength="500" autocomplete="off"
          value="${esc(T.ackDefault)}" aria-describedby="av-al-min"></div>
      <button type="submit" class="av-btn av-btn-primary" ${busy}>${esc(T.ackBtn)}</button>
    </form>` : "";
  const followForm = v.active ? `
    <form class="av-al-form" data-al-form="followup" data-al-id="${id}" novalidate>
      <div class="av-field"><label for="av-al-fu-type">${esc(T.fuType)}</label>
        <select id="av-al-fu-type" name="type" class="av-input">
          <option value="FOLLOW_UP_NOTE">${esc(T.fuNote)}</option>
          <option value="RECHECK_COMPLETED">${esc(T.fuRecheck)}</option>
          <option value="RESOLVED">${esc(T.fuResolve)}</option>
        </select></div>
      <div class="av-field"><label for="av-al-fu-note">${esc(T.notes)}</label>
        <textarea id="av-al-fu-note" name="note" class="av-input av-al-textarea" rows="2" required minlength="3" maxlength="1000"
          placeholder="${esc(T.fuPh)}" aria-describedby="av-al-min"></textarea></div>
      <button type="submit" class="av-btn" ${busy}>${esc(T.fuBtn)}</button>
    </form>` : "";
  const escForm = v.active && a.status !== "ESCALATED" ? `
    <form class="av-al-form av-al-form-danger" data-al-form="escalate" data-al-id="${id}" novalidate>
      <div class="av-field"><label for="av-al-esc-note">${esc(T.escLabel)}</label>
        <textarea id="av-al-esc-note" name="note" class="av-input av-al-textarea" rows="2" required minlength="3" maxlength="1000"
          aria-describedby="av-al-min av-al-esc-if">${esc(T.escDefault)}</textarea></div>
      <p class="av-sub av-al-p" id="av-al-esc-if">${esc(T.escIf)}</p>
      <button type="submit" class="av-btn av-btn-danger" ${busy}>${esc(T.escBtn)}</button>
    </form>` : "";
  const stateNote = !v.active
    ? `<p class="av-al-p">${esc(T.noteResolved)}</p>`
    : a.status === "ESCALATED" && !v.acked
      ? `<p class="av-al-p">${esc(T.noteAutoEsc)}</p>`
      : a.status === "ESCALATED"
        ? `<p class="av-al-p">${esc(T.noteEscalated)}</p>`
        : "";
  const otherCrew = Number(a.astronaut_id) !== Number(appState.selectedAstronautId);

  return `
  <section class="av-panel av-al-card ${isAlarm(v.cls) ? `av-card-${v.cls}` : ""}" aria-labelledby="av-al-dtitle">
    <div class="av-lbl">${esc(fmt(T.alertN, { id }))}${leader ? ` · ${esc(a.astronaut_name || "")}${a.crew_code ? ` (${esc(a.crew_code)})` : ""}` : ""}</div>
    <h2 id="av-al-dtitle" class="av-al-dtitle" tabindex="-1">${esc(bt(a.title) || T.untitled)}</h2>
    <div class="av-al-tags">
      ${badge(v.cls, clsWord)}<span>${esc(fmt(T.classLine, { c: v.cls, w: clsWord }))}</span>
      ${tag(v.active ? "ALARM" : "NORM", v.active ? "av-al-tag-strong" : "")}
      ${tag(statusText(v))}
      ${a.is_simulated ? tag(T.simulated) : ""}
    </div>
    <div class="av-al-value">
      <span class="av-mono av-al-big ${isAlarm(v.cls) ? `av-val-${v.cls}` : ""}">${esc(val)}</span>
      <span class="av-sub">${esc(bt(a.unit || ""))}</span>
    </div>
    <dl class="av-al-kv">
      <dt>${esc(T.kvIndicator)}</dt><dd>${esc(bt(cat?.name) || a.indicator_code || "—")}</dd>
      <dt>${esc(T.kvRule)}</dt><dd><span class="av-mono">${esc(a.rule_code || "—")}${a.rule_version_label ? ` · v${esc(a.rule_version_label)}` : ""}</span>${demo ? ` ${tag("DEMO")}` : ""}</dd>
      <dt>${esc(T.kvPriority)}</dt><dd>${esc(T.priority[a.priority] || a.priority || "—")}</dd>
      <dt>${esc(T.kvQuality)}</dt><dd>${esc(T.quality[a.data_quality] || a.data_quality || "—")}</dd>
      <dt>${esc(T.kvEnv)}</dt><dd>${esc(a.environment_code || "—")} · ${esc(a.phase_code || "—")}</dd>
      <dt>${esc(T.kvCreated)}</dt><dd><span class="av-mono">${timeHTML(a.created_at)}</span> <span class="av-sub">${esc(fmtDate(a.created_at))}</span></dd>
      <dt>${esc(T.kvUpdated)}</dt><dd><span class="av-mono">${timeHTML(a.updated_at)}</span> <span class="av-sub">${esc(fmtDate(a.updated_at))}</span></dd>
    </dl>
    <div>
      <h3 class="av-h3">${esc(T.whatHappened)}</h3>
      <p class="av-al-p">${esc(bt(a.explanation) || T.noExplanation)}</p>
    </div>
  </section>

  <section class="av-panel av-al-card" aria-labelledby="av-al-proc-h">
    <div class="av-lbl">${esc(T.procedure)}${cat?.rule?.protocol_source ? ` · ${esc(bt(cat.rule.protocol_source))}` : ""}</div>
    <h3 id="av-al-proc-h" class="av-h3">${esc(T.immediate)}</h3>
    ${stepsHTML}
    <h3 class="av-h3">${esc(T.recFollowup)}</h3>
    <p class="av-al-p">${esc(bt(a.followup_recommendation) || T.recFollowupDefault)}</p>
    <div class="av-al-btns">
      <button type="button" class="av-btn av-btn-sm" data-al-act="go-console" data-al-astro="${Number(a.astronaut_id)}">${esc(leader && otherCrew ? T.openCrewConsole : T.openConsole)}</button>
      <button type="button" class="av-btn av-btn-sm" data-al-act="go-measure" data-al-astro="${Number(a.astronaut_id)}">${esc(T.remeasure)}</button>
      <button type="button" class="av-btn av-btn-sm" data-al-act="contact" data-al-id="${id}">${esc(leader ? T.openMessages : T.contactLead)}</button>
    </div>
  </section>

  <section class="av-panel av-al-card" aria-labelledby="av-al-act-h">
    <h3 id="av-al-act-h" class="av-h3">${esc(T.actions)}</h3>
    <p class="av-sub av-al-p" id="av-al-min">${esc(T.minNote)}</p>
    ${stateNote}${ackForm}${followForm}${escForm}
  </section>

  <section class="av-panel av-al-card" aria-labelledby="av-al-hist-h">
    <h3 id="av-al-hist-h" class="av-h3">${esc(T.history)}</h3>
    <ol class="av-al-timeline">
      ${events.map((e) => `<li>
        <div class="av-al-tl-head"><span class="av-mono">${timeHTML(e.t)}</span><strong>${esc(e.what)}</strong></div>
        <div class="av-sub">${esc(e.who)}</div>
        ${e.note ? `<div class="av-al-p">${esc(e.note)}</div>` : ""}
      </li>`).join("")}
    </ol>
  </section>`;
}

/* ───────────────────────── interacción ───────────────────────── */

function announce(ctx, msg) {
  const live = ctx.root.querySelector("[data-al-live]");
  if (!live) return;
  live.textContent = "";
  // pequeño retardo para que el lector de pantalla repita mensajes iguales
  setTimeout(() => { live.textContent = msg; }, 50);
}

function focusDetailHeading(ctx) {
  const h = ctx.root.querySelector("#av-al-dtitle");
  if (!h) return;
  const narrow = window.matchMedia && window.matchMedia("(max-width: 980px)").matches;
  h.focus({ preventScroll: !narrow });
  if (narrow) h.scrollIntoView({ block: "start", behavior: "smooth" });
}

function setBusy(ctx, on) {
  ui.busy = on;
  ctx.root.querySelectorAll("form[data-al-form] button[type=submit]").forEach((b) => { b.disabled = on; });
}

function bind(ctx) {
  const { root, appState, helpers } = ctx;

  root.addEventListener("click", async (ev) => {
    const pick = ev.target.closest("[data-al-pick]");
    if (pick && root.contains(pick)) {
      ui.selectedId = Number(pick.getAttribute("data-al-pick"));
      renderTable(ctx);
      renderDetail(ctx);
      focusDetailHeading(ctx);
      return;
    }
    const btn = ev.target.closest("[data-al-act]");
    if (!btn || !root.contains(btn)) return;
    const act = btn.getAttribute("data-al-act");
    if (act === "reload") {
      announce(ctx, tr(DICT).annRefreshing);
      await reload(ctx);
      if (root.isConnected) announce(ctx, ctx.error ? tr(DICT).annRefreshFail : tr(DICT).annRefreshed);
    } else if (act === "toggle-adv") {
      ui.showAdv = !ui.showAdv;
      renderFilters(ctx);
      renderTable(ctx);
      root.querySelector('[data-al-act="toggle-adv"]')?.focus();
    } else if (act === "go-console" || act === "go-measure") {
      await selectAstronautIfNeeded(ctx, Number(btn.getAttribute("data-al-astro")));
      helpers.navigateToSection(act === "go-console" ? "mission-control" : "my-health-check");
    } else if (act === "contact") {
      const v = ctx.list.find((x) => x.a.id === Number(btn.getAttribute("data-al-id")));
      if (!v) return;
      const T = tr(DICT);
      // Mismo prefill que la vista anterior: lo consume el centro de comunicación.
      // expansion_views.js lo inserta sin escapar dentro de un <textarea>, así que
      // se quitan los caracteres que podrían cerrar la etiqueta o formar entidades.
      const safeTitle = String(bt(v.a.title) || "").replace(/[<>&]/g, "");
      appState.pendingAlertMessagePrefill = fmt(isLeader(appState) ? T.prefillLeader : T.prefillCrew, { id: Number(v.a.id), title: safeTitle });
      appState.pendingAlertCategoryPrefill = "HEALTH_UPDATE";
      helpers.navigateToSection("communication-center");
    }
  });

  const saveDraft = (ev) => {
    const k = draftKey(ev.target);
    if (k) ui.drafts[k] = ev.target.value;
  };
  root.addEventListener("input", saveDraft);

  root.addEventListener("change", async (ev) => {
    saveDraft(ev);
    const sel = ev.target.closest("[data-al-filter]");
    if (!sel || !root.contains(sel)) return;
    const f = sel.getAttribute("data-al-filter");
    if (f === "state") ui.state = sel.value;
    else if (f === "cls") ui.cls = sel.value;
    if (f === "crew") {
      ui.crew = sel.value;
      ui.crewPicked = true;
      ui.sig = null; // otro ámbito: no es un cambio de datos, no hace falta refrescar la cabecera
      zone(ctx, "table").innerHTML = `<p class="av-sub av-al-pad">${esc(tr(DICT).loadingAlerts)}</p>`;
      await reload(ctx);
    } else {
      renderFilters(ctx);
      renderTable(ctx);
    }
    // el filtro se vuelve a pintar: devuelve el foco al mismo control
    root.querySelector(`[data-al-filter="${f}"]`)?.focus();
    if (root.isConnected) {
      const T = tr(DICT);
      const shown = ctx.list.filter(isVisible).length;
      announce(ctx, fmt(T.filterApplied, { n: shown, w: shown === 1 ? T.alertOne : T.alertMany }));
    }
  });

  root.addEventListener("submit", async (ev) => {
    const form = ev.target.closest("form[data-al-form]");
    if (!form || !root.contains(form)) return;
    ev.preventDefault();
    if (ui.busy) return;
    const T = tr(DICT);
    const kind = form.getAttribute("data-al-form");
    const id = Number(form.getAttribute("data-al-id"));
    const fd = new FormData(form);
    const note = String(fd.get("note") || "").trim();
    const noteEl = form.querySelector('[name="note"]');
    if (note.length < 3) {
      noteEl?.setAttribute("aria-invalid", "true");
      noteEl?.focus();
      announce(ctx, T.noteMin);
      return;
    }
    noteEl?.removeAttribute("aria-invalid");
    let okMsg = "";
    setBusy(ctx, true);
    announce(ctx, T.sending);
    try {
      if (kind === "ack") {
        await apiService.acknowledgeAlert(id, note);
        okMsg = fmt(T.ackOk, { id });
      } else if (kind === "followup") {
        const type = String(fd.get("type") || "FOLLOW_UP_NOTE");
        if (!FOLLOWUP_TYPES.includes(type)) throw new Error(T.badType);
        await apiService.followupAlert(id, type, note);
        okMsg = type === "RESOLVED" ? fmt(T.resolvedOk, { id }) : fmt(T.fuOk, { id });
      } else if (kind === "escalate") {
        await apiService.escalateAlert(id, note);
        okMsg = fmt(T.escOk, { id });
      }
    } catch (e) {
      setBusy(ctx, false);
      const msg = fmt(tr(DICT).actionFail, { msg: bt(e.message) });
      if (root.isConnected) announce(ctx, msg);
      else helpers.showToast(msg);
      return;
    }
    setBusy(ctx, false);
    clearDrafts(id, kind);
    try {
      await helpers.refreshGlobalHeaderAndSummary();
    } catch {
      // la cabecera global se actualizará en la próxima navegación
    }
    if (!root.isConnected) {
      helpers.showToast(okMsg);
      return;
    }
    ui.selectedId = id;
    await reload(ctx, { focusDetail: true, headerFresh: true });
    if (root.isConnected) announce(ctx, okMsg);
  });
}

/* Para líder o administración: abre la consola del tripulante de la alerta (mismo
 * patrón que "Inspeccionar" en Crew Monitoring: cambia el selector superior). */
async function selectAstronautIfNeeded(ctx, astronautId) {
  const { appState, helpers } = ctx;
  if (!isLeader(appState) || !astronautId || Number(appState.selectedAstronautId) === astronautId) return;
  appState.selectedAstronautId = astronautId;
  const crewSelect = document.getElementById("topbar-crew-select");
  if (crewSelect) crewSelect.value = String(astronautId);
  try {
    await helpers.refreshGlobalHeaderAndSummary();
  } catch {
    // si falla, la sección destino vuelve a cargar sus datos
  }
}

/* Sondeo: refresca el resumen sin perder lo que se está escribiendo */
async function poll(ctx) {
  const { root } = ctx;
  if (!root.isConnected) {
    clearInterval(ui.timer);
    return;
  }
  if (ui.busy || document.hidden) return;
  const prevSel = ctx.list.find((v) => v.a.id === ui.selectedId);
  const prevStamp = prevSel ? `${prevSel.a.status}|${prevSel.a.updated_at}` : null;
  let changed = false;
  try {
    changed = await loadData(ctx);
  } catch {
    return; // sin enlace: se mantiene la última lista
  }
  if (changed) syncHeader(ctx);
  if (!root.isConnected) return;
  const fresh = ctx.list.filter((v) => !ui.knownIds.has(v.a.id));
  fresh.forEach((v) => ui.knownIds.add(v.a.id));
  renderScope(ctx);
  renderCounters(ctx);
  // los filtros solo se repintan si no se están usando
  if (!zone(ctx, "filters").contains(document.activeElement)) renderFilters(ctx);
  renderTable(ctx);
  const nowSel = ctx.list.find((v) => v.a.id === ui.selectedId);
  const nowStamp = nowSel ? `${nowSel.a.status}|${nowSel.a.updated_at}` : null;
  const dz = zone(ctx, "detail");
  // los borradores se restauran al repintar; solo se espera si se está escribiendo ahora
  const typing = dz.contains(document.activeElement);
  if (nowStamp !== prevStamp && !typing) renderDetail(ctx);
  if (fresh.length) {
    const T = tr(DICT);
    const top = fresh.sort((x, y) => RANK[y.cls] - RANK[x.cls])[0];
    announce(ctx, fmt(T.newAlert, { c: top.cls, w: STATE_WORD[top.cls], t: bt(top.a.title) || "", more: fresh.length > 1 ? fmt(T.newMore, { n: fresh.length - 1 }) : "" }));
  }
}
