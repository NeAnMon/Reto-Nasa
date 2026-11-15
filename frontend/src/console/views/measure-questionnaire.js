/*
 * SEMSA · Consola · "Registrar medición" → Cuestionario de bienestar psicológico
 *
 * Antes vivía en su propia vista (wellness.js, abierta desde Bienestar → Hoy). Ahora es una
 * tarjeta más de "Registrar medición" (grupo "Cuestionarios") y se responde en el mismo panel
 * de registro, con los mismos controles: escala 1–10 de botones grandes, − / + para las horas
 * de sueño y una acción principal.
 *
 * Mismo contrato con el backend que la vista anterior:
 *   GET  /wellness/instruments        → dimensiones del instrumento DEMO
 *   GET  /wellness/assessments        → historial (redactado por rol en la API)
 *   POST /wellness/assessments        → guardar evaluación o borrador
 *   GET  /wellness/recommendations    → recomendaciones para el estado resultante
 *
 * Privacidad: la reflexión es privada por defecto; al líder solo le llega, si se autoriza,
 * la señal operativa. El estado se muestra como etiqueta de texto (sin colores de alarma).
 */
import { apiService } from "../../services/api.js";
import { tr, fmt as fmtT } from "../../i18n/i18n.js";
import { bt, btLines } from "/src/i18n/backend.js";
import { esc, stateLabel, stateTag, fmt as fmtGmt, errMsg, isOwnAstronaut, astronautName } from "./more-common.js";

/* Código de la tarjeta dentro de la lista de "Registrar medición" (no choca con los indicadores) */
export const Q_CODE = "wellness-questionnaire";
/* Sin una evaluación final en esta ventana, la tarjeta se marca como pendiente */
const Q_STALE_HOURS = 7 * 24;
/* Límites del backend (schemas.py → WellnessAssessmentCreate: sleep_hours 0–16) */
const SLEEP = { min: 0, max: 16, step: 0.5, def: 7 };

