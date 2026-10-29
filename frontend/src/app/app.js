import { apiService } from "../services/api.js";

const STATE_ICONS = {
  NORMAL: "● NORMAL",
  MONITOR: "▲ SEGUIMIENTO",
  WARNING: "◆ ALERTA",
  CRITICAL: "✖ CRÍTICO",
  UNKNOWN: "○ SIN DATOS",
  STALE: "⌛ VENCIDO",
  INVALID: "⊘ INVÁLIDO",
  WELLNESS_STABLE: "● ESTABLE",
  WELLNESS_MONITORING: "▲ OBSERVACIÓN",
  SUPPORT_RECOMMENDED: "◆ APOYO RECOMENDADO",
  PROFESSIONAL_REVIEW: "◆ REVISIÓN PROFESIONAL",
  URGENT_SUPPORT: "✖ APOYO URGENTE",
  ASSESSMENT_INCOMPLETE: "○ BORRADOR",
};

const appState = {
  currentUser: null,
  currentSection: "mission-control",
  selectedAstronautId: null,
  selectedMissionId: null,
  healthSummary: null,
  indicatorsCatalog: [],
  bodyRegions: [],
  selectedBodyRegionCode: "HEART_CARDIO",
  envProfiles: [],
  simulatorScenarios: [],
  usersList: [],
  missionsList: [],
  charts: {},
  breathingInterval: null,
};

function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "toast";
  div.setAttribute("role", "status");
  div.textContent = message;
  container.appendChild(div);
  setTimeout(() => div.remove(), 4800);
}

function formatDateUTC(isoStr) {
  if (!isoStr) return "Sin datos";
  try {
    const d = new Date(isoStr);
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return isoStr;
  }
}

function renderStateBadge(stateCode) {
  const label = STATE_ICONS[stateCode] || stateCode || "SIN DATOS";
  return `<span class="state-badge state-${stateCode || "UNKNOWN"}">${label}</span>`;
}

function destroyChart(key) {
  if (appState.charts[key]) {
    appState.charts[key].destroy();
    delete appState.charts[key];
  }
}

/* =========================================================================
   AUTHENTICATION & INITIALIZATION
   ========================================================================= */

async function initApp() {
  bindStaticEvents();
  window.addEventListener("astrovital:unauthorized", () => {
    appState.currentUser = null;
    toggleAuthScreen(true);
  });

  const token = apiService.getToken();
  if (!token) {
    toggleAuthScreen(true);
    return;
  }
  try {
    const me = await apiService.getMe();
    await onAuthenticated(me.user);
  } catch {
    toggleAuthScreen(true);
  }
}

function toggleAuthScreen(showLogin) {
  const authScreen = document.getElementById("auth-screen");
  const appShell = document.getElementById("app-shell");
  if (showLogin) {
    authScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
  } else {
    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
  }
}

async function onAuthenticated(user) {
  appState.currentUser = user;
  document.body.setAttribute("data-theme", user.preferred_theme || "space-dark");
  toggleAuthScreen(false);

  const [indRes, envRes, simRes, usersRes, missionsRes] = await Promise.all([
    apiService.getHealthIndicators(),
    apiService.getEnvironmentProfiles(),
    apiService.getSimulatorScenarios(),
    apiService.getUsers(),
    apiService.getMissions(),
  ]);

  appState.indicatorsCatalog = indRes.indicators || [];
  appState.envProfiles = envRes.profiles || [];
  appState.simulatorScenarios = simRes.scenarios || [];
  appState.usersList = usersRes.users || [];
  appState.missionsList = missionsRes.missions || [];

  const astronauts = appState.usersList.filter((u) => u.role_code === "ASTRONAUT");
  if (user.role_code === "ASTRONAUT") {
    appState.selectedAstronautId = user.id;
  } else if (astronauts.length > 0) {
    appState.selectedAstronautId = astronauts[0].id;
  }

  if (appState.missionsList.length > 0) {
    appState.selectedMissionId = appState.missionsList[0].id;
  }

  updateRoleNavigation();
  await refreshGlobalHeaderAndSummary();
  await navigateToSection(appState.currentSection);
}

function updateRoleNavigation() {
  const role = appState.currentUser?.role_code || "ASTRONAUT";
  document.querySelectorAll("[data-nav-section]").forEach((btn) => {
    const sec = btn.getAttribute("data-nav-section");
    if (sec === "administration" && role !== "ADMINISTRATOR") {
      btn.classList.add("hidden");
    } else if (sec === "crew-monitoring" && role === "ASTRONAUT") {
      btn.classList.add("hidden");
    } else {
      btn.classList.remove("hidden");
    }
  });

  const crewSelectorWrap = document.getElementById("topbar-crew-selector-wrap");
  const crewSelect = document.getElementById("topbar-crew-select");
  if (role === "ASTRONAUT") {
    crewSelectorWrap.classList.add("hidden");
  } else {
    crewSelectorWrap.classList.remove("hidden");
    const astronauts = appState.usersList.filter((u) => u.role_code === "ASTRONAUT");
    crewSelect.innerHTML = astronauts
      .map(
        (a) =>
          `<option value="${a.id}" ${a.id === Number(appState.selectedAstronautId) ? "selected" : ""}>${a.full_name} (${a.crew_code})</option>`
      )
      .join("");
  }
}

async function refreshGlobalHeaderAndSummary() {
  if (!appState.selectedAstronautId) return;
  const summary = await apiService.getHealthSummary(
    appState.selectedAstronautId,
    appState.selectedMissionId
  );
  appState.healthSummary = summary;

  // Populate topbar header
  document.getElementById("hdr-mission-name").textContent =
    `${summary.mission.code} — ${summary.mission.name}`;
  document.getElementById("hdr-user-badge").textContent =
    `${appState.currentUser.full_name} [${appState.currentUser.role_code}]`;
  document.getElementById("hdr-system-clock").textContent = formatDateUTC(summary.system_time_utc);
  document.getElementById("hdr-mission-elapsed").textContent =
    summary.mission.elapsed_days !== null
      ? `Día ${summary.mission.elapsed_days} / ${summary.mission.planned_duration_days || "?"} d`
      : "Sin datos";
  document.getElementById("hdr-phase").textContent = summary.mission.current_phase || "Sin datos";
  document.getElementById("hdr-environment").textContent =
    `${summary.context.environment_name} (${summary.context.determination_source})`;

  const queueLen = apiService.getOfflineQueue().length;
  const connText = apiService.simulatedOfflineMode
    ? `MODO OFFLINE (${queueLen} pendientes)`
    : `${summary.context.connectivity_status} | Cobertura ${summary.mission_summary.data_quality_coverage_percent}%`;
  document.getElementById("hdr-connectivity").textContent = connText;

  // Alert badge count
  const alertCount = summary.mission_summary.active_alerts_count;
  document.querySelectorAll(".js-alert-badge").forEach((el) => {
    el.textContent = alertCount;
    el.classList.toggle("hidden", alertCount === 0);
  });
}

async function navigateToSection(sectionId) {
  appState.currentSection = sectionId;
  document.querySelectorAll("[data-nav-section]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-nav-section") === sectionId);
  });

  const container = document.getElementById("section-view-container");
  container.innerHTML = `<div class="panel-card"><p>Cargando módulo <strong>${sectionId}</strong>...</p></div>`;

  try {
    if (sectionId === "mission-control") {
      await renderMissionControl(container);
    } else if (sectionId === "my-health-check") {
      await renderMyHealthCheck(container);
    } else if (sectionId === "body-explorer") {
      await renderBodyExplorer(container);
    } else if (sectionId === "wellness-center") {
      await renderWellnessCenter(container);
    } else if (sectionId === "daily-missions") {
      await renderDailyMissions(container);
    } else if (sectionId === "mission-analytics") {
      await renderMissionAnalytics(container);
    } else if (sectionId === "alerts-center") {
      await renderAlertsCenter(container);
    } else if (sectionId === "crew-monitoring") {
      await renderCrewMonitoring(container);
    } else if (sectionId === "reports") {
      await renderReportsSection(container);
    } else if (sectionId === "administration") {
      await renderAdministrationSection(container);
    } else if (sectionId === "settings-help") {
      await renderSettingsAndHelp(container);
    }
  } catch (err) {
    container.innerHTML = `
      <div class="panel-card">
        <h3 style="color:var(--state-critical);">Error al cargar la sección</h3>
        <p>${err.message}</p>
      </div>`;
  }
}

/* =========================================================================
   SECTION 1: MISSION CONTROL DASHBOARD
   ========================================================================= */

