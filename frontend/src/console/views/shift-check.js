/* SEMSA · Consola · Bienestar → Cuestionarios → "Chequeo del turno"
 *
 * Daily check, carga de trabajo (NASA-TLX) y test de reacción tipo PVT, en un solo formulario:
 *   - Sueño y ánimo: NO se vuelven a preguntar. Se muestran los del check-in de Bienestar → Hoy
 *     (mismas escalas: horas 0–16 y ánimo 1–5) con un botón para ir a Hoy si falta o hay que corregirlo.
 *   - Estrés percibido 1–10 y FC en reposo (lpm).
 *   - NASA-TLX: seis escalas 0–100 (exigencia mental, física y temporal, rendimiento [0 = perfecto,
 *     100 = fracaso], esfuerzo y frustración). Puntuación global = media simple de las seis
 *     ("Raw TLX", sin el paso de ponderación del índice oficial). Cortes 50 / 70: decisión del equipo.
 *   - Test de reacción tipo PVT: esperas aleatorias de 1–4 s (como el PVT-B), duración 1 min (rápido,
 *     no validado), 3 min (duración del PVT-B) o 5 min. Resultado: tiempo medio, mediana, lapsos
 *     (respuestas > 500 ms o sin respuesta en 10 s) y falsos inicios (pulsar antes del estímulo o < 100 ms).
 *     El navegador y la pantalla añaden un retardo desconocido: no es la herramienta validada de NASA.
 *
 * Guardado: el backend no tiene (todavía) un recurso para TLX ni PVT, así que el chequeo se guarda en
 * este dispositivo (localStorage por usuario, con try/catch y respaldo en memoria), igual que el
 * contador de Respiración. Es un registro personal de autocuidado: no se envía al líder.
 *
 * Fuentes: NASA Ames, NASA-TLX (https://www.nasa.gov/human-systems-integration-division/nasa-task-load-index-tlx/);
 * Basner et al., 2011 (PVT-B, PMC3197786); Jones et al., 2022 (Reaction Self-Test en la ISS, PMC8919197).
 */
import { tr, fmt as fmtT, fmtNum, locale } from "../../i18n/i18n.js";
import { esc, isOwnAstronaut } from "./more-common.js";

const LIMITS = { hrMin: 30, hrMax: 220 };
const TLX_KEYS = ["md", "pd", "td", "pf", "ef", "fr"];
const TLX_DEF = 50;
const TLX_WARN = 50; // decisión del equipo (igual que el material de referencia)
const TLX_HIGH = 70;
const PVT = {
  durations: [60, 180, 300],
  waitMin: 1000, waitSpan: 3000, // espera aleatoria 1–4 s (PVT-B)
  lapseMs: 500,                  // lapso: respuesta de más de 500 ms
  falseMs: 100,                  // respuesta < 100 ms = anticipación (falso inicio)
  timeoutMs: 10000,              // sin respuesta en 10 s → lapso
  minResponses: 5,
};
const STORE_PREFIX = "av_shift_checks_v1:";
const HISTORY_MAX = 30;