const DICT = {
  es: {
    group: "Cuestionarios",
    tileName: "Bienestar psicológico",
    title: "Cuestionario de bienestar psicológico",
    never: "Sin respuestas",
    ago: "hace {t}",
    lt1h: "menos de 1 h",
    hours: "{n} h",
    days: "{n} d",
    pendingTag: "PENDIENTE",
    last: "Último: {state} · {age}",
    lastNone: "Aún no has respondido este cuestionario.",
    about: "Antes de empezar",
    minutes: "Unos 5 minutos. Responde según cómo te has sentido estos días.",
    onBehalf: "Estás registrando una evaluación para {name}. La reflexión privada solo la verá esa persona.",
    low: "Poco",
    high: "Mucho",
    sleepHours: "Horas de sueño recientes",
    less: "Restar",
    more: "Sumar",
    urgency: "¿Necesitas apoyo?",
    urgencyOptions: {
      NONE: "Sin solicitud adicional (autocuidado habitual)",
      ROUTINE_COUNSELING: "Charla preventiva con especialista",
      PRIORITY_REVIEW: "Revisión prioritaria por fatiga o aislamiento",
      URGENT_SUPPORT: "Apoyo psicológico urgente",
    },
    urgencyShort: {
      NONE: "Sin apoyo adicional",
      ROUTINE_COUNSELING: "Charla preventiva",
      PRIORITY_REVIEW: "Revisión prioritaria",
      URGENT_SUPPORT: "Apoyo urgente",
    },
    reflection: "Añadir una reflexión privada",
    reflectionHint: "Privada por defecto: el líder en tierra no la ve.",
    reflectionPh: "Espacio privado para registrar cómo te sientes…",
    share: "Permitir enviar al líder solo la señal operativa de seguimiento (sin mis respuestas ni mi texto privado).",
    save: "Guardar cuestionario",
    saveDraft: "Guardar borrador",
    saving: "Guardando…",
    badSleep: "Indica las horas de sueño con un número entre 0 y 16.",
    missing: "Responde todas las preguntas de la escala.",
    savedDraft: "Borrador guardado de forma privada.",
    saved: "Guardado",
    savedToast: "Cuestionario de bienestar registrado. Estado: {state}.",
    saveError: "No se pudo guardar el cuestionario: {msg}",
    stateLbl: "Estado operativo",
    supportLbl: "Apoyo solicitado: {s}",
    recsTitle: "Recomendaciones preventivas",
    recsEmpty: "Sin recomendaciones disponibles.",
    urgentNote: "Si necesitas hablar ahora, escribe a tu equipo de apoyo desde Mensajes.",
    again: "Responder otra vez",
    finish: "Volver a la lista",
    toMessages: "Ir a Mensajes",
    next: "Siguiente: {name} →",
    history: "Historial ({n})",
    historyEmpty: "Aún no hay evaluaciones registradas.",
    privacy: "Tus respuestas detalladas y tu reflexión son privadas. Herramienta educativa: no emite diagnósticos.",
    loadError: "No se pudo cargar el cuestionario: {msg}",
    simulated: "SIMULADO",
  },
  en: {
    group: "Questionnaires",
    tileName: "Psychological wellbeing",
    title: "Psychological wellbeing questionnaire",
    never: "No answers",
    ago: "{t} ago",
    lt1h: "under 1 h",
    hours: "{n} h",
    days: "{n} d",
    pendingTag: "DUE",
    last: "Last: {state} · {age}",
    lastNone: "You haven't answered this questionnaire yet.",
    about: "Before you start",
    minutes: "About 5 minutes. Answer based on how you've felt these days.",
    onBehalf: "You're recording an assessment for {name}. Only that person will see the private reflection.",
    low: "Low",
    high: "High",
    sleepHours: "Recent hours of sleep",
    less: "Decrease",
    more: "Increase",
    urgency: "Do you need support?",
    urgencyOptions: {
      NONE: "No additional request (usual self-care)",
      ROUTINE_COUNSELING: "Preventive talk with a specialist",
      PRIORITY_REVIEW: "Priority review for fatigue or isolation",
      URGENT_SUPPORT: "Urgent psychological support",
    },
    urgencyShort: {
      NONE: "No additional support",
      ROUTINE_COUNSELING: "Preventive talk",
      PRIORITY_REVIEW: "Priority review",
      URGENT_SUPPORT: "Urgent support",
    },
    reflection: "Add a private reflection",
    reflectionHint: "Private by default: the ground leader can't see it.",
    reflectionPh: "A private space to note how you're feeling…",
    share: "Allow sending only the operational follow-up signal to the leader (not my answers or my private text).",
    save: "Save questionnaire",
    saveDraft: "Save draft",
    saving: "Saving…",
    badSleep: "Enter the hours of sleep as a number between 0 and 16.",
    missing: "Answer every scale question.",
    savedDraft: "Draft saved privately.",
    saved: "Saved",
    savedToast: "Wellbeing questionnaire recorded. Status: {state}.",
    saveError: "Couldn't save the questionnaire: {msg}",
    stateLbl: "Operational status",
    supportLbl: "Support requested: {s}",
    recsTitle: "Preventive recommendations",
    recsEmpty: "No recommendations available.",
    urgentNote: "If you need to talk now, write to your support team from Messages.",
    again: "Answer again",
    finish: "Back to list",
    toMessages: "Go to Messages",
    next: "Next: {name} →",
    history: "History ({n})",
    historyEmpty: "No assessments recorded yet.",
    privacy: "Your detailed answers and your reflection are private. Educational tool: it does not provide diagnoses.",
    loadError: "Couldn't load the questionnaire: {msg}",
    simulated: "SIMULATED",
  },
};

/* Estado propio del cuestionario (sobrevive a los repintados de la vista) */
const qui = { result: null, draftMsg: null, busy: false };

export function resetQuestionnaireUi() {
  qui.result = null;
  qui.draftMsg = null;
  qui.busy = false;
}

/* ───────────────────────── datos ───────────────────────── */

/* { instrument, assessments, error } — nunca lanza: si falla, la tarjeta muestra el error */
export async function loadQuestionnaire(appState) {
  try {
    const [instRes, assessRes] = await Promise.all([
      apiService.getWellnessInstruments(),
      apiService.getWellnessAssessments(appState.selectedAstronautId),
    ]);
    return { instrument: instRes.instruments?.[0] || null, assessments: assessRes.assessments || [], error: null };
  } catch (err) {
    return { instrument: null, assessments: [], error: errMsg(err) };
  }
}

const isFinal = (a) => a && a.operational_wellness_state && a.operational_wellness_state !== "ASSESSMENT_INCOMPLETE";
const lastFinal = (q) => (q.assessments || []).find(isFinal) || null;

function ageText(iso) {
  const T = tr(DICT);
  if (!iso) return T.never;
  const h = (Date.now() - new Date(iso).getTime()) / 3600e3;
  if (!Number.isFinite(h)) return T.never;
  const t = h < 1 ? T.lt1h : h < 48 ? fmtT(T.hours, { n: Math.floor(h) }) : fmtT(T.days, { n: Math.floor(h / 24) });
  return fmtT(T.ago, { t });
}

