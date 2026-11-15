/*
 * SEMSA · Bitácora · Tendencias por indicador (antes: columna "Tendencia" del Resumen)
 *
 * - Lista de indicadores (botones con aria-pressed) con su valor actual, estado y una
 *   mini-tendencia: sale de indicator_cards[].history_points del resumen
 *   (GET /health/summary), el mismo dato que usaba la tabla del Resumen.
 * - Al elegir uno se pide la serie completa de la misión con
 *   GET /analytics/timeseries (apiService.getAnalyticsTimeseries), que además trae la
 *   línea base del tripulante (baseline_value) y marcadores de hueco (is_gap_marker).
 *   Si la petición falla se dibujan los history_points del resumen.
 * - Gráfica grande en SVG propio (sin librerías): bandas amarilla/roja con los límites de
 *   la regla activa (catálogo de indicadores, ruleOf de console.js), línea base, tooltip al
 *   pasar el ratón o tocar, y recorrido con teclado (← → Inicio Fin) anunciado en una
 *   región aria-live.
 *
 * Los textos llegan en opts.texts() (DICT.*.trends de logbook.js, resuelto con tr(DICT)).
 * No usa data-act / data-nav (el contenedor tiene un listener delegado de console.js).
 */
import { escapeHtml, num, gmt, badge, cardValue, sparkPoints, ruleOf } from "../console.js";
import { LETTER, STATE_WORD, isAlarm } from "../alert-classes.js";
import { apiService } from "../../services/api.js";
import { bt } from "/src/i18n/backend.js";

const esc = escapeHtml;

/* Estado del módulo: indicador elegido y caché de series por tripulante/misión/indicador */
const st = { key: null, code: null, cache: new Map(), seq: 0 };

function ensureCss() {
  if (document.getElementById("av-lt-css")) return;
  const link = document.createElement("link");
  link.id = "av-lt-css";
  link.rel = "stylesheet";
  link.href = new URL("./logbook-trends.css", import.meta.url).href;
  document.head.appendChild(link);
}

const isNum = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const decimalsFor = (v) => (Number.isInteger(Number(v)) ? 0 : Math.abs(Number(v)) < 1 ? 2 : 1);
const fmtV = (v) => (isNum(v) ? num(Number(v), decimalsFor(v)) : "—");
const letterOf = (state) => (state && LETTER[state]) || null;

/* Fecha corta para el eje X y el tooltip: día del año/hh:mm GMT (formato de la consola) */
const when = (t) => gmt(new Date(t), false);

/* ───────────────────────── datos ───────────────────────── */

