/* =========================================================================
   SEMSA — traducción de textos que llegan del backend (siempre en español)
   -------------------------------------------------------------------------
   El backend guarda y genera sus textos en español (catálogo de indicadores,
   regiones corporales, perfiles de entorno, contramedidas, insignias,
   recomendaciones, títulos/descripciones de alertas, explicaciones, etc.).
   En inglés, la interfaz los pasa por bt() justo al pintarlos:

       import { bt } from "/src/i18n/backend.js";
       `<h3>${esc(bt(region.name))}</h3>`

   - En español bt() devuelve el texto tal cual, salvo los pocos nombres del
     seed que están en inglés (misiones diarias, insignias: ver ES_EXACT).
   - En inglés busca primero una coincidencia exacta (EXACT) y luego patrones
     (PATTERNS) para textos generados con valores dentro (p. ej. títulos de
     alerta "[WARNING] Frecuencia Cardíaca: 93 bpm").
   - Si no encuentra traducción devuelve el original (nunca rompe).
   - bt() se aplica ANTES de escapar el HTML (esc(bt(x))), nunca a valores
     numéricos, códigos, nombres de personas ni texto escrito por usuarios
     (mensajes, notas, respuestas libres).

   Diccionarios (separados por origen para poder mantenerlos):
     backend-en-seed.js     → catálogos de backend/app/database/seed.py
     backend-en-runtime.js  → textos generados en rules/, services/ y api/
   Cada uno exporta:
     export const EXACT = { "texto en español": "English text", ... };
     export const PATTERNS = [ [/^regex$/, (m, bt) => `English ${m[1]}`], ... ];
   ========================================================================= */

import { getLang } from "/src/i18n/i18n.js";
import { EXACT as SEED_EXACT, PATTERNS as SEED_PATTERNS } from "/src/i18n/backend-en-seed.js";
import { EXACT as RT_EXACT, PATTERNS as RT_PATTERNS } from "/src/i18n/backend-en-runtime.js";

const norm = (s) => String(s).replace(/\s+/g, " ").trim();

const EXACT = new Map();
for (const dict of [SEED_EXACT, RT_EXACT]) {
  for (const [es, en] of Object.entries(dict || {})) EXACT.set(norm(es), en);
}
const PATTERNS = [...(RT_PATTERNS || []), ...(SEED_PATTERNS || [])];

/* Fragmentos sueltos que quedan dentro de textos generados (sufijos y unidades que los patrones copian tal cual) */
const TOKENS = [
  [/\[SIMULADO\]/g, "[SIMULATED]"],
  [/\(SIMULADO\)/g, "(SIMULATED)"],
  [/\bSIMULADO\b/g, "SIMULATED"],
  [/(\w)\/día\b/g, "$1/day"],
  [/\bescala 1-10\b/g, "scale 1-10"],
];
const finish = (t) => (typeof t === "string" ? TOKENS.reduce((acc, [re, rep]) => acc.replace(re, rep), t) : t);

/* Excepción: algunos nombres del seed están en inglés (títulos de misiones diarias e insignias,
   backend/app/database/seed.py → DAILY_MISSIONS_DATA / BADGES_DATA). En español bt() los traduce
   EN→ES con este mapa (en inglés se muestran tal cual). Mismos nombres que usa la vista
   Contramedidas (countermeasures.js → DICT.es.title / DICT.es.badge) para que coincidan. */