export function questionnaireIsDue(q) {
  if (!q || q.error) return false;
  const a = lastFinal(q);
  if (!a) return true;
  return (Date.now() - new Date(a.created_at).getTime()) / 3600e3 > Q_STALE_HOURS;
}

/* ───────────────────────── tarjeta en la lista ───────────────────────── */

export function questionnaireGroupHTML(q, currentCode) {
  if (!q) return "";
  const T = tr(DICT);
  const a = lastFinal(q);
  const due = questionnaireIsDue(q);
  const cur = currentCode === Q_CODE;
  const val = q.error ? "—" : a ? stateLabel(a.operational_wellness_state) : "—";
  const age = q.error ? "" : ageText(a?.created_at);
  const label = `${T.tileName}: ${val}${age ? `, ${age}` : ""}${due ? `, ${T.pendingTag}` : ""}`;
  return `<h2 class="av-ms-group">${esc(T.group)} <span>1</span></h2>
    <ul class="av-ms-grid av-ms-qgrid">
      <li><button type="button" class="av-ms-tile av-ms-qtile${due ? " is-due" : ""}" data-pick="${Q_CODE}" aria-current="${cur ? "true" : "false"}" aria-label="${esc(label)}">
        <span class="av-ms-tile-top"><span class="av-ms-tile-name" title="${esc(T.tileName)}">${esc(T.tileName)}</span>${due ? `<span class="av-ms-chip is-due">${esc(T.pendingTag)}</span>` : ""}</span>
        <span class="av-ms-tile-bottom">
          <span class="av-ms-tile-val av-ms-qval">${esc(val)}</span>
          <span class="av-ms-tile-age">${esc(age)}</span>
        </span>
      </button></li>
    </ul>`;
}

/* ───────────────────────── panel de registro ───────────────────────── */

/* next: { code, name } del siguiente indicador pendiente (o null) */
export function questionnaireEntryHTML(q, appState, next, backLabel) {
  const T = tr(DICT);
  const a = lastFinal(q);
  const last = a ? fmtT(T.last, { state: stateLabel(a.operational_wellness_state), age: ageText(a.created_at) }) : T.lastNone;
  let body;
  if (q.error) body = `<p class="av-ms-preview is-error" role="alert">${esc(fmtT(T.loadError, { msg: q.error }))}</p>`;
  else if (qui.result) body = resultHTML(qui.result, next);
  else body = formHTML(q, appState);
  return `
  <section class="av-panel av-ms-entry av-ms-q" aria-labelledby="av-ms-entry-title">
    <button type="button" class="av-ms-back" data-act="close">${esc(backLabel)}</button>
    <h2 class="av-ms-entry-title" id="av-ms-entry-title" tabindex="-1">${esc(T.title)}</h2>
    <p class="av-ms-last">${esc(last)} <span class="av-ms-tag">${esc(T.simulated)}</span></p>
    ${body}
    ${q.error ? "" : historyHTML(q)}
    <p class="av-ms-foot">${esc(T.privacy)}</p>
  </section>`;
}

function scaleHTML(dim, T) {
  const key = String(dim.key);
  const def = dim.high_is_good ? 8 : 3;
  const min = Number(dim.min) || 1;
  const max = Number(dim.max) || 10;
  const opts = [];
  for (let n = min; n <= max; n += 1) {
    opts.push(`<label class="av-ms-scale-opt"><input type="radio" id="av-q-${esc(key)}-${n}" name="${esc(key)}" value="${n}" data-q-dim="${esc(key)}" required ${n === def ? "checked" : ""}><span>${n}</span></label>`);
  }
  return `<fieldset class="av-ms-scale">
    <legend>${esc(bt(dim.label))}</legend>
    <div class="av-ms-scale-row">${opts.join("")}</div>
    <div class="av-ms-scale-ends"><span>${min} · ${esc(T.low)}</span><span>${esc(T.high)} · ${max}</span></div>
  </fieldset>`;
}

