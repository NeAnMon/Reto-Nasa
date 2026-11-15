/*
 * AstroVital · Bitácora de misión (sustituye a la antigua sección "Reports")
 *
 * - Columna principal: bitácora cronológica de solo lectura que une
 *   mediciones (GET /health/measurements), alertas con sus reconocimientos y
 *   seguimientos (GET /alerts) e informes exportados. Con rol ADMINISTRATOR
 *   también se leen los eventos de auditoría (GET /audit/events).
 * - Columna lateral: "Exportar informe" (POST /reports/export, PDF/CSV/JSON),
 *   con la justificación que queda registrada en auditoría, igual que antes.
 * - Nota de procedencia de los datos (simulados frente a entrada manual).
 * - "Seguimiento periódico" (masa, visión, medicación, polvo, ánimo y riesgos NASA IMM)
 *   del tripulante seleccionado: logbook-followup.js, montado en #av-log-followup.
 *
 * Los listeners se enlazan a la raíz propia (.av-log-root), que se crea de nuevo
 * en cada render: no se acumulan en el contenedor compartido. No se usan los
 * atributos data-act / data-nav / data-form porque el contenedor tiene un
 * listener delegado de console.js que reacciona a ellos.
 *
 * Idiomas: textos en DICT (es / en), resueltos en cada pintado con tr(DICT).
 */
import { escapeHtml, num, gmt, badge } from "../console.js";
import { LETTER, STATE_WORD, isAlarm } from "../alert-classes.js";
import { apiService } from "../../services/api.js";
import { tr, fmt, fmtNum, getLang } from "../../i18n/i18n.js";
import { bt } from "/src/i18n/backend.js";
import { renderLogbookTrends } from "./logbook-trends.js"; // tendencias por indicador, antes columna del Resumen
import { mountFollowup } from "./logbook-followup.js"; // "Seguimiento periódico" (NASA IMM), antes en el Resumen

const esc = escapeHtml;

const PAGE = 50; // filas que se muestran por bloque
const MEAS_STEP = 100; // mediciones pedidas por bloque al servidor
const MEAS_MAX = 500; // máximo que admite /health/measurements
const AUDIT_LIMIT = 300; // máximo que admite /audit/events

/* ───────────────────────── textos ───────────────────────── */

