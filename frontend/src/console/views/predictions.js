/* SEMSA · Consola · Vista "Predicciones fisiológicas" (issue #28)
 *
 * - Pide GET /predictions/indicators/{code} (apiService.getIndicatorPrediction): regresión OLS
 *   validada con MAE frente a una referencia ingenua y puntaje Z frente a la línea base individual.
 *   Solo responde al rol ASTRONAUT con asignación activa (el backend deduce astronaut_id de la sesión).
 * - La respuesta no trae histórico ni el valor de la línea base: se piden a GET /analytics/timeseries
 *   (apiService.getAnalyticsTimeseries) filtrando por la fase y el entorno que usó el modelo, y se
 *   agregan a medianas diarias (fecha UTC), igual que el servicio. Sin "incluir simulados" se descartan
 *   los puntos is_simulated; los marcadores de hueco cortan la línea (valor null).
 * - Gráfica en SVG propio: renderPredictionChart (prediction-chart.js).
 * - Estados: carga, ok, insufficient_data, model_not_reliable y errores HTTP (403/404/422/503/sesión).
 *   Los textos `detail` del backend llegan en inglés: el mensaje se elige por err.status.
 * - Consultas: una misma consulta en curso no se repite y las respuestas obsoletas se descartan (seq).
 *   El último resultado se conserva en memoria del módulo: al cambiar de idioma (app.js vuelve a
 *   navegar a la sección) se repinta sin volver a pedirlo.
 * - Solo atributos data-pr-*: console.js escucha data-act / data-nav / form[data-form] en el contenedor.
 */
import { tr, fmt, fmtNum, getLang, locale } from "../../i18n/i18n.js";
import { bt } from "/src/i18n/backend.js";
import { apiService } from "../../services/api.js";
import { esc } from "./more-common.js";
import { renderPredictionChart } from "./prediction-chart.js";