const DICT = {
  es: {
    title: "Chequeo del turno",
    sub: "Diario · 2–6 minutos",
    intro: "Cómo llegas al final del turno: estrés, pulso en reposo, carga de trabajo y un test breve de reacción.",
    fromToday: "Del check-in de Hoy",
    sleepLbl: "Sueño",
    moodLbl: "Ánimo",
    noToday: "Aún no has hecho el check-in de hoy: ahí se registran el sueño y el ánimo.",
    goToday: "Ir a Hoy",
    editToday: "Corregir en Hoy",
    stress: "Estrés percibido (1–10)",
    stressLo: "Muy bajo",
    stressHi: "Muy alto",
    hr: "FC en reposo (lpm, opcional)",
    hrHint: "Mídela sentado/a tras 5 minutos de reposo. Entre 30 y 220.",
    tlxTitle: "Carga del turno (NASA-TLX)",
    tlxIntro: "Seis escalas de 0 a 100. Piensa en el turno que acabas de terminar.",
    tlx: {
      md: { name: "Exigencia mental", desc: "¿Cuánto tuviste que pensar, decidir y recordar?", lo: "muy baja", hi: "muy alta" },
      pd: { name: "Exigencia física", desc: "¿Cuánta actividad física necesitó el turno?", lo: "muy baja", hi: "muy alta" },
      td: { name: "Exigencia temporal", desc: "¿Cuánta prisa o presión de tiempo hubo?", lo: "muy baja", hi: "muy alta" },
      pf: { name: "Rendimiento", desc: "¿Qué tan bien hiciste lo que tenías que hacer?", lo: "perfecto", hi: "fracaso" },
      ef: { name: "Esfuerzo", desc: "¿Cuánto tuviste que esforzarte para lograr ese rendimiento?", lo: "muy bajo", hi: "muy alto" },
      fr: { name: "Frustración", desc: "¿Cuánta irritación, estrés o molestia sentiste?", lo: "muy baja", hi: "muy alta" },
    },
    tlxScore: "Carga global (media de las seis)",
    tlxLevel: { ok: "Turno manejable", warn: "Turno exigente", high: "Turno muy exigente" },
    tlxNote: "Media simple de las seis escalas (Raw TLX), sin la ponderación del índice oficial.",
    pvtTitle: "Test de reacción (tipo PVT)",
    pvtIntro: "Pulsa el recuadro (o Espacio) en cuanto aparezca «¡YA!». No te adelantes.",
    pvtLen: "Duración",
    pvtLens: { 60: "1 minuto (rápido, no validado)", 180: "3 minutos (duración del PVT-B)", 300: "5 minutos" },
    pvtStart: "Pulsa aquí para empezar",
    pvtWait: "Espera… ({s} s restantes)",
    pvtGo: "¡YA!",
    pvtEarly: "Demasiado pronto. Espera a «¡YA!»",
    pvtMs: "{ms} ms",
    pvtMiss: "Sin respuesta",
    pvtDone: "Test completado. Pulsa para repetir.",
    pvtFew: "Muy pocas respuestas para puntuar. Pulsa para repetir.",
    pvtStop: "Detener test",
    pvtStopped: "Test detenido. Pulsa para empezar de nuevo.",
    pvtAria: "Área del test de reacción",
    pvtNone: "Aún no has hecho el test en este chequeo (es opcional).",
    pvtMean: "Tiempo medio de reacción",
    pvtMedian: "Mediana",
    pvtResp: "Respuestas válidas",
    pvtLapses: "Lapsos (> 500 ms)",
    pvtFalse: "Falsos inicios",
    pvtDevice: "Usa siempre el mismo dispositivo: la pantalla y el navegador añaden su propio retardo. No es la herramienta validada de NASA.",
    pvtRunning: "Termina o detén el test de reacción antes de guardar.",
    save: "Guardar chequeo del turno",
    badStress: "Elige tu nivel de estrés percibido (1–10).",
    badHr: "Indica la FC en reposo con un número entre 30 y 220, o déjala vacía.",
    saved: "Chequeo del turno guardado en este dispositivo.",
    savedMemory: "Chequeo guardado solo hasta cerrar la pestaña: este navegador no permite guardar datos.",
    history: "Tus últimos chequeos ({n})",
    historyEmpty: "Aún no hay chequeos guardados en este dispositivo.",
    hStress: "Estrés {v}/10",
    hHr: "FC {v} lpm",
    hTlx: "TLX {v}",
    hPvt: "TR {v} ms",
    localNote: "Se guarda solo en este dispositivo (demo): es tu registro personal y no se envía al líder.",
    notOwn: "El chequeo del turno lo registra cada tripulante en su propio dispositivo; no hay datos compartidos que mostrar.",
  },
  en: {
    title: "Shift check",
    sub: "Daily · 2–6 minutes",
    intro: "How you finish the shift: stress, resting pulse, workload and a short reaction test.",
    fromToday: "From today's check-in",
    sleepLbl: "Sleep",
    moodLbl: "Mood",
    noToday: "You haven't done today's check-in yet: that's where sleep and mood are logged.",
    goToday: "Go to Today",
    editToday: "Correct in Today",
    stress: "Perceived stress (1–10)",
    stressLo: "Very low",
    stressHi: "Very high",
    hr: "Resting heart rate (bpm, optional)",
    hrHint: "Measure it seated after 5 minutes of rest. Between 30 and 220.",
    tlxTitle: "Shift workload (NASA-TLX)",
    tlxIntro: "Six scales from 0 to 100. Think about the shift you have just finished.",
    tlx: {
      md: { name: "Mental demand", desc: "How much thinking, deciding and remembering did the shift need?", lo: "very low", hi: "very high" },
      pd: { name: "Physical demand", desc: "How much physical activity did the shift need?", lo: "very low", hi: "very high" },
      td: { name: "Temporal demand", desc: "How hurried or rushed was the pace?", lo: "very low", hi: "very high" },
      pf: { name: "Performance", desc: "How successful were you in what you had to do?", lo: "perfect", hi: "failure" },
      ef: { name: "Effort", desc: "How hard did you have to work to reach that level of performance?", lo: "very low", hi: "very high" },
      fr: { name: "Frustration", desc: "How irritated, stressed or annoyed did you feel?", lo: "very low", hi: "very high" },
    },
    tlxScore: "Overall workload (mean of the six)",
    tlxLevel: { ok: "Manageable shift", warn: "Demanding shift", high: "Very demanding shift" },
    tlxNote: "Plain mean of the six scales (Raw TLX), without the weighting step of the official index.",
    pvtTitle: "Reaction test (PVT-style)",
    pvtIntro: "Press the box (or Space) as soon as \"GO!\" appears. Don't jump the gun.",
    pvtLen: "Duration",
    pvtLens: { 60: "1 minute (quick, not validated)", 180: "3 minutes (length of the PVT-B)", 300: "5 minutes" },
    pvtStart: "Press here to start",
    pvtWait: "Wait… ({s} s left)",
    pvtGo: "GO!",
    pvtEarly: "Too early. Wait for \"GO!\"",
    pvtMs: "{ms} ms",
    pvtMiss: "No response",
    pvtDone: "Test complete. Press to repeat.",
    pvtFew: "Too few responses to score. Press to repeat.",
    pvtStop: "Stop test",
    pvtStopped: "Test stopped. Press to start again.",
    pvtAria: "Reaction test area",
    pvtNone: "You haven't taken the test in this check yet (it's optional).",
    pvtMean: "Mean reaction time",
    pvtMedian: "Median",
    pvtResp: "Valid responses",
    pvtLapses: "Lapses (> 500 ms)",
    pvtFalse: "False starts",
    pvtDevice: "Always use the same device: the screen and browser add their own delay. This is not the validated NASA tool.",
    pvtRunning: "Finish or stop the reaction test before saving.",
    save: "Save shift check",
    badStress: "Choose your perceived stress level (1–10).",
    badHr: "Enter the resting heart rate as a number between 30 and 220, or leave it empty.",
    saved: "Shift check saved on this device.",
    savedMemory: "Check kept only until you close the tab: this browser doesn't allow storing data.",
    history: "Your latest checks ({n})",
    historyEmpty: "No checks saved on this device yet.",
    hStress: "Stress {v}/10",
    hHr: "HR {v} bpm",
    hTlx: "TLX {v}",
    hPvt: "RT {v} ms",
    localNote: "Stored only on this device (demo): it's your personal record and isn't sent to the leader.",
    notOwn: "Each crew member logs the shift check on their own device; there's no shared data to show.",
  },
};

