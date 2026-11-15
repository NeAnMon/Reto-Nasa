/*
 * SEMSA · Bitácora · Gráficas por motor (issue #30)
 *
 * Una gráfica interactiva por cada motor del backend, alimentada con los datos que de verdad
 * recibe (o produce) ese motor en su módulo de origen:
 *
 *   Motor          | Serie                                          | Endpoint
 *   ---------------+------------------------------------------------+---------------------------------------------
 *   Predicción     | mediana diaria + pronóstico + banda 80 % +     | GET /predictions/indicators/{code}
 *                  | umbrales Y/R de la regla vigente               |   + GET /analytics/timeseries (histórico)
 *   Reglas/alertas | alertas por día y clase (W / C / A)            | GET /alerts?astronaut_id
 *   Cognitivo      | precisión o tiempo de respuesta por dominio    | GET /cognitive/history
 *   Emocional      | estado operativo de cada cuestionario          | GET /logbook/emotional-states
 *   Aislamiento    | horas de sueño del check-in + señal temprana   | GET /wellness/quick-checkin
 *   Radiación      | dosis acumulada frente al límite / dosis diaria| GET /logbook/radiation-dose
 *
 * Regla del issue: si un motor no tiene datos que graficar (o el rol no puede verlos), no se
 * inventa la gráfica: el motor sale de la lista y se explica en "Motores sin gráfica".
 * La predicción solo la puede pedir el propio tripulante (prediction_router), así que para
 * otros roles queda fuera con ese motivo.
 *
 * Actualización: cada render de la Bitácora vuelve a pedir las series (sin caché entre
 * aperturas) y, mientras la sección está montada, escucha "semsa:data-changed" (lo emite
 * apiService.request tras cada escritura) para recargar solo los motores afectados.
 * logbook.js llama a refreshLogbookEngines() con su botón "Actualizar".
 *
 * Gráfica: logbook-engine-chart.js (SVG propio). Textos en DICT (es / en) con tr(DICT).
 */
import { escapeHtml, num, gmt, badge } from "../console.js";
import { LETTER, STATE_WORD, RANK } from "../alert-classes.js";
import { apiService } from "../../services/api.js";
import { tr, fmt } from "../../i18n/i18n.js";
import { bt } from "/src/i18n/backend.js";
import { renderEngineChart } from "./logbook-engine-chart.js";

const esc = escapeHtml;
const isNum = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const sameId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && Number(a) === Number(b);
const when = (t) => gmt(new Date(t), false);
const DAY = 864e5;
const dayStart = (t) => Math.floor(t / DAY) * DAY;