/* Textos visibles por idioma; se resuelven en cada render con tr(DICT) */
const DICT = {
  es: {
    title: "Predicciones fisiológicas",
    subtitle: "Tendencia de tus mediciones y pronóstico de los próximos días frente a tu línea base individual",
    missionLbl: "Misión",
    phaseLbl: "Fase",
    envLbl: "Entorno",
    segmentLbl: "Segmento analizado",
    controlsH: "Configuración de la consulta",
    indicatorLbl: "Indicador",
    horizonLbl: "Horizonte de predicción",
    horizonOne: "1 día",
    horizonMany: "{n} días",
    includeSim: "Incluir datos simulados (demo)",
    includeSimHint: "Suma las mediciones sintéticas de demostración a las reales.",
    submit: "Consultar",
    prompt: "Elige un indicador y un horizonte y pulsa Consultar.",
    loading: "Calculando la predicción…",
    noMission: "No tienes ninguna misión asignada: las predicciones necesitan una asignación activa.",
    noCatalog: "El catálogo de indicadores no está disponible ahora mismo.",
    noAccessH: "Predicciones no disponibles para tu rol",
    noAccess: "Solo las personas astronautas con una asignación activa a la misión pueden ver sus predicciones.",
    resultFor: "{name} · horizonte de {h}",
    chartH: "Histórico y pronóstico",
    chartSub: "Mediana diaria (UTC) del segmento analizado. El pronóstico prolonga la recta de regresión (OLS).",
    noHistory: "No se pudo cargar el histórico de mediciones: se muestra solo el pronóstico.",
    noChartData: "No hay mediciones que dibujar en este segmento.",
    metricsH: "Métricas del modelo",
    na: "—",
    m: {
      status: "Estado del modelo",
      nDays: "Días analizados",
      trend: "Tendencia",
      error: "Error del modelo (MAE)",
      z: "Desviación de la línea base",
      direction: "Dirección",
      baseline: "Línea base",
    },
    status: {
      ok: "Predicción disponible",
      insufficient_data: "Datos insuficientes",
      model_not_reliable: "Modelo no fiable",
    },
    nDaysHint: "Mínimo 10 días con mediciones válidas",
    perDay: "{v} {unit}/día",
    trendUp: "Al alza",
    trendDown: "A la baja",
    trendFlat: "Estable",
    maeVal: "OLS {ols} · referencia {naive}",
    maeBetter: "Mejora a repetir el último valor",
    maeWorse: "No mejora a repetir el último valor",
    zVal: "Z = {z}",
    zAtEnd: "Al final del horizonte",
    zNone: "Sin línea base válida",
    zBand: {
      within_baseline: "Dentro de la línea base",
      mild_deviation: "Desviación leve",
      moderate_deviation: "Desviación moderada",
      strong_deviation: "Desviación fuerte",
    },
    dir: {
      above: "Por encima de la línea base",
      below: "Por debajo de la línea base",
      at_baseline: "En la línea base",
    },
    baselineSt: {
      missing: "Sin línea base",
      invalid_baseline: "Línea base no válida",
      invalid_std_dev: "Desviación típica no válida",
      available_unverified: "Disponible (sin verificar)",
    },
    baselineHint: "Valor de referencia previo a la misión",
    insufficientH: "Todavía no hay datos suficientes",
    insufficientP: "Se necesitan al menos 10 días con mediciones válidas en un mismo segmento (fase y entorno) para estimar una tendencia. Ahora hay {n}.",
    insufficientSim: "En modo demostración puedes incluir los datos simulados.",
    unreliableH: "El modelo no es fiable para este indicador",
    unreliableP: "En los 3 días de validación, la recta de regresión se equivocó tanto o más (MAE {ols}) que repetir el último valor medido (MAE {naive}). Por eso no se muestra pronóstico.",
    interpH: "Interpretación",
    interpOk: "Con la tendencia actual, {name} se estima en {value} {unit} el {date}.",
    interpZ: "Respecto a tu línea base: {band}, {dir} (Z = {z}).",
    interpNoZ: "No se puede comparar con tu línea base: {status}.",
    outOfRange: "Algún valor pronosticado queda fuera del rango válido del indicador: la extrapolación no es plausible.",
    simBadge: "Incluye datos simulados",
    simBaselineBadge: "Línea base simulada",
    disclaimerH: "Aviso de confiabilidad",
    serviceNote: "Aviso del servicio",
    note: "Las predicciones son orientativas y no constituyen un diagnóstico médico.",
    errH: "No se pudo obtener la predicción",
    retry: "Reintentar",
    err: {
      e403: "Solo las personas astronautas con una asignación activa a esta misión pueden consultar predicciones.",
      e404: "El indicador seleccionado no existe en el servicio de predicciones.",
      e422: "Los parámetros de la consulta no son válidos (el horizonte debe estar entre 1 y 14 días).",
      e503: "El servicio de predicciones no puede procesar ahora tanto volumen de mediciones. Inténtalo más tarde.",
      session: "La sesión expiró. Vuelve a iniciar sesión para consultar predicciones.",
      generic: "Error inesperado: {msg}",
    },
    chart: {
      history: "Mediciones (mediana diaria)",
      forecast: "Pronóstico",
      baseline: "Línea base individual",
      outOfRange: "Fuera del rango válido",
      aria: "Gráfica de {name}: {n} días de histórico y {h} días de pronóstico",
    },
  },
  en: {
    title: "Physiological predictions",
    subtitle: "Trend of your measurements and forecast for the coming days against your individual baseline",
    missionLbl: "Mission",
    phaseLbl: "Phase",
    envLbl: "Environment",
    segmentLbl: "Analysed segment",
    controlsH: "Query settings",
    indicatorLbl: "Indicator",
    horizonLbl: "Prediction horizon",
    horizonOne: "1 day",
    horizonMany: "{n} days",
    includeSim: "Include simulated data (demo)",
    includeSimHint: "Adds the synthetic demo measurements to the real ones.",
    submit: "Run query",
    prompt: "Choose an indicator and a horizon, then press Run query.",
    loading: "Computing the prediction…",
    noMission: "You have no assigned mission: predictions need an active assignment.",
    noCatalog: "The indicator catalogue isn't available right now.",
    noAccessH: "Predictions aren't available for your role",
    noAccess: "Only astronauts with an active mission assignment can see their predictions.",
    resultFor: "{name} · {h} horizon",
    chartH: "History and forecast",
    chartSub: "Daily median (UTC) of the analysed segment. The forecast extends the regression line (OLS).",
    noHistory: "The measurement history couldn't be loaded: only the forecast is shown.",
    noChartData: "There are no measurements to plot in this segment.",
    metricsH: "Model metrics",
    na: "—",
    m: {
      status: "Model status",
      nDays: "Days analysed",
      trend: "Trend",
      error: "Model error (MAE)",
      z: "Deviation from baseline",
      direction: "Direction",
      baseline: "Baseline",
    },
    status: {
      ok: "Prediction available",
      insufficient_data: "Insufficient data",
      model_not_reliable: "Model not reliable",
    },
    nDaysHint: "At least 10 days with valid measurements",
    perDay: "{v} {unit}/day",
    trendUp: "Rising",
    trendDown: "Falling",
    trendFlat: "Stable",
    maeVal: "OLS {ols} · reference {naive}",
    maeBetter: "Beats repeating the last value",
    maeWorse: "Doesn't beat repeating the last value",
    zVal: "Z = {z}",
    zAtEnd: "At the end of the horizon",
    zNone: "No valid baseline",
    zBand: {
      within_baseline: "Within baseline",
      mild_deviation: "Mild deviation",
      moderate_deviation: "Moderate deviation",
      strong_deviation: "Strong deviation",
    },
    dir: {
      above: "Above baseline",
      below: "Below baseline",
      at_baseline: "At baseline",
    },
    baselineSt: {
      missing: "No baseline",
      invalid_baseline: "Invalid baseline",
      invalid_std_dev: "Invalid standard deviation",
      available_unverified: "Available (unverified)",
    },
    baselineHint: "Pre-mission reference value",
    insufficientH: "Not enough data yet",
    insufficientP: "At least 10 days with valid measurements in a single segment (phase and environment) are needed to estimate a trend. There are {n} now.",
    insufficientSim: "In demo mode you can include the simulated data.",
    unreliableH: "The model isn't reliable for this indicator",
    unreliableP: "Over the 3 validation days, the regression line was as wrong or worse (MAE {ols}) than repeating the last measured value (MAE {naive}). That's why no forecast is shown.",
    interpH: "Interpretation",
    interpOk: "Following the current trend, {name} is estimated at {value} {unit} on {date}.",
    interpZ: "Compared with your baseline: {band}, {dir} (Z = {z}).",
    interpNoZ: "It can't be compared with your baseline: {status}.",
    outOfRange: "Some forecast values fall outside the indicator's valid range: the extrapolation isn't plausible.",
    simBadge: "Includes simulated data",
    simBaselineBadge: "Simulated baseline",
    disclaimerH: "Reliability notice",
    serviceNote: "Service notice",
    note: "Predictions are indicative only and do not constitute a medical diagnosis.",
    errH: "The prediction couldn't be retrieved",
    retry: "Retry",
    err: {
      e403: "Only astronauts with an active assignment to this mission can request predictions.",
      e404: "The selected indicator doesn't exist in the prediction service.",
      e422: "The query parameters aren't valid (the horizon must be between 1 and 14 days).",
      e503: "The prediction service can't process this volume of measurements right now. Try again later.",
      session: "Your session expired. Sign in again to request predictions.",
      generic: "Unexpected error: {msg}",
    },
    chart: {
      history: "Measurements (daily median)",
      forecast: "Forecast",
      baseline: "Individual baseline",
      outOfRange: "Outside valid range",
      aria: "{name} chart: {n} days of history and {h} days of forecast",
    },
  },
};

