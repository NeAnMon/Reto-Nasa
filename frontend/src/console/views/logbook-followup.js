/*
 * AstroVital · Bitácora → "Seguimiento periódico" (antes en el Resumen de la consola)
 *
 * Panel plegable con los registros periódicos del tripulante seleccionado en la bitácora:
 * masa corporal, visión (SANS), medicación y polvo lunar (sin registros en la app),
 * el último check-in de ánimo (tarjeta MOOD_WELLNESS del resumen de salud) y los riesgos
 * médicos de la misión según el NASA Integrated Medical Model (iMED v5.0, 2015).
 *
 * Uso desde logbook.js: mountFollowup(host, summary) pinta el panel en `host` y enlaza
 * su botón de plegado. Los controles usan data-fu-act (no data-act: el contenedor tiene
 * un listener delegado de console.js que reacciona a ese atributo).
 *
 * Idiomas: textos en DICT (es / en), resueltos en cada pintado con tr(DICT).
 */
import { escapeHtml, num, badge } from "../console.js";
import { tr } from "../../i18n/i18n.js";
import { bt } from "/src/i18n/backend.js";

const esc = escapeHtml;

/* Probabilidad de al menos un evento (iMED v5.0); los nombres están en DICT.imm, mismo orden */
const IMM_TOP = [0.996, 0.992, 0.968, 0.968, 0.965, 0.923];

const DICT = {
  es: {
    aria: "Seguimiento periódico",
    title: "Seguimiento periódico",
    sub: "· masa, visión, medicación, polvo, riesgos de misión",
    bodyMass: "Masa corporal",
    vision: "Visión (SANS)",
    medication: "Medicación",
    noAppRecords: "Sin registros en la app",
    lunarDust: "Polvo lunar",
    moodCheckin: "Ánimo · check-in",
    moodPrivate: "· privado: solo tú y tu médico de vuelo",
    immTitle: "Riesgos médicos de la misión · NASA IMM",
    immSub: "Prob. de al menos un evento · estancia lunar de 12 meses, 50 EVA",
    immSource: "Fuente: NASA Integrated Medical Model (iMED v5.0, 2015). Estimación previa al vuelo, no diagnóstico.",
    imm: ["Parestesias", "Insomnio tardío", "Erupción cutánea", "Abrasión de piel", "Despegue de uñas", "Cuerpo extraño en el ojo"],
  },
  en: {
    aria: "Periodic monitoring",
    title: "Periodic monitoring",
    sub: "· mass, vision, medication, dust, mission risks",
    bodyMass: "Body mass",
    vision: "Vision (SANS)",
    medication: "Medication",
    noAppRecords: "No records in the app",
    lunarDust: "Lunar dust",
    moodCheckin: "Mood · check-in",
    moodPrivate: "· private: only you and your flight surgeon",
    immTitle: "Mission medical risks · NASA IMM",
    immSub: "Prob. of at least one event · 12-month lunar stay, 50 EVAs",
    immSource: "Source: NASA Integrated Medical Model (iMED v5.0, 2015). Pre-flight estimate, not a diagnosis.",
    imm: ["Paresthesias", "Late insomnia", "Skin rash", "Skin abrasion", "Fingernail delamination", "Foreign body in eye"],
  },
};

/* Plegado (como en el Resumen: cerrado al empezar; se conserva al volver a la pestaña) */
const st = { open: false };
const summaries = new WeakMap(); // host → resumen de salud con el que se pintó

function ensureCss() {
  if (document.getElementById("av-logfu-css")) return;
  const link = document.createElement("link");
  link.id = "av-logfu-css";
  link.rel = "stylesheet";
  link.href = new URL("./logbook-followup.css", import.meta.url).href;
  document.head.appendChild(link);
}

function followupHTML(summary) {
  const T = tr(DICT);
  const cards = (summary && summary.indicator_cards) || [];
  const mood = cards.find((c) => c.indicator_code === "MOOD_WELLNESS") || null;
  const missing = (label, first) =>
    `<div class="av-lbl"${first ? "" : ' style="margin-top:8px"'}>${esc(label)}</div><div>${badge("M")} <span class="av-sub">${esc(T.noAppRecords)}</span></div>`;
  return `
  <section class="av-panel av-logfu" aria-label="${esc(T.aria)}">
    <button type="button" data-fu-act="toggle" aria-expanded="${st.open}" aria-controls="av-logfu-body" class="av-sys-btn av-logfu-toggle">
      <span><span class="av-h2" style="font-size:16px">${esc(T.title)}</span> <span class="av-sub">${esc(T.sub)}</span></span>
      <span class="av-mono" aria-hidden="true">${st.open ? "−" : "+"}</span>
    </button>
    ${st.open ? `
    <div class="av-logfu-grid" id="av-logfu-body">
      <div class="av-logfu-cell">
        ${missing(T.bodyMass, true)}
        ${missing(T.vision)}
        ${missing(T.medication)}
      </div>
      <div class="av-logfu-cell">
        ${missing(T.lunarDust, true)}
        <div class="av-lbl" style="margin-top:8px">${esc(T.moodCheckin)}</div>
        <div>${mood ? `<span class="av-mono">${esc(bt(mood.display_value))}</span>/10` : "—"} <span class="av-sub">${esc(T.moodPrivate)}</span></div>
      </div>
      <div class="av-logfu-cell">
        <div class="av-lbl">${esc(T.immTitle)}</div>
        <div class="av-sub">${esc(T.immSub)}</div>
        <table class="av-logfu-imm">${IMM_TOP.map((p, i) => `<tr><td>${esc(T.imm[i])}</td><td class="av-mono">${num(p * 100, 1)} %</td></tr>`).join("")}</table>
        <div class="av-logfu-src">${esc(T.immSource)}</div>
      </div>
    </div>` : ""}
  </section>`;
}

/* Pinta el panel en `host` con el resumen de salud del tripulante seleccionado y enlaza el plegado */
export function mountFollowup(host, summary) {
  if (!host) return;
  ensureCss();
  summaries.set(host, summary);
  host.innerHTML = followupHTML(summary);
  if (host.dataset.fuBound) return;
  host.dataset.fuBound = "1";
  host.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-fu-act='toggle']");
    if (!btn || !host.contains(btn)) return;
    st.open = !st.open;
    host.innerHTML = followupHTML(summaries.get(host));
    const again = host.querySelector("[data-fu-act='toggle']");
    if (again) again.focus();
  });
}