const DICT = {
  es: {
    title: "Gráficas por motor",
    sub: "Datos que recibe cada motor del backend en su módulo",
    listAria: "Motores con gráfica",
    loading: "Cargando…",
    loadingChart: "Cargando la serie del motor…",
    chartRole: "gráfica interactiva",
    help: "Pasa el ratón o toca la gráfica para ver cada punto. Con el teclado: enfócala y usa ← → (Mayús: de 10 en 10), Inicio y Fin.",
    points: "puntos",
    last: "último",
    simulated: "SIMULADO",
    simNote: "Incluye datos SIMULADOS (demo): no proceden de sensores ni de registros reales.",
    source: "Fuente",
    omittedTitle: "Motores sin gráfica",
    omittedIntro: "No se dibuja una gráfica sin datos reales que la respalden:",
    reason: {
      empty: "todavía no hay datos registrados para este tripulante y misión.",
      denied: "tu rol no tiene acceso a estos datos.",
      error: "no se pudieron cargar los datos ({msg}).",
      onlySelf: "el pronóstico solo lo puede consultar el propio tripulante (permiso del motor de predicción).",
      noMission: "no hay misión seleccionada.",
      private: "el tripulante no comparte sus señales de bienestar con el líder de misión.",
    },
    metricAria: "Métrica",
    engines: {
      prediction: { name: "Predicción", desc: "Serie diaria, pronóstico y umbrales" },
      rules: { name: "Reglas y alertas", desc: "Alertas por día y clase" },
      cognitive: { name: "Cognitivo", desc: "Resultados por dominio" },
      emotional: { name: "Emocional", desc: "Estado operativo de cada cuestionario" },
      isolation: { name: "Aislamiento", desc: "Sueño del check-in y señal temprana" },
      radiation: { name: "Radiación", desc: "Dosis frente al límite de carrera" },
    },
    pred: {
      indicator: "Indicador",
      history: "Mediana diaria",
      forecast: "Pronóstico",
      band80: "Banda 80 %",
      limY: "Límite precaución (Y)",
      limR: "Límite crítico (R)",
      base: "Línea base",
      today: "último dato",
      forecastTip: "Pronóstico",
      bandTip: "80 %: {lo} – {hi}",
      status: {
        insufficient_data: "Sin pronóstico: no hay días suficientes de mediciones válidas; se muestra solo la serie.",
        model_not_reliable: "Sin pronóstico: el método no superó a repetir el último valor en la validación; se muestra solo la serie.",
      },
      exploratory: "Pronóstico exploratorio (nivel robusto + tendencia OLS validada, z-score frente a la línea base). No es un diagnóstico.",
      projection: "Estado actual frente a la regla {rule}: {state}.",
    },
    rules: {
      count: "Alertas",
      day: "Día",
      cut: "Se grafican las 100 alertas más recientes del tripulante.",
      total: "{n} alertas en {d} días",
    },
    cog: {
      accuracy: "Precisión (%)",
      rt: "Tiempo de respuesta (ms)",
      baseline: "base",
      review: "Requiere revisión",
      difficulty: "Dificultad",
      note: "Una serie por dominio (no se combinan en un puntaje global). La variación puede reflejar efecto de práctica.",
    },
    emo: {
      state: {
        EMOTIONAL_WELLNESS_STABLE: "Estable",
        EMOTIONAL_WELLNESS_MONITORING: "Seguimiento",
        SUPPORT_REQUESTED: "Apoyo pedido",
        PROFESSIONAL_REVIEW: "Revisión prof.",
        URGENT_SUPPORT: "Urgente",
      },
      series: "Estado operativo",
      privacy: "Solo el estado operativo que asigna el motor; las respuestas y dimensiones individuales son privadas.",
    },
    iso: {
      sleep: "Horas de sueño",
      target: "Umbral 6 h",
      quality: "Calidad",
      mood: "Ánimo",
      energy: "Energía",
      isolated: "Se siente aislado/a",
      yes: "sí",
      no: "no",
      flag: "Señal temprana: conviene un contacto",
      note: "El motor marca NEEDS_CHECK_IN si el sueño medio de 3 días baja de 6 h o si los 3 últimos check-ins tienen ánimo ≤ 2 o aislamiento.",
      avg: "Sueño medio 7 días: {h} h ({n} check-ins).",
      flagHidden: "El tripulante no comparte su señal operativa con el líder.",
    },
    rad: {
      cumulative: "Dosis acumulada",
      daily: "Dosis diaria",
      yellow: "{p} % del límite",
      red: "Límite de carrera",
      pct: "{p} % del límite de carrera ({lim} mSv)",
      prior: "Incluye {d} mSv de misiones anteriores.",
      method: "Acumulada = suma de la última lectura válida de cada día UTC (los días sin registro no se imputan), igual que el motor de reglas.",
    },
  },
  en: {
    title: "Charts by engine",
    sub: "Data each backend engine receives from its module",
    listAria: "Engines with a chart",
    loading: "Loading…",
    loadingChart: "Loading the engine series…",
    chartRole: "interactive chart",
    help: "Hover or tap the chart to see each point. With the keyboard: focus it and use ← → (Shift: 10 at a time), Home and End.",
    points: "points",
    last: "latest",
    simulated: "SIMULATED",
    simNote: "Includes SIMULATED (demo) data: it does not come from real sensors or records.",
    source: "Source",
    omittedTitle: "Engines without a chart",
    omittedIntro: "No chart is drawn without real data behind it:",
    reason: {
      empty: "no data has been recorded yet for this crew member and mission.",
      denied: "your role cannot access this data.",
      error: "the data could not be loaded ({msg}).",
      onlySelf: "the forecast can only be requested by the crew member themself (prediction engine permission).",
      noMission: "no mission selected.",
      private: "the crew member does not share their wellbeing signals with the mission leader.",
    },
    metricAria: "Metric",
    engines: {
      prediction: { name: "Prediction", desc: "Daily series, forecast and thresholds" },
      rules: { name: "Rules and alerts", desc: "Alerts per day and class" },
      cognitive: { name: "Cognitive", desc: "Results by domain" },
      emotional: { name: "Emotional", desc: "Operational state of each questionnaire" },
      isolation: { name: "Isolation", desc: "Check-in sleep and early signal" },
      radiation: { name: "Radiation", desc: "Dose against the career limit" },
    },
    pred: {
      indicator: "Indicator",
      history: "Daily median",
      forecast: "Forecast",
      band80: "80% band",
      limY: "Caution limit (Y)",
      limR: "Critical limit (R)",
      base: "Baseline",
      today: "latest data",
      forecastTip: "Forecast",
      bandTip: "80%: {lo} – {hi}",
      status: {
        insufficient_data: "No forecast: not enough days of valid measurements; only the series is shown.",
        model_not_reliable: "No forecast: the method did not beat repeating the last value in validation; only the series is shown.",
      },
      exploratory: "Exploratory forecast (robust level + validated OLS trend, z-score against the baseline). Not a diagnosis.",
      projection: "Current state against rule {rule}: {state}.",
    },
    rules: {
      count: "Alerts",
      day: "Day",
      cut: "The crew member's 100 most recent alerts are plotted.",
      total: "{n} alerts over {d} days",
    },
    cog: {
      accuracy: "Accuracy (%)",
      rt: "Response time (ms)",
      baseline: "baseline",
      review: "Needs review",
      difficulty: "Difficulty",
      note: "One series per domain (they are not combined into a global score). Changes may reflect a practice effect.",
    },
    emo: {
      state: {
        EMOTIONAL_WELLNESS_STABLE: "Stable",
        EMOTIONAL_WELLNESS_MONITORING: "Monitoring",
        SUPPORT_REQUESTED: "Support asked",
        PROFESSIONAL_REVIEW: "Prof. review",
        URGENT_SUPPORT: "Urgent",
      },
      series: "Operational state",
      privacy: "Only the operational state assigned by the engine; individual answers and dimensions stay private.",
    },
    iso: {
      sleep: "Sleep hours",
      target: "6 h threshold",
      quality: "Quality",
      mood: "Mood",
      energy: "Energy",
      isolated: "Feels isolated",
      yes: "yes",
      no: "no",
      flag: "Early signal: a check-in call is advised",
      note: "The engine flags NEEDS_CHECK_IN when the 3-day average sleep drops below 6 h or the last 3 check-ins have mood ≤ 2 or isolation.",
      avg: "7-day average sleep: {h} h ({n} check-ins).",
      flagHidden: "The crew member does not share their operational signal with the leader.",
    },
    rad: {
      cumulative: "Cumulative dose",
      daily: "Daily dose",
      yellow: "{p}% of limit",
      red: "Career limit",
      pct: "{p}% of the career limit ({lim} mSv)",
      prior: "Includes {d} mSv from earlier missions.",
      method: "Cumulative = sum of the last valid reading of each UTC day (days without a reading are not imputed), as the rules engine does.",
    },
  },
};

const ORDER = ["prediction", "rules", "cognitive", "emotional", "isolation", "radiation"];

/* Escrituras (path de apiService.request) que cambian la serie de cada motor */
const SOURCES = {
  prediction: /^\/(health\/measurements|simulator)/,
  rules: /^\/(health\/measurements|simulator|alerts|emotional-assessments|wellness\/quick-checkin|cognitive\/assessments)/,
  cognitive: /^\/(cognitive\/assessments|simulator)/,
  emotional: /^\/(emotional-assessments|simulator)/,
  isolation: /^\/wellness\/quick-checkin/,
  radiation: /^\/(health\/measurements|simulator)/,
};