const DAY_MS = 86400000;
const HISTORY_DAYS = 90; // misma ventana que el servicio (MAX_HISTORY_DAYS)
const MIN_H = 1;
const MAX_H = 14;

/* Estado del módulo: formulario, consulta en curso y último resultado */
const st = {
  owner: null,
  form: { missionId: null, code: null, horizon: 7, sim: false },
  seq: 0,
  inflight: null,
  loading: false,
  last: null,
  root: null,
  chart: null,
  appState: null,
};

/* La hoja va declarada en index.html (con versión); esto solo cubre que falte */
function ensureCss() {
  if (document.getElementById("av-pr-css")) return;
  const link = document.createElement("link");
  link.id = "av-pr-css";
  link.rel = "stylesheet";
  link.href = new URL("./predictions.css", import.meta.url).href;
  document.head.appendChild(link);
}

const isNum = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const sameId = (a, b) => a !== null && a !== undefined && String(a) === String(b);
const clampH = (h) => Math.min(MAX_H, Math.max(MIN_H, Math.round(Number(h)) || 7));
const keyOf = (q) => `${st.owner}|${q.missionId}|${q.code}|${q.horizon}|${q.sim ? 1 : 0}`;
const num1 = (v) => (isNum(v) ? fmtNum(v, 1) : tr(DICT).na);
const num2 = (v) => (isNum(v) ? fmtNum(v, 2) : tr(DICT).na);
const signed2 = (v) => (isNum(v) ? `${Number(v) > 0 ? "+" : ""}${fmtNum(v, 2)}` : tr(DICT).na);
const horizonText = (h) => (Number(h) === 1 ? tr(DICT).horizonOne : fmt(tr(DICT).horizonMany, { n: h }));

function fmtDate(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso ?? "");
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/* Texto traducido de un código del servidor; si no se conoce, el código tal cual (escapado al pintar) */
function label(map, code) {
  if (code === null || code === undefined || code === "") return tr(DICT).na;
  return (map && Object.prototype.hasOwnProperty.call(map, code) && map[code]) || String(code);
}

/* ───────────────────────── contexto ───────────────────────── */

function catalogOf(appState) {
  const lang = getLang();
  return [...(appState.indicatorsCatalog || [])]
    .filter((i) => i && i.code)
    .sort((a, b) => String(bt(a.name) || a.code).localeCompare(String(bt(b.name) || b.code), lang));
}

function indicatorName(appState, code) {
  const item = (appState.indicatorsCatalog || []).find((i) => i.code === code);
  return (item && bt(item.name)) || code || "";
}

function missionOf(appState, id) {
  return (appState.missionsList || []).find((m) => sameId(m.id, id)) || null;
}