/* Estado del módulo: sobrevive a repintados (cambio de idioma) mientras la pestaña siga abierta */
const sc = {
  userKey: "anon",
  duration: 60,
  pvtResult: null,  // { seconds, mean_ms, median_ms, responses, lapses, false_starts }
  savedMsg: null,   // () => texto en el idioma vigente
  memory: [],       // respaldo si localStorage no está disponible
  run: null,        // test en curso: { state, seconds, t0, goAt, trials, lapses, falseStarts, timer }
};

/* ───────────────────────── almacenamiento local ───────────────────────── */

function readHistory() {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + sc.userKey);
    const arr = raw ? JSON.parse(raw) : [];
    return { ok: true, items: Array.isArray(arr) ? arr : [] };
  } catch {
    return { ok: false, items: sc.memory };
  }
}
function writeHistory(entry) {
  const cur = readHistory();
  const items = [entry, ...cur.items].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(STORE_PREFIX + sc.userKey, JSON.stringify(items));
    return true;
  } catch {
    sc.memory = items;
    return false;
  }
}

/* ───────────────────────── utilidades ───────────────────────── */

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function tlxLevel(score) {
  return score >= TLX_HIGH ? "high" : score >= TLX_WARN ? "warn" : "ok";
}
function whenText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

/* Detiene un test en curso (al cambiar de pestaña o repintar): sin temporizadores huérfanos */
export function stopShiftCheck() {
  if (sc.run?.timer) clearTimeout(sc.run.timer);
  sc.run = null;
}

