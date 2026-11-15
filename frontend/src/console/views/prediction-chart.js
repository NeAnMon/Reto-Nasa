/*
 * SEMSA · Predicciones · Gráfica histórico + pronóstico (issue #28)
 *
 * Gráfica en SVG propio (sin librerías), mismo patrón que logbook-trends.js:
 * - Histórico: línea continua con puntos pequeños, cortada en los huecos (value null).
 * - Pronóstico: línea discontinua de otro color que arranca en el último punto del
 *   histórico; los puntos con out_of_valid_range se marcan en rojo (aviso).
 * - Bandas de predicción al 80 % y 95 % (lower_80/upper_80/lower_95/upper_95 de cada punto del
 *   pronóstico, opcionales): áreas translúcidas del color del pronóstico, la del 80 % más marcada.
 *   El eje Y las incluye; aparecen en la leyenda, el tooltip, el anuncio de teclado y el resumen.
 *   Sin bandas (servidor anterior) la gráfica se dibuja igual que antes.
 * - Línea base: horizontal discontinua con etiqueta.
 * - Umbrales del motor de alertas (ranges, opcional): rango normal de la regla (línea continua) y
 *   banda personal (raya-punto), con sus valores en la leyenda y en el resumen. Solo se dibujan los
 *   bordes cercanos a los datos; uno lejano no se añade al eje Y para no aplastar la serie.
 * - En pantallas estrechas (< 520 px) el eje X muestra el histórico reciente (14 días o el triple
 *   del horizonte) para que el pronóstico y sus bandas no queden comprimidos en el borde.
 * - Frontera "hoy": línea vertical fina entre el histórico y el pronóstico, con la zona
 *   del pronóstico ligeramente sombreada.
 * - Eje X temporal (por fecha, no por índice) y eje Y con marcas "redondas" y unidad.
 * - Tooltip al pasar el ratón o tocar, y recorrido con teclado (← → Inicio Fin, Mayús = 10)
 *   anunciado en una región aria-live; resumen accesible oculto visualmente.
 * - Se redibuja al ancho real del contenedor con ResizeObserver.
 *
 * Interfaz pública:
 *   renderPredictionChart(container, { history, forecast, baseline, ranges, unit, labels, locale, formatValue })
 *   → { destroy() }. Llamarla otra vez sobre el mismo contenedor sustituye la gráfica anterior.
 *
 * Solo clases con prefijo av-pc- (prediction-chart.css, se carga sola una vez).
 */

const DAY = 864e5;
let seq = 0;
const instances = new WeakMap();

