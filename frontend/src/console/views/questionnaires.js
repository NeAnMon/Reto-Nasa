/* SEMSA · Consola · Bienestar → "Cuestionarios"
 *
 * Pestaña interna de Bienestar (wellbeing.js) con dos bloques:
 *   1. Cuestionario de bienestar psicológico (instrumento DEMO del backend). Volvió aquí desde
 *      "Registrar medición", donde sus escalas 1–10 se desbordaban: ahora la escala es una rejilla
 *      que pasa de 10 a 5 columnas en pantallas estrechas (questionnaires.css).
 *   2. Chequeo del turno: estrés, FC en reposo, carga NASA-TLX y test de reacción tipo PVT
 *      (shift-check.js). El sueño y el ánimo NO se vuelven a preguntar: se muestran los del
 *      check-in de Bienestar → Hoy (mismo dato, misma escala), con un botón para ir a Hoy.
 *
 * Contrato con el backend del cuestionario (sin cambios respecto a la versión anterior):
 *   GET  /wellness/instruments · GET/POST /wellness/assessments · GET /wellness/recommendations
 *   Además, GET /wellness/quick-checkin para el sueño y el ánimo del día.
 *
 * Privacidad: la reflexión es privada por defecto; al líder solo le llega, si se autoriza,
 * la señal operativa. El estado se muestra como etiqueta de texto (sin colores de alarma).
 * No se usan data-act / data-nav / data-wb-go: la navegación de este módulo va con data-qz-*.
 */
import { apiService } from "../../services/api.js";
import { tr, fmt as fmtT } from "../../i18n/i18n.js";
import { bt, btLines } from "/src/i18n/backend.js";
import { esc, stateLabel, stateTag, fmt as fmtGmt, errMsg, isOwnAstronaut, astronautName } from "./more-common.js";
import { shiftCheckHTML, bindShiftCheck, stopShiftCheck } from "./shift-check.js";

/* Sin una evaluación final en esta ventana, el cuestionario se marca como pendiente */
const Q_STALE_HOURS = 7 * 24;
/* Límites del backend (schemas.py → WellnessAssessmentCreate: sleep_hours 0–16, reflexión libre) */
const SLEEP = { min: 0, max: 16, def: 7 };