/* ───────────────────────── HTML ───────────────────────── */

function todayHTML(T, today) {
  if (!today) {
    return `<div class="av-mx-note av-sc-today">
        <span>${esc(T.noToday)}</span>
        <span><button type="button" class="av-btn av-btn-sm" data-qz-tab="today">${esc(T.goToday)}</button></span>
      </div>`;
  }
  const sleep = Number.isFinite(Number(today.sleep_hours)) ? `${fmtNum(today.sleep_hours, 1)} h` : "—";
  const mood = Number.isFinite(Number(today.mood)) ? `${today.mood}/5` : "—";
  return `<div class="av-sc-today">
      <dl class="av-mx-kv">
        <dt>${esc(T.sleepLbl)} <span class="av-sub">· ${esc(T.fromToday)}</span></dt><dd>${esc(sleep)}</dd>
        <dt>${esc(T.moodLbl)} <span class="av-sub">· ${esc(T.fromToday)}</span></dt><dd>${esc(mood)}</dd>
      </dl>
      <div><button type="button" class="av-btn av-btn-sm" data-qz-tab="today">${esc(T.editToday)}</button></div>
    </div>`;
}

function stressHTML(T) {
  const opts = [];
  for (let n = 1; n <= 10; n += 1) {
    opts.push(`<label class="av-qz-opt" for="av-sc-stress-${n}"><input type="radio" id="av-sc-stress-${n}" name="av-sc-stress" value="${n}"><span class="av-mono">${n}</span></label>`);
  }
  return `<fieldset class="av-qz-scale">
      <legend class="av-wb-legend">${esc(T.stress)}</legend>
      <div class="av-qz-row">${opts.join("")}</div>
      <div class="av-qz-ends" aria-hidden="true"><span>1 · ${esc(T.stressLo)}</span><span>${esc(T.stressHi)} · 10</span></div>
    </fieldset>`;
}

function tlxHTML(T) {
  const rows = TLX_KEYS.map((k) => {
    const s = T.tlx[k];
    return `<div class="av-sc-tlx">
        <div class="av-sc-tlx-head">
          <label for="av-sc-tlx-${k}">${esc(s.name)}</label>
          <output class="av-mono" for="av-sc-tlx-${k}" data-sc-out="${k}">${TLX_DEF}</output>
        </div>
        <p class="av-sub av-sc-tlx-desc" id="av-sc-tlx-${k}-d">${esc(s.desc)}</p>
        <input type="range" class="av-sc-range" id="av-sc-tlx-${k}" min="0" max="100" step="5" value="${TLX_DEF}"
          data-sc-tlx="${k}" aria-describedby="av-sc-tlx-${k}-d av-sc-tlx-${k}-e" />
        <div class="av-qz-ends" id="av-sc-tlx-${k}-e"><span>0 = ${esc(s.lo)}</span><span>100 = ${esc(s.hi)}</span></div>
      </div>`;
  }).join("");
  return `<fieldset class="av-sc-block">
      <legend class="av-h3">${esc(T.tlxTitle)}</legend>
      <p class="av-mx-p av-sub">${esc(T.tlxIntro)}</p>
      ${rows}
      <p class="av-mx-p av-sc-total" data-sc-total aria-live="polite">${tlxTotalHTML(T, TLX_DEF)}</p>
      <p class="av-mx-p av-sub">${esc(T.tlxNote)}</p>
    </fieldset>`;
}

function tlxTotalHTML(T, score) {
  const lvl = tlxLevel(score);
  return `<span>${esc(T.tlxScore)}:</span> <strong class="av-mono">${score}/100</strong>
    <span class="av-mx-tag${lvl === "high" ? " av-mx-tag-strong" : ""}">${esc(T.tlxLevel[lvl])}</span>`;
}

