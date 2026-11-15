/* AstroVital · Consola · Bienestar → "Respiración" (respiración guiada en cuadrado, box breathing)
 *
 * Ciclo de cuatro fases iguales de 4 tiempos (1 tiempo = 1 s): inhala, mantén, exhala, mantén.
 * Una ronda dura 16 s; se eligen 4, 8 o 12 rondas (~1, 2 o 3 min). Cleveland Clinic sugiere 3–4 rondas.
 * Es una técnica general de relajación, no un protocolo NASA ni un tratamiento.
 *
 * - Animación: un punto recorre el contorno de un cuadrado (un lado por fase) y el cuadrado interior
 *   crece al inhalar y se encoge al exhalar. Con prefers-reduced-motion no hay movimiento: solo texto
 *   y el lado activo resaltado.
 * - El ritmo se calcula a partir del tiempo transcurrido (no se acumula deriva de temporizadores).
 * - Sesiones completadas: solo en este dispositivo (localStorage, por usuario). No hay endpoint de
 *   backend para registrarlas; si el almacenamiento no está disponible, el ejercicio funciona igual.
 * - Si la vista se vuelve a pintar (cambio de idioma o de pestaña interna y vuelta), el ejercicio en
 *   curso continúa; si la sección deja de estar en pantalla, se detiene solo.
 * Prefijo de clases av-br-; atributos data-br-* (nunca data-act / data-nav-*).
 */
import { tr, fmt as fmtT, locale } from "../../i18n/i18n.js";
import { esc } from "./more-common.js";

const DICT = {
  es: {
    title: "Respiración guiada en cuadrado",
    tagline: "4 tiempos para inhalar, 4 para mantener, 4 para exhalar y 4 para mantener",
    intro: "Cuatro pasos iguales de cuatro tiempos. Una ronda dura unos 16 segundos. Úsala para bajar el ritmo antes de dormir, después de una tarea exigente o cuando notes tensión.",
    phases: ["Inhala", "Mantén", "Exhala", "Mantén"],
    sideLabels: ["Inhala", "Mantén", "Exhala", "Mantén"],
    ready: "Preparado/a",
    readySub: "Elige cuántas rondas quieres y pulsa Empezar.",
    roundOf: "Ronda {n} de {total}",
    rounds: "Rondas",
    roundOpts: { 4: "4 rondas · 1 min aprox.", 8: "8 rondas · 2 min aprox.", 12: "12 rondas · 3 min aprox." },
    start: "Empezar",
    stop: "Detener",
    stopped: "Ejercicio detenido. Puedes retomarlo cuando quieras.",
    done: "Sesión completada: {n} rondas. Bien hecho.",
    sessions: "Sesiones completadas en este dispositivo",
    last: "Última",
    never: "Ninguna todavía",
    noStorage: "Este navegador no permite guardar el contador de sesiones; el ejercicio funciona igual.",
    figAria: "Cuadrado que recorre las cuatro fases del ciclo de respiración",
    howTitle: "Cómo hacerlo",
    how: [
      "Siéntate o sujétate en una postura cómoda y relaja los hombros.",
      "Inhala por la nariz mientras el punto sube por el lado izquierdo.",
      "Mantén el aire mientras recorre el lado superior, sin apretar.",
      "Exhala por la boca mientras baja por el lado derecho.",
      "Mantén con los pulmones vacíos en el lado inferior y vuelve a empezar.",
    ],
    safety: "Respira a tu ritmo y sin forzar. Si te mareas o te falta el aire, detente y respira con normalidad.",
    sourceNote: "Técnica general de relajación descrita por Cleveland Clinic, que sugiere de tres a cuatro rondas. Es una sugerencia del equipo para el tiempo de descanso que la NASA reserva a sus tripulaciones; no es un protocolo NASA ni un tratamiento.",
    sourceLink: "Cleveland Clinic · respiración en cuadrado",
  },
  en: {
    title: "Guided box breathing",
    tagline: "4 counts in, 4 counts hold, 4 counts out and 4 counts hold",
    intro: "Four equal steps of four counts each. One round takes about 16 seconds. Use it to slow down before sleep, after a demanding task or whenever you notice tension.",
    phases: ["Breathe in", "Hold", "Breathe out", "Hold"],
    sideLabels: ["In", "Hold", "Out", "Hold"],
    ready: "Ready",
    readySub: "Choose how many rounds you want and press Start.",
    roundOf: "Round {n} of {total}",
    rounds: "Rounds",
    roundOpts: { 4: "4 rounds · about 1 min", 8: "8 rounds · about 2 min", 12: "12 rounds · about 3 min" },
    start: "Start",
    stop: "Stop",
    stopped: "Exercise stopped. You can pick it up again whenever you like.",
    done: "Session complete: {n} rounds. Well done.",
    sessions: "Sessions completed on this device",
    last: "Last",
    never: "None yet",
    noStorage: "This browser can't store the session counter; the exercise still works.",
    figAria: "Square that traces the four phases of the breathing cycle",
    howTitle: "How to do it",
    how: [
      "Sit or anchor yourself in a comfortable position and relax your shoulders.",
      "Breathe in through your nose while the dot climbs the left side.",
      "Hold your breath while it crosses the top, without straining.",
      "Breathe out through your mouth while it goes down the right side.",
      "Hold with empty lungs along the bottom, then start again.",
    ],
    safety: "Breathe at your own pace and without straining. If you feel dizzy or short of breath, stop and breathe normally.",
    sourceNote: "General relaxation technique described by Cleveland Clinic, which suggests three to four rounds. It is a team suggestion for the relaxation time NASA schedules for its crews; it is not a NASA protocol and not a treatment.",
    sourceLink: "Cleveland Clinic · box breathing",
  },
};