const DICT = {
  es: {
    defaultJust: "Revisión periódica de misión y respaldo de telemetría DEMO",
    fallbackJust: "Exportación operativa autorizada",
    type: {
      MEAS: "Medición",
      ALERT: "Alerta",
      ACK: "Reconocimiento",
      FUP: "Seguimiento",
      REPORT: "Informe",
      AUDIT: "Auditoría",
    },
    source: {
      MANUAL_ENTRY: "Entrada manual",
      DEMO_SIMULATION: "Simulación (demo)",
      CSV_JSON_IMPORT: "Importación CSV/JSON",
      OFFLINE_QUEUE_SYNC: "Cola sin enlace (sincronizada)",
      INTERACTIVE_SESSION: "Sesión interactiva",
      NONE: "Sin fuente",
    },
    quality: {
      VALIDATED: "validado",
      SYNTHETIC_DEMO: "sintético (demo)",
      INVALID: "inválido",
      UNAVAILABLE: "no disponible",
      ESTIMATED: "estimado",
    },
    priority: { LOW: "baja", MEDIUM: "media", HIGH: "alta", CRITICAL: "crítica", NORMAL: "normal" },
    alertStatus: {
      NEW: "nueva",
      ACKNOWLEDGED: "reconocida",
      IN_FOLLOWUP: "en seguimiento",
      RESOLVED: "resuelta",
      ESCALATED: "escalada",
    },
    followup: {
      FOLLOW_UP_NOTE: "Nota de seguimiento",
      RECHECK_COMPLETED: "Nueva medición realizada",
      RESOLVED: "Alerta resuelta",
      ESCALATED_TO_FLIGHT_SURGEON: "Escalada al médico de vuelo",
    },
    role: {
      ASTRONAUT: "Tripulación",
      MISSION_LEADER: "Liderazgo de misión",
      ADMINISTRATOR: "Administración",
    },
    auditStatus: { SUCCESS: "Correcto", DENIED: "Denegado", FAILED: "Fallido", FAILURE: "Fallido" },
    formats: {
      PDF: { label: "Descargar informe PDF", desc: "Resumen legible: indicadores con estado y fuente, y las últimas 12 alertas." },
      CSV: { label: "Descargar tabla CSV", desc: "Tabla de indicadores: último valor, unidad, estado, fuente, calidad y etiqueta SIMULADO." },
      JSON: { label: "Descargar paquete JSON", desc: "Paquete completo: metadatos, resumen, indicadores, telemetría ambiental y hasta 25 alertas." },
    },
    errKind: { meas: "mediciones", alerts: "alertas", audit: "auditoría" },
    error: "error",
    evOne: "evento",
    evMany: "eventos",
    indicator: "Indicador",
    simulated: "SIMULADO",
    notSimulated: "No simulado",
    qualityNote: "Calidad: {q}",
    alertOf: "Alerta de {name}",
    valueTxt: " · valor {v}",
    alertNote: "{name}{val} · prioridad {p} · estado actual: {s}",
    rulesEngine: "Motor de reglas",
    alertAcked: "Alerta reconocida: {t}",
    fupDefault: "Seguimiento",
    reportExported: "Informe {f} exportado{n}",
    resourceNo: " (n.º {id})",
    reasonNote: "Motivo: {j}",
    success: "Correcto",
    you: "Tú",
    loggedSession: "Registrado en esta sesión",
    filtersAria: "Filtros de la bitácora",
    eventType: "Tipo de evento",
    allOperational: "Todos (operativos)",
    auditAdmin: "Auditoría (administración)",
    allIndicators: "Todos los indicadores",
    from: "Desde (fecha UTC)",
    to: "Hasta (fecha UTC)",
    order: "Orden",
    newestFirst: "Más reciente primero",
    oldestFirst: "Más antiguo primero",
    outOnly: "Solo fuera de límite",
    resetFilters: "Restablecer filtros",
    warnHtml: "<strong>Aviso:</strong> no se pudieron cargar {list}. La bitácora puede estar incompleta.",
    rangeErrHtml: "<strong>Rango no válido:</strong> la fecha «Desde» es posterior a «Hasta».",
    cMeas: "Mediciones",
    cOut: "Mediciones fuera de límite",
    cAlerts: "Alertas",
    cAcks: "Reconocimientos",
    cFups: "Seguimientos",
    cReports: "Informes",
    cAudit: "Auditoría",
    orderAsc: "del más antiguo al más reciente",
    orderDesc: "del más reciente al más antiguo",
    caption: "Bitácora de misión, {order}. Mostrando {a} de {b} {ev}.",
    gmtTitle: "Hora media de Greenwich, día del año/horas:minutos:segundos",
    thType: "Tipo",
    thDetail: "Detalle",
    thState: "Estado",
    thSource: "Fuente",
    thData: "Datos",
    emptyFiltered: "Ningún evento coincide con los filtros. Prueba a ampliar el rango de fechas o a restablecer los filtros.",
    emptyAll: "No hay eventos registrados para este tripulante en la misión seleccionada.",
    showMore: "Mostrar {n} más",
    loadEarlier: "Cargar mediciones anteriores",
    showing: "Mostrando {a} de {b} {ev}.",
    queryNote: "Se consultan las {lim} mediciones más recientes{ind} (máx. {max}) y hasta 100 alertas.",
    ofIndicator: " del indicador elegido",
    exportTitle: "Exportar informe",
    simTitle: "Contiene datos sintéticos de demostración",
    exportIntro: "Informe auditado de la misión. Cada exportación verifica en el servidor los permisos de tu rol y registra un evento en el historial de auditoría.",
    dtCrew: "Tripulante",
    dtMission: "Misión",
    dtPeriod: "Periodo",
    dtCoverage: "Cobertura",
    dtSimulated: "Simulados",
    period: "Desde el inicio de la misión{start} hasta el momento de generación. Lo fija el servidor.",
    coverage: "{v} de datos con calidad suficiente",
    simIncluded: "Incluidos y etiquetados como SIMULADO",
    justLabel: "Motivo o justificación (queda en el registro de auditoría)",
    justHint: "Si lo dejas vacío se registra «Exportación operativa autorizada».",
    formatLegend: "Formato del informe",
    provTitle: "Procedencia de los datos",
    provSimHtml: '<span class="av-log-sim">SIMULADO</span> marca datos sintéticos de demostración (fuente «Simulación (demo)», calidad «sintético»). No proceden de sensores reales.',
    provManualHtml: "<strong>Entrada manual</strong>: valores que registra la tripulación desde la consola o «Registrar medición». Las importaciones CSV/JSON y la cola sin enlace se indican en la columna «Fuente».",
    provAria: "Mediciones cargadas por fuente",
    provLoaded: "Mediciones cargadas",
    provSim: "Simuladas",
    provNotSim: "No simuladas",
    disclaimer: "AstroVital ayuda a observar, registrar y comunicar información de salud; no diagnostica ni sustituye al personal médico.",
    logTitle: "Bitácora de misión",
    logSub: "solo lectura · horas en GMT",
    refresh: "Actualizar",
    loadingInd: "Cargando mediciones del indicador…",
    loadingMeas: "Cargando mediciones…",
    refreshing: "Actualizando bitácora…",
    loading: "Cargando bitácora…",
    selectCrew: "Selecciona un tripulante para ver su bitácora y exportar informes.",
    generating: "Generando informe {f}…",
    exportOk: "Informe {f} generado a las {t} GMT, descargado y registrado en auditoría.",
    exportToast: "Informe {f} generado, descargado y registrado en auditoría.",
    exportFail: "No se pudo exportar el informe {f}: {msg}",
    unknownErr: "error desconocido",
    // Tendencias por indicador (logbook-trends.js)
    trends: {
      title: "Tendencias por indicador",
      sub: "Elige un indicador para ver su serie de la misión",
      listAria: "Indicadores con su tendencia reciente",
      itemAria: "Mostrar su tendencia",
      noTrend: "Sin tendencia",
      noData: "No hay indicadores con datos para este tripulante.",
      loading: "Cargando serie…",
      loadingFull: "Mostrando las últimas mediciones; cargando la serie completa…",
      fallback: "No se pudo cargar la serie completa: se muestran las últimas mediciones del resumen.",
      notEnough: "No hay mediciones suficientes para dibujar la tendencia (mínimo 2).",
      chartRole: "gráfica interactiva",
      help: "Pasa el ratón o toca la gráfica para ver cada medición. Con el teclado: enfócala y usa ← → (Mayús: de 10 en 10), Inicio y Fin.",
      points: "mediciones",
      min: "mín.",
      max: "máx.",
      last: "última",
      value: "Valor",
      baseShort: "Base",
      legendSeries: "Medición",
      legendBase: "Línea base",
      legendY: "Límite precaución (Y)",
      legendR: "Límite crítico (R)",
      bpNote: "Presión arterial: se dibuja la sistólica; el tooltip muestra sistólica/diastólica.",
      demoRule: "Límites de la regla activa (DEMO).",
    },
  },
  en: {
    defaultJust: "Periodic mission review and DEMO telemetry backup",
    fallbackJust: "Authorized operational export",
    type: {
      MEAS: "Measurement",
      ALERT: "Alert",
      ACK: "Acknowledgment",
      FUP: "Follow-up",
      REPORT: "Report",
      AUDIT: "Audit",
    },
    source: {
      MANUAL_ENTRY: "Manual entry",
      DEMO_SIMULATION: "Simulation (demo)",
      CSV_JSON_IMPORT: "CSV/JSON import",
      OFFLINE_QUEUE_SYNC: "Offline queue (synced)",
      INTERACTIVE_SESSION: "Interactive session",
      NONE: "No source",
    },
    quality: {
      VALIDATED: "validated",
      SYNTHETIC_DEMO: "synthetic (demo)",
      INVALID: "invalid",
      UNAVAILABLE: "unavailable",
      ESTIMATED: "estimated",
    },
    priority: { LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical", NORMAL: "normal" },
    alertStatus: {
      NEW: "new",
      ACKNOWLEDGED: "acknowledged",
      IN_FOLLOWUP: "in follow-up",
      RESOLVED: "resolved",
      ESCALATED: "escalated",
    },
    followup: {
      FOLLOW_UP_NOTE: "Follow-up note",
      RECHECK_COMPLETED: "Re-measurement done",
      RESOLVED: "Alert resolved",
      ESCALATED_TO_FLIGHT_SURGEON: "Escalated to flight surgeon",
    },
    role: {
      ASTRONAUT: "Crew",
      MISSION_LEADER: "Mission leadership",
      ADMINISTRATOR: "Administration",
    },
    auditStatus: { SUCCESS: "Success", DENIED: "Denied", FAILED: "Failed", FAILURE: "Failed" },
    formats: {
      PDF: { label: "Download PDF report", desc: "Readable summary: indicators with state and source, plus the last 12 alerts." },
      CSV: { label: "Download CSV table", desc: "Indicator table: last value, unit, state, source, quality and SIMULATED tag." },
      JSON: { label: "Download JSON package", desc: "Full package: metadata, summary, indicators, environmental telemetry and up to 25 alerts." },
    },
    errKind: { meas: "measurements", alerts: "alerts", audit: "audit" },
    error: "error",
    evOne: "event",
    evMany: "events",
    indicator: "Indicator",
    simulated: "SIMULATED",
    notSimulated: "Not simulated",
    qualityNote: "Quality: {q}",
    alertOf: "{name} alert",
    valueTxt: " · value {v}",
    alertNote: "{name}{val} · priority {p} · current status: {s}",
    rulesEngine: "Rules engine",
    alertAcked: "Alert acknowledged: {t}",
    fupDefault: "Follow-up",
    reportExported: "{f} report exported{n}",
    resourceNo: " (no. {id})",
    reasonNote: "Reason: {j}",
    success: "Success",
    you: "You",
    loggedSession: "Logged in this session",
    filtersAria: "Logbook filters",
    eventType: "Event type",
    allOperational: "All (operational)",
    auditAdmin: "Audit (administration)",
    allIndicators: "All indicators",
    from: "From (UTC date)",
    to: "To (UTC date)",
    order: "Order",
    newestFirst: "Newest first",
    oldestFirst: "Oldest first",
    outOnly: "Out of limits only",
    resetFilters: "Reset filters",
    warnHtml: "<strong>Note:</strong> could not load {list}. The logbook may be incomplete.",
    rangeErrHtml: "<strong>Invalid range:</strong> the “From” date is after “To”.",
    cMeas: "Measurements",
    cOut: "Out-of-limit measurements",
    cAlerts: "Alerts",
    cAcks: "Acknowledgments",
    cFups: "Follow-ups",
    cReports: "Reports",
    cAudit: "Audit",
    orderAsc: "oldest to newest",
    orderDesc: "newest to oldest",
    caption: "Mission logbook, {order}. Showing {a} of {b} {ev}.",
    gmtTitle: "Greenwich Mean Time, day of year/hours:minutes:seconds",
    thType: "Type",
    thDetail: "Detail",
    thState: "State",
    thSource: "Source",
    thData: "Data",
    emptyFiltered: "No events match the filters. Try widening the date range or resetting the filters.",
    emptyAll: "No events recorded for this crew member in the selected mission.",
    showMore: "Show {n} more",
    loadEarlier: "Load earlier measurements",
    showing: "Showing {a} of {b} {ev}.",
    queryNote: "Queries the {lim} most recent measurements{ind} (max {max}) and up to 100 alerts.",
    ofIndicator: " for the selected indicator",
    exportTitle: "Export report",
    simTitle: "Contains synthetic demo data",
    exportIntro: "Audited mission report. Each export checks your role's permissions on the server and records an event in the audit history.",
    dtCrew: "Crew member",
    dtMission: "Mission",
    dtPeriod: "Period",
    dtCoverage: "Coverage",
    dtSimulated: "Simulated",
    period: "From mission start{start} to the time of generation. Set by the server.",
    coverage: "{v} of data with sufficient quality",
    simIncluded: "Included and tagged as SIMULATED",
    justLabel: "Reason or justification (recorded in the audit log)",
    justHint: "If left empty, “Authorized operational export” is recorded.",
    formatLegend: "Report format",
    provTitle: "Data provenance",
    provSimHtml: '<span class="av-log-sim">SIMULATED</span> marks synthetic demo data (source “Simulation (demo)”, quality “synthetic”). It does not come from real sensors.',
    provManualHtml: "<strong>Manual entry</strong>: values logged by the crew from the console or “Log measurement”. CSV/JSON imports and the offline queue are shown in the “Source” column.",
    provAria: "Loaded measurements by source",
    provLoaded: "Loaded measurements",
    provSim: "Simulated",
    provNotSim: "Not simulated",
    disclaimer: "AstroVital helps observe, log and communicate health information; it does not diagnose or replace medical staff.",
    logTitle: "Mission logbook",
    logSub: "read-only · times in GMT",
    refresh: "Refresh",
    loadingInd: "Loading indicator measurements…",
    loadingMeas: "Loading measurements…",
    refreshing: "Refreshing logbook…",
    loading: "Loading logbook…",
    selectCrew: "Select a crew member to view their logbook and export reports.",
    generating: "Generating {f} report…",
    exportOk: "{f} report generated at {t} GMT, downloaded and recorded in the audit log.",
    exportToast: "{f} report generated, downloaded and recorded in the audit log.",
    exportFail: "Could not export the {f} report: {msg}",
    unknownErr: "unknown error",
    // Per-indicator trends (logbook-trends.js)
    trends: {
      title: "Trends by indicator",
      sub: "Pick an indicator to see its mission series",
      listAria: "Indicators with their recent trend",
      itemAria: "Show its trend",
      noTrend: "No trend",
      noData: "No indicators with data for this crew member.",
      loading: "Loading series…",
      loadingFull: "Showing the latest measurements; loading the full series…",
      fallback: "Could not load the full series: showing the latest measurements from the summary.",
      notEnough: "Not enough measurements to draw the trend (at least 2).",
      chartRole: "interactive chart",
      help: "Hover or tap the chart to see each measurement. With the keyboard: focus it and use ← → (Shift: 10 at a time), Home and End.",
      points: "measurements",
      min: "min",
      max: "max",
      last: "latest",
      value: "Value",
      baseShort: "Base",
      legendSeries: "Measurement",
      legendBase: "Baseline",
      legendY: "Caution limit (Y)",
      legendR: "Critical limit (R)",
      bpNote: "Blood pressure: the systolic value is plotted; the tooltip shows systolic/diastolic.",
      demoRule: "Limits from the active rule (DEMO).",
    },
  },
};

const FORMAT_CODES = ["PDF", "CSV", "JSON"];

/* Estado del módulo (se conserva al volver a la pestaña con el mismo tripulante y misión) */
const st = {
  userKey: null, // usuario con sesión: al cambiar se descarta todo el estado anterior
  key: null,
  filters: defaultFilters(),
  visible: PAGE,
  measLimit: MEAS_STEP,
  data: null,
  seq: 0, // evita condiciones de carrera entre peticiones de mediciones
  exporting: false,
  sessionReports: [], // informes exportados en esta sesión (roles sin acceso a auditoría)
  justification: DICT.es.defaultJust,
};

function defaultFilters() {
  return { type: "", indicator: "", from: "", to: "", outOnly: false, order: "desc" };
}

/* ───────────────────────── utilidades ───────────────────────── */

function ensureCss() {
  if (document.getElementById("av-log-css")) return;
  const link = document.createElement("link");
  link.id = "av-log-css";
  link.rel = "stylesheet";
  link.href = new URL("./logbook.css", import.meta.url).href;
  document.head.appendChild(link);
}

/* Número según idioma: en español se conserva el formato de la consola */
const nm = (v, dec = 0) => (getLang() === "es" ? num(v, dec) : fmtNum(v, dec));

const toMs = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};
const sameId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && Number(a) === Number(b);
const decimalsFor = (v) => (Number.isInteger(Number(v)) ? 0 : Math.abs(Number(v)) < 1 ? 2 : 1);
const fmtValue = (v) => (v === null || v === undefined || v === "" ? "—" : nm(v, decimalsFor(v)));
const letterOf = (state) => (state && LETTER[state]) || null;
const evWord = (n) => (Number(n) === 1 ? tr(DICT).evOne : tr(DICT).evMany);
const isOut = (l) => l === "A" || isAlarm(l) || l === "I";

