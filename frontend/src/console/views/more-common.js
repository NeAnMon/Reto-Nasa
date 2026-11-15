/* SEMSA · Consola · utilidades compartidas por las vistas del menú "Más"
 * (bienestar, cognitivo, emocional, tripulación, administración, ajustes).
 *
 * - Estados de bienestar/emocionales como etiqueta de TEXTO (sin amarillo/rojo: esos colores
 *   quedan reservados a las alertas de precaución/críticas de la consola (alert-classes.js) y aquí serían estigmatizantes).
 * - No se usan data-act / data-nav / form[data-form]: console.js tiene listeners delegados
 *   sobre el contenedor compartido que reaccionan a ellos. Aquí todo va con data-mx-*.
 */
import { escapeHtml, gmt } from "../console.js";
import { tr, getLang } from "../../i18n/i18n.js";
import { bt } from "/src/i18n/backend.js";

/* Textos visibles por idioma; se resuelven en cada render con tr(DICT) */
const DICT = {
  es: {
    retry: "Reintentar",
    unknownError: "error desconocido",
    noAccessTitle: "Sección no disponible para tu rol",
    noData: "—",
    chartEmpty: "Aún no hay datos suficientes para una tendencia.",
    states: {
      WELLNESS_STABLE: "Estable",
      WELLNESS_MONITORING: "En observación",
      SUPPORT_RECOMMENDED: "Apoyo recomendado",
      PROFESSIONAL_REVIEW: "Revisión profesional",
      URGENT_SUPPORT: "Apoyo urgente",
      ASSESSMENT_INCOMPLETE: "Borrador",
      EMOTIONAL_WELLNESS_STABLE: "Bienestar estable",
      EMOTIONAL_WELLNESS_MONITORING: "Seguimiento emocional",
      SUPPORT_REQUESTED: "Apoyo solicitado",
      ASSESSMENT_UNAVAILABLE: "No disponible",
    },
  },
  en: {
    retry: "Retry",
    unknownError: "unknown error",
    noAccessTitle: "This section isn't available for your role",
    noData: "—",
    chartEmpty: "Not enough data for a trend yet.",
    states: {
      WELLNESS_STABLE: "Stable",
      WELLNESS_MONITORING: "Monitoring",
      SUPPORT_RECOMMENDED: "Support recommended",
      PROFESSIONAL_REVIEW: "Professional review",
      URGENT_SUPPORT: "Urgent support",
      ASSESSMENT_INCOMPLETE: "Draft",
      EMOTIONAL_WELLNESS_STABLE: "Emotional wellbeing stable",
      EMOTIONAL_WELLNESS_MONITORING: "Emotional follow-up",
      SUPPORT_REQUESTED: "Support requested",
      ASSESSMENT_UNAVAILABLE: "Unavailable",
    },
  },
};

export const esc = escapeHtml;

/* Formularios a medio llenar: al volver a pintar la vista por un cambio de idioma se conservan
 * los valores escritos (y las etapas en curso), para no perder respuestas. */
export function snapshotFields(root) {
  const snap = {};
  if (!root) return snap;
  root.querySelectorAll("input[id], select[id], textarea[id]").forEach((el) => {
    snap[el.id] = el.type === "checkbox" || el.type === "radio" ? { checked: el.checked } : { value: el.value };
  });
  return snap;
}
export function restoreFields(root, snap) {
  if (!root || !snap) return;
  Object.entries(snap).forEach(([id, v]) => {
    const el = root.querySelector(`#${CSS.escape(id)}`);
    if (!el) return;
    if ("checked" in v) el.checked = v.checked;
    else el.value = v.value;
  });
}
/* true si la vista ya estaba pintada en otro idioma (re-render por "av:lang-change") */
export function langChanged(ui, root) {
  const changed = !!root && !!ui.lang && ui.lang !== getLang();
  ui.lang = getLang();
  return changed;
}

/* Estados que piden atención de alguien: se marcan con borde fuerte (y siempre con texto) */
const STRONG_STATES = new Set(["SUPPORT_RECOMMENDED", "PROFESSIONAL_REVIEW", "URGENT_SUPPORT", "SUPPORT_REQUESTED"]);

export function stateLabel(code) {
  const T = tr(DICT);
  return T.states[code] || bt(code) || T.noData;
}
export function stateTag(code) {
  return `<span class="av-mx-tag${STRONG_STATES.has(code) ? " av-mx-tag-strong" : ""}">${esc(stateLabel(code))}</span>`;
}
export function tag(text, strong = false) {
  return `<span class="av-mx-tag${strong ? " av-mx-tag-strong" : ""}">${esc(text)}</span>`;
}

