/* SEMSA · Consola · Vista "Predicciones fisiológicas" (issue #28)
 *
 * - Pide GET /predictions/indicators/{code} (apiService.getIndicatorPrediction): pronóstico de la
 *   tendencia del indicador con nivel robusto (plano salvo que una tendencia domine al ruido), bandas
 *   de predicción al 80 % y 95 %, compuerta de fiabilidad (¿mejora a repetir el último valor en la
 *   validación dentro de la serie?), proyección contra los umbrales de la regla vigente con
 *   recomendación preventiva y puntaje Z frente a la línea base individual. No es un diagnóstico.
 *   Solo responde al rol ASTRONAUT con asignación activa (el backend deduce astronaut_id de la sesión).
 * - Contrato aditivo: `trend`, `threshold_projection`, `recommendation`, `empirical_validation` y las
 *   bandas de `forecast[]` son opcionales. Si el servidor no los envía, la vista se pinta como antes
 *   (tendencia desde `beta1`, sin bandas ni bloque de proyección).
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
    chartSub: "Mediana diaria (UTC) del segmento analizado. El pronóstico es el nivel robusto de los días recientes: plano, salvo que una tendencia domine claramente al ruido. Las bandas marcan dónde se espera el valor real el 80 % y el 95 % de las veces.",
    noHistory: "No se pudo cargar el histórico de mediciones: se muestra solo el pronóstico.",
    noChartData: "No hay mediciones que dibujar en este segmento.",
    metricsH: "Métricas del modelo",
    na: "—",
    m: {
      status: "Estado del modelo",
      nDays: "Días analizados",
      trend: "Tendencia",
      error: "Error en la validación (MAE)",
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
    trendUnknown: "Sin determinar",
    trendProjected: "Tendencia significativa: se proyecta en el pronóstico",
    trendNotProjected: "Tendencia detectada; no se proyecta porque no reduce el error",
    trendNone: "Sin tendencia significativa: pronóstico plano",
    trendSig: "Tendencia significativa",
    trendNotSig: "Sin tendencia significativa",
    trendFew: "Pocos días recientes para evaluarla",
    maeVal: "Método {model} · último valor {naive}",
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
      invalid_std_dev: "Sin desviación personal válida: no se calcula Z",
      available_unverified: "Disponible (sin verificar)",
      placeholder_std_dev: "Desviación de relleno: no se calcula Z",
    },
    baselineHint: "Valor de referencia previo a la misión",
    insufficientH: "Todavía no hay datos suficientes",
    insufficientP: "Se necesitan al menos 10 días con mediciones válidas en un mismo segmento (fase y entorno) para estimar una tendencia. Ahora hay {n}.",
    insufficientSim: "En modo demostración puedes incluir los datos simulados.",
    unreliableH: "El modelo no es fiable para este indicador",
    unreliableP: "En la validación dentro de la propia serie, el método no mejora a repetir el último valor medido (MAE {model} frente a {naive}). Por eso no se muestra pronóstico.",
    unreliableNoVal: "No hay suficientes días seguidos para validar el método dentro de la propia serie. Por eso no se muestra pronóstico.",
    projH: "Proyección frente a umbrales y recomendación",
    projCurrent: "Estado actual",
    projRange: "Rango normal: {lo} – {hi} {unit}",
    projPersonal: "Tu banda habitual (línea base ± 2 DE): {lo} – {hi} {unit}",
    projPersonalLow: "Desvío personal por debajo de {lo} {unit} (línea base − 2 DE)",
    projRefPersonal: " (límite de tu banda habitual)",
    projState: {
      NORMAL: "Normal",
      MONITOR: "Vigilar",
      WARNING: "Precaución",
      CRITICAL: "Crítico",
    },
    projDir: {
      above: "por encima de {thr} {unit}",
      below: "por debajo de {thr} {unit}",
      both: "a ambos lados del rango normal",
    },
    projExpected: "Cruce previsto: el valor esperado pasaría a «{state}» el {date} (en {days}){detail}.",
    projPossible: "Cruce posible: la banda del 80 % alcanza «{state}» el {date} (en {days}){detail}.",
    projStillIn: "El valor esperado se mantiene en rango normal.",
    projNow: "El último valor medido ya está en «{state}»{detail}.",
    projNone: "No se prevé ningún cruce de umbral en este horizonte: el valor esperado y la banda del 80 % se mantienen en rango normal.",
    projNoRule: "Este indicador no tiene una regla vigente: no se puede proyectar contra umbrales.",
    recH: "Recomendación preventiva",
    recNowH: "Qué hacer ahora",
    recSource: "Protocolo {rule} · versión {ver}",
    valYes: "Indicador validado con datos reales",
    valNo: "Indicador sin validación empírica",
    interpH: "Interpretación",
    interpOk: "El pronóstico sitúa {name} en {value} {unit} el {date}.",
    interpBand: "Banda de predicción al 80 %: {lo80} – {hi80} {unit}; al 95 %: {lo95} – {hi95} {unit}.",
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
      band80: "Banda de predicción 80 %",
      band95: "Banda de predicción 95 %",
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
    chartSub: "Daily median (UTC) of the analysed segment. The forecast is the robust level of recent days: flat, unless a trend clearly dominates the noise. The bands mark where the real value is expected 80% and 95% of the time.",
    noHistory: "The measurement history couldn't be loaded: only the forecast is shown.",
    noChartData: "There are no measurements to plot in this segment.",
    metricsH: "Model metrics",
    na: "—",
    m: {
      status: "Model status",
      nDays: "Days analysed",
      trend: "Trend",
      error: "Validation error (MAE)",
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
    trendUnknown: "Undetermined",
    trendProjected: "Significant trend: it is projected in the forecast",
    trendNotProjected: "Trend detected; not projected because it doesn't reduce the error",
    trendNone: "No significant trend: flat forecast",
    trendSig: "Significant trend",
    trendNotSig: "No significant trend",
    trendFew: "Too few recent days to assess it",
    maeVal: "Method {model} · last value {naive}",
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
      invalid_std_dev: "No valid personal deviation: Z isn't computed",
      available_unverified: "Available (unverified)",
      placeholder_std_dev: "Placeholder deviation: Z isn't computed",
    },
    baselineHint: "Pre-mission reference value",
    insufficientH: "Not enough data yet",
    insufficientP: "At least 10 days with valid measurements in a single segment (phase and environment) are needed to estimate a trend. There are {n} now.",
    insufficientSim: "In demo mode you can include the simulated data.",
    unreliableH: "The model isn't reliable for this indicator",
    unreliableP: "In the validation within the series itself, the method doesn't beat repeating the last measured value (MAE {model} versus {naive}). That's why no forecast is shown.",
    unreliableNoVal: "There aren't enough consecutive days to validate the method within the series itself. That's why no forecast is shown.",
    projH: "Projection against thresholds and recommendation",
    projCurrent: "Current state",
    projRange: "Normal range: {lo} – {hi} {unit}",
    projPersonal: "Your usual band (baseline ± 2 SD): {lo} – {hi} {unit}",
    projPersonalLow: "Personal deviation below {lo} {unit} (baseline − 2 SD)",
    projRefPersonal: " (edge of your usual band)",
    projState: {
      NORMAL: "Nominal",
      MONITOR: "Advisory",
      WARNING: "Caution",
      CRITICAL: "Warning",
    },
    projDir: {
      above: "above {thr} {unit}",
      below: "below {thr} {unit}",
      both: "on both sides of the normal range",
    },
    projExpected: "Expected crossing: the expected value would move to “{state}” on {date} (in {days}){detail}.",
    projPossible: "Possible crossing: the 80% band reaches “{state}” on {date} (in {days}){detail}.",
    projStillIn: "The expected value stays within the normal range.",
    projNow: "The last measured value is already in “{state}”{detail}.",
    projNone: "No threshold crossing is expected within this horizon: the expected value and the 80% band stay within the normal range.",
    projNoRule: "This indicator has no rule in force: it can't be projected against thresholds.",
    recH: "Preventive recommendation",
    recNowH: "What to do now",
    recSource: "Protocol {rule} · version {ver}",
    valYes: "Indicator validated with real data",
    valNo: "Indicator without empirical validation",
    interpH: "Interpretation",
    interpOk: "The forecast places {name} at {value} {unit} on {date}.",
    interpBand: "80% prediction band: {lo80} – {hi80} {unit}; 95%: {lo95} – {hi95} {unit}.",
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
      band80: "80% prediction band",
      band95: "95% prediction band",
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

/* Tarjeta de tendencia: dirección, pendiente por día, si es significativa y si se extrapoló (objeto `trend`).
 * Un servidor anterior no envía `trend`: se cae a la pendiente `beta1`, como antes. */