/* Puntos normalizados [{t, v, v2, l}] con null como separador de segmento (hueco) */
function normalize(points) {
  const out = [];
  for (const p of points || []) {
    if (p.is_gap_marker || !isNum(p.value)) {
      if (out.length && out[out.length - 1] !== null) out.push(null);
      continue;
    }
    const t = Date.parse(p.measured_at);
    if (!Number.isFinite(t)) continue;
    out.push({ t, v: Number(p.value), v2: isNum(p.secondary_value) ? Number(p.secondary_value) : null, l: letterOf(p.state) });
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/* Límites amarillo (monitor_*) y rojo (warning_*) de la regla activa, solo los que tienen sentido */
function limitsOf(appState, code) {
  const item = ruleOf(appState, code);
  const r = item && item.rule;
  if (!r) return { yLo: null, yHi: null, rLo: null, rHi: null, demo: false };
  const minV = isNum(item.min_valid_value) ? Number(item.min_valid_value) : -Infinity;
  const maxV = isNum(item.max_valid_value) ? Number(item.max_valid_value) : Infinity;
  const nLo = isNum(r.normal_min) ? Number(r.normal_min) : Infinity;
  const nHi = isNum(r.normal_max) ? Number(r.normal_max) : -Infinity;
  const lo = (v) => (isNum(v) && Number(v) > minV && Number(v) < nLo ? Number(v) : null);
  const hi = (v) => (isNum(v) && Number(v) < maxV && Number(v) > nHi ? Number(v) : null);
  return { yLo: lo(r.monitor_min), yHi: hi(r.monitor_max), rLo: lo(r.warning_min), rHi: hi(r.warning_max), demo: r.is_demo_rule !== false };
}

async function loadSeries(ctx, code) {
  const key = `${ctx.aid}:${ctx.mid ?? ""}:${code}`;
  if (st.cache.has(key)) return st.cache.get(key);
  const res = await apiService.getAnalyticsTimeseries({ astronaut_id: ctx.aid, mission_id: ctx.mid, indicator_code: code });
  const series = {
    points: normalize(res && res.points),
    baseline: res && isNum(res.baseline_value) ? Number(res.baseline_value) : null,
    unit: res && res.unit,
    full: true,
  };
  st.cache.set(key, series);
  return series;
}

/* ───────────────────────── lista de indicadores ───────────────────────── */

function itemHTML(ctx, c, selected) {
  const T = ctx.texts();
  const l = letterOf(c.state) || "M";
  const alarm = isAlarm(l);
  const pts = sparkPoints((c.history_points || []).map((p) => p.value), 120, 30);
  const name = bt(c.name) || c.indicator_code;
  const unit = bt(c.unit || "");
  const word = STATE_WORD[l] || "";
  const aria = `${name}: ${cardValue(c)} ${unit}, ${word}. ${pts ? T.itemAria : T.noTrend}`;
  return `<li><button type="button" class="av-lt-item${alarm ? ` av-lt-item-${l}` : ""}" data-lt-code="${esc(c.indicator_code)}" aria-pressed="${selected}" aria-controls="av-lt-detail" aria-label="${esc(aria)}">
    <span class="av-lt-item-top"><span class="av-lt-item-name">${esc(name)}</span>${badge(l, word)}</span>
    <span class="av-lt-item-val av-mono"><span class="${alarm ? `av-val-${l}` : ""}">${esc(cardValue(c))}</span> <span class="av-sub">${esc(unit)}</span></span>
    ${pts
      ? `<svg class="av-lt-spark" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="${pts}" fill="none" stroke="${alarm ? "var(--av-y)" : "var(--av-text2)"}" stroke-width="2" vector-effect="non-scaling-stroke"></polyline></svg>`
      : `<span class="av-sub av-lt-spark-empty">${esc(T.noTrend)}</span>`}
  </button></li>`;
}

/* ───────────────────────── gráfica grande ───────────────────────── */

function chartGeometry(width, pts, lim, baseline) {
  const W = Math.max(280, Math.round(width));
  const H = W < 520 ? 220 : 280;
  const pad = { l: W < 520 ? 44 : 56, r: W < 520 ? 34 : 48, t: 14, b: 28 };
  const real = pts.filter(Boolean);
  const vals = real.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // la línea base y los límites amarillos entran siempre en la escala; los rojos solo si están cerca
  for (const v of [baseline, lim.yLo, lim.yHi]) if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span0 = hi - lo || Math.abs(hi) || 1;
  for (const v of [lim.rLo, lim.rHi]) if (isNum(v) && v >= lo - span0 * 0.6 && v <= hi + span0 * 0.6) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = hi - lo || Math.abs(hi) || 1;
  lo -= span * 0.08;
  hi += span * 0.08;
  const t0 = real[0].t;
  const t1 = real[real.length - 1].t;
  const x = (t) => pad.l + (t1 === t0 ? (W - pad.l - pad.r) / 2 : ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r));
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  return { W, H, pad, lo, hi, x, y, t0, t1 };
}

function chartSVG(ctx, g, pts, lim, baseline, unit, name) {
  const T = ctx.texts();
  const { W, H, pad, lo, hi, x, y } = g;
  const xl = pad.l;
  const xr = W - pad.r;
  const clamp = (v) => Math.min(hi, Math.max(lo, v));
  const band = (a, b, cls) => {
    const ya = y(clamp(a));
    const yb = y(clamp(b));
    const top = Math.min(ya, yb);
    const h = Math.abs(yb - ya);
    return h > 0.5 ? `<rect class="${cls}" x="${xl}" y="${top.toFixed(1)}" width="${xr - xl}" height="${h.toFixed(1)}"></rect>` : "";
  };
  let bands = "";
  if (isNum(lim.yLo)) bands += band(isNum(lim.rLo) ? lim.rLo : lo, lim.yLo, "av-lt-band-y");
  if (isNum(lim.yHi)) bands += band(lim.yHi, isNum(lim.rHi) ? lim.rHi : hi, "av-lt-band-y");
  if (isNum(lim.rLo)) bands += band(lo, lim.rLo, "av-lt-band-r");
  if (isNum(lim.rHi)) bands += band(lim.rHi, hi, "av-lt-band-r");

  const hline = (v, cls, label) => {
    if (!isNum(v) || v < lo || v > hi) return "";
    const yy = y(v).toFixed(1);
    return `<line class="${cls}" x1="${xl}" x2="${xr}" y1="${yy}" y2="${yy}"></line>
      <text class="av-lt-lim-txt ${cls}-txt" x="${xr + 4}" y="${(Number(yy) + 4).toFixed(1)}">${esc(label)}</text>`;
  };
  const lines =
    hline(lim.yLo, "av-lt-lim-y", "Y") + hline(lim.yHi, "av-lt-lim-y", "Y") +
    hline(lim.rLo, "av-lt-lim-r", "R") + hline(lim.rHi, "av-lt-lim-r", "R") +
    hline(baseline, "av-lt-base", T.baseShort);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = lo + f * (hi - lo);
    const yy = y(v).toFixed(1);
    const dec = hi - lo < 5 ? 1 : 0;
    return `<line class="av-lt-grid" x1="${xl}" x2="${xr}" y1="${yy}" y2="${yy}"></line>
      <text class="av-lt-axis" x="${xl - 6}" y="${(Number(yy) + 4).toFixed(1)}" text-anchor="end">${esc(num(v, dec))}</text>`;
  }).join("");

  const real = pts.filter(Boolean);
  const xTicks = (real.length > 2 && W >= 420 ? [real[0], real[Math.floor((real.length - 1) / 2)], real[real.length - 1]] : [real[0], real[real.length - 1]])
    .map((p, i, arr) => `<text class="av-lt-axis" x="${x(p.t).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle"}">${esc(when(p.t))}</text>`)
    .join("");

  // segmentos separados por huecos (null)
  const segs = [];
  let cur = [];
  for (const p of pts) {
    if (p === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length) segs.push(cur);
  const path = segs.map((s) => s.length === 1
    ? `<circle class="av-lt-dot" cx="${x(s[0].t).toFixed(1)}" cy="${y(s[0].v).toFixed(1)}" r="3"></circle>`
    : `<polyline class="av-lt-line" points="${s.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")}"></polyline>`).join("");
  const showDots = real.length <= 80;
  const dots = real.map((p) => {
    const alarm = isAlarm(p.l);
    if (!showDots && !alarm) return "";
    return `<circle class="av-lt-dot${alarm ? ` av-lt-dot-${p.l}` : ""}" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${alarm ? 4 : 2.5}"></circle>`;
  }).join("");

  const first = real[0];
  const last = real[real.length - 1];
  const vals = real.map((p) => p.v);
  const summary = `${name}: ${real.length} ${T.points}, ${T.min} ${fmtV(Math.min(...vals))}, ${T.max} ${fmtV(Math.max(...vals))}, ${T.last} ${fmtV(last.v)} ${unit} (${when(last.t)} GMT). ${when(first.t)} – ${when(last.t)} GMT.`;

  return `<svg class="av-lt-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}" focusable="false">
    ${bands}${grid}${lines}${path}${dots}${xTicks}
    <g class="av-lt-cursor" style="display:none">
      <line class="av-lt-cursor-line" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}"></line>
      <circle class="av-lt-cursor-dot" cx="0" cy="0" r="5"></circle>
    </g>
  </svg>`;
}