function ensureCss() {
  if (document.getElementById("av-pc-css")) return;
  const link = document.createElement("link");
  link.id = "av-pc-css";
  link.rel = "stylesheet";
  link.href = new URL("./prediction-chart.css", import.meta.url).href;
  document.head.appendChild(link);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const isNum = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

/* Fecha "2026-11-01" → medianoche UTC; ISO con hora → instante. ht = trae hora significativa */
function parseDate(s) {
  if (s instanceof Date) return { t: s.getTime(), ht: true };
  const str = String(s ?? "");
  const t = Date.parse(str);
  if (!Number.isFinite(t)) return null;
  const ht = /T\d{2}:\d{2}/.test(str) && !/T00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(str);
  return { t, ht };
}

/* ───────────────────────── formato ───────────────────────── */

function makeFormatters(locale, formatValue) {
  const loc = locale === "en" ? "en" : "es";
  const safe = (opts) => {
    try { return new Intl.DateTimeFormat(loc, { timeZone: "UTC", ...opts }); }
    catch { return new Intl.DateTimeFormat(undefined, opts); }
  };
  const fTick = safe({ day: "numeric", month: "short" });
  const fTickTime = safe({ hour: "2-digit", minute: "2-digit" });
  const fDate = safe({ day: "numeric", month: "short", year: "numeric" });
  const fDateTime = safe({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const nf = new Map();
  const numFmt = (n, dec) => {
    if (!nf.has(dec)) nf.set(dec, new Intl.NumberFormat(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec }));
    return nf.get(dec).format(n);
  };
  const autoDec = (n) => (Number.isInteger(n) ? 0 : Math.abs(n) < 1 ? 2 : 1);
  const value = (n) => {
    if (!isNum(n)) return "—";
    if (typeof formatValue === "function") {
      try { return String(formatValue(Number(n))); } catch { /* cae al formato por defecto */ }
    }
    return numFmt(Number(n), autoDec(Number(n)));
  };
  return {
    tick: (t) => fTick.format(t),
    tickTime: (t) => fTickTime.format(t),
    date: (p) => (p.ht ? fDateTime : fDate).format(p.t),
    num: numFmt,
    value,
  };
}

/* ───────────────────────── datos ───────────────────────── */

/* Histórico normalizado [{t, v, ht, kind:"h"}] con null como separador de hueco */
function normalizeHistory(history) {
  const out = [];
  for (const p of history || []) {
    const d = p && parseDate(p.date);
    if (!d) continue;
    if (!isNum(p.value)) {
      if (out.length && out[out.length - 1] !== null) out.push(null);
      continue;
    }
    out.push({ t: d.t, ht: d.ht, v: Number(p.value), kind: "h", oor: false });
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/* Banda [inferior, superior] de un punto del pronóstico; null si falta o no contiene al valor */
function bandOf(lower, upper, v) {
  if (!isNum(lower) || !isNum(upper)) return null;
  const lo = Number(lower);
  const hi = Number(upper);
  return lo <= v && v <= hi ? [lo, hi] : null;
}

function normalizeForecast(forecast) {
  const out = [];
  for (const p of forecast || []) {
    const d = p && parseDate(p.date);
    if (!d) continue;
    if (!isNum(p.value)) {
      if (out.length && out[out.length - 1] !== null) out.push(null);
      continue;
    }
    const v = Number(p.value);
    out.push({
      t: d.t, ht: d.ht, v, kind: "f", oor: p.out_of_valid_range === true,
      b80: bandOf(p.lower_80, p.upper_80, v), b95: bandOf(p.lower_95, p.upper_95, v),
    });
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/* Umbrales del motor de alertas: { normal: [mín, máx], personal: [mín, máx] }; un extremo puede faltar
 * (null = ese lado no genera alerta). Devuelve solo los intervalos con algún extremo numérico. */
function normalizeRanges(ranges) {
  const out = {};
  for (const kind of ["normal", "personal"]) {
    const r = ranges && Array.isArray(ranges[kind]) ? ranges[kind] : null;
    if (r && (isNum(r[0]) || isNum(r[1]))) out[kind] = [isNum(r[0]) ? Number(r[0]) : null, isNum(r[1]) ? Number(r[1]) : null];
  }
  return out;
}

/* Bordes numéricos de los umbrales: [{ v, kind: "normal" | "personal" }] */
function thresholdEdges(ranges) {
  const out = [];
  for (const kind of ["normal", "personal"]) {
    for (const v of (ranges && ranges[kind]) || []) if (v !== null) out.push({ v, kind });
  }
  return out;
}

/* "51 – 99 lpm", "≥ 51 lpm" o "≤ 99 lpm" para un intervalo con un extremo opcional */
function rangeText(r, unit, fmt) {
  const txt = r[0] !== null && r[1] !== null ? `${fmt.value(r[0])} – ${fmt.value(r[1])}`
    : r[0] !== null ? `≥ ${fmt.value(r[0])}` : `≤ ${fmt.value(r[1])}`;
  return `${txt} ${unit}`.trim();
}

/* En pantallas estrechas el eje X arranca más tarde: con todo el histórico a la vista, el pronóstico
 * y sus bandas quedarían comprimidos en el borde derecho. Se muestran los últimos 14 días o el triple
 * del horizonte, lo que sea mayor. Devuelve el instante desde el que se dibuja (-Infinity = todo). */
function visibleStart(W, data) {
  const h = data.hist.filter(Boolean);
  const f = data.fc.filter(Boolean);
  if (W >= 520 || !h.length || !f.length) return -Infinity;
  const lastH = h[h.length - 1].t;
  const horizon = Math.max(DAY, f[f.length - 1].t - lastH);
  return lastH - Math.max(14 * DAY, 3 * horizon);
}

/* Paso "redondo" (1, 2, 2.5, 5 × 10^n) para unas count divisiones */
function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return s * mag;
}

function decimalsOf(step) {
  let d = 0;
  while (d < 4 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-6) d++;
  return d;
}

/* ───────────────────────── geometría ───────────────────────── */

function chartGeometry(width, allPoints, data, fmt) {
  const { baseline, ranges } = data;
  const W = Math.max(240, Math.round(width));
  const H = W < 520 ? 230 : 290;
  // puntos a la vista (allPoints va ordenado por fecha: los ocultos son los primeros)
  const tMin = visibleStart(W, data);
  const real = allPoints.filter((p) => p.t >= tMin);
  const first = allPoints.length - real.length;
  const vals = real.map((p) => p.v);
  // el dominio del eje Y incluye los extremos de las bandas de predicción
  for (const p of real) {
    if (p.b80) vals.push(p.b80[0], p.b80[1]);
    if (p.b95) vals.push(p.b95[0], p.b95[1]);
  }
  if (isNum(baseline)) vals.push(Number(baseline));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // umbrales cercanos a los datos (a menos de 0,6 veces su recorrido): uno lejano (p. ej. el
  // máximo de sueño) aplastaría la serie, así que no se dibuja y queda solo en la leyenda
  const reach = ((hi - lo) || Math.abs(hi) * 0.1 || 1) * 0.6;
  const near = thresholdEdges(ranges).map((e) => e.v).filter((v) => v >= lo - reach && v <= hi + reach);
  if (hi === lo) {
    const d = Math.abs(hi) * 0.1 || 1;
    lo -= d;
    hi += d;
  }
  const span = hi - lo;
  lo -= span * 0.08;
  hi += span * 0.08;
  // ...que amplían el eje sin margen extra: el margen es para que los datos no toquen el borde
  if (near.length) {
    lo = Math.min(lo, ...near);
    hi = Math.max(hi, ...near);
  }
  const step = niceStep(hi - lo, W < 520 ? 4 : 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const dec = decimalsOf(step);
  const yTicks = [];
  for (let i = 0; lo + i * step <= hi + step / 2; i++) yTicks.push(lo + i * step);
  // margen izquierdo según el texto más largo de las marcas del eje Y
  const longest = Math.max(...yTicks.map((v) => fmt.num(v, dec).length));
  const pad = { l: Math.max(32, Math.round(longest * 6.8 + 12)), r: W < 520 ? 12 : 18, t: 22, b: 28 };
  const t0 = Math.min(...real.map((p) => p.t));
  const t1 = Math.max(...real.map((p) => p.t));
  const plotW = W - pad.l - pad.r;
  // margen horizontal pequeño para que los puntos extremos no queden sobre el eje
  const inset = Math.min(10, plotW * 0.03);
  const x = (t) => pad.l + inset + (t1 === t0 ? (plotW - 2 * inset) / 2 : ((t - t0) / (t1 - t0)) * (plotW - 2 * inset));
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  return { W, H, pad, lo, hi, x, y, t0, t1, tMin, first, yTicks, dec, plotW };
}

function xTicksOf(g, fmt) {
  const { t0, t1, plotW } = g;
  const maxTicks = Math.max(2, Math.floor(plotW / 78));
  const span = t1 - t0;
  if (span === 0) return [{ t: t0, label: fmt.tick(t0) }];
  if (span >= 2 * DAY) {
    const days = span / DAY;
    const steps = [1, 2, 3, 5, 7, 14, 30, 60, 91, 182, 365];
    const stepD = steps.find((s) => days / s <= maxTicks - 1) || Math.ceil(days / (maxTicks - 1));
    const out = [];
    for (let t = Math.ceil(t0 / DAY) * DAY; t <= t1; t += stepD * DAY) out.push({ t, label: fmt.tick(t) });
    return out;
  }
  // menos de dos días: marcas repartidas con hora
  const n = Math.min(maxTicks, 3);
  return Array.from({ length: n }, (_, i) => {
    const t = t0 + (span * i) / (n - 1);
    return { t, label: fmt.tickTime(t) };
  });
}

/* ───────────────────────── SVG ───────────────────────── */

function polyline(cls, pts, g) {
  if (pts.length === 1) {
    return `<circle class="${cls}-solo" cx="${g.x(pts[0].t).toFixed(1)}" cy="${g.y(pts[0].v).toFixed(1)}" r="2.5"></circle>`;
  }
  return `<polyline class="${cls}" points="${pts.map((p) => `${g.x(p.t).toFixed(1)},${g.y(p.v).toFixed(1)}`).join(" ")}"></polyline>`;
}

function segments(list) {
  const segs = [];
  let cur = [];
  for (const p of list) {
    if (p === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/* Tramos consecutivos de puntos del pronóstico que traen la banda `key` ("b80" / "b95") */
function bandRuns(fc, key) {
  const runs = [];
  let cur = [];
  for (const p of fc) {
    if (p && p[key]) cur.push(p);
    else { if (cur.length) runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/* Área de una banda: por arriba de izquierda a derecha y de vuelta por abajo.
 * Con un solo día (horizonte 1) no hay anchura que rellenar: se dibuja una barra vertical. */
function bandArea(cls, run, key, g) {
  if (run.length === 1) {
    const p = run[0];
    const top = g.y(p[key][1]);
    const bottom = g.y(p[key][0]);
    return `<rect class="${cls}" x="${(g.x(p.t) - 5).toFixed(1)}" y="${top.toFixed(1)}" width="10" height="${Math.max(0, bottom - top).toFixed(1)}"></rect>`;
  }
  const upper = run.map((p) => `${g.x(p.t).toFixed(1)},${g.y(p[key][1]).toFixed(1)}`);
  const lower = run.map((p) => `${g.x(p.t).toFixed(1)},${g.y(p[key][0]).toFixed(1)}`).reverse();
  return `<polygon class="${cls}" points="${[...upper, ...lower].join(" ")}"></polygon>`;
}

function chartSVG(g, data, fmt) {
  const { W, H, pad, lo, hi, x, y } = g;
  const { fc, baseline, unit, labels } = data;
  // histórico a la vista (en pantallas estrechas el eje X no arranca en el primer día)
  const hist = data.hist.filter((p) => p === null || p.t >= g.tMin);
  const xl = pad.l;
  const xr = W - pad.r;
  const yt = pad.t;
  const yb = H - pad.b;

  const grid = g.yTicks.map((v) => {
    const yy = y(v).toFixed(1);
    return `<line class="av-pc-grid" x1="${xl}" x2="${xr}" y1="${yy}" y2="${yy}"></line>
      <text class="av-pc-axis" x="${xl - 6}" y="${(Number(yy) + 4).toFixed(1)}" text-anchor="end">${esc(fmt.num(v, g.dec))}</text>`;
  }).join("");
  const unitTxt = unit ? `<text class="av-pc-axis av-pc-unit" x="${xl - 6}" y="12" text-anchor="end">${esc(unit)}</text>` : "";

  const xTicks = xTicksOf(g, fmt).map((tk) => {
    const xx = x(tk.t);
    const w = tk.label.length * 6.6;
    const anchor = xx - w / 2 < 2 ? "start" : xx + w / 2 > W - 2 ? "end" : "middle";
    return `<line class="av-pc-tick" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${yb}" y2="${yb + 4}"></line>
      <text class="av-pc-axis" x="${xx.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${esc(tk.label)}</text>`;
  }).join("");
  const axisX = `<line class="av-pc-axisline" x1="${xl}" x2="${xr}" y1="${yb}" y2="${yb}"></line>`;

  const histReal = hist.filter(Boolean);
  const fcReal = fc.filter(Boolean);
  const lastH = histReal.length ? histReal[histReal.length - 1] : null;

  // frontera "hoy" y zona de pronóstico
  let zone = "";
  if (lastH && fcReal.length) {
    const xt = x(lastH.t);
    zone = `<rect class="av-pc-fczone" x="${xt.toFixed(1)}" y="${yt}" width="${Math.max(0, xr - xt).toFixed(1)}" height="${yb - yt}"></rect>
      <line class="av-pc-today" x1="${xt.toFixed(1)}" x2="${xt.toFixed(1)}" y1="${yt}" y2="${yb}"></line>`;
  }

  // línea base con etiqueta encima, a la izquierda del área de trazado
  let base = "";
  if (isNum(baseline) && baseline >= lo && baseline <= hi) {
    const yy = y(Number(baseline));
    const above = yy - 5 > yt + 8;
    base = `<line class="av-pc-base" x1="${xl}" x2="${xr}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"></line>
      <text class="av-pc-base-txt" x="${xl + 4}" y="${(above ? yy - 5 : yy + 13).toFixed(1)}">${esc(labels.baseline || "")}</text>`;
  }

  // umbrales del motor de alertas dentro del eje Y: rango normal (línea continua) y banda personal
  // (raya-punto); sus valores van en la leyenda, sin etiqueta sobre la línea para no tapar los datos
  const thr = thresholdEdges(data.ranges).filter((e) => e.v >= lo && e.v <= hi).map((e) => {
    const yy = y(e.v).toFixed(1);
    return `<line class="av-pc-thr av-pc-thr-${e.kind}" x1="${xl}" x2="${xr}" y1="${yy}" y2="${yy}"></line>`;
  }).join("");

  // histórico: segmentos separados por huecos
  const histPath = segments(hist).map((s) => polyline("av-pc-hline", s, g)).join("");
  const showDots = histReal.length <= 120;
  const histDots = showDots
    ? histReal.map((p) => `<circle class="av-pc-hdot" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5"></circle>`).join("")
    : "";

  // pronóstico: arranca en el último punto del histórico para que se vea como continuación
  const fcSegs = segments(fc);
  if (lastH && fcSegs.length) fcSegs[0] = [lastH, ...fcSegs[0]];
  const fcPath = fcSegs.map((s) => (s.length > 1 ? polyline("av-pc-fline", s, g) : "")).join("");
  const fcDots = fcReal.map((p) => {
    const cx = x(p.t).toFixed(1);
    const cy = y(p.v).toFixed(1);
    return p.oor
      ? `<circle class="av-pc-oor-ring" cx="${cx}" cy="${cy}" r="7"></circle><circle class="av-pc-fdot av-pc-oor" cx="${cx}" cy="${cy}" r="4"></circle>`
      : `<circle class="av-pc-fdot" cx="${cx}" cy="${cy}" r="3"></circle>`;
  }).join("");

  // bandas de predicción: la del 95 % debajo y la del 80 % encima (el solape la hace más marcada)
  const bands = bandRuns(fc, "b95").map((run) => bandArea("av-pc-band av-pc-band95", run, "b95", g)).join("")
    + bandRuns(fc, "b80").map((run) => bandArea("av-pc-band av-pc-band80", run, "b80", g)).join("");

  return `<svg class="av-pc-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(labels.ariaLabel || "")}" focusable="false">
    ${zone}${grid}${unitTxt}${axisX}${xTicks}${bands}${thr}${base}${histPath}${histDots}${fcPath}${fcDots}
    <g class="av-pc-cursor" style="display:none">
      <line class="av-pc-cursor-line" x1="0" x2="0" y1="${yt}" y2="${yb}"></line>
      <circle class="av-pc-cursor-dot" cx="0" cy="0" r="5"></circle>
    </g>
  </svg>`;
}

function legendHTML(data, fmt) {
  const { hist, fc, baseline, unit, labels } = data;
  const items = [];
  if (hist.some(Boolean)) items.push(`<li><span class="av-pc-key av-pc-key-h" aria-hidden="true"></span>${esc(labels.history)}</li>`);
  if (fc.some(Boolean)) items.push(`<li><span class="av-pc-key av-pc-key-f" aria-hidden="true"></span>${esc(labels.forecast)}</li>`);
  if (labels.band80 && fc.some((p) => p && p.b80)) items.push(`<li><span class="av-pc-key av-pc-key-band av-pc-key-b80" aria-hidden="true"></span>${esc(labels.band80)}</li>`);
  if (labels.band95 && fc.some((p) => p && p.b95)) items.push(`<li><span class="av-pc-key av-pc-key-band av-pc-key-b95" aria-hidden="true"></span>${esc(labels.band95)}</li>`);
  if (isNum(baseline)) items.push(`<li><span class="av-pc-key av-pc-key-base" aria-hidden="true"></span>${esc(labels.baseline)} <span class="av-pc-mono">${esc(`${fmt.value(baseline)} ${unit}`.trim())}</span></li>`);
  for (const [kind, name] of [["normal", labels.normalRange], ["personal", labels.personalBand]]) {
    if (data.ranges[kind] && name) items.push(`<li><span class="av-pc-key av-pc-key-thr-${kind}" aria-hidden="true"></span>${esc(name)} <span class="av-pc-mono">${esc(rangeText(data.ranges[kind], unit, fmt))}</span></li>`);
  }
  if (fc.some((p) => p && p.oor)) items.push(`<li><span class="av-pc-key av-pc-key-oor" aria-hidden="true"></span>${esc(labels.outOfRange)}</li>`);
  return items.length ? `<ul class="av-pc-legend">${items.join("")}</ul>` : "";
}

/* "63,4 – 78,3 lpm" para una banda [inferior, superior] */
function bandText(band, unit, fmt) {
  return `${fmt.value(band[0])} – ${fmt.value(band[1])} ${unit}`.trim();
}

/* Resumen textual para lectores de pantalla (sin palabras fijas: solo las etiquetas recibidas) */
function summaryText(data, fmt) {
  const { hist, fc, baseline, unit, labels } = data;
  const parts = [];
  const range = (arr, name) => {
    if (!arr.length) return;
    const a = arr[0];
    const b = arr[arr.length - 1];
    parts.push(`${name}: ${fmt.date(a)} – ${fmt.date(b)}, ${fmt.value(a.v)} → ${fmt.value(b.v)} ${unit}`.trim());
  };
  if (labels.ariaLabel) parts.push(labels.ariaLabel);
  range(hist.filter(Boolean), labels.history);
  const fcReal = fc.filter(Boolean);
  range(fcReal, labels.forecast);
  // bandas del último día pronosticado (las más anchas)
  const lastF = fcReal[fcReal.length - 1];
  if (lastF) {
    for (const [key, name] of [["b80", labels.band80], ["b95", labels.band95]]) {
      if (lastF[key] && name) parts.push(`${name}, ${fmt.date(lastF)}: ${bandText(lastF[key], unit, fmt)}`);
    }
  }
  const oor = fcReal.filter((p) => p.oor).length;
  if (oor) parts.push(`${labels.outOfRange}: ${oor}`);
  if (isNum(baseline)) parts.push(`${labels.baseline}: ${fmt.value(baseline)} ${unit}`.trim());
  for (const [kind, name] of [["normal", labels.normalRange], ["personal", labels.personalBand]]) {
    if (data.ranges[kind] && name) parts.push(`${name}: ${rangeText(data.ranges[kind], unit, fmt)}`);
  }
  return parts.join(". ") + ".";
}

/* ───────────────────────── interacción ───────────────────────── */

/* view = { g, svg } se actualiza al redibujar: los listeners se enlazan una sola vez */
function bindChart(wrap, live, view, real, data, fmt) {
  const { unit, labels } = data;
  const tip = wrap.querySelector(".av-pc-tip");
  let active = -1;
  let xs = [];
  let svg, cursor, cLine, cDot, g;
  let first = 0; // primer punto a la vista (en pantallas estrechas el eje X no arranca en el primer día)
  const sync = () => {
    if (svg === view.svg) return;
    ({ svg, g } = view);
    cursor = svg.querySelector(".av-pc-cursor");
    cLine = svg.querySelector(".av-pc-cursor-line");
    cDot = svg.querySelector(".av-pc-cursor-dot");
    xs = real.map((p) => g.x(p.t));
    first = g.first || 0;
  };

  const show = (i, announce) => {
    if (!view.svg) return;
    sync();
    if (i < 0 || i >= real.length) return;
    i = Math.max(i, first);
    active = i;
    const p = real[i];
    const px = xs[i];
    const py = g.y(p.v);
    cursor.style.display = "";
    cLine.setAttribute("x1", px); cLine.setAttribute("x2", px);
    cDot.setAttribute("cx", px); cDot.setAttribute("cy", py);
    cDot.setAttribute("class", `av-pc-cursor-dot${p.kind === "f" ? " av-pc-cursor-f" : ""}${p.oor ? " av-pc-oor" : ""}`);
    const val = `${fmt.value(p.v)} ${unit}`.trim();
    const kind = p.kind === "f" ? labels.forecast : labels.history;
    const date = fmt.date(p);
    // bandas de predicción del punto (solo en el pronóstico y si el servidor las envía)
    const bandRows = [["b80", labels.band80], ["b95", labels.band95]]
      .filter(([key, name]) => p[key] && name)
      .map(([key, name]) => `${name}: ${bandText(p[key], unit, fmt)}`);
    tip.innerHTML = `<strong class="av-pc-mono">${esc(val)}</strong><span>${esc(date)}</span>`
      + `<span class="av-pc-tip-kind av-pc-tip-${p.kind}">${esc(kind)}</span>`
      + bandRows.map((row) => `<span class="av-pc-tip-band">${esc(row)}</span>`).join("")
      + (p.oor ? `<span class="av-pc-tip-oor">${esc(labels.outOfRange)}</span>` : "");
    tip.hidden = false;
    // posición en píxeles del contenedor (el SVG se escala al ancho de la caja)
    const scale = svg.getBoundingClientRect().width / g.W || 1;
    const tw = tip.offsetWidth;
    const ww = wrap.clientWidth;
    let left = px * scale + 12;
    if (left + tw > ww - 4) left = px * scale - tw - 12;
    tip.style.left = `${Math.max(4, Math.min(left, ww - tw - 4))}px`;
    tip.style.top = `${Math.max(4, py * scale - tip.offsetHeight - 10)}px`;
    if (announce && live) {
      const bandsTxt = bandRows.length ? `, ${bandRows.join(", ")}` : "";
      live.textContent = `${kind}: ${date}, ${val}${bandsTxt}${p.oor ? `, ${labels.outOfRange}` : ""}. ${i - first + 1}/${real.length - first}`;
    }
  };
  const hide = () => {
    active = -1;
    if (!view.svg) return;
    sync();
    cursor.style.display = "none";
    tip.hidden = true;
  };
  const nearest = (clientX) => {
    sync();
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / (rect.width || 1)) * g.W;
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < sx) lo = mid; else hi = mid;
    }
    return Math.abs(xs[lo] - sx) <= Math.abs(xs[hi] - sx) ? lo : hi;
  };

  // los eventos de puntero se escuchan en la caja del SVG (el SVG se sustituye al redimensionar)
  const box = wrap.querySelector(".av-pc-svgbox");
  box.addEventListener("pointermove", (ev) => { if (view.svg) show(nearest(ev.clientX), false); });
  box.addEventListener("pointerdown", (ev) => { if (view.svg) show(nearest(ev.clientX), ev.pointerType !== "mouse"); });
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

/* ───────────────────────── punto de entrada ───────────────────────── */

export function renderPredictionChart(container, {
  history,
  forecast,
  baseline,
  ranges,
  unit,
  labels,
  locale,
  formatValue,
} = {}) {
  const noop = { destroy() {} };
  if (!container) return noop;
  // sustituye la gráfica anterior del mismo contenedor
  const prev = instances.get(container);
  if (prev) prev.destroy();

  const L = {
    history: "", forecast: "", band80: "", band95: "", baseline: "", normalRange: "", personalBand: "", outOfRange: "", ariaLabel: "",
    ...(labels || {}),
  };
  const data = {
    hist: normalizeHistory(history),
    fc: normalizeForecast(forecast),
    baseline: isNum(baseline) ? Number(baseline) : null,
    ranges: normalizeRanges(ranges),
    unit: String(unit ?? ""),
    labels: L,
  };
  // todos los puntos navegables, ordenados por fecha
  const real = [...data.hist.filter(Boolean), ...data.fc.filter(Boolean)].sort((a, b) => a.t - b.t);
  if (!real.length) {
    container.innerHTML = "";
    return noop;
  }

  ensureCss();
  const fmt = makeFormatters(locale, formatValue);
  const id = `av-pc-${++seq}`;
  container.innerHTML = `<div class="av-pc">
    ${legendHTML(data, fmt)}
    <div class="av-pc-chart" tabindex="0" role="group" aria-label="${esc(L.ariaLabel)}" aria-describedby="${id}-sum">
      <div class="av-pc-svgbox"></div>
      <div class="av-pc-tip" hidden></div>
    </div>
    <p class="av-pc-sr" id="${id}-sum">${esc(summaryText(data, fmt))}</p>
    <p class="av-pc-sr av-pc-live" role="status" aria-live="polite"></p>
  </div>`;

  const root = container.querySelector(".av-pc");
  const wrap = root.querySelector(".av-pc-chart");
  const svgBox = wrap.querySelector(".av-pc-svgbox");
  const live = root.querySelector(".av-pc-live");
  const view = { g: null, svg: null };
  const handle = bindChart(wrap, live, view, real, data, fmt);
  let lastW = 0;
  let timer = 0;
  let observer = null;
  let destroyed = false;

  const paintSvg = () => {
    if (destroyed || !wrap.isConnected) return;
    const w = Math.floor(wrap.clientWidth);
    if (!w || w === lastW) return;
    lastW = w;
    view.g = chartGeometry(w, real, data, fmt);
    svgBox.innerHTML = chartSVG(view.g, data, fmt);
    view.svg = svgBox.querySelector(".av-pc-svg");
    handle.refresh();
  };
  paintSvg();

  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(() => {
      if (!wrap.isConnected) { observer.disconnect(); return; }
      // fuera del callback (evita el aviso "ResizeObserver loop")
      clearTimeout(timer);
      timer = setTimeout(paintSvg, 60);
    });
    observer.observe(wrap);
  }

  const api = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timer);
      if (observer) observer.disconnect();
      if (instances.get(container) === api) instances.delete(container);
      if (root.isConnected && root.parentNode === container) container.innerHTML = "";
    },
  };
  instances.set(container, api);
  return api;
}