async function renderMissionControl(container) {
  await refreshGlobalHeaderAndSummary();
  const s = appState.healthSummary;
  const ms = s.mission_summary;
  const ctx = s.context;

  const scenarioOptions = appState.simulatorScenarios
    .map((sc) => `<option value="${sc.code}">${sc.title}</option>`)
    .join("");

  const envOptions = appState.envProfiles
    .map(
      (ep) =>
        `<option value="${ep.code}" ${ep.code === ctx.environment_code ? "selected" : ""}>${ep.name} (${ep.gravity_label})</option>`
    )
    .join("");

  container.innerHTML = `
    <div class="principle-banner">
      <div>
        <strong>Principio Central de AstroVital:</strong> Plataforma de observación, comprensión, registro preventivo y comunicación con Tierra.
        No realiza diagnósticos médicos autónomos ni reemplaza a los profesionales sanitarios.
      </div>
      <span class="sim-tag">MODO DEMO — DATOS SINTÉTICOS (SIMULADO)</span>
    </div>

    <!-- Simulator & Context Control Strip -->
    <div class="panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Simulador de Telemetría & Motor de Contexto Ambiental (Modo Demostración)</h2>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button class="btn btn-sm" id="btn-toggle-offline">
            ${apiService.simulatedOfflineMode ? "📡 Reconectar Enlace y Sincronizar Cola" : "🔌 Simular Corte de Conectividad"}
          </button>
          <button class="btn btn-sm btn-danger" id="btn-reset-demo">↺ Reiniciar Escenario Sintético DEMO</button>
        </div>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:1rem;">
        <div>
          <label style="font-size:0.8rem; color:var(--text-secondary); display:block; margin-bottom:0.3rem;">
            Ejecutar Escenario Reproducible (9 escenarios):
          </label>
          <div style="display:flex; gap:0.5rem;">
            <select id="sim-scenario-select" class="form-control" style="flex:1;">${scenarioOptions}</select>
            <button class="btn btn-primary" id="btn-run-scenario">Ejecutar</button>
          </div>
        </div>
        <div>
          <label style="font-size:0.8rem; color:var(--text-secondary); display:block; margin-bottom:0.3rem;">
            ContextResolver — Cambiar Entorno / Fase (No modifica umbrales clínicos):
          </label>
          <div style="display:flex; gap:0.5rem;">
            <select id="ctx-env-select" class="form-control" style="flex:1;">${envOptions}</select>
            <button class="btn" id="btn-apply-context">Actualizar Entorno</button>
          </div>
        </div>
      </div>
      <div style="margin-top:0.75rem; font-size:0.8rem; color:var(--text-secondary);">
        <strong>Riesgos del entorno activo (${ctx.environment_name}):</strong> ${ctx.key_physiological_risks || "Sin confirmar"}
        | <strong>Enfoque preventivo:</strong> ${ctx.preventive_focus || "Confirmar entorno"}
      </div>
    </div>

    <!-- Mission Summary KPIs -->
    <div class="summary-kpis">
      <div class="kpi-card">
        <span class="kpi-value" style="color:var(--state-normal);">${ms.indicators_normal}</span>
        <span class="kpi-label">Indicadores en Rango Configurado (NORMAL)</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-value" style="color:var(--state-monitor);">${ms.indicators_monitoring}</span>
        <span class="kpi-label">Requieren Observación (MONITOR)</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-value" style="color:var(--state-critical);">${ms.active_alerts_count}</span>
        <span class="kpi-label">Alertas Operativas Activas</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-value" style="color:var(--text-secondary);">${ms.pending_or_missing_measurements}</span>
        <span class="kpi-label">Mediciones Pendientes / Vencidas</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-value" style="color:var(--accent-cyan);">${ms.routines_completed_today}/${ms.routines_total_available}</span>
        <span class="kpi-label">Índice de Participación Hoy (No clínico)</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-value">${ms.data_quality_coverage_percent}%</span>
        <span class="kpi-label">Cobertura y Calidad Global de Datos</span>
      </div>
    </div>

    <!-- Dynamic Health Indicator Cards -->
    <div class="panel-header">
      <h2 class="panel-title">Indicadores Fisiológicos y de Bienestar (${s.astronaut.full_name})</h2>
      <span style="font-size:0.8rem; color:var(--text-secondary);">${ms.non_clinical_index_notice}</span>
    </div>
    <div class="indicators-grid">
      ${s.indicator_cards.map((c) => renderIndicatorCardHTML(c)).join("")}
    </div>

    <!-- Environmental Telemetry -->
    <div class="panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Telemetría Ambiental y Soporte Vital (ECLSS / Hábitat / Traje)</h2>
        <span class="sim-tag">SIMULADO</span>
      </div>
      <div class="data-table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Parámetro Ambiental</th>
              <th>Valor / Estado</th>
              <th>Unidad</th>
              <th>Disponibilidad</th>
              <th>Estado Operativo</th>
              <th>Fuente y Calidad</th>
              <th>Fecha (UTC)</th>
            </tr>
          </thead>
          <tbody>
            ${s.environmental_telemetry
              .map(
                (em) => `
              <tr>
                <td><strong>${em.parameter_name}</strong></td>
                <td>${em.value !== null ? em.value : ""} ${em.text_state ? `<span style="color:var(--text-secondary);">(${em.text_state})</span>` : ""}</td>
                <td>${em.unit}</td>
                <td>${em.availability_status}</td>
                <td>${renderStateBadge(em.calculated_state)}</td>
                <td>${em.source_code} <span class="sim-tag">SIMULADO</span></td>
                <td>${formatDateUTC(em.measured_at)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Bind Mission Control actions
  document.getElementById("btn-run-scenario")?.addEventListener("click", async () => {
    const code = document.getElementById("sim-scenario-select").value;
    const res = await apiService.runSimulatorScenario(
      code,
      appState.selectedAstronautId,
      appState.selectedMissionId,
      null
    );
    showToast((res.events_summary && res.events_summary[0]) || "Escenario ejecutado.");
    await renderMissionControl(container);
  });

  document.getElementById("btn-apply-context")?.addEventListener("click", async () => {
    const envCode = document.getElementById("ctx-env-select").value;
    await apiService.updateMissionContext(appState.selectedMissionId, {
      astronaut_id: appState.selectedAstronautId,
      environment_code: envCode,
      phase_code: envCode === "EXTRAVEHICULAR_ACTIVITY" ? "EVA" : s.mission.current_phase,
      location_module: `Módulo confirmado (${envCode})`,
      determination_source: "MANUAL_CONFIRMATION",
      connectivity_status: "ONLINE",
      is_simulated: true,
    });
    showToast(`Entorno actualizado a ${envCode}. Los límites clínicos no se modificaron.`);
    await renderMissionControl(container);
  });

  document.getElementById("btn-reset-demo")?.addEventListener("click", async () => {
    const res = await apiService.resetSimulator();
    showToast(res.message);
    await renderMissionControl(container);
  });

  document.getElementById("btn-toggle-offline")?.addEventListener("click", async () => {
    apiService.simulatedOfflineMode = !apiService.simulatedOfflineMode;
    if (!apiService.simulatedOfflineMode) {
      const syncRes = await apiService.flushOfflineQueue();
      showToast(`Conectividad restablecida. Elementos sincronizados sin duplicados: ${syncRes.synced}`);
    } else {
      showToast("Modo sin conexión activado. Los nuevos registros se guardarán en la cola local.");
    }
    await renderMissionControl(container);
  });

  container.querySelectorAll("[data-action-history]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-action-history");
      openIndicatorHistoryModal(code);
    });
  });

  container.querySelectorAll("[data-action-record]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-action-record");
      await navigateToSection("my-health-check");
      const sel = document.getElementById("hc-indicator-select");
      if (sel) {
        sel.value = code;
        sel.dispatchEvent(new Event("change"));
      }
    });
  });
}

function renderIndicatorCardHTML(c) {
  const simBadge = c.is_simulated ? `<span class="sim-tag">SIMULADO</span>` : "";
  const offlineWarn = c.sensor_offline
    ? `<div style="color:var(--state-warning); font-size:0.75rem; font-weight:600;">⚠ Sensor asociado fuera de línea</div>`
    : "";

  return `
    <article class="indicator-card" data-state="${c.state}">
      <div>
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
          <h3 style="margin:0; font-size:0.96rem;">${c.name}</h3>
          ${renderStateBadge(c.state)}
        </div>
        <div class="card-val-row" style="margin-top:0.55rem;">
          <span class="card-main-val">${c.display_value}</span>
          <span class="card-unit">${c.latest_value !== null ? c.unit : ""}</span>
          ${simBadge}
        </div>
        ${offlineWarn}
      </div>
      <div class="card-meta-list">
        <div><strong>Tendencia:</strong> ${c.trend_label}</div>
        <div><strong>Fecha:</strong> ${formatDateUTC(c.measured_at)} ${c.age_hours !== null ? `(${c.age_hours} h)` : ""}</div>
        <div><strong>Fuente:</strong> ${c.source_code} | <strong>Calidad:</strong> ${c.data_quality}</div>
      </div>
      <div class="card-actions">
        <button class="btn btn-sm" data-action-history="${c.indicator_code}">📈 Historial y Explicación</button>
        <button class="btn btn-sm btn-primary" data-action-record="${c.indicator_code}">＋ Registrar</button>
      </div>
    </article>
  `;
}