function legendHTML(ctx, lim, baseline) {
  const T = ctx.texts();
  const items = [`<li><span class="av-lt-key av-lt-key-line" aria-hidden="true"></span>${esc(T.legendSeries)}</li>`];
  if (isNum(baseline)) items.push(`<li><span class="av-lt-key av-lt-key-base" aria-hidden="true"></span>${esc(T.legendBase)} <span class="av-mono">${esc(fmtV(baseline))}</span></li>`);
  const pair = (a, b) => [isNum(a) ? `<${fmtV(a)}` : "", isNum(b) ? `>${fmtV(b)}` : ""].filter(Boolean).join(" ");
  if (isNum(lim.yLo) || isNum(lim.yHi)) items.push(`<li><span class="av-lt-key av-lt-key-y" aria-hidden="true"></span>${esc(T.legendY)} <span class="av-mono">${esc(pair(lim.yLo, lim.yHi))}</span></li>`);
  if (isNum(lim.rLo) || isNum(lim.rHi)) items.push(`<li><span class="av-lt-key av-lt-key-r" aria-hidden="true"></span>${esc(T.legendR)} <span class="av-mono">${esc(pair(lim.rLo, lim.rHi))}</span></li>`);
  return `<ul class="av-lt-legend">${items.join("")}</ul>`;
}

