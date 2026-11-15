/* SEMSA · Consola · pestaña principal "Bienestar"
 * Riesgo NASA HRP de aislamiento y confinamiento: fatiga mental, sueño y ritmo circadiano,
 * ánimo y dinámica de equipo. Contrato: docs/CONTRATO_AISLAMIENTO.md (§1–3; §4 solo resumen/enlace).
 *
 * Subsecciones (pestañas internas WAI-ARIA, la elegida se recuerda en la sesión):
 *   - Hoy: check-in rápido (sueño, ánimo, energía, aislamiento, nota privada) + tarjeta de sueño.
 *   - Cuestionarios: cuestionario de bienestar psicológico (antes en "Registrar medición") y chequeo
 *     del turno: estrés, FC en reposo, carga NASA-TLX y test de reacción tipo PVT (questionnaires.js,
 *     shift-check.js). Sueño y ánimo no se repiten: se toman del check-in de Hoy.
 *   - Check-in emocional: cuestionarios del equipo de apoyo (emotional.js), con contador de pendientes.
 *   - Evaluación cognitiva: atención, memoria y tiempo de reacción (cognitive.js).
 *     Antes eran secciones aparte enlazadas desde Hoy; ahora son pestañas como las demás (issue #26).
 *   - Respiración: respiración guiada en cuadrado 4-4-4-4 con rondas y contador local (breathing.js).
 *   - Tiempo libre: hobbies breves con filtros, pasos, fuente NASA y registro "Lo hice".
 *   - Tripulación: actividades de integración (proponer, unirse, asistencia, quórum, meta semanal).
 *   ("Contacto con Tierra" ya no es una pestaña: es una recomendación que solo aparece como alerta
 *    temprana, ver backend/app/rules/early_warnings.py; se muestra en Alertas y en el Resumen.)
 *
 * Privacidad: líder/administración reciben ánimo, energía, aislamiento y notas como null → "privado".
 * Estados emocionales siempre como etiqueta de texto, sin colores de alarma.
 * No se usan data-act / data-nav / data-nav-section (los escuchan console.js y app.js): aquí todo va con data-wb-*.
 */
import { apiService } from "../../services/api.js";
import { tr, fmt as fmtT, fmtNum, locale } from "../../i18n/i18n.js";
import { bt, btLines } from "/src/i18n/backend.js";
import { renderBreathing } from "./breathing.js";
import { renderChecks } from "./questionnaires.js";
import { renderEmotionalView } from "./emotional.js";
import { renderCognitiveView } from "./cognitive.js";
import {
  esc, tag, errMsg, ensureCss, makeStale, roleOf, isOwnAstronaut, astronautName,
  snapshotFields, restoreFields, langChanged,
} from "./more-common.js";

/* Límites de los formularios: los MISMOS que valida el backend
   (backend/app/schemas/schemas.py → QuickCheckinCreate, LeisureLogCreate, CrewActivityCreate;
   rango de fecha en isolation_router.py → create_crew_activity). Si cambian allí, cambiar aquí. */
const LIMITS = {
  sleepMin: 0, sleepMax: 16, noteMax: 500, dedupMax: 120,      // QuickCheckinCreate
  leisureMin: 1, leisureMax: 180,                              // LeisureLogCreate.minutes
  crewTitleMin: 3, crewTitleMax: 150, crewDescMax: 1000,       // CrewActivityCreate
  crewDurMin: 5, crewDurMax: 240,
  crewPastDays: 7, crewFutureDays: 180,
};

