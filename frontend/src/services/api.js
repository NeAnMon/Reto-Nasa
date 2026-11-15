/**
 * SEMSA Frontend API Service & Offline Queue Manager
 */
const STORAGE_TOKEN_KEY = "semsa_session_token";
const STORAGE_CSRF_KEY = "semsa_csrf_token";
const STORAGE_OFFLINE_QUEUE_KEY = "semsa_offline_queue";

/* Cambio de nombre de la app a SEMSA (issue #14): se trasladan una sola vez las claves antiguas
 * de la marca anterior para no cerrar la sesión ni perder la cola sin enlace de quien ya usaba la app. */
(function migrateLegacyStorageKeys() {
  const pairs = [
    [STORAGE_TOKEN_KEY, "astrovital_session_token"],
    [STORAGE_CSRF_KEY, "astrovital_csrf_token"],
    [STORAGE_OFFLINE_QUEUE_KEY, "astrovital_offline_queue"],
  ];
  for (const name of ["localStorage", "sessionStorage"]) {
    for (const [key, legacy] of pairs) {
      try {
        const store = globalThis[name];
        if (!store) break;
        const old = store.getItem(legacy);
        if (old !== null && store.getItem(key) === null) store.setItem(key, old);
        if (old !== null) store.removeItem(legacy);
      } catch {
        /* almacenamiento no disponible (modo privado, cuota): se ignora */
      }
    }
  }
})();

/**
 * Convierte el cuerpo de error de la API en un texto legible.
 * - FastAPI (HTTPException): { detail: "texto" }.
 * - Validación (422): { detail: [{ loc: ["body", "minutes"], msg: "...", ... }, ...] }.
 * - Otros: { detail: { message | msg } } o { message }.
 * Nunca devuelve "[object Object]": si no hay texto utilizable, devuelve el respaldo.
 */
export function errorDetailText(data, fallback) {
  const itemText = (it) => {
    if (it === null || it === undefined) return "";
    if (typeof it === "string") return it.trim();
    if (typeof it === "number" || typeof it === "boolean") return String(it);
    if (typeof it !== "object") return "";
    const msg = typeof it.msg === "string" ? it.msg : typeof it.message === "string" ? it.message : "";
    if (!msg) return "";
    const loc = Array.isArray(it.loc) ? it.loc.filter((p) => p !== "body" && p !== "query" && p !== "path") : [];
    const field = loc.length ? String(loc[loc.length - 1]) : "";
    return field ? `${field}: ${msg.trim()}` : msg.trim();
  };
  const fromDetail = (d) => {
    if (Array.isArray(d)) {
      return [...new Set(d.map(itemText).filter(Boolean))].join(" · ");
    }
    return itemText(d);
  };
  if (!data || typeof data !== "object") return itemText(data) || fallback;
  return fromDetail(data.detail) || itemText(data.message) || fallback;
}