function indicatorInfo(appState, code) {
  const item = (appState.indicatorsCatalog || []).find((i) => i.code === code);
  return { name: bt(item && item.name) || code || tr(DICT).indicator, unit: bt((item && item.unit) || "") };
}

function stateCell(l) {
  if (!l) return `<span class="av-sub">—</span>`;
  const w = STATE_WORD[l] || "";
  return `<span class="av-log-state">${badge(l, w)}<span>${esc(w)}</span></span>`;
}

function simCell(sim) {
  const T = tr(DICT);
  if (sim === true) return `<span class="av-log-sim">${esc(T.simulated)}</span>`;
  if (sim === false) return `<span class="av-sub">${esc(T.notSimulated)}</span>`;
  return `<span class="av-sub">—</span>`;
}

/* Error de carga guardado por tipo; el texto se compone al pintar en el idioma actual */
const loadErr = (k, reason) => ({ k, msg: reason && reason.message ? reason.message : null });
function errText(e) {
  const T = tr(DICT);
  return `${T.errKind[e.k] || e.k} (${bt(e.msg) || T.error})`;
}

/* ───────────────────────── carga de datos ───────────────────────── */

async function fetchMeasurements(ctx) {
  const p = new URLSearchParams();
  p.set("astronaut_id", String(ctx.aid));
  if (ctx.mid) p.set("mission_id", String(ctx.mid));
  if (st.filters.indicator) p.set("indicator_code", st.filters.indicator);
  p.set("limit", String(st.measLimit));
  const res = await apiService.request(`/health/measurements?${p.toString()}`);
  return (res && res.measurements) || [];
}