function pvtResultHTML(T) {
  const r = sc.pvtResult;
  if (!r) return `<p class="av-mx-p av-sub">${esc(T.pvtNone)}</p>`;
  return `<dl class="av-mx-kv">
      <dt>${esc(T.pvtMean)}</dt><dd>${esc(fmtT(T.pvtMs, { ms: r.mean_ms }))}</dd>
      <dt>${esc(T.pvtMedian)}</dt><dd>${esc(fmtT(T.pvtMs, { ms: r.median_ms }))}</dd>
      <dt>${esc(T.pvtResp)}</dt><dd>${esc(r.responses)}</dd>
      <dt>${esc(T.pvtLapses)}</dt><dd>${esc(r.lapses)}</dd>
      <dt>${esc(T.pvtFalse)}</dt><dd>${esc(r.false_starts)}</dd>
    </dl>`;
}

function pvtHTML(T) {
  const opts = PVT.durations.map((s) => `<option value="${s}" ${s === sc.duration ? "selected" : ""}>${esc(T.pvtLens[s])}</option>`).join("");
  return `<fieldset class="av-sc-block">
      <legend class="av-h3">${esc(T.pvtTitle)}</legend>
      <p class="av-mx-p av-sub">${esc(T.pvtIntro)}</p>
      <div class="av-field av-sc-len">
        <label for="av-sc-pvt-len">${esc(T.pvtLen)}</label>
        <select class="av-input" id="av-sc-pvt-len">${opts}</select>
      </div>
      <button type="button" class="av-sc-pvt" id="av-sc-pvt" data-sc-pvt aria-label="${esc(T.pvtAria)}" aria-describedby="av-sc-pvt-live">
        <span data-sc-pvt-txt>${esc(sc.pvtResult ? T.pvtDone : T.pvtStart)}</span>
      </button>
      <span class="av-mx-sr" id="av-sc-pvt-live" aria-live="assertive" data-sc-pvt-live></span>
      <div><button type="button" class="av-btn av-btn-sm" data-sc-pvt-stop hidden>${esc(T.pvtStop)}</button></div>
      <div data-sc-pvt-res>${pvtResultHTML(T)}</div>
      <p class="av-mx-p av-sub">${esc(T.pvtDevice)}</p>
    </fieldset>`;
}

function historyHTML(T) {
  const { items } = readHistory();
  const list = items.slice(0, 7);
  return `<details class="av-wb-how av-qz-hist">
      <summary>${esc(fmtT(T.history, { n: items.length }))}</summary>
      ${list.length
        ? `<ul>${list.map((e) => {
            const bits = [fmtT(T.hStress, { v: e.stress })];
            if (Number.isFinite(e.hr)) bits.push(fmtT(T.hHr, { v: e.hr }));
            bits.push(fmtT(T.hTlx, { v: e.tlx_score }));
            if (e.pvt) bits.push(fmtT(T.hPvt, { v: e.pvt.mean_ms }));
            return `<li><span class="av-mono av-sub">${esc(whenText(e.at))}</span> <span>${esc(bits.join(" · "))}</span></li>`;
          }).join("")}</ul>`
        : `<p class="av-mx-p av-sub">${esc(T.historyEmpty)}</p>`}
    </details>`;
}

/** HTML del bloque (sin eventos). today: check-in de hoy de Bienestar → Hoy, o null */
export function shiftCheckHTML(appState, today) {
  const T = tr(DICT);
  sc.userKey = String(appState?.currentUser?.id ?? appState?.selectedAstronautId ?? "anon");
  const own = isOwnAstronaut(appState);
  const head = `<div class="av-panel-head"><h3 class="av-h3" id="av-sc-h">${esc(T.title)}</h3><span class="av-sub">${esc(T.sub)}</span></div>`;
  if (!own) {
    return `<section class="av-panel" aria-labelledby="av-sc-h">${head}
        <div class="av-mx-pad"><p class="av-mx-p">${esc(T.notOwn)}</p></div>
      </section>`;
  }
  return `<section class="av-panel" aria-labelledby="av-sc-h">${head}
      <div class="av-mx-pad av-qz-body">
        <p class="av-mx-p av-sub">${esc(T.intro)}</p>
        ${todayHTML(T, today)}
        <form class="av-mx-form" id="av-sc-form" novalidate>
          ${stressHTML(T)}
          <div class="av-field av-wb-hours">
            <label for="av-sc-hr">${esc(T.hr)}</label>
            <input class="av-input" type="number" inputmode="numeric" min="${LIMITS.hrMin}" max="${LIMITS.hrMax}" step="1"
              id="av-sc-hr" aria-describedby="av-sc-hr-hint" />
            <span class="av-sub" id="av-sc-hr-hint">${esc(T.hrHint)}</span>
          </div>
          ${tlxHTML(T)}
          ${pvtHTML(T)}
          <div class="av-mx-btns">
            <button type="submit" class="av-btn av-btn-primary" id="av-sc-save">${esc(T.save)}</button>
          </div>
          <p class="av-mx-status" id="av-sc-status" role="status" aria-live="polite" tabindex="-1">${esc(sc.savedMsg ? sc.savedMsg() : "")}</p>
        </form>
        <div data-sc-hist>${historyHTML(T)}</div>
        <p class="av-mx-p av-sub av-qz-foot">${esc(T.localNote)}</p>
      </div>
    </section>`;
}

