/* SEMSA · Consola · vista "Administración" (sustituye al antiguo panel Administration)
 *
 * Solo ADMINISTRATOR: alta de cuentas, asignación a misiones, suspensión/reactivación,
 * catálogo de reglas operativas versionadas (solo lectura, DEMO) y registro de auditoría.
 * Todas las acciones quedan auditadas en el servidor.
 */
import { apiService } from "../../services/api.js";
import { tr, fmt as fmtT } from "../../i18n/i18n.js";
import { bt } from "/src/i18n/backend.js";
import {
  esc, tag, fmt, errMsg, ensureCss, loadingHTML, errorHTML, noAccessHTML, bindRetry, makeStale, roleOf,
  snapshotFields, restoreFields, langChanged,
} from "./more-common.js";

const DICT = {
  es: {
    title: "Administración",
    loading: "Cargando administración…",
    loadError: "No se pudo cargar la administración",
    noAccess: "La administración de cuentas, misiones, reglas y auditoría está reservada al rol de administración.",
    sysDb: "Base de datos",
    sysEngine: "Motor de reglas",
    // crear usuario
    createTitle: "Crear cuenta",
    crewCode: "Código de tripulación",
    crewCodePlaceholder: "Ej.: AST-404",
    fullName: "Nombre completo",
    fullNamePlaceholder: "Ej.: Dra. Sofía Ramírez",
    email: "Correo electrónico",
    emailPlaceholder: "sofia.ramirez@semsa.demo",
    password: "Contraseña inicial",
    role: "Rol",
    roles: { ASTRONAUT: "Astronauta", MISSION_LEADER: "Líder de misión", ADMINISTRATOR: "Administración" },
    create: "Crear cuenta",
    created: "Cuenta creada y registrada en auditoría.",
    // asignar
    assignTitle: "Vincular a misión",
    mission: "Misión",
    user: "Cuenta",
    missionRole: "Rol en la misión",
    assign: "Guardar asignación",
    assigned: "Cuenta vinculada a la misión.",
    // directorio
    usersTitle: "Directorio de cuentas",
    colId: "ID / código",
    colName: "Nombre",
    colEmail: "Correo",
    colRole: "Rol",
    colStatus: "Estado",
    colMissions: "Misiones",
    colActions: "Acciones",
    statuses: { ACTIVE: "Activa", SUSPENDED: "Suspendida" },
    none: "Ninguna",
    suspend: "Suspender",
    reactivate: "Reactivar",
    statusReason: "Actualización administrativa desde panel",
    statusChanged: "Cuenta #{id}: {status}.",
    // reglas
    rulesTitle: "Reglas operativas versionadas",
    rulesTag: "DEMO",
    colRule: "Regla",
    colIndicator: "Indicador",
    colVersion: "Versión",
    colNormal: "Rango nominal",
    colMonitor: "Rango de seguimiento",
    colWarning: "Umbral de alerta",
    colSource: "Fuente del protocolo",
    rulesEmpty: "No hay reglas registradas.",
    // auditoría
    auditTitle: "Auditoría y seguridad",
    colDate: "GMT",
    colActor: "Actor",
    colAction: "Acción",
    colResource: "Recurso",
    colResult: "Resultado",
    colDetails: "Detalles / justificación",
    actorSystem: "Sistema / anónimo",
    justification: "Justificación",
    auditEmpty: "No hay eventos de auditoría.",
    ok: "Correcto",
    failed: "Fallido",
    working: "Guardando…",
    actionError: "No se pudo completar la acción: {msg}",
  },
  en: {
    title: "Administration",
    loading: "Loading administration…",
    loadError: "Couldn't load administration",
    noAccess: "Managing accounts, missions, rules and audit is reserved for the administration role.",
    sysDb: "Database",
    sysEngine: "Rules engine",
    // crear usuario
    createTitle: "Create account",
    crewCode: "Crew code",
    crewCodePlaceholder: "E.g.: AST-404",
    fullName: "Full name",
    fullNamePlaceholder: "E.g.: Dr. Sofía Ramírez",
    email: "Email",
    emailPlaceholder: "sofia.ramirez@semsa.demo",
    password: "Initial password",
    role: "Role",
    roles: { ASTRONAUT: "Astronaut", MISSION_LEADER: "Mission leader", ADMINISTRATOR: "Administration" },
    create: "Create account",
    created: "Account created and logged in the audit trail.",
    // asignar
    assignTitle: "Link to mission",
    mission: "Mission",
    user: "Account",
    missionRole: "Mission role",
    assign: "Save assignment",
    assigned: "Account linked to the mission.",
    // directorio
    usersTitle: "Account directory",
    colId: "ID / code",
    colName: "Name",
    colEmail: "Email",
    colRole: "Role",
    colStatus: "Status",
    colMissions: "Missions",
    colActions: "Actions",
    statuses: { ACTIVE: "Active", SUSPENDED: "Suspended" },
    none: "None",
    suspend: "Suspend",
    reactivate: "Reactivate",
    statusReason: "Administrative update from panel",
    statusChanged: "Account #{id}: {status}.",
    // reglas
    rulesTitle: "Versioned operational rules",
    rulesTag: "DEMO",
    colRule: "Rule",
    colIndicator: "Indicator",
    colVersion: "Version",
    colNormal: "Nominal range",
    colMonitor: "Follow-up range",
    colWarning: "Alert threshold",
    colSource: "Protocol source",
    rulesEmpty: "No rules recorded.",
    // auditoría
    auditTitle: "Audit and security",
    colDate: "GMT",
    colActor: "Actor",
    colAction: "Action",
    colResource: "Resource",
    colResult: "Result",
    colDetails: "Details / justification",
    actorSystem: "System / anonymous",
    justification: "Justification",
    auditEmpty: "No audit events.",
    ok: "Success",
    failed: "Failed",
    working: "Saving…",
    actionError: "Couldn't complete the action: {msg}",
  },
};

