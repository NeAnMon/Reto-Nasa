/* SEMSA · Consola · vista "Bienestar psicológico" (sustituye al antiguo Wellness Center)
 *
 * - Autoevaluación de bienestar (instrumento DEMO): dimensiones 1–10, sueño, nivel de apoyo,
 *   reflexión privada y consentimiento para compartir solo la señal operativa con el líder.
 * - Respiración guiada 4-4-4-4 y catálogo de recomendaciones preventivas autorizadas.
 * - Historial de evaluaciones; las respuestas detalladas llegan ya redactadas por rol desde la API.
 *
 * Privacidad: la reflexión es privada por defecto y nunca se muestra al líder en tierra.
 * El estado se muestra como etiqueta de texto (sin colores de alarma).
 */
import { apiService } from "../../services/api.js";
import { tr, fmt as fmtT } from "../../i18n/i18n.js";
import { bt, btLines } from "/src/i18n/backend.js";
import {
  esc, stateTag, stateLabel, tag, fmt, errMsg, ensureCss, loadingHTML, errorHTML, bindRetry,
  makeStale, isOwnAstronaut, astronautName, snapshotFields, restoreFields, langChanged,
} from "./more-common.js";

const DICT = {
  es: {
    title: "Bienestar psicológico",
    loading: "Cargando bienestar psicológico…",
    loadError: "No se pudo cargar el bienestar psicológico",
    latest: "Último estado",
    formTitle: "Autoevaluación de bienestar",
    formFallbackTitle: "Cuestionario de bienestar (demo)",
    onBehalf: "Estás registrando una evaluación para {name}. La reflexión privada solo la verá esa persona.",
    scale: "(1–10)",
    sleepHours: "Horas de sueño recientes",
    urgency: "Nivel de apoyo solicitado",
    urgencyOptions: {
      NONE: "Sin solicitud adicional (autocuidado habitual)",
      ROUTINE_COUNSELING: "Charla preventiva con especialista",
      PRIORITY_REVIEW: "Revisión prioritaria por fatiga o aislamiento",
      URGENT_SUPPORT: "Apoyo psicológico urgente",
    },
    urgencyShort: {
      NONE: "Ninguno",
      ROUTINE_COUNSELING: "Charla preventiva",
      PRIORITY_REVIEW: "Revisión prioritaria",
      URGENT_SUPPORT: "Apoyo urgente",
    },
    reflection: "Reflexión personal confidencial",
    reflectionHint: "Privada por defecto: el líder en tierra no la ve.",
    reflectionPlaceholder: "Espacio privado para registrar cómo te sientes…",
    share: "Permitir enviar al líder solo la señal operativa de seguimiento (sin mis respuestas ni mi texto privado).",
    save: "Guardar evaluación",
    saveDraft: "Guardar borrador",
    saving: "Guardando…",
    savedDraft: "Borrador guardado de forma privada.",
    saved: "Evaluación de bienestar registrada. Estado: {state}.",
    saveError: "No se pudo guardar la evaluación: {msg}",
    breathTitle: "Respiración guiada 4-4-4-4",
    breathReady: "Listo",
    breathPaused: "En pausa",
    breathStart: "Iniciar respiración",
    breathStop: "Pausar respiración",
    breathPhases: ["Inhalar · 4 s", "Mantener · 4 s", "Exhalar · 4 s", "Pausa · 4 s"],
    recsTitle: "Recomendaciones preventivas",
    recsFor: "Para el estado: {state}",
    recsEmpty: "Sin recomendaciones disponibles.",
    recsError: "No se pudieron cargar las recomendaciones.",
    suppressed: "Pausadas por seguridad operativa:",
    minutes: "min",
    historyTitle: "Historial de evaluaciones",
    historyEmpty: "Aún no hay evaluaciones de bienestar registradas.",
    colDate: "GMT",
    colState: "Estado operativo",
    colSupport: "Apoyo solicitado",
    colPrivacy: "Privacidad",
    colNote: "Detalle / reflexión privada",
    privRedacted: "Protegido por rol",
    privOwn: "Vista propia",
    noNote: "Sin nota",
    privacyTitle: "Privacidad",
    privacyNote: "Tus respuestas detalladas y tu reflexión son privadas. Al líder en tierra solo le llega, si lo autorizas, la señal operativa de seguimiento. Esta herramienta es educativa y no emite diagnósticos.",
    simulated: "SIMULADO",
  },
  en: {
    title: "Psychological wellbeing",
    loading: "Loading psychological wellbeing…",
    loadError: "Couldn't load psychological wellbeing",
    latest: "Latest status",
    formTitle: "Wellbeing self-assessment",
    formFallbackTitle: "Wellbeing questionnaire (demo)",
    onBehalf: "You're recording an assessment for {name}. Only that person will see the private reflection.",
    scale: "(1–10)",
    sleepHours: "Recent hours of sleep",
    urgency: "Support level requested",
    urgencyOptions: {
      NONE: "No additional request (usual self-care)",
      ROUTINE_COUNSELING: "Preventive talk with a specialist",
      PRIORITY_REVIEW: "Priority review for fatigue or isolation",
      URGENT_SUPPORT: "Urgent psychological support",
    },
    urgencyShort: {
      NONE: "None",
      ROUTINE_COUNSELING: "Preventive talk",
      PRIORITY_REVIEW: "Priority review",
      URGENT_SUPPORT: "Urgent support",
    },
    reflection: "Confidential personal reflection",
    reflectionHint: "Private by default: the ground leader can't see it.",
    reflectionPlaceholder: "A private space to note how you're feeling…",
    share: "Allow sending only the operational follow-up signal to the leader (not my answers or my private text).",
    save: "Save assessment",
    saveDraft: "Save draft",
    saving: "Saving…",
    savedDraft: "Draft saved privately.",
    saved: "Wellbeing assessment recorded. Status: {state}.",
    saveError: "Couldn't save the assessment: {msg}",
    breathTitle: "4-4-4-4 guided breathing",
    breathReady: "Ready",
    breathPaused: "Paused",
    breathStart: "Start breathing",
    breathStop: "Pause breathing",
    breathPhases: ["Inhale · 4 s", "Hold · 4 s", "Exhale · 4 s", "Rest · 4 s"],
    recsTitle: "Preventive recommendations",
    recsFor: "For status: {state}",
    recsEmpty: "No recommendations available.",
    recsError: "Couldn't load recommendations.",
    suppressed: "Paused for operational safety:",
    minutes: "min",
    historyTitle: "Assessment history",
    historyEmpty: "No wellbeing assessments recorded yet.",
    colDate: "GMT",
    colState: "Operational status",
    colSupport: "Support requested",
    colPrivacy: "Privacy",
    colNote: "Details / private reflection",
    privRedacted: "Protected by role",
    privOwn: "Own view",
    noNote: "No note",
    privacyTitle: "Privacy",
    privacyNote: "Your detailed answers and your reflection are private. The ground leader only receives the operational follow-up signal, and only if you allow it. This is an educational tool and does not provide diagnoses.",
    simulated: "SIMULATED",
  },
};