const ES_EXACT = new Map(Object.entries({
  // Misiones diarias
  "Daily Health Check": "Chequeo de salud diario",
  "Pulse Check": "Control de pulso y presión arterial",
  "Sleep Log": "Registro de sueño",
  "Hydration Routine": "Rutina de hidratación",
  "Move Safely": "Ejercicio seguro (contrarresistencia)",
  "Mind Check": "Chequeo de bienestar psicológico",
  "Environmental Awareness": "Revisión del ambiente de la nave",
  "Mission Reflection": "Reflexión de misión",
  "Follow-up Mission": "Seguimiento de alerta preventiva",
  "Learning Mission": "Misión de aprendizaje",
  "Complete Cognitive Check": "Chequeo cognitivo",
  "Complete Emotional Check-In": "Registro emocional",
  "Review Mission Messages": "Revisar mensajes de misión",
  "Respond Support Request": "Responder solicitud de apoyo",
  "Memory Training Activity": "Entrenamiento de memoria",
  "Visual Attention Activity": "Actividad de atención visual",
  // Insignias
  "First Health Check": "Primer chequeo de salud",
  "Consistency Streak": "Racha de constancia",
  "Sleep Routine Completed": "Rutina de sueño completada",
  "Learning Explorer": "Exploración del aprendizaje",
  "Self-Care Commitment": "Compromiso con el autocuidado",
  "Follow-up Completed": "Seguimiento completado",
  "Mission Milestone": "Hito de misión",
  "Memory Explorer": "Exploración de la memoria",
  "Visual Navigator": "Navegación visual",
  "Attention Specialist": "Especialista en atención",
  "Pattern Detective": "Detective de patrones",
  "Spatial Explorer": "Exploración espacial",
  "Logic Challenger": "Reto lógico",
  "Cognitive Mission Completed": "Misión cognitiva completada",
  "Focus Training": "Entrenamiento de enfoque",
  // Textos del seed en español que citan esos nombres en inglés
  "Completar la misión Sleep Log y revisar pautas de descanso.": "Completar la misión Registro de sueño y revisar pautas de descanso.",
  "Completar una Learning Mission o consultar módulos educativos del Body Explorer.": "Completar una Misión de aprendizaje o consultar módulos educativos del Body Explorer.",
  "Reconocer una alerta o completar una Follow-up Mission.": "Reconocer una alerta o completar un Seguimiento de alerta preventiva.",
}).map(([en, es]) => [norm(en), es]));

function translate(s, depth) {
  const k = norm(s);
  if (!k) return s;
  const hit = EXACT.get(k);
  if (hit !== undefined) return hit;
  if (depth > 3) return finish(s);
  for (const [re, fn] of PATTERNS) {
    const m = k.match(re);
    if (m) {
      try {
        return finish(typeof fn === "function" ? fn(m, (x) => translate(x, depth + 1)) : k.replace(re, fn));
      } catch (_) {
        return finish(s);
      }
    }
  }
  return finish(s);
}

/** Traduce un texto del backend al idioma de la interfaz (solo actúa en inglés). */
export function bt(s) {
  if (s === null || s === undefined || typeof s !== "string") return s;
  if (getLang() !== "en") {
    const es = ES_EXACT.get(norm(s));
    return es === undefined ? s : es;
  }
  return translate(s, 0);
}

/** Para vistas previas que el backend recorta (p. ej. el último mensaje de una conversación):
 *  si no hay coincidencia exacta, busca un texto conocido que empiece igual y lo recorta a un largo similar. */
export function btPreview(s) {
  if (s === null || s === undefined || typeof s !== "string" || getLang() !== "en") return s;
  const k = norm(s);
  if (EXACT.has(k)) return EXACT.get(k);
  const stem = k.replace(/(\.\.\.|…)$/, "").trim();
  if (stem.length >= 24) {
    for (const [es, en] of EXACT) {
      if (es.length > stem.length && es.startsWith(stem)) {
        const cut = Math.max(stem.length, 24);
        return en.length > cut ? `${en.slice(0, cut).trimEnd()}…` : en;
      }
    }
  }
  return translate(s, 0);
}

/** Igual que bt() pero para textos multilínea: traduce línea a línea si el bloque entero no tiene traducción. */
export function btLines(s) {
  if (s === null || s === undefined || typeof s !== "string" || getLang() !== "en") return s;
  const whole = translate(s, 0);
  if (whole !== s) return whole;
  return s.split("\n").map((line) => (line.trim() ? translate(line, 0) : line)).join("\n");
}
