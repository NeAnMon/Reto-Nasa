/* SEMSA · Consola · vista "Evaluación cognitiva" (sustituye al antiguo Cognitive Performance Center)
 *
 * - Actividades programadas, catálogo de dominios independientes y ejecución interactiva:
 *   verificación de disposición → ítems cronometrados (autoguardado por ítem) → percepción → resultado.
 * - Posponer nunca penaliza. No hay puntaje global único: el resultado es por dominio y no diagnóstico.
 * - Tendencia de precisión por dominio e historial de sesiones.
 *
 * El servidor registra la evaluación para el usuario autenticado: solo la propia persona astronauta
 * puede iniciar actividades; el resto de roles ve la vista en solo lectura.
 */
import { apiService } from "../../services/api.js";
import { tr, fmt as fmtT } from "../../i18n/i18n.js";
import { bt, btLines } from "/src/i18n/backend.js";
import {
  esc, tag, fmt, errMsg, ensureCss, loadingHTML, errorHTML, bindRetry, makeStale, isOwnAstronaut, lineChartSVG, langChanged,
} from "./more-common.js";

const DICT = {
  es: {
    title: "Evaluación cognitiva",
    loading: "Cargando evaluación cognitiva…",
    loadError: "No se pudo cargar la evaluación cognitiva",
    tagIndependent: "Dominios independientes",
    tagNoDx: "No diagnóstico",
    readOnly: "Vista de supervisión en solo lectura: solo la persona astronauta puede iniciar o posponer sus actividades cognitivas.",
    schedTitle: "Actividades programadas",
    schedPending: "Pendientes: {n}",
    schedEmpty: "No hay actividades programadas.",
    schedFor: "Programada",
    start: "Iniciar",
    startActivity: "Iniciar actividad",
    domainsTitle: "Dominios cognitivos",
    difficulty: "Nivel de dificultad",
    difficulties: { BASIC: "Básico", INTERMEDIATE: "Intermedio", ADVANCED: "Avanzado" },
    schedStatus: { PENDING: "Pendiente", COMPLETED: "Completada", POSTPONED: "Pospuesta", CANCELLED: "Cancelada", IN_PROGRESS: "En curso" },
    readiness: { READY: "Listo", FATIGUED: "Con fatiga", POST_EVA: "Tras operación exigente", POSTPONED: "Pospuesta" },
    objective: "Objetivo",
    badgeLbl: "Insignia asociada",
    seconds: "s",
    trendTitle: "Tendencia de precisión por dominio",
    trendDomain: "Dominio",
    trendAria: "Precisión por sesión en {name}, en porcentaje",
    trendAxis: "Eje horizontal: número de sesión · eje vertical: precisión (%)",
    historyTitle: "Historial de sesiones completadas",
    historyEmpty: "Sin sesiones completadas aún.",
    colDomain: "Dominio",
    colDiff: "Dificultad / versión",
    colAttempt: "Intento",
    colReady: "Condición previa",
    colAcc: "Precisión",
    colRt: "Tiempo medio",
    colBase: "Línea base comparable",
    colNote: "Efecto de práctica",
    colDate: "GMT",
    baseInSession: "Establecida en sesión",
    ms: "ms",
    // etapa 1
    step1: "Paso 1 · Disposición y condiciones",
    step1Sub: "Duración estimada: ~{sec} s. Puedes posponer la actividad sin penalización si tienes fatiga o estás en una operación crítica.",
    close: "Cerrar",
    instructions: "Instrucciones",
    example: "Ejemplo de práctica (sin puntaje)",
    exampleOptions: "Opciones",
    exampleAnswer: "Respuesta correcta",
    readyQ: "¿Estás en condiciones de realizar la actividad ahora?",
    readyOptions: {
      READY: "Con descanso y en condiciones de empezar",
      FATIGUED: "Con fatiga percibida (se registra el contexto)",
      POST_EVA: "Recién finalizada una operación exigente",
    },
    notes: "Notas de contexto o motivo para posponer (opcional)",
    notesPlaceholder: "Ej.: 6,5 h de sueño, iluminación nominal en cabina",
    begin: "Comenzar actividad",
    postpone: "Posponer (sin penalización)",
    postponeDefault: "Pospuesta por carga operativa o necesidad de descanso previo.",
    postponed: "Actividad cognitiva pospuesta sin penalización.",
    noTest: "No hay una prueba configurada para {code}.",
    opening: "Preparando la actividad…",
    actionError: "No se pudo completar la acción: {msg}",
    // ítems
    item: "Ítem {i} de {n}",
    progress: "Progreso",
    timer: "Se registra el tiempo de respuesta de cada ítem.",
    skip: "Omitir ítem",
    // cierre
    stepFinal: "Paso final · Percepción de dificultad",
    stepFinalSub: "Has respondido {n} ítems en {s} s. Registra tu percepción para dar contexto al resultado.",
    perceived: "Dificultad percibida (1–10)",
    feedback: "Comentario personal (opcional)",
    feedbackPlaceholder: "Ej.: mantuve la concentración durante la secuencia",
    finish: "Finalizar y ver resultado",
    done: "Actividad completada",
    tagNoGlobal: "Sin puntaje global único",
    kpiAcc: "Precisión ({c}/{n} aciertos)",
    kpiRt: "Tiempo medio de respuesta",
    kpiOm: "Omisiones",
    summary: "Resumen operativo",
    practice: "Efecto de práctica y comparabilidad",
    badges: "Insignias obtenidas",
    refresh: "Volver al tablero cognitivo",
    recorded: "Evaluación cognitiva ({code}) registrada.",
  },
  en: {
    title: "Cognitive assessment",
    loading: "Loading cognitive assessment…",
    loadError: "Couldn't load the cognitive assessment",
    tagIndependent: "Independent domains",
    tagNoDx: "Not a diagnosis",
    readOnly: "Read-only supervision view: only the astronaut can start or postpone their own cognitive activities.",
    schedTitle: "Scheduled activities",
    schedPending: "Pending: {n}",
    schedEmpty: "No scheduled activities.",
    schedFor: "Scheduled",
    start: "Start",
    startActivity: "Start activity",
    domainsTitle: "Cognitive domains",
    difficulty: "Difficulty level",
    difficulties: { BASIC: "Basic", INTERMEDIATE: "Intermediate", ADVANCED: "Advanced" },
    schedStatus: { PENDING: "Pending", COMPLETED: "Completed", POSTPONED: "Postponed", CANCELLED: "Cancelled", IN_PROGRESS: "In progress" },
    readiness: { READY: "Ready", FATIGUED: "Fatigued", POST_EVA: "After a demanding operation", POSTPONED: "Postponed" },
    objective: "Objective",
    badgeLbl: "Linked badge",
    seconds: "s",
    trendTitle: "Accuracy trend by domain",
    trendDomain: "Domain",
    trendAria: "Accuracy per session in {name}, as a percentage",
    trendAxis: "Horizontal axis: session number · vertical axis: accuracy (%)",
    historyTitle: "Completed session history",
    historyEmpty: "No completed sessions yet.",
    colDomain: "Domain",
    colDiff: "Difficulty / version",
    colAttempt: "Attempt",
    colReady: "Prior condition",
    colAcc: "Accuracy",
    colRt: "Mean time",
    colBase: "Comparable baseline",
    colNote: "Practice effect",
    colDate: "GMT",
    baseInSession: "Set in this session",
    ms: "ms",
    // etapa 1
    step1: "Step 1 · Readiness and conditions",
    step1Sub: "Estimated duration: ~{sec} s. You can postpone the activity with no penalty if you're fatigued or in a critical operation.",
    close: "Close",
    instructions: "Instructions",
    example: "Practice example (not scored)",
    exampleOptions: "Options",
    exampleAnswer: "Correct answer",
    readyQ: "Are you in a condition to do the activity now?",
    readyOptions: {
      READY: "Rested and ready to start",
      FATIGUED: "Feeling fatigued (context is recorded)",
      POST_EVA: "Just finished a demanding operation",
    },
    notes: "Context notes or reason to postpone (optional)",
    notesPlaceholder: "E.g.: 6.5 h of sleep, nominal cabin lighting",
    begin: "Begin activity",
    postpone: "Postpone (no penalty)",
    postponeDefault: "Postponed due to operational workload or a need to rest first.",
    postponed: "Cognitive activity postponed with no penalty.",
    noTest: "No test is configured for {code}.",
    opening: "Preparing the activity…",
    actionError: "Couldn't complete the action: {msg}",
    // ítems
    item: "Item {i} of {n}",
    progress: "Progress",
    timer: "Response time is recorded for each item.",
    skip: "Skip item",
    // cierre
    stepFinal: "Final step · Perceived difficulty",
    stepFinalSub: "You answered {n} item(s) in {s} s. Record how it felt to give the result some context.",
    perceived: "Perceived difficulty (1–10)",
    feedback: "Personal comment (optional)",
    feedbackPlaceholder: "E.g.: I stayed focused throughout the sequence",
    finish: "Finish and see result",
    done: "Activity completed",
    tagNoGlobal: "No single overall score",
    kpiAcc: "Accuracy ({c}/{n} correct)",
    kpiRt: "Mean response time",
    kpiOm: "Omissions",
    summary: "Operational summary",
    practice: "Practice effect and comparability",
    badges: "Badges earned",
    refresh: "Back to cognitive dashboard",
    recorded: "Cognitive assessment ({code}) recorded.",
  },
};

