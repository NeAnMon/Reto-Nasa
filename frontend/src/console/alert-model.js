/*
 * SEMSA · Modelo compartido de alertas (issue #30)
 *
 * Mapeo único que usan el Resumen de la consola (console.js, panel "Alertas C&W") y la sección
 * Alertas (views/alerts.js, "Recomendaciones y contramedidas"):
 *  - motor de origen de cada alerta (predicción, cognitivo, emocional, reglas, aislamiento, radiación)
 *  - módulo donde se hace su contramedida (y a qué sección lleva el botón)
 *  - si está sin reconocer y la prioridad del backend (desempate)
 *  - textos de módulo, motor y contramedida (es / en)
 *
 * Motor de origen: se usa el campo explícito del backend si existe (source_engine, engine,
 * origin_engine o source_module); si no, se deduce del prefijo de rule_code
 * (RULE_EARLY_EARTH_CONTACT → aislamiento, RULE_COGNITIVE_* → cognitivo, RULE_PRED* → predicción…)
 * y, como último recurso, del indicador. Lo desconocido cae en "motor de reglas".
 *
 * Las clases W/C/A siguen en alert-classes.js: aquí no se reimplementan.
 */
import { tr } from "../i18n/i18n.js";
import { isEarlyAlert } from "./alert-classes.js";

/* ───────────────────────── motor de origen ───────────────────────── */

export const ENGINES = Object.freeze(["PREDICTION", "COGNITIVE", "EMOTIONAL", "ISOLATION", "RADIATION", "RULES"]);

/* Sinónimos aceptados (campo explícito o primer término de rule_code tras RULE_ / RULE_EARLY_) */
const ENGINE_ALIAS = {
  PREDICTION: "PREDICTION", PREDICTIONS: "PREDICTION", PREDICTIVE: "PREDICTION", PRED: "PREDICTION", FORECAST: "PREDICTION",
  COGNITIVE: "COGNITIVE", COGNITION: "COGNITIVE", COG: "COGNITIVE",
  EMOTIONAL: "EMOTIONAL", EMOTION: "EMOTIONAL", EMO: "EMOTIONAL", SUPPORT: "EMOTIONAL", PSYCH: "EMOTIONAL", WELLNESS: "EMOTIONAL",
  ISOLATION: "ISOLATION", EARTH: "ISOLATION", ISO: "ISOLATION",
  RADIATION: "RADIATION", RAD: "RADIATION", HERA: "RADIATION",
  RULES: "RULES", RULE: "RULES", RULE_ENGINE: "RULES", RULES_ENGINE: "RULES", CLINICAL: "RULES", ENGINE: "RULES", VITALS: "RULES",
};
const normEngine = (v) => ENGINE_ALIAS[String(v || "").trim().toUpperCase().replace(/[\s-]+/g, "_")] || null;

/* Motor que generó la alerta */
export function engineOf(a) {
  const explicit = normEngine(a?.source_engine) || normEngine(a?.engine) || normEngine(a?.origin_engine) || normEngine(a?.source_module);
  if (explicit) return explicit;
  const rest = String(a?.rule_code || "").toUpperCase().replace(/^RULE_/, "").replace(/^EARLY_/, "");
  const head = rest.split("_")[0];
  const byRule = normEngine(head);
  if (byRule && byRule !== "RULES") return byRule;
  if (/^PREDICT/.test(rest)) return "PREDICTION";
  if (String(a?.indicator_code || "").toUpperCase().startsWith("RADIATION")) return "RADIATION";
  return "RULES";
}

/* ───────────────────────── módulo de la contramedida ───────────────────────── */