/* Fecha en el formato de la consola: día del año/HH:MM (GMT) */
export function fmt(iso) {
  const T = tr(DICT);
  if (!iso) return T.noData;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? T.noData : gmt(d, false);
}

export function errMsg(err) {
  const T = tr(DICT);
  // los mensajes de error de la API llegan en español: se traducen al mostrarlos
  return bt(err && err.message) || T.unknownError;
}

/* La hoja va declarada en index.html (con versión); esto solo cubre que falte */
export function ensureCss() {
  if (document.getElementById("av-mx-css")) return;
  const link = document.createElement("link");
  link.id = "av-mx-css";
  link.rel = "stylesheet";
  link.href = new URL("./more.css", import.meta.url).href;
  document.head.appendChild(link);
}

export function loadingHTML(rootCls, text) {
  return `<div class="av-console av-mx-root ${rootCls}"><div class="av-sub" style="padding:24px" role="status">${esc(text)}</div></div>`;
}

/* Panel de error con "Reintentar" (enlazar con bindRetry) */
export function errorHTML(rootCls, title, text) {
  const T = tr(DICT);
  return `<div class="av-console av-mx-root ${rootCls}"><div class="av-grid"><section class="av-panel av-col-b av-mx-pad">
      <h2 class="av-h2">${esc(title)}</h2>
      <p class="av-mx-p" role="alert">${esc(text)}</p>
      <div><button type="button" class="av-btn" data-mx-retry>${T.retry}</button></div>
    </section></div></div>`;
}
export function bindRetry(container, fn) {
  container.querySelector("[data-mx-retry]")?.addEventListener("click", fn);
}

/* Panel para roles sin acceso (el menú ya oculta la entrada; esto cubre la navegación directa) */
export function noAccessHTML(rootCls, text) {
  const T = tr(DICT);
  return `<div class="av-console av-mx-root ${rootCls}"><div class="av-grid"><section class="av-panel av-col-b av-mx-pad">
      <h2 class="av-h2">${T.noAccessTitle}</h2>
      <p class="av-mx-p">${esc(text)}</p>
    </section></div></div>`;
}

/* true si, mientras se esperaba la red, se cambió de sección o de tripulante */
export function makeStale(appState) {
  const section = appState.currentSection;
  const aid = appState.selectedAstronautId;
  return () => appState.currentSection !== section || appState.selectedAstronautId !== aid;
}

export const roleOf = (appState) => appState.currentUser?.role_code || "ASTRONAUT";
/* La persona astronauta viendo sus propios datos */
export function isOwnAstronaut(appState) {
  const me = appState.currentUser;
  return !!me && roleOf(appState) === "ASTRONAUT" && Number(me.id) === Number(appState.selectedAstronautId);
}
export function astronautName(appState) {
  const a = (appState.usersList || []).find((u) => Number(u.id) === Number(appState.selectedAstronautId));
  return a ? `${a.full_name} (${a.crew_code})` : "";
}

/* Tendencia simple en SVG (sin dependencias): values en [min, max]; ariaLabel describe la serie */
export function lineChartSVG(values, { min = 0, max = 100, unit = "", ariaLabel = "" } = {}) {
  const T = tr(DICT);
  const pts = values.map(Number).filter((v) => !Number.isNaN(v));
  if (pts.length < 2) return `<span class="av-sub">${T.chartEmpty}</span>`;
  const W = 640, H = 200, L = 40, R = 12, Tp = 12, B = 22;
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v) => Tp + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * (H - Tp - B);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const v = min + f * (max - min);
      return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--av-row)" stroke-width="1"/>
        <text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--av-muted)" font-family="IBM Plex Mono, monospace">${Math.round(v)}${esc(unit)}</text>`;
    })
    .join("");
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dots = pts.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="var(--av-text)"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}" preserveAspectRatio="none" class="av-mx-chart">
      ${grid}<polyline points="${line}" fill="none" stroke="var(--av-text)" stroke-width="2"/>${dots}
      <text x="${L}" y="${H - 5}" font-size="11" fill="var(--av-muted)" font-family="IBM Plex Mono, monospace">1</text>
      <text x="${W - R}" y="${H - 5}" text-anchor="end" font-size="11" fill="var(--av-muted)" font-family="IBM Plex Mono, monospace">${pts.length}</text>
    </svg>`;
}
