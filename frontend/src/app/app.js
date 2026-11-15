import { apiService } from "../services/api.js";
import {
  renderConsole,
  startHera,
  initChrome,
  renderChrome,
  refreshConsoleData,
} from "../console/console.js";
import { renderMeasureView } from "../console/views/measure.js";
import { renderCountermeasuresView } from "../console/views/countermeasures.js";
import { renderAlertsView } from "../console/views/alerts.js";
import { renderRecommendationsView } from "../console/views/recommendations.js";
import { renderLogbookView } from "../console/views/logbook.js";
import { renderPredictions } from "../console/views/predictions.js";
import { renderCognitiveView } from "../console/views/cognitive.js";
import { renderEmotionalView } from "../console/views/emotional.js";
import { renderCrewView } from "../console/views/crew.js";
import { renderAdminView } from "../console/views/admin.js";
import { renderSettingsView } from "../console/views/settings.js";
import { renderEnvironmentsView } from "../console/views/environments.js";
import { renderWellbeingView, openWellbeingSub } from "../console/views/wellbeing.js";
import { initI18n, onLangChange, tr } from "../i18n/i18n.js";
import { bt } from "/src/i18n/backend.js";

/* Textos propios de app.js (los errores `detail` del backend pasan por bt() para verse en el idioma actual) */
const DICT = {
  es: {
    noData: "Sin datos",
    noDataUpper: "SIN DATOS",
    loading: "Cargando…",
    sectionError: "Error al cargar la sección",
    sessionRenewed: "Sesión renovada automáticamente.",
    sessionLost: "No se pudo abrir la sesión con el servidor.",
    retry: "Reintentar",
    toastInfo: "Confirmado",
    toastError: "Error",
    toastClose: "Cerrar aviso",
    states: {
      NORMAL: "● NORMAL",
      MONITOR: "▲ VIGILAR",
      WARNING: "◆ PRECAUCIÓN",
      CRITICAL: "✖ CRÍTICO",
      UNKNOWN: "○ SIN DATOS",
      STALE: "⌛ VENCIDO",
      INVALID: "⊘ INVÁLIDO",
      WELLNESS_STABLE: "● ESTABLE",
      WELLNESS_MONITORING: "▲ OBSERVACIÓN",
      SUPPORT_RECOMMENDED: "◆ APOYO RECOMENDADO",
      PROFESSIONAL_REVIEW: "◆ REVISIÓN PROFESIONAL",
      URGENT_SUPPORT: "✖ APOYO URGENTE",
      ASSESSMENT_INCOMPLETE: "○ BORRADOR",
      EMOTIONAL_WELLNESS_STABLE: "● BIENESTAR ESTABLE",
      EMOTIONAL_WELLNESS_MONITORING: "▲ SEGUIMIENTO EMOCIONAL",
      SUPPORT_REQUESTED: "◆ APOYO SOLICITADO",
      ASSESSMENT_UNAVAILABLE: "○ NO DISPONIBLE",
    },
  },
  en: {
    noData: "No data",
    noDataUpper: "NO DATA",
    loading: "Loading…",
    sectionError: "Could not load this section",
    sessionRenewed: "Session renewed automatically.",
    sessionLost: "Could not open a session with the server.",
    retry: "Retry",
    toastInfo: "Confirmed",
    toastError: "Error",
    toastClose: "Dismiss notice",
    states: {
      NORMAL: "● NOMINAL",
      MONITOR: "▲ ADVISORY",
      WARNING: "◆ CAUTION",
      CRITICAL: "✖ WARNING",
      UNKNOWN: "○ NO DATA",
      STALE: "⌛ STALE",
      INVALID: "⊘ INVALID",
      WELLNESS_STABLE: "● STABLE",
      WELLNESS_MONITORING: "▲ MONITORING",
      SUPPORT_RECOMMENDED: "◆ SUPPORT RECOMMENDED",
      PROFESSIONAL_REVIEW: "◆ PROFESSIONAL REVIEW",
      URGENT_SUPPORT: "✖ URGENT SUPPORT",
      ASSESSMENT_INCOMPLETE: "○ DRAFT",
      EMOTIONAL_WELLNESS_STABLE: "● EMOTIONAL WELL-BEING STABLE",
      EMOTIONAL_WELLNESS_MONITORING: "▲ EMOTIONAL MONITORING",
      SUPPORT_REQUESTED: "◆ SUPPORT REQUESTED",
      ASSESSMENT_UNAVAILABLE: "○ UNAVAILABLE",
    },
  },
};