function formHTML(q, appState) {
  const T = tr(DICT);
  const inst = q.instrument;
  const dims = inst?.dimensions || [];
  const own = isOwnAstronaut(appState);
  const who = !own ? astronautName(appState) : "";
  return `
    <details class="av-ms-how" ${lastFinal(q) ? "" : "open"}>
      <summary>${esc(T.about)}</summary>
      <p class="av-ms-device">${esc(bt(inst?.title) || T.title)}</p>
      <p class="av-ms-device">${esc(T.minutes)}</p>
      ${inst?.disclaimer ? `<p class="av-ms-device">${esc(btLines(inst.disclaimer))}</p>` : ""}
    </details>
    ${who ? `<p class="av-ms-preview"><strong>${esc(fmtT(T.onBehalf, { name: who }))}</strong></p>` : ""}
    <form class="av-ms-form" data-q-form novalidate>
      ${dims.map((d) => scaleHTML(d, T)).join("")}
      <div class="av-ms-field">
        <label for="av-q-sleep">${esc(T.sleepHours)}</label>
        <div class="av-ms-stepper">
          <button type="button" class="av-ms-step" data-q-step="-1" aria-label="${esc(T.less)}">−</button>
          <input id="av-q-sleep" name="sleep" class="av-ms-input" type="text" inputmode="decimal" autocomplete="off" value="${SLEEP.def}" aria-describedby="av-q-status">
          <button type="button" class="av-ms-step" data-q-step="1" aria-label="${esc(T.more)}">+</button>
          <span class="av-ms-unit" aria-hidden="true">h</span>
        </div>
      </div>
      <div class="av-ms-field">
        <label for="av-q-urgency">${esc(T.urgency)}</label>
        <select id="av-q-urgency" class="av-input av-ms-select">
          ${Object.entries(T.urgencyOptions).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}
        </select>
      </div>
      <details class="av-ms-note">
        <summary>${esc(T.reflection)}</summary>
        <textarea id="av-q-reflection" class="av-input av-ms-qtext" rows="3" placeholder="${esc(T.reflectionPh)}" aria-label="${esc(T.reflection)}" aria-describedby="av-q-reflection-hint"></textarea>
        <p class="av-ms-device" id="av-q-reflection-hint">${esc(T.reflectionHint)}</p>
      </details>
      <label class="av-ms-check"><input type="checkbox" id="av-q-share" checked> <span>${esc(T.share)}</span></label>
      <p class="av-ms-preview${qui.draftMsg ? "" : " av-ms-qstatus-empty"}" id="av-q-status" role="status" aria-live="polite">${esc(qui.draftMsg ? qui.draftMsg() : "")}</p>
      <button type="submit" class="av-btn av-btn-primary av-ms-save" data-q-save="final">${esc(T.save)}</button>
      <button type="button" class="av-ms-link av-ms-skip" data-q-save="draft">${esc(T.saveDraft)}</button>
    </form>`;
}

function resultHTML(res, next) {
  const T = tr(DICT);
  const recs = res.recs?.recommendations || [];
  const strong = ["SUPPORT_RECOMMENDED", "PROFESSIONAL_REVIEW", "URGENT_SUPPORT"].includes(res.state);
  return `
  <div class="av-ms-done" id="av-ms-result" tabindex="-1">
    <div class="av-ms-done-head"><span class="av-ms-check" aria-hidden="true">✓</span> ${esc(T.saved)}</div>
    <div class="av-ms-done-state"><span>${esc(T.stateLbl)}:</span> ${stateTag(res.state)}</div>
    <p>${esc(fmtT(T.supportLbl, { s: T.urgencyShort[res.urgency] || res.urgency || "—" }))}</p>
    ${res.recs?.urgent_notice ? `<p>${esc(bt(res.recs.urgent_notice))}</p>` : strong ? `<p>${esc(T.urgentNote)}</p>` : ""}
    <div class="av-ms-qrecs">
      <h3 class="av-ms-group">${esc(T.recsTitle)}</h3>
      ${recs.length
        ? `<ul>${recs.slice(0, 3).map((r) => `<li><strong>${esc(bt(r.title))}</strong>${r.duration_minutes ? ` <small>· ${esc(r.duration_minutes)} min</small>` : ""}<br><span>${esc(btLines(r.instructions))}</span></li>`).join("")}</ul>`
        : `<p class="av-ms-device">${esc(T.recsEmpty)}</p>`}
    </div>
    <div class="av-ms-done-actions">
      ${next ? `<button type="button" class="av-btn av-btn-primary" data-pick="${esc(next.code)}" data-from-result>${esc(fmtT(T.next, { name: next.name }))}</button>` : `<button type="button" class="av-btn av-btn-primary" data-act="close">${esc(T.finish)}</button>`}
      ${strong ? `<button type="button" class="av-btn" data-nav="communication-center">${esc(T.toMessages)}</button>` : ""}
      <button type="button" class="av-btn" data-q-again>${esc(T.again)}</button>
    </div>
  </div>`;
}