async function fetchAudit(ctx) {
  if (!ctx.isAdmin) return [];
  const res = await apiService.request(`/audit/events?limit=${AUDIT_LIMIT}`);
  return ((res && res.audit_events) || []).filter(
    (ev) => sameId(ev.target_user_id, ctx.aid) || sameId(ev.actor_user_id, ctx.aid)
  );
}

async function loadAll(ctx) {
  const seq = ++st.seq;
  const [m, a, au] = await Promise.allSettled([
    fetchMeasurements(ctx),
    apiService.getAlerts(ctx.aid),
    fetchAudit(ctx),
  ]);
  if (seq !== st.seq) return false; // llegó una petición más reciente
  const errors = [];
  if (m.status === "rejected") errors.push(loadErr("meas", m.reason));
  if (a.status === "rejected") errors.push(loadErr("alerts", a.reason));
  if (au.status === "rejected") errors.push(loadErr("audit", au.reason));
  const alerts = a.status === "fulfilled" ? (a.value && a.value.alerts) || [] : [];
  st.data = {
    measurements: m.status === "fulfilled" ? m.value : [],
    measIndicator: st.filters.indicator,
    alerts: alerts.filter((x) => !ctx.mid || sameId(x.mission_id, ctx.mid)),
    audit: au.status === "fulfilled" ? au.value : [],
    errors,
  };
  return true;
}

/* Recarga solo las mediciones (cambio de indicador o "cargar anteriores") */
async function reloadMeasurements(ctx) {
  const seq = ++st.seq;
  try {
    const list = await fetchMeasurements(ctx);
    if (seq !== st.seq) return false;
    st.data.measurements = list;
    st.data.measIndicator = st.filters.indicator;
    st.data.errors = st.data.errors.filter((e) => e.k !== "meas");
  } catch (e) {
    if (seq !== st.seq) return false;
    st.data.measurements = [];
    st.data.measIndicator = st.filters.indicator;
    st.data.errors = st.data.errors.filter((x) => x.k !== "meas");
    st.data.errors.push(loadErr("meas", e));
  }
  return true;
}

/* ───────────────────────── filas de la bitácora ───────────────────────── */

function buildRows(ctx) {
  const T = tr(DICT);
  const { appState } = ctx;
  const d = st.data || { measurements: [], alerts: [], audit: [] };
  const rows = [];

  for (const m of d.measurements) {
    const info = indicatorInfo(appState, m.indicator_code);
    const l = letterOf(m.calculated_state);
    const unit = bt(m.unit) || info.unit;
    const hasSecondary = m.secondary_value !== null && m.secondary_value !== undefined;
    const value = hasSecondary ? `${fmtValue(m.value)}/${fmtValue(m.secondary_value)}` : fmtValue(m.value);
    const valCls = isAlarm(l) ? ` av-val-${l}` : "";
    const quality = m.data_quality ? T.quality[m.data_quality] || String(m.data_quality).toLowerCase() : "";
    rows.push({
      t: toMs(m.measured_at),
      iso: m.measured_at,
      kind: "MEAS",
      indicator: m.indicator_code,
      letter: l,
      out: isOut(l),
      sim: !!m.is_simulated,
      source: m.source_code || "",
      detail: `<strong>${esc(info.name)}</strong> <span class="av-mono${valCls}">${esc(value)}${unit ? ` ${esc(unit)}` : ""}</span>${
        m.notes ? `<span class="av-log-note">${esc(bt(m.notes))}</span>` : ""
      }`,
      state: stateCell(l),
      src: `${esc(T.source[m.source_code] || m.source_code || "—")}${
        quality ? `<span class="av-log-note">${esc(fmt(T.qualityNote, { q: quality }))}</span>` : ""
      }`,
    });
  }

  for (const a of d.alerts) {
    const info = indicatorInfo(appState, a.indicator_code);
    const l = letterOf(a.operational_state);
    const title = bt(a.title) || fmt(T.alertOf, { name: info.name });
    const valueTxt =
      a.value_recorded !== null && a.value_recorded !== undefined
        ? fmt(T.valueTxt, { v: `${fmtValue(a.value_recorded)}${a.unit || info.unit ? ` ${bt(a.unit) || info.unit}` : ""}` })
        : "";
    const prio = T.priority[a.priority] || a.priority || "—";
    const status = T.alertStatus[a.status] || a.status || "—";
    rows.push({
      t: toMs(a.created_at),
      iso: a.created_at,
      kind: "ALERT",
      indicator: a.indicator_code,
      letter: l,
      out: true,
      sim: !!a.is_simulated,
      detail: `<strong>${esc(title)}</strong><span class="av-log-note">${esc(fmt(T.alertNote, { name: info.name, val: valueTxt, p: prio, s: status }))}</span>`,
      state: stateCell(l),
      src: `${esc(T.rulesEngine)}${a.rule_code ? `<span class="av-log-note">${esc(a.rule_code)}${a.rule_version_label ? ` v${esc(a.rule_version_label)}` : ""}</span>` : ""}`,
    });
    for (const ack of a.acknowledgements || []) {
      rows.push({
        t: toMs(ack.created_at),
        iso: ack.created_at,
        kind: "ACK",
        indicator: a.indicator_code,
        letter: l,
        out: true,
        sim: !!a.is_simulated,
        detail: `${fmt(esc(T.alertAcked), { t: `<strong>${esc(title)}</strong>` })}${ack.action_taken ? `<span class="av-log-note">${esc(ack.action_taken)}</span>` : ""}`,
        state: stateCell(l),
        src: esc(T.role[ack.role_at_time] || ack.role_at_time || "—"),
      });
    }
    for (const f of a.followups || []) {
      rows.push({
        t: toMs(f.created_at),
        iso: f.created_at,
        kind: "FUP",
        indicator: a.indicator_code,
        letter: l,
        out: true,
        sim: !!a.is_simulated,
        detail: `${esc(T.followup[f.action_type] || f.action_type || T.fupDefault)}: <strong>${esc(title)}</strong>${
          f.notes ? `<span class="av-log-note">${esc(bt(f.notes))}</span>` : ""
        }`,
        state: stateCell(l),
        src: esc(T.role[f.author_role] || f.author_role || "—"),
      });
    }
  }

  // Informes: con auditoría (ADMINISTRATOR) se leen del servidor; si no, los de esta sesión
  if (ctx.isAdmin) {
    for (const ev of d.audit || []) {
      const action = String(ev.action || "");
      const isReport = action.startsWith("EXPORT_REPORT_");
      const statusTxt = T.auditStatus[ev.status] || ev.status || "—";
      const actor = `${esc(ev.actor_email || "—")}${ev.actor_role ? `<span class="av-log-note">${esc(T.role[ev.actor_role] || ev.actor_role)}</span>` : ""}`;
      const reason = ev.justification ? `<span class="av-log-note">${esc(fmt(T.reasonNote, { j: ev.justification }))}</span>` : "";
      rows.push({
        t: toMs(ev.created_at),
        iso: ev.created_at,
        kind: isReport ? "REPORT" : "AUDIT",
        indicator: null,
        letter: null,
        out: false,
        sim: null,
        detail: isReport
          ? `${fmt(esc(T.reportExported), {
              f: `<strong>${esc(action.replace("EXPORT_REPORT_", ""))}</strong>`,
              n: ev.resource_id ? fmt(esc(T.resourceNo), { id: esc(ev.resource_id) }) : "",
            })}${reason}`
          : `<span class="av-mono">${esc(action || "—")}</span>${ev.details ? `<span class="av-log-note">${esc(bt(ev.details))}</span>` : ""}${reason}`,
        state: `<span class="av-sub">${esc(statusTxt)}</span>`,
        src: actor,
      });
    }
  } else {
    for (const r of st.sessionReports) {
      if (!sameId(r.aid, ctx.aid) || (ctx.mid && r.mid && !sameId(r.mid, ctx.mid))) continue;
      rows.push({
        t: toMs(r.at),
        iso: r.at,
        kind: "REPORT",
        indicator: null,
        letter: null,
        out: false,
        sim: true,
        detail: `${fmt(esc(T.reportExported), { f: `<strong>${esc(r.fmt)}</strong>`, n: "" })}<span class="av-log-note">${esc(fmt(T.reasonNote, { j: r.justification }))}</span>`,
        state: `<span class="av-sub">${esc(T.success)}</span>`,
        src: `${esc(T.you)}<span class="av-log-note">${esc(T.loggedSession)}</span>`,
      });
    }
  }
  return rows;
}