/* Una clave de deduplicación por envío del formulario (se reutiliza al reencolar) */
function newDedupKey() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `CHECKIN-${crypto.randomUUID()}`;
    }
  } catch {
    /* contexto no seguro: respaldo abajo */
  }
  return `CHECKIN-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

const DICT = {
  es: {
    title: "Bienestar",
    intro: "Un espacio para cuidar el descanso, el ánimo y la conexión con los demás durante la misión. Todo lo que escribas aquí es privado por defecto.",
    introLeader: "Resumen de bienestar de {name}. Por privacidad, ánimo, energía, sensación de aislamiento y notas solo los ve la propia persona.",
    crewModeOffTitle: "Vista de supervisión",
    crewModeOffText: "El check-in de hoy, los cuestionarios, el chequeo del turno, el check-in emocional y la evaluación cognitiva los responde cada tripulante con su cuenta.",
    crewModeEnter: "Responder como {name}",
    crewModeOnTitle: "Modo tripulante",
    crewModeOnText: "Respondes como {name}. Lo que registres queda en su cuenta.",
    crewModeExit: "Volver a supervisión",
    crewModeBusy: "Cambiando de cuenta…",
    crewModeFailed: "No se pudo cambiar de cuenta: {msg}",
    tabsAria: "Secciones de bienestar",
    tabs: { today: "Hoy", checks: "Cuestionarios", emotional: "Check-in emocional", cognitive: "Evaluación cognitiva", breath: "Respiración", leisure: "Tiempo libre", crew: "Tripulación" },
    loading: "Cargando…",
    retry: "Reintentar",
    noData: "—",
    private: "privado",
    yes: "Sí",
    no: "No",
    minutes: "min",
    hoursUnit: "h",
    gmt: "GMT",
    selectCrew: "Elige un tripulante en el selector superior para ver su resumen.",
    needsLink: "Esta acción necesita enlace con Tierra. Vuelve a intentarlo cuando se restablezca la conexión.",
    // Hoy · check-in
    ciTitle: "Check-in de hoy",
    ciSub: "Un minuto para contar cómo has dormido y cómo estás.",
    sleepHours: "Horas de sueño (última noche)",
    sleepHoursHint: "Entre 0 y 16 horas.",
    sleepQuality: "Calidad del sueño",
    mood: "Ánimo",
    energy: "Energía",
    scales: {
      sleep_quality: ["Muy mala", "Mala", "Normal", "Buena", "Muy buena"],
      mood: ["Muy bajo", "Bajo", "Normal", "Bien", "Muy bien"],
      energy: ["Agotado/a", "Baja", "Normal", "Buena", "Con mucha energía"],
    },
    isolated: "Hoy me siento aislado/a o desconectado/a",
    note: "Nota privada (opcional)",
    noteHint: "Solo tú la ves. Máximo 500 caracteres.",
    save: "Guardar check-in",
    saveQueue: "Guardar en la cola (sin enlace)",
    saving: "Guardando…",
    offlineNote: "Sin enlace con Tierra (simulado). Tu check-in se guardará en este equipo y se enviará al reconectar.",
    badHours: "Indica las horas de sueño con un número entre 0 y 16.",
    savedOk: "Check-in guardado. Gracias por tomarte este momento.",
    savedCare: "Check-in guardado. Parece que estos días están siendo exigentes: si te apetece, hablarlo puede ayudar.",
    queued: "Sin enlace: check-in guardado en la cola local ({n} pendientes). Se enviará al reconectar.",
    queuedNet: "No hubo respuesta de Tierra: guardamos tu check-in en la cola local para enviarlo más tarde.",
    saveError: "No se pudo guardar el check-in: {msg}",
    careTitle: "¿Hablamos?",
    careText: "Tus últimos registros sugieren que vendría bien un momento de apoyo. No es una alarma: el check-in emocional o una conversación con tu equipo pueden ayudar.",
    careEmotional: "Hacer el check-in emocional",
    // Hoy · sueño
    sleepTitle: "Sueño y ritmo circadiano",
    avg7: "Media de sueño (7 días)",
    under6: "Noches de menos de 6 h",
    checkins7: "Check-ins esta semana",
    tipLabel: "Consejo",
    sleepWhy: "En órbita el día y la noche cambian cada 90 minutos. Dormir a horas regulares y cuidar la luz antes de acostarte ayuda a mantener el ritmo circadiano.",
    flag: { OK: "Sin señales de atención", NEEDS_CHECK_IN: "Buen momento para hablar" },
    flagLabel: "Seguimiento",
    sleepError: "No se pudo cargar el resumen de sueño: {msg}",
    recentTitle: "Últimos registros",
    recentEmpty: "Aún no hay check-ins. El primero tarda menos de un minuto.",
    quality: "Calidad",
    isolatedShort: "Aislamiento",
    noteShort: "Nota",
    // Pestaña Check-in emocional · pendientes
    toolPending: "{n} pendientes",
    // Tiempo libre
    leisureTitle: "Tiempo libre",
    leisureSub: "Pausas breves que ayudan a desconectar",
    leisureIntro: "En misiones largas, pequeñas rutinas propias —cuidar plantas, leer, escuchar música— ayudan a sobrellevar el aislamiento. Elige lo que te apetezca: no es una tarea más.",
    weekOwn: "Llevas {n} min de tiempo libre esta semana.",
    weekOther: "{name}: {n} min de tiempo libre esta semana.",
    filterDur: "Duración",
    filterCat: "Categoría",
    durAny: "Cualquier duración",
    durMax: "Hasta {n} min",
    catAll: "Todas",
    categories: {
      PLANTS: "Plantas", READING: "Lectura", GAMES: "Juegos", MUSIC: "Música",
      ART: "Arte", PHOTOGRAPHY: "Fotografía", WRITING: "Escritura", MOVEMENT: "Movimiento",
    },
    solo: { SOLO: "En solitario", GROUP: "En grupo", BOTH: "Solo o en grupo" },
    howTo: "Cómo hacerlo",
    source: "Fuente: {t}",
    newTab: "(se abre en una pestaña nueva)",
    didIt: "Lo hice",
    logMinutes: "Minutos",
    logJoy: "¿Cuánto lo disfrutaste?",
    joy: ["Nada", "Poco", "Algo", "Bastante", "Mucho"],
    logSave: "Guardar",
    logCancel: "Cancelar",
    logged: "¡Anotado! {min} min de «{t}».",
    loggedXp: "¡Anotado! {min} min de «{t}» · +{xp} XP.",
    logError: "No se pudo guardar: {msg}",
    badMinutes: "Indica los minutos con un número entre 1 y 180.",
    leisureEmpty: "No hay actividades con estos filtros. Prueba con otra duración o categoría.",
    leisureError: "No se pudo cargar el tiempo libre",
    lastTitle: "Tus últimas pausas",
    // Tripulación
    crewTitle: "Actividades de tripulación",
    crewSub: "Tiempo compartido fuera de la agenda",
    crewIntro: "Compartir una comida, una película o un rato en el huerto refuerza la cohesión del equipo, uno de los factores que NASA vigila en misiones de aislamiento.",
    goal: "Meta semanal: {done} de {target} actividades completadas.",
    goalAria: "Progreso de la meta semanal",
    status: { SCHEDULED: "Programada", COMPLETED: "Completada", CANCELLED: "Cancelada" },
    responses: { PENDING: "Sin responder", JOINED: "Se apunta", DECLINED: "No puede" },
    attendedWord: "asistió",
    yourResponse: "Tu respuesta: {r}",
    by: "Propuesta por {name}",
    quorum: "Asistencia: {a} de {q} necesarias para completarla",
    quorumAria: "Asistencia frente al quórum",
    participants: "Participantes",
    join: "Me apunto",
    decline: "No puedo",
    attend: "He asistido",
    attendedYou: "Tu asistencia está registrada.",
    attendFrom: "Podrás confirmar tu asistencia desde {when}.",
    noQuorum: "No alcanzó el quórum",
    cancel: "Cancelar actividad",
    cancelConfirm: "¿Cancelar esta actividad para toda la tripulación?",
    crewEmpty: "Aún no hay actividades programadas. ¿Por qué no propones una comida compartida o una noche de película?",
    crewError: "No se pudieron cargar las actividades de tripulación",
    pastTitle: "Recientes",
    propose: "Proponer una actividad",
    tpl: "Tipo de actividad",
    when: "Fecha y hora (GMT)",
    dur: "Duración (min)",
    customTitle: "Título (opcional, 3–150 caracteres)",
    customDesc: "Descripción (opcional, máx. 1000 caracteres)",
    proposeSubmit: "Proponer a la tripulación",
    proposed: "Actividad propuesta. La tripulación ya puede apuntarse.",
    responded: "Respuesta guardada.",
    attendedOk: "Asistencia registrada. ¡Gracias por sumarte!",
    cancelled: "Actividad cancelada.",
    actionError: "No se pudo completar la acción: {msg}",
    badWhen: "Indica una fecha y hora futuras, como máximo dentro de 180 días.",
    badTitle: "El título debe tener entre 3 y 150 caracteres (o déjalo vacío para usar el de la plantilla).",
    badDesc: "La descripción admite como máximo 1000 caracteres.",
    badDur: "Indica la duración con un número entre 5 y 240 minutos.",
    catalogError: "No se pudo cargar el catálogo de actividades; inténtalo más tarde.",
    completeAct: "Marcar como cumplida",
    completedOk: "Actividad o misión marcada como cumplida. ¡Meta semanal de tripulación actualizada!",
    suggestionsTitle: "Sugerencias y misiones de tripulación",
    suggestionsSub: "Actividades recomendadas por NASA para reforzar la cohesión",
    completeSuggestion: "Cumplir sugerencia / misión",
  },
  en: {
    title: "Well-being",
    intro: "A space to look after your rest, your mood and your connection with others during the mission. Everything you write here is private by default.",
    introLeader: "Well-being summary for {name}. For privacy, mood, energy, feeling isolated and notes are only visible to that person.",
    crewModeOffTitle: "Supervision view",
    crewModeOffText: "Today's check-in, the questionnaires, the shift check, the emotional check-in and the cognitive assessment are answered by each crew member with their own account.",
    crewModeEnter: "Answer as {name}",
    crewModeOnTitle: "Crew mode",
    crewModeOnText: "You are answering as {name}. Everything you log is saved to their account.",
    crewModeExit: "Back to supervision",
    crewModeBusy: "Switching account…",
    crewModeFailed: "Could not switch account: {msg}",
    tabsAria: "Well-being sections",
    tabs: { today: "Today", checks: "Questionnaires", emotional: "Emotional check-in", cognitive: "Cognitive assessment", breath: "Breathing", leisure: "Free time", crew: "Crew" },
    loading: "Loading…",
    retry: "Retry",
    noData: "—",
    private: "private",
    yes: "Yes",
    no: "No",
    minutes: "min",
    hoursUnit: "h",
    gmt: "GMT",
    selectCrew: "Choose a crew member in the top selector to see their summary.",
    needsLink: "This action needs a link with Earth. Try again once the connection is back.",
    ciTitle: "Today's check-in",
    ciSub: "One minute to share how you slept and how you're doing.",
    sleepHours: "Hours of sleep (last night)",
    sleepHoursHint: "Between 0 and 16 hours.",
    sleepQuality: "Sleep quality",
    mood: "Mood",
    energy: "Energy",
    scales: {
      sleep_quality: ["Very poor", "Poor", "Average", "Good", "Very good"],
      mood: ["Very low", "Low", "Average", "Good", "Very good"],
      energy: ["Exhausted", "Low", "Average", "Good", "Full of energy"],
    },
    isolated: "Today I feel isolated or disconnected",
    note: "Private note (optional)",
    noteHint: "Only you can see it. Up to 500 characters.",
    save: "Save check-in",
    saveQueue: "Save to queue (no link)",
    saving: "Saving…",
    offlineNote: "No link with Earth (simulated). Your check-in will be stored on this device and sent when the link is back.",
    badHours: "Enter your hours of sleep as a number between 0 and 16.",
    savedOk: "Check-in saved. Thanks for taking this moment.",
    savedCare: "Check-in saved. These days seem demanding: talking about it can help, if you feel like it.",
    queued: "No link: check-in saved to the local queue ({n} pending). It will be sent on reconnect.",
    queuedNet: "Earth didn't answer: we saved your check-in to the local queue to send it later.",
    saveError: "Couldn't save the check-in: {msg}",
    careTitle: "Shall we talk?",
    careText: "Your latest entries suggest a moment of support could help. This isn't an alarm: the emotional check-in or a chat with your team may help.",
    careEmotional: "Do the emotional check-in",
    sleepTitle: "Sleep and circadian rhythm",
    avg7: "Average sleep (7 days)",
    under6: "Nights under 6 h",
    checkins7: "Check-ins this week",
    tipLabel: "Tip",
    sleepWhy: "In orbit, day and night change every 90 minutes. Sleeping at regular times and managing light before bed helps keep your circadian rhythm.",
    flag: { OK: "No signs needing attention", NEEDS_CHECK_IN: "A good moment to talk" },
    flagLabel: "Follow-up",
    sleepError: "Couldn't load the sleep summary: {msg}",
    recentTitle: "Latest entries",
    recentEmpty: "No check-ins yet. The first one takes less than a minute.",
    quality: "Quality",
    isolatedShort: "Isolation",
    noteShort: "Note",
    toolPending: "{n} pending",
    leisureTitle: "Free time",
    leisureSub: "Short breaks that help you switch off",
    leisureIntro: "On long missions, small personal routines —tending plants, reading, listening to music— help cope with isolation. Pick whatever you feel like: it's not one more task.",
    weekOwn: "You've had {n} min of free time this week.",
    weekOther: "{name}: {n} min of free time this week.",
    filterDur: "Duration",
    filterCat: "Category",
    durAny: "Any duration",
    durMax: "Up to {n} min",
    catAll: "All",
    categories: {
      PLANTS: "Plants", READING: "Reading", GAMES: "Games", MUSIC: "Music",
      ART: "Art", PHOTOGRAPHY: "Photography", WRITING: "Writing", MOVEMENT: "Movement",
    },
    solo: { SOLO: "Solo", GROUP: "Group", BOTH: "Solo or group" },
    howTo: "How to do it",
    source: "Source: {t}",
    newTab: "(opens in a new tab)",
    didIt: "I did it",
    logMinutes: "Minutes",
    logJoy: "How much did you enjoy it?",
    joy: ["Not at all", "A little", "Somewhat", "Quite a lot", "A lot"],
    logSave: "Save",
    logCancel: "Cancel",
    logged: "Logged! {min} min of \"{t}\".",
    loggedXp: "Logged! {min} min of \"{t}\" · +{xp} XP.",
    logError: "Couldn't save: {msg}",
    badMinutes: "Enter the minutes as a number between 1 and 180.",
    leisureEmpty: "No activities match these filters. Try another duration or category.",
    leisureError: "Couldn't load free time",
    lastTitle: "Your latest breaks",
    crewTitle: "Crew activities",
    crewSub: "Shared time outside the schedule",
    crewIntro: "Sharing a meal, a movie or some time in the garden strengthens team cohesion, one of the factors NASA monitors on isolated missions.",
    goal: "Weekly goal: {done} of {target} activities completed.",
    goalAria: "Weekly goal progress",
    status: { SCHEDULED: "Scheduled", COMPLETED: "Completed", CANCELLED: "Cancelled" },
    responses: { PENDING: "No answer yet", JOINED: "Joining", DECLINED: "Can't make it" },
    attendedWord: "attended",
    yourResponse: "Your answer: {r}",
    by: "Proposed by {name}",
    quorum: "Attendance: {a} of {q} needed to complete it",
    quorumAria: "Attendance against quorum",
    participants: "Participants",
    join: "Count me in",
    decline: "I can't",
    attend: "I attended",
    attendedYou: "Your attendance is recorded.",
    attendFrom: "You can confirm your attendance from {when}.",
    noQuorum: "Didn't reach quorum",
    cancel: "Cancel activity",
    cancelConfirm: "Cancel this activity for the whole crew?",
    crewEmpty: "No activities scheduled yet. Why not propose a shared meal or a movie night?",
    crewError: "Couldn't load crew activities",
    pastTitle: "Recent",
    propose: "Propose an activity",
    tpl: "Activity type",
    when: "Date and time (GMT)",
    dur: "Duration (min)",
    customTitle: "Title (optional, 3–150 characters)",
    customDesc: "Description (optional, up to 1000 characters)",
    proposeSubmit: "Propose to the crew",
    proposed: "Activity proposed. The crew can now join.",
    responded: "Answer saved.",
    attendedOk: "Attendance recorded. Thanks for joining!",
    cancelled: "Activity cancelled.",
    actionError: "Couldn't complete the action: {msg}",
    badWhen: "Enter a future date and time, no more than 180 days ahead.",
    badTitle: "The title must be 3 to 150 characters long (or leave it empty to use the template title).",
    badDesc: "The description can be at most 1000 characters.",
    badDur: "Enter the duration as a number between 5 and 240 minutes.",
    catalogError: "Couldn't load the activity catalog; please try again later.",
    completeAct: "Mark as completed",
    completedOk: "Activity or mission marked as completed. Weekly crew goal updated!",
    suggestionsTitle: "Crew suggestions and missions",
    suggestionsSub: "NASA-recommended activities to strengthen team cohesion",
    completeSuggestion: "Complete suggestion / mission",
  },
};

const SUBS = ["today", "checks", "emotional", "cognitive", "breath", "leisure", "crew"];
const SUB_KEY = "av_wb_sub";
const CATEGORIES = ["PLANTS", "READING", "GAMES", "MUSIC", "ART", "PHOTOGRAPHY", "WRITING", "MOVEMENT"];
const DURATIONS = [10, 20, 30];
const SUPERVISORS = new Set(["MISSION_LEADER", "ADMINISTRATOR"]);

function readSub() {
  try {
    const v = sessionStorage.getItem(SUB_KEY);
    return SUBS.includes(v) ? v : "today";
  } catch {
    return "today";
  }
}
function saveSub(v) {
  try {
    sessionStorage.setItem(SUB_KEY, v);
  } catch {
    /* almacenamiento no disponible */
  }
}

/* Abre Bienestar en una pestaña concreta (app.js: la ruta antigua del cuestionario psicológico → Cuestionarios) */
export function openWellbeingSub(sub) {
  if (!SUBS.includes(sub)) return;
  ui.sub = sub;
  saveSub(sub);
}

/* result: funciones que devuelven el último mensaje en el idioma vigente (sobreviven a un cambio de idioma) */
const ui = {
  lang: null,
  sub: readSub(),
  seq: 0,
  busy: false,
  leisure: { max: "", cat: "" },
  logOpen: null,
  proposeOpen: false,
  focusSel: null,
  result: { today: null, leisure: null, crew: null },
};

/* ───────────────────────── utilidades ───────────────────────── */

function ensureOwnCss() {
  if (document.getElementById("av-wb-css")) return;
  const link = document.createElement("link");
  link.id = "av-wb-css";
  link.rel = "stylesheet";
  link.href = new URL("./wellbeing.css", import.meta.url).href;
  document.head.appendChild(link);
}

const isNil = (v) => v === null || v === undefined;

/* Solo URLs https: (fuentes NASA); cualquier otra cosa no se enlaza */
function safeHttps(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function fmtWhen(iso) {
  const T = tr(DICT);
  if (!iso) return T.noData;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return T.noData;
  const s = d.toLocaleString(locale(), {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });
  return `${s} ${T.gmt}`;
}

function hoursText(v) {
  const T = tr(DICT);
  return isNil(v) || Number.isNaN(Number(v)) ? T.noData : `${fmtNum(v, 1)} ${T.hoursUnit}`;
}

/* Campo redactado por privacidad (null) → "privado", nunca "0" */
function privText(v, own, fn = (x) => String(x)) {
  const T = tr(DICT);
  if (isNil(v)) return own ? T.noData : T.private;
  return fn(v);
}

function pendingEmotional(appState) {
  const c = appState.healthSummary?.expansion_cards || {};
  const o = c.emotional_check_in || c.emotional_checkin_card || {};
  return Number(o.pending_requests_count) || 0;
}

function missionIdOf(appState) {
  return appState.healthSummary?.mission?.id || appState.selectedMissionId || null;
}

function statusHTML(id, fnMsg) {
  return `<p class="av-mx-status" id="${id}" role="status" aria-live="polite" tabindex="-1">${esc(fnMsg ? fnMsg() : "")}</p>`;
}

function panelErrorHTML(title, msg) {
  const T = tr(DICT);
  return `<section class="av-panel av-mx-pad">
      <h3 class="av-h3">${esc(title)}</h3>
      <p class="av-mx-p" role="alert">${esc(msg)}</p>
      <div><button type="button" class="av-btn" data-wb-retry>${esc(T.retry)}</button></div>
    </section>`;
}

/* ───────────────────────── vista ───────────────────────── */

let ctx = null;

export async function renderWellbeingView(container, appState, helpers) {
  ensureCss();
  ensureOwnCss();
  const T = tr(DICT);
  const prevRoot = container.querySelector(".av-wb-root");
  const keep = langChanged(ui, prevRoot);
  const snap = keep ? snapshotFields(prevRoot) : null;
  if (!prevRoot) {
    ui.result = { today: null, leisure: null, crew: null };
    ui.logOpen = null;
    ui.busy = false;
  }
  ctx = { container, appState, helpers };

  const own = isOwnAstronaut(appState);
  const role = roleOf(appState);
  const name = astronautName(appState);
  const intro = !own && SUPERVISORS.has(role) && name ? fmtT(T.introLeader, { name }) : T.intro;

  container.innerHTML = `
    <div class="av-console av-mx-root av-wb-root"><div class="av-grid">
      <div class="av-col-b">
        <section class="av-panel" aria-labelledby="av-wb-h">
          <div class="av-panel-head">
            <h2 class="av-h2" id="av-wb-h">${esc(T.title)}</h2>
          </div>
          <p class="av-mx-p av-wb-intro">${esc(intro)}</p>
          ${crewModeHTML(appState, helpers, T)}
          <div class="av-wb-tabs" role="tablist" aria-label="${esc(T.tabsAria)}">
            ${SUBS.map((s) => tabHTML(s, T, own ? pendingEmotional(appState) : 0)).join("")}
          </div>
        </section>
        <div class="av-wb-panel" id="av-wb-panel" role="tabpanel" aria-labelledby="av-wb-tab-${ui.sub}" tabindex="-1">
          <div class="av-sub av-wb-loading" role="status">${esc(T.loading)}</div>
        </div>
      </div>
    </div></div>`;

  bindTabs(container);
  bindCrewMode(container);
  await renderPanel();
  if (snap) restoreFields(container.querySelector(".av-wb-root"), snap);
}

/* Modo tripulante (issue #44): el líder o la administración pasan a la cuenta demo del tripulante
 * seleccionado para responder lo que solo puede responder esa persona; en modo tripulante se ofrece
 * volver a supervisión. Las acciones las hace app.js (helpers.enterCrewMode / exitCrewMode). */
function crewModeHTML(appState, helpers, T) {
  if (appState.crewMode && helpers?.exitCrewMode) {
    const me = appState.currentUser || {};
    const who = `${me.full_name || "—"}${me.crew_code ? ` (${me.crew_code})` : ""}`;
    return `<div class="av-mx-note av-wb-crewmode" role="status">
        <strong>${esc(T.crewModeOnTitle)}</strong>
        <span>${esc(fmtT(T.crewModeOnText, { name: who }))}</span>
        <span class="av-mx-btns"><button type="button" class="av-btn av-btn-sm" data-wb-crewmode="exit">${esc(T.crewModeExit)}</button></span>
      </div>`;
  }
  if (!helpers?.canEnterCrewMode?.(appState.selectedAstronautId)) return "";
  const a = (appState.usersList || []).find((u) => Number(u.id) === Number(appState.selectedAstronautId));
  return `<div class="av-mx-note av-wb-crewmode">
      <strong>${esc(T.crewModeOffTitle)}</strong>
      <span>${esc(T.crewModeOffText)}</span>
      <span class="av-mx-btns"><button type="button" class="av-btn av-btn-sm av-btn-primary" data-wb-crewmode="enter">${esc(fmtT(T.crewModeEnter, { name: a?.full_name || "—" }))}</button></span>
    </div>`;
}

function bindCrewMode(container) {
  const btn = container.querySelector("[data-wb-crewmode]");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const T = tr(DICT);
    const { appState, helpers } = ctx;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = T.crewModeBusy;
    try {
      if (btn.getAttribute("data-wb-crewmode") === "exit") await helpers.exitCrewMode();
      else await helpers.enterCrewMode(appState.selectedAstronautId);
      // la consola se recarga con la otra cuenta
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      helpers.showToast?.(fmtT(T.crewModeFailed, { msg: errMsg(err) }), "error");
    }
  });
}

function tabHTML(s, T, pending) {
  const on = s === ui.sub;
  const badge = s === "emotional" && pending > 0
    ? ` <span class="av-wb-count">${esc(fmtT(T.toolPending, { n: pending }))}</span>`
    : "";
  return `<button type="button" role="tab" class="av-wb-tab" id="av-wb-tab-${s}" data-wb-tab="${s}"
      aria-controls="av-wb-panel" aria-selected="${on}" tabindex="${on ? 0 : -1}">${esc(T.tabs[s])}${badge}</button>`;
}

function bindTabs(container) {
  const list = container.querySelector(".av-wb-tabs");
  if (!list) return;
  const tabs = () => Array.from(list.querySelectorAll("[data-wb-tab]"));
  const select = (ui.selectTab = (sub, focus) => {
    if (!SUBS.includes(sub)) return;
    const changed = sub !== ui.sub;
    ui.sub = sub;
    saveSub(sub);
    tabs().forEach((b) => {
      const on = b.getAttribute("data-wb-tab") === sub;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    container.querySelector("#av-wb-panel")?.setAttribute("aria-labelledby", `av-wb-tab-${sub}`);
    if (changed) renderPanel();
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-wb-tab]");
    if (b) select(b.getAttribute("data-wb-tab"), false);
  });
  list.addEventListener("keydown", (e) => {
    const all = tabs();
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    let next = null;
    if (e.key === "ArrowRight") next = all[(i + 1) % all.length];
    else if (e.key === "ArrowLeft") next = all[(i - 1 + all.length) % all.length];
    else if (e.key === "Home") next = all[0];
    else if (e.key === "End") next = all[all.length - 1];
    if (!next) return;
    e.preventDefault();
    select(next.getAttribute("data-wb-tab"), true);
  });
}

async function renderPanel() {
  if (!ctx) return;
  const { container, appState } = ctx;
  const panel = container.querySelector("#av-wb-panel");
  if (!panel) return;
  const seq = ++ui.seq;
  const stale = makeStale(appState);
  const isStale = () => stale() || seq !== ui.seq || !document.body.contains(panel);
  const sub = ui.sub;
  if (!panel.querySelector(`[data-wb-sub="${sub}"]`)) {
    panel.innerHTML = `<div class="av-sub av-wb-loading" role="status">${esc(tr(DICT).loading)}</div>`;
  }
  const renderers = { today: renderToday, checks: (p, st) => renderChecks(p, { appState, helpers: ctx.helpers, isStale: st, goTab: (s) => ui.selectTab?.(s, true) }), breath: (p) => renderBreathing(p, appState), leisure: renderLeisure, crew: renderCrew,
    emotional: (p) => renderEmbedded(p, "emotional", renderEmotionalView),
    cognitive: (p) => renderEmbedded(p, "cognitive", renderCognitiveView) };
  await renderers[sub](panel, isStale);
  if (isStale()) return;
  panel.querySelector("[data-wb-retry]")?.addEventListener("click", () => renderPanel());
  panel.querySelectorAll("[data-wb-go]").forEach((b) =>
    b.addEventListener("click", () => ctx.helpers.navigateToSection?.(b.getAttribute("data-wb-go")))
  );
  panel.querySelectorAll("[data-wb-tabgo]").forEach((b) =>
    b.addEventListener("click", () => ui.selectTab?.(b.getAttribute("data-wb-tabgo"), true))
  );
  if (ui.focusSel) {
    panel.querySelector(ui.focusSel)?.focus();
    ui.focusSel = null;
  }
}

/* ───────────────────────── Hoy ───────────────────────── */

function scaleFieldset(key, legend, T) {
  const labels = T.scales[key];
  return `<fieldset class="av-wb-scale">
      <legend class="av-wb-legend">${esc(legend)}</legend>
      <div class="av-wb-seg">
        ${[1, 2, 3, 4, 5]
          .map(
            (v) => `<label class="av-wb-opt" for="av-wb-${key}-${v}">
              <input type="radio" name="av-wb-${key}" id="av-wb-${key}-${v}" value="${v}" ${v === 3 ? "checked" : ""} />
              <span><span class="av-mono">${v}</span> ${esc(labels[v - 1])}</span>
            </label>`
          )
          .join("")}
      </div>
    </fieldset>`;
}

/* Check-in emocional y Evaluación cognitiva dentro de su pestaña: cada vista pinta su propia raíz
 * (av-em-root / av-cg-root) en un contenedor propio, así sus repintados internos (enviar, reintentar,
 * cambio de idioma) no tocan las pestañas de Bienestar. */
async function renderEmbedded(panel, sub, render) {
  let host = panel.querySelector(`[data-wb-sub="${sub}"]`);
  if (!host) {
    panel.innerHTML = `<div class="av-wb-embed" data-wb-sub="${sub}"></div>`;
    host = panel.firstElementChild;
  }
  await render(host, ctx.appState, ctx.helpers);
}

function careHTML(T) {
  return `<div class="av-mx-note av-wb-care">
      <strong>${esc(T.careTitle)}</strong>
      <span>${esc(T.careText)}</span>
      <span class="av-mx-btns">
        <button type="button" class="av-btn av-btn-sm" data-wb-tabgo="emotional">${esc(T.careEmotional)}</button>
      </span>
    </div>`;
}

async function renderToday(panel, isStale) {
  const { appState } = ctx;
  const own = isOwnAstronaut(appState);
  const aid = appState.selectedAstronautId;

  let data = null;
  let loadErr = null;
  if (aid) {
    try {
      data = await apiService.getQuickCheckins(aid, 14);
    } catch (err) {
      loadErr = err;
    }
  }
  if (isStale()) return;

  const T2 = tr(DICT);
  const s = data?.summary || {};
  const items = Array.isArray(data?.items) ? data.items : [];
  const flag = s.operational_flag;
  const offline = !!apiService.simulatedOfflineMode;

  const formHTML = own
    ? `<section class="av-panel" aria-labelledby="av-wb-ci-h">
        <div class="av-panel-head"><h3 class="av-h3" id="av-wb-ci-h">${esc(T2.ciTitle)}</h3><span class="av-sub">${esc(T2.ciSub)}</span></div>
        <form class="av-mx-form av-mx-pad" id="av-wb-ci-form" novalidate>
          ${offline ? `<p class="av-mx-note">${esc(T2.offlineNote)}</p>` : ""}
          <div class="av-field av-wb-hours">
            <label for="av-wb-sleep-h">${esc(T2.sleepHours)}</label>
            <input class="av-input" type="number" inputmode="decimal" min="${LIMITS.sleepMin}" max="${LIMITS.sleepMax}" step="0.1" required
              id="av-wb-sleep-h" value="7" aria-describedby="av-wb-sleep-hint" />
            <span class="av-sub" id="av-wb-sleep-hint">${esc(T2.sleepHoursHint)}</span>
          </div>
          ${scaleFieldset("sleep_quality", T2.sleepQuality, T2)}
          ${scaleFieldset("mood", T2.mood, T2)}
          ${scaleFieldset("energy", T2.energy, T2)}
          <label class="av-mx-check"><input type="checkbox" id="av-wb-isolated" /> <span>${esc(T2.isolated)}</span></label>
          <div class="av-field">
            <label for="av-wb-note">${esc(T2.note)}</label>
            <textarea class="av-input av-mx-textarea" id="av-wb-note" rows="2" maxlength="${LIMITS.noteMax}" aria-describedby="av-wb-note-hint"></textarea>
            <span class="av-sub" id="av-wb-note-hint">${esc(T2.noteHint)}</span>
          </div>
          <div class="av-mx-btns">
            <button type="submit" class="av-btn av-btn-primary" id="av-wb-ci-submit">${esc(offline ? T2.saveQueue : T2.save)}</button>
          </div>
          ${statusHTML("av-wb-ci-status", ui.result.today)}
        </form>
      </section>`
    : "";

  const sleepHTML = !aid
    ? `<section class="av-panel av-mx-pad"><p class="av-mx-p">${esc(T2.selectCrew)}</p></section>`
    : loadErr
      ? `<section class="av-panel av-mx-pad" aria-labelledby="av-wb-sleep-h2">
          <h3 class="av-h3" id="av-wb-sleep-h2">${esc(T2.sleepTitle)}</h3>
          <p class="av-mx-p" role="alert">${esc(fmtT(T2.sleepError, { msg: errMsg(loadErr) }))}</p>
          <div><button type="button" class="av-btn" data-wb-retry>${esc(T2.retry)}</button></div>
        </section>`
      : `<section class="av-panel" aria-labelledby="av-wb-sleep-h2">
          <div class="av-panel-head">
            <h3 class="av-h3" id="av-wb-sleep-h2">${esc(T2.sleepTitle)}</h3>
            ${flag ? `<span class="av-mx-btns"><span class="av-sub">${esc(T2.flagLabel)}:</span> ${tag(T2.flag[flag] || bt(flag), flag === "NEEDS_CHECK_IN")}</span>` : ""}
          </div>
          <div class="av-mx-pad">
            <dl class="av-mx-kv">
              <dt>${esc(T2.avg7)}</dt><dd>${esc(hoursText(s.avg_sleep_hours_7d))}</dd>
              <dt>${esc(T2.under6)}</dt><dd>${esc(isNil(s.nights_under_6h_7d) ? T2.noData : s.nights_under_6h_7d)}</dd>
              <dt>${esc(T2.checkins7)}</dt><dd>${esc(isNil(s.checkins_7d) ? T2.noData : s.checkins_7d)}</dd>
            </dl>
            ${s.circadian_tip ? `<p class="av-mx-note"><strong>${esc(T2.tipLabel)}:</strong> ${esc(btLines(s.circadian_tip))}</p>` : ""}
            <p class="av-mx-p av-sub">${esc(T2.sleepWhy)}</p>
            ${own && flag === "NEEDS_CHECK_IN" ? careHTML(T2) : ""}
          </div>
        </section>`;

  const recent = items.slice(0, 7);
  const recentHTML = aid && !loadErr
    ? `<section class="av-panel" aria-labelledby="av-wb-recent-h">
        <div class="av-panel-head"><h3 class="av-h3" id="av-wb-recent-h">${esc(T2.recentTitle)}</h3><span class="av-sub av-mono">${esc(items.length)}</span></div>
        ${
          recent.length
            ? `<ul class="av-mx-list">${recent
                .map(
                  (c) => `<li>
                    <div class="av-mx-row">
                      <span class="av-mono av-sub">${esc(fmtWhen(c.created_at))}</span>
                      <span><strong>${esc(hoursText(c.sleep_hours))}</strong>
                        <span class="av-sub">· ${esc(T2.quality)} ${esc(privText(c.sleep_quality, own, (v) => `${v}/5`))}</span></span>
                    </div>
                    <div class="av-wb-chips">
                      <span>${esc(T2.mood)}: ${esc(privText(c.mood, own, (v) => `${v}/5`))}</span>
                      <span>${esc(T2.energy)}: ${esc(privText(c.energy, own, (v) => `${v}/5`))}</span>
                      <span>${esc(T2.isolatedShort)}: ${esc(privText(c.feels_isolated, own, (v) => (v ? T2.yes : T2.no)))}</span>
                    </div>
                    ${own && c.note ? `<p class="av-mx-p av-sub"><strong>${esc(T2.noteShort)}:</strong> ${esc(c.note)}</p>` : ""}
                  </li>`
                )
                .join("")}</ul>`
            : `<p class="av-mx-empty">${esc(T2.recentEmpty)}</p>`
        }
      </section>`
    : "";

  panel.innerHTML = `<div class="av-wb-cols" data-wb-sub="today">
      <div class="av-wb-col">${formHTML}${sleepHTML}</div>
      <div class="av-wb-col">${recentHTML}</div>
    </div>`;

  if (own) bindCheckin(panel);
}

function bindCheckin(panel) {
  const form = panel.querySelector("#av-wb-ci-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (ui.busy) return;
    const T = tr(DICT);
    const status = form.querySelector("#av-wb-ci-status");
    const hoursEl = form.querySelector("#av-wb-sleep-h");
    const hours = Number(String(hoursEl.value).replace(",", "."));
    if (hoursEl.value === "" || !Number.isFinite(hours) || hours < LIMITS.sleepMin || hours > LIMITS.sleepMax) {
      status.textContent = T.badHours;
      hoursEl.setAttribute("aria-invalid", "true");
      hoursEl.focus();
      return;
    }
    hoursEl.removeAttribute("aria-invalid");
    const pick = (key) => Number(form.querySelector(`input[name="av-wb-${key}"]:checked`)?.value || 3);
    const payload = {
      sleep_hours: Math.round(hours * 10) / 10,
      sleep_quality: pick("sleep_quality"),
      mood: pick("mood"),
      energy: pick("energy"),
      feels_isolated: form.querySelector("#av-wb-isolated").checked,
    };
    const note = form.querySelector("#av-wb-note").value.trim().slice(0, LIMITS.noteMax);
    if (note) payload.note = note;
    // una sola clave por envío: el POST directo y el reencolado por fallo de red usan la misma,
    // así el backend devuelve el registro existente en vez de duplicarlo
    payload.dedup_key = newDedupKey().slice(0, LIMITS.dedupMax);

    const btn = form.querySelector("#av-wb-ci-submit");
    ui.busy = true;
    btn.disabled = true;
    status.textContent = T.saving;
    try {
      const res = await apiService.createQuickCheckin(payload);
      if (res && res.queued_offline) {
        const n = res.queue_size;
        ui.result.today = () => fmtT(tr(DICT).queued, { n });
      } else {
        const care = res?.operational_flag === "NEEDS_CHECK_IN";
        ui.result.today = () => (care ? tr(DICT).savedCare : tr(DICT).savedOk);
      }
    } catch (err) {
      if (!err || !err.status) {
        // sin respuesta de red: a la cola local existente (se transmite con el resto al reconectar)
        try {
          apiService.enqueueOfflineItem({ endpoint: "/wellness/quick-checkin", payload, dedup_key: payload.dedup_key });
          ui.result.today = () => tr(DICT).queuedNet;
        } catch (qErr) {
          ui.result.today = () => fmtT(tr(DICT).saveError, { msg: errMsg(qErr) });
        }
      } else {
        ui.busy = false;
        btn.disabled = false;
        status.textContent = fmtT(T.saveError, { msg: errMsg(err) });
        return;
      }
    }
    ui.busy = false;
    ctx.helpers.showToast?.(ui.result.today());
    ui.focusSel = "#av-wb-ci-status";
    await renderPanel();
  });
}

/* ───────────────────────── Tiempo libre ───────────────────────── */

async function renderLeisure(panel, isStale) {
  const { appState } = ctx;
  const own = isOwnAstronaut(appState);
  const aid = appState.selectedAstronautId;

  const [actRes, logRes] = await Promise.allSettled([
    apiService.getLeisureActivities({ maxMinutes: ui.leisure.max || null, category: ui.leisure.cat || null }),
    aid ? apiService.getLeisureLog(aid, 20) : Promise.resolve(null),
  ]);
  if (isStale()) return;
  const T = tr(DICT);

  if (actRes.status === "rejected") {
    panel.innerHTML = `<div data-wb-sub="leisure">${panelErrorHTML(T.leisureError, errMsg(actRes.reason))}</div>`;
    return;
  }
  const items = Array.isArray(actRes.value?.items) ? actRes.value.items : [];
  const log = logRes.status === "fulfilled" ? logRes.value : null;
  const minutes7 = log && !isNil(log.minutes_7d) ? log.minutes_7d : null;
  const offline = !!apiService.simulatedOfflineMode;
  const titles = new Map(items.map((a) => [a.code, a.title]));

  const weekLine = isNil(minutes7)
    ? ""
    : `<p class="av-wb-week">${esc(
        own ? fmtT(T.weekOwn, { n: fmtNum(minutes7) }) : fmtT(T.weekOther, { name: astronautName(appState), n: fmtNum(minutes7) })
      )}</p>`;

  const filters = `<div class="av-form-grid av-wb-filters">
      <div class="av-field">
        <label for="av-wb-f-dur">${esc(T.filterDur)}</label>
        <select class="av-input" id="av-wb-f-dur">
          <option value="">${esc(T.durAny)}</option>
          ${DURATIONS.map((d) => `<option value="${d}" ${String(d) === String(ui.leisure.max) ? "selected" : ""}>${esc(fmtT(T.durMax, { n: d }))}</option>`).join("")}
        </select>
      </div>
      <div class="av-field">
        <label for="av-wb-f-cat">${esc(T.filterCat)}</label>
        <select class="av-input" id="av-wb-f-cat">
          <option value="">${esc(T.catAll)}</option>
          ${CATEGORIES.map((c) => `<option value="${c}" ${c === ui.leisure.cat ? "selected" : ""}>${esc(T.categories[c])}</option>`).join("")}
        </select>
      </div>
    </div>`;

  const card = (a, i) => {
    const src = safeHttps(a.source_url);
    const steps = Array.isArray(a.how_to) ? a.how_to : [];
    const open = own && ui.logOpen === a.code;
    const title = bt(a.title) || a.code;
    return `<article class="av-panel av-wb-card" aria-labelledby="av-wb-l-${i}">
        <div class="av-mx-row">
          <h4 class="av-h3" id="av-wb-l-${i}">${esc(title)}</h4>
          <span class="av-mono av-sub">${esc(a.duration_minutes)} ${esc(T.minutes)}</span>
        </div>
        <div class="av-mx-btns">${a.category ? tag(T.categories[a.category] || bt(a.category)) : ""}${a.solo_or_group ? tag(T.solo[a.solo_or_group] || bt(a.solo_or_group)) : ""}</div>
        ${a.description ? `<p class="av-mx-p">${esc(btLines(a.description))}</p>` : ""}
        ${
          steps.length
            ? `<details class="av-wb-how"><summary>${esc(T.howTo)}</summary>
                <ol>${steps.map((s) => `<li>${esc(bt(s))}</li>`).join("")}</ol></details>`
            : ""
        }
        ${
          src
            ? `<a class="av-wb-src" href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(fmtT(T.source, { t: bt(a.source_title) || src }))}<span class="av-mx-sr"> ${esc(T.newTab)}</span></a>`
            : ""
        }
        ${
          own
            ? `<div class="av-mx-btns"><button type="button" class="av-btn av-btn-sm" data-wb-did="${esc(a.code)}"
                  aria-expanded="${open}" aria-controls="av-wb-log-${i}" ${offline ? 'disabled aria-describedby="av-wb-l-offline"' : ""}>${esc(T.didIt)}</button></div>
               <form class="av-mx-form av-wb-log" id="av-wb-log-${i}" data-wb-logform="${esc(a.code)}" data-wb-title="${esc(title)}" ${open ? "" : "hidden"} novalidate>
                 <div class="av-form-grid">
                   <div class="av-field">
                     <label for="av-wb-log-min-${i}">${esc(T.logMinutes)}</label>
                     <input class="av-input" type="number" inputmode="numeric" min="${LIMITS.leisureMin}" max="${LIMITS.leisureMax}" step="1" required id="av-wb-log-min-${i}" value="${esc(Math.min(Number(a.duration_minutes) || 15, LIMITS.leisureMax))}" />
                   </div>
                   <div class="av-field">
                     <label for="av-wb-log-joy-${i}">${esc(T.logJoy)}</label>
                     <select class="av-input" id="av-wb-log-joy-${i}">
                       ${[5, 4, 3, 2, 1].map((v) => `<option value="${v}" ${v === 4 ? "selected" : ""}>${v} · ${esc(T.joy[v - 1])}</option>`).join("")}
                     </select>
                   </div>
                 </div>
                 <div class="av-mx-btns">
                   <button type="submit" class="av-btn av-btn-primary av-btn-sm">${esc(T.logSave)}</button>
                   <button type="button" class="av-btn av-btn-sm" data-wb-logcancel>${esc(T.logCancel)}</button>
                 </div>
               </form>`
            : ""
        }
      </article>`;
  };

  const logItems = own && Array.isArray(log?.items) ? log.items.slice(0, 5) : [];
  const lastHTML = logItems.length
    ? `<section class="av-panel" aria-labelledby="av-wb-last-h">
        <div class="av-panel-head"><h3 class="av-h3" id="av-wb-last-h">${esc(T.lastTitle)}</h3></div>
        <ul class="av-mx-list">${logItems
          .map(
            (l) => `<li><div class="av-mx-row">
                <span>${esc(bt(titles.get(l.code)) || l.title || l.code || "")}</span>
                <span class="av-sub av-mono">${esc(isNil(l.minutes) ? T.noData : `${l.minutes} ${T.minutes}`)}${isNil(l.enjoyment) ? "" : ` · ${esc(l.enjoyment)}/5`}</span>
              </div><span class="av-sub av-mono">${esc(fmtWhen(l.created_at))}</span></li>`
          )
          .join("")}</ul>
      </section>`
    : "";

  panel.innerHTML = `<div class="av-wb-stack" data-wb-sub="leisure">
      <section class="av-panel" aria-labelledby="av-wb-leisure-h">
        <div class="av-panel-head"><h3 class="av-h3" id="av-wb-leisure-h">${esc(T.leisureTitle)}</h3><span class="av-sub">${esc(T.leisureSub)}</span></div>
        <div class="av-mx-pad">
          <p class="av-mx-p">${esc(T.leisureIntro)}</p>
          ${weekLine}
          ${own && offline ? `<p class="av-mx-note" id="av-wb-l-offline">${esc(T.needsLink)}</p>` : ""}
          ${filters}
          ${statusHTML("av-wb-l-status", ui.result.leisure)}
        </div>
      </section>
      ${items.length ? `<div class="av-wb-cards">${items.map(card).join("")}</div>` : `<section class="av-panel"><p class="av-mx-empty">${esc(T.leisureEmpty)}</p></section>`}
      ${lastHTML}
    </div>`;

  const onFilter = (sel, key) => {
    panel.querySelector(sel)?.addEventListener("change", (e) => {
      ui.leisure[key] = e.target.value;
      ui.focusSel = sel;
      renderPanel();
    });
  };
  onFilter("#av-wb-f-dur", "max");
  onFilter("#av-wb-f-cat", "cat");

  panel.querySelectorAll("[data-wb-did]").forEach((b) =>
    b.addEventListener("click", () => {
      const form = panel.querySelector(`#${CSS.escape(b.getAttribute("aria-controls"))}`);
      const open = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", String(open));
      ui.logOpen = open ? b.getAttribute("data-wb-did") : null;
      if (form) {
        form.hidden = !open;
        if (open) form.querySelector("input")?.focus();
      }
    })
  );
  panel.querySelectorAll("[data-wb-logform]").forEach((form) => {
    const code = form.getAttribute("data-wb-logform");
    const toggle = () => form.closest(".av-wb-card")?.querySelector("[data-wb-did]");
    form.querySelector("[data-wb-logcancel]")?.addEventListener("click", () => {
      form.hidden = true;
      ui.logOpen = null;
      const b = toggle();
      b?.setAttribute("aria-expanded", "false");
      b?.focus();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (ui.busy) return;
      const T2 = tr(DICT);
      const status = panel.querySelector("#av-wb-l-status");
      if (apiService.simulatedOfflineMode) {
        status.textContent = T2.needsLink;
        return;
      }
      const minEl = form.querySelector('input[type="number"]');
      const minutes = Number(minEl.value);
      if (!Number.isInteger(minutes) || minutes < LIMITS.leisureMin || minutes > LIMITS.leisureMax) {
        status.textContent = T2.badMinutes;
        minEl.setAttribute("aria-invalid", "true");
        minEl.focus();
        return;
      }
      const enjoyment = Number(form.querySelector("select").value) || 3;
      const title = form.getAttribute("data-wb-title") || code;
      ui.busy = true;
      form.querySelectorAll("button").forEach((x) => (x.disabled = true));
      try {
        const res = await apiService.logLeisureActivity(code, { minutes, enjoyment });
        const xp = Number(res?.xp_awarded) || 0;
        ui.result.leisure = () => fmtT(xp > 0 ? tr(DICT).loggedXp : tr(DICT).logged, { min: minutes, t: title, xp });
        ui.logOpen = null;
        ctx.helpers.showToast?.(ui.result.leisure());
        ui.busy = false;
        ui.focusSel = "#av-wb-l-status";
        await renderPanel();
      } catch (err) {
        ui.busy = false;
        form.querySelectorAll("button").forEach((x) => (x.disabled = false));
        status.textContent = fmtT(T2.logError, { msg: errMsg(err) });
      }
    });
  });
}