async function openIndicatorHistoryModal(indicatorCode) {
  const modal = document.getElementById("global-modal");
  const body = document.getElementById("global-modal-body");
  modal.classList.remove("hidden");
  body.innerHTML = `<p>Consultando historial y explicación asistiva para <strong>${indicatorCode}</strong>...</p>`;

  const [explain, ts] = await Promise.all([
    apiService.explainIndicator(
      indicatorCode,
      appState.selectedAstronautId,
      appState.selectedMissionId
    ),
    apiService.getAnalyticsTimeseries({
      astronaut_id: appState.selectedAstronautId,
      mission_id: appState.selectedMissionId,
      indicator_code: indicatorCode,
    }),
  ]);

  body.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
      <h3 style="margin:0;">${explain.indicator_name || indicatorCode}</h3>
      <span class="sim-tag">SIMULADO</span>
    </div>
    <p style="font-size:0.86rem; color:var(--text-secondary);">${explain.plain_explanation || ""}</p>
    <div class="panel-card" style="background:var(--bg-surface-elevated); padding:0.9rem;">
      <div><strong>Riesgo en Vuelo Espacial:</strong> ${explain.spaceflight_context || ""}</div>
      <div style="margin-top:0.4rem;"><strong>Resumen Histórico Descriptivo:</strong> ${explain.historical_summary || ""}</div>
      <div style="margin-top:0.4rem;"><strong>Contexto Ambiental:</strong> ${explain.environmental_context_note || ""}</div>
      <div style="margin-top:0.4rem; color:var(--accent-cyan);"><strong>Acción Recomendada por Protocolo:</strong> ${explain.recommended_protocol_action || ""}</div>
      <div style="margin-top:0.4rem; font-size:0.75rem; color:var(--text-muted);">${explain.causality_note || ""}</div>
    </div>
    <div style="height:240px; margin-top:1rem;">
      <canvas id="modal-history-chart"></canvas>
    </div>
    <p style="font-size:0.75rem; color:var(--text-muted); margin-top:0.7rem;">${explain.disclaimer || ""}</p>
  `;

  destroyChart("modalHistory");
  const ctx = document.getElementById("modal-history-chart")?.getContext("2d");
  if (ctx && window.Chart) {
    appState.charts.modalHistory = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: ts.points.map((p) => (p.measured_at ? p.measured_at.slice(5, 16).replace("T", " ") : "")),
        datasets: [
          {
            label: `${ts.indicator_name} (${ts.unit}) [SIMULADO]`,
            data: ts.points.map((p) => p.value),
            borderColor: "#00d2ff",
            backgroundColor: "rgba(0, 210, 255, 0.15)",
            spanGaps: false,
            tension: 0.25,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
      },
    });
  }
}

/* =========================================================================
   SECTION 2: MY HEALTH CHECK (GUIDED PERSONAL EVALUATION)
   ========================================================================= */

async function renderMyHealthCheck(container) {
  const indOptions = appState.indicatorsCatalog
    .map((d) => `<option value="${d.code}">${d.name} (${d.unit})</option>`)
    .join("");

  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <h2 class="panel-title">My Health Check — Evaluación Personal Guiada</h2>
        <span class="sim-tag">Soporta evaluación parcial, CSV/JSON y Cola Offline</span>
      </div>
      <p style="color:var(--text-secondary); font-size:0.88rem; margin-top:0;">
        Registre sus mediciones siguiendo las instrucciones paso a paso. Si no dispone de un dispositivo específico
        (p. ej. glucómetro o pulsioxímetro), puede completar únicamente los indicadores disponibles.
      </p>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap:1.4rem;">
        <!-- Guided Step-by-Step Form -->
        <form id="health-check-form" class="panel-card" style="background:var(--bg-surface-elevated); margin-bottom:0;">
          <h3 style="margin-top:0;">1. Selección e Instrucciones del Indicador</h3>
          <div class="form-group">
            <label for="hc-indicator-select">Indicador a registrar</label>
            <select id="hc-indicator-select" class="form-control">${indOptions}</select>
          </div>

          <div id="hc-instructions-box" class="panel-card" style="padding:0.85rem; margin-bottom:0.9rem; font-size:0.83rem;"></div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem;">
            <div class="form-group">
              <label for="hc-value-input" id="hc-value-label">Valor Principal</label>
              <input type="number" step="any" id="hc-value-input" class="form-control" required />
            </div>
            <div class="form-group" id="hc-secondary-group">
              <label for="hc-secondary-input" id="hc-secondary-label">Valor Secundario (Opcional)</label>
              <input type="number" step="any" id="hc-secondary-input" class="form-control" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem;">
            <div class="form-group">
              <label for="hc-source-select">Fuente del Dato</label>
              <select id="hc-source-select" class="form-control">
                <option value="MANUAL_ENTRY">Registro Manual Confirmado</option>
                <option value="DEMO_SIMULATION">Telemetría Sintética (Modo DEMO)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="hc-quality-select">Estado de Confirmación</label>
              <select id="hc-quality-select" class="form-control">
                <option value="VALIDATED">Medición Confirmada</option>
                <option value="PENDING_CONFIRMATION">Pendiente de Confirmar</option>
                <option value="SYNTHETIC_DEMO">Dato de Demostración (SIMULADO)</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="hc-notes-input">Observaciones operativas (opcional)</label>
            <input type="text" id="hc-notes-input" class="form-control" placeholder="Ej. Medición tomada en reposo post-hidratación" />
          </div>

          <div class="form-group" style="flex-direction:row; align-items:center; gap:0.5rem;">
            <input type="checkbox" id="hc-confirm-check" checked required />
            <label for="hc-confirm-check" style="margin:0;">Confirmo que revisé la unidad de medida y el procedimiento indicado.</label>
          </div>

          <button type="submit" class="btn btn-primary" style="width:100%;">✔ Validar y Guardar Medición</button>
        </form>

        <!-- Result & CSV/JSON Bulk Import -->
        <div>
          <div id="hc-result-panel" class="panel-card" style="background:var(--bg-surface-elevated);">
            <h3 style="margin-top:0;">Resultado de Evaluación y Siguiente Paso</h3>
            <p style="color:var(--text-secondary); font-size:0.85rem;">
              Complete el formulario para ver la validación de calidad, el estado calculado por el motor de reglas y las recomendaciones preventivas.
            </p>
          </div>

          <div class="panel-card" style="background:var(--bg-surface-elevated); margin-bottom:0;">
            <h3 style="margin-top:0;">Importar Lote CSV o JSON</h3>
            <div class="form-group">
              <label for="hc-import-format">Formato</label>
              <select id="hc-import-format" class="form-control">
                <option value="JSON">JSON</option>
                <option value="CSV">CSV</option>
              </select>
            </div>
            <div class="form-group">
              <label for="hc-import-text">Contenido a importar</label>
              <textarea id="hc-import-text" class="form-control" rows="4">[
  {"indicator_code": "HEART_RATE", "value": 71},
  {"indicator_code": "HYDRATION", "value": 2450}
]</textarea>
            </div>
            <button type="button" class="btn" id="btn-import-measurements">📥 Procesar Importación</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const sel = document.getElementById("hc-indicator-select");
  const updateIndicatorGuide = () => {
    const defn = appState.indicatorsCatalog.find((d) => d.code === sel.value);
    if (!defn) return;
    document.getElementById("hc-value-label").textContent = `Valor (${defn.unit}) [${defn.min_valid_value}–${defn.max_valid_value}]`;
    document.getElementById("hc-value-input").value = defn.rule?.normal_min
      ? Math.round((defn.rule.normal_min + defn.rule.normal_max) / 2)
      : 70;

    const secGroup = document.getElementById("hc-secondary-group");
    if (defn.code === "BLOOD_PRESSURE") {
      secGroup.classList.remove("hidden");
      document.getElementById("hc-secondary-label").textContent = "Presión Diastólica (mmHg)";
      document.getElementById("hc-secondary-input").value = 76;
    } else if (defn.code === "SLEEP_DURATION") {
      secGroup.classList.remove("hidden");
      document.getElementById("hc-secondary-label").textContent = "Calidad Percibida (1-10)";
      document.getElementById("hc-secondary-input").value = 8;
    } else {
      secGroup.classList.add("hidden");
      document.getElementById("hc-secondary-input").value = "";
    }

    document.getElementById("hc-instructions-box").innerHTML = `
      <div><strong>Significado:</strong> ${defn.educational_summary}</div>
      <div style="margin-top:0.35rem; white-space:pre-line;"><strong>Procedimiento Paso a Paso:</strong>\n${defn.step_by_step_instructions}</div>
      <div style="margin-top:0.35rem; color:var(--accent-cyan);">
        <strong>Equipo / Limitación:</strong> ${defn.requires_device ? "Requiere dispositivo adecuado: " : ""}${defn.device_note}
      </div>
      <div style="margin-top:0.35rem; font-size:0.76rem; color:var(--text-muted);">
        Rango de referencia DEMO (${defn.rule?.rule_code || "N/A"}): ${defn.rule?.normal_min}–${defn.rule?.normal_max} ${defn.unit}
      </div>
    `;
  };

  sel.addEventListener("change", updateIndicatorGuide);
  updateIndicatorGuide();

  document.getElementById("health-check-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = sel.value;
    const val = parseFloat(document.getElementById("hc-value-input").value);
    const secRaw = document.getElementById("hc-secondary-input").value;
    const secVal = secRaw !== "" ? parseFloat(secRaw) : null;
    const sourceCode = document.getElementById("hc-source-select").value;
    const dataQuality = document.getElementById("hc-quality-select").value;
    const notes = document.getElementById("hc-notes-input").value;

    const res = await apiService.createMeasurement({
      astronaut_id: appState.selectedAstronautId,
      mission_id: appState.selectedMissionId,
      indicator_code: code,
      value: val,
      secondary_value: secVal,
      source_code: sourceCode,
      data_quality: dataQuality,
      is_simulated: sourceCode === "DEMO_SIMULATION" || dataQuality === "SYNTHETIC_DEMO",
      notes,
    });

    const resultPanel = document.getElementById("hc-result-panel");
    if (res.queued_offline) {
      resultPanel.innerHTML = `
        <h3 style="margin-top:0; color:var(--state-monitor);">Guardado en Cola Sin Conexión</h3>
        <p>${res.message}</p>
      `;
      showToast(res.message);
      return;
    }

    const m = res.measurement;
    resultPanel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0;">Resultado: ${m.indicator_name}</h3>
        ${renderStateBadge(m.calculated_state)}
      </div>
      <p style="font-size:1.3rem; font-weight:800; margin:0.6rem 0;">
        ${m.value}${m.secondary_value !== null ? "/" + m.secondary_value : ""} ${m.unit}
      </p>
      <div style="font-size:0.84rem; margin-bottom:0.6rem;">
        <strong>Explicación de Evaluación:</strong> ${(res.evaluation_reasons || []).join(" ")}
      </div>
      <div style="font-size:0.84rem; color:var(--accent-cyan);">
        <strong>Siguiente Paso Recomendado:</strong> ${res.recommended_next_step}
      </div>
      ${
        res.gamification_update
          ? `<div style="margin-top:0.65rem; padding:0.55rem; background:var(--state-normal-bg); border-radius:6px; font-size:0.8rem;">
              🏅 <strong>Progreso de Autocuidado:</strong> ${res.gamification_update.reinforcement_message} (+${res.gamification_update.xp_awarded} XP)
            </div>`
          : ""
      }
    `;
    showToast(`Medición de ${m.indicator_name} registrada (${m.calculated_state}).`);
    await refreshGlobalHeaderAndSummary();
  });

  document.getElementById("btn-import-measurements").addEventListener("click", async () => {
    const fmt = document.getElementById("hc-import-format").value;
    const text = document.getElementById("hc-import-text").value;
    const res = await apiService.importMeasurements({
      astronaut_id: appState.selectedAstronautId,
      mission_id: appState.selectedMissionId,
      format_type: fmt,
      payload_text: text,
      is_simulated: true,
    });
    showToast(`Importación completada: ${res.imported_count} registros, ${res.alerts_generated} alertas.`);
    await refreshGlobalHeaderAndSummary();
  });
}

/* =========================================================================
   SECTION 3: BODY EXPLORER (INTERACTIVE SVG HUMAN SILHOUETTE)
   ========================================================================= */