const SOURCE_TEXT = {
  prediction: "GET /predictions/indicators/{code} · GET /analytics/timeseries",
  rules: "GET /alerts",
  cognitive: "GET /cognitive/history",
  emotional: "GET /logbook/emotional-states",
  isolation: "GET /wellness/quick-checkin",
  radiation: "GET /logbook/radiation-dose",
};

/* Estado del módulo */
const st = {
  key: null,
  el: null,
  ctx: null,
  sel: null,
  picked: false, // el usuario eligió motor: no se cambia solo al llegar otras series
  metric: { cognitive: "accuracy", radiation: "cumulative" },
  predCode: null,
  data: {}, // id → { status, raw, msg }
  seq: {}, // id → nº de petición (descarta respuestas obsoletas)
  chart: null,
  pending: new Set(),
  timer: 0,
};

function ensureCss() {
  if (document.getElementById("av-le-css")) return;
  const link = document.createElement("link");
  link.id = "av-le-css";
  link.rel = "stylesheet";
  link.href = new URL("./logbook-engines.css", import.meta.url).href;
  document.head.appendChild(link);
}

const fmtNum = (v, dec) => (isNum(v) ? num(Number(v), dec) : "—");
const dec1 = (v) => fmtNum(v, Math.abs(Number(v)) < 10 && !Number.isInteger(Number(v)) ? 2 : 1);
const axisFmt = (v, span) => num(v, span < 2 ? 2 : span < 20 ? 1 : 0);
const tipHTML = (main, time, extra = []) =>
  `<strong class="av-mono">${esc(main)}</strong><span class="av-mono">${esc(time)}</span>${extra.map((x) => `<span>${x}</span>`).join("")}`;
const worstLetter = (letters) => letters.reduce((a, l) => ((RANK[l] || 0) > (RANK[a] || 0) ? l : a), "N");

/* ───────────────────────── carga ───────────────────────── */

function isSelfAstronaut(ctx) {
  const cu = ctx.appState.currentUser || {};
  return cu.role_code === "ASTRONAUT" && sameId(cu.id, ctx.aid);
}

function predCodes(ctx) {
  return ((ctx.summary && ctx.summary.indicator_cards) || [])
    .filter((c) => c && c.indicator_code && (c.history_points || []).length >= 2)
    .map((c) => ({ code: c.indicator_code, name: bt(c.name) || c.indicator_code }));
}

/* Mediana diaria de /analytics/timeseries (misma agregación que el servicio de predicción) */
function dailyMedian(points) {
  const days = new Map();
  for (const p of points || []) {
    if (p.is_gap_marker || !isNum(p.value)) continue;
    const t = Date.parse(p.measured_at);
    if (!Number.isFinite(t)) continue;
    const d = dayStart(t);
    if (!days.has(d)) days.set(d, { vals: [], sim: false });
    const e = days.get(d);
    e.vals.push(Number(p.value));
    e.sim = e.sim || !!p.is_simulated;
  }
  return [...days.keys()].sort((a, b) => a - b).slice(-90).map((d) => {
    const v = days.get(d).vals.sort((a, b) => a - b);
    const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    return { t: d, v: m, sim: days.get(d).sim };
  });
}

const LOADERS = {
  async prediction(ctx) {
    if (!isSelfAstronaut(ctx)) return { status: "onlySelf" };
    if (!ctx.mid) return { status: "noMission" };
    const codes = predCodes(ctx);
    if (!codes.length) return { status: "empty" };
    if (!st.predCode || !codes.some((c) => c.code === st.predCode)) {
      st.predCode = (codes.find((c) => c.code === "HEART_RATE") || codes[0]).code;
    }
    const code = st.predCode;
    // incluye datos simulados (la demo es sintética): se etiquetan como SIMULADO
    const pred = await apiService.getIndicatorPrediction(code, { missionId: ctx.mid, horizonDays: 7, includeSimulated: true });
    const ts = await apiService.getAnalyticsTimeseries({
      astronaut_id: ctx.aid, mission_id: ctx.mid, indicator_code: code,
      phase_code: pred && pred.phase_code, environment_code: pred && pred.environment_code,
    });
    const hist = dailyMedian(ts && ts.points);
    if (!hist.length) return { status: "empty" };
    return { status: "ok", raw: { code, codes, pred, hist, unit: (pred && pred.unit) || (ts && ts.unit) || "", baseline: ts && ts.baseline_value } };
  },
  async rules(ctx) {
    const res = await apiService.getAlerts(ctx.aid);
    const all = (res && res.alerts) || [];
    const alerts = all.filter((a) => !ctx.mid || !a.mission_id || sameId(a.mission_id, ctx.mid));
    return alerts.length ? { status: "ok", raw: { alerts, cut: all.length >= 100 } } : { status: "empty" };
  },
  async cognitive(ctx) {
    const res = await apiService.getCognitiveHistory(ctx.aid);
    const rows = ((res && res.history) || []).filter(
      (r) => r && r.result && r.completed_at && (!ctx.mid || sameId(r.mission_id, ctx.mid)),
    );
    return rows.length ? { status: "ok", raw: { rows } } : { status: "empty" };
  },
  async emotional(ctx) {
    const res = await apiService.getLogbookEmotionalStates(ctx.aid, ctx.mid);
    if (res && res.shared_with_viewer === false) return { status: "private" };
    const pts = (res && res.points) || [];
    return pts.length ? { status: "ok", raw: res } : { status: "empty" };
  },
  async isolation(ctx) {
    const res = await apiService.getQuickCheckins(ctx.aid, 60);
    const items = ((res && res.items) || []).filter((c) => isNum(c.sleep_hours) && c.created_at);
    return items.length ? { status: "ok", raw: { items: items.slice().reverse(), summary: (res && res.summary) || {} } } : { status: "empty" };
  },
  async radiation(ctx) {
    const res = await apiService.getLogbookRadiationDose(ctx.aid, ctx.mid);
    return res && (res.points || []).length ? { status: "ok", raw: res } : { status: "empty" };
  },
};

