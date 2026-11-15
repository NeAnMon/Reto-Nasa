/*
 * SEMSA · Bitácora · Gráfica interactiva genérica para las series de los motores (issue #30)
 *
 * SVG propio (sin librerías), mismo patrón que logbook-trends.js y prediction-chart.js:
 * - Series de tipo "line" (continua o discontinua), "step" (escalones, para estados
 *   ordinales), "bar" (barras apiladas por instante) y "area" (banda lo/hi).
 * - Bandas y líneas horizontales (límites Y / R, línea base, objetivos) con etiqueta.
 * - Frontera vertical opcional (p. ej. entre histórico y pronóstico).
 * - Tooltip al pasar el ratón o tocar y recorrido con teclado (← → Inicio Fin, Mayús = 10,
 *   Esc oculta) anunciado en una región aria-live. Los puntos navegables los da quien llama
 *   (spec.nav), con el texto del tooltip ya preparado.
 * - Se redibuja al ancho real del contenedor con ResizeObserver.
 *
 * Interfaz: renderEngineChart(container, spec) → { destroy() }.
 *   spec = {
 *     label, roleDesc, helpId,           // accesibilidad (aria-label, aria-roledescription, aria-describedby)
 *     fmtAxis(v), fmtTime(t),            // formato de los ejes
 *     yDomain?: [lo, hi], yTicks?: [{ v, label }], zeroBased?: bool,
 *     bands?: [{ lo, hi, cls }], hlines?: [{ v, cls, label, always? }], splitT?: number,
 *     series: [{ kind, cls, dashed?, dots?, points: [{ t, v } | { t, lo, hi } | null] }],
 *     nav: [{ t, v, l?, html, sr }],      // ordenados por t
 *   }
 * Solo clases con prefijo av-lec- (logbook-engines.css).
 */

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const isNum = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

const instances = new WeakMap();

/* ───────────────────────── geometría ───────────────────────── */

function geometry(width, spec) {
  const W = Math.max(280, Math.round(width));
  const H = W < 520 ? 220 : 270;
  const ordinal = Array.isArray(spec.yTicks) && spec.yTicks.length;
  const pad = { l: ordinal ? (W < 520 ? 92 : 128) : W < 520 ? 44 : 56, r: W < 520 ? 30 : 44, t: 14, b: 28 };

  const ts = [];
  const vs = [];
  const stacks = new Map(); // t → suma de barras
  for (const s of spec.series) {
    for (const p of s.points) {
      if (!p) continue;
      ts.push(p.t);
      if (s.kind === "bar") stacks.set(p.t, (stacks.get(p.t) || 0) + Number(p.v));
      else if (s.kind === "area") { vs.push(p.lo, p.hi); }
      else vs.push(p.v);
    }
  }
  for (const n of spec.nav) ts.push(n.t);
  if (isNum(spec.splitT)) ts.push(spec.splitT);
  for (const v of stacks.values()) vs.push(v);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);

  let lo, hi;
  if (spec.yDomain) {
    [lo, hi] = spec.yDomain;
  } else {
    lo = Math.min(...vs);
    hi = Math.max(...vs);
    if (stacks.size || spec.zeroBased) lo = Math.min(0, lo);
    for (const h of spec.hlines || []) if (h.always && isNum(h.v)) { lo = Math.min(lo, h.v); hi = Math.max(hi, h.v); }
    const span0 = hi - lo || Math.abs(hi) || 1;
    // los límites lejanos no aplastan la serie: solo entran en escala si están cerca
    for (const h of spec.hlines || []) if (!h.always && isNum(h.v) && h.v >= lo - span0 * 0.6 && h.v <= hi + span0 * 0.6) { lo = Math.min(lo, h.v); hi = Math.max(hi, h.v); }
    const span = hi - lo || Math.abs(hi) || 1;
    if (!(stacks.size || spec.zeroBased) || lo < 0) lo -= span * 0.08;
    hi += span * 0.08;
  }

  // ancho de barra: 70 % de la menor separación entre instantes con barra
  const barTs = [...stacks.keys()].sort((a, b) => a - b);
  const plotW = W - pad.l - pad.r;
  const xRaw = (t) => (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
  let minGap = Infinity;
  for (let i = 1; i < barTs.length; i++) minGap = Math.min(minGap, xRaw(barTs[i]) - xRaw(barTs[i - 1]));
  const barW = barTs.length ? Math.max(3, Math.min(28, Number.isFinite(minGap) ? minGap * 0.7 : 24)) : 0;
  // con barras se deja medio ancho de margen a cada lado para que no se corten
  const inset = barW ? barW / 2 + 2 : 0;
  const x = (t) => pad.l + inset + (t1 === t0 ? (plotW - 2 * inset) / 2 : ((t - t0) / (t1 - t0)) * (plotW - 2 * inset));
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  return { W, H, pad, lo, hi, x, y, barW, t0, t1 };
}