function phaseName(m, code) {
  if (!code) return "";
  const ph = (m?.phases || []).find((p) => p.phase_code === code);
  return (ph && bt(ph.name)) || code;
}

function envName(m, code) {
  if (!code) return "";
  const ctx = m?.active_context || {};
  return ctx.environment_code === code && ctx.environment_name ? bt(ctx.environment_name) : code;
}

/* ───────────────────────── datos ───────────────────────── */

function median(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/* Puntos de /analytics/timeseries → [{date, value|null}] por día UTC (mediana), últimos 90 días.
 * Un marcador de hueco entre dos días no consecutivos se conserva como un null que corta la línea. */
function dailyHistory(points, includeSim) {
  const days = new Map();
  const gapBefore = new Set();
  let pendingGap = false;
  let lastDate = null;
  for (const p of points || []) {
    if (!p) continue;
    if (p.is_gap_marker) {
      pendingGap = true;
      continue;
    }
    if (!isNum(p.value)) continue;
    if (!includeSim && p.is_simulated) continue;
    const t = Date.parse(p.measured_at);
    if (!Number.isFinite(t)) continue;
    const date = new Date(t).toISOString().slice(0, 10);
    if (pendingGap && lastDate && date !== lastDate) gapBefore.add(date);
    pendingGap = false;
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(Number(p.value));
    lastDate = date;
  }
  const dates = [...days.keys()].sort();
  if (!dates.length) return [];
  const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);
  const from = dayMs(dates[dates.length - 1]) - HISTORY_DAYS * DAY_MS;
  const out = [];
  let prev = null;
  for (const d of dates) {
    if (dayMs(d) < from) continue;
    if (prev && gapBefore.has(d) && dayMs(d) - dayMs(prev) > DAY_MS) {
      out.push({ date: new Date(dayMs(prev) + DAY_MS).toISOString().slice(0, 10), value: null });
    }
    out.push({ date: d, value: median(days.get(d)) });
    prev = d;
  }
  return out;
}

async function loadHistory(appState, q, pred) {
  const res = await apiService.getAnalyticsTimeseries({
    astronaut_id: appState.currentUser?.id,
    mission_id: q.missionId,
    indicator_code: q.code,
    phase_code: pred.phase_code,
    environment_code: pred.environment_code,
  });
  return {
    history: dailyHistory(res && res.points, q.sim),
    baselineValue: res && isNum(res.baseline_value) ? Number(res.baseline_value) : null,
    unit: res && res.unit,
  };
}

async function runQuery() {
  const appState = st.appState;
  if (!appState || !st.form.missionId || !st.form.code) return;
  const q = { ...st.form, horizon: clampH(st.form.horizon) };
  const key = keyOf(q);
  if (st.inflight === key) return; // la misma consulta ya está en curso
  const my = ++st.seq;
  st.inflight = key;
  st.loading = true;
  renderResult();

  let out;
  try {
    const pred = await apiService.getIndicatorPrediction(q.code, {
      missionId: q.missionId,
      horizonDays: q.horizon,
      includeSimulated: q.sim,
    });
    out = { key, query: q, pred, history: [], baselineValue: null, unit: pred && pred.unit, historyFailed: false, error: null };
    // Sin segmento (no hay mediciones válidas) no hay histórico que pedir
    if (pred && (pred.phase_code || pred.environment_code || Number(pred.n_days) > 0)) {
      try {
        const h = await loadHistory(appState, q, pred);
        out.history = h.history;
        out.baselineValue = h.baselineValue;
        out.unit = out.unit || h.unit;
      } catch {
        out.historyFailed = true;
      }
    }
  } catch (err) {
    out = { key, query: q, error: err };
  } finally {
    if (st.inflight === key) st.inflight = null;
  }
  if (my !== st.seq) return; // respuesta obsoleta: hay una consulta más reciente
  st.loading = false;
  st.last = out;
  const h = zone("header");
  if (h && !h.contains(document.activeElement)) h.innerHTML = headerHTML();
  renderResult();
}

/* ───────────────────────── pintado ───────────────────────── */

function destroyChart() {
  if (st.chart && typeof st.chart.destroy === "function") {
    try {
      st.chart.destroy();
    } catch {
      /* la gráfica ya no está en el DOM */
    }
  }
  st.chart = null;
}

function zone(name) {
  return st.root && st.root.isConnected ? st.root.querySelector(`[data-pr-zone="${name}"]`) : null;
}