const DICT = {
  es: {
    title: "Cuestionario de bienestar psicológico",
    sub: "Semanal · unos 5 minutos",
    never: "Sin respuestas",
    ago: "hace {t}",
    lt1h: "menos de 1 h",
    hours: "{n} h",
    days: "{n} d",
    pendingTag: "Pendiente",
    simulated: "SIMULADO",
    last: "Último: {state} · {age}",
    lastNone: "Aún no has respondido este cuestionario.",
    about: "Antes de empezar",
    minutes: "Responde según cómo te has sentido estos días. Cada pregunta va de 1 a 10.",
    onBehalf: "Estás registrando una evaluación para {name}. La reflexión privada solo la verá esa persona.",
    low: "Poco",
    high: "Mucho",
    sleepHours: "Horas de sueño recientes",
    sleepHint: "Entre 0 y 16 horas.",
    sleepFromToday: "Entre 0 y 16 horas. Rellenado con tu check-in de hoy.",
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
    reflection: "Reflexión privada (opcional)",
    reflectionHint: "Privada por defecto: el líder en tierra no la ve.",
    share: "Permitir enviar al líder solo la señal operativa de seguimiento (sin mis respuestas ni mi texto privado).",
    save: "Guardar cuestionario",
    saveDraft: "Guardar borrador",
    saving: "Guardando…",
    badSleep: "Indica las horas de sueño con un número entre 0 y 16.",
    missing: "Responde todas las preguntas de la escala.",
    savedDraft: "Borrador guardado de forma privada.",
    saved: "Cuestionario guardado",
    savedToast: "Cuestionario de bienestar registrado. Estado: {state}.",
    saveError: "No se pudo guardar el cuestionario: {msg}",
    stateLbl: "Estado operativo",
    supportLbl: "Apoyo solicitado: {s}",
    recsTitle: "Recomendaciones preventivas",
    recsEmpty: "Sin recomendaciones disponibles.",
    urgentNote: "Si necesitas hablar ahora, escribe a tu equipo de apoyo desde Mensajes.",
    again: "Responder otra vez",
    toMessages: "Ir a Mensajes",
    history: "Historial ({n})",
    historyEmpty: "Aún no hay evaluaciones registradas.",
    privacy: "Tus respuestas detalladas y tu reflexión son privadas. Herramienta educativa: no emite diagnósticos.",
    loadError: "No se pudo cargar el cuestionario: {msg}",
    retry: "Reintentar",
  },
  en: {
    title: "Psychological wellbeing questionnaire",
    sub: "Weekly · about 5 minutes",
    never: "No answers",
    ago: "{t} ago",
    lt1h: "under 1 h",
    hours: "{n} h",
    days: "{n} d",
    pendingTag: "Due",
    simulated: "SIMULATED",
    last: "Last: {state} · {age}",
    lastNone: "You haven't answered this questionnaire yet.",
    about: "Before you start",
    minutes: "Answer based on how you've felt these days. Each question goes from 1 to 10.",
    onBehalf: "You're recording an assessment for {name}. Only that person will see the private reflection.",
    low: "Low",
    high: "High",
    sleepHours: "Recent hours of sleep",
    sleepHint: "Between 0 and 16 hours.",
    sleepFromToday: "Between 0 and 16 hours. Filled in from today's check-in.",
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
    reflection: "Private reflection (optional)",
    reflectionHint: "Private by default: the ground leader can't see it.",
    share: "Allow sending only the operational follow-up signal to the leader (not my answers or my private text).",
    save: "Save questionnaire",
    saveDraft: "Save draft",
    saving: "Saving…",
    badSleep: "Enter the hours of sleep as a number between 0 and 16.",
    missing: "Answer every scale question.",
    savedDraft: "Draft saved privately.",
    saved: "Questionnaire saved",
    savedToast: "Wellbeing questionnaire recorded. Status: {state}.",
    saveError: "Couldn't save the questionnaire: {msg}",
    stateLbl: "Operational status",
    supportLbl: "Support requested: {s}",
    recsTitle: "Preventive recommendations",
    recsEmpty: "No recommendations available.",
    urgentNote: "If you need to talk now, write to your support team from Messages.",
    again: "Answer again",
    toMessages: "Go to Messages",
    history: "History ({n})",
    historyEmpty: "No assessments recorded yet.",
    privacy: "Your detailed answers and your reflection are private. Educational tool: it does not provide diagnoses.",
    loadError: "Couldn't load the questionnaire: {msg}",
    retry: "Retry",
  },
};

/* Estado del cuestionario (sobrevive a los repintados y al cambio de idioma) */
const qui = { aid: undefined, result: null, draftMsg: null, busy: false };

/* ───────────────────────── utilidades ───────────────────────── */