/* ───────────────────────── Tripulación ───────────────────────── */

/* Valor "AAAA-MM-DDTHH:MM" de un datetime-local interpretado en GMT (como el resto de la consola) */
function gmtLocal(ms) {
  return new Date(ms).toISOString().slice(0, 16);
}

/* Ventana de asistencia: la MISMA regla que el backend
   (isolation_router.py → ATTEND_OPENS_BEFORE, ATTEND_CLOSES_AFTER_END, _attend_window):
   desde scheduled_for − 15 min hasta scheduled_for + duration_minutes + 24 h. Si cambia allí, cambiar aquí. */
const ATTEND_OPENS_BEFORE_MS = 15 * 60 * 1000;
const ATTEND_CLOSES_AFTER_END_MS = 24 * 60 * 60 * 1000;

function attendWindow(a) {
  const start = new Date(a?.scheduled_for).getTime();
  if (Number.isNaN(start)) return null;
  const durMs = (Number(a?.duration_minutes) || 0) * 60000;
  return { opensAt: start - ATTEND_OPENS_BEFORE_MS, closesAt: start + durMs + ATTEND_CLOSES_AFTER_END_MS };
}

/* La vista no recibe la hora del servidor: se usa el reloj del cliente; si hay desfase,
   el 409 del backend se muestra y se repinta (ver act() en renderCrew). */