function historyHTML(q) {
  const T = tr(DICT);
  const list = q.assessments || [];
  return `<details class="av-ms-how av-ms-qhist">
    <summary>${esc(fmtT(T.history, { n: list.length }))}</summary>
    ${list.length
      ? `<ul>${list.slice(0, 8).map((a) => `<li><span class="av-mono">${esc(fmtGmt(a.created_at))}</span> ${stateTag(a.operational_wellness_state)} <small>${esc(T.urgencyShort[a.support_urgency] || a.support_urgency || "")}</small></li>`).join("")}</ul>`
      : `<p class="av-ms-device">${esc(T.historyEmpty)}</p>`}
  </details>`;
}

/* ───────────────────────── eventos ───────────────────────── */

const parseNum = (raw) => {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/* ctx: { appState, helpers, repaint(), reload(), announce(msg), setFocus(sel) } */
export function bindQuestionnaire(root, q, ctx) {
  const entry = root.querySelector(".av-ms-q");
  if (!entry) return;
  const T = tr(DICT);

  entry.querySelector("[data-q-again]")?.addEventListener("click", () => {
    qui.result = null;
    qui.draftMsg = null;
    ctx.setFocus(".av-ms-q .av-ms-scale input:checked, .av-ms-q .av-ms-scale input");
    ctx.repaint();
  });

  const form = entry.querySelector("[data-q-form]");
  if (!form) return;
  const status = form.querySelector("#av-q-status");
  const sleep = form.querySelector("#av-q-sleep");
  const say = (msg, isError = false) => {
    status.textContent = msg;
    status.className = `av-ms-preview${msg ? "" : " av-ms-qstatus-empty"}${isError ? " is-error" : ""}`;
  };

  form.querySelectorAll("[data-q-step]").forEach((b) =>
    b.addEventListener("click", () => {
      const cur = parseNum(sleep.value) ?? SLEEP.def;
      const v = Math.min(SLEEP.max, Math.max(SLEEP.min, cur + SLEEP.step * Number(b.getAttribute("data-q-step"))));
      sleep.value = String(v);
      sleep.removeAttribute("aria-invalid");
    })
  );

  const submit = async (isDraft) => {
    if (qui.busy) return;
    const hours = parseNum(sleep.value);
    if (hours === null || hours < SLEEP.min || hours > SLEEP.max) {
      sleep.setAttribute("aria-invalid", "true");
      sleep.focus();
      say(T.badSleep, true);
      return;
    }
    const dims = q.instrument?.dimensions || [];
    const payload = {
      astronaut_id: ctx.appState.selectedAstronautId,
      mission_id: ctx.appState.selectedMissionId,
      is_draft: isDraft,
      sleep_hours: hours,
      support_urgency: form.querySelector("#av-q-urgency").value,
      private_reflection: form.querySelector("#av-q-reflection").value,
      share_operational_signal_with_leader: form.querySelector("#av-q-share").checked,
      is_simulated: true,
    };
    payload.request_additional_support = payload.support_urgency !== "NONE";
    for (const d of dims) {
      const checked = form.querySelector(`input[data-q-dim="${CSS.escape(String(d.key))}"]:checked`);
      if (!checked) {
        if (!isDraft) {
          form.querySelector(`input[data-q-dim="${CSS.escape(String(d.key))}"]`)?.focus();
          say(T.missing, true);
          return;
        }
        continue;
      }
      payload[d.key] = parseInt(checked.value, 10);
    }

    qui.busy = true;
    form.querySelectorAll("[data-q-save]").forEach((b) => (b.disabled = true));
    say(T.saving);
    try {
      const res = await apiService.createWellnessAssessment(payload);
      const st = res.assessment?.operational_wellness_state;
      if (isDraft) {
        qui.draftMsg = () => tr(DICT).savedDraft;
        ctx.helpers.showToast?.(tr(DICT).savedDraft);
      } else {
        let recs = null;
        try {
          recs = await apiService.getWellnessRecommendations(ctx.appState.selectedAstronautId, st || "WELLNESS_STABLE");
        } catch {
          recs = null;
        }
        qui.draftMsg = null;
        qui.result = { state: st, urgency: payload.support_urgency, recs };
        ctx.setFocus("#av-ms-result");
        const msg = fmtT(tr(DICT).savedToast, { state: stateLabel(st) });
        ctx.helpers.showToast?.(msg);
        ctx.announce(msg);
      }
      qui.busy = false;
      await ctx.reload();
    } catch (err) {
      qui.busy = false;
      form.querySelectorAll("[data-q-save]").forEach((b) => (b.disabled = false));
      say(fmtT(T.saveError, { msg: errMsg(err) }), true);
    }
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit(false);
  });
  form.querySelector('[data-q-save="draft"]').addEventListener("click", () => submit(true));
}