function trendCardHTML(p, unit) {
  const T = tr(DICT);
  const perDay = (v) => fmt(T.perDay, { v: signed2(v), unit }).replace(" /", "/");
  const t = p.trend;
  if (t && typeof t === "object") {
    const dir = t.direction;
    const word = dir === "rising" ? T.trendUp : dir === "falling" ? T.trendDown : dir === "stable" ? T.trendFlat : T.trendUnknown;
    const sig = t.significant === true;
    let hint;
    if (dir !== "rising" && dir !== "falling" && dir !== "stable") hint = T.trendFew;
    else if (p.status !== "ok") hint = sig ? T.trendSig : T.trendNotSig;
    else if (!sig) hint = T.trendNone;
    else hint = t.extrapolated === true ? T.trendProjected : T.trendNotProjected;
    // La pendiente solo se muestra si es significativa: una pendiente no significativa es ruido
    const value = sig && isNum(t.slope_per_day) ? `${word} · ${perDay(t.slope_per_day)}` : word;
    return cardHTML(T.m.trend, value, hint, "neutral");
  }
  if (p.status !== "ok") return "";
  const b1 = Number(p.beta1);
  const flat = !isNum(p.beta1) || Math.abs(b1) < 0.005;
  const word = !isNum(p.beta1) ? "" : flat ? T.trendFlat : b1 > 0 ? T.trendUp : T.trendDown;
  return cardHTML(T.m.trend, perDay(p.beta1), word, "neutral");
}