function headerHTML() {
  const T = tr(DICT);
  const appState = st.appState;
  const missions = appState.missionsList || [];
  const m = missionOf(appState, st.form.missionId);
  const ctx = m?.active_context || {};
  // Si la misión no tiene contexto activo confirmado (p. ej. la misión análoga: phase_code "UNKNOWN"),
  // se muestra el segmento (fase y entorno) que usó la última predicción de esta misión.
  const known = (c) => c && c !== "UNKNOWN";
  const seg = st.last?.pred && sameId(st.last.query?.missionId, st.form.missionId) ? st.last.pred : null;
  const phaseCode = known(ctx.phase_code) ? ctx.phase_code : seg?.phase_code;
  const envCode = known(ctx.environment_code) ? ctx.environment_code : seg?.environment_code;
  const phase = phaseName(m, phaseCode) || bt(m?.current_phase) || T.na;
  const env = envName(m, envCode) || T.na;
  const mLabel = (x) => `${bt(x.name) || x.code}${x.code ? ` (${x.code})` : ""}`;
  const missionCtl = missions.length > 1
    ? `<select id="av-pr-mission" class="av-input av-pr-select" data-pr-field="mission">
        ${missions.map((x) => `<option value="${esc(x.id)}"${sameId(x.id, st.form.missionId) ? " selected" : ""}>${esc(mLabel(x))}</option>`).join("")}
      </select>`
    : `<span class="av-pr-ctxval">${esc(m ? mLabel(m) : T.na)}</span>`;
  return `
    <div class="av-pr-ctx">
      <div class="av-pr-ctxbox av-pr-ctxbox-mission">
        ${missions.length > 1 ? `<label class="av-lbl" for="av-pr-mission">${esc(T.missionLbl)}</label>` : `<span class="av-lbl">${esc(T.missionLbl)}</span>`}
        ${missionCtl}
      </div>
      <div class="av-pr-ctxbox"><span class="av-lbl">${esc(T.phaseLbl)}</span><span class="av-pr-ctxval">${esc(phase)}</span></div>
      <div class="av-pr-ctxbox"><span class="av-lbl">${esc(T.envLbl)}</span><span class="av-pr-ctxval">${esc(env)}</span></div>
    </div>`;
}

function controlsHTML(catalog) {
  const T = tr(DICT);
  const f = st.form;
  return `
    <form class="av-pr-form" data-pr-form novalidate>
      <div class="av-field av-pr-f-ind">
        <label for="av-pr-ind">${esc(T.indicatorLbl)}</label>
        <select id="av-pr-ind" class="av-input av-pr-select" data-pr-field="code">
          ${catalog.map((i) => `<option value="${esc(i.code)}"${i.code === f.code ? " selected" : ""}>${esc(bt(i.name) || i.code)}${i.unit ? ` (${esc(bt(i.unit))})` : ""}</option>`).join("")}
        </select>
      </div>
      <div class="av-field av-pr-f-h">
        <label for="av-pr-h">${esc(T.horizonLbl)}: <output for="av-pr-h" class="av-mono" data-pr-hout>${esc(horizonText(f.horizon))}</output></label>
        <input id="av-pr-h" class="av-pr-range" type="range" min="${MIN_H}" max="${MAX_H}" step="1" value="${clampH(f.horizon)}" data-pr-field="horizon">
      </div>
      <div class="av-pr-f-sim">
        <label class="av-pr-check">
          <input type="checkbox" data-pr-field="sim"${f.sim ? " checked" : ""} aria-describedby="av-pr-sim-hint">
          <span>${esc(T.includeSim)}</span>
        </label>
        <span class="av-sub" id="av-pr-sim-hint">${esc(T.includeSimHint)}</span>
      </div>
      <div class="av-pr-f-go">
        <button type="submit" class="av-btn av-btn-primary" data-pr-submit>${esc(T.submit)}</button>
      </div>
    </form>`;
}

function stateHTML(kind, title, text, extra = "") {
  return `<section class="av-panel av-pr-state av-pr-state-${kind}">
      ${title ? `<h3 class="av-h2">${esc(title)}</h3>` : ""}
      ${text ? `<p class="av-pr-p">${esc(text)}</p>` : ""}
      ${extra}
    </section>`;
}

function errorText(err) {
  const T = tr(DICT);
  const s = err && err.status;
  if (s === 403) return T.err.e403;
  if (s === 404) return T.err.e404;
  if (s === 422) return T.err.e422;
  if (s === 503) return T.err.e503;
  const msg = String((err && err.message) || "");
  if (!s && /sesi[oó]n expirada/i.test(msg)) return T.err.session;
  return fmt(T.err.generic, { msg: bt(msg) || T.na });
}

/* Tono por estado (el color nunca va solo: cada tarjeta lleva su texto) */
function zTone(band) {
  if (band === "within_baseline") return "ok";
  if (band === "mild_deviation") return "mon";
  if (band === "moderate_deviation" || band === "strong_deviation") return "alert";
  return "na";
}
function statusTone(status) {
  if (status === "ok") return "ok";
  if (status === "model_not_reliable") return "mon";
  return "na";
}