function dateRange() {
  const f = st.filters;
  const from = f.from ? Date.parse(`${f.from}T00:00:00Z`) : null;
  const to = f.to ? Date.parse(`${f.to}T23:59:59.999Z`) : null;
  const invalid = from !== null && to !== null && Number.isFinite(from) && Number.isFinite(to) && from > to;
  return { from: Number.isFinite(from) ? from : null, to: Number.isFinite(to) ? to : null, invalid };
}

function applyFilters(rows) {
  const f = st.filters;
  const { from, to } = dateRange();
  const out = rows.filter((r) => {
    if (f.type) {
      if (r.kind !== f.type) return false;
    } else if (r.kind === "AUDIT") {
      return false; // la auditoría solo se ve al elegir ese tipo
    }
    if (f.indicator && r.indicator !== f.indicator) return false;
    if (from !== null && r.t < from) return false;
    if (to !== null && r.t > to) return false;
    if (f.outOnly && !r.out) return false;
    return true;
  });
  out.sort((a, b) => (f.order === "asc" ? a.t - b.t : b.t - a.t));
  return out;
}

/* ───────────────────────── HTML ───────────────────────── */

function filtersHTML(ctx) {
  const T = tr(DICT);
  const f = st.filters;
  const lang = getLang();
  const catalog = [...(ctx.appState.indicatorsCatalog || [])].sort((a, b) => String(bt(a.name) || a.code).localeCompare(String(bt(b.name) || b.code), lang));
  const known = new Set(catalog.map((i) => i.code));
  const extra = [...new Set((st.data ? st.data.measurements : []).map((m) => m.indicator_code))].filter((c) => c && !known.has(c));
  const typeOpts = ["MEAS", "ALERT", "ACK", "FUP", "REPORT"].concat(ctx.isAdmin ? ["AUDIT"] : []);
  const opt = (value, label, sel) => `<option value="${esc(value)}"${sel ? " selected" : ""}>${esc(label)}</option>`;
  const { invalid } = dateRange();
  return `
  <form class="av-log-filters" id="av-log-filters" aria-label="${esc(T.filtersAria)}" novalidate>
    <div class="av-field">
      <label for="av-log-type">${esc(T.eventType)}</label>
      <select id="av-log-type" class="av-input">
        ${opt("", T.allOperational, f.type === "")}
        ${typeOpts.map((t) => opt(t, t === "AUDIT" ? T.auditAdmin : T.type[t], f.type === t)).join("")}
      </select>
    </div>
    <div class="av-field">
      <label for="av-log-ind">${esc(T.indicator)}</label>
      <select id="av-log-ind" class="av-input">
        ${opt("", T.allIndicators, f.indicator === "")}
        ${catalog.map((i) => opt(i.code, bt(i.name) || i.code, f.indicator === i.code)).join("")}
        ${extra.map((c) => opt(c, c, f.indicator === c)).join("")}
      </select>
    </div>
    <div class="av-field">
      <label for="av-log-from">${esc(T.from)}</label>
      <input id="av-log-from" class="av-input" type="date" value="${esc(f.from)}"${invalid ? ' aria-invalid="true" aria-describedby="av-log-range-err"' : ""} />
    </div>
    <div class="av-field">
      <label for="av-log-to">${esc(T.to)}</label>
      <input id="av-log-to" class="av-input" type="date" value="${esc(f.to)}"${invalid ? ' aria-invalid="true" aria-describedby="av-log-range-err"' : ""} />
    </div>
    <div class="av-field">
      <label for="av-log-order">${esc(T.order)}</label>
      <select id="av-log-order" class="av-input">
        ${opt("desc", T.newestFirst, f.order !== "asc")}
        ${opt("asc", T.oldestFirst, f.order === "asc")}
      </select>
    </div>
    <div class="av-field">
      <label class="av-log-check" for="av-log-out">
        <input id="av-log-out" type="checkbox"${f.outOnly ? " checked" : ""} />
        <span>${esc(T.outOnly)}</span>
      </label>
      <div class="av-log-filter-actions">
        <button type="button" class="av-btn av-btn-sm" data-log-act="reset" style="min-height:44px">${esc(T.resetFilters)}</button>
      </div>
    </div>
  </form>`;
}