async function loadEngine(id) {
  const ctx = st.ctx;
  const key = st.key;
  const seq = (st.seq[id] || 0) + 1;
  st.seq[id] = seq;
  if (!st.data[id]) st.data[id] = { status: "loading" };
  else st.data[id] = { ...st.data[id], reloading: true };
  let out;
  try {
    out = await LOADERS[id](ctx);
  } catch (err) {
    const status = err && (err.status === 403 || err.status === 401) ? "denied" : "error";
    out = { status, msg: (err && err.message) || "" };
  }
  if (st.seq[id] !== seq || st.key !== key) return; // respuesta obsoleta
  st.data[id] = out;
  paint();
}

function loadAll() {
  return Promise.all(ORDER.map((id) => loadEngine(id)));
}

/* ───────────────────────── series por motor ───────────────────────── */

const BUILD = {
  prediction(raw, T) {
    const P = T.pred;
    const unit = bt(raw.unit || "");
    const pred = raw.pred || {};
    const hist = raw.hist;
    const last = hist[hist.length - 1];
    const fc = (pred.status === "ok" ? pred.forecast || [] : [])
      .filter((f) => f && isNum(f.value) && Date.parse(`${f.date}T00:00:00Z`))
      .map((f) => ({ ...f, t: Date.parse(`${f.date}T00:00:00Z`), v: Number(f.value) }));
    const ranges = (pred.threshold_projection && pred.threshold_projection.ranges) || {};
    const pair = (k) => (Array.isArray(ranges[k]) ? ranges[k] : [null, null]);
    const [yLo0, yHi0] = pair("monitor");
    const [rLo, rHi] = pair("warning");
    const yLo = isNum(yLo0) && yLo0 !== rLo ? Number(yLo0) : null;
    const yHi = isNum(yHi0) && yHi0 !== rHi ? Number(yHi0) : null;
    const baseline = isNum(raw.baseline) ? Number(raw.baseline) : isNum(pred.baseline_value) ? Number(pred.baseline_value) : null;
    const hlines = [
      { v: yLo, cls: "av-lec-lim-y", label: "Y" }, { v: yHi, cls: "av-lec-lim-y", label: "Y" },
      { v: isNum(rLo) ? Number(rLo) : null, cls: "av-lec-lim-r", label: "R" }, { v: isNum(rHi) ? Number(rHi) : null, cls: "av-lec-lim-r", label: "R" },
      { v: baseline, cls: "av-lec-base", label: P.base },
    ].filter((h) => isNum(h.v));
    const series = [];
    if (fc.length) {
      const band = fc.filter((f) => isNum(f.lower_80) && isNum(f.upper_80)).map((f) => ({ t: f.t, lo: Number(f.lower_80), hi: Number(f.upper_80) }));
      if (band.length) series.push({ kind: "area", cls: "fc", points: [{ t: last.t, lo: last.v, hi: last.v }, ...band] });
    }
    series.push({ kind: "line", cls: "s1", dots: true, points: hist.map((h) => ({ t: h.t, v: h.v })) });
    if (fc.length) series.push({ kind: "line", cls: "fc", dashed: true, dots: true, points: [{ t: last.t, v: last.v }, ...fc.map((f) => ({ t: f.t, v: f.v }))] });
    const nav = [
      ...hist.map((h) => ({
        t: h.t, v: h.v,
        html: tipHTML(`${dec1(h.v)} ${unit}`.trim(), `${when(h.t)} GMT`, [esc(P.history), h.sim ? `<span class="av-log-sim">${esc(T.simulated)}</span>` : ""].filter(Boolean)),
        sr: `${P.history} ${dec1(h.v)} ${unit}, ${when(h.t)} GMT${h.sim ? `, ${T.simulated}` : ""}`,
      })),
      ...fc.map((f) => {
        const l = LETTER[f.projected_state] || null;
        const band = isNum(f.lower_80) && isNum(f.upper_80) ? fmt(P.bandTip, { lo: dec1(f.lower_80), hi: dec1(f.upper_80) }) : "";
        const word = l && l !== "N" ? STATE_WORD[l] : "";
        return {
          t: f.t, v: f.v, l,
          html: tipHTML(`${dec1(f.v)} ${unit}`.trim(), `${when(f.t)} GMT`, [esc(P.forecastTip), band ? esc(band) : "", word ? `${badge(l, word)} ${esc(word)}` : ""].filter(Boolean)),
          sr: `${P.forecastTip} ${dec1(f.v)} ${unit}, ${when(f.t)} GMT${band ? `, ${band}` : ""}${word ? `, ${word}` : ""}`,
        };
      }),
    ];
    const legend = [{ key: "s1", label: P.history }];
    if (fc.length) legend.push({ key: "fc", label: P.forecast }, { key: "fc-area", label: P.band80 });
    if (isNum(yLo) || isNum(yHi)) legend.push({ key: "y", label: `${P.limY} ${[yLo, yHi].filter(isNum).map(dec1).join(" / ")}` });
    if (isNum(rLo) || isNum(rHi)) legend.push({ key: "r", label: `${P.limR} ${[rLo, rHi].filter(isNum).map(dec1).join(" / ")}` });
    if (isNum(baseline)) legend.push({ key: "base", label: `${P.base} ${dec1(baseline)}` });
    const notes = [];
    if (P.status[pred.status]) notes.push(P.status[pred.status]);
    else notes.push(P.exploratory);
    const tp = pred.threshold_projection;
    if (tp && tp.current_state) {
      const l = LETTER[tp.current_state] || "N";
      notes.push(fmt(P.projection, { rule: tp.rule_code || "—", state: STATE_WORD[l] || tp.current_state }));
    }
    const lastNav = nav[nav.length - 1];
    return {
      spec: { series, nav, hlines, splitT: fc.length ? last.t : null, fmtAxis: axisFmt },
      legend, notes, sim: hist.some((h) => h.sim),
      caption: `${dec1(last.v)} ${unit}`.trim(), letter: worstLetter(fc.map((f) => LETTER[f.projected_state] || "N")),
      count: nav.length, from: nav[0].t, to: lastNav.t,
    };
  },

  rules(raw, T) {
    const R = T.rules;
    const days = new Map();
    let sim = false;
    for (const a of raw.alerts) {
      const l = LETTER[a.operational_state];
      const t = Date.parse(a.created_at);
      if (!["W", "C", "A"].includes(l) || !Number.isFinite(t)) continue;
      const d = dayStart(t) + DAY / 2;
      if (!days.has(d)) days.set(d, { W: 0, C: 0, A: 0 });
      days.get(d)[l] += 1;
      sim = sim || !!a.is_simulated;
    }
    const ds = [...days.keys()].sort((a, b) => a - b);
    if (!ds.length) return null;
    const max = Math.max(...ds.map((d) => days.get(d).W + days.get(d).C + days.get(d).A));
    const step = Math.max(1, Math.ceil(max / 4));
    const yTicks = [0, 1, 2, 3, 4].map((i) => ({ v: i * step, label: num(i * step, 0) }));
    const series = ["W", "C", "A"].map((l) => ({ kind: "bar", cls: l, points: ds.map((d) => ({ t: d, v: days.get(d)[l] })) }));
    const nav = ds.map((d) => {
      const c = days.get(d);
      const total = c.W + c.C + c.A;
      const l = c.W ? "W" : c.C ? "C" : "A";
      const parts = ["W", "C", "A"].filter((k) => c[k]).map((k) => `${badge(k, STATE_WORD[k])} ${esc(STATE_WORD[k])}: <span class="av-mono">${c[k]}</span>`);
      return {
        t: d, v: total, l,
        html: tipHTML(`${total} ${R.count.toLowerCase()}`, `${R.day} ${when(dayStart(d)).split("/")[0]}`, parts),
        sr: `${R.day} ${when(dayStart(d)).split("/")[0]}: ${["W", "C", "A"].filter((k) => c[k]).map((k) => `${c[k]} ${STATE_WORD[k]}`).join(", ")}`,
      };
    });
    const total = nav.reduce((s, n) => s + n.v, 0);
    const notes = [fmt(R.total, { n: total, d: ds.length })];
    if (raw.cut) notes.push(R.cut);
    return {
      spec: { series, nav, yDomain: [0, step * 4], yTicks, fmtAxis: axisFmt },
      legend: ["W", "C", "A"].map((l) => ({ key: `bar-${l}`, label: STATE_WORD[l] })),
      notes, sim, caption: fmt(R.total, { n: total, d: ds.length }), letter: worstLetter(nav.slice(-3).map((n) => n.l)),
      count: nav.length, from: dayStart(ds[0]), to: dayStart(ds[ds.length - 1]) + DAY - 1, yUnit: R.count,
    };
  },

  cognitive(raw, T, metric) {
    const C = T.cog;
    const rt = metric === "rt";
    const key = rt ? "mean_response_time_ms" : "accuracy_percent";
    const rows = raw.rows
      .filter((r) => isNum(r.result[key]) && Number.isFinite(Date.parse(r.completed_at)))
      .map((r) => ({ ...r, t: Date.parse(r.completed_at), v: Number(r.result[key]) }))
      .sort((a, b) => a.t - b.t);
    if (!rows.length) return null;
    const domains = [...new Set(rows.map((r) => r.domain_code))];
    const clsOf = (d) => `s${(domains.indexOf(d) % 5) + 1}`;
    const nameOf = (r) => bt(r.domain_name) || r.domain_code;
    const series = domains.map((d) => ({ kind: "line", cls: clsOf(d), dots: true, points: rows.filter((r) => r.domain_code === d).map((r) => ({ t: r.t, v: r.v })) }));
    const unit = rt ? "ms" : "%";
    const nav = rows.map((r) => {
      const b = r.comparable_baseline;
      const bv = b && isNum(rt ? b.baseline_mean_rt_ms : b.baseline_accuracy_percent) ? Number(rt ? b.baseline_mean_rt_ms : b.baseline_accuracy_percent) : null;
      const extra = [
        `<span class="av-le-swatch av-lec-${clsOf(r.domain_code)}" aria-hidden="true"></span>${esc(nameOf(r))}`,
        `${esc(C.difficulty)}: ${esc(bt(r.difficulty) || r.difficulty || "—")}`,
      ];
      if (bv !== null) extra.push(`${esc(C.baseline)} <span class="av-mono">${esc(fmtNum(bv, rt ? 0 : 1))} ${unit}</span>`);
      if (r.result.requires_review) extra.push(esc(C.review));
      if (r.is_simulated) extra.push(`<span class="av-log-sim">${esc(T.simulated)}</span>`);
      return {
        t: r.t, v: r.v,
        html: tipHTML(`${fmtNum(r.v, rt ? 0 : 1)} ${unit}`, `${when(r.t)} GMT`, extra),
        sr: `${nameOf(r)}: ${fmtNum(r.v, rt ? 0 : 1)} ${unit}, ${when(r.t)} GMT${bv !== null ? `, ${C.baseline} ${fmtNum(bv, rt ? 0 : 1)}` : ""}${r.result.requires_review ? `, ${C.review}` : ""}`,
      };
    });
    const lastRow = rows[rows.length - 1];
    return {
      spec: { series, nav, fmtAxis: axisFmt, ...(rt ? { zeroBased: true } : {}) },
      legend: domains.map((d) => ({ key: clsOf(d), label: nameOf(rows.find((r) => r.domain_code === d)) })),
      notes: [C.note], sim: rows.some((r) => r.is_simulated),
      caption: `${nameOf(lastRow)} ${fmtNum(lastRow.v, rt ? 0 : 1)} ${unit}`, letter: "N",
      count: nav.length, from: rows[0].t, to: lastRow.t,
    };
  },

  emotional(raw, T) {
    const E = T.emo;
    const states = raw.states || Object.keys(E.state);
    const LET = { EMOTIONAL_WELLNESS_STABLE: "N", EMOTIONAL_WELLNESS_MONITORING: "A", SUPPORT_REQUESTED: "C", PROFESSIONAL_REVIEW: "C", URGENT_SUPPORT: "W" };
    const pts = (raw.points || [])
      .map((p) => ({ ...p, t: Date.parse(p.completed_at), v: states.indexOf(p.operational_state) }))
      .filter((p) => Number.isFinite(p.t) && p.v >= 0)
      .sort((a, b) => a.t - b.t);
    if (!pts.length) return null;
    const yTicks = states.map((s, i) => ({ v: i, label: E.state[s] || s }));
    const nav = pts.map((p) => {
      const l = LET[p.operational_state] || "N";
      const name = E.state[p.operational_state] || p.operational_state;
      return {
        t: p.t, v: p.v, l,
        html: tipHTML(name, `${when(p.t)} GMT`, [p.phase_code ? esc(bt(p.phase_code) || p.phase_code) : "", p.is_simulated ? `<span class="av-log-sim">${esc(T.simulated)}</span>` : ""].filter(Boolean)),
        sr: `${name}, ${when(p.t)} GMT`,
      };
    });
    const last = pts[pts.length - 1];
    return {
      spec: { series: [{ kind: "step", cls: "s1", dots: true, points: pts.map((p) => ({ t: p.t, v: p.v })) }], nav, yDomain: [-0.4, states.length - 0.6], yTicks, fmtAxis: axisFmt },
      legend: [{ key: "s1", label: E.series }], notes: [E.privacy], sim: pts.some((p) => p.is_simulated),
      caption: E.state[last.operational_state] || last.operational_state, letter: LET[last.operational_state] || "N",
      count: nav.length, from: pts[0].t, to: last.t,
    };
  },

  isolation(raw, T) {
    const I = T.iso;
    const items = raw.items.map((c) => ({ ...c, t: Date.parse(c.created_at), v: Number(c.sleep_hours) })).filter((c) => Number.isFinite(c.t));
    if (!items.length) return null;
    const yn = (b) => (b ? I.yes : I.no);
    const nav = items.map((c) => {
      const flag = c.operational_flag === "NEEDS_CHECK_IN";
      const extra = [];
      if (isNum(c.sleep_quality)) extra.push(`${esc(I.quality)} <span class="av-mono">${c.sleep_quality}/5</span>`);
      if (isNum(c.mood)) extra.push(`${esc(I.mood)} <span class="av-mono">${c.mood}/5</span> · ${esc(I.energy)} <span class="av-mono">${isNum(c.energy) ? c.energy : "—"}/5</span>`);
      if (c.feels_isolated !== null && c.feels_isolated !== undefined) extra.push(`${esc(I.isolated)}: ${esc(yn(c.feels_isolated))}`);
      if (flag) extra.push(`${badge("C", STATE_WORD.C)} ${esc(I.flag)}`);
      return {
        t: c.t, v: c.v, l: flag ? "C" : null,
        html: tipHTML(`${fmtNum(c.v, 1)} h`, `${when(c.t)} GMT`, extra),
        sr: `${I.sleep} ${fmtNum(c.v, 1)} h, ${when(c.t)} GMT${flag ? `, ${I.flag}` : ""}`,
      };
    });
    const s = raw.summary || {};
    const notes = [I.note];
    if (isNum(s.avg_sleep_hours_7d)) notes.push(fmt(I.avg, { h: fmtNum(s.avg_sleep_hours_7d, 1), n: s.checkins_7d ?? "—" }));
    if (items.every((c) => c.operational_flag === null || c.operational_flag === undefined)) notes.push(I.flagHidden);
    const last = items[items.length - 1];
    return {
      spec: {
        series: [{ kind: "line", cls: "s1", dots: true, points: items.map((c) => ({ t: c.t, v: c.v })) }],
        nav, hlines: [{ v: 6, cls: "av-lec-lim-y", label: "6 h", always: true }], zeroBased: true, fmtAxis: axisFmt,
      },
      legend: [{ key: "s1", label: I.sleep }, { key: "y", label: I.target }],
      notes, sim: false, caption: `${fmtNum(last.v, 1)} h`, letter: s.operational_flag === "NEEDS_CHECK_IN" ? "C" : "N",
      count: nav.length, from: items[0].t, to: last.t,
    };
  },

  radiation(raw, T, metric) {
    const R = T.rad;
    const daily = metric === "daily";
    const unit = bt(raw.unit || "mSv");
    const lim = Number(raw.career_limit_msv) || 600;
    const yPct = Number(raw.yellow_percent) || 50;
    const pts = (raw.points || [])
      .map((p) => ({ ...p, t: Date.parse(p.measured_at || `${p.date}T12:00:00Z`) }))
      .filter((p) => Number.isFinite(p.t) && isNum(daily ? p.daily_dose : p.cumulative_dose))
      .map((p) => ({ ...p, v: Number(daily ? p.daily_dose : p.cumulative_dose) }));
    if (!pts.length) return null;
    const nav = pts.map((p) => {
      const l = LETTER[daily ? p.reading_state : p.cumulative_state] || null;
      const pct = fmt(R.pct, { p: fmtNum(p.percent_of_career_limit, 2), lim: num(lim, 0) });
      const extra = [
        `${esc(R.daily)} <span class="av-mono">${esc(dec1(p.daily_dose))} ${esc(unit)}</span>`,
        `${esc(R.cumulative)} <span class="av-mono">${esc(fmtNum(p.cumulative_dose, 2))} ${esc(unit)}</span>`,
        esc(pct),
      ];
      if (l === "C" || l === "W") extra.push(`${badge(l, STATE_WORD[l])} ${esc(STATE_WORD[l])}`);
      if (p.is_simulated) extra.push(`<span class="av-log-sim">${esc(T.simulated)}</span>`);
      return {
        t: p.t, v: p.v, l,
        html: tipHTML(`${daily ? dec1(p.v) : fmtNum(p.v, 2)} ${unit}`, `${when(p.t)} GMT`, extra),
        sr: `${daily ? R.daily : R.cumulative} ${daily ? dec1(p.v) : fmtNum(p.v, 2)} ${unit}, ${when(p.t)} GMT, ${pct}`,
      };
    });
    const hlines = daily ? [] : [
      { v: (lim * yPct) / 100, cls: "av-lec-lim-y", label: `${num(yPct, 0)} %` },
      { v: lim, cls: "av-lec-lim-r", label: "100 %" },
    ];
    const last = pts[pts.length - 1];
    const notes = [fmt(R.pct, { p: fmtNum(last.percent_of_career_limit, 2), lim: num(lim, 0) }), R.method];
    if (Number(raw.prior_cumulative_dose) > 0) notes.push(fmt(R.prior, { d: fmtNum(raw.prior_cumulative_dose, 2) }));
    const legend = [{ key: "s1", label: daily ? R.daily : R.cumulative }];
    if (!daily) legend.push({ key: "y", label: `${fmt(R.yellow, { p: num(yPct, 0) })} (${num((lim * yPct) / 100, 0)} ${unit})` }, { key: "r", label: `${R.red} (${num(lim, 0)} ${unit})` });
    return {
      spec: { series: [{ kind: "line", cls: "s1", dots: true, points: pts.map((p) => ({ t: p.t, v: p.v })) }], nav, hlines, zeroBased: !daily, fmtAxis: axisFmt },
      legend, notes, sim: pts.some((p) => p.is_simulated),
      caption: `${fmtNum(last.cumulative_dose, 2)} ${unit} · ${fmtNum(last.percent_of_career_limit, 1)} %`,
      letter: LETTER[last.cumulative_state] || "N", count: nav.length, from: pts[0].t, to: last.t,
    };
  },
};

