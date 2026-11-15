/*
 * SEMSA · Datos de la vista "Registrar medición"
 *
 * Único punto de acceso a datos de la vista. Hoy trabaja con el JSON de ejemplo
 * (measure-demo.json) y guarda lo registrado en el navegador (localStorage).
 *
 * Para conectar con SEMSA (Django) basta con cambiar DATA_MODE a "semsa" y
 * completar las dos funciones marcadas con TODO(SEMSA). La vista no cambia:
 * solo consume loadMeasureData() y saveMeasurement().
 *
 * Forma que espera la vista:
 *   indicador: { code, name, name_en, unit, input: "number"|"pair"|"scale", step,
 *                min_valid_value, max_valid_value, stale_after_hours, requires_device,
 *                device?, how_to[], secondary?, quick_add?, low?, high?,
 *                normal_min/max, monitor_min/max, warning_min/max }
 *   último dato: { indicator_code, value, secondary_value, measured_at (ISO), state }
 *   state ∈ NORMAL | MONITOR | WARNING | CRITICAL  (mismo vocabulario que el motor de reglas)
 */

export const DATA_MODE = "demo"; // "demo" | "semsa"

const STORE_KEY = "av-measure-demo-v1";
const DEMO_URL = new URL("./measure-demo.json", import.meta.url).href;

let demoCache = null;

/* ───────────── evaluación (espejo simplificado de rules/engine.py) ───────────── */

const inRange = (v, lo, hi) => (lo === null || lo === undefined || v >= lo) && (hi === null || hi === undefined || v <= hi);

export function evaluate(ind, value) {
  if (inRange(value, ind.normal_min, ind.normal_max)) return "NORMAL";
  if (inRange(value, ind.monitor_min, ind.monitor_max)) return "MONITOR";
  if (inRange(value, ind.warning_min, ind.warning_max)) return "WARNING";
  return "CRITICAL";
}

/* Devuelve un código de error o null: "range" | "secondary_range" | "secondary_order" | "secondary_missing" */
export function validate(ind, value, secondary) {
  if (!inRange(value, ind.min_valid_value, ind.max_valid_value)) return "range";
  const s = ind.secondary;
  if (s) {
    if (secondary === null || secondary === undefined) return s.required ? "secondary_missing" : null;
    if (!inRange(secondary, s.min, s.max)) return "secondary_range";
    if (ind.code === "BLOOD_PRESSURE" && secondary >= value) return "secondary_order";
  }
  return null;
}

/* ───────────── almacenamiento local (solo modo demo) ───────────── */

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeStore(arr) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(arr.slice(-200)));
  } catch {
    /* sin almacenamiento: la medición vive solo en esta sesión */
  }
}

let memoryStore = null; // respaldo si localStorage no está disponible

export function resetDemoData() {
  memoryStore = [];
  try { localStorage.removeItem(STORE_KEY); } catch { /* nada */ }
}

/* ───────────── API pública ───────────── */

export async function loadMeasureData(appState) {
  if (DATA_MODE === "semsa") {
    // TODO(SEMSA): GET /api/health/indicators/ y GET /api/health/measurements/?latest=1&membership=…
    // y mapear la respuesta a la forma descrita arriba (metric → indicator_code, etc.).
    throw new Error("Modo SEMSA aún no conectado");
  }
  if (!demoCache) {
    const r = await fetch(DEMO_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(`No se pudo leer ${DEMO_URL} (${r.status})`);
    demoCache = await r.json();
  }
  const now = Date.now();
  const indicators = demoCache.indicators;
  const byCode = new Map(indicators.map((i) => [i.code, i]));
  const latest = new Map();
  for (const l of demoCache.latest || []) {
    const ind = byCode.get(l.indicator_code);
    if (!ind) continue;
    latest.set(l.indicator_code, {
      indicator_code: l.indicator_code,
      value: l.value,
      secondary_value: l.secondary_value ?? null,
      measured_at: new Date(now - (l.hours_ago || 0) * 3600e3).toISOString(),
      state: evaluate(ind, l.value),
    });
  }
  // lo registrado en este navegador pisa los datos de ejemplo
  const saved = memoryStore ?? readStore();
  for (const m of saved) {
    const prev = latest.get(m.indicator_code);
    if (!prev || prev.measured_at <= m.measured_at) latest.set(m.indicator_code, m);
  }
  return { indicators, latest, astronaut: demoCache.astronaut || null, mode: DATA_MODE };
}

export async function saveMeasurement(ind, { value, secondary_value = null, notes = null }, appState) {
  const err = validate(ind, value, secondary_value);
  if (err) {
    const e = new Error(err);
    e.code = err;
    throw e;
  }
  const measurement = {
    indicator_code: ind.code,
    value,
    secondary_value,
    notes,
    measured_at: new Date().toISOString(),
    state: evaluate(ind, value),
  };
  if (DATA_MODE === "semsa") {
    // TODO(SEMSA): POST /api/health/measurements/ con
    //   { membership: appState.selectedMembershipId, metric: ind.code, value, secondary_value, notes }
    // y devolver { ...measurement, state: respuesta.calculated_state, alert: respuesta.alert }.
    throw new Error("Modo SEMSA aún no conectado");
  }
  // pequeña espera para que el botón muestre "Guardando…" como con red real
  await new Promise((r) => setTimeout(r, 250));
  const arr = memoryStore ?? readStore();
  arr.push(measurement);
  memoryStore = arr;
  writeStore(arr);
  return measurement;
}