function resultsHTML(ctx) {
  const T = tr(DICT);
  const d = st.data;
  const all = buildRows(ctx);
  const rows = applyFilters(all);
  const { invalid } = dateRange();
  const shown = rows.slice(0, st.visible);
  const count = (k) => rows.filter((r) => r.kind === k).length;
  const outN = rows.filter((r) => r.out && r.kind === "MEAS").length;
  const canFetchMore = d && d.measurements.length >= st.measLimit && st.measLimit < MEAS_MAX;

  const warn = d && d.errors.length
    ? `<p class="av-log-warn" role="status">${fmt(T.warnHtml, { list: esc(d.errors.map(errText).join("; ")) })}</p>`
    : "";
  const rangeErr = invalid
    ? `<p class="av-log-warn" id="av-log-range-err" role="status">${T.rangeErrHtml}</p>`
    : "";

  const counts = `
  <div class="av-log-counts">
    <span><strong>${nm(rows.length)}</strong> ${evWord(rows.length)}</span>
    <span>${esc(T.cMeas)} <strong>${nm(count("MEAS"))}</strong></span>
    <span>${esc(T.cOut)} <strong>${nm(outN)}</strong></span>
    <span>${esc(T.cAlerts)} <strong>${nm(count("ALERT"))}</strong></span>
    <span>${esc(T.cAcks)} <strong>${nm(count("ACK"))}</strong></span>
    <span>${esc(T.cFups)} <strong>${nm(count("FUP"))}</strong></span>
    <span>${esc(T.cReports)} <strong>${nm(count("REPORT"))}</strong></span>
    ${st.filters.type === "AUDIT" ? `<span>${esc(T.cAudit)} <strong>${nm(count("AUDIT"))}</strong></span>` : ""}
  </div>`;

  const orderTxt = st.filters.order === "asc" ? T.orderAsc : T.orderDesc;
  const table = shown.length
    ? `
  <div class="av-hscroll">
    <table class="av-table av-log-table">
      <caption class="av-log-sr">${esc(fmt(T.caption, { order: orderTxt, a: shown.length, b: rows.length, ev: evWord(rows.length) }))}</caption>
      <thead>
        <tr>
          <th scope="col"><abbr title="${esc(T.gmtTitle)}">GMT</abbr> <span class="av-sub" style="text-transform:none;letter-spacing:0">DDD/HH:MM:SS</span></th>
          <th scope="col">${esc(T.thType)}</th>
          <th scope="col">${esc(T.thDetail)}</th>
          <th scope="col">${esc(T.thState)}</th>
          <th scope="col">${esc(T.thSource)}</th>
          <th scope="col">${esc(T.thData)}</th>
        </tr>
      </thead>
      <tbody>
        ${shown.map((r) => rowHTML(ctx, r)).join("")}
      </tbody>
    </table>
  </div>`
    : `<p class="av-log-empty">${esc(all.length ? T.emptyFiltered : T.emptyAll)}</p>`;

  let more = "";
  if (shown.length < rows.length) {
    more = `<button type="button" class="av-btn" id="av-log-more" data-log-act="more">${esc(fmt(T.showMore, { n: nm(Math.min(PAGE, rows.length - shown.length)) }))}</button>`;
  } else if (canFetchMore) {
    more = `<button type="button" class="av-btn" id="av-log-more" data-log-act="fetch-more">${esc(T.loadEarlier)}</button>`;
  }
  const mono = (s) => `<span class="av-mono">${s}</span>`;
  const foot = `
  <div class="av-log-foot">
    <span class="av-sub" id="av-log-foot-txt" tabindex="-1">${fmt(esc(T.showing), { a: mono(nm(shown.length)), b: mono(nm(rows.length)), ev: esc(evWord(rows.length)) })}
      ${fmt(esc(T.queryNote), { lim: mono(nm(st.measLimit)), ind: st.data && st.data.measIndicator ? esc(T.ofIndicator) : "", max: nm(MEAS_MAX) })}</span>
    ${more}
  </div>`;

  return `${warn}${rangeErr}${counts}${table}${foot}`;
}

function rowHTML(ctx, r) {
  const date = r.iso ? new Date(r.iso) : null;
  const full = ctx.helpers && typeof ctx.helpers.formatDateUTC === "function" ? ctx.helpers.formatDateUTC(r.iso) : r.iso;
  const alarm = isAlarm(r.letter);
  return `<tr${alarm ? ' class="av-row-alarm"' : ""}>
    <td class="av-mono av-log-time"><time datetime="${esc(r.iso || "")}" title="${esc(full || "")}">${esc(gmt(date))}</time></td>
    <td><span class="av-log-type">${esc(tr(DICT).type[r.kind])}</span></td>
    <td class="av-log-detail">${r.detail}</td>
    <td>${r.state}</td>
    <td class="av-log-src">${r.src}</td>
    <td>${simCell(r.sim)}</td>
  </tr>`;
}

function exportHTML(ctx) {
  const T = tr(DICT);
  const s = ctx.summary || {};
  const astro = s.astronaut || {};
  const mission = s.mission || {};
  const ms = s.mission_summary || {};
  const mInfo = (ctx.appState.missionsList || []).find((x) => sameId(x.id, ctx.mid || mission.id)) || {};
  const start = mInfo.start_date ? new Date(mInfo.start_date) : null;
  const cov = ms.data_quality_coverage_percent;
  const pctUnit = getLang() === "es" ? " %" : "%";
  return `
  <section class="av-panel" aria-labelledby="av-log-exp-h">
    <div class="av-panel-head">
      <h2 class="av-h2" id="av-log-exp-h">${esc(T.exportTitle)}</h2>
      <span class="av-log-sim" title="${esc(T.simTitle)}">${esc(T.simulated)}</span>
    </div>
    <div class="av-log-body">
      <p class="av-log-p">${esc(T.exportIntro)}</p>
      <dl class="av-log-dl">
        <dt>${esc(T.dtCrew)}</dt><dd>${esc(astro.full_name || "—")}${astro.crew_code ? ` <span class="av-mono">(${esc(astro.crew_code)})</span>` : ""}</dd>
        <dt>${esc(T.dtMission)}</dt><dd>${esc(bt(mission.name || mInfo.name) || "—")}${mission.code || mInfo.code ? ` <span class="av-mono">(${esc(mission.code || mInfo.code)})</span>` : ""}</dd>
        <dt>${esc(T.dtPeriod)}</dt><dd>${fmt(esc(T.period), { start: start ? ` (<span class="av-mono">${esc(gmt(start, false))}</span> GMT)` : "" })}</dd>
        <dt>${esc(T.dtCoverage)}</dt><dd>${fmt(esc(T.coverage), { v: `<span class="av-mono">${cov === null || cov === undefined ? "—" : `${esc(nm(cov, decimalsFor(cov)))}${pctUnit}`}</span>` })}</dd>
        <dt>${esc(T.dtSimulated)}</dt><dd>${esc(T.simIncluded)}</dd>
      </dl>
      <form id="av-log-exp-form" class="av-log-body" style="padding:0" novalidate>
        <div class="av-field">
          <label for="av-log-just">${esc(T.justLabel)}</label>
          <input id="av-log-just" class="av-input" type="text" maxlength="250" style="min-height:44px" value="${esc(st.justification)}" aria-describedby="av-log-just-hint" />
          <span id="av-log-just-hint" class="av-sub">${esc(T.justHint)}</span>
        </div>
        <fieldset class="av-log-fmt">
          <legend class="av-lbl">${esc(T.formatLegend)}</legend>
          ${FORMAT_CODES.map(
            (f, i) => `
          <div class="av-log-fmt-item">
            <button type="button" class="av-btn${i === 0 ? " av-btn-primary" : ""}" data-log-fmt="${f}" aria-describedby="av-log-fmt-${f}">${esc(T.formats[f].label)}</button>
            <span class="av-sub" id="av-log-fmt-${f}">${esc(T.formats[f].desc)}</span>
          </div>`
          ).join("")}
        </fieldset>
      </form>
      <p id="av-log-exp-status" class="av-log-status" role="status" aria-live="polite"></p>
    </div>
  </section>`;
}

