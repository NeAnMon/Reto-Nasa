/*
 * AstroVital · Clases de alerta de la consola (fuente única)
 *
 * La consola usa la convención Caution & Warning de NASA (ISS SSP 50313 §11,
 * NASA-STD-3001 Vol. 2). Hay tres clases de alerta, de más a menos grave:
 *
 *   Letra | Nombre (es / en)        | Color    | Estado del backend
 *   ------+-------------------------+----------+-------------------
 *     W   | crítico / warning       | rojo     | CRITICAL
 *     C   | precaución / caution    | amarillo | WARNING
 *     A   | vigilar / advisory      | gris     | MONITOR
 *
 * OJO: el estado "WARNING" del backend es la clase C (precaución), no la W.
 * El backend no se renombra; la traducción estado → letra se hace solo aquí.
 *
 * Solo W y C son "alarma" (cuentan como sin reconocer, colorean filas y tarjetas).
 * A es informativa: se oculta por defecto en los listados de alertas.
 * A (MONITOR) NO implica "fuera de rango": el motor de reglas también la asigna con el
 * valor dentro del rango normal si cambió respecto a la línea base individual o si dos
 * fuentes se contradicen (backend/app/rules/engine.py). No la describas como fuera de rango.
 *
 * Además de las alertas, cada indicador tiene una letra de estado que no es alerta:
 *   N nominal · S dato sin actualizar · M dato faltante · I dato inválido
 *
 * No reimplementes este mapeo en otro archivo: importa desde aquí.
 */

import { getLang } from "../i18n/i18n.js";

/* Clases de alerta (letras) */
export const CLS = Object.freeze({ WARNING: "W", CAUTION: "C", ADVISORY: "A" });
/* Letras de estado que no son alerta */
export const STATE = Object.freeze({ NOMINAL: "N", STALE: "S", MISSING: "M", INVALID: "I" });

/* Estado del backend (calculated_state / operational_state / region_state) → letra */
export const LETTER = Object.freeze({
  NORMAL: STATE.NOMINAL,
  MONITOR: CLS.ADVISORY,
  WARNING: CLS.CAUTION,
  CRITICAL: CLS.WARNING,
  STALE: STATE.STALE,
  UNKNOWN: STATE.MISSING,
  INVALID: STATE.INVALID,
});

/* Nivel de radiación HERA → letra (la emergencia se muestra como W) */
export const HERA_LETTER = Object.freeze({
  NOMINAL: STATE.NOMINAL,
  ADVISORY: CLS.ADVISORY,
  CAUTION: CLS.CAUTION,
  WARNING: CLS.WARNING,
  EMERGENCY: CLS.WARNING,
});

/* Gravedad para ordenar y para quedarse con el peor estado */
export const RANK = Object.freeze({ N: 0, S: 0, M: 0, I: 1, A: 1, C: 2, W: 3 });

/* Orden de las clases de alerta, de más a menos grave */
export const ALERT_CLASSES = Object.freeze([CLS.WARNING, CLS.CAUTION, CLS.ADVISORY]);

/* Letra de un estado del backend; desconocido → dato faltante */
export const letterOf = (state) => LETTER[state] || STATE.MISSING;

/* Clase (W/C/A) de una alerta del backend según su operational_state */
export function alertClassOf(state) {
  const l = LETTER[state];
  return l === CLS.WARNING || l === CLS.CAUTION ? l : CLS.ADVISORY;
}

/* ¿Es alarma (W o C)? */
export const isAlarm = (l) => l === CLS.WARNING || l === CLS.CAUTION;

/* Clase desde una puntuación de gravedad 0..3 (0 = nominal) */
export const classFromRank = (r) => (r >= 3 ? CLS.WARNING : r >= 2 ? CLS.CAUTION : r >= 1 ? CLS.ADVISORY : STATE.NOMINAL);

/* ───────────────────────── vocabulario ───────────────────────── */

function byLang(dict) {
  const cur = () => dict[getLang()] || dict.es;
  return new Proxy({}, {
    get: (_, k) => (k in cur() ? cur()[k] : dict.es[k]),
    has: (_, k) => k in dict.es,
    ownKeys: () => Reflect.ownKeys(dict.es),
    getOwnPropertyDescriptor: (_, k) => (k in dict.es ? { enumerable: true, configurable: true, writable: false, value: k in cur() ? cur()[k] : dict.es[k] } : undefined),
  });
}

/* Nombre corto de cada letra (badges, filtros, lectores de pantalla) */
export const STATE_WORD = byLang({
  es: { N: "nominal", A: "vigilar", C: "precaución", W: "crítico", S: "dato sin actualizar", M: "dato faltante", I: "dato inválido" },
  en: { N: "nominal", A: "advisory", C: "caution", W: "warning", S: "stale data", M: "missing data", I: "invalid data" },
});

/* Plural de cada clase de alerta (contadores) */
export const CLASS_PLURAL = byLang({
  es: { W: "críticas", C: "precauciones", A: "de vigilancia" },
  en: { W: "warnings", C: "cautions", A: "advisories" },
});

/* Descripción para leyendas: qué significa cada letra */
export const STATE_LEGEND = byLang({
  es: {
    W: "crítico (límite rojo, actuar ya)",
    C: "precaución (límite amarillo)",
    A: "vigilar (sin alarma: conviene seguirlo)",
    N: "nominal",
    S: "dato sin actualizar",
    M: "dato faltante",
    I: "dato inválido",
  },
  en: {
    W: "warning (red limit, act now)",
    C: "caution (yellow limit)",
    A: "advisory (no alarm: keep an eye on it)",
    N: "nominal",
    S: "stale data",
    M: "missing data",
    I: "invalid data",
  },
});
