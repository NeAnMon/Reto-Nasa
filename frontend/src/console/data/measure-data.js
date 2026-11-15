/*
 * SEMSA · Datos de la vista "Registrar medición"
 *
 * Único punto de acceso a datos de la vista. La vista solo consume
 * loadMeasureData() y saveMeasurement(). Todo viene de la base de datos vía API
 * (la app siempre arranca con sesión iniciada; no hay modo demo ni datos locales):
 *   - catálogo: GET  /api/v1/health/indicators  (apiService.getHealthIndicators())
 *               solo los indicadores con bloque "measure" (registro manual), ordenados
 *               por measure.order. Se guarda en memoria: no cambia por astronauta.
 *   - leer:     GET  /api/v1/health/measurements?astronaut_id=…&mission_id=…
 *   - guardar:  POST /api/v1/health/measurements { astronaut_id, mission_id, … }
 * El astronauta es appState.selectedAstronautId (nunca el id del usuario conectado): el líder de misión
 * registra para el tripulante elegido en el selector; el backend valida permisos
 * (un ASTRONAUT solo puede registrar las suyas). evaluate()/validate() solo sirven para
 * la vista previa en vivo; el estado definitivo lo calcula el backend.
 *
 * Forma que espera la vista:
 *   indicador: { code, name, name_en, unit, input: "number"|"pair"|"scale", step,
 *                min_valid_value, max_valid_value, stale_after_hours, requires_device,
 *                device?, device_en?, how_to[], how_to_en[], secondary?, quick_add?,
 *                low?, low_en?, high?, high_en?,
 *                normal_min/max, monitor_min/max, warning_min/max }
 *     → campos de item.measure + code/unit/límites/umbrales del nivel superior del item;
 *       name = measure.name (nombre corto en español).
 *   último dato: { indicator_code, value, secondary_value, measured_at (ISO), state }
 *   state ∈ NORMAL | MONITOR | WARNING | CRITICAL  (mismo vocabulario que el motor de reglas)
 */

import { apiService } from "../../services/api.js";

const STATES = new Set(["NORMAL", "MONITOR", "WARNING", "CRITICAL"]);
const THRESHOLDS = ["normal_min", "normal_max", "monitor_min", "monitor_max", "warning_min", "warning_max"];
const TOP_LEVEL = ["code", "unit", "min_valid_value", "max_valid_value", "stale_after_hours", "requires_device"];

let catalogCache = null; // indicadores ya mapeados (no dependen del astronauta)

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

/* ───────────── catálogo ───────────── */

function toViewIndicator(item) {
  const m = item.measure;
  const ind = { ...m };
  for (const k of TOP_LEVEL) ind[k] = item[k] ?? m[k] ?? null;
  for (const k of THRESHOLDS) ind[k] = item[k] ?? m[k] ?? null;
  ind.name = m.name || item.name;
  if (m.unit_short) ind.unit = m.unit_short; // la unidad de la BD puede ser larga ("mL/día")
  ind.how_to = Array.isArray(m.how_to) ? m.how_to : [];
  ind.how_to_en = Array.isArray(m.how_to_en) ? m.how_to_en : [];
  return ind;
}

async function loadCatalog() {
  if (catalogCache) return catalogCache;
  const res = await apiService.getHealthIndicators();
  const items = Array.isArray(res) ? res : Array.isArray(res?.indicators) ? res.indicators : [];
  const indicators = items
    .filter((i) => i && i.code && i.measure && typeof i.measure === "object")
    .sort((a, b) => (Number(a.measure.order) || 0) - (Number(b.measure.order) || 0))
    .map(toViewIndicator);
  if (indicators.length) catalogCache = indicators; // un catálogo vacío no se guarda: se reintenta
  return indicators;
}

/* ───────────── mediciones ───────────── */

/* Estado del backend → vocabulario de la vista; UNKNOWN/STALE se reevalúan localmente */
const viewState = (ind, value, backendState) => (STATES.has(backendState) ? backendState : evaluate(ind, value));

async function fetchLatest(appState, byCode) {
  const params = new URLSearchParams({ limit: "500" });
  if (appState?.selectedAstronautId) params.set("astronaut_id", appState.selectedAstronautId);
  if (appState?.selectedMissionId) params.set("mission_id", appState.selectedMissionId);
  const res = await apiService.request(`/health/measurements?${params}`);
  const latest = new Map();
  // vienen ordenadas por measured_at desc: la primera de cada indicador es la última
  for (const r of res?.measurements || []) {
    const ind = byCode.get(r.indicator_code);
    if (!ind || latest.has(r.indicator_code) || r.calculated_state === "INVALID") continue;
    latest.set(r.indicator_code, {
      id: r.id,
      indicator_code: r.indicator_code,
      value: r.value,
      secondary_value: r.secondary_value ?? null,
      notes: r.notes ?? null,
      measured_at: r.measured_at,
      state: viewState(ind, r.value, r.calculated_state),
    });
  }
  return latest;
}

/* ───────────── API pública ───────────── */

export async function loadMeasureData(appState) {
  const indicators = await loadCatalog();
  const byCode = new Map(indicators.map((i) => [i.code, i]));
  const latest = await fetchLatest(appState, byCode);
  return { indicators, latest, astronaut: null, mode: "api" };
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

  const res = await apiService.createMeasurement({
    astronaut_id: appState?.selectedAstronautId ?? null,
    mission_id: appState?.selectedMissionId ?? null,
    indicator_code: ind.code,
    value,
    secondary_value,
    notes,
    measured_at: measurement.measured_at,
    source_code: "MANUAL_ENTRY",
    // evita duplicados si la cola offline reintenta el mismo envío
    dedup_key: `ms-${appState?.selectedAstronautId ?? "x"}-${ind.code}-${Date.now()}`,
  });
  if (res?.queued_offline) return { ...measurement, queued_offline: true };
  const saved = res?.measurement;
  if (!saved) return measurement;
  return {
    ...measurement,
    id: saved.id,
    measured_at: saved.measured_at || measurement.measured_at,
    state: viewState(ind, value, saved.calculated_state),
    alert: res.alert_generated || null,
    next_step: res.recommended_next_step || null,
  };
}