/* result: función que devuelve el último mensaje en el idioma vigente */
const ui = { result: null, lang: null };
const msg = (key, vars) => () => fmtT(tr(DICT)[key], vars);
const range = (a, b) => (a === null || a === undefined) && (b === null || b === undefined) ? "—" : `${esc(a ?? "—")} – ${esc(b ?? "—")}`;

export async function renderAdminView(container, appState, helpers) {
  const T = tr(DICT);
  ensureCss();
  if (roleOf(appState) !== "ADMINISTRATOR") {
    container.innerHTML = noAccessHTML("av-ad-root", T.noAccess);
    return;
  }
  const stale = makeStale(appState);
  const again = () => renderAdminView(container, appState, helpers);
  const keep = langChanged(ui, container.querySelector(".av-ad-root"));
  if (!container.querySelector(".av-ad-root")) {
    ui.result = null;
    container.innerHTML = loadingHTML("av-ad-root", T.loading);
  }

  let usersRes, missionsRes, rulesRes, sys, auditRes;
  try {
    [usersRes, missionsRes, rulesRes, sys, auditRes] = await Promise.all([
      apiService.getUsers(),
      apiService.getMissions(),
      apiService.getAdminRules(),
      apiService.getSystemStatus(),
      apiService.getAuditEvents(),
    ]);
  } catch (err) {
    if (stale()) return;
    container.innerHTML = errorHTML("av-ad-root", T.loadError, errMsg(err));
    bindRetry(container, again);
    return;
  }
  if (stale()) return;

  appState.usersList = usersRes.users || [];
  appState.missionsList = missionsRes.missions || [];
  const users = appState.usersList;
  const missions = appState.missionsList;
  const rules = rulesRes.rules || [];
  const audit = auditRes.audit_events || [];
  const roleLbl = (r) => T.roles[r] || r || "—";
  const roleOptions = (codes) => codes.map((c) => `<option value="${c}">${esc(T.roles[c])}</option>`).join("");

  // re-render por cambio de idioma: conservar lo escrito en los formularios laterales
  const snap = keep ? snapshotFields(container.querySelector(".av-ad-root .av-mx-side")) : null;
  container.innerHTML = `
    <div class="av-console av-mx-root av-ad-root"><div class="av-grid">
      <div class="av-col-b">
        <section class="av-panel" aria-labelledby="av-ad-h">
          <div class="av-panel-head">
            <h2 class="av-h2" id="av-ad-h">${T.title}</h2>
            <span class="av-mx-btns">${tag(`${T.sysDb}: ${bt(sys.database_status) ?? "—"}`)} ${tag(`${T.sysEngine}: ${bt(sys.rules_engine_status) ?? "—"}`)}</span>
          </div>
          <p class="av-mx-status" id="av-ad-status" role="status" aria-live="polite" style="margin:${ui.result ? "12px" : "0"}">${esc(ui.result ? ui.result() : "")}</p>
          <div class="av-panel-head"><h3 class="av-h3">${T.usersTitle}</h3><span class="av-sub av-mono">${users.length}</span></div>
          <div class="av-hscroll"><table class="av-table av-mx-table" style="min-width:860px">
            <thead><tr><th scope="col">${T.colId}</th><th scope="col">${T.colName}</th><th scope="col">${T.colEmail}</th><th scope="col">${T.colRole}</th><th scope="col">${T.colStatus}</th><th scope="col">${T.colMissions}</th><th scope="col">${T.colActions}</th></tr></thead>
            <tbody>${users
              .map(
                (u) => `<tr>
                  <td class="av-mono av-mx-nowrap">#${esc(u.id)} · ${esc(u.crew_code)}</td>
                  <td><strong>${esc(u.full_name)}</strong></td>
                  <td>${esc(u.email)}</td>
                  <td>${esc(roleLbl(u.role_code))}</td>
                  <td>${tag(T.statuses[u.status] || u.status, u.status !== "ACTIVE")}</td>
                  <td class="av-mono">${(u.missions || []).map((m) => esc(m.mission_code)).join(", ") || T.none}</td>
                  <td><button type="button" class="av-btn av-btn-sm ${u.status === "ACTIVE" ? "av-btn-danger" : ""}" data-ad-toggle="${esc(u.id)}" data-ad-status="${esc(u.status)}">${u.status === "ACTIVE" ? T.suspend : T.reactivate}</button></td>
                </tr>`
              )
              .join("")}</tbody></table></div>
        </section>

        <section class="av-panel" aria-labelledby="av-ad-rules-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-ad-rules-h">${T.rulesTitle}</h2><span class="av-mx-btns">${tag(T.rulesTag)}<span class="av-sub av-mono">${rules.length}</span></span></div>
          ${
            rules.length
              ? `<div class="av-hscroll"><table class="av-table av-mx-table" style="min-width:860px">
                  <thead><tr><th scope="col">${T.colRule}</th><th scope="col">${T.colIndicator}</th><th scope="col">${T.colVersion}</th><th scope="col">${T.colNormal}</th><th scope="col">${T.colMonitor}</th><th scope="col">${T.colWarning}</th><th scope="col">${T.colSource}</th></tr></thead>
                  <tbody>${rules
                    .map((r) => {
                      const v = (r.versions || [])[0] || {};
                      return `<tr>
                        <td class="av-mono"><strong>${esc(r.rule_code)}</strong></td>
                        <td class="av-mono">${esc(r.indicator_code)}</td>
                        <td class="av-mono">${esc(r.current_version_number)}</td>
                        <td class="av-mono av-mx-nowrap">${range(v.normal_min, v.normal_max)}</td>
                        <td class="av-mono av-mx-nowrap">${range(v.monitor_min, v.monitor_max)}</td>
                        <td class="av-mono av-mx-nowrap">${range(v.warning_min, v.warning_max)}</td>
                        <td class="av-sub">${esc(bt(v.protocol_source) || T.rulesTag)}</td>
                      </tr>`;
                    })
                    .join("")}</tbody></table></div>`
              : `<p class="av-mx-empty">${T.rulesEmpty}</p>`
          }
        </section>

        <section class="av-panel" aria-labelledby="av-ad-audit-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-ad-audit-h">${T.auditTitle}</h2><span class="av-sub av-mono">${audit.length}</span></div>
          ${
            audit.length
              ? `<div class="av-hscroll av-mx-scroll"><table class="av-table av-mx-table" style="min-width:900px">
                  <thead><tr><th scope="col">${T.colDate}</th><th scope="col">${T.colActor}</th><th scope="col">${T.colRole}</th><th scope="col">${T.colAction}</th><th scope="col">${T.colResource}</th><th scope="col">${T.colResult}</th><th scope="col">${T.colDetails}</th></tr></thead>
                  <tbody>${audit
                    .map(
                      (ev) => `<tr>
                        <td class="av-mono av-mx-nowrap">${fmt(ev.created_at)}</td>
                        <td>${esc(ev.actor_email || T.actorSystem)}</td>
                        <td>${esc(ev.actor_role ? roleLbl(ev.actor_role) : "—")}</td>
                        <td class="av-mono"><strong>${esc(ev.action)}</strong></td>
                        <td class="av-mono">${esc(ev.resource_type || "")}${ev.resource_id ? ` #${esc(ev.resource_id)}` : ""}</td>
                        <td>${tag(ev.status === "SUCCESS" ? T.ok : `${T.failed} · ${ev.status}`, ev.status !== "SUCCESS")}</td>
                        <td class="av-sub">${esc(bt(ev.details) || "")}${ev.justification ? ` [${T.justification}: ${esc(ev.justification)}]` : ""}</td>
                      </tr>`
                    )
                    .join("")}</tbody></table></div>`
              : `<p class="av-mx-empty">${T.auditEmpty}</p>`
          }
        </section>
      </div>

      <aside class="av-mx-side">
        <section class="av-panel" aria-labelledby="av-ad-create-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-ad-create-h">${T.createTitle}</h2></div>
          <form class="av-mx-form av-mx-pad" id="av-ad-create" autocomplete="off">
            <div class="av-field"><label for="av-ad-code">${T.crewCode}</label><input class="av-input" type="text" id="av-ad-code" placeholder="${esc(T.crewCodePlaceholder)}" required /></div>
            <div class="av-field"><label for="av-ad-name">${T.fullName}</label><input class="av-input" type="text" id="av-ad-name" placeholder="${esc(T.fullNamePlaceholder)}" required /></div>
            <div class="av-field"><label for="av-ad-email">${T.email}</label><input class="av-input" type="email" id="av-ad-email" placeholder="${esc(T.emailPlaceholder)}" required /></div>
            <div class="av-field"><label for="av-ad-pass">${T.password}</label><input class="av-input" type="password" id="av-ad-pass" autocomplete="new-password" required /></div>
            <div class="av-field"><label for="av-ad-role">${T.role}</label><select class="av-input" id="av-ad-role">${roleOptions(["ASTRONAUT", "MISSION_LEADER", "ADMINISTRATOR"])}</select></div>
            <div><button type="submit" class="av-btn av-btn-primary">${T.create}</button></div>
          </form>
        </section>
        <section class="av-panel" aria-labelledby="av-ad-assign-h">
          <div class="av-panel-head"><h2 class="av-h2" id="av-ad-assign-h">${T.assignTitle}</h2></div>
          <form class="av-mx-form av-mx-pad" id="av-ad-assign">
            <div class="av-field"><label for="av-ad-mission">${T.mission}</label><select class="av-input" id="av-ad-mission">${missions.map((m) => `<option value="${esc(m.id)}">${esc(m.code)} — ${esc(bt(m.name))}</option>`).join("")}</select></div>
            <div class="av-field"><label for="av-ad-user">${T.user}</label><select class="av-input" id="av-ad-user">${users.map((u) => `<option value="${esc(u.id)}">${esc(u.full_name)} · ${esc(roleLbl(u.role_code))}</option>`).join("")}</select></div>
            <div class="av-field"><label for="av-ad-mrole">${T.missionRole}</label><select class="av-input" id="av-ad-mrole">${roleOptions(["ASTRONAUT", "MISSION_LEADER"])}</select></div>
            <div><button type="submit" class="av-btn av-btn-primary">${T.assign}</button></div>
          </form>
        </section>
      </aside>
    </div></div>`;

  const root = container.querySelector(".av-ad-root");
  if (snap) restoreFields(root.querySelector(".av-mx-side"), snap);
  const status = root.querySelector("#av-ad-status");
  const say = (text) => {
    status.style.margin = "12px";
    status.textContent = text;
    status.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  /* Ejecuta una acción administrativa: bloquea el botón, informa el resultado y recarga */
  const run = async (btn, fn, okText) => {
    btn.disabled = true;
    say(T.working);
    try {
      await fn();
      ui.result = okText;
      helpers.showToast?.(okText());
      await again();
    } catch (err) {
      btn.disabled = false;
      say(fmtT(T.actionError, { msg: errMsg(err) }));
    }
  };

  root.querySelector("#av-ad-create").addEventListener("submit", (e) => {
    e.preventDefault();
    run(
      e.target.querySelector('button[type="submit"]'),
      async () => {
        await apiService.createUser({
          crew_code: root.querySelector("#av-ad-code").value.trim(),
          full_name: root.querySelector("#av-ad-name").value.trim(),
          email: root.querySelector("#av-ad-email").value.trim(),
          password: root.querySelector("#av-ad-pass").value,
          role_code: root.querySelector("#av-ad-role").value,
        });
        // el selector de tripulante del encabezado debe incluir la cuenta nueva
        appState.usersList = (await apiService.getUsers()).users || appState.usersList;
        helpers.updateRoleNavigation?.();
      },
      msg("created")
    );
  });

  root.querySelector("#av-ad-assign").addEventListener("submit", (e) => {
    e.preventDefault();
    run(
      e.target.querySelector('button[type="submit"]'),
      () =>
        apiService.assignUserToMission(
          root.querySelector("#av-ad-mission").value,
          root.querySelector("#av-ad-user").value,
          root.querySelector("#av-ad-mrole").value
        ),
      msg("assigned")
    );
  });

  root.querySelectorAll("[data-ad-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = btn.getAttribute("data-ad-toggle");
      const next = btn.getAttribute("data-ad-status") === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
      run(btn, () => apiService.updateUserStatus(uid, next, T.statusReason), () => fmtT(tr(DICT).statusChanged, { id: uid, status: tr(DICT).statuses[next] }));
    });
  });
}