async function renderBodyExplorer(container) {
  const res = await apiService.getBodyRegions(
    appState.selectedAstronautId,
    appState.selectedMissionId
  );
  appState.bodyRegions = res.regions || [];

  const getRegionState = (code) => {
    const r = appState.bodyRegions.find((x) => x.code === code);
    return r ? r.region_state : "NORMAL";
  };

  container.innerHTML = `
    <div class="body-explorer-layout">
      <!-- Interactive SVG Silhouette Panel -->
      <div class="silhouette-panel">
        <h2 style="margin-top:0; font-size:1.1rem;">Body Explorer — Silueta Interactiva</h2>
        <p style="font-size:0.78rem; color:var(--text-secondary); margin-top:0;">
          Seleccione cualquier región anatómica con mouse, teclado o pantalla táctil.
        </p>

        <svg class="body-svg" viewBox="0 0 260 520" role="img" aria-label="Silueta anatómica interactiva de AstroVital">
          <!-- 10. GENERAL WELLNESS AURA -->
          <ellipse id="region-general-wellness" class="svg-region" data-region-code="GENERAL_WELLNESS"
            data-region-state="${getRegionState("GENERAL_WELLNESS")}" tabindex="0" role="button" aria-label="Estado general y bienestar"
            cx="130" cy="260" rx="115" ry="245" style="fill:rgba(99,102,241,0.05); stroke-dasharray:4 4;" />

          <!-- 9. SKIN & THERMOREGULATION OUTLINE -->
          <path id="region-skin-thermo" class="svg-region" data-region-code="SKIN_THERMO"
            data-region-state="${getRegionState("SKIN_THERMO")}" tabindex="0" role="button" aria-label="Piel y termorregulación"
            d="M90,95 L170,95 L210,160 L195,270 L170,270 L175,480 L140,480 L130,320 L120,480 L85,480 L90,270 L65,270 L50,160 Z" />

          <!-- 1. HEAD & BRAIN -->
          <circle id="region-head-brain" class="svg-region" data-region-code="HEAD_BRAIN"
            data-region-state="${getRegionState("HEAD_BRAIN")}" tabindex="0" role="button" aria-label="Cabeza y cerebro"
            cx="130" cy="52" r="34" />

          <!-- 2. EYES & VISUAL SYSTEM -->
          <rect id="region-eyes-vision" class="svg-region" data-region-code="EYES_VISION"
            data-region-state="${getRegionState("EYES_VISION")}" tabindex="0" role="button" aria-label="Ojos y sistema visual"
            x="106" y="42" width="48" height="14" rx="6" />

          <!-- 4. LUNGS & RESPIRATORY -->
          <path id="region-lungs-resp" class="svg-region" data-region-code="LUNGS_RESP"
            data-region-state="${getRegionState("LUNGS_RESP")}" tabindex="0" role="button" aria-label="Pulmones y sistema respiratorio"
            d="M96,115 C96,105 122,105 125,120 L125,175 L92,175 Z M164,115 C164,105 138,105 135,120 L135,175 L168,175 Z" />

          <!-- 3. HEART & CARDIOVASCULAR -->
          <circle id="region-heart-cardio" class="svg-region" data-region-code="HEART_CARDIO"
            data-region-state="${getRegionState("HEART_CARDIO")}" tabindex="0" role="button" aria-label="Corazón y sistema cardiovascular"
            cx="138" cy="148" r="17" />

          <!-- 5. IMMUNE SYSTEM (THYMUS / LYMPHATIC NODE AREA) -->
          <polygon id="region-immune-system" class="svg-region" data-region-code="IMMUNE_SYSTEM"
            data-region-state="${getRegionState("IMMUNE_SYSTEM")}" tabindex="0" role="button" aria-label="Sistema inmunológico"
            points="130,96 144,114 130,126 116,114" />

          <!-- 6. DIGESTIVE & NUTRITION -->
          <rect id="region-digestive-nutrition" class="svg-region" data-region-code="DIGESTIVE_NUTRITION"
            data-region-state="${getRegionState("DIGESTIVE_NUTRITION")}" tabindex="0" role="button" aria-label="Sistema digestivo y nutricional"
            x="98" y="185" width="64" height="68" rx="14" />

          <!-- 8. MUSCLES (ARMS & THIGHS) -->
          <g id="region-muscles" class="svg-region" data-region-code="MUSCLES"
            data-region-state="${getRegionState("MUSCLES")}" tabindex="0" role="button" aria-label="Músculos">
            <rect x="60" y="115" width="24" height="120" rx="10" />
            <rect x="176" y="115" width="24" height="120" rx="10" />
            <rect x="92" y="270" width="30" height="95" rx="10" />
            <rect x="138" y="270" width="30" height="95" rx="10" />
          </g>

          <!-- 7. BONES & SKELETAL (SPINE, PELVIS & LOWER LEGS) -->
          <g id="region-bones-skeletal" class="svg-region" data-region-code="BONES_SKELETAL"
            data-region-state="${getRegionState("BONES_SKELETAL")}" tabindex="0" role="button" aria-label="Huesos y sistema musculoesquelético">
            <rect x="125" y="256" width="10" height="28" rx="3" />
            <rect x="96" y="375" width="22" height="95" rx="8" />
            <rect x="142" y="375" width="22" height="95" rx="8" />
          </g>
        </svg>

        <div class="region-Selector-chips">
          ${appState.bodyRegions
            .map(
              (r) => `
            <button class="btn btn-sm js-region-chip" data-region-code="${r.code}">
              ${r.name.split(" ")[0]}
            </button>`
            )
            .join("")}
        </div>
      </div>

      <!-- Contextual Region Detail Panel -->
      <div id="body-region-detail-panel" class="panel-card"></div>
    </div>
  `;

  const selectRegion = (regionCode) => {
    appState.selectedBodyRegionCode = regionCode;
    container.querySelectorAll(".svg-region").forEach((el) => {
      el.classList.toggle("selected", el.getAttribute("data-region-code") === regionCode);
    });
    renderSelectedBodyRegionDetail();
  };

  container.querySelectorAll(".svg-region, .js-region-chip").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      selectRegion(el.getAttribute("data-region-code"));
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectRegion(el.getAttribute("data-region-code"));
      }
    });
  });

  selectRegion(appState.selectedBodyRegionCode || "HEART_CARDIO");
}

function renderSelectedBodyRegionDetail() {
  const panel = document.getElementById("body-region-detail-panel");
  const reg = appState.bodyRegions.find((r) => r.code === appState.selectedBodyRegionCode);
  if (!panel || !reg) return;

  panel.innerHTML = `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">${reg.name}</h2>
        <span style="font-size:0.78rem; color:var(--text-secondary);">${reg.non_diagnostic_notice}</span>
      </div>
      ${renderStateBadge(reg.region_state)}
    </div>

    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:1rem; margin-bottom:1.1rem;">
      <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
        <h4 style="margin-top:0; color:var(--accent-cyan);">Función del Sistema</h4>
        <p style="font-size:0.85rem; margin-bottom:0;">${reg.system_function}</p>
      </div>
      <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
        <h4 style="margin-top:0; color:var(--state-monitor);">Riesgos Espaciales Relevantes</h4>
        <p style="font-size:0.85rem; margin-bottom:0;">${reg.space_risks}</p>
      </div>
      <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
        <h4 style="margin-top:0; color:var(--state-normal);">Recomendación Preventiva Autorizada</h4>
        <p style="font-size:0.85rem; margin-bottom:0;">${reg.preventive_recommendations}</p>
      </div>
    </div>

    <h3 style="margin-top:0;">Indicadores Asociados a esta Región</h3>
    <div class="indicators-grid">
      ${reg.indicators.map((c) => renderIndicatorCardHTML(c)).join("")}
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
      <div>
        <strong>Alertas Activas en esta Región:</strong> ${reg.active_alerts.length}
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button class="btn btn-sm" id="btn-region-credit-learning">🎓 Registrar Cápsula Educativa (+25 XP)</button>
        <button class="btn btn-sm btn-primary" id="btn-region-goto-alerts">Ver Alertas Relacionadas</button>
      </div>
    </div>
  `;

  panel.querySelectorAll("[data-action-history]").forEach((btn) => {
    btn.addEventListener("click", () => openIndicatorHistoryModal(btn.getAttribute("data-action-history")));
  });
  panel.querySelectorAll("[data-action-record]").forEach((btn) => {
    btn.addEventListener("click", () => navigateToSection("my-health-check"));
  });
  document.getElementById("btn-region-goto-alerts")?.addEventListener("click", () => {
    navigateToSection("alerts-center");
  });
  document.getElementById("btn-region-credit-learning")?.addEventListener("click", async () => {
    const res = await apiService.completeDailyMission(
      "LEARNING_MISSION",
      "COMPLETED",
      `Estudio de región anatómica: ${reg.name}`
    );
    showToast(res.reinforcement_message || "Cápsula educativa registrada.");
  });
}

/* =========================================================================
   SECTION 4: WELLNESS CENTER (PSYCHOLOGICAL WELLBEING & PRIVACY)
   ========================================================================= */

