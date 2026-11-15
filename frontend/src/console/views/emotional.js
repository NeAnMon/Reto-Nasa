/* SEMSA · Consola · vista "Check-in emocional" (sustituye al antiguo Emotional Assessment Center)
 *
 * - Persona astronauta: sus solicitudes de cuestionario, formulario (escala + abiertas opcionales,
 *   "Prefiero no responder", borrador privado) y resultado operativo propio.
 * - ADMINISTRATOR: envío de solicitudes (individuales o grupales) y tablero de cumplimiento con
 *   recordatorio, seguimiento y cancelación. Nunca ve las respuestas individuales.
 * - Líder en tierra: solo lectura del estado de las solicitudes del tripulante seleccionado.
 *
 * Privacidad por defecto: las respuestas detalladas son privadas; a otros roles solo les llega la
 * señal operativa autorizada. Estados como etiqueta de texto (sin colores de alarma), salvo la
 * instrucción de protocolo urgente, que se anuncia con role="alert".
 * También mantiene el contador de pendientes del menú "Más" (.js-emo-badge).
 */
import { apiService } from "../../services/api.js";
import { tr, fmt as fmtT } from "../../i18n/i18n.js";
import { bt, btLines } from "/src/i18n/backend.js";
import {
  esc, stateTag, tag, fmt, errMsg, ensureCss, loadingHTML, errorHTML, bindRetry, makeStale, roleOf, astronautName,
  snapshotFields, restoreFields, langChanged,
} from "./more-common.js";