const METRICS = {
  cognitive: (T) => [{ id: "accuracy", label: T.cog.accuracy }, { id: "rt", label: T.cog.rt }],
  radiation: (T) => [{ id: "cumulative", label: T.rad.cumulative }, { id: "daily", label: T.rad.daily }],
};

function built(id, T) {
  const d = st.data[id];
  if (!d || d.status !== "ok") return null;
  try {
    return BUILD[id](d.raw, T, st.metric[id]);
  } catch {
    return null;
  }
}

/* ───────────────────────── pintado ───────────────────────── */

function itemHTML(id, T, b, loading) {
  const E = T.engines[id];
  const alarm = b && (b.letter === "C" || b.letter === "W") ? b.letter : "";
  const caption = loading ? T.loading : `${b.count} ${T.points} · ${b.caption}`;
  const aria = `${E.name}: ${E.desc}. ${caption}${b && b.sim ? `. ${T.simulated}` : ""}`;
  return `<li><button type="button" class="av-le-item${alarm ? ` av-le-item-${alarm}` : ""}" data-le-engine="${id}" aria-pressed="${st.sel === id}" aria-controls="av-le-detail" aria-label="${esc(aria)}"${loading ? " aria-busy=\"true\"" : ""}>
    <span class="av-le-item-top"><span class="av-le-item-name">${esc(E.name)}</span>${alarm ? badge(alarm, STATE_WORD[alarm]) : ""}</span>
    <span class="av-sub av-le-item-desc">${esc(E.desc)}</span>
    <span class="av-le-item-cap av-mono">${esc(caption)}${b && b.sim ? ` <span class="av-log-sim">${esc(T.simulated)}</span>` : ""}</span>
  </button></li>`;
}