/* ───────────────────────── eventos ───────────────────────── */

export function bindShiftCheck(box, { today }) {
  const form = box?.querySelector("#av-sc-form");
  if (!form) return;
  const T = () => tr(DICT);
  const status = form.querySelector("#av-sc-status");

  // NASA-TLX: valor de cada escala y puntuación global en vivo
  const sliders = Array.from(form.querySelectorAll("[data-sc-tlx]"));
  const tlxValues = () => Object.fromEntries(sliders.map((s) => [s.getAttribute("data-sc-tlx"), Number(s.value)]));
  const tlxScore = () => Math.round(mean(Object.values(tlxValues())));
  const syncTlx = () => {
    sliders.forEach((s) => {
      const out = form.querySelector(`[data-sc-out="${s.getAttribute("data-sc-tlx")}"]`);
      if (out) out.textContent = s.value;
    });
    form.querySelector("[data-sc-total]").innerHTML = tlxTotalHTML(T(), tlxScore());
  };
  sliders.forEach((s) => s.addEventListener("input", syncTlx));
  syncTlx();
  setTimeout(() => { if (form.isConnected) syncTlx(); }, 0); // tras restaurar valores por un cambio de idioma

  bindPvt(form);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = T();
    if (sc.run) {
      status.textContent = t.pvtRunning;
      return;
    }
    const stressEl = form.querySelector('input[name="av-sc-stress"]:checked');
    if (!stressEl) {
      status.textContent = t.badStress;
      form.querySelector("#av-sc-stress-1")?.focus();
      return;
    }
    const hrEl = form.querySelector("#av-sc-hr");
    const hrRaw = String(hrEl.value).trim();
    let hr = null;
    if (hrRaw !== "") {
      hr = Number(hrRaw.replace(",", "."));
      if (!Number.isFinite(hr) || hr < LIMITS.hrMin || hr > LIMITS.hrMax) {
        hrEl.setAttribute("aria-invalid", "true");
        hrEl.focus();
        status.textContent = t.badHr;
        return;
      }
      hr = Math.round(hr);
    }
    hrEl.removeAttribute("aria-invalid");
    const entry = {
      at: new Date().toISOString(),
      stress: Number(stressEl.value),
      hr,
      tlx: tlxValues(),
      tlx_score: tlxScore(),
      pvt: sc.pvtResult ? { ...sc.pvtResult } : null,
      // instantánea del check-in de Hoy (no se vuelve a preguntar aquí)
      sleep_hours: today && Number.isFinite(Number(today.sleep_hours)) ? Number(today.sleep_hours) : null,
      mood: today && Number.isFinite(Number(today.mood)) ? Number(today.mood) : null,
    };
    const persisted = writeHistory(entry);
    sc.savedMsg = () => (persisted ? tr(DICT).saved : tr(DICT).savedMemory);
    sc.pvtResult = null;
    status.textContent = sc.savedMsg();
    status.focus();
    // se limpia el formulario para el próximo turno; el historial se actualiza
    form.querySelectorAll('input[name="av-sc-stress"]').forEach((r) => (r.checked = false));
    hrEl.value = "";
    sliders.forEach((s) => (s.value = String(TLX_DEF)));
    syncTlx();
    const res = form.querySelector("[data-sc-pvt-res]");
    if (res) res.innerHTML = pvtResultHTML(t);
    const txt = form.querySelector("[data-sc-pvt-txt]");
    if (txt) txt.textContent = t.pvtStart;
    const hist = box.querySelector("[data-sc-hist]");
    if (hist) hist.innerHTML = historyHTML(t);
  });
}

