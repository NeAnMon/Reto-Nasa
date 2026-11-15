/* SEMSA · Consola · vista "Monitoreo de tripulación" (sustituye al antiguo Crew Monitoring)
 *
 * Supervisión en tierra (MISSION_LEADER y ADMINISTRATOR): una tarjeta por tripulante autorizado con
 * su contexto, el resumen de indicadores y la señal operativa de bienestar. "Inspeccionar" cambia
 * el tripulante seleccionado y abre su Resumen.
 *
 * Privacidad: de bienestar solo se muestra la señal operativa; las respuestas del cuestionario
 * no llegan a esta vista. La API devuelve únicamente los tripulantes de las misiones autorizadas.
 */
import { apiService } from "../../services/api.js";
import { tr, fmt as fmtT } from "../../i18n/i18n.js";
import { bt } from "/src/i18n/backend.js";
import {
  esc, stateTag, tag, errMsg, ensureCss, loadingHTML, errorHTML, noAccessHTML, bindRetry, makeStale, roleOf,
} from "./more-common.js";

const DICT = {
  es: {
    title: "Monitoreo de tripulación",
    loading: "Cargando tripulación…",
    loadError: "No se pudo cargar la tripulación",
    noAccess: "El monitoreo de tripulación es una vista de supervisión para el líder en tierra y administración.",
    sub: "Solo se muestran los tripulantes de tus misiones autorizadas. Las respuestas psicológicas privadas están protegidas.",
    authorized: "Tripulantes autorizados: {n}",
    empty: "No hay tripulantes asignados a tus misiones autorizadas.",
    environment: "Entorno",
    phase: "Fase",
    normal: "Indicadores nominales",
    monitoring: "En seguimiento",
    alerts: "Alertas activas",
    routines: "Contramedidas de hoy",
    wellness: "Señal operativa de bienestar",
    wellnessNone: "Sin registros",
    wellnessPrivate: "Respuestas del cuestionario ocultas por política de privacidad.",
    inspect: "Inspeccionar",
    inspectAria: "Inspeccionar telemetría y alertas de {name}",
    selected: "Seleccionado",
    unavailable: "No se pudo leer el resumen de {n} tripulante(s).",
    noData: "—",
  },
  en: {
    title: "Crew monitoring",
    loading: "Loading crew…",
    loadError: "Couldn't load the crew",
    noAccess: "Crew monitoring is a supervision view for the ground leader and administration.",
    sub: "Only crew members from your authorized missions are shown. Private psychological answers are protected.",
    authorized: "Authorized crew members: {n}",
    empty: "No crew members are assigned to your authorized missions.",
    environment: "Environment",
    phase: "Phase",
    normal: "Nominal indicators",
    monitoring: "Under follow-up",
    alerts: "Active alerts",
    routines: "Today's countermeasures",
    wellness: "Operational wellbeing signal",
    wellnessNone: "No records",
    wellnessPrivate: "Questionnaire answers hidden by privacy policy.",
    inspect: "Inspect",
    inspectAria: "Inspect telemetry and alerts for {name}",
    selected: "Selected",
    unavailable: "Couldn't read the summary for {n} crew member(s).",
    noData: "—",
  },
};

export async function renderCrewView(container, appState, helpers) {
  const T = tr(DICT);
  ensureCss();
  if (roleOf(appState) === "ASTRONAUT") {
    container.innerHTML = noAccessHTML("av-cr-root", T.noAccess);
    return;
  }
  const stale = makeStale(appState);
  const again = () => renderCrewView(container, appState, helpers);
  if (!container.querySelector(".av-cr-root")) container.innerHTML = loadingHTML("av-cr-root", T.loading);

  const astronauts = (appState.usersList || []).filter((u) => u.role_code === "ASTRONAUT");
  let rows;
  try {
    rows = await Promise.all(
      astronauts.map(async (a) => {
        try {
          const [summary, w] = await Promise.all([apiService.getHealthSummary(a.id), apiService.getWellnessAssessments(a.id).catch(() => null)]);
          return { astronaut: a, summary, wellness: w?.assessments?.[0] || null };
        } catch {
          return null;
        }
      })
    );
  } catch (err) {
    if (stale()) return;
    container.innerHTML = errorHTML("av-cr-root", T.loadError, errMsg(err));
    bindRetry(container, again);
    return;
  }
  if (stale()) return;

  const valid = rows.filter(Boolean);
  const failed = rows.length - valid.length;

  const cards = valid
    .map(({ astronaut: a, summary: s, wellness }) => {
      const ms = s.mission_summary || {};
      const current = Number(a.id) === Number(appState.selectedAstronautId);
      return `<article class="av-panel av-card ${current ? "av-mx-card-active" : ""}">
        <div class="av-card-head">
          <h3 class="av-h3">${esc(a.full_name)} <span class="av-sub av-mono">${esc(a.crew_code)}</span></h3>
          <span class="av-mx-btns">${current ? tag(T.selected, true) : ""}${tag(s.mission?.code || T.noData)}</span>
        </div>
        <span class="av-sub">${T.environment}: <strong>${esc(bt(s.context?.environment_name) || T.noData)}</strong> · ${T.phase}: <strong>${esc(bt(s.mission?.current_phase) || T.noData)}</strong></span>
        <dl class="av-mx-kv">
          <dt>${T.normal}</dt><dd>${esc(ms.indicators_normal ?? T.noData)}</dd>
          <dt>${T.monitoring}</dt><dd>${esc(ms.indicators_monitoring ?? T.noData)}</dd>
          <dt>${T.alerts}</dt><dd>${esc(ms.active_alerts_count ?? T.noData)}</dd>
          <dt>${T.routines}</dt><dd>${esc(ms.routines_completed_today ?? T.noData)}/${esc(ms.routines_total_available ?? T.noData)}</dd>
        </dl>
        <div class="av-foot">
          <div class="av-mx-row"><span>${T.wellness}</span>${wellness ? stateTag(wellness.operational_wellness_state) : `<span>${T.wellnessNone}</span>`}</div>
          <span>${T.wellnessPrivate}</span>
        </div>
        <button type="button" class="av-btn av-btn-sm av-btn-primary" data-cr-inspect="${esc(a.id)}" aria-label="${esc(fmtT(T.inspectAria, { name: a.full_name }))}">${T.inspect}</button>
      </article>`;
    })
    .join("");

  container.innerHTML = `
    <div class="av-console av-mx-root av-cr-root"><div class="av-grid"><div class="av-col-b">
      <section class="av-panel" aria-labelledby="av-cr-h">
        <div class="av-panel-head"><h2 class="av-h2" id="av-cr-h">${T.title}</h2><span class="av-sub">${fmtT(T.authorized, { n: valid.length })}</span></div>
        <div class="av-mx-banner">${T.sub}</div>
        ${failed ? `<div class="av-mx-banner" role="status">${fmtT(T.unavailable, { n: failed })}</div>` : ""}
        ${valid.length ? `<div class="av-mx-cards av-mx-pad">${cards}</div>` : `<p class="av-mx-empty">${T.empty}</p>`}
      </section>
    </div></div></div>`;

  container.querySelectorAll("[data-cr-inspect]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      appState.selectedAstronautId = Number(btn.getAttribute("data-cr-inspect"));
      const crewSelect = document.getElementById("topbar-crew-select");
      if (crewSelect) crewSelect.value = String(appState.selectedAstronautId);
      try {
        await helpers.refreshGlobalHeaderAndSummary?.();
      } catch {
        // el Resumen vuelve a pedir los datos
      }
      await helpers.navigateToSection?.("mission-control");
    });
  });
}
