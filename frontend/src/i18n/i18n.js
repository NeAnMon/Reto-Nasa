/* =========================================================================
   AstroVital — núcleo de idiomas (es / en)
   -------------------------------------------------------------------------
   Contrato para todos los módulos:
   - Cada módulo define sus textos como diccionario por idioma:
       const DICT = { es: { title: "Radiación", ... }, en: { title: "Radiation", ... } };
     y en cada render obtiene el idioma actual con   const T = tr(DICT);
     (T.title → texto del idioma actual; si falta en "en" cae a "es").
   - Textos con variables:  fmt(T.lastRead, { h: 3 })  con "Hace {h} h".
   - Números / fechas: usar locale() ("es-CL" | "en-US") con toLocaleString / Intl.
   - El HTML estático (index.html) usa atributos:
       data-i18n="clave"                       → textContent
       data-i18n-html="clave"                  → innerHTML (solo textos propios, nunca datos de usuario)
       data-i18n-attr="aria-label:clave;title:clave2;placeholder:clave3"
     con las claves de STATIC más abajo. applyStaticI18n() las aplica.
   - Al cambiar de idioma se emite window "av:lang-change" { detail: { lang } };
     app.js vuelve a pintar la sección actual y el encabezado.
   ========================================================================= */

export const LANGS = [
  { code: "es", label: "Español", short: "ES" },
  { code: "en", label: "English", short: "EN" },
];
const STORAGE_KEY = "av_lang";
const DEFAULT_LANG = "es";

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && LANGS.some((l) => l.code === v)) return v;
  } catch (_) { /* almacenamiento no disponible */ }
  try {
    const nav = (navigator.language || "").slice(0, 2).toLowerCase();
    if (LANGS.some((l) => l.code === nav)) return nav;
  } catch (_) { /* sin navigator */ }
  return DEFAULT_LANG;
}

let current = readStored();

export function getLang() {
  return current;
}

export function locale() {
  return current === "en" ? "en-US" : "es-CL";
}

export function setLang(lang) {
  if (!LANGS.some((l) => l.code === lang) || lang === current) return;
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) { /* ignore */ }
  document.documentElement.lang = lang;
  applyStaticI18n();
  syncSelectors();
  window.dispatchEvent(new CustomEvent("av:lang-change", { detail: { lang } }));
}

export function onLangChange(fn) {
  const h = (e) => fn(e.detail.lang);
  window.addEventListener("av:lang-change", h);
  return () => window.removeEventListener("av:lang-change", h);
}

/** Devuelve el diccionario del idioma actual con respaldo en español (y en la clave misma). */
export function tr(dict) {
  const base = dict[DEFAULT_LANG] || {};
  const cur = dict[current] || {};
  if (current === DEFAULT_LANG) return base;
  return new Proxy(cur, {
    get(target, key) {
      if (key in target) return target[key];
      if (key in base) return base[key];
      return typeof key === "string" ? key : undefined;
    },
  });
}