export const apiService = {
  simulatedOfflineMode: false,

  getToken() {
    return sessionStorage.getItem(STORAGE_TOKEN_KEY) || localStorage.getItem(STORAGE_TOKEN_KEY);
  },

  setSession(token, csrfToken) {
    sessionStorage.setItem(STORAGE_TOKEN_KEY, token);
    localStorage.setItem(STORAGE_TOKEN_KEY, token);
    if (csrfToken) {
      sessionStorage.setItem(STORAGE_CSRF_KEY, csrfToken);
    }
  },

  clearSession() {
    sessionStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    sessionStorage.removeItem(STORAGE_CSRF_KEY);
    this.queueOwnerId = null;
  },

  /* ── Cola sin enlace, por persona usuaria ──────────────────────────────
   * Todos los elementos llevan owner_id. Cada sesión solo ve, guarda y transmite los suyos;
   * los de otra persona en el mismo terminal se conservan intactos para cuando vuelva a entrar.
   * Los elementos antiguos sin owner_id no se transmiten nunca (no se sabe de quién son). */
  queueOwnerId: null,

  setQueueOwner(userId) {
    this.queueOwnerId = userId ?? null;
  },

  _readAllQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(STORAGE_OFFLINE_QUEUE_KEY) || "[]");
      return Array.isArray(q) ? q : [];
    } catch {
      return [];
    }
  },

  _isMine(item) {
    return !!item && this.queueOwnerId != null && item.owner_id === this.queueOwnerId;
  },

  getOfflineQueue() {
    return this._readAllQueue().filter((x) => this._isMine(x));
  },

  saveOfflineQueue(queue) {
    // Reemplaza solo los elementos propios; los de otras personas no se tocan
    const others = this._readAllQueue().filter((x) => !this._isMine(x));
    const mine = (queue || []).filter((x) => this._isMine(x));
    localStorage.setItem(STORAGE_OFFLINE_QUEUE_KEY, JSON.stringify([...others, ...mine]));
  },

  enqueueOfflineItem(item) {
    if (this.queueOwnerId == null) throw new Error("No hay sesión activa para encolar el registro.");
    const queue = this.getOfflineQueue();
    const dedupKey = item.dedup_key || `OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const exists = queue.some((x) => x.dedup_key === dedupKey);
    if (!exists) {
      queue.push({ ...item, owner_id: this.queueOwnerId, dedup_key: dedupKey, queued_at: new Date().toISOString() });
      this.saveOfflineQueue(queue);
    }
    return queue.length;
  },

  async flushOfflineQueue() {
    const queue = this.getOfflineQueue();
    if (!queue.length || this.simulatedOfflineMode) {
      return { synced: 0, remaining: queue.length, rejected: [], rejected_count: 0 };
    }
    const done = new Set();
    let synced = 0;
    // Elementos descartados por rechazo definitivo: [{ type, preview, reason }]
    const rejected = [];
    const MSG_ENDPOINT = /^\/conversations\/[^/]+\/messages$/;
    const typeOf = (endpoint) => {
      if (MSG_ENDPOINT.test(endpoint || "")) return "MESSAGE";
      if (endpoint === "/wellness/quick-checkin") return "QUICK_CHECKIN";
      return String(endpoint || "UNKNOWN");
    };
    for (const item of queue) {
      try {
        await this.request(item.endpoint, {
          method: "POST",
          body: JSON.stringify({ ...item.payload, dedup_key: item.dedup_key }),
        });
        synced += 1;
        done.add(item.dedup_key);
      } catch (err) {
        // Rechazo definitivo del servidor (4xx salvo 408/429): reintentar no sirve, se descarta
        const st = err && err.status;
        if (st >= 400 && st < 500 && st !== 408 && st !== 429) {
          const payload = (item && item.payload) || {};
          rejected.push({
            type: typeOf(item.endpoint),
            preview: typeof payload.content === "string" ? payload.content.trim().slice(0, 60) : "",
            reason: (err && err.message) || `Error HTTP ${st}`,
          });
          done.add(item.dedup_key);
        }
      }
    }
    // Relee la cola: conserva lo que se haya encolado mientras se transmitía
    const remaining = this.getOfflineQueue().filter((x) => !done.has(x.dedup_key));
    this.saveOfflineQueue(remaining);
    return { synced, remaining: remaining.length, rejected, rejected_count: rejected.length };
  },

  async request(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const csrf = sessionStorage.getItem(STORAGE_CSRF_KEY);
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }

    const response = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && path !== "/auth/login") {
      this.clearSession();
      window.dispatchEvent(new CustomEvent("semsa:unauthorized"));
      throw new Error("Sesión expirada o no autorizada.");
    }

    if (!response.ok) {
      let errMsg = `Error HTTP ${response.status}`;
      let errDetail;
      try {
        const errData = await response.json();
        errDetail = errData && typeof errData === "object" ? errData.detail : undefined;
        // 422 de validación: detail es una LISTA de objetos → texto legible (nunca "[object Object]")
        errMsg = errorDetailText(errData, errMsg);
      } catch {
        // ignore JSON parse error
      }
      const err = new Error(errMsg);
      err.status = response.status;
      if (errDetail !== undefined) err.detail = errDetail; // cuerpo original (p. ej. lista de validación)
      throw err;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return await response.blob();
  },

  login(email, password) {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  logout() {
    return this.request("/auth/logout", { method: "POST" });
  },

  getMe() {
    return this.request("/auth/me");
  },

  requestPasswordRecovery(email) {
    return this.request("/auth/password-recovery/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  confirmPasswordRecovery(email, recovery_token, new_password) {
    return this.request("/auth/password-recovery/reset", {
      method: "POST",
      body: JSON.stringify({ email, recovery_token, new_password }),
    });
  },

  getHealthSummary(astronautId = null, missionId = null) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (missionId) params.set("mission_id", missionId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/health/summary${qs}`);
  },

  getHealthIndicators() {
    return this.request("/health/indicators");
  },

  getBodyRegions(astronautId = null, missionId = null) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (missionId) params.set("mission_id", missionId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/health/body-regions${qs}`);
  },

  createMeasurement(payload) {
    if (this.simulatedOfflineMode) {
      const count = this.enqueueOfflineItem({
        endpoint: "/health/measurements",
        payload,
      });
      return Promise.resolve({
        queued_offline: true,
        queue_size: count,
        message: "Sin conexión: medición guardada de forma segura en la cola local para sincronización diferida.",
      });
    }
    return this.request("/health/measurements", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  importMeasurements(payload) {
    return this.request("/health/measurements/import", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  explainIndicator(indicatorCode, astronautId = null, missionId = null) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (missionId) params.set("mission_id", missionId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/health/explain/${indicatorCode}${qs}`);
  },

  getEnvironmentProfiles() {
    return this.request("/environment/profiles");
  },

  updateMissionContext(missionId, payload) {
    return this.request(`/missions/${missionId}/context`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getAlerts(astronautId = null, statusFilter = null) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (statusFilter) params.set("status_filter", statusFilter);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/alerts${qs}`);
  },

  acknowledgeAlert(alertId, actionTaken) {
    return this.request(`/alerts/${alertId}/acknowledge`, {
      method: "POST",
      body: JSON.stringify({ action_taken: actionTaken }),
    });
  },

  followupAlert(alertId, actionType, notes) {
    return this.request(`/alerts/${alertId}/followup`, {
      method: "POST",
      body: JSON.stringify({ action_type: actionType, notes }),
    });
  },

  escalateAlert(alertId, notes) {
    return this.request(`/alerts/${alertId}/escalate`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    });
  },

  getWellnessInstruments() {
    return this.request("/wellness/instruments");
  },

  getWellnessAssessments(astronautId = null, includePrivate = false, justification = null) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (includePrivate) params.set("include_private_details", "true");
    if (justification) params.set("audit_justification", justification);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/wellness/assessments${qs}`);
  },

  createWellnessAssessment(payload) {
    return this.request("/wellness/assessments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getWellnessRecommendations(astronautId = null, wellnessState = "WELLNESS_STABLE") {
    const params = new URLSearchParams({ wellness_state: wellnessState });
    if (astronautId) params.set("astronaut_id", astronautId);
    return this.request(`/wellness/recommendations?${params.toString()}`);
  },

  getGamificationProfile(astronautId = null) {
    const qs = astronautId ? `?astronaut_id=${astronautId}` : "";
    return this.request(`/gamification/profile${qs}`);
  },

  getDailyMissions(astronautId = null) {
    const qs = astronautId ? `?astronaut_id=${astronautId}` : "";
    return this.request(`/gamification/missions${qs}`);
  },

  completeDailyMission(dailyMissionCode, statusMode = "COMPLETED", reflectionNote = "") {
    if (this.simulatedOfflineMode) {
      const count = this.enqueueOfflineItem({
        endpoint: "/gamification/missions/complete",
        payload: {
          daily_mission_code: dailyMissionCode,
          status_mode: statusMode,
          reflection_note: reflectionNote,
          is_simulated: true,
        },
      });
      return Promise.resolve({
        queued_offline: true,
        queue_size: count,
        reinforcement_message: "Sin conexión: misión guardada en cola local para sincronización segura.",
      });
    }
    return this.request("/gamification/missions/complete", {
      method: "POST",
      body: JSON.stringify({
        daily_mission_code: dailyMissionCode,
        status_mode: statusMode,
        reflection_note: reflectionNote,
        is_simulated: true,
      }),
    });
  },

  getAnalyticsTimeseries(paramsObj) {
    const params = new URLSearchParams();
    Object.entries(paramsObj).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") params.set(k, v);
    });
    return this.request(`/analytics/timeseries?${params.toString()}`);
  },

  getPhaseComparison(astronautId, missionId, indicatorCode) {
    const params = new URLSearchParams({ indicator_code: indicatorCode });
    if (astronautId) params.set("astronaut_id", astronautId);
    if (missionId) params.set("mission_id", missionId);
    return this.request(`/analytics/phase-comparison?${params.toString()}`);
  },

  async downloadReport(astronautId, missionId, format, justification) {
    const blob = await this.request("/reports/export", {
      method: "POST",
      body: JSON.stringify({
        astronaut_id: Number(astronautId),
        mission_id: missionId ? Number(missionId) : null,
        report_format: format,
        include_simulated: true,
        justification: justification || "Exportación operativa autorizada",
      }),
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `semsa_report_${astronautId}.${format.toLowerCase()}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getSimulatorScenarios() {
    return this.request("/simulator/scenarios");
  },

  runSimulatorScenario(scenarioCode, astronautId, missionId, environmentCode) {
    return this.request("/simulator/run", {
      method: "POST",
      body: JSON.stringify({
        scenario_code: scenarioCode,
        astronaut_id: astronautId ? Number(astronautId) : null,
        mission_id: missionId ? Number(missionId) : null,
        environment_code: environmentCode || null,
      }),
    });
  },

  resetSimulator() {
    return this.request("/simulator/reset", { method: "POST" });
  },

  getUsers() {
    return this.request("/users");
  },

  createUser(payload) {
    return this.request("/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateUserStatus(userId, status, reason) {
    return this.request(`/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  },

  updateUserRole(userId, roleCode, reason) {
    return this.request(`/users/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role_code: roleCode, reason }),
    });
  },

  updateUserProfile(userId, payload) {
    return this.request(`/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  getMissions() {
    return this.request("/missions");
  },

  createMission(payload) {
    return this.request("/missions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  assignUserToMission(missionId, userId, assignmentRole) {
    return this.request(`/missions/${missionId}/assignments`, {
      method: "POST",
      body: JSON.stringify({ user_id: Number(userId), assignment_role: assignmentRole }),
    });
  },

  getAdminRules() {
    return this.request("/admin/rules");
  },

  createRuleVersion(ruleId, payload) {
    return this.request(`/admin/rules/${ruleId}/versions`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getSystemStatus() {
    return this.request("/admin/system-status");
  },

  getAuditEvents() {
    return this.request("/audit/events");
  },

  // =========================================================================
  // MODULE 1: COMMUNICATION CENTER API METHODS
  // =========================================================================
  getConversations(paramsObj = {}) {
    const params = new URLSearchParams();
    Object.entries(paramsObj).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") params.set(k, v);
    });
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/conversations${qs}`);
  },

  createOrGetConversation(payload) {
    return this.request("/conversations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getConversationMessages(conversationId, paramsObj = {}) {
    const params = new URLSearchParams();
    Object.entries(paramsObj).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") params.set(k, v);
    });
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/conversations/${conversationId}/messages${qs}`);
  },

  sendMessage(conversationId, payload) {
    if (this.simulatedOfflineMode) {
      const dedupKey = `MSG-OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const count = this.enqueueOfflineItem({
        endpoint: `/conversations/${conversationId}/messages`,
        dedup_key: dedupKey,
        payload,
      });
      return Promise.resolve({
        queued_offline: true,
        server_confirmed_delivery: false,
        queue_size: count,
        message: {
          id: `temp-${Date.now()}`,
          conversation_id: conversationId,
          content: payload.content,
          category: payload.category || "GENERAL",
          delivery_status: "PENDING_OFFLINE_SYNC",
          is_important: Boolean(payload.is_important),
          created_at: new Date().toISOString(),
        },
        notice: "Sin conexión: mensaje conservado temporalmente en cola local segura (NO marcado como entregado hasta confirmación del servidor).",
      });
    }
    return this.request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  markMessageRead(messageId) {
    return this.request(`/messages/${messageId}/read`, { method: "PATCH" });
  },

  updateMessageFlags(messageId, payload) {
    return this.request(`/messages/${messageId}/flags`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  createSupportRequest(payload) {
    return this.request("/support-requests", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getSupportRequests(missionId = null, statusFilter = null) {
    const params = new URLSearchParams();
    if (missionId) params.set("mission_id", missionId);
    if (statusFilter) params.set("status_filter", statusFilter);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/support-requests${qs}`);
  },

  updateSupportRequestStatus(requestId, status, leaderResponseNotes = "") {
    return this.request(`/support-requests/${requestId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, leader_response_notes: leaderResponseNotes }),
    });
  },

  // =========================================================================
  // MODULE 2: COGNITIVE ASSESSMENT CENTER API METHODS
  // =========================================================================
  getCognitiveDomains() {
    return this.request("/cognitive/domains");
  },

  getCognitiveTests(domainCode = null) {
    const qs = domainCode ? `?domain_code=${domainCode}` : "";
    return this.request(`/cognitive/tests${qs}`);
  },

  getCognitiveTestDetail(testIdentifier, difficulty = "INTERMEDIATE") {
    return this.request(`/cognitive/tests/${testIdentifier}?difficulty=${difficulty}`);
  },

  startCognitiveAssessment(payload) {
    return this.request("/cognitive/assessments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getCognitiveAssessments(paramsObj = {}) {
    const params = new URLSearchParams();
    Object.entries(paramsObj).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") params.set(k, v);
    });
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/cognitive/assessments${qs}`);
  },

  submitCognitiveResponses(assessmentId, payload) {
    return this.request(`/cognitive/assessments/${assessmentId}/responses`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  completeCognitiveAssessment(assessmentId, payload) {
    return this.request(`/cognitive/assessments/${assessmentId}/complete`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  postponeCognitiveAssessment(assessmentId, postponeReason) {
    return this.request(`/cognitive/assessments/${assessmentId}/postpone`, {
      method: "POST",
      body: JSON.stringify({ postpone_reason: postponeReason }),
    });
  },

  getCognitiveHistory(astronautId = null, domainCode = null, difficulty = null) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (domainCode) params.set("domain_code", domainCode);
    if (difficulty) params.set("difficulty", difficulty);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/cognitive/history${qs}`);
  },

  getCognitiveAnalytics(astronautId = null, missionId = null, domainCode = null) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (missionId) params.set("mission_id", missionId);
    if (domainCode) params.set("domain_code", domainCode);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/cognitive/analytics${qs}`);
  },

  getCognitiveSchedules(astronautId = null, missionId = null) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (missionId) params.set("mission_id", missionId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/cognitive/schedules${qs}`);
  },

  createCognitiveSchedule(payload) {
    return this.request("/cognitive/schedules", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // =========================================================================
  // MODULE 3: EMOTIONAL ASSESSMENT CENTER API METHODS
  // =========================================================================
  getEmotionalQuestionnaires() {
    return this.request("/emotional-assessments/questionnaires");
  },

  createEmotionalRequests(payload) {
    return this.request("/emotional-assessments/requests", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getEmotionalRequests(paramsObj = {}) {
    const params = new URLSearchParams();
    Object.entries(paramsObj).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") params.set(k, v);
    });
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/emotional-assessments/requests${qs}`);
  },

  getMyEmotionalRequests(statusFilter = null) {
    const qs = statusFilter ? `?status_filter=${statusFilter}` : "";
    return this.request(`/emotional-assessments/my-requests${qs}`);
  },

  getMyEmotionalRequestDetail(requestId) {
    return this.request(`/emotional-assessments/my-requests/${requestId}`);
  },

  patchEmotionalRequest(requestId, payload) {
    return this.request(`/emotional-assessments/requests/${requestId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  sendOrRemindEmotionalRequest(requestId) {
    return this.request(`/emotional-assessments/requests/${requestId}/send`, {
      method: "POST",
    });
  },

  cancelEmotionalRequest(requestId) {
    return this.request(`/emotional-assessments/requests/${requestId}/cancel`, {
      method: "POST",
    });
  },

  startEmotionalAssessment(requestId) {
    return this.request(`/emotional-assessments/${requestId}/start`, {
      method: "POST",
    });
  },

  saveEmotionalResponses(assessmentId, payload) {
    return this.request(`/emotional-assessments/${assessmentId}/responses`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  completeEmotionalAssessment(assessmentId, payload) {
    return this.request(`/emotional-assessments/${assessmentId}/complete`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getEmotionalFollowUps(requestId = null, astronautId = null) {
    const params = new URLSearchParams();
    if (requestId) params.set("request_id", requestId);
    if (astronautId) params.set("astronaut_id", astronautId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/emotional-assessments/follow-ups${qs}`);
  },

  createEmotionalFollowUp(payload) {
    return this.request("/emotional-assessments/follow-ups", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getExpansionAnalyticsOverview(astronautId = null, missionId = null) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (missionId) params.set("mission_id", missionId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/analytics/expansion-overview${qs}`);
  },

  /* ── Bienestar: check-in rápido, tiempo libre, tripulación ── */
  // Contrato: docs/CONTRATO_AISLAMIENTO.md §1–3
  getQuickCheckins(astronautId = null, limit = 14) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (limit) params.set("limit", limit);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/wellness/quick-checkin${qs}`);
  },

  /* Sin enlace (simulado): el check-in va a la cola local y se envía al reconectar.
     Si el payload trae dedup_key (una por envío del formulario), la cola reutiliza esa misma
     clave: el backend devuelve el registro existente si llega dos veces. */
  createQuickCheckin(payload) {
    if (this.simulatedOfflineMode) {
      const count = this.enqueueOfflineItem({
        endpoint: "/wellness/quick-checkin",
        payload,
        ...(payload && payload.dedup_key ? { dedup_key: payload.dedup_key } : {}),
      });
      return Promise.resolve({ queued_offline: true, queue_size: count });
    }
    return this.request("/wellness/quick-checkin", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getLeisureActivities({ maxMinutes = null, category = null } = {}) {
    const params = new URLSearchParams();
    if (maxMinutes) params.set("max_minutes", maxMinutes);
    if (category) params.set("category", category);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/wellness/leisure${qs}`);
  },

  logLeisureActivity(code, payload) {
    return this.request(`/wellness/leisure/${encodeURIComponent(code)}/log`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getLeisureLog(astronautId = null, limit = 20) {
    const params = new URLSearchParams();
    if (astronautId) params.set("astronaut_id", astronautId);
    if (limit) params.set("limit", limit);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/wellness/leisure/log${qs}`);
  },

  getCrewActivityCatalog() {
    return this.request("/crew-activities/catalog");
  },

  getCrewActivities({ missionId = null, status = null } = {}) {
    const params = new URLSearchParams();
    if (missionId) params.set("mission_id", missionId);
    if (status) params.set("status", status);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/crew-activities${qs}`);
  },

  createCrewActivity(payload) {
    return this.request("/crew-activities", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  respondCrewActivity(activityId, response) {
    return this.request(`/crew-activities/${encodeURIComponent(activityId)}/respond`, {
      method: "POST",
      body: JSON.stringify({ response }),
    });
  },

  attendCrewActivity(activityId) {
    return this.request(`/crew-activities/${encodeURIComponent(activityId)}/attend`, { method: "POST" });
  },

  cancelCrewActivity(activityId) {
    return this.request(`/crew-activities/${encodeURIComponent(activityId)}/cancel`, { method: "POST" });
  },
};

