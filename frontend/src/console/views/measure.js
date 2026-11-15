/*
 * SEMSA · Consola · Vista "Registrar medición" (v2, simplificada)
 *
 * Pensada para que un tripulante registre un dato en pocos segundos, con guantes:
 *  1. Elige un indicador (primero los pendientes).
 *  2. Escribe el valor (botones − / +, escala 1–10 o dos campos para la presión).
 *  3. Guarda y ve el resultado con el siguiente paso.
 *
 * Fuera de esta vista quedan las opciones técnicas de la v1 (importar lote CSV/JSON,
 * fuente y calidad del dato, hora manual, cola sin conexión, tabla de límites).
 * La v1 está en measure.v1.bak.js por si hay que recuperar algo.
 *
 * Los datos vienen de ../data/measure-data.js (hoy JSON de ejemplo, luego SEMSA).
 * Convención de color (alert-classes.js): el color nunca va solo, siempre con letra o texto.
 */
// LETTER y STATE_WORD se toman de console.js (que los reexporta) para no depender de
// alert-classes.js: así la vista funciona también con el console.js desplegado hoy.
import { escapeHtml, badge, LETTER, STATE_WORD } from "../console.js";

const isAlarm = (l) => l === "W" || l === "C";
import { tr, fmt, fmtNum, getLang } from "../../i18n/i18n.js";
import { loadMeasureData, saveMeasurement, evaluate, validate, resetDemoData, DATA_MODE } from "../data/measure-data.js";

const esc = escapeHtml;

/* ───────────────────────── textos ───────────────────────── */

