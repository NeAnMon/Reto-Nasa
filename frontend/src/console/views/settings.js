/* AstroVital · Consola · vista "Ajustes y ayuda" (sustituye a Settings & Help)
 *
 * - Idioma de la interfaz (es / en) y tema visual (consola oscura, alto contraste, día) guardado en el perfil.
 * - Preferencia de privacidad: compartir o no la señal operativa de bienestar con el líder.
 * - Guía de demostración: recorrido por las secciones actuales de la consola.
 */
import { apiService } from "../../services/api.js";
import { tr, fmt as fmtT, initLangSelectors } from "../../i18n/i18n.js";
import { esc, tag, errMsg, ensureCss, roleOf } from "./more-common.js";

const DICT = {
  es: {
    title: "Ajustes y ayuda",
    version: "AstroVital v1.0",
    langTitle: "Idioma",
    langLabel: "Idioma de la interfaz",
    langSub: "Los textos del sistema se muestran en el idioma elegido; lo que escriben las personas (mensajes, notas) se muestra tal como fue registrado.",
    themeTitle: "Tema visual y accesibilidad",
    themeSub: "Los estados llevan siempre letra o texto además del color.",
    themes: { "space-dark": "Consola oscura (predeterminado)", "high-contrast": "Alto contraste", "daylight-clean": "Claro de día" },
    themeChanged: "Tema cambiado a: {name}.",
    themeLocal: "Tema aplicado en este equipo ({name}); no se pudo guardar en el perfil.",
    privacyTitle: "Privacidad",
    privacyFor: "Preferencias de {name}",
    share: "Compartir con el líder en tierra las señales operativas de seguimiento de bienestar (nunca mis respuestas ni mi texto privado).",
    save: "Guardar preferencias",
    saved: "Preferencias de privacidad actualizadas.",
    saveError: "No se pudieron guardar las preferencias: {msg}",
    guideTitle: "Guía de demostración",
    guideSub: "10 escenas · unos 5 minutos",
    colScene: "Escena",
    colWhat: "Qué mostrar",
    colGo: "Ir",
    open: "Abrir",
    needsRole: "Requiere iniciar sesión como {role}",
    roleLeader: "líder en tierra",
    roleAdmin: "administración",
    scenes: [
      { n: 1, name: "Inicio de misión", what: "Resumen: barra de estado, fase, entorno y alarmas de la misión.", sec: "mission-control", go: "Resumen" },
      { n: 2, name: "Mapa corporal", what: "En el Resumen, seleccionar una zona del mapa corporal (p. ej. CARDIO) y abrir sus indicadores.", sec: "mission-control", go: "Resumen" },
      { n: 3, name: "Medición", what: "Registrar una medición sintética y comprobar validación y persistencia.", sec: "my-health-check", go: "Registrar medición" },
      { n: 4, name: "Alerta y prevención", what: "Revisar una alerta, su regla y reconocerla o darle seguimiento.", sec: "alerts-center", go: "Alertas" },
      { n: 5, name: "Contramedidas", what: "Completar una contramedida de autocuidado y revisar constancia e insignias.", sec: "daily-missions", go: "Contramedidas" },
      { n: 6, name: "Bienestar", what: "Completar la autoevaluación de bienestar y probar la respiración guiada.", sec: "wellness-center", go: "Bienestar psicológico" },
      { n: 7, name: "Tendencias", what: "Desde el Resumen, abrir un indicador y revisar su tendencia de misión con línea base y límites.", sec: "mission-control", go: "Resumen" },
      { n: 8, name: "Supervisión en tierra", what: "Como líder (leader@astrovital.demo), revisar la tripulación asignada.", sec: "crew-monitoring", go: "Monitoreo de tripulación", role: "leader" },
      { n: 9, name: "Administración", what: "Como administración (admin@astrovital.demo), crear una cuenta y revisar la auditoría.", sec: "administration", go: "Administración", role: "admin" },
      { n: 10, name: "Bitácora e informes", what: "Revisar el seguimiento periódico (riesgos NASA IMM), exportar un informe auditado (PDF, CSV o JSON) y mostrar la trazabilidad de fuentes.", sec: "reports", go: "Bitácora" },
    ],
  },
  en: {
    title: "Settings and help",
    version: "AstroVital v1.0",
    langTitle: "Language",
    langLabel: "Interface language",
    langSub: "System texts are shown in the selected language; what people write (messages, notes) is shown as it was recorded.",
    themeTitle: "Visual theme and accessibility",
    themeSub: "Statuses always include a letter or text in addition to color.",
    themes: { "space-dark": "Dark console (default)", "high-contrast": "High contrast", "daylight-clean": "Daylight" },
    themeChanged: "Theme changed to: {name}.",
    themeLocal: "Theme applied on this device ({name}); it couldn't be saved to your profile.",
    privacyTitle: "Privacy",
    privacyFor: "Preferences for {name}",
    share: "Share operational wellbeing follow-up signals with the ground leader (never my answers or my private text).",
    save: "Save preferences",
    saved: "Privacy preferences updated.",
    saveError: "Couldn't save preferences: {msg}",
    guideTitle: "Demo guide",
    guideSub: "10 scenes · about 5 minutes",
    colScene: "Scene",
    colWhat: "What to show",
    colGo: "Go",
    open: "Open",
    needsRole: "Requires signing in as {role}",
    roleLeader: "ground leader",
    roleAdmin: "administration",
    scenes: [
      { n: 1, name: "Mission start", what: "Overview: status bar, phase, environment and mission alarms.", sec: "mission-control", go: "Overview" },
      { n: 2, name: "Body map", what: "In the Overview, select a body map zone (e.g. CARDIO) and open its indicators.", sec: "mission-control", go: "Overview" },
      { n: 3, name: "Measurement", what: "Log a synthetic measurement and check validation and persistence.", sec: "my-health-check", go: "Log measurement" },
      { n: 4, name: "Alert and prevention", what: "Review an alert and its rule, then acknowledge it or follow it up.", sec: "alerts-center", go: "Alerts" },
      { n: 5, name: "Countermeasures", what: "Complete a self-care countermeasure and review consistency and badges.", sec: "daily-missions", go: "Countermeasures" },
      { n: 6, name: "Wellbeing", what: "Complete the wellbeing self-assessment and try the guided breathing.", sec: "wellness-center", go: "Psychological wellbeing" },
      { n: 7, name: "Trends", what: "From the Overview, open an indicator and review its mission trend with baseline and limits.", sec: "mission-control", go: "Overview" },
      { n: 8, name: "Ground supervision", what: "As leader (leader@astrovital.demo), review the assigned crew.", sec: "crew-monitoring", go: "Crew monitoring", role: "leader" },
      { n: 9, name: "Administration", what: "As administration (admin@astrovital.demo), create an account and review the audit trail.", sec: "administration", go: "Administration", role: "admin" },
      { n: 10, name: "Logbook and reports", what: "Review periodic monitoring (NASA IMM risks), export an audited report (PDF, CSV or JSON) and show source traceability.", sec: "reports", go: "Logbook" },
    ],
  },
};

