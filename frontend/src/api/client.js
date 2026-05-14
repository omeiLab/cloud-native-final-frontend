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

const ACCESS_TOKEN_KEY = 'cets_access_token';
const REFRESH_TOKEN_KEY = 'cets_refresh_token';
const USER_ROLE_KEY = 'cets_role_hint';
const AUTH_PROVIDER_KEY = 'cets_auth_provider';

const getStorage = (name) => {
  try {
    if (typeof window !== 'undefined' && window[name]) {
      return window[name];
    }
    if (typeof globalThis !== 'undefined' && globalThis[name]) {
      return globalThis[name];
    }
  } catch {
    return null;
  }
  return null;
};

const safeStorageGet = (storage, key) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const safeStorageSet = (storage, key, value) => {
  try {
    storage?.setItem(key, value);
  } catch {
    // Ignore unavailable browser storage.
  }
};

const safeStorageRemove = (storage, key) => {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignore unavailable browser storage.
  }
};

const getRefreshTokenStorage = () => getStorage('sessionStorage') || getStorage('localStorage');

const shouldAttemptRefresh = (url = '') => (
  !url.includes('/auth/refresh') &&
  !url.includes('/auth/oidc/authorize-url') &&
  !url.includes('/auth/oidc/callback')
);

class APIClient {
  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.accessToken = null;
    this.refreshPromise = null;
    safeStorageRemove(getStorage('localStorage'), ACCESS_TOKEN_KEY);

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

        if (error.response?.status === 401 && !original._retry && shouldAttemptRefresh(original.url) && this.getRefreshToken()) {
          original._retry = true;
          try {
            const refreshed = await this.refresh();
            const nextToken = refreshed.data.access_token;
            original.headers = original.headers || {};
            original.headers.Authorization = `Bearer ${nextToken}`;
            return this.client(original);
          } catch (refreshError) {
            this.clearAuth();
            throw refreshError;
          }
        }

        throw normalizeError(error);
      }
    );
  }

  getAccessToken() {
    return this.accessToken;
  }

  getRefreshToken() {
    return safeStorageGet(getRefreshTokenStorage(), REFRESH_TOKEN_KEY);
  }

  getRoleHint() {
    return safeStorageGet(getStorage('localStorage'), USER_ROLE_KEY);
  }

  setAccessToken(token) {
    this.accessToken = token || null;
    if (!token) {
      delete this.client.defaults.headers.common.Authorization;
      safeStorageRemove(getStorage('localStorage'), ACCESS_TOKEN_KEY);
      return;
    }
    this.client.defaults.headers.common.Authorization = `Bearer ${token}`;
    safeStorageRemove(getStorage('localStorage'), ACCESS_TOKEN_KEY);
  }

  setRefreshToken(token) {
    const storage = getRefreshTokenStorage();
    const localStorageRef = getStorage('localStorage');
    if (!token) {
      safeStorageRemove(storage, REFRESH_TOKEN_KEY);
      safeStorageRemove(localStorageRef, REFRESH_TOKEN_KEY);
      return;
    }
    safeStorageSet(storage, REFRESH_TOKEN_KEY, token);
    if (storage !== localStorageRef) {
      safeStorageRemove(localStorageRef, REFRESH_TOKEN_KEY);
    }
  }

  setAuthTokens({ access_token, refresh_token }) {
    this.setAccessToken(access_token);
    this.setRefreshToken(refresh_token);
    safeStorageSet(getStorage('localStorage'), AUTH_PROVIDER_KEY, 'OIDC');
  }

  clearAuth() {
    this.setAccessToken(null);
    this.setRefreshToken(null);
    safeStorageRemove(getStorage('localStorage'), USER_ROLE_KEY);
    safeStorageRemove(getStorage('localStorage'), AUTH_PROVIDER_KEY);
  }

  getAuthProvider() {
    return safeStorageGet(getStorage('localStorage'), AUTH_PROVIDER_KEY) || 'JWT';
  }

  async getOIDCAuthorizeUrl({ redirectUri } = {}) {
    return this.client.get('/auth/oidc/authorize-url', {
      params: redirectUri ? { redirect_uri: redirectUri } : undefined
    });
  }

  async oidcCallback(payload) {
    return this.client.post('/auth/oidc/callback', payload);
  }

  async refresh(refreshToken = this.getRefreshToken()) {
    if (!refreshToken) {
      throw {
        httpStatus: 401,
        error: {
          code: 'REFRESH_TOKEN_INVALID',
          message: 'Refresh token 無效或已撤銷',
          details: {}
        }
      };
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.client.post('/auth/refresh', { refresh_token: refreshToken })
        .then((res) => {
          this.setAuthTokens(res.data);
          return res;
        })
        .catch((error) => {
          this.clearAuth();
          throw error;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    return this.refreshPromise;
  }

  async getMe() {
    return this.client.get('/auth/me');
  }

  async getMyDependents() {
    return this.client.get('/me/dependents');
  }

  async logout() {
    const refreshToken = this.getRefreshToken();
    const res = await this.client.post('/auth/logout', refreshToken ? { refresh_token: refreshToken } : undefined);
    this.clearAuth();
    return res;
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
export { API_BASE_URL, WS_BASE_URL };