const DICT = {
  es: {
    title: "Registrar medición",
    progress: "Hoy: {d} de {t} al día",
    allDone: "¡Todo al día! No tienes mediciones pendientes.",
    today: "Hoy",
    upToDateWord: "al día",
    allDoneShort: "¡todo al día!",
    pendingHint: "sin dato o vencidos",
    demoTag: "DATOS DE EJEMPLO",
    demoHelp: "Modo demo: los datos vienen de un archivo de ejemplo y lo que guardes queda solo en este navegador.",
    reset: "Restablecer datos de ejemplo",
    resetDone: "Datos de ejemplo restablecidos.",
    loading: "Cargando…",
    loadFail: "No se pudieron cargar los indicadores: {msg}",
    pendingGroup: "Pendientes",
    doneGroup: "Al día",
    pendingTag: "PENDIENTE",
    skippedTag: "OMITIDO",
    neverMeasured: "Sin registros",
    ago: "hace {t}",
    lt1h: "menos de 1 h",
    hours: "{n} h",
    days: "{n} d",
    back: "← Volver a la lista",
    last: "Último: {v} · {age}",
    lastNone: "Aún no hay registros de este indicador.",
    howTo: "Cómo medir",
    device: "Necesitas: {d}",
    normal: "Normal: {r}",
    valueLabel: "Valor en {unit}",
    high: "Alta (sistólica)",
    less: "Restar",
    more: "Sumar",
    optional: "opcional",
    note: "Añadir una nota",
    notePh: "Ej.: medí después de hacer ejercicio",
    save: "Guardar",
    saving: "Guardando…",
    skip: "No tengo el equipo ahora",
    skipLater: "Omitir por ahora",
    unskip: "Volver a marcar como pendiente",
    forCrew: "Registrando para {crew}",
    pv: { NORMAL: "Dentro de lo normal", MONITOR: "Un poco fuera de lo ideal", WARNING: "Fuera de rango", CRITICAL: "Valor crítico" },
    errRange: "Ese valor no es posible ({r} {unit}). Revisa la lectura.",
    errSecRange: "El segundo valor debe estar entre {r}.",
    errSecOrder: "La baja debe ser menor que la alta.",
    errSecMissing: "Falta la presión baja (diastólica).",
    errEmpty: "Escribe un valor.",
    saved: "Guardado",
    msg: {
      NORMAL: "Todo en orden. ¡Buen trabajo!",
      MONITOR: "Está un poco fuera de lo ideal. Vuelve a medir más tarde.",
      WARNING: "Está fuera de rango. Repite la medición; si se mantiene, avisa al líder de misión.",
      CRITICAL: "Valor crítico. Repite la medición ahora y contacta al equipo médico.",
    },
    toAlerts: "Ir a Alertas",
    next: "Siguiente: {name} →",
    again: "Medir otra vez",
    finish: "Volver a la lista",
    savedToast: "{name}: {state}.",
    skipToast: "{name} omitido por ahora.",
    saveFail: "No se pudo guardar: {msg}",
  },
  en: {
    title: "Log measurement",
    progress: "Today: {d} of {t} up to date",
    allDone: "All caught up! Nothing pending.",
    today: "Today",
    upToDateWord: "up to date",
    allDoneShort: "all caught up!",
    pendingHint: "missing or stale",
    demoTag: "SAMPLE DATA",
    demoHelp: "Demo mode: data comes from a sample file and whatever you save stays in this browser only.",
    reset: "Reset sample data",
    resetDone: "Sample data reset.",
    loading: "Loading…",
    loadFail: "Could not load indicators: {msg}",
    pendingGroup: "Due",
    doneGroup: "Up to date",
    pendingTag: "DUE",
    skippedTag: "SKIPPED",
    neverMeasured: "No records",
    ago: "{t} ago",
    lt1h: "under 1 h",
    hours: "{n} h",
    days: "{n} d",
    back: "← Back to list",
    last: "Last: {v} · {age}",
    lastNone: "No records for this indicator yet.",
    howTo: "How to measure",
    device: "You need: {d}",
    normal: "Normal: {r}",
    valueLabel: "Value in {unit}",
    high: "High (systolic)",
    less: "Decrease",
    more: "Increase",
    optional: "optional",
    note: "Add a note",
    notePh: "E.g. measured after exercise",
    save: "Save",
    saving: "Saving…",
    skip: "I don't have the device now",
    skipLater: "Skip for now",
    unskip: "Mark as due again",
    forCrew: "Logging for {crew}",
    pv: { NORMAL: "Within normal range", MONITOR: "Slightly outside ideal", WARNING: "Out of range", CRITICAL: "Critical value" },
    errRange: "That value isn't possible ({r} {unit}). Check the reading.",
    errSecRange: "The second value must be between {r}.",
    errSecOrder: "The low number must be lower than the high one.",
    errSecMissing: "The low (diastolic) pressure is missing.",
    errEmpty: "Enter a value.",
    saved: "Saved",
    msg: {
      NORMAL: "All good. Nice work!",
      MONITOR: "Slightly outside ideal. Measure again later.",
      WARNING: "Out of range. Repeat the measurement; if it persists, tell the mission lead.",
      CRITICAL: "Critical value. Repeat the measurement now and contact the medical team.",
    },
    toAlerts: "Go to Alerts",
    next: "Next: {name} →",
    again: "Measure again",
    finish: "Back to list",
    savedToast: "{name}: {state}.",
    skipToast: "{name} skipped for now.",
    saveFail: "Could not save: {msg}",
  },
};

/* ───────────────────────── estado de la vista ───────────────────────── */

const ui = {
  astronautId: undefined,
  data: null, // { indicators, latest: Map, astronaut, mode }
  code: null, // indicador abierto
  result: null, // { code, m } tras guardar
  skipped: new Set(),
  busy: false,
  focus: null,
};

/* ───────────────────────── utilidades ───────────────────────── */

function ensureStyles() {
  if (document.getElementById("av-measure-css")) return;
  const link = document.createElement("link");
  link.id = "av-measure-css";
  link.rel = "stylesheet";
  link.href = new URL("./measure.css", import.meta.url).href;
  document.head.appendChild(link);
}