async function renderWellnessCenter(container) {
  const [instRes, assessRes, recsRes] = await Promise.all([
    apiService.getWellnessInstruments(),
    apiService.getWellnessAssessments(appState.selectedAstronautId),
    apiService.getWellnessRecommendations(appState.selectedAstronautId, "WELLNESS_STABLE"),
  ]);

  const instrument = instRes.instruments?.[0];
  const assessments = assessRes.assessments || [];
  const latestState = assessments[0]?.operational_wellness_state || "WELLNESS_STABLE";

  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Wellness Center — Salud Psicológica y Bienestar con Privacidad Reforzada</h2>
          <p style="margin:0.2rem 0 0; font-size:0.8rem; color:var(--text-secondary);">
            ${instrument?.disclaimer || ""}
          </p>
        </div>
        ${renderStateBadge(latestState)}
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap:1.3rem;">
        <!-- Questionnaire Form -->
        <form id="wellness-form" class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
          <h3 style="margin-top:0;">${instrument?.title || "Cuestionario DEMO"}</h3>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.65rem;">
            ${(instrument?.dimensions || [])
              .map(
                (dim) => `
              <div class="form-group" style="margin-bottom:0.4rem;">
                <label>${dim.label} (1-10)</label>
                <input type="number" min="1" max="10" value="${dim.high_is_good ? 8 : 3}"
                  data-dim-key="${dim.key}" class="form-control" required />
              </div>`
              )
              .join("")}
            <div class="form-group" style="margin-bottom:0.4rem;">
              <label>Horas de sueño recientes</label>
              <input type="number" step="0.5" min="0" max="16" id="wl-sleep-hours" value="7.0" class="form-control" />
            </div>
          </div>

          <div class="form-group" style="margin-top:0.6rem;">
            <label for="wl-urgency">Nivel de Apoyo Solicitado</label>
            <select id="wl-urgency" class="form-control">
              <option value="NONE">Sin solicitud adicional (Autocuidado habitual)</option>
              <option value="ROUTINE_COUNSELING">Solicitar charla preventiva con especialista</option>
              <option value="PRIORITY_REVIEW">Solicitar revisión prioritaria por fatiga/aislamiento</option>
              <option value="URGENT_SUPPORT">Solicitar apoyo psicológico urgente</option>
            </select>
          </div>

          <div class="form-group">
            <label for="wl-reflection">Reflexión Personal Confidencial (Privada por defecto — oculta al Líder en Tierra)</label>
            <textarea id="wl-reflection" class="form-control" rows="2" placeholder="Espacio privado para registrar cómo se siente..."></textarea>
          </div>

          <div class="form-group" style="flex-direction:row; align-items:center; gap:0.5rem;">
            <input type="checkbox" id="wl-share-signal" checked />
            <label for="wl-share-signal" style="margin:0;">
              Permitir enviar únicamente la señal operativa de seguimiento al Líder (sin compartir mis respuestas ni texto privado).
            </label>
          </div>

          <div style="display:flex; gap:0.6rem;">
            <button type="submit" class="btn btn-primary" data-draft="false" style="flex:1;">✔ Guardar Evaluación</button>
            <button type="button" class="btn" id="btn-save-wellness-draft">💾 Guardar Borrador</button>
          </div>
        </form>

        <!-- Guided Breathing & Authorized Recommendations -->
        <div>
          <div class="breathing-box">
            <h3 style="margin:0;">Guía de Respiración Táctica (4-4-4-4)</h3>
            <div id="breathing-circle" class="breathing-circle">Listo</div>
            <button type="button" class="btn btn-sm" id="btn-toggle-breathing">▶ Iniciar Ejercicio de Respiración</button>
          </div>

          <div class="panel-card" style="background:var(--bg-surface-elevated); margin-top:1rem; margin-bottom:0;">
            <h3 style="margin-top:0;">Catálogo de Recomendaciones Preventivas</h3>
            <p style="font-size:0.78rem; color:var(--state-warning); margin-top:0;">${recsRes.urgent_notice}</p>
            ${
              (recsRes.suppressed_for_safety || []).length > 0
                ? `<div style="padding:0.6rem; background:var(--state-warning-bg); border:1px solid var(--state-warning); border-radius:6px; font-size:0.78rem; margin-bottom:0.75rem;">
                    <strong>Seguridad Operativa:</strong> ${recsRes.suppressed_for_safety.map((s) => `${s.title} (${s.reason})`).join(" ")}
                  </div>`
                : ""
            }
            <div style="display:flex; flex-direction:column; gap:0.6rem; max-height:320px; overflow-y:auto;">
              ${(recsRes.recommendations || [])
                .map(
                  (r) => `
                <div style="padding:0.7rem; border:1px solid var(--border-subtle); border-radius:8px;">
                  <div style="display:flex; justify-content:space-between;">
                    <strong>${r.title}</strong>
                    <span class="sim-tag">${r.duration_minutes} min</span>
                  </div>
                  <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:0.25rem;">${r.instructions}</div>
                </div>`
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>

      <!-- Personal Wellness History -->
      <h3 style="margin-top:1.3rem;">Historial de Evaluaciones de Bienestar</h3>
      <div class="data-table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha (UTC)</th>
              <th>Estado Operativo</th>
              <th>Nivel de Apoyo</th>
              <th>Privacidad</th>
              <th>Detalle / Reflexión Privada</th>
            </tr>
          </thead>
          <tbody>
            ${assessments
              .map(
                (a) => `
              <tr>
                <td>${formatDateUTC(a.created_at)}</td>
                <td>${renderStateBadge(a.operational_wellness_state)}</td>
                <td>${a.support_urgency}</td>
                <td>${a.privacy_redacted ? "🔒 Protegido por Rol" : "🔓 Vista Propia Autorizada"}</td>
                <td>${a.private_reflection || a.privacy_notice || "Sin nota"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const submitWellness = async (isDraft) => {
    const payload = {
      astronaut_id: appState.selectedAstronautId,
      mission_id: appState.selectedMissionId,
      is_draft: isDraft,
      sleep_hours: parseFloat(document.getElementById("wl-sleep-hours").value || "7"),
      support_urgency: document.getElementById("wl-urgency").value,
      request_additional_support: document.getElementById("wl-urgency").value !== "NONE",
      private_reflection: document.getElementById("wl-reflection").value,
      share_operational_signal_with_leader: document.getElementById("wl-share-signal").checked,
      is_simulated: true,
    };
    container.querySelectorAll("[data-dim-key]").forEach((inp) => {
      payload[inp.getAttribute("data-dim-key")] = parseInt(inp.value, 10);
    });
    const res = await apiService.createWellnessAssessment(payload);
    showToast(
      isDraft
        ? "Borrador guardado de forma privada."
        : `Evaluación de bienestar registrada (${res.assessment.operational_wellness_state}).`
    );
    await renderWellnessCenter(container);
  };

  document.getElementById("wellness-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitWellness(false);
  });
  document.getElementById("btn-save-wellness-draft")?.addEventListener("click", async () => {
    await submitWellness(true);
  });

  document.getElementById("btn-toggle-breathing")?.addEventListener("click", () => {
    const circle = document.getElementById("breathing-circle");
    if (appState.breathingInterval) {
      clearInterval(appState.breathingInterval);
      appState.breathingInterval = null;
      circle.className = "breathing-circle";
      circle.textContent = "Pausado";
      return;
    }
    const phases = [
      { text: "Inhalar (4s)", cls: "breathing-circle inhale" },
      { text: "Mantener (4s)", cls: "breathing-circle inhale" },
      { text: "Exhalar (4s)", cls: "breathing-circle exhale" },
      { text: "Pausa (4s)", cls: "breathing-circle exhale" },
    ];
    let step = 0;
    const applyStep = () => {
      if (!document.body.contains(circle)) {
        clearInterval(appState.breathingInterval);
        appState.breathingInterval = null;
        return;
      }
      circle.className = phases[step % 4].cls;
      circle.textContent = phases[step % 4].text;
      step += 1;
    };
    applyStep();
    appState.breathingInterval = setInterval(applyStep, 4000);
  });
}

/* =========================================================================
   SECTION 5: DAILY MISSIONS & GAMIFICATION
   ========================================================================= */

async function renderDailyMissions(container) {
  const [prof, missionsRes] = await Promise.all([
    apiService.getGamificationProfile(appState.selectedAstronautId),
    apiService.getDailyMissions(appState.selectedAstronautId),
  ]);

  const lvl = prof.level_info;

  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Daily Missions — Autocuidado Gamificado y Progreso No Competitivo</h2>
          <p style="margin:0.2rem 0 0; font-size:0.8rem; color:var(--text-secondary);">
            ${prof.ethical_gamification_policy}
          </p>
        </div>
        <span class="state-badge state-NORMAL">Nivel: ${lvl.current_level} (${lvl.total_xp} XP)</span>
      </div>

      <!-- Progress Bars -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:1rem; margin-bottom:1.3rem;">
        <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
          <div style="display:flex; justify-content:space-between; font-size:0.84rem; margin-bottom:0.4rem;">
            <strong>Progreso Diario de Misiones (${missionsRes.date})</strong>
            <span>${missionsRes.completed_or_excused_today}/${missionsRes.total_missions} (${missionsRes.daily_progress_percent}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${missionsRes.daily_progress_percent}%;"></div>
          </div>
          <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.45rem;">
            Próxima misión recomendada: <strong>${missionsRes.next_recommended_mission_code || "¡Todas completadas hoy!"}</strong>
          </div>
        </div>

        <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
          <div style="display:flex; justify-content:space-between; font-size:0.84rem; margin-bottom:0.4rem;">
            <strong>Progreso hacia ${lvl.next_level}</strong>
            <span>${lvl.total_xp} / ${lvl.next_level_xp} XP (${lvl.level_progress_percent}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${lvl.level_progress_percent}%;"></div>
          </div>
          <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.45rem;">
            Racha activa: <strong>${prof.active_streak_days} días</strong> (Sin penalización por restricciones operativas)
          </div>
        </div>
      </div>

      <!-- Daily Missions Cards -->
      <h3 style="margin-top:0;">Catálogo de Misiones Diarias Configurables</h3>
      <div class="indicators-grid">
        ${missionsRes.missions
          .map(
            (m) => `
          <div class="indicator-card">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <h4 style="margin:0;">${m.title}</h4>
                <span class="sim-tag">+${m.xp_reward} XP</span>
              </div>
              <p style="font-size:0.82rem; color:var(--text-secondary); margin:0.45rem 0;">${m.description}</p>
              <div style="font-size:0.76rem; color:var(--accent-cyan);">${m.educational_content || ""}</div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-top:0.5rem;">
              <span class="state-badge ${m.status_today === "COMPLETED" ? "state-NORMAL" : m.status_today === "EXCUSED_OPERATIONAL_RESTRICTION" ? "state-MONITOR" : "state-UNKNOWN"}">
                ${m.status_today}
              </span>
              ${
                m.status_today === "PENDING"
                  ? `<div style="display:flex; gap:0.35rem;">
                      <button class="btn btn-sm btn-primary" data-complete-mission="${m.code}">✔ Completar</button>
                      <button class="btn btn-sm" data-excuse-mission="${m.code}" title="Omitir por EVA, sensor no disponible o restricción médica sin perder racha">Omitir por Restricción</button>
                    </div>`
                  : ""
              }
            </div>
          </div>`
          )
          .join("")}
      </div>

      <!-- Badges Collection -->
      <h3>Colección de Insignias (Reconocimiento de Hábitos Seguros y Aprendizaje)</h3>
      <div class="summary-kpis">
        ${prof.badges
          .map(
            (b) => `
          <div class="kpi-card" style="opacity:${b.earned ? "1" : "0.48"}; border-color:${b.earned ? "var(--state-normal)" : "var(--border-subtle)"};">
            <div style="display:flex; justify-content:space-between;">
              <strong>🏅 ${b.name}</strong>
              <span style="font-size:0.72rem; color:${b.earned ? "var(--state-normal)" : "var(--text-muted)"};">
                ${b.earned ? "OBTENIDA" : "PENDIENTE"}
              </span>
            </div>
            <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.25rem;">${b.description}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.2rem;">Criterio: ${b.criteria_description}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;

  container.querySelectorAll("[data-complete-mission]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-complete-mission");
      const res = await apiService.completeDailyMission(code, "COMPLETED", "Completada desde panel Daily Missions");
      showToast(res.reinforcement_message);
      await renderDailyMissions(container);
      await refreshGlobalHeaderAndSummary();
    });
  });

  container.querySelectorAll("[data-excuse-mission]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-excuse-mission");
      const res = await apiService.completeDailyMission(
        code,
        "EXCUSED_OPERATIONAL_RESTRICTION",
        "Excusada por restricción operativa o indisponibilidad de sensor"
      );
      showToast(res.reinforcement_message);
      await renderDailyMissions(container);
    });
  });
}