const VITAL_CODES = new Set(["HEART_RATE", "BLOOD_PRESSURE", "BODY_TEMP", "SPO2", "RESP_RATE", "BLOOD_GLUCOSE"]);
export const MODULE_ORDER = Object.freeze(["VITALS", "RADIATION", "EMOTIONAL", "COGNITIVE", "SLEEP", "HABITS", "ISOLATION", "OTHER"]);
/* act: acción del botón de contramedida; sec/sub: sección (y pestaña de Bienestar); rec: cuadro de Recomendaciones */
export const MODULE_GO = Object.freeze({
  VITALS: { act: "go-measure", sec: "my-health-check" },
  RADIATION: { act: "go-cm", sec: "radiation" },
  EMOTIONAL: { act: "go-cm", sec: "emotional-center" },
  COGNITIVE: { act: "go-cm", sec: "cognitive-center" },
  SLEEP: { act: "go-cm", sec: "wellbeing-hub", sub: "today" },
  HABITS: { act: "go-cm", sec: "daily-missions" },
  ISOLATION: { act: "go-rec", sec: "recommendations", rec: "earth-channel" },
  OTHER: { act: "go-cm", sec: "daily-missions" },
});

/* Módulo donde se generó la alerta y donde se hace su contramedida */
export function moduleOf(a) {
  const eng = engineOf(a);
  if (eng === "ISOLATION" || eng === "EMOTIONAL" || eng === "COGNITIVE" || eng === "RADIATION") return eng;
  const ind = String(a?.indicator_code || "");
  if (ind.startsWith("RADIATION")) return "RADIATION";
  if (VITAL_CODES.has(ind)) return "VITALS";
  if (ind === "SLEEP_DURATION" || ind === "PERCEIVED_FATIGUE" || ind === "MOOD_WELLNESS") return "SLEEP";
  if (ind === "HYDRATION" || ind === "PHYSICAL_ACTIVITY") return "HABITS";
  return "OTHER";
}

/* Alerta temprana de aislamiento (contacto con Tierra): en Alertas tiene su bloque desplegable */
export const isIsolationEarly = (a) => isEarlyAlert(a) && moduleOf(a) === "ISOLATION";

/* ───────────────────────── estado y orden ───────────────────────── */

/* Sin reconocer: NEW, o ESCALATED por el motor de reglas (las CRITICAL nacen escaladas)
 * sin que nadie haya hecho ACK ni seguimiento. Un escalado manual deja un seguimiento. */
export const isUnacked = (a) => a?.status === "NEW" ||
  (a?.status === "ESCALATED" && !(a.acknowledgements || []).length && !(a.followups || []).length);

export const isOpen = (a) => a?.status !== "RESOLVED";

/* Prioridad del backend (desempate dentro de una misma clase W/C/A) */
export const PRIORITY_RANK = Object.freeze({ CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 });

/* ───────────────────────── vocabulario ───────────────────────── */