/* Tono de un estado operativo de la regla (el texto del estado acompaña siempre al color) */
function stateTone(state) {
  if (state === "NORMAL") return "ok";
  if (state === "MONITOR") return "mon";
  if (state === "WARNING" || state === "CRITICAL") return "alert";
  return "na";
}

/* ", por encima de 100 lpm" para un cruce {direction, threshold}; "" si no hay datos */
function crossDetail(c, unit) {
  const T = tr(DICT);
  if (!c) return "";
  if (c.direction === "both") return `, ${T.projDir.both}`;
  if ((c.direction === "above" || c.direction === "below") && isNum(c.threshold)) {
    // el umbral puede ser el del rango de la regla o el de la banda personal (línea base ± Z·DE)
    const ref = c.reference === "personal_baseline" ? T.projRefPersonal : "";
    return `, ${fmt(T.projDir[c.direction], { thr: num1(c.threshold), unit }).trim()}${ref}`;
  }
  return "";
}

/* Proyección frente a los umbrales de la regla vigente y recomendación preventiva.
 * Solo con el contrato nuevo: un servidor anterior no envía estas claves y el bloque no se pinta. */
function projectionHTML(r) {
  const T = tr(DICT);
  const p = r.pred;
  if (!("threshold_projection" in p) && !("recommendation" in p)) return "";
  const tp = p.threshold_projection && typeof p.threshold_projection === "object" ? p.threshold_projection : null;
  const rec = p.recommendation && typeof p.recommendation === "object" ? p.recommendation : null;
  const unit = bt(r.unit || "");
  if (!tp) {
    return `<section class="av-panel av-pr-sec av-pr-proj av-pr-tone-na" aria-labelledby="av-pr-proj-h">
      <h3 class="av-h2" id="av-pr-proj-h">${esc(T.projH)}</h3>
      <p class="av-pr-p">${esc(T.projNoRule)}</p>
    </section>`;
  }
  const expected = tp.first_expected_crossing && typeof tp.first_expected_crossing === "object" ? tp.first_expected_crossing : null;
  const possible = tp.first_possible_crossing && typeof tp.first_possible_crossing === "object" ? tp.first_possible_crossing : null;
  const outNow = !!tp.current_state && tp.current_state !== "NORMAL";
  const basis = (rec && rec.basis) || (outNow ? "currently_out_of_range" : expected ? "expected_crossing" : possible ? "possible_crossing" : "none");
  const stateName = (s) => label(T.projState, s);
  const when = (c) => ({
    state: stateName(c.state),
    date: fmtDate(c.date),
    days: isNum(c.days_ahead) ? horizonText(c.days_ahead) : T.na,
    detail: crossDetail(c, unit),
  });

  const lines = [];
  let tone = "ok";
  if (basis === "currently_out_of_range") {
    const state = (rec && rec.state) || tp.current_state;
    tone = stateTone(state);
    lines.push(fmt(T.projNow, { state: stateName(state), detail: crossDetail(rec, unit) }));
  } else if (basis === "expected_crossing" && expected) {
    tone = stateTone(expected.state);
    lines.push(fmt(T.projExpected, when(expected)));
    if (possible) lines.push(fmt(T.projPossible, when(possible)));
  } else if (basis === "possible_crossing" && possible) {
    tone = "mon";
    lines.push(`${fmt(T.projPossible, when(possible))} ${T.projStillIn}`);
  } else {
    lines.push(T.projNone);
  }

  const normal = tp.ranges && Array.isArray(tp.ranges.normal) ? tp.ranges.normal : null;
  const range = normal && isNum(normal[0]) && isNum(normal[1])
    ? fmt(T.projRange, { lo: num1(normal[0]), hi: num1(normal[1]), unit }).trim()
    : "";
  // Banda personal del motor de alertas (línea base ± 2 DE); el lado superior es null si solo alerta el desvío a la baja
  const band = tp.ranges && Array.isArray(tp.ranges.personal_yellow) ? tp.ranges.personal_yellow : null;
  const personal = band && isNum(band[0])
    ? (isNum(band[1])
      ? fmt(T.projPersonal, { lo: num1(band[0]), hi: num1(band[1]), unit })
      : fmt(T.projPersonalLow, { lo: num1(band[0]), unit })).replace(/\s{2,}/g, " ").replace(/\s+([:)])/g, "$1").trim()
    : "";
  const current = tp.current_state
    ? `<div class="av-pr-projrow">
        <span class="av-lbl">${esc(T.projCurrent)}</span>
        <span class="av-pr-badge av-pr-tone-${stateTone(tp.current_state)}">${esc(stateName(tp.current_state))}</span>
        ${range ? `<span class="av-sub">${esc(range)}</span>` : ""}
        ${personal ? `<span class="av-sub">${esc(personal)}</span>` : ""}
      </div>`
    : "";
  // Acción inmediata: solo llega cuando el último valor ya está fuera de rango
  const nowText = rec && typeof rec.immediate_action === "string" && rec.immediate_action.trim() ? rec.immediate_action : "";
  const recText = rec && typeof rec.text === "string" && rec.text.trim() ? rec.text : "";
  const source = rec && rec.rule_code
    ? fmt(T.recSource, { rule: rec.rule_code, ver: rec.rule_version || T.na })
    : "";
  const recBox = recText || nowText
    ? `<div class="av-pr-rec">
        ${nowText ? `<span class="av-lbl">${esc(T.recNowH)}</span>
        <p class="av-pr-p av-pr-rec-text">${esc(bt(nowText))}</p>` : ""}
        ${recText ? `<span class="av-lbl">${esc(T.recH)}</span>
        <p class="av-pr-p av-pr-rec-text">${esc(bt(recText))}</p>` : ""}
        ${source ? `<span class="av-sub">${esc(source)}</span>` : ""}
      </div>`
    : "";
  return `<section class="av-panel av-pr-sec av-pr-proj av-pr-tone-${tone}" aria-labelledby="av-pr-proj-h">
      <h3 class="av-h2" id="av-pr-proj-h">${esc(T.projH)}</h3>
      ${current}
      ${lines.map((l, i) => `<p class="av-pr-p${i === 0 ? " av-pr-projmain" : ""}">${esc(l)}</p>`).join("")}
      ${recBox}
    </section>`;
}