/* =========================================================================
   SECTION 6: MISSION ANALYTICS (LONGITUDINAL EVOLUTION & PHASE COMPARISON)
   ========================================================================= */

async function renderMissionAnalytics(container) {
  const indOptions = appState.indicatorsCatalog
    .map((d) => `<option value="${d.code}">${d.name} (${d.unit})</option>`)
    .join("");

  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Mission Analytics — Evolución Longitudinal y Comparación por Fases</h2>
        <span class="sim-tag">SIMULADO</span>
      </div>

      <!-- Filters -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:0.85rem; margin-bottom:1.2rem;">
        <div class="form-group" style="margin:0;">
          <label for="an-indicator">Indicador</label>
          <select id="an-indicator" class="form-control">${indOptions}</select>
        </div>
        <div class="form-group" style="margin:0;">
          <label for="an-phase">Fase de Misión</label>
          <select id="an-phase" class="form-control">
            <option value="">Todas las fases</option>
            <option value="TRAINING">TRAINING (Pre-misión)</option>
            <option value="LAUNCH">LAUNCH (Lanzamiento)</option>
            <option value="TRANSIT">TRANSIT (Tránsito)</option>
            <option value="SURFACE">SURFACE (Superficie)</option>
            <option value="EVA">EVA (Actividad Extravehicular)</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label for="an-source">Fuente de Datos</label>
          <select id="an-source" class="form-control">
            <option value="">Todas las fuentes</option>
            <option value="DEMO_SIMULATION">DEMO_SIMULATION</option>
            <option value="MANUAL_ENTRY">MANUAL_ENTRY</option>
            <option value="CSV_JSON_IMPORT">CSV_JSON_IMPORT</option>
            <option value="OFFLINE_QUEUE_SYNC">OFFLINE_QUEUE_SYNC</option>
          </select>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap:1.2rem;">
        <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
          <h3 style="margin-top:0; font-size:0.96rem;">Serie Temporal Longitudinal (Discontinuidades Explícitas)</h3>
          <div style="height:290px;">
            <canvas id="analytics-ts-chart"></canvas>
          </div>
          <p id="an-methodology-note" style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0;"></p>
        </div>

        <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
          <h3 style="margin-top:0; font-size:0.96rem;">Comparación por Fases de Misión (Media / Mín / Máx)</h3>
          <div style="height:290px;">
            <canvas id="analytics-phase-chart"></canvas>
          </div>
        </div>
      </div>
    </div>
  `;

  const loadCharts = async () => {
    const indCode = document.getElementById("an-indicator").value;
    const phaseCode = document.getElementById("an-phase").value;
    const sourceCode = document.getElementById("an-source").value;

    const [ts, phComp] = await Promise.all([
      apiService.getAnalyticsTimeseries({
        astronaut_id: appState.selectedAstronautId,
        mission_id: appState.selectedMissionId,
        indicator_code: indCode,
        phase_code: phaseCode,
        source_code: sourceCode,
      }),
      apiService.getPhaseComparison(
        appState.selectedAstronautId,
        appState.selectedMissionId,
        indCode
      ),
    ]);

    document.getElementById("an-methodology-note").textContent = ts.methodology_note;

    destroyChart("analyticsTs");
    const ctx1 = document.getElementById("analytics-ts-chart")?.getContext("2d");
    if (ctx1 && window.Chart) {
      appState.charts.analyticsTs = new window.Chart(ctx1, {
        type: "line",
        data: {
          labels: ts.points.map((p) =>
            p.is_gap_marker
              ? "SIN DATOS"
              : `${p.measured_at.slice(5, 16).replace("T", " ")} [${p.phase_code}]`
          ),
          datasets: [
            {
              label: `${ts.indicator_name} (${ts.unit}) [SIMULADO]`,
              data: ts.points.map((p) => p.value),
              borderColor: "#00d2ff",
              backgroundColor: "rgba(0, 210, 255, 0.14)",
              spanGaps: false,
              tension: 0.2,
              fill: true,
            },
            ...(ts.baseline_value !== null
              ? [
                  {
                    label: `Línea Base Pre-Misión (${ts.baseline_value} ${ts.unit})`,
                    data: ts.points.map(() => ts.baseline_value),
                    borderColor: "#10b981",
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false,
                  },
                ]
              : []),
          ],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });
    }

    destroyChart("analyticsPhase");
    const ctx2 = document.getElementById("analytics-phase-chart")?.getContext("2d");
    if (ctx2 && window.Chart) {
      const validPhases = phComp.phases_comparison.filter((p) => p.has_data);
      appState.charts.analyticsPhase = new window.Chart(ctx2, {
        type: "bar",
        data: {
          labels: validPhases.map((p) => p.phase_code),
          datasets: [
            {
              label: `Media por Fase (${phComp.unit}) [SIMULADO]`,
              data: validPhases.map((p) => p.mean_value),
              backgroundColor: "rgba(59, 130, 246, 0.65)",
              borderColor: "#00d2ff",
              borderWidth: 1,
            },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });
    }
  };

  ["an-indicator", "an-phase", "an-source"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", loadCharts);
  });
  await loadCharts();
}

/* =========================================================================
   SECTION 7: ALERTS CENTER
   ========================================================================= */

async function renderAlertsCenter(container) {
  const res = await apiService.getAlerts(appState.selectedAstronautId);
  const alerts = res.alerts || [];

  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Alerts Center — Motor Determinista de Reglas y Escalamiento</h2>
          <p style="margin:0.2rem 0 0; font-size:0.8rem; color:var(--text-secondary);">
            Las alertas críticas activan instrucciones inmediatas sin depender de modelos de IA.
          </p>
        </div>
        <span class="sim-tag">Total: ${alerts.length} alertas</span>
      </div>

      ${
        alerts.length === 0
          ? `<p>No hay alertas registradas para este astronauta.</p>`
          : alerts
              .map(
                (a) => `
          <div class="panel-card" style="background:var(--bg-surface-elevated); border-left:4px solid ${
            a.operational_state === "CRITICAL"
              ? "var(--state-critical)"
              : a.operational_state === "WARNING"
              ? "var(--state-warning)"
              : "var(--state-monitor)"
          };">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem;">
              <div>
                <h3 style="margin:0; font-size:1rem;">${a.title}</h3>
                <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:0.2rem;">
                  Astronauta: <strong>${a.astronaut_name}</strong> | Regla: <strong>${a.rule_code} (v${a.rule_version_label})</strong> |
                  Fecha: ${formatDateUTC(a.created_at)} | Entorno: ${a.environment_code}
                </div>
              </div>
              <div style="display:flex; gap:0.4rem; align-items:center;">
                ${renderStateBadge(a.operational_state)}
                <span class="sim-tag">Estado: ${a.status}</span>
                ${a.is_simulated ? `<span class="sim-tag">SIMULADO</span>` : ""}
              </div>
            </div>

            <p style="font-size:0.85rem; margin:0.65rem 0;">${a.explanation}</p>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:0.75rem; font-size:0.82rem;">
              <div style="padding:0.65rem; background:var(--bg-surface); border-radius:6px;">
                <strong style="color:var(--state-warning);">Acción Inmediata del Protocolo:</strong>
                <div style="white-space:pre-line; margin-top:0.25rem;">${a.immediate_action}</div>
              </div>
              <div style="padding:0.65rem; background:var(--bg-surface); border-radius:6px;">
                <strong style="color:var(--accent-cyan);">Recomendación de Seguimiento:</strong>
                <div style="margin-top:0.25rem;">${a.followup_recommendation}</div>
              </div>
            </div>

            <div style="margin-top:0.75rem; display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center;">
              <input type="text" class="form-control" id="alert-note-${a.id}" placeholder="Documentar actuación o seguimiento..." style="flex:1; min-width:220px;" />
              <button class="btn btn-sm btn-primary" data-ack-alert="${a.id}">✔ Reconocer Alerta</button>
              <button class="btn btn-sm" data-resolve-alert="${a.id}">✓ Marcar Resuelta</button>
              <button class="btn btn-sm btn-danger" data-escalate-alert="${a.id}">🚨 Escalar a Médico de Vuelo</button>
            </div>

            ${
              a.acknowledgements.length > 0 || a.followups.length > 0
                ? `<div style="margin-top:0.65rem; font-size:0.76rem; color:var(--text-secondary);">
                    <strong>Historial de Actuaciones:</strong>
                    ${a.acknowledgements.map((ack) => `[Reconocida por ${ack.role_at_time}: ${ack.action_taken}]`).join(" ")}
                    ${a.followups.map((f) => `[${f.action_type} por ${f.author_role}: ${f.notes}]`).join(" ")}
                  </div>`
                : ""
            }
          </div>`
              )
              .join("")
      }
    </div>
  `;

  container.querySelectorAll("[data-ack-alert]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ack-alert");
      const note = document.getElementById(`alert-note-${id}`)?.value || "Protocolo preventivo revisado y en ejecución.";
      await apiService.acknowledgeAlert(id, note);
      showToast(`Alerta #${id} reconocida.`);
      await renderAlertsCenter(container);
      await refreshGlobalHeaderAndSummary();
    });
  });

  container.querySelectorAll("[data-resolve-alert]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-resolve-alert");
      const note = document.getElementById(`alert-note-${id}`)?.value || "Medición de control normalizada.";
      await apiService.followupAlert(id, "RESOLVED", note);
      showToast(`Alerta #${id} marcada como resuelta.`);
      await renderAlertsCenter(container);
      await refreshGlobalHeaderAndSummary();
    });
  });

  container.querySelectorAll("[data-escalate-alert]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-escalate-alert");
      const note = document.getElementById(`alert-note-${id}`)?.value || "Escalamiento prioritario al equipo médico en Tierra.";
      await apiService.escalateAlert(id, note);
      showToast(`Alerta #${id} escalada a Medicina de Vuelo.`);
      await renderAlertsCenter(container);
    });
  });
}