/* ───────────────────────── dibujo ───────────────────────── */

function svgHTML(g, spec) {
  const { W, H, pad, lo, hi, x, y } = g;
  const xl = pad.l;
  const xr = W - pad.r;
  const clamp = (v) => Math.min(hi, Math.max(lo, v));

  let bands = "";
  for (const b of spec.bands || []) {
    const a = isNum(b.lo) ? b.lo : lo;
    const c = isNum(b.hi) ? b.hi : hi;
    const ya = y(clamp(a));
    const yb = y(clamp(c));
    const h = Math.abs(yb - ya);
    if (h > 0.5) bands += `<rect class="${esc(b.cls)}" x="${xl}" y="${Math.min(ya, yb).toFixed(1)}" width="${xr - xl}" height="${h.toFixed(1)}"></rect>`;
  }

  const ticks = Array.isArray(spec.yTicks) && spec.yTicks.length
    ? spec.yTicks
    : [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: lo + f * (hi - lo), label: spec.fmtAxis(lo + f * (hi - lo), hi - lo) }));
  const grid = ticks.map((tk) => {
    const yy = y(tk.v).toFixed(1);
    return `<line class="av-lec-grid" x1="${xl}" x2="${xr}" y1="${yy}" y2="${yy}"></line>
      <text class="av-lec-axis" x="${xl - 6}" y="${(Number(yy) + 4).toFixed(1)}" text-anchor="end">${esc(tk.label)}</text>`;
  }).join("");

  let hlines = "";
  for (const h of spec.hlines || []) {
    if (!isNum(h.v) || h.v < lo || h.v > hi) continue;
    const yy = y(h.v).toFixed(1);
    hlines += `<line class="${esc(h.cls)}" x1="${xl}" x2="${xr}" y1="${yy}" y2="${yy}"></line>`;
    if (h.label) hlines += `<text class="av-lec-lim-txt ${esc(h.cls)}-txt" x="${xr + 4}" y="${(Number(yy) + 4).toFixed(1)}">${esc(h.label)}</text>`;
  }

  let split = "";
  if (isNum(spec.splitT)) {
    const sx = x(spec.splitT);
    split = `<rect class="av-lec-future" x="${sx.toFixed(1)}" y="${pad.t}" width="${Math.max(0, xr - sx).toFixed(1)}" height="${H - pad.t - pad.b}"></rect>
      <line class="av-lec-split" x1="${sx.toFixed(1)}" x2="${sx.toFixed(1)}" y1="${pad.t}" y2="${H - pad.b}"></line>`;
  }

  // barras apiladas: la base de cada instante sube con cada serie
  const base = new Map();
  let bars = "";
  let areas = "";
  let lines = "";
  let dots = "";
  for (const s of spec.series) {
    const cls = `av-lec-${s.cls || "s1"}`;
    if (s.kind === "bar") {
      for (const p of s.points) {
        if (!p || !(Number(p.v) > 0)) continue;
        const b0 = base.get(p.t) || 0;
        const b1 = b0 + Number(p.v);
        base.set(p.t, b1);
        const top = y(b1);
        bars += `<rect class="av-lec-bar ${cls}" x="${(x(p.t) - g.barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${g.barW.toFixed(1)}" height="${Math.max(1, y(b0) - top).toFixed(1)}"></rect>`;
      }
      continue;
    }
    // segmentos separados por null (huecos)
    const segs = [];
    let cur = [];
    for (const p of s.points) {
      if (p === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p);
    }
    if (cur.length) segs.push(cur);
    for (const seg of segs) {
      if (s.kind === "area") {
        if (seg.length < 2) continue;
        const up = seg.map((p) => `${x(p.t).toFixed(1)},${y(clamp(p.hi)).toFixed(1)}`);
        const dn = seg.slice().reverse().map((p) => `${x(p.t).toFixed(1)},${y(clamp(p.lo)).toFixed(1)}`);
        areas += `<polygon class="av-lec-area ${cls}" points="${[...up, ...dn].join(" ")}"></polygon>`;
        continue;
      }
      if (seg.length === 1) {
        dots += `<circle class="av-lec-dot ${cls}" cx="${x(seg[0].t).toFixed(1)}" cy="${y(seg[0].v).toFixed(1)}" r="3.5"></circle>`;
        continue;
      }
      let pts;
      if (s.kind === "step") {
        pts = [];
        seg.forEach((p, i) => {
          if (i) pts.push(`${x(p.t).toFixed(1)},${y(seg[i - 1].v).toFixed(1)}`);
          pts.push(`${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
        });
      } else {
        pts = seg.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
      }
      lines += `<polyline class="av-lec-line ${cls}${s.dashed ? " av-lec-dashed" : ""}" points="${pts.join(" ")}"></polyline>`;
      if (s.dots && seg.length <= 90) {
        dots += seg.map((p) => `<circle class="av-lec-dot ${cls}" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5"></circle>`).join("");
      }
    }
  }
  // puntos en alarma (C / W) siempre visibles
  for (const n of spec.nav) {
    if (n.l !== "C" && n.l !== "W") continue;
    dots += `<circle class="av-lec-dot av-lec-dot-${n.l}" cx="${x(n.t).toFixed(1)}" cy="${y(n.v).toFixed(1)}" r="4"></circle>`;
  }

  const nav = spec.nav;
  const pick = nav.length > 2 && W >= 420 ? [nav[0], nav[Math.floor((nav.length - 1) / 2)], nav[nav.length - 1]] : nav.length > 1 ? [nav[0], nav[nav.length - 1]] : [nav[0]];
  const xTicks = pick.map((p, i, arr) => {
    const anchor = arr.length === 1 ? "middle" : i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle";
    return `<text class="av-lec-axis" x="${x(p.t).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${esc(spec.fmtTime(p.t))}</text>`;
  }).join("");

  return `<svg class="av-lec-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
    ${bands}${split}${grid}${areas}${hlines}${bars}${lines}${dots}${xTicks}
    <g class="av-lec-cursor" style="display:none">
      <line class="av-lec-cursor-line" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}"></line>
      <circle class="av-lec-cursor-dot" cx="0" cy="0" r="5"></circle>
    </g>
  </svg>`;
}

/* ───────────────────────── interacción ───────────────────────── */

function bind(wrap, live, view, nav) {
  const tip = wrap.querySelector(".av-lec-tip");
  let active = -1;
  let svg, cursor, cLine, cDot, g, xs = [];
  const sync = () => {
    if (svg === view.svg) return;
    ({ svg, g } = view);
    cursor = svg.querySelector(".av-lec-cursor");
    cLine = svg.querySelector(".av-lec-cursor-line");
    cDot = svg.querySelector(".av-lec-cursor-dot");
    xs = nav.map((p) => g.x(p.t));
  };
  const show = (i, announce) => {
    if (!view.svg) return;
    sync();
    if (i < 0 || i >= nav.length) return;
    active = i;
    const p = nav[i];
    const px = xs[i];
    const py = g.y(p.v);
    cursor.style.display = "";
    cLine.setAttribute("x1", px); cLine.setAttribute("x2", px);
    cDot.setAttribute("cx", px); cDot.setAttribute("cy", py);
    cDot.setAttribute("class", `av-lec-cursor-dot${p.l === "C" || p.l === "W" ? ` av-lec-dot-${p.l}` : ""}`);
    tip.innerHTML = p.html;
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / g.W || 1;
    const tw = tip.offsetWidth;
    const ww = wrap.clientWidth;
    let left = px * scale + 12;
    if (left + tw > ww - 4) left = px * scale - tw - 12;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, py * scale - tip.offsetHeight - 10)}px`;
    if (announce && live) live.textContent = `${p.sr}. ${i + 1}/${nav.length}`;
  };
  const hide = () => {
    active = -1;
    if (cursor) cursor.style.display = "none";
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
  const box = wrap.querySelector(".av-lec-svgbox");
  box.addEventListener("pointermove", (ev) => { if (view.svg) show(nearest(ev.clientX), false); });
  box.addEventListener("pointerdown", (ev) => { if (view.svg) show(nearest(ev.clientX), ev.pointerType !== "mouse"); });
  box.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse" && document.activeElement !== wrap) hide(); });
  wrap.addEventListener("focus", () => show(active >= 0 ? active : nav.length - 1, true));
  wrap.addEventListener("blur", hide);
  wrap.addEventListener("keydown", (ev) => {
    const step = ev.shiftKey ? 10 : 1;
    let i = active >= 0 ? active : nav.length - 1;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") i = Math.max(0, i - step);
    else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") i = Math.min(nav.length - 1, i + step);
    else if (ev.key === "Home") i = 0;
    else if (ev.key === "End") i = nav.length - 1;
    else if (ev.key === "Escape") { hide(); return; }
    else return;
    ev.preventDefault();
    show(i, true);
  });
  return { refresh() { if (active >= 0) show(active, false); } };
}

/* ───────────────────────── punto de entrada ───────────────────────── */

export function renderEngineChart(container, spec) {
  const noop = { destroy() {} };
  if (!container) return noop;
  const prev = instances.get(container);
  if (prev) prev.destroy();
  if (!spec || !Array.isArray(spec.nav) || !spec.nav.length) {
    container.innerHTML = "";
    return noop;
  }
  container.innerHTML = `<div class="av-lec-chart" tabindex="0" role="group" aria-roledescription="${esc(spec.roleDesc || "")}" aria-label="${esc(spec.label || "")}"${spec.helpId ? ` aria-describedby="${esc(spec.helpId)}"` : ""}>
      <div class="av-lec-svgbox"></div>
      <div class="av-lec-tip" hidden></div>
    </div>
    <p class="av-lec-sr av-lec-live" role="status" aria-live="polite"></p>`;
  const wrap = container.querySelector(".av-lec-chart");
  const svgBox = wrap.querySelector(".av-lec-svgbox");
  const live = container.querySelector(".av-lec-live");
  const view = { g: null, svg: null };
  const handle = bind(wrap, live, view, spec.nav);
  let lastW = 0;
  let timer = 0;
  let observer = null;
  let destroyed = false;
  const paint = () => {
    if (destroyed || !wrap.isConnected) return;
    const w = Math.floor(wrap.clientWidth);
    if (!w || w === lastW) return;
    lastW = w;
    view.g = geometry(w, spec);
    svgBox.innerHTML = svgHTML(view.g, spec);
    view.svg = svgBox.querySelector(".av-lec-svg");
    handle.refresh();
  };
  paint();
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(() => {
      if (!wrap.isConnected) { observer.disconnect(); return; }
      clearTimeout(timer);
      timer = setTimeout(paint, 60);
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
    },
  };
  instances.set(container, api);
  return api;
}