export async function renderSettingsView(container, appState, helpers) {
  ensureCss();
  const T = tr(DICT);
  const u = appState.currentUser || {};
  const role = roleOf(appState);
  const theme = () => document.body.getAttribute("data-theme") || "space-dark";
  const allowed = (scene) => (scene.role === "admin" ? role === "ADMINISTRATOR" : scene.role === "leader" ? role !== "ASTRONAUT" : true);
  // re-render por cambio de idioma: conservar la casilla de privacidad aún sin guardar
  const prevShare = container.querySelector(".av-set-root #av-set-share");
  const shareChecked = prevShare ? prevShare.checked : !!u.share_wellness_signals_with_leader;

  container.innerHTML = `
    <div class="av-console av-mx-root av-set-root"><div class="av-grid">
      <div class="av-col-b">
        <section class="av-panel" aria-labelledby="av-set-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-set-h">${T.title}</h2>${tag(T.version)}</div>
          <div class="av-panel-head"><h3 class="av-h3">${T.guideTitle}</h3><span class="av-sub">${T.guideSub}</span></div>
          <div class="av-hscroll"><table class="av-table av-mx-table">
            <thead><tr><th scope="col">${T.colScene}</th><th scope="col">${T.colWhat}</th><th scope="col">${T.colGo}</th></tr></thead>
            <tbody>${T.scenes
              .map(
                (s) => `<tr>
                  <td><span class="av-mono av-sub">${s.n}</span> <strong>${esc(s.name)}</strong></td>
                  <td>${esc(s.what)}</td>
                  <td class="av-mx-nowrap">${
                    allowed(s)
                      ? `<button type="button" class="av-btn av-btn-sm" data-st-go="${s.sec}" aria-label="${esc(T.open)} ${esc(s.go)}">${esc(s.go)}</button>`
                      : `<span class="av-sub">${esc(fmtT(T.needsRole, { role: s.role === "admin" ? T.roleAdmin : T.roleLeader }))}</span>`
                  }</td>
                </tr>`
              )
              .join("")}</tbody></table></div>
        </section>
      </div>
      <aside class="av-mx-side">
        <section class="av-panel" aria-labelledby="av-set-lang-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-set-lang-h">${T.langTitle}</h2></div>
          <div class="av-mx-pad">
            <div class="av-field">
              <label for="av-set-lang">${T.langLabel}</label>
              <select class="av-input" id="av-set-lang" data-av-lang></select>
            </div>
            <span class="av-sub">${T.langSub}</span>
          </div>
        </section>
        <section class="av-panel" aria-labelledby="av-set-theme-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-set-theme-h">${T.themeTitle}</h2></div>
          <div class="av-mx-pad">
            <span class="av-sub">${T.themeSub}</span>
            <div class="av-set-themes" role="group" aria-labelledby="av-set-theme-h">
              ${Object.entries(T.themes).map(([code, name]) => `<button type="button" class="av-btn" data-st-theme="${code}" aria-pressed="${code === theme()}">${esc(name)}</button>`).join("")}
            </div>
          </div>
        </section>
        <section class="av-panel" aria-labelledby="av-set-priv-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-set-priv-h">${T.privacyTitle}</h2><span class="av-sub">${esc(fmtT(T.privacyFor, { name: u.full_name || "" }))}</span></div>
          <div class="av-mx-pad">
            <label class="av-mx-check"><input type="checkbox" id="av-set-share" ${shareChecked ? "checked" : ""} /> <span>${T.share}</span></label>
            <div><button type="button" class="av-btn av-btn-primary" id="av-set-save">${T.save}</button></div>
          </div>
        </section>
        <p class="av-mx-status" id="av-set-status" role="status" aria-live="polite"></p>
      </aside>
    </div></div>`;

  const root = container.querySelector(".av-set-root");
  const status = root.querySelector("#av-set-status");
  const say = (text) => {
    status.textContent = text;
    helpers.showToast?.(text);
  };

  // selector de idioma: setLang() emite "av:lang-change" y app.js vuelve a pintar esta vista
  initLangSelectors(root);

  root.querySelectorAll("[data-st-theme]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-st-theme");
      document.body.setAttribute("data-theme", code);
      root.querySelectorAll("[data-st-theme]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      // botón "Contraste" del encabezado
      document.getElementById("btn-quick-theme")?.setAttribute("aria-pressed", String(code === "high-contrast"));
      try {
        await apiService.updateUserProfile(u.id, { preferred_theme: code });
        if (appState.currentUser) appState.currentUser.preferred_theme = code;
        say(fmtT(tr(DICT).themeChanged, { name: tr(DICT).themes[code] }));
      } catch {
        say(fmtT(tr(DICT).themeLocal, { name: tr(DICT).themes[code] }));
      }
    });
  });

  root.querySelector("#av-set-save").addEventListener("click", async (e) => {
    const share = root.querySelector("#av-set-share").checked;
    e.currentTarget.disabled = true;
    try {
      await apiService.updateUserProfile(u.id, { share_wellness_signals_with_leader: share });
      if (appState.currentUser) appState.currentUser.share_wellness_signals_with_leader = share;
      say(tr(DICT).saved);
    } catch (err) {
      say(fmtT(tr(DICT).saveError, { msg: errMsg(err) }));
    }
    root.querySelector("#av-set-save").disabled = false;
  });

  root.querySelectorAll("[data-st-go]").forEach((btn) => {
    btn.addEventListener("click", () => helpers.navigateToSection?.(btn.getAttribute("data-st-go")));
  });
}