function legendHTML(legend) {
  return `<ul class="av-le-legend">${legend.map((k) => `<li><span class="av-le-key av-le-key-${esc(k.key)}" aria-hidden="true"></span>${esc(k.label)}</li>`).join("")}</ul>`;
}

function controlsHTML(id, T) {
  let html = "";
  if (METRICS[id]) {
    html += `<div class="av-le-metrics" role="group" aria-label="${esc(T.metricAria)}">${METRICS[id](T)
      .map((m) => `<button type="button" class="av-btn av-btn-sm av-le-metric" data-le-metric="${m.id}" aria-pressed="${st.metric[id] === m.id}">${esc(m.label)}</button>`)
      .join("")}</div>`;
  }
  if (id === "prediction") {
    const raw = st.data.prediction && st.data.prediction.raw;
    const codes = (raw && raw.codes) || [];
    html += `<label class="av-le-pred"><span class="av-lbl">${esc(T.pred.indicator)}</span>
      <select class="av-input" data-le-pred>${codes.map((c) => `<option value="${esc(c.code)}"${c.code === st.predCode ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>`;
  }
  return html ? `<div class="av-le-controls">${html}</div>` : "";
}

function detailHTML(id, T, b) {
  const E = T.engines[id];
  const range = b ? `${b.count} ${T.points} · ${when(b.from)} – ${when(b.to)} GMT` : "";
  const head = `<div class="av-le-dhead">
      <h3 class="av-h3" id="av-le-dtitle">${esc(E.name)}${b && b.sim ? ` <span class="av-log-sim">${esc(T.simulated)}</span>` : ""}</h3>
      <span class="av-sub">${esc(range)}</span>
    </div>`;
  const d = st.data[id] || {};
  if (!b) return `${head}${controlsHTML(id, T)}<p class="av-le-empty" role="status">${esc(T.loadingChart)}</p>`;
  const notes = [...b.notes];
  if (b.sim) notes.push(T.simNote);
  return `${head}
    ${controlsHTML(id, T)}
    ${legendHTML(b.legend)}
    <div class="av-le-chartbox"${d.reloading ? " aria-busy=\"true\"" : ""}></div>
    <p class="av-sub av-le-help" id="av-le-help">${esc(T.help)}</p>
    ${notes.map((n) => `<p class="av-sub av-le-note">${esc(n)}</p>`).join("")}
    <p class="av-sub av-le-src">${esc(T.source)}: <span class="av-mono">${esc(SOURCE_TEXT[id])}</span></p>`;
}

function omittedHTML(T) {
  const out = ORDER.filter((id) => {
    const d = st.data[id];
    return d && d.status !== "ok" && d.status !== "loading";
  }).map((id) => {
    const d = st.data[id];
    const why = d.status === "error" ? fmt(T.reason.error, { msg: d.msg || "—" }) : T.reason[d.status] || T.reason.empty;
    return `<li><strong>${esc(T.engines[id].name)}</strong>: ${esc(why)}</li>`;
  });
  return out.length
    ? `<div class="av-le-omitted"><h3 class="av-h3">${esc(T.omittedTitle)}</h3><p class="av-sub">${esc(T.omittedIntro)}</p><ul>${out.join("")}</ul></div>`
    : "";
}

function paint() {
  const el = st.el;
  if (!el || !el.isConnected) return;
  const T = tr(DICT);
  const builds = {};
  for (const id of ORDER) builds[id] = built(id, T);
  // un motor con datos que no producen serie (p. ej. alertas sin clase) se trata como vacío
  for (const id of ORDER) if (st.data[id] && st.data[id].status === "ok" && !builds[id]) st.data[id] = { status: "empty" };
  const shown = ORDER.filter((id) => !st.data[id] || st.data[id].status === "loading" || builds[id]);
  if (!st.sel || !shown.includes(st.sel) || (!st.picked && !builds[st.sel] && shown.some((id) => builds[id]))) {
    st.sel = shown.find((id) => builds[id] && (builds[id].letter === "C" || builds[id].letter === "W")) || shown.find((id) => builds[id]) || shown[0] || null;
  }

  // conserva el foco si estaba dentro (p. ej. en un botón de métrica)
  const active = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
  const focusSel = active && (active.getAttribute("data-le-engine") ? `[data-le-engine="${active.getAttribute("data-le-engine")}"]`
    : active.getAttribute("data-le-metric") ? `[data-le-metric="${active.getAttribute("data-le-metric")}"]`
      : active.hasAttribute("data-le-pred") ? "[data-le-pred]" : null);

  const body = shown.length
    ? `<div class="av-le-body">
        <ul class="av-le-list" aria-label="${esc(T.listAria)}">${shown.map((id) => itemHTML(id, T, builds[id], !builds[id])).join("")}</ul>
        <div class="av-le-detail" id="av-le-detail">${st.sel ? detailHTML(st.sel, T, builds[st.sel]) : ""}</div>
      </div>`
    : "";
  el.innerHTML = `<section class="av-panel av-le" aria-labelledby="av-le-h">
    <div class="av-panel-head"><div><h2 class="av-h2" id="av-le-h">${esc(T.title)}</h2> <span class="av-sub">${esc(T.sub)}</span></div></div>
    ${body}
    ${omittedHTML(T)}
  </section>`;

  if (st.chart) { st.chart.destroy(); st.chart = null; }
  const b = st.sel && builds[st.sel];
  const host = el.querySelector(".av-le-chartbox");
  if (b && host) {
    const E = T.engines[st.sel];
    st.chart = renderEngineChart(host, {
      ...b.spec,
      label: `${E.name}: ${b.count} ${T.points}, ${when(b.from)} – ${when(b.to)} GMT. ${T.last}: ${b.caption}`,
      roleDesc: T.chartRole,
      helpId: "av-le-help",
      fmtTime: when,
    });
  }
  if (focusSel) {
    const again = el.querySelector(focusSel);
    if (again) again.focus();
  }
}

/* ───────────────────────── eventos ───────────────────────── */

function bindOnce(el) {
  if (el.dataset.leBound) return;
  el.dataset.leBound = "1";
  el.addEventListener("click", (ev) => {
    const eng = ev.target.closest("[data-le-engine]");
    if (eng && el.contains(eng)) {
      const id = eng.getAttribute("data-le-engine");
      st.picked = true;
      if (id !== st.sel) { st.sel = id; paint(); }
      return;
    }
    const met = ev.target.closest("[data-le-metric]");
    if (met && el.contains(met) && st.sel && METRICS[st.sel]) {
      st.metric[st.sel] = met.getAttribute("data-le-metric");
      paint();
    }
  });
  el.addEventListener("change", (ev) => {
    const sel = ev.target.closest("[data-le-pred]");
    if (!sel) return;
    st.predCode = sel.value;
    loadEngine("prediction");
    paint();
  });
}

/* Escrituras en cualquier módulo: recarga solo los motores cuya serie cambia */
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("semsa:data-changed", (ev) => {
    if (!st.el || !st.el.isConnected) return;
    const path = String((ev.detail && ev.detail.path) || "");
    for (const id of ORDER) if (SOURCES[id].test(path)) st.pending.add(id);
    if (!st.pending.size) return;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      const ids = [...st.pending];
      st.pending.clear();
      if (st.el && st.el.isConnected) ids.forEach((id) => loadEngine(id));
    }, 600);
  });
}

/* ───────────────────────── punto de entrada ───────────────────────── */

/* Botón "Actualizar" de la Bitácora: vuelve a pedir todas las series */
export function refreshLogbookEngines() {
  if (!st.el || !st.el.isConnected) return Promise.resolve();
  return loadAll();
}

/*
 * el: contenedor. opts: { appState, summary, aid, mid }.
 * Cada llamada (cada apertura de la Bitácora) vuelve a pedir las series.
 */
export function renderLogbookEngines(el, opts) {
  if (!el) return;
  ensureCss();
  listen();
  const ctx = { ...opts };
  const key = `${ctx.aid}:${ctx.mid ?? ""}:${(ctx.appState.currentUser || {}).id ?? ""}`;
  if (st.key !== key) {
    st.key = key;
    st.sel = null;
    st.picked = false;
    st.predCode = null;
  }
  st.data = {};
  // st.seq no se reinicia: el contador por motor es monótono para que una respuesta en vuelo de una
  // apertura anterior nunca coincida con la de la apertura actual (auditoría #30).
  st.el = el;
  st.ctx = ctx;
  bindOnce(el);
  paint();
  loadAll();
}