const isNil = (v) => v === null || v === undefined;
const WIDE_MQ = "(min-width: 821px)";
const isWide = () => typeof window !== "undefined" && window.matchMedia(WIDE_MQ).matches;
const en = () => getLang() === "en";
const nameOf = (ind) => (en() && ind.name_en) || ind.name;
const pick = (obj, key) => (obj ? (en() && obj[`${key}_en`]) || obj[key] : "");

function decimals(step) {
  const s = String(step || 1);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

function fmtV(v, ind) {
  if (isNil(v)) return "—";
  const d = Math.min(2, Math.max(decimals(ind?.step), Number.isInteger(v) ? 0 : String(v).split(".")[1]?.length || 0));
  return fmtNum(v, d);
}

function valueText(ind, v, s) {
  if (isNil(v)) return "—";
  if (ind.input === "pair" && !isNil(s)) return `${fmtV(v, ind)}/${fmtV(s, ind)}`;
  return fmtV(v, ind);
}

function unitText(ind) {
  return ind.input === "scale" ? "/10" : ind.unit;
}

function parseNum(raw) {
  if (isNil(raw)) return null;
  const s = String(raw).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rangeText(lo, hi, ind) {
  /* Un extremo igual al límite físico de validación significa "sin umbral en esa dirección"
     (así lo guardan las reglas calibradas con el dataset): se muestra solo el otro extremo. */
  if (!isNil(lo) && ind && !isNil(ind.min_valid_value) && lo <= ind.min_valid_value) lo = null;
  if (!isNil(hi) && ind && !isNil(ind.max_valid_value) && hi >= ind.max_valid_value) hi = null;
  if (isNil(lo) && isNil(hi)) return "—";
  if (isNil(hi)) return `≥ ${fmtV(lo, ind)}`;
  if (isNil(lo)) return `≤ ${fmtV(hi, ind)}`;
  return `${fmtV(lo, ind)} – ${fmtV(hi, ind)}`;
}

function ageHours(m) {
  if (!m || !m.measured_at) return null;
  return (Date.now() - new Date(m.measured_at).getTime()) / 3600e3;
}

function ageText(m) {
  const T = tr(DICT);
  const h = ageHours(m);
  if (isNil(h)) return T.neverMeasured;
  const t = h < 1 ? T.lt1h : h < 48 ? fmt(T.hours, { n: Math.floor(h) }) : fmt(T.days, { n: Math.floor(h / 24) });
  return fmt(T.ago, { t });
}

/* Indicadores con su último dato y si están pendientes, ordenados */
function buildRows() {
  const { indicators, latest } = ui.data;
  return indicators
    .map((ind, idx) => {
      const m = latest.get(ind.code) || null;
      const h = ageHours(m);
      const stale = isNil(h) || h > (ind.stale_after_hours || 24);
      const skipped = ui.skipped.has(ind.code);
      return { ind, m, idx, skipped, due: stale && !skipped, letter: m && !stale ? LETTER[m.state] || "N" : m ? "S" : "M" };
    })
    .sort((a, b) => Number(b.due) - Number(a.due) || Number(a.skipped) - Number(b.skipped) || a.idx - b.idx);
}

function targetCrewText(appState) {
  const me = appState.currentUser;
  const id = appState.selectedAstronautId;
  if (!me || isNil(id) || Number(me.id) === Number(id)) return "";
  const a = appState.healthSummary?.astronaut;
  const u = a && Number(a.id) === Number(id) ? a : (appState.usersList || []).find((x) => Number(x.id) === Number(id));
  return u ? `${u.full_name || ""}${u.crew_code ? ` (${u.crew_code})` : ""}`.trim() : `#${id}`;
}

function errorText(code, ind) {
  const T = tr(DICT);
  if (code === "range") return fmt(T.errRange, { r: rangeText(ind.min_valid_value, ind.max_valid_value, ind), unit: unitText(ind) });
  if (code === "secondary_range") return fmt(T.errSecRange, { r: rangeText(ind.secondary.min, ind.secondary.max, ind) });
  if (code === "secondary_order") return T.errSecOrder;
  if (code === "secondary_missing") return T.errSecMissing;
  return T.errEmpty;
}

/* ───────────────────────── entrada pública ───────────────────────── */

export async function renderMeasureView(container, appState, helpers) {
  ensureStyles();
  if (ui.astronautId !== appState.selectedAstronautId) {
    ui.astronautId = appState.selectedAstronautId;
    ui.code = null;
    ui.result = null;
    ui.skipped = new Set();
  }
  ui.busy = false;
  container.innerHTML = `<div class="av-console" data-av-measure-loading><div class="av-sub" style="padding:24px" role="status">${esc(tr(DICT).loading)}</div></div>`;
  try {
    ui.data = await loadMeasureData(appState);
  } catch (e) {
    if (!container.querySelector("[data-av-measure-loading]")) return;
    container.innerHTML = `<div class="av-console"><div class="av-panel" style="margin:12px;padding:16px" role="alert">${esc(fmt(tr(DICT).loadFail, { msg: e.message }))}</div></div>`;
    return;
  }
  if (!container.querySelector("[data-av-measure-loading]")) return; // cambió de pestaña mientras cargaba
  paint(container, appState, helpers);
}

/* ───────────────────────── render ───────────────────────── */

function paint(container, appState, helpers) {
  const T = tr(DICT);
  const rows = buildRows();
  // En escritorio el panel de registro siempre está abierto: si no hay nada elegido
  // se abre el primer pendiente (o el primero de la lista) para no dejar espacio vacío.
  if (!rows.some((r) => r.ind.code === ui.code) && isWide()) ui.code = rows[0]?.ind.code || null;
  const sel = rows.find((r) => r.ind.code === ui.code) || null;
  if (!sel) ui.code = null;
  const total = rows.length;
  const upToDate = rows.filter((r) => !r.due && !r.skipped).length;
  const crew = targetCrewText(appState);

  container.innerHTML = `
  <div class="av-console av-ms" data-av-measure-root ${sel ? "data-open" : ""}>
    <header class="av-ms-head">
      <h1 class="av-ms-title">${esc(T.title)}</h1>
      ${DATA_MODE === "demo" ? `<span class="av-ms-tag" title="${esc(T.demoHelp)}">${esc(T.demoTag)}</span>` : ""}
      ${crew ? `<strong class="av-ms-crew">${esc(fmt(T.forCrew, { crew }))}</strong>` : ""}
      <div class="av-ms-progress-wrap">
        <span class="av-ms-progress-lbl">${esc(T.today)}</span>
        <div class="av-ms-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${upToDate}" aria-label="${esc(fmt(T.progress, { d: upToDate, t: total }))}">
          <div class="av-ms-progress-bar" style="width:${total ? Math.round((upToDate / total) * 100) : 0}%"></div>
        </div>
        <span class="av-ms-progress-num">${upToDate}/${total}</span>
        <span class="av-ms-progress-lbl">${esc(rows.some((r) => r.due) ? T.upToDateWord : T.allDoneShort)}</span>
      </div>
    </header>
    <div class="av-ms-body">
      <div class="av-ms-left">
        ${tilesHTML(rows)}
        ${DATA_MODE === "demo" ? `<p class="av-ms-foot">${esc(T.demoHelp)} <button type="button" class="av-ms-link" data-act="reset">${esc(T.reset)}</button></p>` : ""}
      </div>
      ${sel ? entryHTML(sel, rows) : ""}
    </div>
    <div id="av-measure-live" class="av-ms-sr" role="status" aria-live="polite"></div>
  </div>`;

  const root = container.querySelector("[data-av-measure-root]");
  bind(root, container, appState, helpers, sel, rows);
  if (ui.focus) {
    const el = root.querySelector(ui.focus);
    ui.focus = null;
    if (el) el.focus({ preventScroll: false });
  }
}

function tilesHTML(rows) {
  const T = tr(DICT);
  const due = rows.filter((r) => r.due);
  const rest = rows.filter((r) => !r.due);
  const tile = (r) => {
    const { ind, m } = r;
    const cur = ind.code === ui.code;
    const l = r.letter;
    const has = !!m;
    const valCls = isAlarm(l) ? `av-val-${l}` : "";
    const tag = r.skipped ? T.skippedTag : r.due ? T.pendingTag : "";
    const label = `${nameOf(ind)}: ${has ? `${valueText(ind, m.value, m.secondary_value)} ${unitText(ind)}, ${ageText(m)}` : T.neverMeasured}${tag ? `, ${tag}` : ""}${has && !r.due ? `, ${STATE_WORD[l] || ""}` : ""}`;
    return `<li><button type="button" class="av-ms-tile${r.due ? " is-due" : ""}" data-pick="${esc(ind.code)}" aria-current="${cur ? "true" : "false"}" aria-label="${esc(label)}">
      <span class="av-ms-tile-top"><span class="av-ms-tile-name" title="${esc(nameOf(ind))}">${esc(nameOf(ind))}</span>${tag ? `<span class="av-ms-chip${r.due ? " is-due" : ""}">${esc(tag)}</span>` : has ? badge(l) : ""}</span>
      <span class="av-ms-tile-bottom">
        <span class="av-ms-tile-val"><span class="${valCls}">${esc(has ? valueText(ind, m.value, m.secondary_value) : "—")}</span>${has ? ` <small>${esc(unitText(ind))}</small>` : ""}</span>
        <span class="av-ms-tile-age">${esc(ageText(m))}</span>
      </span>
    </button></li>`;
  };
  return `
  <div class="av-ms-tiles">
    ${due.length ? `<h2 class="av-ms-group">${esc(T.pendingGroup)} <span>${due.length}</span><em>· ${esc(T.pendingHint)}</em></h2><ul class="av-ms-grid">${due.map(tile).join("")}</ul>` : ""}
    ${rest.length ? `<h2 class="av-ms-group">${esc(T.doneGroup)} <span>${rest.length}</span></h2><ul class="av-ms-grid">${rest.map(tile).join("")}</ul>` : ""}
  </div>`;
}

function entryHTML(sel, rows) {
  const T = tr(DICT);
  const { ind, m } = sel;
  const res = ui.result && ui.result.code === ind.code ? ui.result : null;
  const how = pick(ind, "how_to") || [];
  const device = pick(ind, "device");
  return `
  <section class="av-panel av-ms-entry" aria-labelledby="av-ms-entry-title">
    <button type="button" class="av-ms-back" data-act="close">${esc(T.back)}</button>
    <h2 class="av-ms-entry-title" id="av-ms-entry-title" tabindex="-1">${esc(nameOf(ind))}</h2>
    <p class="av-ms-last">${m ? esc(fmt(T.last, { v: `${valueText(ind, m.value, m.secondary_value)} ${unitText(ind)}`, age: ageText(m) })) : esc(T.lastNone)}</p>
    ${res ? resultHTML(sel, res, rows) : formHTML(sel, how, device)}
  </section>`;
}

function formHTML(sel, how, device) {
  const T = tr(DICT);
  const { ind } = sel;
  const unit = unitText(ind);
  const normal = fmt(T.normal, { r: `${rangeText(ind.normal_min, ind.normal_max, ind)} ${unit}` });
  let field = "";

  if (ind.input === "scale") {
    field = scaleHTML("value", nameOf(ind), pick(ind, "low"), pick(ind, "high"), true, true);
  } else if (ind.input === "pair") {
    field = `<div class="av-ms-pair">
      ${stepperHTML("av-ms-value", "value", T.high, ind, unit)}
      <span class="av-ms-slash" aria-hidden="true">/</span>
      ${stepperHTML("av-ms-secondary", "secondary", pick(ind.secondary, "label"), ind, unit)}
    </div>`;
  } else {
    field = stepperHTML("av-ms-value", "value", fmt(T.valueLabel, { unit }), ind, unit);
    if (ind.quick_add) {
      field += `<div class="av-ms-quick">${ind.quick_add.map((q) => `<button type="button" class="av-btn" data-add="${q}">+${fmtNum(q)} ${esc(unit)}</button>`).join("")}</div>`;
    }
    if (ind.secondary && ind.secondary.scale) {
      field += scaleHTML("secondary", `${pick(ind.secondary, "label")} (${T.optional})`, pick(ind.secondary, "low"), pick(ind.secondary, "high"), false);
    }
  }

  return `
    ${how.length ? `<details class="av-ms-how" ${sel.m ? "" : "open"}>
      <summary>${esc(T.howTo)}</summary>
      <ol>${how.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      ${device ? `<p class="av-ms-device">${esc(fmt(T.device, { d: device }))}</p>` : ""}
    </details>` : ""}
    <form class="av-ms-form" data-measure-form novalidate>
      ${field}
      <p class="av-ms-preview" id="av-ms-preview" aria-live="polite">${esc(normal)}</p>
      <details class="av-ms-note">
        <summary>${esc(T.note)}</summary>
        <input id="av-ms-notes" name="notes" class="av-input" type="text" maxlength="500" autocomplete="off" placeholder="${esc(T.notePh)}" aria-label="${esc(T.note)}">
      </details>
      <button type="submit" class="av-btn av-btn-primary av-ms-save" data-measure-submit>${esc(T.save)}</button>
      <button type="button" class="av-ms-link av-ms-skip" data-act="skip">${esc(sel.skipped ? T.unskip : ind.requires_device ? T.skip : T.skipLater)}</button>
    </form>`;
}

function stepperHTML(id, name, label, ind, unit) {
  const T = tr(DICT);
  return `<div class="av-ms-field">
    <label for="${id}">${esc(label)}</label>
    <div class="av-ms-stepper">
      <button type="button" class="av-ms-step" data-step="-1" data-for="${id}" aria-label="${esc(T.less)}">−</button>
      <input id="${id}" name="${name}" class="av-ms-input" type="text" inputmode="decimal" autocomplete="off" aria-describedby="av-ms-preview">
      <button type="button" class="av-ms-step" data-step="1" data-for="${id}" aria-label="${esc(T.more)}">+</button>
      <span class="av-ms-unit" aria-hidden="true">${esc(unit)}</span>
    </div>
  </div>`;
}

function scaleHTML(name, legend, low, high, required, hideLegend = false) {
  return `<fieldset class="av-ms-scale">
    <legend${hideLegend ? ' class="av-ms-sr"' : ""}>${esc(legend)}</legend>
    <div class="av-ms-scale-row">
      ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<label class="av-ms-scale-opt"><input type="radio" name="${name}" value="${n}" ${required ? "required" : ""}><span>${n}</span></label>`).join("")}
    </div>
    <div class="av-ms-scale-ends"><span>1 · ${esc(low || "")}</span><span>${esc(high || "")} · 10</span></div>
  </fieldset>`;
}

function resultHTML(sel, res, rows) {
  const T = tr(DICT);
  const { ind } = sel;
  const m = res.m;
  const l = LETTER[m.state] || "N";
  const next = rows.find((r) => r.due && r.ind.code !== ind.code);
  return `
  <div class="av-ms-done av-ms-done-${l}" id="av-ms-result" tabindex="-1">
    <div class="av-ms-done-head"><span class="av-ms-check" aria-hidden="true">✓</span> ${esc(T.saved)}</div>
    <div class="av-ms-done-val"><span class="${isAlarm(l) ? `av-val-${l}` : ""}">${esc(valueText(ind, m.value, m.secondary_value))}</span> <small>${esc(unitText(ind))}</small></div>
    <div class="av-ms-done-state">${badge(l)} <strong>${esc(T.pv[m.state] || "")}</strong></div>
    <p>${esc(T.msg[m.state] || "")}</p>
    <div class="av-ms-done-actions">
      ${next ? `<button type="button" class="av-btn av-btn-primary" data-pick="${esc(next.ind.code)}" data-from-result>${esc(fmt(T.next, { name: nameOf(next.ind) }))}</button>` : `<button type="button" class="av-btn av-btn-primary" data-act="close">${esc(T.finish)}</button>`}
      ${isAlarm(l) ? `<button type="button" class="av-btn" data-nav="alerts-center">${esc(T.toAlerts)}</button>` : ""}
      <button type="button" class="av-btn" data-act="again">${esc(T.again)}</button>
    </div>
  </div>`;
}

/* ───────────────────────── eventos ───────────────────────── */

function bind(root, container, appState, helpers, sel, rows) {
  const T = tr(DICT);
  const repaint = () => {
    if (root.isConnected) paint(container, appState, helpers);
  };
  const announce = (msg) => {
    const live = root.ownerDocument.getElementById("av-measure-live");
    setTimeout(() => { if (live && live.isConnected) live.textContent = msg; }, 80);
  };

  root.addEventListener("click", (ev) => {
    const nav = ev.target.closest("[data-nav]");
    if (nav) { helpers.navigateToSection?.(nav.getAttribute("data-nav")); return; }

    const p = ev.target.closest("[data-pick]");
    if (p) {
      const code = p.getAttribute("data-pick");
      if (code !== ui.code) ui.result = null;
      ui.code = code;
      ui.focus = p.hasAttribute("data-from-result") ? "#av-ms-value, .av-ms-scale input" : "#av-ms-entry-title";
      repaint();
      if (window.matchMedia("(max-width: 820px)").matches) window.scrollTo({ top: 0 });
      return;
    }

    const st = ev.target.closest("[data-step]");
    if (st && sel) {
      const input = root.querySelector(`#${st.getAttribute("data-for")}`);
      const step = Number(sel.ind.step) || 1;
      const isSec = input.id === "av-ms-secondary";
      const fallback = isSec ? sel.m?.secondary_value ?? 80 : sel.m?.value ?? (sel.ind.normal_min + sel.ind.normal_max) / 2;
      const cur = parseNum(input.value) ?? fallback;
      const nextV = Math.max(0, cur + step * Number(st.getAttribute("data-step")));
      input.value = String(Number(nextV.toFixed(decimals(step))));
      updatePreview(root, sel.ind);
      return;
    }

    const add = ev.target.closest("[data-add]");
    if (add && sel) {
      const input = root.querySelector("#av-ms-value");
      const base = parseNum(input.value) ?? todayValue(sel);
      input.value = String(base + Number(add.getAttribute("data-add")));
      updatePreview(root, sel.ind);
      return;
    }

    const a = ev.target.closest("[data-act]");
    if (!a) return;
    const act = a.getAttribute("data-act");
    if (act === "close") {
      const code = ui.code;
      ui.code = null;
      ui.result = null;
      ui.focus = code ? `[data-pick="${code}"]` : null;
      repaint();
    } else if (act === "again") {
      ui.result = null;
      ui.focus = "#av-ms-value, .av-ms-scale input";
      repaint();
    } else if (act === "skip" && sel) {
      const code = sel.ind.code;
      if (ui.skipped.has(code)) {
        ui.skipped.delete(code);
        ui.focus = '[data-act="skip"]';
      } else {
        ui.skipped.add(code);
        helpers.showToast?.(fmt(T.skipToast, { name: nameOf(sel.ind) }));
        const next = buildRows().find((r) => r.due);
        ui.code = next ? next.ind.code : null;
        ui.result = null;
        ui.focus = next ? "#av-ms-entry-title" : null;
      }
      repaint();
    } else if (act === "reset") {
      resetDemoData();
      ui.code = null;
      ui.result = null;
      ui.skipped = new Set();
      helpers.showToast?.(T.resetDone);
      renderMeasureView(container, appState, helpers);
    }
  });

  const form = root.querySelector("[data-measure-form]");
  if (!form || !sel) return;
  form.addEventListener("input", () => updatePreview(root, sel.ind));
  form.addEventListener("change", () => updatePreview(root, sel.ind));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (ui.busy) return;
    const fd = new FormData(form);
    const value = parseNum(fd.get("value"));
    const secondary = parseNum(fd.get("secondary"));
    const notes = String(fd.get("notes") || "").trim() || null;
    const pv = root.querySelector("#av-ms-preview");
    const fail = (msg, sel2) => {
      pv.textContent = msg;
      pv.className = "av-ms-preview is-error";
      const f = root.querySelector(sel2);
      if (f) { f.setAttribute("aria-invalid", "true"); f.focus(); }
    };
    if (value === null) return fail(T.errEmpty, "#av-ms-value, .av-ms-scale input");
    const err = validate(sel.ind, value, secondary);
    if (err) return fail(errorText(err, sel.ind), err === "range" ? "#av-ms-value" : "#av-ms-secondary, .av-ms-scale input[name=secondary]");

    const btn = form.querySelector("[data-measure-submit]");
    ui.busy = true;
    btn.disabled = true;
    btn.textContent = T.saving;
    try {
      const m = await saveMeasurement(sel.ind, { value, secondary_value: secondary, notes }, appState);
      ui.data.latest.set(sel.ind.code, m);
      ui.skipped.delete(sel.ind.code);
      ui.result = { code: sel.ind.code, m };
      ui.focus = "#av-ms-result";
      const state = tr(DICT).pv[m.state] || m.state;
      helpers.showToast?.(fmt(T.savedToast, { name: nameOf(sel.ind), state }));
      announce(`${T.saved}. ${nameOf(sel.ind)}: ${state}.`);
    } catch (e) {
      helpers.showToast?.(fmt(T.saveFail, { msg: e.code ? errorText(e.code, sel.ind) : e.message }));
    }
    ui.busy = false;
    repaint();
  });
}