/* ───────────────────────── interacción ───────────────────────── */

function tooltipText(ctx, p, unit) {
  const T = ctx.texts();
  const val = p.v2 !== null ? `${fmtV(p.v)}/${fmtV(p.v2)}` : fmtV(p.v);
  const word = p.l ? STATE_WORD[p.l] || "" : "";
  return { val: `${val} ${unit}`.trim(), time: `${when(p.t)} GMT`, word, sr: `${T.value} ${val} ${unit}, ${when(p.t)} GMT${word ? `, ${word}` : ""}` };
}

/* view = { g, svg } se actualiza al redibujar: los listeners se enlazan una sola vez */
function bindChart(ctx, wrap, view, pts, unit) {
  const real = pts.filter(Boolean);
  const tip = wrap.querySelector(".av-lt-tip");
  const live = wrap.parentElement.querySelector(".av-lt-live");
  let active = -1;
  let xs = [];
  let svg, cursor, cLine, cDot, g;
  const sync = () => {
    if (svg === view.svg) return;
    ({ svg, g } = view);
    cursor = svg.querySelector(".av-lt-cursor");
    cLine = svg.querySelector(".av-lt-cursor-line");
    cDot = svg.querySelector(".av-lt-cursor-dot");
    xs = real.map((p) => g.x(p.t));
  };

  const show = (i, announce) => {
    sync();
    if (i < 0 || i >= real.length) return;
    active = i;
    const p = real[i];
    const px = xs[i];
    const py = g.y(p.v);
    cursor.style.display = "";
    cLine.setAttribute("x1", px); cLine.setAttribute("x2", px);
    cDot.setAttribute("cx", px); cDot.setAttribute("cy", py);
    cDot.setAttribute("class", `av-lt-cursor-dot${isAlarm(p.l) ? ` av-lt-dot-${p.l}` : ""}`);
    const tt = tooltipText(ctx, p, unit);
    tip.innerHTML = `<strong class="av-mono">${esc(tt.val)}</strong><span class="av-mono">${esc(tt.time)}</span>${tt.word ? `<span>${p.l ? badge(p.l, tt.word) : ""} ${esc(tt.word)}</span>` : ""}`;
    tip.hidden = false;
    // posición en píxeles del contenedor (el SVG se dibuja a su ancho real, escala 1)
    const scale = svg.getBoundingClientRect().width / g.W || 1;
    const tw = tip.offsetWidth;
    const ww = wrap.clientWidth;
    let left = px * scale + 12;
    if (left + tw > ww - 4) left = px * scale - tw - 12;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, py * scale - tip.offsetHeight - 10)}px`;
    if (announce && live) live.textContent = `${tt.sr}. ${i + 1}/${real.length}`;
  };
  const hide = () => {
    sync();
    active = -1;
    cursor.style.display = "none";
    tip.hidden = true;
  };
  const nearest = (clientX) => {
    sync();
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * g.W;
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < sx) lo = mid; else hi = mid;
    }
    return Math.abs(xs[lo] - sx) <= Math.abs(xs[hi] - sx) ? lo : hi;
  };

  // los eventos de puntero se escuchan en la caja del SVG (el SVG se sustituye al redimensionar)
  const box = wrap.querySelector(".av-lt-svgbox");
  box.addEventListener("pointermove", (ev) => show(nearest(ev.clientX), false));
  box.addEventListener("pointerdown", (ev) => show(nearest(ev.clientX), ev.pointerType !== "mouse"));
  box.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse" && document.activeElement !== wrap) hide(); });
  wrap.addEventListener("focus", () => show(active >= 0 ? active : real.length - 1, true));
  wrap.addEventListener("blur", hide);
  wrap.addEventListener("keydown", (ev) => {
    const step = ev.shiftKey ? 10 : 1;
    let i = active >= 0 ? active : real.length - 1;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") i = Math.max(0, i - step);
    else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") i = Math.min(real.length - 1, i + step);
    else if (ev.key === "Home") i = 0;
    else if (ev.key === "End") i = real.length - 1;
    else if (ev.key === "Escape") { hide(); return; }
    else return;
    ev.preventDefault();
    show(i, true);
  });
  return {
    // tras redibujar, vuelve a colocar el cursor/tooltip en el punto activo
    refresh() { if (active >= 0) show(active, false); },
  };
}

/* ───────────────────────── detalle ───────────────────────── */

function detailHTML(ctx, card, series, state) {
  const T = ctx.texts();
  const name = bt(card.name) || card.indicator_code;
  const unit = bt((series && series.unit) || card.unit || "");
  const lim = limitsOf(ctx.appState, card.indicator_code);
  const pts = series ? series.points : [];
  const real = pts.filter(Boolean);
  const head = `<div class="av-lt-dhead">
      <h3 class="av-h3" id="av-lt-dtitle">${esc(name)} <span class="av-sub">${esc(unit)}</span></h3>
      <span class="av-sub">${real.length ? `${real.length} ${esc(T.points)} · ${esc(when(real[0].t))} – ${esc(when(real[real.length - 1].t))} GMT` : ""}</span>
    </div>`;
  if (real.length < 2) {
    const msg = state === "loading" ? T.loading : T.notEnough;
    return `${head}<p class="av-lt-empty" role="status">${esc(msg)}</p>`;
  }
  const notes = [];
  if (state === "loading") notes.push(T.loadingFull);
  if (state === "fallback") notes.push(T.fallback);
  if (card.indicator_code === "BLOOD_PRESSURE") notes.push(T.bpNote);
  if (lim.demo && (isNum(lim.yLo) || isNum(lim.yHi) || isNum(lim.rLo) || isNum(lim.rHi))) notes.push(T.demoRule);
  return `${head}
    ${legendHTML(ctx, lim, series.baseline)}
    <div class="av-lt-chart" tabindex="0" role="group" aria-roledescription="${esc(T.chartRole)}" aria-labelledby="av-lt-dtitle" aria-describedby="av-lt-help">
      <div class="av-lt-svgbox"></div>
      <div class="av-lt-tip" hidden></div>
    </div>
    <p class="av-sub av-lt-help" id="av-lt-help">${esc(T.help)}</p>
    <p class="av-lt-sr av-lt-live" role="status" aria-live="polite"></p>
    ${notes.length ? `<p class="av-sub av-lt-note">${notes.map(esc).join(" ")}</p>` : ""}`;
}

/* Dibuja la gráfica al ancho real del contenedor (y la vuelve a dibujar si cambia) */
function drawChart(ctx, box, card, series) {
  const wrap = box.querySelector(".av-lt-chart");
  if (!wrap) return;
  const svgBox = wrap.querySelector(".av-lt-svgbox");
  const name = bt(card.name) || card.indicator_code;
  const unit = bt(series.unit || card.unit || "");
  const lim = limitsOf(ctx.appState, card.indicator_code);
  const view = { g: null, svg: null };
  let lastW = 0;
  let handle = null;
  const paintSvg = () => {
    const w = Math.floor(wrap.clientWidth);
    if (!w || w === lastW) return;
    lastW = w;
    view.g = chartGeometry(w, series.points, lim, series.baseline);
    svgBox.innerHTML = chartSVG(ctx, view.g, series.points, lim, series.baseline, unit, name);
    view.svg = svgBox.querySelector(".av-lt-svg");
    if (!handle) handle = bindChart(ctx, wrap, view, series.points, unit);
    else handle.refresh();
  };
  paintSvg();
  if (typeof ResizeObserver !== "function") return;
  let timer = 0;
  const observer = new ResizeObserver(() => {
    if (!wrap.isConnected) { observer.disconnect(); return; }
    // fuera del callback (evita el aviso "ResizeObserver loop"); setTimeout también corre en segundo plano
    clearTimeout(timer);
    timer = setTimeout(paintSvg, 60);
  });
  observer.observe(wrap);
}

/* ───────────────────────── punto de entrada ───────────────────────── */

/*
 * el: contenedor donde pintar. opts: { appState, summary, aid, mid, texts }
 * texts(): objeto de textos en el idioma actual (DICT.*.trends de logbook.js).
 */
export function renderLogbookTrends(el, opts) {
  if (!el) return;
  ensureCss();
  const ctx = { ...opts };
  const T = ctx.texts();
  const cards = ((ctx.summary && ctx.summary.indicator_cards) || []).filter((c) => c && c.indicator_code);
  const key = `${ctx.aid}:${ctx.mid ?? ""}`;
  if (st.key !== key) {
    st.key = key;
    st.code = null;
    st.cache.clear();
  }
  if (!cards.length) {
    el.innerHTML = `<section class="av-panel av-lt" aria-labelledby="av-lt-h">
      <div class="av-panel-head"><h2 class="av-h2" id="av-lt-h">${esc(T.title)}</h2></div>
      <p class="av-lt-empty">${esc(T.noData)}</p></section>`;
    return;
  }
  if (!st.code || !cards.some((c) => c.indicator_code === st.code)) {
    const alarm = cards.find((c) => isAlarm(letterOf(c.state)) && (c.history_points || []).length >= 2);
    const withHist = cards.find((c) => (c.history_points || []).length >= 2);
    st.code = (alarm || withHist || cards[0]).indicator_code;
  }

  el.innerHTML = `<section class="av-panel av-lt" aria-labelledby="av-lt-h">
    <div class="av-panel-head">
      <div><h2 class="av-h2" id="av-lt-h">${esc(T.title)}</h2> <span class="av-sub">${esc(T.sub)}</span></div>
    </div>
    <div class="av-lt-body">
      <ul class="av-lt-list" aria-label="${esc(T.listAria)}">${cards.map((c) => itemHTML(ctx, c, c.indicator_code === st.code)).join("")}</ul>
      <div class="av-lt-detail" id="av-lt-detail" aria-live="off"></div>
    </div>
  </section>`;

  const detail = el.querySelector("#av-lt-detail");

  const select = async (code) => {
    st.code = code;
    el.querySelectorAll("[data-lt-code]").forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("data-lt-code") === code)));
    const card = cards.find((c) => c.indicator_code === code);
    const cacheKey = `${ctx.aid}:${ctx.mid ?? ""}:${code}`;
    const seq = ++st.seq;
    const quick = { points: normalize(card.history_points), baseline: null, unit: card.unit, full: false };
    const cached = st.cache.get(cacheKey);
    const show = (series, state) => {
      detail.innerHTML = detailHTML(ctx, card, series, state);
      if (series.points.filter(Boolean).length >= 2) drawChart(ctx, detail, card, series);
    };
    if (cached) { show(cached, "full"); return; }
    show(quick, "loading");
    try {
      const series = await loadSeries(ctx, code);
      if (seq !== st.seq || !detail.isConnected) return;
      // si la serie completa no tiene puntos, se conserva la del resumen
      if (series.points.filter(Boolean).length >= 2) show(series, "full");
      else show({ ...quick, baseline: series.baseline }, quick.points.filter(Boolean).length >= 2 ? "fallback" : "full");
    } catch {
      if (seq !== st.seq || !detail.isConnected) return;
      show(quick, "fallback");
    }
  };

  el.querySelector(".av-lt-list").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-lt-code]");
    if (!btn || !el.contains(btn)) return;
    const code = btn.getAttribute("data-lt-code");
    if (code === st.code && detail.firstChild) return;
    select(code);
  });

  select(st.code);
}