/* =========================================================================
   SECTION 8: CREW MONITORING (FOR MISSION LEADER & ADMINISTRATOR)
   ========================================================================= */

async function renderCrewMonitoring(container) {
  const astronauts = appState.usersList.filter((u) => u.role_code === "ASTRONAUT");
  const summaries = await Promise.all(
    astronauts.map(async (a) => {
      try {
        const s = await apiService.getHealthSummary(a.id);
        const w = await apiService.getWellnessAssessments(a.id);
        return { astronaut: a, summary: s, wellness: w.assessments?.[0] || null };
      } catch {
        return null;
      }
    })
  );

  const validSummaries = summaries.filter(Boolean);

  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Crew Monitoring — Supervisión Terrestre de Tripulación Asignada</h2>
          <p style="margin:0.2rem 0 0; font-size:0.8rem; color:var(--text-secondary);">
            Muestra únicamente los astronautas asignados a sus misiones autorizadas. Las respuestas psicológicas privadas están protegidas.
          </p>
        </div>
        <span class="sim-tag">Tripulantes Autorizados: ${validSummaries.length}</span>
      </div>

      <div class="indicators-grid">
        ${validSummaries
          .map(
            ({ astronaut, summary, wellness }) => `
          <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h3 style="margin:0;">${astronaut.full_name} (${astronaut.crew_code})</h3>
              <span class="sim-tag">${summary.mission.code}</span>
            </div>
            <div style="font-size:0.82rem; color:var(--text-secondary); margin:0.5rem 0;">
              Entorno: <strong>${summary.context.environment_name}</strong> | Fase: <strong>${summary.mission.current_phase}</strong>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; font-size:0.82rem; margin-bottom:0.75rem;">
              <div>Normales: <strong>${summary.mission_summary.indicators_normal}</strong></div>
              <div>En Seguimiento: <strong>${summary.mission_summary.indicators_monitoring}</strong></div>
              <div>Alertas Activas: <strong style="color:var(--state-critical);">${summary.mission_summary.active_alerts_count}</strong></div>
              <div>Rutinas Hoy: <strong>${summary.mission_summary.routines_completed_today}/${summary.mission_summary.routines_total_available}</strong></div>
            </div>
            <div style="padding:0.55rem; background:var(--bg-surface); border-radius:6px; font-size:0.78rem; margin-bottom:0.75rem;">
              <strong>Señal Operativa de Bienestar:</strong>
              ${wellness ? renderStateBadge(wellness.operational_wellness_state) : "Sin registros"}
              <div style="color:var(--text-muted); margin-top:0.2rem;">
                🔒 Respuestas detalladas del cuestionario ocultas por política de privacidad.
              </div>
            </div>
            <button class="btn btn-primary btn-sm" data-inspect-crew="${astronaut.id}" style="width:100%;">
              🔍 Inspeccionar Telemetría y Alertas de ${astronaut.full_name}
            </button>
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;

  container.querySelectorAll("[data-inspect-crew]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      appState.selectedAstronautId = Number(btn.getAttribute("data-inspect-crew"));
      const crewSelect = document.getElementById("topbar-crew-select");
      if (crewSelect) crewSelect.value = String(appState.selectedAstronautId);
      await refreshGlobalHeaderAndSummary();
      await navigateToSection("mission-control");
    });
  });
}

/* =========================================================================
   SECTION 9: REPORTS & EXPORT
   ========================================================================= */

async function renderReportsSection(container) {
  const s = appState.healthSummary;
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Reports — Exportación Auditada de Informes de Misión (PDF, CSV, JSON)</h2>
          <p style="margin:0.2rem 0 0; font-size:0.8rem; color:var(--text-secondary);">
            Cada exportación verifica permisos de rol en el servidor y registra un evento en el historial de auditoría.
          </p>
        </div>
        <span class="sim-tag">SIMULADO</span>
      </div>

      <div class="panel-card" style="background:var(--bg-surface-elevated);">
        <h3 style="margin-top:0;">Configurar Informe Descargable</h3>
        <p style="font-size:0.85rem;">
          <strong>Tripulante seleccionado:</strong> ${s.astronaut.full_name} (${s.astronaut.crew_code}) |
          <strong>Misión:</strong> ${s.mission.name} (${s.mission.code}) |
          <strong>Cobertura de datos:</strong> ${s.mission_summary.data_quality_coverage_percent}%
        </p>
        <div class="form-group">
          <label for="rep-justification">Motivo / Justificación para el Registro de Auditoría</label>
          <input type="text" id="rep-justification" class="form-control" value="Revisión periódica de misión y respaldo de telemetría DEMO" />
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:0.75rem; margin-top:1rem;">
          <button class="btn btn-primary" data-export-fmt="PDF">📄 Descargar Informe PDF</button>
          <button class="btn" data-export-fmt="CSV">📊 Descargar Tabla CSV</button>
          <button class="btn" data-export-fmt="JSON">🗂 Descargar Paquete JSON</button>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-export-fmt]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const fmt = btn.getAttribute("data-export-fmt");
      const just = document.getElementById("rep-justification").value;
      await apiService.downloadReport(
        appState.selectedAstronautId,
        appState.selectedMissionId,
        fmt,
        just
      );
      showToast(`Informe ${fmt} generado, descargado y registrado en auditoría.`);
    });
  });
}

/* =========================================================================
   SECTION 10: ADMINISTRATION PANEL (USERS, MISSIONS, RULES, AUDIT)
   ========================================================================= */

async function renderAdministrationSection(container) {
  const [usersRes, missionsRes, rulesRes, sysStatus, auditRes] = await Promise.all([
    apiService.getUsers(),
    apiService.getMissions(),
    apiService.getAdminRules(),
    apiService.getSystemStatus(),
    apiService.getAuditEvents(),
  ]);

  appState.usersList = usersRes.users || [];
  appState.missionsList = missionsRes.missions || [];

  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Administration — Gestión de Usuarios, Misiones, Reglas Versionadas y Auditoría</h2>
        <span class="state-badge state-NORMAL">DB: ${sysStatus.database_status} | Motor: ${sysStatus.rules_engine_status}</span>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap:1.25rem;">
        <!-- Create User Form -->
        <form id="admin-create-user-form" class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
          <h3 style="margin-top:0;">1. Crear Nuevo Usuario</h3>
          <div class="form-group">
            <label>Código de Tripulación (ej. AST-404)</label>
            <input type="text" id="adm-u-code" class="form-control" value="AST-404" required />
          </div>
          <div class="form-group">
            <label>Nombre Completo</label>
            <input type="text" id="adm-u-name" class="form-control" placeholder="Ej. Dra. Sofía Ramírez" required />
          </div>
          <div class="form-group">
            <label>Correo Electrónico</label>
            <input type="email" id="adm-u-email" class="form-control" placeholder="sofia.ramirez@astrovital.demo" required />
          </div>
          <div class="form-group">
            <label>Contraseña Inicial</label>
            <input type="password" id="adm-u-pass" class="form-control" value="AstroCrew!2026" required />
          </div>
          <div class="form-group">
            <label>Rol</label>
            <select id="adm-u-role" class="form-control">
              <option value="ASTRONAUT">ASTRONAUT</option>
              <option value="MISSION_LEADER">MISSION_LEADER</option>
              <option value="ADMINISTRATOR">ADMINISTRATOR</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;">＋ Crear Usuario</button>
        </form>

        <!-- Assign User to Mission -->
        <form id="admin-assign-mission-form" class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
          <h3 style="margin-top:0;">2. Vincular Astronauta o Líder a Misión</h3>
          <div class="form-group">
            <label>Misión</label>
            <select id="adm-as-mission" class="form-control">
              ${appState.missionsList.map((m) => `<option value="${m.id}">${m.code} — ${m.name}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label>Usuario</label>
            <select id="adm-as-user" class="form-control">
              ${appState.usersList.map((u) => `<option value="${u.id}">${u.full_name} (${u.email} - ${u.role_code})</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label>Rol en la Misión</label>
            <select id="adm-as-role" class="form-control">
              <option value="ASTRONAUT">ASTRONAUT</option>
              <option value="MISSION_LEADER">MISSION_LEADER</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;">🔗 Guardar Asignación a Misión</button>
        </form>
      </div>

      <!-- Users Table -->
      <h3 style="margin-top:1.4rem;">Directorio de Cuentas y Control de Estado</h3>
      <div class="data-table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID / Código</th>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Misiones Asignadas</th>
              <th>Acciones Administrativas</th>
            </tr>
          </thead>
          <tbody>
            ${appState.usersList
              .map(
                (u) => `
              <tr>
                <td>#${u.id} (${u.crew_code})</td>
                <td><strong>${u.full_name}</strong></td>
                <td>${u.email}</td>
                <td>${u.role_code}</td>
                <td>${u.status}</td>
                <td>${u.missions.map((m) => m.mission_code).join(", ") || "Ninguna"}</td>
                <td>
                  <button class="btn btn-sm" data-toggle-status="${u.id}" data-cur-status="${u.status}">
                    ${u.status === "ACTIVE" ? "Suspender" : "Reactivar"}
                  </button>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <!-- Clinical Rules Catalog -->
      <h3 style="margin-top:1.4rem;">Catálogo de Reglas Operativas Versionadas (Marcadas como DEMO)</h3>
      <div class="data-table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código de Regla</th>
              <th>Indicador</th>
              <th>Versión Activa</th>
              <th>Rango Normal</th>
              <th>Rango Seguimiento</th>
              <th>Umbral Alerta</th>
              <th>Fuente del Protocolo</th>
            </tr>
          </thead>
          <tbody>
            ${(rulesRes.rules || [])
              .map((r) => {
                const v = r.versions[0] || {};
                return `
              <tr>
                <td><strong>${r.rule_code}</strong></td>
                <td>${r.indicator_code}</td>
                <td><span class="sim-tag">${r.current_version_number}</span></td>
                <td>${v.normal_min} – ${v.normal_max}</td>
                <td>${v.monitor_min} – ${v.monitor_max}</td>
                <td>${v.warning_min} – ${v.warning_max}</td>
                <td>${v.protocol_source || "DEMO"}</td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>

      <!-- Security & Audit Log -->
      <h3 style="margin-top:1.4rem;">Registro de Eventos de Auditoría y Seguridad</h3>
      <div class="data-table-wrapper" style="max-height:320px; overflow-y:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha (UTC)</th>
              <th>Actor</th>
              <th>Rol</th>
              <th>Acción</th>
              <th>Recurso</th>
              <th>Estado</th>
              <th>Detalles / Justificación</th>
            </tr>
          </thead>
          <tbody>
            ${(auditRes.audit_events || [])
              .map(
                (ev) => `
              <tr>
                <td>${formatDateUTC(ev.created_at)}</td>
                <td>${ev.actor_email || "Sistema/Anónimo"}</td>
                <td>${ev.actor_role || "-"}</td>
                <td><strong>${ev.action}</strong></td>
                <td>${ev.resource_type} ${ev.resource_id ? `(#${ev.resource_id})` : ""}</td>
                <td><span class="state-badge ${ev.status === "SUCCESS" ? "state-NORMAL" : "state-CRITICAL"}">${ev.status}</span></td>
                <td>${ev.details || ""} ${ev.justification ? `[Justificación: ${ev.justification}]` : ""}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("admin-create-user-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiService.createUser({
      crew_code: document.getElementById("adm-u-code").value,
      full_name: document.getElementById("adm-u-name").value,
      email: document.getElementById("adm-u-email").value,
      password: document.getElementById("adm-u-pass").value,
      role_code: document.getElementById("adm-u-role").value,
    });
    showToast("Usuario creado y registrado en auditoría.");
    await renderAdministrationSection(container);
    updateRoleNavigation();
  });

  document.getElementById("admin-assign-mission-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiService.assignUserToMission(
      document.getElementById("adm-as-mission").value,
      document.getElementById("adm-as-user").value,
      document.getElementById("adm-as-role").value
    );
    showToast("Usuario vinculado a la misión.");
    await renderAdministrationSection(container);
  });

  container.querySelectorAll("[data-toggle-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.getAttribute("data-toggle-status");
      const cur = btn.getAttribute("data-cur-status");
      const next = cur === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
      await apiService.updateUserStatus(uid, next, "Actualización administrativa desde panel");
      showToast(`Estado de usuario #${uid} actualizado a ${next}.`);
      await renderAdministrationSection(container);
    });
  });
}