const DICT = {
  es: {
    module: {
      VITALS: "Signos vitales",
      RADIATION: "Radiación",
      EMOTIONAL: "Bienestar · check-in emocional",
      COGNITIVE: "Bienestar · evaluación cognitiva",
      SLEEP: "Sueño, fatiga y ánimo",
      HABITS: "Hidratación y actividad física",
      ISOLATION: "Bienestar · aislamiento",
      OTHER: "Otros módulos",
    },
    engine: {
      PREDICTION: "Predicción",
      COGNITIVE: "Motor cognitivo",
      EMOTIONAL: "Motor emocional",
      ISOLATION: "Aislamiento",
      RADIATION: "Radiación",
      RULES: "Motor de reglas",
    },
    counter: {
      VITALS: ["Reposo sentado 5 minutos, hidrátate y vuelve a medir. Si el valor sigue fuera de límite, escala al médico de vuelo.", "Volver a medir"],
      RADIATION: ["Ve al área más blindada de la nave o refugio, aplaza la actividad extravehicular y revisa la dosis acumulada en el dosímetro.", "Abrir Radiación"],
      EMOTIONAL: ["Busca un momento en privado con tu especialista de apoyo y completa el check-in emocional pendiente.", "Abrir Check-in emocional"],
      COGNITIVE: ["Haz una pausa de recuperación (descanso o respiración guiada) y repite la evaluación cognitiva cuando estés descansado.", "Abrir Evaluación cognitiva"],
      SLEEP: ["Higiene de sueño: compartimento oscuro y silencioso, sin pantallas antes de dormir; registra tu sueño en el check-in de Bienestar.", "Abrir Bienestar · Hoy"],
      HABITS: ["Completa las contramedidas de hoy: rutina de hidratación y ejercicio programado.", "Abrir Contramedidas de hoy"],
      ISOLATION: ["Programa un contacto con Tierra con familia o equipo de apoyo.", "Ver canal con Tierra"],
      OTHER: ["Revisa las contramedidas de hoy y sigue el procedimiento de la alerta.", "Abrir Contramedidas de hoy"],
    },
  },
  en: {
    module: {
      VITALS: "Vital signs",
      RADIATION: "Radiation",
      EMOTIONAL: "Wellbeing · emotional check-in",
      COGNITIVE: "Wellbeing · cognitive assessment",
      SLEEP: "Sleep, fatigue and mood",
      HABITS: "Hydration and physical activity",
      ISOLATION: "Wellbeing · isolation",
      OTHER: "Other modules",
    },
    engine: {
      PREDICTION: "Prediction",
      COGNITIVE: "Cognitive engine",
      EMOTIONAL: "Emotional engine",
      ISOLATION: "Isolation",
      RADIATION: "Radiation",
      RULES: "Rules engine",
    },
    counter: {
      VITALS: ["Rest seated for 5 minutes, hydrate and measure again. If the value stays out of limits, escalate to the flight surgeon.", "Measure again"],
      RADIATION: ["Move to the most shielded area or storm shelter, postpone extravehicular activity and check the accumulated dose on the dosimeter.", "Open Radiation"],
      EMOTIONAL: ["Find a private moment with your support specialist and complete the pending emotional check-in.", "Open Emotional check-in"],
      COGNITIVE: ["Take a recovery break (rest or guided breathing) and repeat the cognitive assessment once rested.", "Open Cognitive assessment"],
      SLEEP: ["Sleep hygiene: dark, quiet crew quarters, no screens before sleeping; log your sleep in the Wellbeing check-in.", "Open Wellbeing · Today"],
      HABITS: ["Complete today's countermeasures: hydration routine and scheduled exercise.", "Open Today's countermeasures"],
      ISOLATION: ["Schedule an Earth contact with family or the support team.", "See the Earth channel"],
      OTHER: ["Check today's countermeasures and follow the alert procedure.", "Open Today's countermeasures"],
    },
  },
};

/* Nombre del módulo, del motor y [texto, botón] de la contramedida en el idioma actual */
export const moduleName = (m) => tr(DICT).module[m] || tr(DICT).module.OTHER;
export const engineName = (e) => tr(DICT).engine[e] || tr(DICT).engine.RULES;
export const counterOf = (m) => tr(DICT).counter[m] || tr(DICT).counter.OTHER;

/* ───────────────────────── enlace a la sección Alertas ───────────────────────── */

/* El Resumen deja aquí la alerta que hay que abrir; views/alerts.js la lee (y la borra) al pintarse.
 * Mismo patrón que av_rec_open para la pestaña Recomendaciones. */
export const ALERT_OPEN_KEY = "av_alert_open";
export function requestAlertOpen(id, astronautId) {
  try { sessionStorage.setItem(ALERT_OPEN_KEY, JSON.stringify({ id: Number(id), astronautId: astronautId ? Number(astronautId) : null })); } catch { /* sin almacenamiento: se abre la sección sin selección */ }
}
export function takeAlertOpen() {
  try {
    const raw = sessionStorage.getItem(ALERT_OPEN_KEY);
    sessionStorage.removeItem(ALERT_OPEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Number.isFinite(v?.id) ? v : null;
  } catch {
    return null;
  }
}