/* Test de reacción: pointerdown / Espacio-Enter para no sumar el retardo del evento click */
function bindPvt(form) {
  const btn = form.querySelector("[data-sc-pvt]");
  const txt = form.querySelector("[data-sc-pvt-txt]");
  const live = form.querySelector("[data-sc-pvt-live]");
  const stop = form.querySelector("[data-sc-pvt-stop]");
  const lenSel = form.querySelector("#av-sc-pvt-len");
  const resBox = form.querySelector("[data-sc-pvt-res]");
  if (!btn) return;
  const T = () => tr(DICT);
  const alive = () => {
    if (!btn.isConnected) { stopShiftCheck(); return false; } // la pestaña cambió: se abandona el test
    return !!sc.run;
  };
  const setBox = (cls, text, announce = false) => {
    btn.classList.remove("is-wait", "is-go");
    if (cls) btn.classList.add(cls);
    txt.textContent = text;
    if (announce) live.textContent = text;
  };
  const schedule = (fn, ms) => {
    if (sc.run.timer) clearTimeout(sc.run.timer);
    sc.run.timer = setTimeout(() => { if (alive()) fn(); }, ms);
  };

  lenSel.addEventListener("change", () => {
    const v = Number(lenSel.value);
    if (PVT.durations.includes(v)) sc.duration = v;
  });

  const finish = () => {
    const r = sc.run;
    stopShiftCheck();
    stop.hidden = true;
    lenSel.disabled = false;
    if (r.trials.length < PVT.minResponses) {
      setBox(null, T().pvtFew, true);
      return;
    }
    sc.pvtResult = {
      seconds: r.seconds,
      mean_ms: Math.round(mean(r.trials)),
      median_ms: Math.round(median(r.trials)),
      responses: r.trials.length,
      lapses: r.trials.filter((t) => t > PVT.lapseMs).length + r.misses,
      false_starts: r.falseStarts,
    };
    resBox.innerHTML = pvtResultHTML(T());
    setBox(null, T().pvtDone, true);
  };

  const nextTrial = () => {
    const r = sc.run;
    const elapsed = performance.now() - r.t0;
    if (elapsed >= r.seconds * 1000) return finish();
    r.state = "WAIT";
    setBox("is-wait", fmtT(T().pvtWait, { s: Math.max(0, Math.ceil(r.seconds - elapsed / 1000)) }));
    schedule(() => {
      r.state = "GO";
      r.goAt = performance.now();
      setBox("is-go", T().pvtGo, true);
      schedule(() => { // sin respuesta: cuenta como lapso
        r.misses += 1;
        r.state = "PAUSE";
        setBox(null, T().pvtMiss);
        schedule(nextTrial, 800);
      }, PVT.timeoutMs);
    }, PVT.waitMin + Math.random() * PVT.waitSpan);
  };

  const press = () => {
    const r = sc.run;
    if (!r) {
      sc.pvtResult = null;
      resBox.innerHTML = pvtResultHTML(T());
      const v = Number(lenSel.value);
      sc.run = { state: "PAUSE", seconds: PVT.durations.includes(v) ? v : 60, t0: performance.now(), goAt: 0, trials: [], misses: 0, falseStarts: 0, timer: null };
      stop.hidden = false;
      lenSel.disabled = true;
      nextTrial();
      return;
    }
    if (r.state === "WAIT") {
      r.falseStarts += 1;
      r.state = "PAUSE";
      setBox(null, T().pvtEarly, true);
      schedule(nextTrial, 800);
    } else if (r.state === "GO") {
      const rt = performance.now() - r.goAt;
      if (rt < PVT.falseMs) r.falseStarts += 1;
      else r.trials.push(rt);
      r.state = "PAUSE";
      setBox(null, fmtT(T().pvtMs, { ms: Math.round(rt) }));
      schedule(nextTrial, 500);
    }
  };

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    btn.focus({ preventScroll: true });
    press();
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (e.repeat) return;
    press();
  });
  // el click (que llega tras pointerdown o keyup) no hace nada: ya se atendió arriba
  btn.addEventListener("click", (e) => e.preventDefault());
  stop.addEventListener("click", () => {
    stopShiftCheck();
    stop.hidden = true;
    lenSel.disabled = false;
    setBox(null, T().pvtStopped, true);
    btn.focus();
  });
}
