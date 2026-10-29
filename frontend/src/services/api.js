/**
 * AstroVital Frontend API Service & Offline Queue Manager
 */
const STORAGE_TOKEN_KEY = "astrovital_session_token";
const STORAGE_CSRF_KEY = "astrovital_csrf_token";
const STORAGE_OFFLINE_QUEUE_KEY = "astrovital_offline_queue";

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
  },

  getOfflineQueue() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_OFFLINE_QUEUE_KEY) || "[]");
    } catch {
      return [];
    }
  },

  saveOfflineQueue(queue) {
    localStorage.setItem(STORAGE_OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  },

  enqueueOfflineItem(item) {
    const queue = this.getOfflineQueue();
    const dedupKey = item.dedup_key || `OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const exists = queue.some((x) => x.dedup_key === dedupKey);
    if (!exists) {
      queue.push({ ...item, dedup_key: dedupKey, queued_at: new Date().toISOString() });
      this.saveOfflineQueue(queue);
    }
    return queue.length;
  },

  async flushOfflineQueue() {
    const queue = this.getOfflineQueue();
    if (!queue.length || this.simulatedOfflineMode) {
      return { synced: 0, remaining: queue.length };
    }
    const remaining = [];
    let synced = 0;
    for (const item of queue) {
      try {
        await this.request(item.endpoint, {
          method: "POST",
          body: JSON.stringify({ ...item.payload, dedup_key: item.dedup_key }),
        });
        synced += 1;
      } catch {
        remaining.push(item);
      }
    }
    this.saveOfflineQueue(remaining);
    return { synced, remaining: remaining.length };
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
      window.dispatchEvent(new CustomEvent("astrovital:unauthorized"));
      throw new Error("Sesión expirada o no autorizada.");
    }

    if (!response.ok) {
      let errMsg = `Error HTTP ${response.status}`;
      try {
        const errData = await response.json();
        errMsg = errData.detail || errData.message || errMsg;
      } catch {
        // ignore JSON parse error
      }
      throw new Error(errMsg);
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
    a.download = `astrovital_report_${astronautId}.${format.toLowerCase()}`;
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
};

