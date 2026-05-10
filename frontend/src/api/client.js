import axios from 'axios';

const normalizeApiBase = (rawUrl) => {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
};

const resolveDefaultApiBase = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return normalizeApiBase(import.meta.env.VITE_API_BASE_URL);
  }
  // 统一走公网，避免误连本机后端。
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return 'https://cets.alanh.uk/api/v1';
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/v1`;
  }
  return 'https://cets.alanh.uk/api/v1';
};

const resolveWsBase = (apiBaseUrl) => {
  if (import.meta.env.VITE_WS_BASE_URL) {
    return String(import.meta.env.VITE_WS_BASE_URL).trim().replace(/\/+$/, '');
  }
  try {
    const api = new URL(apiBaseUrl);
    const wsProtocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${api.host}/ws`;
  } catch {
    return 'wss://cets.alanh.uk/ws';
  }
};

const API_BASE_URL = resolveDefaultApiBase();
const WS_BASE_URL = resolveWsBase(API_BASE_URL);

const normalizeSuccessPayload = (response) => {
  if (response?.config?.responseType === 'blob' || response?.config?.responseType === 'arraybuffer') {
    return response.data;
  }
  const payload = response?.data;
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'success')) {
    return payload;
  }
  return {
    success: true,
    data: payload
  };
};

const normalizeError = (error) => {
  const status = error?.response?.status;
  if (error?.response?.data !== undefined && error?.response?.data !== null) {
    const data = error.response.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { ...data, httpStatus: status };
    }
    if (typeof data === 'string') {
      return { detail: data, httpStatus: status };
    }
    return data;
  }
  if (error?.code === 'ERR_NETWORK') {
    return {
      error: {
        code: 'NETWORK_ERROR',
        message: '連線失敗，請確認前後端服務與網路設定'
      }
    };
  }
  return {
    error: {
      code: 'UNKNOWN_ERROR',
      message: error?.message || '發生未知錯誤'
    }
  };
};

const DEV_TOKENS = {
  EMPLOYEE:
    import.meta.env.VITE_EMPLOYEE_TOKEN ||
    'eyJhbGciOiJIUzI1NiIsImtpZCI6InYxIiwidHlwIjoiSldUIn0.eyJzdWIiOiIwMUUyRUVNUExPWUVFVFNNQ1JPTEVYWFhYWCIsInJvbGUiOiJFTVBMT1lFRSIsInNpdGUiOiJIU0lOQ0hVIiwiZW1wbG95ZWVfaWQiOiJFMkVFTVAwMSIsIm5hbWUiOiJlMmUtZW1wbG95ZWUiLCJpc3MiOiJodHRwczovL2NldHMuYWxhbmgudWsiLCJleHAiOjQxMDIzNTg0MDAsImlhdCI6MTc3NzkwMjE4NSwianRpIjoiZTJlLXBlcm0tZW1wbG95ZWUifQ.Bv-o08HsmkyPy8Q8wsL_lslylZmL4Rb7MQNvKLpxqMI',
  ADMIN:
    import.meta.env.VITE_ADMIN_TOKEN ||
    'eyJhbGciOiJIUzI1NiIsImtpZCI6InYxIiwidHlwIjoiSldUIn0.eyJzdWIiOiIwMUUyRUFETUlOVFNNQ1JPTEVYWFhYWFhYWCIsInJvbGUiOiJBRE1JTiIsInNpdGUiOiJIU0lOQ0hVIiwiZW1wbG95ZWVfaWQiOiJFMkVBRE0wMSIsIm5hbWUiOiJlMmUtYWRtaW4iLCJpc3MiOiJodHRwczovL2NldHMuYWxhbmgudWsiLCJleHAiOjQxMDIzNTg0MDAsImlhdCI6MTc3NzkwMjE4NSwianRpIjoiZTJlLXBlcm0tYWRtaW4ifQ.JFXKaGEj-iiyPhzeTG9HgxgBGu9dbNdS5ob4V67CDew',
  VERIFIER:
    import.meta.env.VITE_VERIFIER_TOKEN ||
    'eyJhbGciOiJIUzI1NiIsImtpZCI6InYxIiwidHlwIjoiSldUIn0.eyJzdWIiOiIwMUUyRVZFUklGSUVSVFNNQ1JPTEVYWFhYWCIsInJvbGUiOiJWRVJJRklFUiIsInNpdGUiOiJIU0lOQ0hVIiwiZW1wbG95ZWVfaWQiOiJFMkVWRlIwMSIsIm5hbWUiOiJlMmUtdmVyaWZpZXIiLCJpc3MiOiJodHRwczovL2NldHMuYWxhbmgudWsiLCJleHAiOjQxMDIzNTg0MDAsImlhdCI6MTc3NzkwMjE4NSwianRpIjoiZTJlLXBlcm0tdmVyaWZpZXIifQ.a93u8oTBIGajL1Pm2pPk2qWkRWXD8dUW497n9o5NuhI'
};