function ensureQzCss() {
  if (document.getElementById("av-qz-css")) return;
  const link = document.createElement("link");
  link.id = "av-qz-css";
  link.rel = "stylesheet";
  link.href = new URL("./questionnaires.css", import.meta.url).href;
  document.head.appendChild(link);
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

function isDue(q) {
  if (!q || q.error) return false;
  const a = lastFinal(q);
  if (!a) return true;
  return (Date.now() - new Date(a.created_at).getTime()) / 3600e3 > Q_STALE_HOURS;
}

const parseNum = (raw) => {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/* Check-in de hoy (GMT) más reciente: { sleep_hours, mood, created_at } o null */
function todayCheckin(items) {
  const today = new Date().toISOString().slice(0, 10);
  return (items || []).find((c) => String(c.created_at || "").slice(0, 10) === today) || null;
}

/* ───────────────────────── datos ───────────────────────── */

async function loadQuestionnaire(aid) {
  try {
    const [instRes, assessRes] = await Promise.all([
      apiService.getWellnessInstruments(),
      apiService.getWellnessAssessments(aid),
    ]);
    return { instrument: instRes.instruments?.[0] || null, assessments: assessRes.assessments || [], error: null };
  } catch (err) {
    return { instrument: null, assessments: [], error: errMsg(err) };
  }
}

async function loadCheckins(aid) {
  if (!aid) return [];
  try {
    const res = await apiService.getQuickCheckins(aid, 14);
    return Array.isArray(res?.items) ? res.items : [];
  } catch {
    return []; // sin dato del día: el chequeo del turno lo indica y enlaza a Hoy
  }
}

/* ───────────────────────── vista ───────────────────────── */

/**
 * Pinta la pestaña "Cuestionarios" dentro de `panel`.
 * c: { appState, helpers, isStale(), goTab(sub) }
 */
export async function renderChecks(panel, c) {
  ensureQzCss();
  stopShiftCheck();
  const { appState } = c;
  const aid = appState.selectedAstronautId;
  if (qui.aid !== aid) {
    qui.aid = aid;
    qui.result = null;
    qui.draftMsg = null;
  }
  qui.busy = false;

  const [q, items] = await Promise.all([loadQuestionnaire(aid), loadCheckins(aid)]);
  if (c.isStale()) return;
  const today = todayCheckin(items);
  const st = { q, today };

  panel.innerHTML = `<div class="av-wb-cols av-qz-root" data-wb-sub="checks">
      <div class="av-wb-col" data-qz-q>${questionnaireHTML(st, appState)}</div>
      <div class="av-wb-col" data-qz-shift>${shiftCheckHTML(appState, today)}</div>
    </div>`;

  const root = panel.querySelector(".av-qz-root");
  root.addEventListener("click", (e) => {
    const go = e.target.closest("[data-qz-go]");
    if (go) {
      c.helpers.navigateToSection?.(go.getAttribute("data-qz-go"));
      return;
    }
    const tab = e.target.closest("[data-qz-tab]");
    if (tab) c.goTab?.(tab.getAttribute("data-qz-tab"));
  });

  const repaintQ = (focusSel) => {
    const box = root.querySelector("[data-qz-q]");
    if (!box || !box.isConnected) return;
    box.innerHTML = questionnaireHTML(st, appState);
    bindQuestionnaire(box, st, c, repaintQ);
    if (focusSel) box.querySelector(focusSel)?.focus();
  };
  bindQuestionnaire(root.querySelector("[data-qz-q]"), st, c, repaintQ);
  bindShiftCheck(root.querySelector("[data-qz-shift]"), { appState, helpers: c.helpers, today });
}

/* ───────────────────────── cuestionario ───────────────────────── */

function questionnaireHTML(st, appState) {
  const T = tr(DICT);
  const { q } = st;
  const a = lastFinal(q);
  const due = isDue(q);
  const last = a ? fmtT(T.last, { state: stateLabel(a.operational_wellness_state), age: ageText(a.created_at) }) : T.lastNone;
  let body;
  if (q.error) {
    body = `<p class="av-mx-p" role="alert">${esc(fmtT(T.loadError, { msg: q.error }))}</p>
      <div><button type="button" class="av-btn" data-qz-retry>${esc(T.retry)}</button></div>`;
  } else if (qui.result) body = resultHTML(qui.result);
  else body = formHTML(st, appState);
  return `<section class="av-panel" aria-labelledby="av-qz-h">
      <div class="av-panel-head">
        <h3 class="av-h3" id="av-qz-h" tabindex="-1">${esc(T.title)}</h3>
        <span class="av-mx-btns">${due ? `<span class="av-mx-tag av-mx-tag-strong">${esc(T.pendingTag)}</span>` : ""}<span class="av-mx-tag">${esc(T.simulated)}</span></span>
      </div>
      <div class="av-mx-pad av-qz-body">
        <p class="av-mx-p av-sub">${esc(T.sub)} · ${esc(last)}</p>
        ${body}
        ${q.error ? "" : historyHTML(q)}
        <p class="av-mx-p av-sub av-qz-foot">${esc(T.privacy)}</p>
      </div>
    </section>`;
}

function scaleHTML(dim, T) {
  const key = String(dim.key);
  const min = Number(dim.min) || 1;
  const max = Number(dim.max) || 10;
  const def = dim.high_is_good ? 8 : 3;
  const opts = [];
  for (let n = min; n <= max; n += 1) {
    const id = `av-qz-${key}-${n}`;
    opts.push(`<label class="av-qz-opt" for="${esc(id)}"><input type="radio" id="${esc(id)}" name="av-qz-${esc(key)}" value="${n}" data-qz-dim="${esc(key)}" ${n === def ? "checked" : ""}><span class="av-mono">${n}</span></label>`);
  }
  return `<fieldset class="av-qz-scale">
      <legend class="av-wb-legend">${esc(bt(dim.label))}</legend>
      <div class="av-qz-row">${opts.join("")}</div>
      <div class="av-qz-ends" aria-hidden="true"><span>${min} · ${esc(T.low)}</span><span>${esc(T.high)} · ${max}</span></div>
    </fieldset>`;
}

function formHTML(st, appState) {
  const T = tr(DICT);
  const { q, today } = st;
  const inst = q.instrument;
  const dims = inst?.dimensions || [];
  const own = isOwnAstronaut(appState);
  const who = !own ? astronautName(appState) : "";
  const sleepDef = own && today && Number.isFinite(Number(today.sleep_hours)) ? Number(today.sleep_hours) : SLEEP.def;
  const fromToday = own && today && Number.isFinite(Number(today.sleep_hours));
  return `
    <details class="av-wb-how" ${lastFinal(q) ? "" : "open"}>
      <summary>${esc(T.about)}</summary>
      <p class="av-mx-p"><strong>${esc(bt(inst?.title) || T.title)}</strong></p>
      <p class="av-mx-p">${esc(T.minutes)}</p>
      ${inst?.disclaimer ? `<p class="av-mx-p av-sub">${esc(btLines(inst.disclaimer))}</p>` : ""}
    </details>
    ${who ? `<p class="av-mx-note">${esc(fmtT(T.onBehalf, { name: who }))}</p>` : ""}
    <form class="av-mx-form" id="av-qz-form" novalidate>
      ${dims.map((d) => scaleHTML(d, T)).join("")}
      <div class="av-field av-wb-hours">
        <label for="av-qz-sleep">${esc(T.sleepHours)}</label>
        <input class="av-input" type="number" inputmode="decimal" min="${SLEEP.min}" max="${SLEEP.max}" step="0.5"
          id="av-qz-sleep" value="${esc(sleepDef)}" aria-describedby="av-qz-sleep-hint" />
        <span class="av-sub" id="av-qz-sleep-hint">${esc(fromToday ? T.sleepFromToday : T.sleepHint)}</span>
      </div>
      <div class="av-field">
        <label for="av-qz-urgency">${esc(T.urgency)}</label>
        <select id="av-qz-urgency" class="av-input">
          ${Object.entries(T.urgencyOptions).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}
        </select>
      </div>
      <div class="av-field">
        <label for="av-qz-reflection">${esc(T.reflection)}</label>
        <textarea id="av-qz-reflection" class="av-input av-mx-textarea" rows="3" aria-describedby="av-qz-reflection-hint"></textarea>
        <span class="av-sub" id="av-qz-reflection-hint">${esc(T.reflectionHint)}</span>
      </div>
      <label class="av-mx-check av-qz-check"><input type="checkbox" id="av-qz-share" checked> <span>${esc(T.share)}</span></label>
      <div class="av-mx-btns">
        <button type="submit" class="av-btn av-btn-primary" data-qz-save="final">${esc(T.save)}</button>
        <button type="button" class="av-btn" data-qz-save="draft">${esc(T.saveDraft)}</button>
      </div>
      <p class="av-mx-status" id="av-qz-status" role="status" aria-live="polite" tabindex="-1">${esc(qui.draftMsg ? qui.draftMsg() : "")}</p>
    </form>`;
}

function resultHTML(res) {
  const T = tr(DICT);
  const recs = res.recs?.recommendations || [];
  const strong = ["SUPPORT_RECOMMENDED", "PROFESSIONAL_REVIEW", "URGENT_SUPPORT"].includes(res.state);
  return `<div class="av-qz-done" id="av-qz-result" tabindex="-1">
      <p class="av-mx-p"><strong>✓ ${esc(T.saved)}</strong></p>
      <p class="av-mx-p av-mx-btns"><span class="av-sub">${esc(T.stateLbl)}:</span> ${stateTag(res.state)}</p>
      <p class="av-mx-p">${esc(fmtT(T.supportLbl, { s: T.urgencyShort[res.urgency] || res.urgency || "—" }))}</p>
      ${res.recs?.urgent_notice ? `<p class="av-mx-note">${esc(bt(res.recs.urgent_notice))}</p>` : strong ? `<p class="av-mx-note">${esc(T.urgentNote)}</p>` : ""}
      <h4 class="av-wb-legend">${esc(T.recsTitle)}</h4>
      ${recs.length
        ? `<ul class="av-qz-recs">${recs.slice(0, 3).map((r) => `<li><strong>${esc(bt(r.title))}</strong>${r.duration_minutes ? ` <span class="av-sub">· ${esc(r.duration_minutes)} min</span>` : ""}<br><span class="av-sub">${esc(btLines(r.instructions))}</span></li>`).join("")}</ul>`
        : `<p class="av-mx-p av-sub">${esc(T.recsEmpty)}</p>`}
      <div class="av-mx-btns">
        ${strong ? `<button type="button" class="av-btn av-btn-primary" data-qz-go="communication-center">${esc(T.toMessages)}</button>` : ""}
        <button type="button" class="av-btn" data-qz-again>${esc(T.again)}</button>
      </div>
    </div>`;
}

function historyHTML(q) {
  const T = tr(DICT);
  const list = q.assessments || [];
  return `<details class="av-wb-how av-qz-hist">
      <summary>${esc(fmtT(T.history, { n: list.length }))}</summary>
      ${list.length
        ? `<ul>${list.slice(0, 8).map((a) => `<li><span class="av-mono av-sub">${esc(fmtGmt(a.created_at))}</span> ${stateTag(a.operational_wellness_state)} <span class="av-sub">${esc(T.urgencyShort[a.support_urgency] || a.support_urgency || "")}</span></li>`).join("")}</ul>`
        : `<p class="av-mx-p av-sub">${esc(T.historyEmpty)}</p>`}
    </details>`;
}

function bindQuestionnaire(box, st, c, repaint) {
  if (!box) return;
  box.querySelector("[data-qz-retry]")?.addEventListener("click", async () => {
    st.q = await loadQuestionnaire(c.appState.selectedAstronautId);
    repaint("#av-qz-h");
  });
  box.querySelector("[data-qz-again]")?.addEventListener("click", () => {
    qui.result = null;
    qui.draftMsg = null;
    repaint(".av-qz-scale input:checked");
  });

  const form = box.querySelector("#av-qz-form");
  if (!form) return;
  const T = tr(DICT);
  const status = form.querySelector("#av-qz-status");
  const sleep = form.querySelector("#av-qz-sleep");
  const say = (msg) => { status.textContent = msg; };

  const submit = async (isDraft) => {
    if (qui.busy) return;
    const hours = parseNum(sleep.value);
    if (hours === null || hours < SLEEP.min || hours > SLEEP.max) {
      sleep.setAttribute("aria-invalid", "true");
      sleep.focus();
      say(T.badSleep);
      return;
    }
    sleep.removeAttribute("aria-invalid");
    const dims = st.q.instrument?.dimensions || [];
    const payload = {
      astronaut_id: c.appState.selectedAstronautId,
      mission_id: c.appState.selectedMissionId,
      is_draft: isDraft,
      sleep_hours: Math.round(hours * 10) / 10,
      support_urgency: form.querySelector("#av-qz-urgency").value,
      private_reflection: form.querySelector("#av-qz-reflection").value,
      share_operational_signal_with_leader: form.querySelector("#av-qz-share").checked,
      is_simulated: true,
    };
    payload.request_additional_support = payload.support_urgency !== "NONE";
    for (const d of dims) {
      const key = String(d.key);
      const checked = form.querySelector(`input[data-qz-dim="${CSS.escape(key)}"]:checked`);
      if (!checked) {
        if (!isDraft) {
          form.querySelector(`input[data-qz-dim="${CSS.escape(key)}"]`)?.focus();
          say(T.missing);
          return;
        }
        continue;
      }
      payload[key] = parseInt(checked.value, 10);
    }

    qui.busy = true;
    form.querySelectorAll("[data-qz-save]").forEach((b) => (b.disabled = true));
    say(T.saving);
    try {
      const res = await apiService.createWellnessAssessment(payload);
      const state = res.assessment?.operational_wellness_state;
      if (isDraft) {
        qui.draftMsg = () => tr(DICT).savedDraft;
        c.helpers.showToast?.(tr(DICT).savedDraft);
      } else {
        let recs = null;
        try {
          recs = await apiService.getWellnessRecommendations(c.appState.selectedAstronautId, state || "WELLNESS_STABLE");
        } catch {
          recs = null;
        }
        qui.draftMsg = null;
        qui.result = { state, urgency: payload.support_urgency, recs };
        c.helpers.showToast?.(fmtT(tr(DICT).savedToast, { state: stateLabel(state) }));
      }
      qui.busy = false;
      if (c.isStale()) return;
      st.q = await loadQuestionnaire(c.appState.selectedAstronautId);
      if (c.isStale()) return;
      repaint(isDraft ? "#av-qz-status" : "#av-qz-result");
    } catch (err) {
      qui.busy = false;
      form.querySelectorAll("[data-qz-save]").forEach((b) => (b.disabled = false));
      say(fmtT(T.saveError, { msg: errMsg(err) }));
    }
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit(false);
  });
  form.querySelector('[data-qz-save="draft"]').addEventListener("click", () => submit(true));
}