function cardHTML(lbl, value, hint, tone = "neutral") {
  return `<div class="av-pr-card av-pr-tone-${tone}">
      <span class="av-lbl">${esc(lbl)}</span>
      <span class="av-pr-card-val"><span class="av-pr-dot" aria-hidden="true"></span>${esc(value)}</span>
      ${hint ? `<span class="av-sub">${esc(hint)}</span>` : ""}
    </div>`;
}

function cardsHTML(r) {
  const T = tr(DICT);
  const p = r.pred;
  const unit = bt(r.unit || "");
  const cards = [];
  cards.push(cardHTML(T.m.status, label(T.status, p.status), "", statusTone(p.status)));
  cards.push(cardHTML(T.m.nDays, String(isNum(p.n_days) ? fmtNum(p.n_days, 0) : T.na), T.nDaysHint, Number(p.n_days) >= 10 ? "neutral" : "na"));
  if (p.status === "ok") {
    const b1 = Number(p.beta1);
    const flat = !isNum(p.beta1) || Math.abs(b1) < 0.005;
    const word = !isNum(p.beta1) ? "" : flat ? T.trendFlat : b1 > 0 ? T.trendUp : T.trendDown;
    cards.push(cardHTML(T.m.trend, fmt(T.perDay, { v: signed2(p.beta1), unit }).replace(" /", "/"), word, "neutral"));
  }
  if (p.status === "ok" || p.status === "model_not_reliable") {
    const better = isNum(p.mae_ols) && isNum(p.mae_naive) && Number(p.mae_ols) < Number(p.mae_naive);
    cards.push(cardHTML(T.m.error, fmt(T.maeVal, { ols: num2(p.mae_ols), naive: num2(p.mae_naive) }), better ? T.maeBetter : T.maeWorse, better ? "ok" : "mon"));
  }
  if (p.status === "ok") {
    const hasZ = isNum(p.z_score);
    cards.push(cardHTML(T.m.z, hasZ ? `${label(T.zBand, p.z_band)} · ${fmt(T.zVal, { z: signed2(p.z_score) })}` : T.zNone, hasZ ? T.zAtEnd : "", zTone(p.z_band)));
    cards.push(cardHTML(T.m.direction, p.direction ? label(T.dir, p.direction) : T.na, hasZ ? T.zAtEnd : "", hasZ ? zTone(p.z_band) : "na"));
  }
  const bOk = p.baseline_status === "available_unverified";
  const bHint = bOk && isNum(r.baselineValue) ? `${num1(r.baselineValue)} ${unit} · ${T.baselineHint}` : T.baselineHint;
  cards.push(cardHTML(T.m.baseline, label(T.baselineSt, p.baseline_status), bHint, bOk ? "ok" : "na"));
  return `<section class="av-panel av-pr-sec">
      <h3 class="av-h2">${esc(T.metricsH)}</h3>
      <div class="av-pr-cards">${cards.join("")}</div>
    </section>`;
}

function interpretationHTML(r, name) {
  const T = tr(DICT);
  const p = r.pred;
  const fc = Array.isArray(p.forecast) ? p.forecast : [];
  const lastF = fc[fc.length - 1];
  if (!lastF) return "";
  const unit = bt(r.unit || "");
  const lines = [fmt(T.interpOk, { name, value: num1(lastF.value), unit, date: fmtDate(lastF.date) }).replace(/\s{2,}/g, " ")];
  if (isNum(p.z_score)) {
    lines.push(fmt(T.interpZ, { band: label(T.zBand, p.z_band).toLowerCase(), dir: label(T.dir, p.direction).toLowerCase(), z: signed2(p.z_score) }));
  } else {
    lines.push(fmt(T.interpNoZ, { status: label(T.baselineSt, p.baseline_status).toLowerCase() }));
  }
  const oor = (p.forecast || []).some((f) => f && f.out_of_valid_range);
  return `<section class="av-panel av-pr-sec av-pr-interp av-pr-tone-${zTone(p.z_band)}">
      <h3 class="av-h2">${esc(T.interpH)}</h3>
      ${lines.map((l) => `<p class="av-pr-p">${esc(l)}</p>`).join("")}
      ${oor ? `<p class="av-pr-p av-pr-warn" role="note">${esc(T.outOfRange)}</p>` : ""}
    </section>`;
}

function disclaimerHTML(r) {
  const T = tr(DICT);
  const server = r.pred && r.pred.disclaimer;
  return `<section class="av-panel av-pr-sec av-pr-disc" aria-labelledby="av-pr-disc-h">
      <h3 class="av-h2" id="av-pr-disc-h">${esc(T.disclaimerH)}</h3>
      <p class="av-pr-p"><strong>${esc(T.note)}</strong></p>
      ${server ? `<p class="av-pr-p av-sub" lang="en"><span class="av-pr-srvlbl">${esc(T.serviceNote)}:</span> ${esc(server)}</p>` : ""}
    </section>`;
}