const DICT = {
  es: {
    title: "Check-in emocional",
    loading: "Cargando check-in emocional…",
    loadError: "No se pudo cargar el check-in emocional",
    tagPrivacy: "Privacidad por defecto",
    tagNoDx: "No diagnóstico",
    noticeFallback: "Cuestionario educativo de demostración (no diagnóstico).",
    pendingTitle: "Cuestionarios pendientes",
    // lista de solicitudes
    mineTitle: "Mis cuestionarios",
    othersTitle: "Cuestionarios de {name}",
    mineSub: "Período de referencia: {period} · ~{min} min · Puedes elegir «Prefiero no responder» o guardar un borrador.",
    periodFallback: "últimos 3 a 7 días",
    mineEmpty: "No hay solicitudes de cuestionario emocional.",
    request: "Solicitud #{id}",
    quote: "«{text}»",
    msgFallback: "Cuestionario preventivo solicitado por administración.",
    priority: "Prioridad",
    due: "Fecha límite",
    opState: "Estado operativo",
    nextStep: "Siguiente paso",
    open: "Iniciar o continuar cuestionario",
    review: "Revisar o actualizar mis respuestas",
    status: { SENT: "Enviada", DELIVERED: "Entregada", IN_PROGRESS: "En curso", OVERDUE: "Vencida", COMPLETED: "Completada", CANCELLED: "Cancelada", SCHEDULED: "Programada", DRAFT: "Borrador" },
    periodicity: { ONCE: "Única", WEEKLY: "Semanal", BIWEEKLY: "Quincenal", PHASE_CHANGE: "Por cambio de fase" },
    priorities: { NORMAL: "Normal", HIGH: "Alta", URGENT_CHECKIN: "Prioritaria" },
    // administración
    adminTitle: "Gestión de solicitudes",
    adminSub: "Envía solicitudes individuales o grupales. Verás el estado de cumplimiento, nunca las respuestas privadas.",
    recipients: "Destinatarios",
    periodicityLbl: "Periodicidad",
    priorityLbl: "Prioridad",
    dueHours: "Plazo sugerido (horas)",
    customMsg: "Mensaje para la persona astronauta",
    customMsgDefault: "Check-in preventivo solicitado por coordinación de misión.",
    send: "Enviar solicitud",
    needRecipient: "Selecciona al menos un destinatario.",
    sent: "Solicitudes enviadas: {n}.",
    boardTitle: "Tablero de cumplimiento",
    boardEmpty: "No hay solicitudes registradas.",
    colId: "ID",
    colAstro: "Astronauta",
    colPeriod: "Periodicidad / prioridad",
    colMsg: "Mensaje",
    colStatus: "Estado",
    colSignal: "Señal operativa autorizada",
    colDue: "Plazo / completado",
    colActions: "Gestión",
    privateAnswers: "Respuestas individuales privadas",
    awaiting: "Pendiente de respuesta",
    dueShort: "Vence",
    doneShort: "Completado",
    remind: "Recordar",
    followup: "Seguimiento",
    cancel: "Cancelar",
    reminded: "Recordatorio enviado para la solicitud #{id}.",
    cancelled: "Solicitud #{id} cancelada.",
    followupNotes: "Seguimiento preventivo coordinado respetando la privacidad de respuestas detalladas.",
    followedUp: "Seguimiento operativo registrado en la solicitud #{id}.",
    actionError: "No se pudo completar la acción: {msg}",
    // formulario
    opening: "Abriendo el cuestionario…",
    runnerSub: "Tus respuestas detalladas son privadas por defecto. No hay respuestas correctas ni incorrectas.",
    close: "Cerrar",
    part1: "Parte 1 · Dimensiones emocionales y de adaptación",
    part1Sub: "Escala o «Prefiero no responder».",
    part2: "Parte 2 · Preguntas abiertas opcionales",
    part2Sub: "Reflexión libre y privada.",
    openPlaceholder: "Opcional: escribe aquí o deja en blanco…",
    prefsTitle: "Confidencialidad y acompañamiento",
    shareLeader: "Compartir el resumen operativo general con mi líder asignado (sin mostrar respuestas individuales).",
    askSupport: "Solicitar una conversación de acompañamiento con el equipo de apoyo.",
    supportUrgency: "Prioridad de apoyo (si aplica)",
    supportOptions: {
      NONE: "Sin solicitud adicional",
      ROUTINE: "Conversación preventiva habitual",
      PRIORITY: "Revisión prioritaria con especialista",
      URGENT: "Necesito apoyo inmediato (protocolo urgente)",
    },
    saveDraft: "Guardar borrador privado",
    complete: "Completar y enviar",
    draftSaved: "Borrador guardado de forma privada.",
    completed: "Cuestionario emocional completado.",
    urgentTitle: "Protocolo de apoyo urgente",
  },
  en: {
    title: "Emotional check-in",
    loading: "Loading emotional check-in…",
    loadError: "Couldn't load the emotional check-in",
    tagPrivacy: "Private by default",
    tagNoDx: "Not a diagnosis",
    noticeFallback: "Educational demo questionnaire (not a diagnosis).",
    pendingTitle: "Pending questionnaires",
    // lista de solicitudes
    mineTitle: "My questionnaires",
    othersTitle: "Questionnaires for {name}",
    mineSub: "Reference period: {period} · ~{min} min · You can choose “Prefer not to answer” or save a draft.",
    periodFallback: "last 3 to 7 days",
    mineEmpty: "No emotional questionnaire requests.",
    request: "Request #{id}",
    quote: "“{text}”",
    msgFallback: "Preventive questionnaire requested by administration.",
    priority: "Priority",
    due: "Due",
    opState: "Operational status",
    nextStep: "Next step",
    open: "Start or continue questionnaire",
    review: "Review or update my answers",
    status: { SENT: "Sent", DELIVERED: "Delivered", IN_PROGRESS: "In progress", OVERDUE: "Overdue", COMPLETED: "Completed", CANCELLED: "Cancelled", SCHEDULED: "Scheduled", DRAFT: "Draft" },
    periodicity: { ONCE: "One-time", WEEKLY: "Weekly", BIWEEKLY: "Every two weeks", PHASE_CHANGE: "On phase change" },
    priorities: { NORMAL: "Normal", HIGH: "High", URGENT_CHECKIN: "Priority" },
    // administración
    adminTitle: "Request management",
    adminSub: "Send individual or group requests. You'll see completion status, never private answers.",
    recipients: "Recipients",
    periodicityLbl: "Frequency",
    priorityLbl: "Priority",
    dueHours: "Suggested deadline (hours)",
    customMsg: "Message for the astronaut",
    customMsgDefault: "Preventive check-in requested by mission coordination.",
    send: "Send request",
    needRecipient: "Select at least one recipient.",
    sent: "Requests sent: {n}.",
    boardTitle: "Completion board",
    boardEmpty: "No requests recorded.",
    colId: "ID",
    colAstro: "Astronaut",
    colPeriod: "Frequency / priority",
    colMsg: "Message",
    colStatus: "Status",
    colSignal: "Authorized operational signal",
    colDue: "Due / completed",
    colActions: "Manage",
    privateAnswers: "Individual answers are private",
    awaiting: "Awaiting response",
    dueShort: "Due",
    doneShort: "Completed",
    remind: "Remind",
    followup: "Follow up",
    cancel: "Cancel",
    reminded: "Reminder sent for request #{id}.",
    cancelled: "Request #{id} cancelled.",
    followupNotes: "Preventive follow-up coordinated while respecting the privacy of detailed answers.",
    followedUp: "Operational follow-up recorded for request #{id}.",
    actionError: "Couldn't complete the action: {msg}",
    // formulario
    opening: "Opening the questionnaire…",
    runnerSub: "Your detailed answers are private by default. There are no right or wrong answers.",
    close: "Close",
    part1: "Part 1 · Emotional and adaptation dimensions",
    part1Sub: "Scale or “Prefer not to answer”.",
    part2: "Part 2 · Optional open questions",
    part2Sub: "Free, private reflection.",
    openPlaceholder: "Optional: write here or leave blank…",
    prefsTitle: "Confidentiality and support",
    shareLeader: "Share the general operational summary with my assigned leader (without showing individual answers).",
    askSupport: "Request a support conversation with the support team.",
    supportUrgency: "Support priority (if applicable)",
    supportOptions: {
      NONE: "No additional request",
      ROUTINE: "Routine preventive conversation",
      PRIORITY: "Priority review with a specialist",
      URGENT: "I need immediate support (urgent protocol)",
    },
    saveDraft: "Save private draft",
    complete: "Complete and submit",
    draftSaved: "Draft saved privately.",
    completed: "Emotional questionnaire completed.",
    urgentTitle: "Urgent support protocol",
  },
};