const ui = { difficulty: "INTERMEDIATE", chartDomain: null, lang: null };

export async function renderCognitiveView(container, appState, helpers) {
  const T = tr(DICT);
  ensureCss();
  const stale = makeStale(appState);
  const aid = appState.selectedAstronautId;
  const mid = appState.selectedMissionId;
  const again = () => renderCognitiveView(container, appState, helpers);
  // re-render por cambio de idioma: una actividad en curso (etapa visible) se conserva tal cual
  const keep = langChanged(ui, container.querySelector(".av-cg-root"));

  if (!container.querySelector(".av-cg-root")) container.innerHTML = loadingHTML("av-cg-root", T.loading);

  let domRes, histRes, schedRes, anaRes;
  try {
    [domRes, histRes, schedRes, anaRes] = await Promise.all([
      apiService.getCognitiveDomains(),
      apiService.getCognitiveHistory(aid),
      apiService.getCognitiveSchedules(aid, mid),
      apiService.getCognitiveAnalytics(aid, mid),
    ]);
  } catch (err) {
    if (stale()) return;
    container.innerHTML = errorHTML("av-cg-root", T.loadError, errMsg(err));
    bindRetry(container, again);
    return;
  }
  if (stale()) return;

  const domains = domRes.domains || [];
  const history = histRes.history || [];
  const schedules = schedRes.schedules || [];
  const canAct = isOwnAstronaut(appState);
  const nameOf = (code) => bt(domains.find((d) => d.code === code)?.name) || code;
  const diffLabel = (d) => tr(DICT).difficulties[d] || d;
  if (!ui.chartDomain || !domains.some((d) => d.code === ui.chartDomain)) ui.chartDomain = domains[0]?.code || null;

  const schedHTML = schedules.length
    ? `<ul class="av-mx-list">${schedules
        .map(
          (s) => `<li>
            <div class="av-mx-row">
              <span><strong>${esc(nameOf(s.domain_code))}</strong> <span class="av-sub">· ${esc(diffLabel(s.difficulty))}</span></span>
              <span class="av-mx-btns">
                ${tag(T.schedStatus[s.status] || s.status, s.status === "PENDING")}
                ${canAct && s.status === "PENDING" ? `<button type="button" class="av-btn av-btn-sm av-btn-primary" data-cg-start="${esc(s.domain_code)}" data-cg-diff="${esc(s.difficulty)}">${T.start}</button>` : ""}
              </span>
            </div>
            <span class="av-sub">${T.schedFor}: <span class="av-mono">${fmt(s.scheduled_for)}</span></span>
          </li>`
        )
        .join("")}</ul>`
    : `<p class="av-mx-empty">${T.schedEmpty}</p>`;

  const domainsHTML = `<div class="av-mx-cards av-mx-pad">${domains
    .map(
      (d) => `<article class="av-panel av-card av-cg-domain">
        <div class="av-card-head"><h3 class="av-h3">${esc(bt(d.name))}</h3><span class="av-mono av-sub">~${esc(d.estimated_duration_seconds)} ${T.seconds}</span></div>
        <p class="av-mx-p av-sub"><strong>${T.objective}:</strong> ${esc(bt(d.objective))}</p>
        <p class="av-mx-p av-sub">${T.badgeLbl}: <span class="av-mono">${esc(d.badge_code || "COGNITIVE_MISSION_COMPLETED")}</span></p>
        ${d.scientific_disclaimer ? `<p class="av-foot" style="margin:0">${esc(btLines(d.scientific_disclaimer))}</p>` : ""}
        ${canAct ? `<button type="button" class="av-btn av-btn-sm" data-cg-start="${esc(d.code)}">${T.startActivity}</button>` : ""}
      </article>`
    )
    .join("")}</div>`;

  const historyHTML = history.length
    ? `<div class="av-hscroll"><table class="av-table av-mx-table" style="min-width:920px">
        <thead><tr>
          <th scope="col">${T.colDomain}</th><th scope="col">${T.colDiff}</th><th scope="col">${T.colAttempt}</th><th scope="col">${T.colReady}</th>
          <th scope="col" class="av-mx-right">${T.colAcc}</th><th scope="col" class="av-mx-right">${T.colRt}</th><th scope="col">${T.colBase}</th><th scope="col">${T.colNote}</th><th scope="col">${T.colDate}</th>
        </tr></thead>
        <tbody>${history
          .slice()
          .reverse()
          .map(
            (h) => `<tr>
              <td><strong>${esc(nameOf(h.domain_code))}</strong></td>
              <td>${esc(diffLabel(h.difficulty))} · v${esc(h.version_number)}</td>
              <td class="av-mono">#${esc(h.attempt_number)}</td>
              <td>${esc(T.readiness[h.readiness_status] || h.readiness_status || "—")}</td>
              <td class="av-mono av-mx-right">${h.result ? `${esc(h.result.accuracy_percent)} %` : "—"}</td>
              <td class="av-mono av-mx-right av-mx-nowrap">${h.result ? `${esc(h.result.mean_response_time_ms)} ${T.ms}` : "—"}</td>
              <td class="av-mono">${h.comparable_baseline ? `${esc(h.comparable_baseline.baseline_accuracy_percent)} % / ${esc(h.comparable_baseline.baseline_mean_rt_ms)} ${T.ms}` : T.baseInSession}</td>
              <td class="av-sub">${esc(bt(h.result?.practice_effect_note) || "")}</td>
              <td class="av-mono av-mx-nowrap">${fmt(h.completed_at)}</td>
            </tr>`
          )
          .join("")}</tbody></table></div>`
    : `<p class="av-mx-empty">${T.historyEmpty}</p>`;

  const liveStage = keep ? container.querySelector(".av-cg-root #av-cg-stage:not([hidden])") : null;
  container.innerHTML = `
    <div class="av-console av-mx-root av-cg-root"><div class="av-grid"><div class="av-col-b">
      <section class="av-panel" aria-labelledby="av-cg-h">
        <div class="av-panel-head">
          <h2 class="av-h2" id="av-cg-h">${T.title}</h2>
          <span class="av-mx-btns">${tag(T.tagIndependent)} ${tag(T.tagNoDx)}</span>
        </div>
        ${domRes.scientific_integrity_notice ? `<div class="av-mx-banner">${esc(btLines(domRes.scientific_integrity_notice))}</div>` : ""}
        ${canAct ? "" : `<div class="av-mx-banner">${T.readOnly}</div>`}
      </section>

      <section class="av-panel av-cg-stage" id="av-cg-stage" aria-live="polite" hidden></section>

      <section class="av-panel" aria-labelledby="av-cg-sched-h">
        <div class="av-panel-head"><h2 class="av-h2" id="av-cg-sched-h">${T.schedTitle}</h2><span class="av-sub">${fmtT(T.schedPending, { n: schedules.filter((s) => s.status === "PENDING").length })}</span></div>
        ${schedHTML}
      </section>

      <section class="av-panel" aria-labelledby="av-cg-dom-h">
        <div class="av-panel-head">
          <h2 class="av-h2" id="av-cg-dom-h">${T.domainsTitle} <span class="av-sub av-mono">${domains.length}</span></h2>
          ${
            canAct
              ? `<div class="av-field" style="flex-direction:row;align-items:center;gap:8px">
                  <label for="av-cg-diff">${T.difficulty}</label>
                  <select class="av-input" id="av-cg-diff" style="width:auto">
                    ${Object.entries(T.difficulties).map(([v, l]) => `<option value="${v}" ${v === ui.difficulty ? "selected" : ""}>${l}</option>`).join("")}
                  </select>
                </div>`
              : ""
          }
        </div>
        ${domainsHTML}
      </section>

      <section class="av-panel" aria-labelledby="av-cg-trend-h">
        <div class="av-panel-head">
          <h2 class="av-h2" id="av-cg-trend-h">${T.trendTitle}</h2>
          <div class="av-field" style="flex-direction:row;align-items:center;gap:8px">
            <label for="av-cg-chart-dom">${T.trendDomain}</label>
            <select class="av-input" id="av-cg-chart-dom" style="width:auto">
              ${domains.map((d) => `<option value="${esc(d.code)}" ${d.code === ui.chartDomain ? "selected" : ""}>${esc(bt(d.name))}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="av-mx-pad">
          <div id="av-cg-chart"></div>
          <span class="av-sub">${T.trendAxis}</span>
          ${anaRes.methodology_disclaimer ? `<p class="av-mx-note">${esc(btLines(anaRes.methodology_disclaimer))}</p>` : ""}
        </div>
      </section>

      <section class="av-panel" aria-labelledby="av-cg-hist-h">
        <div class="av-panel-head"><h2 class="av-h2" id="av-cg-hist-h">${T.historyTitle}</h2><span class="av-sub av-mono">${history.length}</span></div>
        ${historyHTML}
      </section>
    </div></div></div>`;

  const root = container.querySelector(".av-cg-root");
  if (liveStage) root.querySelector("#av-cg-stage").replaceWith(liveStage);
  const ctx = { container, root, appState, helpers, again, nameOf, diffLabel, stage: root.querySelector("#av-cg-stage") };

  const drawChart = () => {
    const pts = (anaRes.domains_series && anaRes.domains_series[ui.chartDomain]) || [];
    root.querySelector("#av-cg-chart").innerHTML = lineChartSVG(
      pts.map((p) => p.accuracy_percent),
      { min: 0, max: 100, ariaLabel: fmtT(tr(DICT).trendAria, { name: nameOf(ui.chartDomain) }) }
    );
  };
  root.querySelector("#av-cg-chart-dom")?.addEventListener("change", (e) => {
    ui.chartDomain = e.target.value;
    drawChart();
  });
  if (ui.chartDomain) drawChart();

  root.querySelector("#av-cg-diff")?.addEventListener("change", (e) => {
    ui.difficulty = e.target.value;
  });
  root.querySelectorAll("[data-cg-start]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openReadiness(ctx, btn.getAttribute("data-cg-start"), btn.getAttribute("data-cg-diff") || ui.difficulty);
    });
  });
}

/* Muestra la etapa, la lleva a la vista y pone el foco en su título */
function showStage(ctx, html) {
  const { stage } = ctx;
  stage.hidden = false;
  stage.innerHTML = html;
  const h = stage.querySelector("[data-cg-focus]");
  if (h) h.focus({ preventScroll: true });
  stage.scrollIntoView({ behavior: "smooth", block: "start" });
}
function stageError(ctx, err) {
  const T = tr(DICT);
  const p = ctx.stage.querySelector("[data-cg-err]");
  if (p) p.textContent = fmtT(T.actionError, { msg: errMsg(err) });
  else showStage(ctx, `<div class="av-mx-pad"><p class="av-mx-p" role="alert">${esc(fmtT(T.actionError, { msg: errMsg(err) }))}</p><div><button type="button" class="av-btn" data-cg-close>${T.close}</button></div></div>`);
  ctx.stage.querySelectorAll("button").forEach((b) => (b.disabled = false));
  ctx.stage.querySelector("[data-cg-close]")?.addEventListener("click", () => (ctx.stage.hidden = true));
}
const lock = (ctx) => ctx.stage.querySelectorAll("button").forEach((b) => (b.disabled = true));

async function openReadiness(ctx, domainCode, difficulty) {
  const T = tr(DICT);
  const { appState, helpers } = ctx;
  showStage(ctx, `<div class="av-sub" style="padding:16px" role="status">${T.opening}</div>`);

  let testMeta;
  try {
    const testsRes = await apiService.getCognitiveTests(domainCode);
    testMeta = testsRes.tests?.[0];
  } catch (err) {
    stageError(ctx, err);
    return;
  }
  if (!testMeta) {
    showStage(ctx, `<div class="av-mx-pad"><p class="av-mx-p">${esc(fmtT(T.noTest, { code: ctx.nameOf(domainCode) }))}</p><div><button type="button" class="av-btn" data-cg-close>${T.close}</button></div></div>`);
    ctx.stage.querySelector("[data-cg-close]").addEventListener("click", () => (ctx.stage.hidden = true));
    return;
  }

  const ex = testMeta.practice_example;
  showStage(
    ctx,
    `<div class="av-panel-head">
      <div>
        <span class="av-lbl">${T.step1}</span>
        <h2 class="av-h2" tabindex="-1" data-cg-focus>${esc(bt(testMeta.title))} · ${esc(ctx.diffLabel(difficulty))}</h2>
      </div>
      <button type="button" class="av-btn av-btn-sm" data-cg-close>${T.close}</button>
    </div>
    <div class="av-mx-pad">
      <p class="av-mx-p av-sub">${esc(fmtT(T.step1Sub, { sec: testMeta.estimated_duration_seconds }))}</p>
      <div>
        <h3 class="av-h3">${T.instructions}</h3>
        <p class="av-mx-p">${esc(btLines(testMeta.instructions))}</p>
      </div>
      ${
        ex && ex.prompt
          ? `<div class="av-cg-example">
              <span class="av-lbl">${T.example}</span>
              <span>${esc(bt(ex.prompt))}</span>
              <span class="av-sub">${T.exampleOptions}: ${(ex.options || []).map((o) => esc(bt(o))).join(" · ")}</span>
              <span><strong>${T.exampleAnswer}:</strong> ${esc(bt(ex.correct))}</span>
            </div>`
          : ""
      }
      <div class="av-form-grid av-mx-wide">
        <div class="av-field">
          <label for="av-cg-ready">${T.readyQ}</label>
          <select class="av-input" id="av-cg-ready">
            ${Object.entries(T.readyOptions).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}
          </select>
        </div>
        <div class="av-field">
          <label for="av-cg-notes">${T.notes}</label>
          <input class="av-input" type="text" id="av-cg-notes" placeholder="${esc(T.notesPlaceholder)}" />
        </div>
      </div>
      <div class="av-mx-btns">
        <button type="button" class="av-btn av-btn-primary" data-cg-begin>${T.begin}</button>
        <button type="button" class="av-btn" data-cg-postpone>${T.postpone}</button>
      </div>
      <p class="av-mx-status" role="alert" data-cg-err></p>
    </div>`
  );

  const { stage } = ctx;
  stage.querySelector("[data-cg-close]").addEventListener("click", () => (stage.hidden = true));

  stage.querySelector("[data-cg-postpone]").addEventListener("click", async () => {
    const reason = stage.querySelector("#av-cg-notes").value.trim() || T.postponeDefault;
    lock(ctx);
    try {
      const startRes = await apiService.startCognitiveAssessment({
        mission_id: appState.selectedMissionId,
        domain_code: domainCode,
        test_code: testMeta.code,
        difficulty,
        readiness_status: "POSTPONED",
        postpone_reason: reason,
        is_simulated: true,
      });
      await apiService.postponeCognitiveAssessment(startRes.assessment.id, reason);
      helpers.showToast?.(T.postponed);
      await ctx.again();
    } catch (err) {
      stageError(ctx, err);
    }
  });

  stage.querySelector("[data-cg-begin]").addEventListener("click", async () => {
    const readiness = stage.querySelector("#av-cg-ready").value;
    const notes = stage.querySelector("#av-cg-notes").value;
    lock(ctx);
    try {
      const startRes = await apiService.startCognitiveAssessment({
        mission_id: appState.selectedMissionId,
        domain_code: domainCode,
        test_code: testMeta.code,
        difficulty,
        readiness_status: readiness,
        conditions_notes: notes,
        is_simulated: true,
      });
      runTasks(ctx, startRes.assessment, startRes.test);
    } catch (err) {
      stageError(ctx, err);
    }
  });
}

function runTasks(ctx, assessment, testObj) {
  const { helpers, stage } = ctx;
  const tasks = testObj.tasks || [];
  let idx = 0;
  let answered = 0;
  const sessionStart = performance.now();
  let stepStart = performance.now();

  const renderStep = () => {
    const T = tr(DICT);
    if (idx >= tasks.length) {
      renderFinal();
      return;
    }
    const tk = tasks[idx];
    const pct = Math.round(((idx + 1) / tasks.length) * 100);
    showStage(
      ctx,
      `<div class="av-panel-head">
        <div>
          <span class="av-lbl">${esc(ctx.nameOf(assessment.domain_code))} · ${esc(ctx.diffLabel(assessment.difficulty))}</span>
          <h2 class="av-h2" tabindex="-1" data-cg-focus>${esc(bt(testObj.title))} · ${fmtT(T.item, { i: idx + 1, n: tasks.length })}</h2>
        </div>
        <span class="av-sub">${T.progress}: <span class="av-mono">${pct} %</span></span>
      </div>
      <div class="av-mx-pad">
        <div class="av-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${T.progress}"><span style="width:${pct}%"></span></div>
        <p class="av-cg-prompt">${esc(bt(tk.prompt_text))}</p>
        <div class="av-cg-options">
          ${(tk.options || []).map((opt, i) => `<button type="button" class="av-btn av-cg-opt" data-cg-opt="${i}">${esc(bt(opt))}</button>`).join("")}
        </div>
        <div class="av-mx-row">
          <span class="av-sub">${T.timer}</span>
          <button type="button" class="av-btn av-btn-sm" data-cg-skip>${T.skip}</button>
        </div>
        <p class="av-mx-status" role="alert" data-cg-err></p>
      </div>`
    );
    stepStart = performance.now();

    const record = async (selectedAnswer, isOmission) => {
      const rtMs = Math.max(120, Math.round(performance.now() - stepStart));
      const isCorrect = !isOmission && String(selectedAnswer).trim() === String(tk.correct_answer_key).trim();
      lock(ctx);
      try {
        await apiService.submitCognitiveResponses(assessment.id, {
          responses: [
            {
              task_index: tk.task_index,
              selected_answer: selectedAnswer,
              is_correct: isCorrect,
              is_omission: isOmission,
              response_time_ms: rtMs,
              moves_or_actions_count: 1,
            },
          ],
          current_step_index: idx + 1,
          autosave_state: { completed_Count: answered + 1 },
        });
        answered += 1;
        idx += 1;
        renderStep();
      } catch (err) {
        stageError(ctx, err);
      }
    };

    stage.querySelectorAll("[data-cg-opt]").forEach((btn) => {
      btn.addEventListener("click", () => record((tk.options || [])[Number(btn.getAttribute("data-cg-opt"))], false));
    });
    stage.querySelector("[data-cg-skip]").addEventListener("click", () => record("OMITTED", true));
  };

  const renderFinal = () => {
    const T = tr(DICT);
    const totalSec = Math.max(1.0, Math.round((performance.now() - sessionStart) / 100) / 10);
    showStage(
      ctx,
      `<div class="av-panel-head"><h2 class="av-h2" tabindex="-1" data-cg-focus>${T.stepFinal}</h2></div>
      <div class="av-mx-pad">
        <p class="av-mx-p av-sub">${esc(fmtT(T.stepFinalSub, { n: tasks.length, s: totalSec }))}</p>
        <div class="av-form-grid av-mx-wide">
          <div class="av-field">
            <label for="av-cg-perceived">${T.perceived}</label>
            <input class="av-input" type="number" inputmode="numeric" id="av-cg-perceived" min="1" max="10" value="4" />
          </div>
          <div class="av-field">
            <label for="av-cg-feedback">${T.feedback}</label>
            <input class="av-input" type="text" id="av-cg-feedback" placeholder="${esc(T.feedbackPlaceholder)}" />
          </div>
        </div>
        <div><button type="button" class="av-btn av-btn-primary" data-cg-finish>${T.finish}</button></div>
        <p class="av-mx-status" role="alert" data-cg-err></p>
      </div>`
    );

    stage.querySelector("[data-cg-finish]").addEventListener("click", async () => {
      const perceived = parseInt(stage.querySelector("#av-cg-perceived").value || "5", 10);
      const feedback = stage.querySelector("#av-cg-feedback").value;
      lock(ctx);
      let doneRes;
      try {
        doneRes = await apiService.completeCognitiveAssessment(assessment.id, {
          duration_seconds: totalSec,
          perceived_difficulty: perceived,
          feedback_notes: feedback,
        });
      } catch (err) {
        stageError(ctx, err);
        return;
      }
      const T = tr(DICT); // idioma vigente al terminar
      const r = doneRes.assessment.result || {};
      const badges = doneRes.badges_awarded || [];
      showStage(
        ctx,
        `<div class="av-panel-head">
          <div><span class="av-lbl">${T.done}</span><h2 class="av-h2" tabindex="-1" data-cg-focus>${esc(bt(doneRes.assessment.domain_name) || ctx.nameOf(assessment.domain_code))}</h2></div>
          <span class="av-mx-btns">${tag(T.tagNoGlobal)} ${tag(T.tagNoDx)}</span>
        </div>
        <div class="av-mx-pad">
          <div class="av-cg-kpis">
            <div><span class="av-big">${esc(r.accuracy_percent)} %</span><span class="av-sub">${esc(fmtT(T.kpiAcc, { c: r.correct_count, n: r.total_items }))}</span></div>
            <div><span class="av-big">${esc(r.mean_response_time_ms)} ${T.ms}</span><span class="av-sub">${T.kpiRt}</span></div>
            <div><span class="av-big">${esc(r.omissions_count)}</span><span class="av-sub">${T.kpiOm}</span></div>
          </div>
          <p class="av-mx-p"><strong>${T.summary}:</strong> ${esc(bt(r.non_diagnostic_summary))}</p>
          <p class="av-mx-p av-sub"><strong>${T.practice}:</strong> ${esc(bt(r.practice_effect_note))}</p>
          ${badges.length ? `<p class="av-mx-p"><strong>${T.badges}:</strong> <span class="av-mono">${badges.map(esc).join(", ")}</span></p>` : ""}
          <div><button type="button" class="av-btn av-btn-primary" data-cg-refresh>${T.refresh}</button></div>
        </div>`
      );
      stage.querySelector("[data-cg-refresh]").addEventListener("click", () => ctx.again());
      helpers.showToast?.(fmtT(T.recorded, { code: ctx.nameOf(doneRes.assessment.domain_code) }));
      try {
        await helpers.refreshGlobalHeaderAndSummary?.();
      } catch {
        // el encabezado se actualizará en la siguiente navegación
      }
    });
  };

  renderStep();
}