function badgesHTML(r) {
  const T = tr(DICT);
  const out = [];
  if (r.query.sim) out.push(`<span class="av-pr-badge av-pr-badge-sim">${esc(T.simBadge)}</span>`);
  if (r.pred && r.pred.baseline_is_simulated) out.push(`<span class="av-pr-badge av-pr-badge-sim">${esc(T.simBaselineBadge)}</span>`);
  if (r.pred) out.push(`<span class="av-pr-badge av-pr-tone-${statusTone(r.pred.status)}"><span class="av-pr-dot" aria-hidden="true"></span>${esc(label(T.status, r.pred.status))}</span>`);
  return out.length ? `<div class="av-pr-badges">${out.join("")}</div>` : "";
}

function chartPanelHTML(r) {
  const T = tr(DICT);
  return `<section class="av-panel av-pr-sec">
      <h3 class="av-h2">${esc(T.chartH)}</h3>
      <p class="av-sub av-pr-p">${esc(T.chartSub)}</p>
      ${r.historyFailed ? `<p class="av-pr-p av-pr-warn" role="note">${esc(T.noHistory)}</p>` : ""}
      <div class="av-pr-chart" data-pr-chart></div>
    </section>`;
}

function mountChart(r, name) {
  const T = tr(DICT);
  const host = st.root && st.root.querySelector("[data-pr-chart]");
  if (!host) return;
  const p = r.pred;
  const forecast = (p.status === "ok" ? p.forecast || [] : [])
    .filter((f) => f && isNum(f.value))
    .map((f) => ({ date: f.date, value: Number(f.value), out_of_valid_range: !!f.out_of_valid_range }));
  const history = r.history || [];
  if (!history.some((h) => h.value !== null) && !forecast.length) {
    host.innerHTML = `<p class="av-sub av-pr-p">${esc(T.noChartData)}</p>`;
    return;
  }
  const baselineOk = p.baseline_status !== "missing" && p.baseline_status !== "invalid_baseline";
  const nHist = history.filter((h) => h.value !== null).length;
  try {
    st.chart = renderPredictionChart(host, {
      history,
      forecast,
      baseline: baselineOk && isNum(r.baselineValue) ? r.baselineValue : null,
      unit: bt(r.unit || ""),
      labels: {
        history: T.chart.history,
        forecast: T.chart.forecast,
        baseline: T.chart.baseline,
        outOfRange: T.chart.outOfRange,
        ariaLabel: fmt(T.chart.aria, { name, n: nHist, h: forecast.length }),
      },
      locale: getLang() === "en" ? "en" : "es",
      formatValue: (v) => num1(v),
    });
  } catch {
    host.innerHTML = `<p class="av-sub av-pr-p">${esc(T.noChartData)}</p>`;
  }
}

function renderResult() {
  const z = zone("result");
  if (!z) return;
  const T = tr(DICT);
  destroyChart();
  const btn = st.root.querySelector("[data-pr-submit]");
  if (btn) btn.setAttribute("aria-busy", st.loading ? "true" : "false");
  z.setAttribute("aria-busy", st.loading ? "true" : "false");

  if (st.loading) {
    z.innerHTML = `<div class="av-panel av-pr-state av-pr-loading" role="status"><span class="av-pr-spin" aria-hidden="true"></span>${esc(T.loading)}</div>`;
    return;
  }
  const r = st.last;
  if (!r) {
    z.innerHTML = stateHTML("na", "", T.prompt);
    return;
  }
  if (r.error) {
    z.innerHTML = stateHTML("alert", T.errH, errorText(r.error),
      `<div><button type="button" class="av-btn av-btn-sm" data-pr-retry>${esc(T.retry)}</button></div>`);
    z.querySelector("[data-pr-retry]")?.addEventListener("click", () => runQuery());
    const p = z.querySelector(".av-pr-p");
    if (p) p.setAttribute("role", "alert");
    return;
  }

  const p = r.pred || {};
  const appState = st.appState;
  const m = missionOf(appState, r.query.missionId);
  const name = indicatorName(appState, r.query.code);
  const seg = [phaseName(m, p.phase_code), envName(m, p.environment_code)].filter(Boolean).join(" · ");
  const head = `<div class="av-pr-reshead">
      <div class="av-pr-restitle">
        <h2 class="av-h2">${esc(fmt(T.resultFor, { name, h: horizonText(r.query.horizon) }))}</h2>
        ${seg ? `<span class="av-sub">${esc(T.segmentLbl)}: ${esc(seg)}</span>` : ""}
      </div>
      ${badgesHTML(r)}
    </div>`;

  let body = "";
  if (p.status === "ok") {
    body = chartPanelHTML(r) + cardsHTML(r) + interpretationHTML(r, name);
  } else if (p.status === "model_not_reliable") {
    body = stateHTML("mon", T.unreliableH, fmt(T.unreliableP, { ols: num2(p.mae_ols), naive: num2(p.mae_naive) }))
      + chartPanelHTML(r) + cardsHTML(r);
  } else {
    // insufficient_data (y cualquier estado desconocido): sin pronóstico
    const extra = r.query.sim ? "" : `<p class="av-pr-p av-sub">${esc(T.insufficientSim)}</p>`;
    body = stateHTML("na", T.insufficientH, fmt(T.insufficientP, { n: isNum(p.n_days) ? p.n_days : 0 }), extra)
      + ((r.history || []).some((h) => h.value !== null) ? chartPanelHTML(r) : "")
      + cardsHTML(r);
  }
  z.innerHTML = head + body + disclaimerHTML(r);
  mountChart(r, name);
}