const appState = {
  currentUser: null,
  currentSection: "mission-control",
  selectedAstronautId: null,
  selectedMissionId: null,
  healthSummary: null,
  indicatorsCatalog: [],
  bodyRegions: [],
  selectedBodyRegionCode: "HEART_CARDIO",
  envProfiles: [],
  simulatorScenarios: [],
  usersList: [],
  missionsList: [],
  breathingInterval: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Aviso flotante (issue #34: más grande y visible, con el estilo del HUD).
   kind: "info" (por defecto) | "error". Los errores usan role="alert" y duran más.
   Iconos SVG constantes (sin datos del usuario); el mensaje va siempre como texto. */
const TOAST_ICONS = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M12 5v9M12 18v1.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
function showToast(message, kind = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const T = tr(DICT);
  const type = kind === "error" ? "error" : "info";
  const div = document.createElement("div");
  div.className = `toast toast-${type}`;
  div.setAttribute("role", type === "error" ? "alert" : "status");
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = TOAST_ICONS[type];
  const body = document.createElement("div");
  body.className = "toast-body";
  const label = document.createElement("span");
  label.className = "toast-label";
  label.textContent = type === "error" ? T.toastError : T.toastInfo;
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  body.append(label, text);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", T.toastClose);
  close.innerHTML = TOAST_ICONS.close;
  close.addEventListener("click", () => div.remove());
  div.append(icon, body, close);
  container.appendChild(div);
  setTimeout(() => div.remove(), type === "error" ? 8000 : 6000);
}

function formatDateUTC(isoStr) {
  if (!isoStr) return tr(DICT).noData;
  try {
    const d = new Date(isoStr);
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return isoStr;
  }
}

function renderStateBadge(stateCode) {
  const T = tr(DICT);
  const label = T.states[stateCode] || stateCode || T.noDataUpper;
  return `<span class="state-badge state-${stateCode || "UNKNOWN"}">${label}</span>`;
}

/* Utilidades que reciben las vistas y el encabezado global de la consola */
const appHelpers = {
  showToast,
  formatDateUTC,
  renderStateBadge,
  refreshGlobalHeaderAndSummary,
  navigateToSection,
  updateRoleNavigation,
};

/* Secciones antiguas ya cubiertas por la consola: su id sigue funcionando y lleva al equivalente.
 * - body-explorer → mapa corporal interactivo del Resumen
 * - mission-analytics → Resumen (cada indicador abre su tendencia de misión con línea base y límites) */
const SECTION_REDIRECTS = {
  "body-explorer": "mission-control",
  "mission-analytics": "mission-control",
  // El módulo Mensajes se retiró (issue #15): el canal con Tierra pasa a ser una recomendación futura
  "communication-center": "recommendations",
  // El cuestionario de bienestar psicológico vive en Bienestar → Cuestionarios (se abre esa pestaña)
  "wellness-center": "wellbeing-hub",
  // Check-in emocional y Evaluación cognitiva son pestañas de Bienestar (issue #26): sus ids antiguos
  // (contramedidas, cuestionarios, alertas) abren Bienestar en esa pestaña
  "emotional-center": "wellbeing-hub",
  "cognitive-center": "wellbeing-hub",
};

/* Pestaña de Bienestar que abre cada id antiguo redirigido */
const WELLBEING_TAB_OF = {
  "wellness-center": "checks",
  "emotional-center": "emotional",
  "cognitive-center": "cognitive",
};

/* Escribe texto en un elemento solo si existe (el antiguo encabezado hdr-* ya no está en el HTML) */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* Refleja el tema actual en el botón "Contraste" (aria-pressed) */
function syncThemeButton() {
  const btn = document.getElementById("btn-quick-theme");
  if (btn) {
    btn.setAttribute("aria-pressed", String(document.body.getAttribute("data-theme") === "high-contrast"));
  }
}

/* Menú desplegable "Más" (patrón disclosure) */
function setMoreMenu(open, { focusButton = false } = {}) {
  const btn = document.getElementById("av-more-btn");
  const menu = document.getElementById("av-more-menu");
  if (!btn || !menu) return;
  btn.setAttribute("aria-expanded", String(open));
  menu.hidden = !open;
  if (!open && focusButton) btn.focus();
}

/* Secciones sin entrada propia en la navegación que cuelgan de una pestaña: se marca la pestaña madre.
 * (Evaluación cognitiva y Check-in emocional ya redirigen a sus pestañas de Bienestar; se dejan por si acaso.) */
const NAV_PARENT = {
  "cognitive-center": "wellbeing-hub",
  "emotional-center": "wellbeing-hub",
};

/* Pestaña activa: clase .active + aria-current="page"; el botón "Más" se marca si la sección está en su lista */
function syncNavigationState(sectionId) {
  let inMore = false;
  const navId = NAV_PARENT[sectionId] || sectionId;
  document.querySelectorAll("[data-nav-section]").forEach((btn) => {
    const on = btn.getAttribute("data-nav-section") === navId;
    btn.classList.toggle("active", on);
    if (on) {
      btn.setAttribute("aria-current", "page");
      if (btn.closest("#av-more-menu")) inMore = true;
    } else {
      btn.removeAttribute("aria-current");
    }
  });
  document.getElementById("av-more-btn")?.classList.toggle("av-more-current", inMore);

  // En móvil la fila de pestañas se desplaza en horizontal: lleva la pestaña activa a la vista
  const tabs = document.getElementById("av-global-tabs");
  const active = tabs?.querySelector('[aria-current="page"]');
  if (tabs && active && tabs.scrollWidth > tabs.clientWidth) {
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < tabs.scrollLeft || right > tabs.scrollLeft + tabs.clientWidth) {
      tabs.scrollLeft = Math.max(0, left - 16);
    }
  }
}

/* =========================================================================
   AUTHENTICATION & INITIALIZATION
   ========================================================================= */

/* Sin pantalla de acceso: la consola abre sola una sesión con la cuenta demo (datos SIMULADOS del seed
 * del backend, backend/app/core/config.py → DEMO_ASTRONAUT1_*). La API sigue exigiendo token Bearer + CSRF,
 * así que se hace un /auth/login silencioso. Sustituir antes de cualquier despliegue real. */
const DEMO_SESSION = { email: "elena.rostova@semsa.demo", password: "AstroCrew!2026" };
const REAUTH_COOLDOWN_MS = 15000; // evita bucles si el backend devuelve 401 de forma persistente
let autoLoginInFlight = null;
let lastReauthAt = 0;

/* Login silencioso con la cuenta demo; las llamadas concurrentes comparten la misma promesa. */
function autoLogin() {
  if (!autoLoginInFlight) {
    autoLoginInFlight = apiService
      .login(DEMO_SESSION.email, DEMO_SESSION.password)
      .then((res) => {
        apiService.setSession(res.access_token, res.csrf_token);
        return res.user;
      })
      .finally(() => {
        autoLoginInFlight = null;
      });
  }
  return autoLoginInFlight;
}

/* Reutiliza la sesión guardada si sigue siendo válida; si no, auto-login. */
async function startSession() {
  if (apiService.getToken()) {
    try {
      const me = await apiService.getMe();
      if (me?.user) return me.user;
    } catch {
      // token caducado o inválido (api.js ya limpió la sesión): se abre una nueva
    }
  }
  return autoLogin();
}

/* 401 a mitad de uso: se renueva la sesión en silencio y se repinta la sección; nunca hay formulario. */
async function reauthenticate() {
  if (!appState.currentUser) return; // durante el arranque ya se encarga initApp
  const now = Date.now();
  if (autoLoginInFlight || now - lastReauthAt < REAUTH_COOLDOWN_MS) return;
  lastReauthAt = now;
  try {
    const user = await autoLogin();
    appState.currentUser = user;
    apiService.setQueueOwner(user?.id);
    showToast(tr(DICT).sessionRenewed);
    await navigateToSection(appState.currentSection);
  } catch (err) {
    showToast(`${tr(DICT).sessionLost} ${bt(err.message) || ""}`.trim(), "error");
  }
}

/* Error de arranque no bloqueante: el encabezado sigue visible y se ofrece reintentar. */
function renderBootError(err) {
  const container = document.getElementById("section-view-container");
  if (!container) return;
  container.innerHTML = `
    <div class="av-console"><div class="av-grid"><section class="av-panel av-col-b" style="padding:16px;display:flex;flex-direction:column;gap:8px">
      <h2 class="av-h2">${escapeHtml(tr(DICT).sessionLost)}</h2>
      <p style="margin:0" role="alert">${escapeHtml(bt(err?.message) || "")}</p>
      <div><button type="button" class="av-btn" id="btn-session-retry">${escapeHtml(tr(DICT).retry)}</button></div>
    </section></div></div>`;
  document.getElementById("btn-session-retry")?.addEventListener("click", bootSession);
}

async function bootSession() {
  try {
    const user = await startSession();
    await onAuthenticated(user);
  } catch (err) {
    renderBootError(err);
  }
}

async function initApp() {
  initI18n();
  bindStaticEvents();
  bindLanguageChange();
  window.addEventListener("semsa:unauthorized", reauthenticate);
  await bootSession();
}

async function onAuthenticated(user) {
  appState.currentUser = user;
  apiService.setQueueOwner(user?.id); // la cola sin enlace es por persona usuaria
  document.body.setAttribute("data-theme", user.preferred_theme || "space-dark");

  const [indRes, envRes, simRes, usersRes, missionsRes] = await Promise.all([
    apiService.getHealthIndicators(),
    apiService.getEnvironmentProfiles(),
    apiService.getSimulatorScenarios(),
    apiService.getUsers(),
    apiService.getMissions(),
  ]);

  appState.indicatorsCatalog = indRes.indicators || [];
  appState.envProfiles = envRes.profiles || [];
  appState.simulatorScenarios = simRes.scenarios || [];
  appState.usersList = usersRes.users || [];
  appState.missionsList = missionsRes.missions || [];

  const astronauts = appState.usersList.filter((u) => u.role_code === "ASTRONAUT");
  if (user.role_code === "ASTRONAUT") {
    appState.selectedAstronautId = user.id;
  } else if (astronauts.length > 0) {
    appState.selectedAstronautId = astronauts[0].id;
  }

  if (appState.missionsList.length > 0) {
    appState.selectedMissionId = appState.missionsList[0].id;
  }

  updateRoleNavigation();
  syncThemeButton();
  // Encabezado global: delegación de eventos (una sola vez) + barra HERA; luego datos y barras
  initChrome(appState, appHelpers);
  startHera(navigateToSection);
  await refreshGlobalHeaderAndSummary();
  await navigateToSection(appState.currentSection);
}

function updateRoleNavigation() {
  const role = appState.currentUser?.role_code || "ASTRONAUT";
  document.querySelectorAll("[data-nav-section]").forEach((btn) => {
    const sec = btn.getAttribute("data-nav-section");
    if (sec === "administration" && role !== "ADMINISTRATOR") {
      btn.classList.add("hidden");
    } else if (sec === "crew-monitoring" && role === "ASTRONAUT") {
      btn.classList.add("hidden");
    } else if (sec === "predictions" && role !== "ASTRONAUT") {
      // El endpoint de predicciones solo responde a astronautas con asignación activa (403 al resto)
      btn.classList.add("hidden");
    } else {
      btn.classList.remove("hidden");
    }
  });

  const crewSelectorWrap = document.getElementById("topbar-crew-selector-wrap");
  const crewSelect = document.getElementById("topbar-crew-select");
  if (role === "ASTRONAUT") {
    crewSelectorWrap.classList.add("hidden");
  } else {
    crewSelectorWrap.classList.remove("hidden");
    const astronauts = appState.usersList.filter((u) => u.role_code === "ASTRONAUT");
    crewSelect.innerHTML = astronauts
      .map(
        (a) =>
          `<option value="${a.id}" ${a.id === Number(appState.selectedAstronautId) ? "selected" : ""}>${a.full_name} (${a.crew_code})</option>`
      )
      .join("");
  }
}

async function refreshGlobalHeaderAndSummary() {
  if (!appState.selectedAstronautId) {
    renderChrome(appState);
    return;
  }
  const summary = await apiService.getHealthSummary(
    appState.selectedAstronautId,
    appState.selectedMissionId
  );
  appState.healthSummary = summary;

  // Antiguo encabezado hdr-* (ya no está en el HTML; setText ignora los ids ausentes)
  setText("hdr-mission-name", `${summary.mission.code} — ${bt(summary.mission.name)}`);
  setText("hdr-user-badge", `${appState.currentUser.full_name} [${appState.currentUser.role_code}]`);
  setText("hdr-system-clock", formatDateUTC(summary.system_time_utc));
  setText(
    "hdr-mission-elapsed",
    summary.mission.elapsed_days !== null
      ? `Día ${summary.mission.elapsed_days} / ${summary.mission.planned_duration_days || "?"} d`
      : "Sin datos"
  );
  setText("hdr-phase", summary.mission.current_phase || "Sin datos");
  setText("hdr-environment", `${bt(summary.context.environment_name)} (${summary.context.determination_source})`);

  const queueLen = apiService.getOfflineQueue().length;
  const connText = apiService.simulatedOfflineMode
    ? `MODO OFFLINE (${queueLen} pendientes)`
    : `${summary.context.connectivity_status} | Cobertura ${summary.mission_summary.data_quality_coverage_percent}%`;
  setText("hdr-connectivity", connText);

  // Alert badge count
  const alertCount = summary.mission_summary.active_alerts_count;
  document.querySelectorAll(".js-alert-badge").forEach((el) => {
    el.textContent = alertCount;
    el.classList.toggle("hidden", alertCount === 0);
  });

  // Insignia del check-in emocional (pestaña Bienestar)
  if (summary.expansion_cards) {
    const emoObj =
      summary.expansion_cards.emotional_check_in ||
      summary.expansion_cards.emotional_checkin_card ||
      {};
    const pendingEmo = emoObj.pending_requests_count || 0;
    document.querySelectorAll(".js-emo-badge").forEach((el) => {
      el.textContent = pendingEmo;
      el.classList.toggle("hidden", pendingEmo === 0);
    });
  }

  // Datos compartidos de la consola (alertas, sueño, radiación…) en caché + barras de estado y alarma
  try {
    await refreshConsoleData(appState);
  } catch {
    // la barra se pinta con los datos disponibles
  }
  renderChrome(appState);
}

async function navigateToSection(sectionId) {
  if (WELLBEING_TAB_OF[sectionId]) openWellbeingSub(WELLBEING_TAB_OF[sectionId]);
  sectionId = SECTION_REDIRECTS[sectionId] || sectionId;
  appState.currentSection = sectionId;
  document.body.classList.toggle(
    "av-console-on",
    sectionId === "mission-control" || sectionId === "radiation"
  );
  setMoreMenu(false);
  syncNavigationState(sectionId);

  const container = document.getElementById("section-view-container");
  container.innerHTML = `<div class="av-console"><div class="av-sub" style="padding:24px" role="status">${escapeHtml(tr(DICT).loading)}</div></div>`;

  const expansionHelpers = appHelpers;

  try {
    if (sectionId === "mission-control") {
      // Resumen (o el detalle de indicador si se abrió desde la barra de alarma)
      await renderConsole(container, appState, expansionHelpers);
    } else if (sectionId === "radiation") {
      await renderConsole(container, appState, expansionHelpers, { view: "radiation" });
    } else if (sectionId === "environments") {
      await renderEnvironmentsView(container, appState, expansionHelpers);
    } else if (sectionId === "wellbeing-hub") {
      await renderWellbeingView(container, appState, expansionHelpers);
    } else if (sectionId === "my-health-check") {
      await renderMeasureView(container, appState, expansionHelpers);
    } else if (sectionId === "cognitive-center") {
      await renderCognitiveView(container, appState, expansionHelpers);
    } else if (sectionId === "emotional-center") {
      await renderEmotionalView(container, appState, expansionHelpers);
    } else if (sectionId === "daily-missions") {
      await renderCountermeasuresView(container, appState, expansionHelpers);
    } else if (sectionId === "alerts-center") {
      await renderAlertsView(container, appState, expansionHelpers);
    } else if (sectionId === "crew-monitoring") {
      await renderCrewView(container, appState, expansionHelpers);
    } else if (sectionId === "reports") {
      await renderLogbookView(container, appState, expansionHelpers);
    } else if (sectionId === "predictions") {
      await renderPredictions(container, appState, expansionHelpers);
    } else if (sectionId === "administration") {
      await renderAdminView(container, appState, expansionHelpers);
    } else if (sectionId === "settings-help") {
      await renderSettingsView(container, appState, expansionHelpers);
    } else if (sectionId === "recommendations") {
      await renderRecommendationsView(container, appState, expansionHelpers);
    }
  } catch (err) {
    container.innerHTML = `
      <div class="av-console"><div class="av-grid"><section class="av-panel av-col-b" style="padding:16px;display:flex;flex-direction:column;gap:8px">
        <h2 class="av-h2">${escapeHtml(tr(DICT).sectionError)}</h2>
        <p style="margin:0" role="alert">${escapeHtml(bt(err.message))}</p>
      </section></div></div>`;
  }
}

/* =========================================================================
   STATIC EVENT BINDINGS
   ========================================================================= */

function bindStaticEvents() {
  // Pestañas globales y elementos del menú "Más" (marcado estático en index.html)
  document.querySelectorAll("[data-nav-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // al elegir una sección del menú "Más", se cierra y el foco vuelve al botón
      if (btn.closest("#av-more-menu")) setMoreMenu(false, { focusButton: true });
      navigateToSection(btn.getAttribute("data-nav-section"));
    });
  });

  // Menú "Más": abre/cierra; se cierra con Escape, clic fuera o al salir el foco
  const moreWrap = document.getElementById("av-more");
  const moreBtn = document.getElementById("av-more-btn");
  if (moreWrap && moreBtn) {
    moreBtn.addEventListener("click", () => {
      setMoreMenu(moreBtn.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || moreBtn.getAttribute("aria-expanded") !== "true") return;
      setMoreMenu(false, { focusButton: moreWrap.contains(document.activeElement) });
    });
    document.addEventListener("click", (e) => {
      if (moreBtn.getAttribute("aria-expanded") === "true" && !moreWrap.contains(e.target)) {
        setMoreMenu(false);
      }
    });
    moreWrap.addEventListener("focusout", (e) => {
      if (e.relatedTarget && !moreWrap.contains(e.relatedTarget)) setMoreMenu(false);
    });
  }

  // Topbar Crew Selector (for Leader & Admin)
  document.getElementById("topbar-crew-select")?.addEventListener("change", async (e) => {
    appState.selectedAstronautId = Number(e.target.value);
    await refreshGlobalHeaderAndSummary();
    await navigateToSection(appState.currentSection);
  });

  // Theme quick toggle
  document.getElementById("btn-quick-theme")?.addEventListener("click", () => {
    const cur = document.body.getAttribute("data-theme") || "space-dark";
    const next = cur === "space-dark" ? "high-contrast" : "space-dark";
    document.body.setAttribute("data-theme", next);
    syncThemeButton();
  });

}

/* Cambio de idioma (i18n.js ya aplicó los textos estáticos de index.html):
 * se vuelven a pintar el encabezado global y la sección abierta, y se reaplica la navegación por rol. */
function bindLanguageChange() {
  onLangChange(() => {
    if (!appState.currentUser) return; // sesión aún sin abrir: solo textos estáticos
    updateRoleNavigation();
    renderChrome(appState);
    syncNavigationState(appState.currentSection);
    navigateToSection(appState.currentSection);
  });
}

window.addEventListener("DOMContentLoaded", initApp);