/* Hidratación: lo ya registrado hoy, para que +250/+500 sumen al total del día */
function todayValue(sel) {
  const m = sel.m;
  if (!m || !m.measured_at) return 0;
  return new Date(m.measured_at).toDateString() === new Date().toDateString() ? Number(m.value) || 0 : 0;
}

/* Vista previa en vivo: rango normal → estado que tendría el valor escrito */
function updatePreview(root, ind) {
  const T = tr(DICT);
  const pv = root.querySelector("#av-ms-preview");
  if (!pv) return;
  root.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
  const form = root.querySelector("[data-measure-form]");
  const fd = new FormData(form);
  const v = parseNum(fd.get("value"));
  const unit = unitText(ind);
  if (v === null) {
    pv.textContent = fmt(T.normal, { r: `${rangeText(ind.normal_min, ind.normal_max, ind)} ${unit}` });
    pv.className = "av-ms-preview";
    return;
  }
  if (validate(ind, v, null) === "range") {
    pv.textContent = errorText("range", ind);
    pv.className = "av-ms-preview is-error";
    return;
  }
  const state = evaluate(ind, v);
  const l = LETTER[state];
  pv.innerHTML = `${badge(l)} <span>${esc(T.pv[state])} · ${esc(fmt(T.normal, { r: `${rangeText(ind.normal_min, ind.normal_max, ind)} ${unit}` }))}</span>`;
  pv.className = `av-ms-preview is-${l}`;
}