function cardsHTML(r) {
  const T = tr(DICT);
  const p = r.pred;
  const unit = bt(r.unit || "");
  const cards = [];
  cards.push(cardHTML(T.m.status, label(T.status, p.status), "", statusTone(p.status)));
  cards.push(cardHTML(T.m.nDays, String(isNum(p.n_days) ? fmtNum(p.n_days, 0) : T.na), T.nDaysHint, Number(p.n_days) >= 10 ? "neutral" : "na"));
  cards.push(trendCardHTML(p, unit));
  if (p.status === "ok" || p.status === "model_not_reliable") {
    // mae_ols conserva el nombre por compatibilidad: es el MAE del método en la validación dentro de la serie
    const better = isNum(p.mae_ols) && isNum(p.mae_naive) && Number(p.mae_ols) < Number(p.mae_naive);
    cards.push(cardHTML(T.m.error, fmt(T.maeVal, { model: num2(p.mae_ols), naive: num2(p.mae_naive) }), better ? T.maeBetter : T.maeWorse, better ? "ok" : "mon"));
  }
  if (p.status === "ok") {
    const hasZ = isNum(p.z_score);
    cards.push(cardHTML(T.m.z, hasZ ? `${label(T.zBand, p.z_band)} · ${fmt(T.zVal, { z: signed2(p.z_score) })}` : T.zNone, hasZ ? T.zAtEnd : "", zTone(p.z_band)));
    cards.push(cardHTML(T.m.direction, p.direction ? label(T.dir, p.direction) : T.na, hasZ ? T.zAtEnd : "", hasZ ? zTone(p.z_band) : "na"));
  }
  const bOk = p.baseline_status === "available_unverified";
  // Con desviación de relleno el valor de la línea base sigue siendo válido (solo falta el puntaje Z)
  const bShown = bOk || p.baseline_status === "placeholder_std_dev";
  const bVal = isNum(r.baselineValue) ? r.baselineValue : p.baseline_value;
  const bHint = bShown && isNum(bVal) ? `${num1(bVal)} ${unit} · ${T.baselineHint}` : T.baselineHint;
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
  if (["lower_80", "upper_80", "lower_95", "upper_95"].every((k) => isNum(lastF[k]))) {
    lines.push(fmt(T.interpBand, {
      lo80: num1(lastF.lower_80), hi80: num1(lastF.upper_80), lo95: num1(lastF.lower_95), hi95: num1(lastF.upper_95), unit,
    }).replace(/\s+([;.])/g, "$1"));
  }
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
  // Validación empírica del método para este indicador (la nota llega del backend en español: bt())
  const ev = r.pred && r.pred.empirical_validation && typeof r.pred.empirical_validation === "object" ? r.pred.empirical_validation : null;
  const validated = !!ev && ev.validated_with_real_data === true;
  const validation = ev
    ? `<p class="av-pr-p"><span class="av-pr-badge av-pr-tone-${validated ? "ok" : "mon"}"><span class="av-pr-dot" aria-hidden="true"></span>${esc(validated ? T.valYes : T.valNo)}</span></p>
      ${ev.note ? `<p class="av-pr-p av-sub">${esc(bt(String(ev.note)))}</p>` : ""}`
    : "";
  return `<section class="av-panel av-pr-sec av-pr-disc" aria-labelledby="av-pr-disc-h">
      <h3 class="av-h2" id="av-pr-disc-h">${esc(T.disclaimerH)}</h3>
      <p class="av-pr-p"><strong>${esc(T.note)}</strong></p>
      ${validation}
      ${server ? `<p class="av-pr-p av-sub" lang="en"><span class="av-pr-srvlbl">${esc(T.serviceNote)}:</span> ${esc(server)}</p>` : ""}
    </section>`;
}