const PENDING_STATUSES = ["SENT", "DELIVERED", "IN_PROGRESS", "OVERDUE"];
/* result: función que devuelve el mensaje en el idioma vigente; urgent: texto del servidor */
const ui = { urgent: "", result: null, lang: null };
/* Mensaje traducible diferido: se vuelve a resolver si cambia el idioma */
const msg = (key, vars) => () => fmtT(tr(DICT)[key], vars);

export async function renderEmotionalView(container, appState, helpers) {
  const T = tr(DICT);
  ensureCss();
  const stale = makeStale(appState);
  const role = roleOf(appState);
  const again = () => renderEmotionalView(container, appState, helpers);
  const keep = langChanged(ui, container.querySelector(".av-em-root"));

  if (!container.querySelector(".av-em-root")) {
    ui.urgent = "";
    ui.result = null;
    container.innerHTML = loadingHTML("av-em-root", T.loading);
  }

  let questionnaire, myRequests = [], adminRequests = [];
  try {
    const qRes = await apiService.getEmotionalQuestionnaires();
    questionnaire = qRes.questionnaires?.[0] || null;
    if (role === "ASTRONAUT") {
      myRequests = (await apiService.getMyEmotionalRequests()).requests || [];
    } else {
      adminRequests = (await apiService.getEmotionalRequests({ mission_id: appState.selectedMissionId })).requests || [];
      myRequests = adminRequests.filter((r) => r.astronaut_id === Number(appState.selectedAstronautId));
    }
  } catch (err) {
    if (stale()) return;
    container.innerHTML = errorHTML("av-em-root", T.loadError, errMsg(err));
    bindRetry(container, again);
    return;
  }
  if (stale()) return;

  // contador de pendientes del menú "Más"
  const pendingCount = myRequests.filter((r) => PENDING_STATUSES.includes(r.status)).length;
  document.querySelectorAll(".js-emo-badge").forEach((el) => {
    el.textContent = pendingCount;
    el.classList.toggle("hidden", pendingCount === 0);
  });

  const astronauts = (appState.usersList || []).filter((u) => u.role_code === "ASTRONAUT");
  const activeAstroId = role === "ASTRONAUT" ? Number(appState.currentUser?.id) : Number(appState.selectedAstronautId);
  const activeAstro = astronauts.find((u) => Number(u.id) === activeAstroId) || (role === "ASTRONAUT" ? appState.currentUser : null);
  const who = activeAstro?.full_name || astronautName(appState);

  const syncCustomMsg = (raw, targetName) => {
    let text = bt(raw);
    if (!text || !targetName) return text;
    const legacyNames = [
      "Cmdr. Elena Rostova",
      "Cmdr. Elena",
      "Dr. Marcus Vance",
      "Dr. Marcus",
      "Spec. Kenji Takahashi",
      "Spec. Kenji",
      ...astronauts.map((a) => a.full_name).filter(Boolean),
    ];
    for (const oldName of legacyNames) {
      if (oldName && oldName !== targetName && text.includes(oldName)) {
        text = text.split(oldName).join(targetName);
      }
    }
    return text;
  };

  const statusTag = (s) => tag(T.status[s] || s, PENDING_STATUSES.includes(s));
  const opt = (map, sel) => Object.entries(map).map(([v, l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");

  const adminHTML =
    role !== "ADMINISTRATOR"
      ? ""
      : `<section class="av-panel" aria-labelledby="av-em-adm-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-em-adm-h">${T.adminTitle}</h2><span class="av-sub">${T.adminSub}</span></div>
          <form class="av-mx-form av-mx-pad" id="av-em-req-form" novalidate>
            <div class="av-form-grid av-mx-wide">
              <fieldset>
                <legend class="av-sub">${T.recipients}</legend>
                <div class="av-em-recips">
                  ${astronauts.map((a) => `<label class="av-mx-check"><input type="checkbox" id="av-em-astro-${esc(a.id)}" data-em-astro value="${esc(a.id)}" ${!activeAstroId || Number(a.id) === activeAstroId ? "checked" : ""} /> <span>${esc(a.full_name)} (${esc(a.crew_code)})</span></label>`).join("")}
                </div>
              </fieldset>
              <div class="av-mx-form">
                <div class="av-field"><label for="av-em-period">${T.periodicityLbl}</label><select class="av-input" id="av-em-period">${opt(T.periodicity, "ONCE")}</select></div>
                <div class="av-field"><label for="av-em-prio">${T.priorityLbl}</label><select class="av-input" id="av-em-prio">${opt(T.priorities, "NORMAL")}</select></div>
              </div>
              <div class="av-mx-form">
                <div class="av-field"><label for="av-em-due">${T.dueHours}</label><input class="av-input" type="number" inputmode="numeric" id="av-em-due" value="24" min="1" max="720" /></div>
                <div class="av-field"><label for="av-em-msg">${T.customMsg}</label><input class="av-input" type="text" id="av-em-msg" value="${esc(T.customMsgDefault)}" /></div>
              </div>
            </div>
            <div><button type="submit" class="av-btn av-btn-primary">${T.send}</button></div>
          </form>
          <div class="av-panel-head" style="border-top:1px solid var(--av-border)"><h3 class="av-h3">${T.boardTitle}</h3><span class="av-sub av-mono">${adminRequests.length}</span></div>
          ${
            adminRequests.length
              ? `<div class="av-hscroll"><table class="av-table av-mx-table" style="min-width:980px">
                  <thead><tr><th scope="col">${T.colId}</th><th scope="col">${T.colAstro}</th><th scope="col">${T.colPeriod}</th><th scope="col">${T.colMsg}</th><th scope="col">${T.colStatus}</th><th scope="col">${T.colSignal}</th><th scope="col">${T.colDue}</th><th scope="col">${T.colActions}</th></tr></thead>
                  <tbody>${adminRequests
                    .map((r) => {
                      const rowAstro = astronauts.find((a) => Number(a.id) === Number(r.astronaut_id));
                      const rowName = rowAstro?.full_name || r.astronaut_name;
                      const rowCode = rowAstro?.crew_code || r.astronaut_crew_code;
                      return `<tr>
                        <td class="av-mono av-mx-nowrap">#${esc(r.id)}</td>
                        <td><strong>${esc(rowName)}</strong> <span class="av-sub">(${esc(rowCode)})</span></td>
                        <td>${esc(T.periodicity[r.periodicity] || r.periodicity)} · ${esc(T.priorities[r.priority] || r.priority)}</td>
                        <td class="av-sub">${esc(syncCustomMsg(r.custom_message, rowName) || "—")}</td>
                        <td>${statusTag(r.status)}</td>
                        <td>${r.operational_result ? `${stateTag(r.operational_result.operational_state)}<div class="av-sub">${T.privateAnswers}</div>` : `<span class="av-sub">${T.awaiting}</span>`}</td>
                        <td class="av-sub av-mx-nowrap">${T.dueShort}: <span class="av-mono">${fmt(r.due_at)}</span>${r.completed_at ? `<br>${T.doneShort}: <span class="av-mono">${fmt(r.completed_at)}</span>` : ""}</td>
                        <td><div class="av-mx-btns">
                          <button type="button" class="av-btn av-btn-sm" data-em-do="remind" data-em-id="${esc(r.id)}">${T.remind}</button>
                          <button type="button" class="av-btn av-btn-sm" data-em-do="followup" data-em-id="${esc(r.id)}">${T.followup}</button>
                          ${r.status !== "COMPLETED" && r.status !== "CANCELLED" ? `<button type="button" class="av-btn av-btn-sm av-btn-danger" data-em-do="cancel" data-em-id="${esc(r.id)}">${T.cancel}</button>` : ""}
                        </div></td>
                      </tr>`;
                    })
                    .join("")}</tbody></table></div>`
              : `<p class="av-mx-empty">${T.boardEmpty}</p>`
          }
        </section>`;

  const requestsHTML = myRequests.length
    ? `<div class="av-mx-cards av-mx-pad">${myRequests
        .map((r) => {
          const res = r.operational_result;
          const cardAstro = astronauts.find((a) => Number(a.id) === Number(r.astronaut_id)) || activeAstro;
          const cardName = cardAstro?.full_name || who || r.astronaut_name || "";
          const msgText = syncCustomMsg(r.custom_message, cardName) || T.msgFallback;
          return `<article class="av-panel av-card ${PENDING_STATUSES.includes(r.status) ? "av-mx-card-active" : ""}">
            <div class="av-card-head"><h3 class="av-h3">${esc(fmtT(T.request, { id: r.id }))} <span class="av-sub">· ${esc(T.periodicity[r.periodicity] || r.periodicity)}</span>${cardName ? ` <span class="av-sub">· ${esc(cardName)}</span>` : ""}</h3>${statusTag(r.status)}</div>
            <p class="av-mx-p av-sub">${esc(fmtT(T.quote, { text: msgText }))}</p>
            <span class="av-sub">${T.priority}: <strong>${esc(T.priorities[r.priority] || r.priority)}</strong> · ${T.due}: <span class="av-mono">${fmt(r.due_at)}</span></span>
            ${
              res
                ? `<div class="av-em-result">
                    <span>${T.opState}: ${stateTag(res.operational_state)}</span>
                    <span class="av-mx-p">${esc(btLines(res.personal_feedback_summary || res.authorized_operational_summary || ""))}</span>
                    ${res.recommended_next_step ? `<span><strong>${T.nextStep}:</strong> ${esc(bt(res.recommended_next_step))}</span>` : ""}
                  </div>`
                : ""
            }
            ${role === "ASTRONAUT" && r.status !== "CANCELLED" ? `<button type="button" class="av-btn av-btn-sm ${r.status === "COMPLETED" ? "" : "av-btn-primary"}" data-em-open="${esc(r.id)}">${r.status === "COMPLETED" ? T.review : T.open}</button>` : ""}
          </article>`;
        })
        .join("")}</div>`
    : `<p class="av-mx-empty">${T.mineEmpty}</p>`;

  // re-render por cambio de idioma: conservar el formulario de administración y el cuestionario abierto
  const prev = keep ? container.querySelector(".av-em-root") : null;
  const snap = prev ? snapshotFields(prev.querySelector("#av-em-req-form")) : null;
  // el mensaje predeterminado sin editar se muestra en el idioma nuevo
  if (snap && Object.values(DICT).some((d) => d.customMsgDefault === snap["av-em-msg"]?.value)) delete snap["av-em-msg"];
  const liveRunner = prev ? prev.querySelector("#av-em-runner:not([hidden])") : null;
  container.innerHTML = `
    <div class="av-console av-mx-root av-em-root"><div class="av-grid"><div class="av-col-b">
      <section class="av-panel" aria-labelledby="av-em-h">
        <div class="av-panel-head">
          <h2 class="av-h2" id="av-em-h">${T.title}</h2>
          <span class="av-mx-btns">${tag(T.tagPrivacy)} ${tag(T.tagNoDx)}</span>
        </div>
        <div class="av-mx-banner">${esc(btLines(questionnaire?.privacy_and_usage_notice) || T.noticeFallback)}</div>
        <div class="av-mx-pad" id="av-em-msgs" ${ui.urgent || ui.result ? "" : "hidden"}>
          ${ui.urgent ? `<div class="av-mx-urgent" role="alert"><span class="av-lbl">${T.urgentTitle}</span><br>${esc(btLines(ui.urgent))}</div>` : ""}
          <p class="av-mx-status" id="av-em-status" role="status" aria-live="polite">${esc(ui.result ? ui.result() : "")}</p>
        </div>
      </section>

      ${adminHTML}

      <section class="av-panel av-cg-stage" id="av-em-runner" hidden></section>

      <section class="av-panel" aria-labelledby="av-em-mine-h">
        <div class="av-panel-head">
          <h2 class="av-h2" id="av-em-mine-h">${role === "ASTRONAUT" ? `${T.mineTitle}${who ? ` · ${esc(who)}` : ""}` : !who ? T.mineTitle : esc(fmtT(T.othersTitle, { name: who }))}</h2>
          <span class="av-sub">${T.pendingTitle}: <span class="av-mono">${pendingCount}</span></span>
        </div>
        ${role === "ASTRONAUT" ? `<div class="av-mx-banner">${esc(fmtT(T.mineSub, { period: bt(questionnaire?.reference_period_label) || T.periodFallback, min: questionnaire?.estimated_minutes || 5 }))}</div>` : ""}
        ${requestsHTML}
      </section>
    </div></div></div>`;

  const root = container.querySelector(".av-em-root");
  if (snap) restoreFields(root.querySelector("#av-em-req-form"), snap);
  if (liveRunner) root.querySelector("#av-em-runner").replaceWith(liveRunner);
  const say = (resolve) => {
    ui.result = resolve;
    const box = container.querySelector(".av-em-root #av-em-msgs");
    if (!box) return;
    box.hidden = false;
    box.querySelector("#av-em-status").textContent = resolve();
  };
  const ctx = { root, appState, helpers, again, say, questionnaire, runner: root.querySelector("#av-em-runner") };

  // Administración: crear solicitudes
  root.querySelector("#av-em-req-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ids = Array.from(root.querySelectorAll("[data-em-astro]:checked")).map((cb) => Number(cb.value));
    if (!ids.length) {
      say(msg("needRecipient"));
      return;
    }
    const periodicity = root.querySelector("#av-em-period").value;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await apiService.createEmotionalRequests({
        astronaut_ids: ids,
        mission_id: appState.selectedMissionId,
        questionnaire_code: questionnaire ? questionnaire.code : "EMOTIONAL_CHECKIN_DEMO_V1",
        periodicity,
        is_recurring: periodicity !== "ONCE",
        priority: root.querySelector("#av-em-prio").value,
        custom_message: root.querySelector("#av-em-msg").value,
        due_in_hours: parseInt(root.querySelector("#av-em-due").value || "24", 10),
        send_immediately: true,
        is_simulated: true,
      });
      ui.result = msg("sent", { n: res.created_count });
      helpers.showToast?.(ui.result());
      await again();
    } catch (err) {
      btn.disabled = false;
      say(msg("actionError", { msg: errMsg(err) }));
    }
  });

  // Administración: recordar / seguimiento / cancelar
  root.querySelectorAll("[data-em-do]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-em-id"));
      const act = btn.getAttribute("data-em-do");
      btn.disabled = true;
      try {
        if (act === "remind") {
          await apiService.sendOrRemindEmotionalRequest(id);
          ui.result = msg("reminded", { id });
        } else if (act === "cancel") {
          await apiService.cancelEmotionalRequest(id);
          ui.result = msg("cancelled", { id });
        } else {
          await apiService.createEmotionalFollowUp({ request_id: id, action_type: "FOLLOW_UP_SCHEDULED", notes: T.followupNotes });
          ui.result = msg("followedUp", { id });
        }
        helpers.showToast?.(ui.result());
        await again();
      } catch (err) {
        btn.disabled = false;
        say(msg("actionError", { msg: errMsg(err) }));
      }
    });
  });

  // Astronauta: abrir cuestionario
  root.querySelectorAll("[data-em-open]").forEach((btn) => {
    btn.addEventListener("click", () => openRunner(ctx, Number(btn.getAttribute("data-em-open"))));
  });
}