/* result: función que devuelve el último mensaje en el idioma vigente (sobrevive a un cambio de idioma) */
const ui = { timer: null, result: null, busy: false, lang: null };

function stopBreathing() {
  if (ui.timer) clearInterval(ui.timer);
  ui.timer = null;
}

export async function renderWellnessView(container, appState, helpers) {
  ensureCss();
  const T = tr(DICT);
  // re-render por cambio de idioma: conservar lo escrito y retomar la respiración si estaba activa
  const keep = langChanged(ui, container.querySelector(".av-wl-root"));
  const wasBreathing = keep && !!ui.timer;
  stopBreathing();
  const stale = makeStale(appState);
  const aid = appState.selectedAstronautId;
  const again = () => renderWellnessView(container, appState, helpers);

  if (!container.querySelector(".av-wl-root")) {
    ui.result = null;
    container.innerHTML = loadingHTML("av-wl-root", T.loading);
  }

  let instrument, assessments, recs = null, recState;
  try {
    const [instRes, assessRes] = await Promise.all([
      apiService.getWellnessInstruments(),
      apiService.getWellnessAssessments(aid),
    ]);
    instrument = instRes.instruments?.[0] || null;
    assessments = assessRes.assessments || [];
    // las recomendaciones dependen del último estado no-borrador
    const lastFinal = assessments.find((a) => a.operational_wellness_state && a.operational_wellness_state !== "ASSESSMENT_INCOMPLETE");
    recState = lastFinal?.operational_wellness_state || "WELLNESS_STABLE";
    try {
      recs = await apiService.getWellnessRecommendations(aid, recState);
    } catch {
      recs = null;
    }
  } catch (err) {
    if (stale()) return;
    container.innerHTML = errorHTML("av-wl-root", T.loadError, errMsg(err));
    bindRetry(container, again);
    return;
  }
  if (stale()) return;

  const latestState = assessments[0]?.operational_wellness_state || null;
  const own = isOwnAstronaut(appState);
  const dims = instrument?.dimensions || [];

  const formHTML = `
    <form class="av-mx-form av-mx-pad" id="av-wl-form" novalidate>
      ${instrument?.disclaimer ? `<p class="av-mx-note">${esc(btLines(instrument.disclaimer))}</p>` : ""}
      ${!own && astronautName(appState) ? `<p class="av-mx-note"><strong>${esc(fmtT(T.onBehalf, { name: astronautName(appState) }))}</strong></p>` : ""}
      <div class="av-form-grid">
        ${dims
          .map(
            (dim) => `
          <div class="av-field">
            <label for="av-wl-dim-${esc(dim.key)}">${esc(bt(dim.label))} ${T.scale}</label>
            <input class="av-input" type="number" inputmode="numeric" min="1" max="10" step="1" required
              id="av-wl-dim-${esc(dim.key)}" data-wl-dim="${esc(dim.key)}" value="${dim.high_is_good ? 8 : 3}" />
          </div>`
          )
          .join("")}
        <div class="av-field">
          <label for="av-wl-sleep">${T.sleepHours}</label>
          <input class="av-input" type="number" inputmode="decimal" step="0.5" min="0" max="16" id="av-wl-sleep" value="7.0" />
        </div>
      </div>
      <div class="av-field">
        <label for="av-wl-urgency">${T.urgency}</label>
        <select class="av-input" id="av-wl-urgency">
          ${Object.entries(T.urgencyOptions).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}
        </select>
      </div>
      <div class="av-field">
        <label for="av-wl-reflection">${T.reflection}</label>
        <textarea class="av-input av-mx-textarea" id="av-wl-reflection" rows="3" aria-describedby="av-wl-reflection-hint" placeholder="${esc(T.reflectionPlaceholder)}"></textarea>
        <span class="av-sub" id="av-wl-reflection-hint">${T.reflectionHint}</span>
      </div>
      <label class="av-mx-check"><input type="checkbox" id="av-wl-share" checked /> <span>${T.share}</span></label>
      <div class="av-mx-btns">
        <button type="submit" class="av-btn av-btn-primary" data-wl-save="final">${T.save}</button>
        <button type="button" class="av-btn" data-wl-save="draft">${T.saveDraft}</button>
      </div>
      <p class="av-mx-status" id="av-wl-status" role="status" aria-live="polite">${esc(ui.result ? ui.result() : "")}</p>
    </form>`;

  const historyHTML = assessments.length
    ? `<div class="av-hscroll"><table class="av-table av-mx-table">
        <thead><tr><th scope="col">${T.colDate}</th><th scope="col">${T.colState}</th><th scope="col">${T.colSupport}</th><th scope="col">${T.colPrivacy}</th><th scope="col">${T.colNote}</th></tr></thead>
        <tbody>
          ${assessments
            .map(
              (a) => `<tr>
                <td class="av-mono av-mx-nowrap">${fmt(a.created_at)}</td>
                <td>${stateTag(a.operational_wellness_state)}</td>
                <td>${esc(T.urgencyShort[a.support_urgency] || a.support_urgency || "—")}</td>
                <td class="av-mx-nowrap">${a.privacy_redacted ? T.privRedacted : T.privOwn}</td>
                <td>${esc(bt(a.private_reflection) || bt(a.privacy_notice) || T.noNote)}</td>
              </tr>`
            )
            .join("")}
        </tbody></table></div>`
    : `<p class="av-mx-empty">${T.historyEmpty}</p>`;

  const suppressed = recs?.suppressed_for_safety || [];
  const recList = recs?.recommendations || [];
  const recsHTML = !recs
    ? `<p class="av-mx-empty">${T.recsError}</p>`
    : `${recs.urgent_notice ? `<p class="av-mx-note" style="margin:12px 12px 0">${esc(bt(recs.urgent_notice))}</p>` : ""}
       ${suppressed.length ? `<p class="av-mx-note" style="margin:12px 12px 0"><strong>${T.suppressed}</strong> ${suppressed.map((s) => `${esc(bt(s.title))} (${esc(bt(s.reason))})`).join(" · ")}</p>` : ""}
       ${
         recList.length
           ? `<ul class="av-mx-list av-mx-scroll">${recList
               .map(
                 (r) => `<li>
                   <div class="av-mx-row"><strong>${esc(bt(r.title))}</strong><span class="av-mono av-sub">${esc(r.duration_minutes)} ${T.minutes}</span></div>
                   <span class="av-sub">${esc(btLines(r.instructions))}</span>
                 </li>`
               )
               .join("")}</ul>`
           : `<p class="av-mx-empty">${T.recsEmpty}</p>`
       }`;

  const snap = keep ? snapshotFields(container.querySelector(".av-wl-root")) : null;
  container.innerHTML = `
    <div class="av-console av-mx-root av-wl-root"><div class="av-grid">
      <div class="av-col-b">
        <section class="av-panel" aria-labelledby="av-wl-h">
          <div class="av-panel-head">
            <h2 class="av-h2" id="av-wl-h">${T.title}</h2>
            <span class="av-mx-btns"><span class="av-sub">${T.latest}:</span> ${latestState ? stateTag(latestState) : tag("—")} ${tag(T.simulated)}</span>
          </div>
          <div class="av-panel-head"><h3 class="av-h3">${esc(bt(instrument?.title) || T.formFallbackTitle)}</h3><span class="av-sub">${T.formTitle}</span></div>
          ${formHTML}
        </section>
        <section class="av-panel" aria-labelledby="av-wl-hist-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-wl-hist-h">${T.historyTitle}</h2><span class="av-sub av-mono">${assessments.length}</span></div>
          ${historyHTML}
        </section>
      </div>
      <aside class="av-mx-side">
        <section class="av-panel" aria-labelledby="av-wl-breath-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-wl-breath-h">${T.breathTitle}</h2></div>
          <div class="av-wl-breath">
            <div class="av-wl-circle" id="av-wl-circle" role="status" aria-live="polite">${T.breathReady}</div>
            <button type="button" class="av-btn" id="av-wl-breath-btn" aria-pressed="false">${T.breathStart}</button>
          </div>
        </section>
        <section class="av-panel" aria-labelledby="av-wl-recs-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-wl-recs-h">${T.recsTitle}</h2><span class="av-sub">${esc(fmtT(T.recsFor, { state: stateLabel(recState) }))}</span></div>
          ${recsHTML}
        </section>
        <section class="av-panel av-mx-pad" aria-labelledby="av-wl-priv-h">
          <h2 class="av-h3" id="av-wl-priv-h">${T.privacyTitle}</h2>
          <p class="av-mx-p av-sub">${T.privacyNote}</p>
        </section>
      </aside>
    </div></div>`;

  const root = container.querySelector(".av-wl-root");
  const status = root.querySelector("#av-wl-status");
  if (snap) restoreFields(root, snap);

  const submit = async (isDraft) => {
    if (ui.busy) return;
    const form = root.querySelector("#av-wl-form");
    if (!isDraft && !form.reportValidity()) return;
    const urgency = root.querySelector("#av-wl-urgency").value;
    const payload = {
      astronaut_id: appState.selectedAstronautId,
      mission_id: appState.selectedMissionId,
      is_draft: isDraft,
      sleep_hours: parseFloat(root.querySelector("#av-wl-sleep").value || "7"),
      support_urgency: urgency,
      request_additional_support: urgency !== "NONE",
      private_reflection: root.querySelector("#av-wl-reflection").value,
      share_operational_signal_with_leader: root.querySelector("#av-wl-share").checked,
      is_simulated: true,
    };
    root.querySelectorAll("[data-wl-dim]").forEach((inp) => {
      payload[inp.getAttribute("data-wl-dim")] = parseInt(inp.value, 10);
    });
    ui.busy = true;
    root.querySelectorAll("[data-wl-save]").forEach((b) => (b.disabled = true));
    status.textContent = T.saving;
    try {
      const res = await apiService.createWellnessAssessment(payload);
      const st = res.assessment?.operational_wellness_state;
      ui.result = () => (isDraft ? tr(DICT).savedDraft : fmtT(tr(DICT).saved, { state: stateLabel(st) }));
      helpers.showToast?.(ui.result());
      ui.busy = false;
      await again();
    } catch (err) {
      ui.busy = false;
      status.textContent = fmtT(T.saveError, { msg: errMsg(err) });
      root.querySelectorAll("[data-wl-save]").forEach((b) => (b.disabled = false));
    }
  };

  root.querySelector("#av-wl-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submit(false);
  });
  root.querySelector('[data-wl-save="draft"]').addEventListener("click", () => submit(true));

  const circle = root.querySelector("#av-wl-circle");
  const breathBtn = root.querySelector("#av-wl-breath-btn");
  breathBtn.addEventListener("click", () => {
    if (ui.timer) {
      stopBreathing();
      circle.className = "av-wl-circle";
      circle.textContent = T.breathPaused;
      breathBtn.textContent = T.breathStart;
      breathBtn.setAttribute("aria-pressed", "false");
      return;
    }
    let step = 0;
    const apply = () => {
      if (!document.body.contains(circle)) {
        stopBreathing();
        return;
      }
      const i = step % 4;
      circle.className = `av-wl-circle ${i < 2 ? "av-wl-in" : "av-wl-out"}`;
      circle.textContent = tr(DICT).breathPhases[i];
      step += 1;
    };
    apply();
    ui.timer = setInterval(apply, 4000);
    breathBtn.textContent = T.breathStop;
    breathBtn.setAttribute("aria-pressed", "true");
  });
  if (wasBreathing) breathBtn.click();
}