/* =========================================================================
   SECTION 11: SETTINGS, ACCESSIBILITY & 10-SCENE JURY DEMO GUIDE
   ========================================================================= */

async function renderSettingsAndHelp(container) {
  const u = appState.currentUser;
  container.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <h2 class="panel-title">Settings, Accessibility & Guion de Demostración para el Jurado</h2>
        <span class="sim-tag">AstroVital v1.0</span>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:1.25rem; margin-bottom:1.4rem;">
        <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
          <h3 style="margin-top:0;">Tema Visual y Accesibilidad</h3>
          <p style="font-size:0.83rem; color:var(--text-secondary);">
            Los estados utilizan iconos, etiquetas de texto y bordes diferenciados además del color.
          </p>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
            <button class="btn" data-set-theme="space-dark">🌌 Azul Espacial Oscuro (Predeterminado)</button>
            <button class="btn" data-set-theme="high-contrast">👁 Alto Contraste</button>
            <button class="btn" data-set-theme="daylight-clean">☀ Tema Claro Jerárquico</button>
          </div>
        </div>

        <div class="panel-card" style="background:var(--bg-surface-elevated); margin:0;">
          <h3 style="margin-top:0;">Preferencias de Privacidad y Recordatorios (${u.full_name})</h3>
          <div class="form-group" style="flex-direction:row; align-items:center; gap:0.5rem;">
            <input type="checkbox" id="set-share-leader" ${u.share_wellness_signals_with_leader ? "checked" : ""} />
            <label for="set-share-leader" style="margin:0;">Compartir señales operativas de seguimiento con el Líder en Tierra</label>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-save-privacy">Guardar Preferencias</button>
        </div>
      </div>

      <!-- 10-Scene Jury Demo Walkthrough -->
      <div class="panel-card" style="background:var(--bg-surface-elevated);">
        <h3 style="margin-top:0;">🎬 Guion Interactivo de Demostración para el Jurado (10 Escenas — 5 Minutos)</h3>
        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Escena</th>
                <th>Descripción Operativa</th>
                <th>Acción Directa</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Escena 1 — Inicio de misión</strong></td>
                <td>Visualizar Mission Control, fase activa, entorno lunar y resumen de misión como astronauta.</td>
                <td><button class="btn btn-sm" data-goto-sec="mission-control">Ir a Mission Control</button></td>
              </tr>
              <tr>
                <td><strong>Escena 2 — Exploración corporal</strong></td>
                <td>Seleccionar el corazón en la silueta SVG interactiva y abrir los indicadores cardiovasculares.</td>
                <td><button class="btn btn-sm" data-goto-sec="body-explorer">Abrir Body Explorer</button></td>
              </tr>
              <tr>
                <td><strong>Escena 3 — Evaluación personal</strong></td>
                <td>Registrar una medición sintética en My Health Check y verificar validación y persistencia.</td>
                <td><button class="btn btn-sm" data-goto-sec="my-health-check">Abrir My Health Check</button></td>
              </tr>
              <tr>
                <td><strong>Escena 4 — Alerta y prevención</strong></td>
                <td>Ejecutar Escenario 3 o 4 en el simulador y revisar la regla y acciones en Alerts Center.</td>
                <td><button class="btn btn-sm" data-goto-sec="alerts-center">Abrir Alerts Center</button></td>
              </tr>
              <tr>
                <td><strong>Escena 5 — Gamificación</strong></td>
                <td>Completar una misión de autocuidado en Daily Missions y revisar XP e insignias.</td>
                <td><button class="btn btn-sm" data-goto-sec="daily-missions">Abrir Daily Missions</button></td>
              </tr>
              <tr>
                <td><strong>Escena 6 — Bienestar</strong></td>
                <td>Completar el cuestionario DEMO en Wellness Center y probar la respiración guiada.</td>
                <td><button class="btn btn-sm" data-goto-sec="wellness-center">Abrir Wellness Center</button></td>
              </tr>
              <tr>
                <td><strong>Escena 7 — Contexto y analítica</strong></td>
                <td>Revisar evolución longitudinal y comparación por fases en Mission Analytics.</td>
                <td><button class="btn btn-sm" data-goto-sec="mission-analytics">Abrir Mission Analytics</button></td>
              </tr>
              <tr>
                <td><strong>Escena 8 — Supervisión terrestre</strong></td>
                <td>Iniciar sesión como Líder (leader@astrovital.demo) y supervisar Crew Monitoring.</td>
                <td><button class="btn btn-sm" data-goto-sec="crew-monitoring">Abrir Crew Monitoring</button></td>
              </tr>
              <tr>
                <td><strong>Escena 9 — Administración</strong></td>
                <td>Iniciar sesión como Admin (admin@astrovital.demo), crear un usuario y revisar auditoría.</td>
                <td><button class="btn btn-sm" data-goto-sec="administration">Abrir Administration</button></td>
              </tr>
              <tr>
                <td><strong>Escena 10 — Cierre e Informes</strong></td>
                <td>Exportar informe auditado en PDF, CSV o JSON y mostrar trazabilidad de fuentes.</td>
                <td><button class="btn btn-sm" data-goto-sec="reports">Abrir Reports</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-set-theme]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const theme = btn.getAttribute("data-set-theme");
      document.body.setAttribute("data-theme", theme);
      await apiService.updateUserProfile(u.id, { preferred_theme: theme });
      showToast(`Tema cambiado a ${theme}.`);
    });
  });

  document.getElementById("btn-save-privacy")?.addEventListener("click", async () => {
    const share = document.getElementById("set-share-leader").checked;
    await apiService.updateUserProfile(u.id, { share_wellness_signals_with_leader: share });
    showToast("Preferencias de privacidad actualizadas.");
  });

  container.querySelectorAll("[data-goto-sec]").forEach((btn) => {
    btn.addEventListener("click", () => navigateToSection(btn.getAttribute("data-goto-sec")));
  });
}

/* =========================================================================
   STATIC EVENT BINDINGS
   ========================================================================= */

function bindStaticEvents() {
  // Login Form
  document.getElementById("login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const errBox = document.getElementById("login-error");
    errBox.classList.add("hidden");

    try {
      const res = await apiService.login(email, password);
      apiService.setSession(res.access_token, res.csrf_token);
      await onAuthenticated(res.user);
      showToast(`Bienvenido a AstroVital, ${res.user.full_name}.`);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    }
  });

  // Quick Demo Account Fillers
  document.querySelectorAll("[data-demo-email]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("login-email").value = btn.getAttribute("data-demo-email");
      document.getElementById("login-password").value = btn.getAttribute("data-demo-pass");
    });
  });

  // Sidebar & Mobile Nav buttons
  document.querySelectorAll("[data-nav-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigateToSection(btn.getAttribute("data-nav-section"));
    });
  });

  // Topbar Crew Selector (for Leader & Admin)
  document.getElementById("topbar-crew-select")?.addEventListener("change", async (e) => {
    appState.selectedAstronautId = Number(e.target.value);
    await refreshGlobalHeaderAndSummary();
    await navigateToSection(appState.currentSection);
  });

  // Theme quick toggle
  document.getElementById("btn-quick-theme")?.addEventListener("click", () => {
    const cur = document.body.getAttribute("data-theme") || "space-dark";
    const next = cur === "space-dark" ? "high-contrast" : "space-dark";
    document.body.setAttribute("data-theme", next);
  });

  // Logout
  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    try {
      await apiService.logout();
    } catch {
      // ignore
    }
    apiService.clearSession();
    appState.currentUser = null;
    toggleAuthScreen(true);
  });

  // Modal Close
  document.getElementById("btn-close-modal")?.addEventListener("click", () => {
    document.getElementById("global-modal").classList.add("hidden");
  });
}

window.addEventListener("DOMContentLoaded", initApp);