function provenanceHTML() {
  const T = tr(DICT);
  const ms = (st.data && st.data.measurements) || [];
  const sim = ms.filter((m) => m.is_simulated).length;
  const bySource = {};
  for (const m of ms) {
    const k = m.source_code || "NONE";
    bySource[k] = (bySource[k] || 0) + 1;
  }
  const sources = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  return `
  <section class="av-panel" aria-labelledby="av-log-prov-h">
    <div class="av-panel-head"><h2 class="av-h2" id="av-log-prov-h">${esc(T.provTitle)}</h2></div>
    <div class="av-log-body">
      <p class="av-log-p">${T.provSimHtml}</p>
      <p class="av-log-p">${T.provManualHtml}</p>
      <ul class="av-log-prov" aria-label="${esc(T.provAria)}">
        <li><span>${esc(T.provLoaded)}</span><span>${nm(ms.length)}</span></li>
        <li><span>${esc(T.provSim)}</span><span>${nm(sim)}</span></li>
        <li><span>${esc(T.provNotSim)}</span><span>${nm(ms.length - sim)}</span></li>
        ${sources.map(([k, n]) => `<li><span>${esc(T.source[k] || k)}</span><span>${nm(n)}</span></li>`).join("")}
      </ul>
      <p class="av-log-p">${esc(T.disclaimer)}</p>
    </div>
  </section>`;
}

function paint(root, ctx) {
  const T = tr(DICT);
  const s = ctx.summary || {};
  const astro = s.astronaut || {};
  const mission = s.mission || {};
  root.innerHTML = `
  <div class="av-grid">
    <div class="av-col-b">
      <div id="av-log-trends"></div>
      <section class="av-panel" aria-labelledby="av-log-h">
        <div class="av-panel-head">
          <div>
            <h2 class="av-h2" id="av-log-h">${esc(T.logTitle)}</h2>
            <span class="av-sub">${esc(astro.full_name || "—")}${astro.crew_code ? ` · ${esc(astro.crew_code)}` : ""} · ${esc(mission.code || "—")} · ${esc(T.logSub)}</span>
          </div>
          <button type="button" class="av-btn av-btn-sm" data-log-act="reload" style="min-height:44px">${esc(T.refresh)}</button>
        </div>
        ${filtersHTML(ctx)}
        <p class="av-log-sr" id="av-log-live" role="status" aria-live="polite"></p>
        <div id="av-log-results">${resultsHTML(ctx)}</div>
      </section>
    </div>
    <div class="av-col-c">
      <div id="av-log-followup"></div>
      <div id="av-log-export">${exportHTML(ctx)}</div>
      <div id="av-log-prov">${provenanceHTML()}</div>
    </div>
  </div>`;
  // resumen de salud del tripulante seleccionado en la bitácora (ctx.summary)
  mountFollowup(root.querySelector("#av-log-followup"), ctx.summary);
}

/* Repinta solo resultados y procedencia (mantiene el foco en los filtros) */
function paintResults(root, ctx, announce = true) {
  const box = root.querySelector("#av-log-results");
  if (box) box.innerHTML = resultsHTML(ctx);
  const prov = root.querySelector("#av-log-prov");
  if (prov) prov.innerHTML = provenanceHTML();
  // marcar rango de fechas no válido en los campos
  const { invalid } = dateRange();
  for (const id of ["#av-log-from", "#av-log-to"]) {
    const el = root.querySelector(id);
    if (!el) continue;
    if (invalid) {
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", "av-log-range-err");
    } else {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
    }
  }
  if (announce) {
    const live = root.querySelector("#av-log-live");
    const rows = applyFilters(buildRows(ctx));
    if (live) live.textContent = fmt(tr(DICT).showing, { a: Math.min(st.visible, rows.length), b: rows.length, ev: evWord(rows.length) });
  }
}

function setResultsLoading(root, text) {
  const box = root.querySelector("#av-log-results");
  if (box) box.innerHTML = `<p class="av-log-empty" role="status">${esc(text)}</p>`;
}

/* ───────────────────────── exportación ───────────────────────── */

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // se revoca con un pequeño retraso para no cancelar la descarga en algunos navegadores
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function setExportStatus(root, text, kind) {
  const el = root.querySelector("#av-log-exp-status");
  if (!el) return;
  el.setAttribute("data-kind", kind || "");
  el.textContent = text;
}

async function doExport(root, ctx, fmtCode) {
  if (st.exporting) return;
  st.exporting = true;
  const T = tr(DICT);
  const buttons = [...root.querySelectorAll("[data-log-fmt]")];
  buttons.forEach((b) => { b.disabled = true; });
  const form = root.querySelector("#av-log-exp-form");
  if (form) form.setAttribute("aria-busy", "true");
  const input = root.querySelector("#av-log-just");
  const justification = (input ? input.value : st.justification).trim() || T.fallbackJust;
  setExportStatus(root, fmt(T.generating, { f: fmtCode }), "busy");
  try {
    // Misma petición que apiService.downloadReport. Se replica aquí porque, para JSON,
    // apiService.request devuelve el objeto ya interpretado (content-type JSON) y no un Blob.
    const res = await apiService.request("/reports/export", {
      method: "POST",
      body: JSON.stringify({
        astronaut_id: Number(ctx.aid),
        mission_id: ctx.mid ? Number(ctx.mid) : null,
        report_format: fmtCode,
        include_simulated: true,
        justification,
      }),
    });
    const blob =
      typeof Blob !== "undefined" && res instanceof Blob
        ? res
        : new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
    triggerDownload(blob, `astrovital_report_${ctx.aid}.${fmtCode.toLowerCase()}`);
    const at = new Date();
    const T2 = tr(DICT);
    if (root.isConnected) setExportStatus(root, fmt(T2.exportOk, { f: fmtCode, t: gmt(at) }), "ok");
    if (ctx.helpers && typeof ctx.helpers.showToast === "function") {
      ctx.helpers.showToast(fmt(T2.exportToast, { f: fmtCode }));
    }
    // añadir el informe a la bitácora
    if (ctx.isAdmin) {
      try {
        if (st.data) st.data.audit = await fetchAudit(ctx);
      } catch {
        // si falla, la bitácora se actualizará al pulsar "Actualizar"
      }
    } else {
      st.sessionReports.push({ aid: ctx.aid, mid: ctx.mid, fmt: fmtCode, justification, at: at.toISOString() });
    }
    if (root.isConnected) paintResults(root, ctx, false);
  } catch (e) {
    const T2 = tr(DICT);
    const msg = bt(e && e.message) || T2.unknownErr;
    const text = fmt(T2.exportFail, { f: fmtCode, msg });
    if (root.isConnected) setExportStatus(root, text, "error");
    if (ctx.helpers && typeof ctx.helpers.showToast === "function") ctx.helpers.showToast(text);
  } finally {
    st.exporting = false;
    buttons.forEach((b) => { b.disabled = false; });
    if (form) form.removeAttribute("aria-busy");
  }
}