const ACCESS_TOKEN_KEY = 'cets_access_token';
const REFRESH_TOKEN_KEY = 'cets_refresh_token';
const USER_ROLE_KEY = 'cets_role_hint';
const AUTH_PROVIDER_KEY = 'cets_auth_provider';

class APIClient {
  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.isRefreshing = false;
    this.refreshWaitQueue = [];

    const storedToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (storedToken) {
      this.setAccessToken(storedToken);
    }

    this.client.interceptors.response.use(
      (response) => normalizeSuccessPayload(response),
      async (error) => {
        const original = error.config;
        if (!original) {
          throw error;
        }

        if (original.url?.includes('/auth/refresh')) {
          throw normalizeError(error);
        }

        if (error.response?.status === 401 && !original._retry && this.getRefreshToken()) {
          original._retry = true;

          if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
              this.refreshWaitQueue.push({ resolve, reject });
            }).then((token) => {
              original.headers.Authorization = `Bearer ${token}`;
              return this.client(original);
            });
          }

          this.isRefreshing = true;
          try {
            const refreshed = await this.refresh(this.getRefreshToken());
            const nextToken = refreshed.data.access_token;
            this.refreshWaitQueue.forEach((entry) => entry.resolve(nextToken));
            this.refreshWaitQueue = [];
            original.headers.Authorization = `Bearer ${nextToken}`;
            return this.client(original);
          } catch (refreshError) {
            this.refreshWaitQueue.forEach((entry) => entry.reject(refreshError));
            this.refreshWaitQueue = [];
            this.clearAuth();
            throw refreshError;
          } finally {
            this.isRefreshing = false;
          }
        }

        throw normalizeError(error);
      }
    );
  }

  getAccessToken() {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  getRefreshToken() {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  getRoleHint() {
    return localStorage.getItem(USER_ROLE_KEY);
  }

  setAccessToken(token) {
    if (!token) {
      delete this.client.defaults.headers.common.Authorization;
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      return;
    }
    this.client.defaults.headers.common.Authorization = `Bearer ${token}`;
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
  }

  setAuthTokens({ access_token, refresh_token }) {
    this.setAccessToken(access_token);
    if (refresh_token) {
      localStorage.setItem(REFRESH_TOKEN_KEY, refresh_token);
    }
  }

  clearAuth() {
    this.setAccessToken(null);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_ROLE_KEY);
    localStorage.removeItem(AUTH_PROVIDER_KEY);
  }

  switchDevRole(role) {
    const roleKey = role === 'FAMILY' ? 'EMPLOYEE' : role;
    const token = DEV_TOKENS[roleKey];
    if (!token) {
      return;
    }
    this.setAccessToken(token);
    localStorage.setItem(USER_ROLE_KEY, roleKey);
    localStorage.setItem(AUTH_PROVIDER_KEY, 'IDP_DEV');
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  setIdpAccessToken(token) {
    this.setAccessToken(token);
    localStorage.setItem(AUTH_PROVIDER_KEY, 'IDP');
  }

  getAuthProvider() {
    return localStorage.getItem(AUTH_PROVIDER_KEY) || 'JWT';
  }

  async getOIDCAuthorizeUrl() {
    return this.client.get('/auth/oidc/authorize-url');
  }

  async oidcCallback(payload) {
    return this.client.post('/auth/oidc/callback', payload);
  }

  async refresh(refreshToken) {
    const res = await this.client.post('/auth/refresh', { refresh_token: refreshToken });
    this.setAuthTokens(res.data);
    return res;
  }

  async getMe() {
    return this.client.get('/auth/me');
  }

  async getMyDependents() {
    return this.client.get('/me/dependents');
  }

  async logout() {
    const res = await this.client.post('/auth/logout');
    this.clearAuth();
    return res;
  }

  async register(payload) {
    return this.client.post('/auth/register', payload);
  }

  async login(payload) {
    return this.client.post('/auth/login', payload);
  }

  async getEvents(params = {}) {
    return this.client.get('/events', { params });
  }

  async getEvent(eventId) {
    return this.client.get(`/events/${eventId}`);
  }

  async createRegistration(payload) {
    return this.client.post('/registrations', payload);
  }

  /** 後端若支援：將已取消／棄權之報名改回有效並更新票種／眷屬 */
  async patchRegistration(registrationId, payload) {
    return this.client.patch(`/registrations/${registrationId}`, payload);
  }

  /** 後端若支援：同上，部分部署使用 subresource */
  async resumeRegistration(registrationId, payload) {
    return this.client.post(`/registrations/${registrationId}/resume`, payload);
  }

  async cancelRegistration(registrationId) {
    return this.client.delete(`/registrations/${registrationId}`);
  }

  async forfeitRegistration(registrationId) {
    return this.client.post(`/registrations/${registrationId}/forfeit`);
  }

  async confirmRegistration(registrationId) {
    return this.client.post(`/registrations/${registrationId}/confirm`);
  }

  async getMyRegistrations(params = {}) {
    return this.client.get('/me/registrations', { params });
  }

  async getMyTickets(params = {}) {
    return this.client.get('/me/tickets', { params });
  }

  async getTicketQR(ticketId) {
    return this.client.get(`/me/tickets/${ticketId}/qr`);
  }

  async verifyTicket(payload) {
    return this.client.post('/verify/ticket', payload);
  }

  async getNotifications(params = {}) {
    return this.client.get('/notifications', { params });
  }

  async getUnreadCount() {
    return this.client.get('/notifications/unread-count');
  }

  async markNotificationRead(notificationId) {
    return this.client.post(`/notifications/${notificationId}/read`);
  }

  async markAllRead() {
    return this.client.post('/notifications/mark-all-read');
  }

  async adminCreateEvent(payload) {
    return this.client.post('/admin/events', payload);
  }

  async adminPatchEvent(eventId, payload) {
    return this.client.patch(`/admin/events/${eventId}`, payload);
  }

  async adminCreateSession(eventId, payload) {
    return this.client.post(`/admin/events/${eventId}/sessions`, payload);
  }

  async adminCreateTicketType(sessionId, payload) {
    return this.client.post(`/admin/sessions/${sessionId}/ticket-types`, payload);
  }

  async adminPublishEvent(eventId) {
    return this.client.post(`/admin/events/${eventId}/publish`);
  }

  /**
   * OpenAPI（cets.alanh.uk）多半未公開手動抽籤路由，改由 lottery-runner／排程驅動。
   * 可選：VITE_ADMIN_LOTTERY_POST_URL=https://host/api/v1/path/{sessionId}?e={eventId}
   */
  async adminRunLottery(eventId, sessionId) {
    const tmpl = String(import.meta.env.VITE_ADMIN_LOTTERY_POST_URL || '').trim();
    const fromEnv = tmpl
      ? tmpl
          .replaceAll('{eventId}', eventId)
          .replaceAll('{sessionId}', sessionId)
          .replaceAll('{EVENT_ID}', eventId)
          .replaceAll('{SESSION_ID}', sessionId)
      : '';
    /** 相對路徑會接 baseURL；若為 https://… 開頭則視為絕對 URL */
    const relativeOrAbsolute = [...(fromEnv ? [fromEnv] : []),
      `/admin/events/${eventId}/sessions/${sessionId}/lottery`,
      `/admin/sessions/${sessionId}/lottery`
    ];

    let lastErr;
    for (let i = 0; i < relativeOrAbsolute.length; i += 1) {
      const target = relativeOrAbsolute[i];
      try {
        return await this.client.post(target);
      } catch (e) {
        lastErr = e;
        const st = e?.httpStatus;
        const detail = typeof e?.detail === 'string' ? e.detail : '';
        const msg = e?.error?.message || '';
        const isMissingRoute =
          st === 404 ||
          st === 405 ||
          /not found/i.test(detail) ||
          /not found/i.test(msg);
        const shouldTryNext = i < relativeOrAbsolute.length - 1 && isMissingRoute;
        if (shouldTryNext) {
          continue;
        }
        throw e;
      }
    }
    const tried = relativeOrAbsolute.join(', ');
    throw {
      httpStatus: 404,
      error: {
        code: 'LOTTERY_ENDPOINT_NOT_REGISTERED',
        message:
          `抽籤失敗：伺服器不存在已嘗試的抽籤端點（皆 404），已試：${tried}。請在後端實作手動抽籤 POST，或由 lottery-runner／排程觸發；也可於 .env 設定 VITE_ADMIN_LOTTERY_POST_URL 指向正確網址。`
      },
      detail: typeof lastErr?.detail === 'string' ? lastErr.detail : undefined
    };
  }

  async adminCancelEvent(eventId, reason) {
    return this.client.post(`/admin/events/${eventId}/cancel`, { reason });
  }

  async adminGetSiteEmployeeCount(sites = []) {
    return this.client.get('/admin/sites/employee-count', {
      params: {
        sites: sites.join(',')
      }
    });
  }

  async adminGetRegistrations(eventId, params = {}) {
    return this.client.get(`/admin/events/${eventId}/registrations`, { params });
  }

  async adminGetDashboard(eventId) {
    return this.client.get(`/admin/events/${eventId}/dashboard`);
  }

  async adminGetTimeOffset() {
    return this.client.get('/admin/system/time-offset');
  }

  async adminSetTimeOffset(minutes) {
    return this.client.post('/admin/system/time-offset', { minutes });
  }

  async adminRunNightlyLottery() {
    return this.client.post('/admin/ops/run-nightly-lottery');
  }

  async adminExportSync(eventId, params = {}) {
    return this.client.get(`/admin/events/${eventId}/export`, {
      params,
      responseType: 'blob'
    });
  }

  async adminExportAsync(eventId, params = {}) {
    return this.client.post(`/admin/events/${eventId}/export/async`, null, {
      params
    });
  }

  async adminGetExportTask(eventId, taskId) {
    return this.client.get(`/admin/events/${eventId}/export/tasks/${taskId}`);
  }

  async adminDownloadExportTask(eventId, taskId) {
    return this.client.get(`/admin/events/${eventId}/export/tasks/${taskId}/download`, {
      responseType: 'blob'
    });
  }

  buildExportDownloadUrl(eventId, taskId) {
    return `${API_BASE_URL}/admin/events/${eventId}/export/tasks/${taskId}/download`;
  }

  getWsUrl() {
    return WS_BASE_URL;
  }
}

export const apiClient = new APIClient();
export { DEV_TOKENS, API_BASE_URL, WS_BASE_URL };