async function openRunner(ctx, requestId) {
  const T = tr(DICT);
  const { runner, questionnaire, helpers } = ctx;
  if (!runner || !questionnaire) return;
  runner.hidden = false;
  runner.innerHTML = `<div class="av-sub" style="padding:16px" role="status">${T.opening}</div>`;
  runner.scrollIntoView({ behavior: "smooth", block: "start" });

  let assessmentId;
  try {
    assessmentId = (await apiService.startEmotionalAssessment(requestId)).assessment_id;
  } catch (err) {
    runner.hidden = true;
    ctx.say(msg("actionError", { msg: errMsg(err) }));
    return;
  }

  const questions = questionnaire.questions || [];
  const scaleQs = questions.filter((q) => q.question_type !== "OPEN_TEXT");
  const openQs = questions.filter((q) => q.question_type === "OPEN_TEXT");
  // valor inicial neutro-favorable, igual que la versión anterior; siempre se puede cambiar
  const preselected = (q, o) => (q.higher_value_indicates_concern ? o.option_value === "2" : o.option_value === "4");

  runner.innerHTML = `
    <div class="av-panel-head">
      <div>
        <span class="av-lbl">${esc(fmtT(T.request, { id: requestId }))}</span>
        <h2 class="av-h2" tabindex="-1" id="av-em-runner-h">${esc(bt(questionnaire.title))}</h2>
      </div>
      <button type="button" class="av-btn av-btn-sm" data-em-close>${T.close}</button>
    </div>
    <form class="av-mx-form av-mx-pad" id="av-em-form" novalidate>
      <p class="av-mx-note">${T.runnerSub}</p>
      <div><h3 class="av-h3">${T.part1} <span class="av-sub av-mono">${scaleQs.length}</span></h3><span class="av-sub">${T.part1Sub}</span></div>
      <div class="av-em-qgrid">
        ${scaleQs
          .map(
            (q) => `<div class="av-em-q">
              <label for="av-em-q-${esc(q.question_code)}">${esc(q.sequence_order)}. ${esc(bt(q.prompt_text))}</label>
              <select class="av-input" id="av-em-q-${esc(q.question_code)}" data-em-scale data-q="${esc(q.question_code)}" data-dim="${esc(q.dimension_code)}">
                ${(q.options || []).map((o) => `<option value="${esc(o.option_value)}" ${preselected(q, o) ? "selected" : ""}>${esc(bt(o.option_label))}</option>`).join("")}
              </select>
            </div>`
          )
          .join("")}
      </div>
      ${
        openQs.length
          ? `<div><h3 class="av-h3">${T.part2} <span class="av-sub av-mono">${openQs.length}</span></h3><span class="av-sub">${T.part2Sub}</span></div>
            <div class="av-em-qgrid">
              ${openQs
                .map(
                  (q) => `<div class="av-em-q">
                    <label for="av-em-o-${esc(q.question_code)}">${esc(bt(q.prompt_text))}</label>
                    <textarea class="av-input av-mx-textarea" id="av-em-o-${esc(q.question_code)}" rows="2" data-em-open-text data-q="${esc(q.question_code)}" data-dim="${esc(q.dimension_code)}" placeholder="${esc(T.openPlaceholder)}"></textarea>
                  </div>`
                )
                .join("")}
            </div>`
          : ""
      }
      <fieldset>
        <legend class="av-h3">${T.prefsTitle}</legend>
        <label class="av-mx-check"><input type="checkbox" id="av-em-share" checked /> <span>${T.shareLeader}</span></label>
        <label class="av-mx-check"><input type="checkbox" id="av-em-support" /> <span>${T.askSupport}</span></label>
        <div class="av-field" style="max-width:420px">
          <label for="av-em-urgency">${T.supportUrgency}</label>
          <select class="av-input" id="av-em-urgency">${Object.entries(T.supportOptions).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select>
        </div>
      </fieldset>
      <div class="av-mx-btns">
        <button type="submit" class="av-btn av-btn-primary">${T.complete}</button>
        <button type="button" class="av-btn" data-em-draft>${T.saveDraft}</button>
      </div>
      <p class="av-mx-status" id="av-em-form-status" role="status" aria-live="polite"></p>
    </form>`;
  runner.querySelector("#av-em-runner-h").focus({ preventScroll: true });

  const formStatus = runner.querySelector("#av-em-form-status");
  const setBusy = (busy) => runner.querySelectorAll("#av-em-form button").forEach((b) => (b.disabled = busy));
  runner.querySelector("[data-em-close]").addEventListener("click", () => (runner.hidden = true));

  const collect = () => {
    const list = [];
    runner.querySelectorAll("[data-em-scale]").forEach((sel) => {
      const val = sel.value;
      const pna = val === "PREFER_NOT_TO_ANSWER";
      list.push({
        question_code: sel.getAttribute("data-q"),
        dimension_code: sel.getAttribute("data-dim"),
        response_value: val,
        numeric_score: !pna && /^\d+$/.test(val) ? parseInt(val, 10) : null,
        prefer_not_to_answer: pna,
      });
    });
    runner.querySelectorAll("[data-em-open-text]").forEach((ta) => {
      const txt = ta.value.trim();
      if (txt) {
        list.push({
          question_code: ta.getAttribute("data-q"),
          dimension_code: ta.getAttribute("data-dim"),
          response_value: "TEXT_PROVIDED",
          open_text_answer: txt,
          prefer_not_to_answer: false,
        });
      }
    });
    return list;
  };

  runner.querySelector("[data-em-draft]").addEventListener("click", async () => {
    setBusy(true);
    try {
      const res = await apiService.saveEmotionalResponses(assessmentId, {
        responses: collect(),
        is_draft: true,
        share_summary_with_leader: runner.querySelector("#av-em-share").checked,
        allow_admin_detailed_review: false,
      });
      formStatus.textContent = btLines(res.personal_feedback_summary) || T.draftSaved;
      helpers.showToast?.(T.draftSaved);
    } catch (err) {
      formStatus.textContent = fmtT(tr(DICT).actionError, { msg: errMsg(err) });
    }
    setBusy(false);
  });

  runner.querySelector("#av-em-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const urgency = runner.querySelector("#av-em-urgency").value;
    setBusy(true);
    try {
      const doneRes = await apiService.completeEmotionalAssessment(assessmentId, {
        responses: collect(),
        share_summary_with_leader: runner.querySelector("#av-em-share").checked,
        allow_admin_detailed_review: false,
        explicit_support_request: runner.querySelector("#av-em-support").checked || urgency !== "NONE",
        support_urgency: urgency,
      });
      // la instrucción urgente se conserva tras recargar la lista
      ui.urgent = doneRes.result?.urgent_protocol_instructions || "";
      const summary = doneRes.result?.personal_feedback_summary;
      ui.result = summary ? () => btLines(summary) : msg("completed");
      helpers.showToast?.(T.completed);
      try {
        await helpers.refreshGlobalHeaderAndSummary?.();
      } catch {
        // el contador se corrige al recargar la vista
      }
      await ctx.again();
      document.getElementById("av-em-h")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setBusy(false);
      formStatus.textContent = fmtT(tr(DICT).actionError, { msg: errMsg(err) });
    }
  });
}