function nowMs() {
  return Date.now();
}

function defaultWhen() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T19:00`;
}

async function renderCrew(panel, isStale) {
  const { appState } = ctx;
  const role = roleOf(appState);
  const meId = Number(appState.currentUser?.id);
  const supervisor = SUPERVISORS.has(role);
  const missionId = missionIdOf(appState);

  const [actRes, catRes] = await Promise.allSettled([
    apiService.getCrewActivities({ missionId: supervisor ? missionId : null }),
    apiService.getCrewActivityCatalog(),
  ]);
  if (isStale()) return;
  const T = tr(DICT);

  if (actRes.status === "rejected") {
    panel.innerHTML = `<div data-wb-sub="crew">${panelErrorHTML(T.crewError, errMsg(actRes.reason))}</div>`;
    return;
  }
  const acts = Array.isArray(actRes.value?.items) ? actRes.value.items : [];
  const goal = actRes.value?.weekly_goal || null;
  const catalog = catRes.status === "fulfilled" && Array.isArray(catRes.value?.items) ? catRes.value.items : null;
  const offline = !!apiService.simulatedOfflineMode;
  const dis = offline ? 'disabled aria-describedby="av-wb-c-offline"' : "";

  const time = (a) => new Date(a.scheduled_for).getTime() || 0;
  const now = nowMs();
  // SCHEDULED con la ventana de asistencia ya cerrada (sin quórum: si lo hubiera, el backend la habría completado)
  const expired = (a) => {
    if (a.status !== "SCHEDULED") return false;
    const w = attendWindow(a);
    return !!w && now > w.closesAt;
  };
  const upcoming = acts.filter((a) => a.status === "SCHEDULED" && !expired(a)).sort((a, b) => time(a) - time(b));
  const past = acts.filter((a) => a.status !== "SCHEDULED" || expired(a)).sort((a, b) => time(b) - time(a)).slice(0, 5);

  const goalHTML = goal && Number(goal.target) > 0
    ? `<div class="av-wb-goal">
        <p class="av-mx-p">${esc(fmtT(T.goal, { done: Number(goal.completed_this_week) || 0, target: Number(goal.target) }))}</p>
        <progress class="av-wb-progress" max="${esc(Number(goal.target))}" value="${esc(Math.min(Number(goal.completed_this_week) || 0, Number(goal.target)))}" aria-label="${esc(T.goalAria)}"></progress>
      </div>`
    : "";

  const actCard = (a) => {
    const id = a.id;
    const isExpired = expired(a);
    const scheduled = a.status === "SCHEDULED" && !isExpired;
    const win = attendWindow(a);
    const participants = Array.isArray(a.participants) ? a.participants : [];
    const mine = participants.find((p) => Number(p.user_id) === meId);
    const myResp = a.my_response || mine?.response || null;
    const isParticipant = !!myResp;
    const iAttended = !!mine?.attended;
    const canCancel = scheduled && (supervisor || Number(a.created_by?.id) === meId);
    const quorum = Number(a.quorum) || 0;
    const attended = Number(a.attended_count) || 0;
    const btns = [];
    let attendNote = "";
    if (scheduled && isParticipant) {
      btns.push(`<button type="button" class="av-btn av-btn-sm" data-wb-respond="JOINED" aria-pressed="${myResp === "JOINED"}" ${dis}>${esc(T.join)}</button>`);
      btns.push(`<button type="button" class="av-btn av-btn-sm" data-wb-respond="DECLINED" aria-pressed="${myResp === "DECLINED"}" ${dis}>${esc(T.decline)}</button>`);
      if (myResp === "JOINED" && !iAttended && win) {
        if (now < win.opensAt) {
          // antes de la ventana: se avisa desde cuándo; después de la ventana no se muestra nada
          attendNote = `<p class="av-mx-p av-sub av-wb-attend-note">${esc(fmtT(T.attendFrom, { when: fmtWhen(new Date(win.opensAt).toISOString()) }))}</p>`;
        } else if (now <= win.closesAt) {
          btns.push(`<button type="button" class="av-btn av-btn-sm av-btn-primary" data-wb-attend ${dis}>${esc(T.attend)}</button>`);
        }
      }
    }
    if (scheduled) {
      btns.push(`<button type="button" class="av-btn av-btn-sm av-btn-primary" data-wb-complete ${dis}>${esc(T.completeAct)}</button>`);
    }
    if (canCancel) btns.push(`<button type="button" class="av-btn av-btn-sm" data-wb-cancel ${dis}>${esc(T.cancel)}</button>`);

    return `<article class="av-panel av-wb-act" data-wb-id="${esc(id)}" aria-labelledby="av-wb-act-${esc(id)}">
        <div class="av-mx-row">
          <h4 class="av-h3" id="av-wb-act-${esc(id)}">${esc(bt(a.title) || a.template_code || "")}</h4>
          ${isExpired ? tag(T.noQuorum) : tag(T.status[a.status] || bt(a.status) || "", scheduled)}
        </div>
        <p class="av-mx-p av-sub">${esc(fmtWhen(a.scheduled_for))} · ${esc(a.duration_minutes)} ${esc(T.minutes)}${a.created_by?.name ? ` · ${esc(fmtT(T.by, { name: a.created_by.name }))}` : ""}</p>
        ${a.description ? `<p class="av-mx-p">${esc(btLines(a.description))}</p>` : ""}
        ${
          quorum > 0 && a.status !== "CANCELLED"
            ? `<div class="av-wb-goal"><span class="av-sub">${esc(fmtT(T.quorum, { a: attended, q: quorum }))}</span>
                <progress class="av-wb-progress" max="${esc(quorum)}" value="${esc(Math.min(attended, quorum))}" aria-label="${esc(T.quorumAria)}"></progress></div>`
            : ""
        }
        ${
          participants.length
            ? `<details class="av-wb-how"><summary>${esc(T.participants)} (${esc(participants.length)})</summary>
                <ul class="av-wb-people">${participants
                  .map(
                    (p) => `<li><span>${esc(p.name)}</span><span class="av-sub">${esc(T.responses[p.response] || bt(p.response) || "")}${p.attended ? ` · ${esc(T.attendedWord)}` : ""}</span></li>`
                  )
                  .join("")}</ul></details>`
            : ""
        }
        ${isParticipant ? `<p class="av-mx-p av-sub">${esc(fmtT(T.yourResponse, { r: T.responses[myResp] || myResp }))}${iAttended ? ` · ${esc(T.attendedYou)}` : ""}</p>` : ""}
        ${attendNote}
        ${btns.length ? `<div class="av-mx-btns">${btns.join("")}</div>` : ""}
      </article>`;
  };

  const tplOptions = (catalog || [])
    .map((c) => `<option value="${esc(c.code)}" data-wb-dur="${esc(c.duration_minutes || 45)}">${esc(bt(c.title) || c.code)} · ${esc(c.duration_minutes)} ${esc(T.minutes)}</option>`)
    .join("");
  const firstTpl = catalog?.[0] || null;
  const proposeHTML = catalog === null
    ? `<section class="av-panel"><p class="av-mx-empty">${esc(T.catalogError)}</p></section>`
    : catalog.length
      ? `<details class="av-panel av-wb-propose" id="av-wb-propose" ${ui.proposeOpen ? "open" : ""}>
          <summary class="av-wb-sum">${esc(T.propose)}</summary>
          <form class="av-mx-form av-mx-pad" id="av-wb-new" novalidate>
            <div class="av-form-grid av-mx-wide">
              <div class="av-field">
                <label for="av-wb-new-tpl">${esc(T.tpl)}</label>
                <select class="av-input" id="av-wb-new-tpl">${tplOptions}</select>
              </div>
              <div class="av-field">
                <label for="av-wb-new-when">${esc(T.when)}</label>
                <input class="av-input" type="datetime-local" id="av-wb-new-when" required min="${esc(gmtLocal(Date.now()))}" max="${esc(gmtLocal(Date.now() + LIMITS.crewFutureDays * 86400000))}" value="${esc(defaultWhen())}" />
              </div>
              <div class="av-field">
                <label for="av-wb-new-dur">${esc(T.dur)}</label>
                <input class="av-input" type="number" inputmode="numeric" min="${LIMITS.crewDurMin}" max="${LIMITS.crewDurMax}" step="5" id="av-wb-new-dur" value="${esc(firstTpl?.duration_minutes || 45)}" />
              </div>
              <div class="av-field">
                <label for="av-wb-new-title">${esc(T.customTitle)}</label>
                <input class="av-input" type="text" minlength="${LIMITS.crewTitleMin}" maxlength="${LIMITS.crewTitleMax}" id="av-wb-new-title" />
              </div>
            </div>
            <p class="av-mx-p av-sub" id="av-wb-new-tpl-desc">${esc(btLines(firstTpl?.description || ""))}</p>
            <div class="av-field">
              <label for="av-wb-new-desc">${esc(T.customDesc)}</label>
              <textarea class="av-input av-mx-textarea" id="av-wb-new-desc" rows="2" maxlength="${LIMITS.crewDescMax}"></textarea>
            </div>
            <div class="av-mx-btns"><button type="submit" class="av-btn av-btn-primary" ${dis}>${esc(T.proposeSubmit)}</button></div>
          </form>
        </details>`
      : "";

  const suggestionsHTML =
    catalog && catalog.length
      ? `<section class="av-panel" aria-labelledby="av-wb-sugg-h">
          <div class="av-panel-head"><h3 class="av-h3" id="av-wb-sugg-h">${esc(T.suggestionsTitle)}</h3><span class="av-sub">${esc(T.suggestionsSub)}</span></div>
          <div class="av-wb-cards av-mx-pad">${catalog
            .map(
              (c) => `<article class="av-panel av-wb-act" data-wb-tpl-card="${esc(c.code)}">
                <div class="av-mx-row">
                  <h4 class="av-h3">${esc(bt(c.title) || c.code)}</h4>
                  ${tag(`${esc(c.duration_minutes || 45)} ${esc(T.minutes)}`)}
                </div>
                ${c.description ? `<p class="av-mx-p av-sub">${esc(btLines(c.description))}</p>` : ""}
                <div class="av-mx-btns">
                  <button type="button" class="av-btn av-btn-sm av-btn-primary" data-wb-complete-tpl="${esc(c.code)}" data-wb-tpl-dur="${esc(c.duration_minutes || 45)}" ${dis}>${esc(T.completeSuggestion)}</button>
                </div>
              </article>`
            )
            .join("")}</div>
        </section>`
      : "";

  panel.innerHTML = `<div class="av-wb-stack" data-wb-sub="crew">
      <section class="av-panel" aria-labelledby="av-wb-crew-h">
        <div class="av-panel-head"><h3 class="av-h3" id="av-wb-crew-h">${esc(T.crewTitle)}</h3><span class="av-sub">${esc(T.crewSub)}</span></div>
        <div class="av-mx-pad">
          <p class="av-mx-p">${esc(T.crewIntro)}</p>
          ${goalHTML}
          ${offline ? `<p class="av-mx-note" id="av-wb-c-offline">${esc(T.needsLink)}</p>` : ""}
          ${statusHTML("av-wb-c-status", ui.result.crew)}
        </div>
      </section>
      ${upcoming.length ? `<div class="av-wb-cards">${upcoming.map(actCard).join("")}</div>` : `<section class="av-panel"><p class="av-mx-empty">${esc(T.crewEmpty)}</p></section>`}
      ${suggestionsHTML}
      ${proposeHTML}
      ${
        past.length
          ? `<section class="av-wb-stack" aria-labelledby="av-wb-past-h"><h3 class="av-h3 av-wb-subh" id="av-wb-past-h">${esc(T.pastTitle)}</h3>
              <div class="av-wb-cards">${past.map(actCard).join("")}</div></section>`
          : ""
      }
    </div>`;

  const status = panel.querySelector("#av-wb-c-status");
  const act = async (el, fn, okKey) => {
    if (ui.busy) return;
    const T2 = tr(DICT);
    if (apiService.simulatedOfflineMode) {
      status.textContent = T2.needsLink;
      return;
    }
    const article = el.closest("[data-wb-id]");
    const id = article?.getAttribute("data-wb-id");
    if (!id) return;
    ui.busy = true;
    article.querySelectorAll("button").forEach((x) => (x.disabled = true));
    try {
      await fn(id);
      ui.result.crew = () => tr(DICT)[okKey];
      ctx.helpers.showToast?.(ui.result.crew());
      ctx.helpers.refreshGlobalHeaderAndSummary?.();
      ui.busy = false;
      ui.focusSel = "#av-wb-c-status";
      await renderPanel();
    } catch (err) {
      ui.busy = false;
      if (err && Number(err.status) === 409) {
        // conflicto de estado (p. ej. ventana de asistencia con relojes desfasados): mensaje del servidor y repintado
        ui.result.crew = () => fmtT(tr(DICT).actionError, { msg: errMsg(err) });
        ui.focusSel = "#av-wb-c-status";
        await renderPanel();
        return;
      }
      article.querySelectorAll("button").forEach((x) => (x.disabled = false));
      status.textContent = fmtT(T2.actionError, { msg: errMsg(err) });
    }
  };
  panel.querySelectorAll("[data-wb-respond]").forEach((b) =>
    b.addEventListener("click", () => act(b, (id) => apiService.respondCrewActivity(id, b.getAttribute("data-wb-respond")), "responded"))
  );
  panel.querySelectorAll("[data-wb-attend]").forEach((b) =>
    b.addEventListener("click", () => act(b, (id) => apiService.attendCrewActivity(id), "attendedOk"))
  );
  panel.querySelectorAll("[data-wb-complete]").forEach((b) =>
    b.addEventListener("click", () => act(b, (id) => apiService.completeCrewActivity(id), "completedOk"))
  );
  panel.querySelectorAll("[data-wb-complete-tpl]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (ui.busy) return;
      const T2 = tr(DICT);
      if (apiService.simulatedOfflineMode) {
        status.textContent = T2.needsLink;
        return;
      }
      const code = b.getAttribute("data-wb-complete-tpl");
      const dur = Number(b.getAttribute("data-wb-tpl-dur")) || 45;
      if (!code) return;
      ui.busy = true;
      b.disabled = true;
      try {
        const created = await apiService.createCrewActivity({
          mission_id: acts[0]?.mission_id || missionId,
          template_code: code,
          scheduled_for: new Date().toISOString(),
          duration_minutes: dur,
        });
        const newId = created?.item?.id || created?.id;
        if (newId) {
          await apiService.completeCrewActivity(newId);
        }
        ui.result.crew = () => tr(DICT).completedOk;
        ctx.helpers.showToast?.(ui.result.crew());
        ctx.helpers.refreshGlobalHeaderAndSummary?.();
        ui.busy = false;
        ui.focusSel = "#av-wb-c-status";
        await renderPanel();
      } catch (err) {
        ui.busy = false;
        b.disabled = false;
        status.textContent = fmtT(T2.actionError, { msg: errMsg(err) });
      }
    })
  );
  panel.querySelectorAll("[data-wb-cancel]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!window.confirm(tr(DICT).cancelConfirm)) return;
      act(b, (id) => apiService.cancelCrewActivity(id), "cancelled");
    })
  );

  const details = panel.querySelector("#av-wb-propose");
  details?.addEventListener("toggle", () => {
    ui.proposeOpen = details.open;
  });
  const form = panel.querySelector("#av-wb-new");
  if (!form) return;
  const tplSel = form.querySelector("#av-wb-new-tpl");
  tplSel.addEventListener("change", () => {
    const c = (catalog || []).find((x) => x.code === tplSel.value);
    if (!c) return;
    form.querySelector("#av-wb-new-dur").value = c.duration_minutes || 45;
    form.querySelector("#av-wb-new-tpl-desc").textContent = btLines(c.description || "");
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (ui.busy) return;
    const T2 = tr(DICT);
    if (apiService.simulatedOfflineMode) {
      status.textContent = T2.needsLink;
      return;
    }
    const whenEl = form.querySelector("#av-wb-new-when");
    // el campo se interpreta en GMT, como el resto de la consola
    const when = whenEl.value ? new Date(`${whenEl.value}Z`) : null;
    // futura (margen de 5 min) y como máximo a 180 días: el backend acepta [-7 d, +180 d]
    const maxWhen = Date.now() + LIMITS.crewFutureDays * 86400000 - 60000;
    const invalid = (el, msg) => {
      status.textContent = msg;
      el.setAttribute("aria-invalid", "true");
      el.focus();
    };
    if (!when || Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 5 * 60000 || when.getTime() > maxWhen) {
      invalid(whenEl, T2.badWhen);
      return;
    }
    whenEl.removeAttribute("aria-invalid");
    const durEl = form.querySelector("#av-wb-new-dur");
    const dur = Number(durEl.value);
    if (durEl.value === "" || !Number.isInteger(dur) || dur < LIMITS.crewDurMin || dur > LIMITS.crewDurMax) {
      invalid(durEl, T2.badDur);
      return;
    }
    durEl.removeAttribute("aria-invalid");
    const titleEl = form.querySelector("#av-wb-new-title");
    const descEl = form.querySelector("#av-wb-new-desc");
    const title = titleEl.value.trim();
    const desc = descEl.value.trim();
    // vacío = se usa el título de la plantilla; si se escribe, 3–150 caracteres (min_length/max_length del backend)
    if (title && (title.length < LIMITS.crewTitleMin || title.length > LIMITS.crewTitleMax)) {
      invalid(titleEl, T2.badTitle);
      return;
    }
    titleEl.removeAttribute("aria-invalid");
    if (desc.length > LIMITS.crewDescMax) {
      invalid(descEl, T2.badDesc);
      return;
    }
    descEl.removeAttribute("aria-invalid");
    const payload = {
      mission_id: acts[0]?.mission_id || missionId,
      template_code: tplSel.value,
      scheduled_for: when.toISOString(),
      duration_minutes: dur,
    };
    if (title) payload.title = title;
    if (desc) payload.description = desc;
    const submitBtn = form.querySelector('button[type="submit"]');
    ui.busy = true;
    submitBtn.disabled = true;
    try {
      await apiService.createCrewActivity(payload);
      ui.result.crew = () => tr(DICT).proposed;
      ui.proposeOpen = false;
      ctx.helpers.showToast?.(ui.result.crew());
      ui.busy = false;
      ui.focusSel = "#av-wb-c-status";
      await renderPanel();
    } catch (err) {
      ui.busy = false;
      submitBtn.disabled = false;
      status.textContent = fmtT(T2.actionError, { msg: errMsg(err) });
    }
  });
}