function badgesHTML(r) {
  const T = tr(DICT);
  const out = [];
  if (r.query.sim) out.push(`<span class="av-pr-badge av-pr-badge-sim">${esc(T.simBadge)}</span>`);
  if (r.pred && r.pred.baseline_is_simulated) out.push(`<span class="av-pr-badge av-pr-badge-sim">${esc(T.simBaselineBadge)}</span>`);
  const ev = r.pred && r.pred.empirical_validation;
  if (ev && typeof ev === "object" && ev.validated_with_real_data === false) {
    out.push(`<span class="av-pr-badge av-pr-tone-mon"><span class="av-pr-dot" aria-hidden="true"></span>${esc(T.valNo)}</span>`);
  }
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
    .map((f) => ({
      date: f.date,
      value: Number(f.value),
      out_of_valid_range: !!f.out_of_valid_range,
      // bandas de predicción (opcionales: un servidor anterior no las envía y la gráfica las omite)
      lower_80: f.lower_80,
      upper_80: f.upper_80,
      lower_95: f.lower_95,
      upper_95: f.upper_95,
    }));
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
      // valor de /analytics/timeseries o, si no se pudo cargar, el que trae la predicción (contrato nuevo)
      baseline: baselineOk && isNum(r.baselineValue) ? r.baselineValue : baselineOk && isNum(p.baseline_value) ? Number(p.baseline_value) : null,
      unit: bt(r.unit || ""),
      labels: {
        history: T.chart.history,
        forecast: T.chart.forecast,
        band80: T.chart.band80,
        band95: T.chart.band95,
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
    // La proyección y la recomendación van primero: son la orientación útil de la vista
    body = projectionHTML(r) + chartPanelHTML(r) + cardsHTML(r) + interpretationHTML(r, name);
  } else if (p.status === "model_not_reliable") {
    const why = isNum(p.mae_ols) && isNum(p.mae_naive)
      ? fmt(T.unreliableP, { model: num2(p.mae_ols), naive: num2(p.mae_naive) })
      : T.unreliableNoVal;
    body = stateHTML("mon", T.unreliableH, why) + chartPanelHTML(r) + cardsHTML(r);
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