const SOURCE_URL = "https://health.clevelandclinic.org/box-breathing-benefits";
const COUNT_MS = 1000;         // un tiempo = 1 s
const COUNTS = 4;              // tiempos por fase
const PHASE_MS = COUNT_MS * COUNTS;
const ROUND_MS = PHASE_MS * 4;
const ROUND_CHOICES = [4, 8, 12];
const DETACH_GRACE_MS = 1500;  // margen para que la vista se vuelva a pintar sin cortar el ejercicio
const STORE_PREFIX = "av_breath_v1_";

/* Esquinas del cuadrado (viewBox 0..240): el recorrido empieza abajo a la izquierda y sube */
const LO = 40;
const HI = 200;
const CORNERS = [[LO, HI], [LO, LO], [HI, LO], [HI, HI]];

const state = {
  running: false,
  startedAt: 0,
  rounds: 4,
  raf: 0,
  detachedSince: 0,
  lastPhaseKey: "",
  result: null,           // función → último mensaje en el idioma vigente
  userKey: "anon",
};

/* ───────── almacenamiento local de sesiones (opcional) ───────── */

function storeKey() {
  return STORE_PREFIX + state.userKey;
}
function readSessions() {
  try {
    const raw = localStorage.getItem(storeKey());
    if (!raw) return { ok: true, count: 0, last: null };
    const v = JSON.parse(raw);
    const count = Number.isInteger(v?.count) && v.count >= 0 ? v.count : 0;
    const last = typeof v?.last === "string" ? v.last : null;
    return { ok: true, count, last };
  } catch {
    return { ok: false, count: 0, last: null };
  }
}
function addSession(rounds) {
  const cur = readSessions();
  try {
    localStorage.setItem(storeKey(), JSON.stringify({ count: cur.count + 1, last: new Date().toISOString(), rounds }));
  } catch {
    /* almacenamiento no disponible: el contador no se guarda */
  }
}

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function fmtLast(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

/* ───────── render ───────── */

/* index.html ya enlaza la hoja (versionada); esto es el respaldo si se carga el módulo sin ella */
function ensureBreathCss() {
  if (document.getElementById("av-br-css")) return;
  const link = document.createElement("link");
  link.id = "av-br-css";
  link.rel = "stylesheet";
  link.href = new URL("./breathing.css", import.meta.url).href;
  document.head.appendChild(link);
}

function sessionsHTML(T) {
  const s = readSessions();
  if (!s.ok) return `<p class="av-sub av-br-sessions">${esc(T.noStorage)}</p>`;
  const last = s.last ? fmtLast(s.last) : "";
  return `<dl class="av-mx-kv av-br-sessions">
      <dt>${esc(T.sessions)}</dt><dd>${esc(s.count)}</dd>
      <dt>${esc(T.last)}</dt><dd>${esc(last || T.never)}</dd>
    </dl>`;
}

function figureSVG(T) {
  const sides = CORNERS.map((a, i) => {
    const b = CORNERS[(i + 1) % 4];
    return `<line class="av-br-side" data-br-side="${i}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" />`;
  }).join("");
  const L = T.sideLabels;
  return `<svg class="av-br-svg" viewBox="0 0 240 240" role="img" aria-label="${esc(T.figAria)}" focusable="false">
      <rect class="av-br-track" x="${LO}" y="${LO}" width="${HI - LO}" height="${HI - LO}" />
      <rect class="av-br-lung" data-br-lung x="${LO}" y="${LO}" width="${HI - LO}" height="${HI - LO}" />
      ${sides}
      <text class="av-br-lbl" x="22" y="120" text-anchor="middle" transform="rotate(-90 22 120)">${esc(L[0])}</text>
      <text class="av-br-lbl" x="120" y="28" text-anchor="middle">${esc(L[1])}</text>
      <text class="av-br-lbl" x="218" y="120" text-anchor="middle" transform="rotate(90 218 120)">${esc(L[2])}</text>
      <text class="av-br-lbl" x="120" y="224" text-anchor="middle">${esc(L[3])}</text>
      <text class="av-br-count av-mono" data-br-count x="120" y="134" text-anchor="middle" aria-hidden="true">–</text>
      <circle class="av-br-dot" data-br-dot cx="${LO}" cy="${HI}" r="9" />
    </svg>`;
}

/**
 * Pinta la sección de respiración guiada dentro de `panel` (Bienestar → Respiración).
 * El elemento raíz lleva data-wb-sub="breath" para encajar en las pestañas internas de wellbeing.js.
 */
export function renderBreathing(panel, appState) {
  ensureBreathCss();
  const T = tr(DICT);
  state.userKey = String(appState?.currentUser?.id ?? appState?.selectedAstronautId ?? "anon");
  const opts = ROUND_CHOICES.map(
    (n) => `<option value="${n}" ${n === state.rounds ? "selected" : ""}>${esc(T.roundOpts[n])}</option>`
  ).join("");

  panel.innerHTML = `<div class="av-wb-cols av-br-root" data-wb-sub="breath" data-br-root>
      <div class="av-wb-col av-br-main">
        <section class="av-panel" aria-labelledby="av-br-h">
          <div class="av-panel-head">
            <h3 class="av-h3" id="av-br-h">${esc(T.title)}</h3>
            <span class="av-sub">${esc(T.tagline)}</span>
          </div>
          <div class="av-mx-pad">
            <p class="av-mx-p av-sub">${esc(T.intro)}</p>
            <div class="av-br-stage">
              <div class="av-br-fig">${figureSVG(T)}</div>
              <div class="av-br-info">
                <p class="av-br-phase" data-br-phase aria-live="polite">${esc(T.ready)}</p>
                <p class="av-sub av-br-round" data-br-round>${esc(T.readySub)}</p>
                <div class="av-br-progress" aria-hidden="true"><span data-br-bar></span></div>
                <div class="av-br-controls">
                  <div class="av-field av-br-select">
                    <label for="av-br-rounds">${esc(T.rounds)}</label>
                    <select class="av-input" id="av-br-rounds" data-br-rounds>${opts}</select>
                  </div>
                  <button type="button" class="av-btn av-btn-primary av-br-btn" data-br-toggle aria-pressed="false">${esc(T.start)}</button>
                </div>
                <p class="av-sub av-br-status" role="status" data-br-status>${state.result ? esc(state.result()) : ""}</p>
              </div>
            </div>
            <p class="av-mx-note av-br-safety">${esc(T.safety)}</p>
          </div>
        </section>
      </div>
      <div class="av-wb-col av-br-side-col">
        <section class="av-panel" aria-labelledby="av-br-how-h">
          <div class="av-panel-head"><h3 class="av-h3" id="av-br-how-h">${esc(T.howTitle)}</h3></div>
          <div class="av-mx-pad">
            <ol class="av-br-steps">${T.how.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
            <div data-br-sessions>${sessionsHTML(T)}</div>
            <p class="av-mx-p av-sub">${esc(T.sourceNote)}</p>
            <a class="av-wb-src" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">${esc(T.sourceLink)}</a>
          </div>
        </section>
      </div>
    </div>`;

  const root = panel.querySelector("[data-br-root]");
  root.querySelector("[data-br-toggle]").addEventListener("click", () => {
    if (state.running) stop(tr(DICT).stopped);
    else start(root);
  });
  root.querySelector("[data-br-rounds]").addEventListener("change", (e) => {
    const n = Number(e.target.value);
    if (ROUND_CHOICES.includes(n)) state.rounds = n;
  });

  if (state.running) {
    // repintado con el ejercicio en curso: se sigue desde donde iba
    state.detachedSince = 0;
    state.lastPhaseKey = "";
    syncControls(root, true);
    if (!state.raf) state.raf = requestAnimationFrame(tick);
  } else {
    paintIdle(root);
  }
}

/* ───────── ciclo ───────── */

function currentRoot() {
  return document.querySelector("[data-br-root]");
}

function syncControls(root, running) {
  const T = tr(DICT);
  const btn = root.querySelector("[data-br-toggle]");
  btn.textContent = running ? T.stop : T.start;
  btn.setAttribute("aria-pressed", String(running));
  btn.classList.toggle("av-btn-primary", !running);
  root.querySelector("[data-br-rounds]").disabled = running;
  root.classList.toggle("av-br-on", running);
}

function start(root) {
  state.running = true;
  state.startedAt = performance.now();
  state.detachedSince = 0;
  state.lastPhaseKey = "";
  state.result = null;
  root.querySelector("[data-br-status]").textContent = "";
  syncControls(root, true);
  cancelAnimationFrame(state.raf);
  state.raf = requestAnimationFrame(tick);
}

function stop(message, completed = false) {
  state.running = false;
  cancelAnimationFrame(state.raf);
  state.raf = 0;
  if (completed) addSession(state.rounds);
  state.result = message ? () => message : null;
  const root = currentRoot();
  if (!root) return;
  syncControls(root, false);
  paintIdle(root);
  if (completed) {
    const rounds = state.rounds;
    state.result = () => fmtT(tr(DICT).done, { n: rounds });
  }
  root.querySelector("[data-br-status]").textContent = state.result ? state.result() : "";
  const box = root.querySelector("[data-br-sessions]");
  if (box) box.innerHTML = sessionsHTML(tr(DICT));
}

function paintIdle(root) {
  const T = tr(DICT);
  root.querySelector("[data-br-phase]").textContent = T.ready;
  root.querySelector("[data-br-round]").textContent = T.readySub;
  root.querySelector("[data-br-count]").textContent = "–";
  root.querySelector("[data-br-bar]").style.width = "0%";
  root.querySelectorAll("[data-br-side]").forEach((s) => s.classList.remove("av-br-active"));
  const dot = root.querySelector("[data-br-dot]");
  dot.setAttribute("cx", CORNERS[0][0]);
  dot.setAttribute("cy", CORNERS[0][1]);
  setLung(root, 0);
}

/* Cuadrado interior: 0 = pulmones vacíos (pequeño), 1 = llenos (todo el cuadrado) */
function setLung(root, fill) {
  const lung = root.querySelector("[data-br-lung]");
  if (!lung) return;
  const min = 0.35;
  const k = min + (1 - min) * fill;
  const size = (HI - LO) * k;
  const off = (240 - size) / 2;
  lung.setAttribute("x", off.toFixed(2));
  lung.setAttribute("y", off.toFixed(2));
  lung.setAttribute("width", size.toFixed(2));
  lung.setAttribute("height", size.toFixed(2));
}

function tick(now) {
  state.raf = 0;
  if (!state.running) return;
  const root = currentRoot();
  if (!root) {
    // la vista se está repintando o ya no está en pantalla
    if (!state.detachedSince) state.detachedSince = now;
    if (now - state.detachedSince > DETACH_GRACE_MS) {
      state.running = false;
      state.detachedSince = 0;
      return;
    }
    state.raf = requestAnimationFrame(tick);
    return;
  }
  state.detachedSince = 0;

  const total = state.rounds * ROUND_MS;
  const elapsed = Math.max(0, now - state.startedAt);
  if (elapsed >= total) {
    stop(null, true);
    return;
  }
  const T = tr(DICT);
  const round = Math.floor(elapsed / ROUND_MS);
  const inRound = elapsed - round * ROUND_MS;
  const phase = Math.floor(inRound / PHASE_MS);
  const inPhase = inRound - phase * PHASE_MS;
  const count = COUNTS - Math.floor(inPhase / COUNT_MS);
  const reduce = reducedMotion();
  const frac = inPhase / PHASE_MS;

  const key = `${round}:${phase}`;
  if (key !== state.lastPhaseKey) {
    state.lastPhaseKey = key;
    root.querySelector("[data-br-phase]").textContent = T.phases[phase];
    root.querySelector("[data-br-round]").textContent = fmtT(T.roundOf, { n: round + 1, total: state.rounds });
    root.querySelectorAll("[data-br-side]").forEach((s) =>
      s.classList.toggle("av-br-active", Number(s.getAttribute("data-br-side")) === phase)
    );
  }
  root.querySelector("[data-br-count]").textContent = String(count);
  root.querySelector("[data-br-bar]").style.width = `${((elapsed / total) * 100).toFixed(2)}%`;

  const a = CORNERS[phase];
  const b = CORNERS[(phase + 1) % 4];
  const dot = root.querySelector("[data-br-dot]");
  if (reduce) {
    // movimiento reducido: sin desplazamientos continuos; el punto marca la esquina de la fase
    dot.setAttribute("cx", a[0]);
    dot.setAttribute("cy", a[1]);
    setLung(root, phase === 1 || phase === 2 ? 1 : 0);
  } else {
    dot.setAttribute("cx", (a[0] + (b[0] - a[0]) * frac).toFixed(2));
    dot.setAttribute("cy", (a[1] + (b[1] - a[1]) * frac).toFixed(2));
    const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2;
    const fill = phase === 0 ? ease(frac) : phase === 1 ? 1 : phase === 2 ? 1 - ease(frac) : 0;
    setLung(root, fill);
  }
  state.raf = requestAnimationFrame(tick);
}