/** Reemplaza {var} en una cadena. */
export function fmt(str, vars = {}) {
  return String(str ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Formatea un número según el idioma actual. */
export function fmtNum(v, dec = 0) {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(locale(), { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/* ---------------------------------------------------------------------------
   Textos del HTML estático (index.html). Claves planas.
   --------------------------------------------------------------------------- */
export const STATIC = {
  es: {
    "lang.label": "Idioma",
    "doc.title": "AstroVital — Plataforma de Monitoreo Integral de Salud Espacial",
    // Encabezado global y pestañas
    "chrome.aria": "Encabezado de la consola de salud",
    "nav.aria": "Navegación principal",
    "tab.summary": "Resumen",
    "tab.radiation": "Radiación",
    "tab.environments": "Entornos",
    "tab.measure": "Registrar medición",
    "tab.countermeasures": "Contramedidas",
    "tab.wellbeing": "Bienestar",
    "tab.alerts": "Alertas",
    "tab.recommendations": "Recomendaciones",
    "tab.logbook": "Bitácora",
    "badge.alerts": "Alertas activas",
    "badge.emo": "Cuestionarios pendientes",
    "more.btn": "Más",
    "more.aria": "Más secciones",
    "more.wellness": "Bienestar psicológico",
    "more.cognitive": "Evaluación cognitiva",
    "more.emotional": "Check-in emocional",
    "more.crew": "Monitoreo de tripulación",
    "more.admin": "Administración",
    "more.settings": "Ajustes y ayuda",
    "crew.label": "Tripulante",
    "btn.contrast": "Contraste",
    "btn.contrastTitle": "Alternar alto contraste",
    // Modal
  },
  en: {
    "lang.label": "Language",
    "doc.title": "AstroVital — Integrated Space Health Monitoring Platform",
    "chrome.aria": "Health console header",
    "nav.aria": "Main navigation",
    "tab.summary": "Overview",
    "tab.radiation": "Radiation",
    "tab.environments": "Environments",
    "tab.measure": "Log measurement",
    "tab.countermeasures": "Countermeasures",
    "tab.wellbeing": "Well-being",
    "tab.alerts": "Alerts",
    "tab.recommendations": "Recommendations",
    "tab.logbook": "Logbook",
    "badge.alerts": "Active alerts",
    "badge.emo": "Pending questionnaires",
    "more.btn": "More",
    "more.aria": "More sections",
    "more.wellness": "Psychological well-being",
    "more.cognitive": "Cognitive assessment",
    "more.emotional": "Emotional check-in",
    "more.crew": "Crew monitoring",
    "more.admin": "Administration",
    "more.settings": "Settings & help",
    "crew.label": "Crew member",
    "btn.contrast": "Contrast",
    "btn.contrastTitle": "Toggle high contrast",
  },
};

function staticText(key) {
  const d = STATIC[current] || {};
  if (key in d) return d[key];
  const b = STATIC[DEFAULT_LANG] || {};
  return key in b ? b[key] : null;
}

export function applyStaticI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = staticText(el.getAttribute("data-i18n"));
    if (v !== null) el.textContent = v;
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const v = staticText(el.getAttribute("data-i18n-html"));
    if (v !== null) el.innerHTML = v;
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.getAttribute("data-i18n-attr").split(";").forEach((pair) => {
      const [attr, key] = pair.split(":").map((s) => s && s.trim());
      if (!attr || !key) return;
      const v = staticText(key);
      if (v !== null) el.setAttribute(attr, v);
    });
  });
  const title = staticText("doc.title");
  if (title) document.title = title;
}

/* ---------------------------------------------------------------------------
   Selector de idioma: interruptor segmentado ES | EN en cualquier elemento
   [data-av-lang] de la página (role="radiogroup" con dos botones role="radio").
   Clic en un lado → ese idioma; flechas / Inicio / Fin mueven y seleccionan;
   Enter / Espacio activan el botón enfocado. Tabindex móvil: solo el activo es tabulable.
   El contenedor recibe data-active="es|en" para desplazar el "thumb" (CSS en main.css).
   --------------------------------------------------------------------------- */
function syncSelectors() {
  document.querySelectorAll("[data-av-lang]").forEach((group) => {
    group.setAttribute("data-active", current);
    group.querySelectorAll("[data-lang]").forEach((btn) => {
      const on = btn.getAttribute("data-lang") === current;
      btn.setAttribute("aria-checked", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    });
  });
}

function langSwitchKeydown(e) {
  const btns = [...e.currentTarget.querySelectorAll("[data-lang]")];
  const i = btns.indexOf(document.activeElement);
  let next = -1;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % btns.length;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + btns.length) % btns.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = btns.length - 1;
  if (next < 0) return;
  e.preventDefault();
  const group = e.currentTarget;
  const code = btns[next].getAttribute("data-lang");
  setLang(code);
  // si la vista se volvió a pintar (p. ej. Ajustes), enfocar el interruptor nuevo con el mismo id
  const live = group.isConnected ? group : (group.id && document.getElementById(group.id));
  live?.querySelector(`[data-lang="${code}"]`)?.focus();
}

export function initLangSelectors(root = document) {
  root.querySelectorAll("[data-av-lang]").forEach((group) => {
    if (!group.querySelector("[data-lang]")) {
      group.innerHTML =
        `<span class="av-lang-thumb" aria-hidden="true"></span>` +
        LANGS.map(
          (l) => `<button type="button" role="radio" class="av-lang-opt" data-lang="${l.code}" lang="${l.code}" aria-label="${l.label}" title="${l.label}">${l.short}</button>`
        ).join("");
    }
    group.classList.add("av-lang-switch");
    if (!group.hasAttribute("role")) group.setAttribute("role", "radiogroup");
    if (group.dataset.avLangBound) return;
    group.dataset.avLangBound = "1";
    // Enter / Espacio disparan "click" en el <button> enfocado
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-lang]");
      if (btn && group.contains(btn)) setLang(btn.getAttribute("data-lang"));
    });
    group.addEventListener("keydown", langSwitchKeydown);
  });
  syncSelectors();
}

/** Llamar una vez al arrancar (app.js). */
export function initI18n() {
  document.documentElement.lang = current;
  applyStaticI18n();
  initLangSelectors();
}