function bindForm() {
  const root = st.root;
  root.addEventListener("change", (e) => {
    const el = e.target.closest("[data-pr-field]");
    if (!el) return;
    const f = el.getAttribute("data-pr-field");
    if (f === "mission") {
      st.form.missionId = el.value;
      const h = zone("header");
      if (h) {
        h.innerHTML = headerHTML();
        h.querySelector("#av-pr-mission")?.focus(); // se conserva el foco al repintar la cabecera
      }
    } else if (f === "code") st.form.code = el.value;
    else if (f === "sim") st.form.sim = el.checked;
    else if (f === "horizon") st.form.horizon = clampH(el.value);
  });
  root.addEventListener("input", (e) => {
    const el = e.target.closest('[data-pr-field="horizon"]');
    if (!el) return;
    st.form.horizon = clampH(el.value);
    const out = root.querySelector("[data-pr-hout]");
    if (out) out.textContent = horizonText(st.form.horizon);
  });
  root.querySelector("[data-pr-form]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    runQuery();
  });
}

function shellHTML(inner) {
  const T = tr(DICT);
  return `<div class="av-console av-pr-root" data-pr-root>
      <div class="av-pr-wrap">
        <header class="av-pr-head">
          <h1 class="av-h2 av-pr-title" id="av-pr-h">${esc(T.title)}</h1>
          <p class="av-sub av-pr-p">${esc(T.subtitle)}</p>
        </header>
        ${inner}
      </div>
    </div>`;
}

/**
 * Pinta la vista de predicciones en `container`.
 * @param {HTMLElement} container contenedor de sección (section-view-container)
 * @param {object} appState estado global de app.js (currentUser, missionsList, selectedMissionId, indicatorsCatalog)
 */
export async function renderPredictions(container, appState) {
  ensureCss();
  destroyChart();
  const T = tr(DICT);
  st.appState = appState;

  if ((appState?.currentUser?.role_code || "") !== "ASTRONAUT") {
    st.root = null;
    container.innerHTML = shellHTML(stateHTML("na", T.noAccessH, T.noAccess));
    return;
  }

  // Otra persona usuaria: se olvida el formulario y el último resultado
  const owner = String(appState.currentUser.id);
  if (st.owner !== owner) {
    st.owner = owner;
    st.form = { missionId: null, code: null, horizon: 7, sim: false };
    st.last = null;
    st.loading = false;
    st.inflight = null;
    st.seq++;
  }

  const missions = appState.missionsList || [];
  const catalog = catalogOf(appState);
  if (!missions.some((m) => sameId(m.id, st.form.missionId))) {
    const sel = missions.find((m) => sameId(m.id, appState.selectedMissionId)) || missions[0];
    st.form.missionId = sel ? sel.id : null;
  }
  if (!catalog.some((i) => i.code === st.form.code)) {
    st.form.code = (catalog.find((i) => i.code === "HEART_RATE") || catalog[0] || {}).code || null;
  }

  if (!st.form.missionId) {
    st.root = null;
    container.innerHTML = shellHTML(stateHTML("na", "", T.noMission));
    return;
  }
  if (!catalog.length) {
    st.root = null;
    container.innerHTML = shellHTML(stateHTML("na", "", T.noCatalog));
    return;
  }

  container.innerHTML = shellHTML(`
        <section class="av-panel av-pr-sec" data-pr-zone="header">${headerHTML()}</section>
        <section class="av-panel av-pr-sec" aria-labelledby="av-pr-ctl-h">
          <h2 class="av-h2" id="av-pr-ctl-h">${esc(T.controlsH)}</h2>
          ${controlsHTML(catalog)}
        </section>
        <div class="av-pr-result" data-pr-zone="result" aria-live="polite"></div>`);
  st.root = container.querySelector("[data-pr-root]");
  bindForm();

  // Primera visita: se consulta el indicador por defecto; después se repinta lo último (o la carga en curso)
  if (!st.last && !st.loading) runQuery();
  else renderResult();
}