/* ───────────────────────── eventos ───────────────────────── */

function bind(root, ctx) {
  const onFilterChange = async (target) => {
    const f = st.filters;
    const id = target.id;
    st.visible = PAGE;
    if (id === "av-log-type") f.type = target.value;
    else if (id === "av-log-from") f.from = target.value;
    else if (id === "av-log-to") f.to = target.value;
    else if (id === "av-log-order") f.order = target.value === "asc" ? "asc" : "desc";
    else if (id === "av-log-out") f.outOnly = !!target.checked;
    else if (id === "av-log-ind") {
      f.indicator = target.value;
      // el servidor filtra por indicador: así se ven más mediciones de ese indicador
      st.measLimit = MEAS_STEP;
      setResultsLoading(root, tr(DICT).loadingInd);
      const fresh = await reloadMeasurements(ctx);
      if (!fresh || !root.isConnected) return;
    } else return;
    paintResults(root, ctx);
  };

  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t && t.closest && t.closest("#av-log-filters")) onFilterChange(t);
    else if (t && t.id === "av-log-just") st.justification = t.value;
  });
  root.addEventListener("input", (ev) => {
    if (ev.target && ev.target.id === "av-log-just") st.justification = ev.target.value;
  });
  root.addEventListener("submit", (ev) => {
    // ni los filtros ni el formulario de exportación se envían: todo va por botones
    ev.preventDefault();
  });

  root.addEventListener("click", async (ev) => {
    const fmtBtn = ev.target.closest("[data-log-fmt]");
    if (fmtBtn && root.contains(fmtBtn)) {
      await doExport(root, ctx, fmtBtn.getAttribute("data-log-fmt"));
      return;
    }
    const btn = ev.target.closest("[data-log-act]");
    if (!btn || !root.contains(btn)) return;
    const act = btn.getAttribute("data-log-act");
    if (act === "more") {
      st.visible += PAGE;
      paintResults(root, ctx);
      focusAfterMore(root);
    } else if (act === "fetch-more") {
      btn.disabled = true;
      st.measLimit = Math.min(MEAS_MAX, st.measLimit + MEAS_STEP);
      st.visible += PAGE;
      const fresh = await reloadMeasurements(ctx);
      if (!fresh || !root.isConnected) return;
      paintResults(root, ctx);
      focusAfterMore(root);
    } else if (act === "reset") {
      const needRefetch = st.filters.indicator !== "";
      st.filters = defaultFilters();
      st.visible = PAGE;
      const form = root.querySelector("#av-log-filters");
      if (form) form.outerHTML = filtersHTML(ctx);
      if (needRefetch) {
        st.measLimit = MEAS_STEP;
        setResultsLoading(root, tr(DICT).loadingMeas);
        const fresh = await reloadMeasurements(ctx);
        if (!fresh || !root.isConnected) return;
      }
      paintResults(root, ctx);
      const first = root.querySelector("#av-log-type");
      if (first) first.focus();
    } else if (act === "reload") {
      btn.disabled = true;
      setResultsLoading(root, tr(DICT).refreshing);
      const fresh = await loadAll(ctx);
      btn.disabled = false;
      if (!fresh || !root.isConnected) return;
      const form = root.querySelector("#av-log-filters");
      if (form) form.outerHTML = filtersHTML(ctx); // el catálogo de indicadores puede cambiar
      paintResults(root, ctx);
    }
  });
}

function focusAfterMore(root) {
  const next = root.querySelector("#av-log-more") || root.querySelector("#av-log-foot-txt");
  if (next) next.focus();
}

/* ───────────────────────── punto de entrada ───────────────────────── */

export async function renderLogbookView(container, appState, helpers) {
  ensureCss();
  const T = tr(DICT);
  container.innerHTML = `<div class="av-console av-log-root"><div class="av-grid"><div class="av-col-b"><section class="av-panel"><p class="av-log-empty" role="status">${esc(T.loading)}</p></section></div></div></div>`;
  const root = container.querySelector(".av-log-root");

  const aid = appState.selectedAstronautId;
  if (!aid) {
    root.innerHTML = `<div class="av-grid"><div class="av-col-b"><section class="av-panel"><p class="av-log-empty">${esc(T.selectCrew)}</p></section></div></div>`;
    return;
  }

  let summary = appState.healthSummary;
  const sumAid = summary && summary.astronaut ? summary.astronaut.id : null;
  if (!summary || (sumAid !== null && sumAid !== undefined && !sameId(sumAid, aid))) {
    try {
      summary = await apiService.getHealthSummary(aid, appState.selectedMissionId);
    } catch {
      summary = summary || null; // el resto de la vista funciona sin el resumen
    }
  }
  if (!root.isConnected) return;

  const ctx = {
    appState,
    helpers: helpers || {},
    isAdmin: (appState.currentUser && appState.currentUser.role_code) === "ADMINISTRATOR",
    summary,
    aid,
    mid: appState.selectedMissionId || (summary && summary.mission ? summary.mission.id : null),
  };

  // El estado del módulo sobrevive al cierre de sesión: si cambia el usuario se descarta
  // (filtros, justificación e informes "Tú · registrados en esta sesión" del usuario anterior).
  const cu = appState.currentUser || {};
  const userKey = `${cu.id ?? cu.email ?? ""}|${cu.role_code || ""}`;
  if (st.userKey !== userKey) {
    st.userKey = userKey;
    st.key = null;
    st.sessionReports = [];
    st.justification = tr(DICT).defaultJust;
  }
  // justificación sin tocar (texto por defecto de cualquier idioma): se muestra en el idioma actual
  if (Object.values(DICT).some((d) => d.defaultJust === st.justification)) st.justification = tr(DICT).defaultJust;
  const key = `${aid}:${ctx.mid}`;
  if (st.key !== key) {
    st.key = key;
    st.filters = defaultFilters();
    st.measLimit = MEAS_STEP;
    st.data = null;
  }
  if (!ctx.isAdmin && st.filters.type === "AUDIT") st.filters.type = ""; // opción solo para administración
  st.visible = PAGE;

  const fresh = await loadAll(ctx);
  if (!root.isConnected || !fresh) return;
  paint(root, ctx);
  bind(root, ctx);
  // tendencias por indicador (módulo propio; sus listeners viven en #av-log-trends)
  renderLogbookTrends(root.querySelector("#av-log-trends"), {
    appState, summary: ctx.summary, aid: ctx.aid, mid: ctx.mid, texts: () => tr(DICT).trends,
  });
}
