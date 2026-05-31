import { vi, describe, it, expect, beforeEach } from 'vitest';

const axiosMocks = vi.hoisted(() => {
  const responseHandlers = { success: null, error: null };
  const client = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    defaults: { headers: { common: {} } },
    interceptors: {
      response: {
        use: vi.fn((onSuccess, onError) => {
          responseHandlers.success = onSuccess;
          responseHandlers.error = onError;
        })
      }
    }
  };
  return { client, responseHandlers };
});

const storageMock = vi.hoisted(() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
});

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => axiosMocks.client)
  }
}));

const loadClientModule = async (env = {}) => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.stubEnv('VITE_WS_BASE_URL', '');
  vi.stubEnv('VITE_BASE_PATH', '');
  Object.entries(env).forEach(([key, value]) => vi.stubEnv(key, value));
  vi.stubGlobal('localStorage', storageMock);
  vi.stubGlobal('sessionStorage', storageMock);
  storageMock.clear();
  axiosMocks.client.get.mockReset();
  axiosMocks.client.post.mockReset();
  axiosMocks.client.delete.mockReset();
  axiosMocks.client.patch.mockReset();
  axiosMocks.client.interceptors.response.use.mockClear();
  axiosMocks.responseHandlers.success = null;
  axiosMocks.responseHandlers.error = null;
  return import('../client');
};

describe('api client configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes API and WS base URLs from env vars', async () => {
    const mod = await loadClientModule({
      VITE_API_BASE_URL: ' https://api.example.com/// ',
      VITE_WS_BASE_URL: 'wss://ws.example.com///'
    });
    expect(mod.API_BASE_URL).toBe('https://api.example.com');
    expect(mod.WS_BASE_URL).toBe('wss://ws.example.com');
  });

  it('derives websocket URL from API base when WS env is absent', async () => {
    const mod = await loadClientModule({
      VITE_API_BASE_URL: 'https://api.example.com'
    });
    expect(mod.WS_BASE_URL).toBe('wss://api.example.com/ws');
  });

  it('falls back to relative websocket path for invalid API base', async () => {
    const mod = await loadClientModule({
      VITE_API_BASE_URL: 'not-a-valid-url'
    });
    expect(mod.WS_BASE_URL).toBe('/ws');
  });
});

describe('apiClient auth helpers', () => {
  let apiClient;

  beforeEach(async () => {
    const mod = await loadClientModule();
    apiClient = mod.apiClient;
  });

  it('stores and clears access and refresh tokens', () => {
    apiClient.setAccessToken('access-1');
    expect(apiClient.getAccessToken()).toBe('access-1');
    expect(axiosMocks.client.defaults.headers.common.Authorization).toBe('Bearer access-1');

    apiClient.setRefreshToken('refresh-1');
    expect(apiClient.getRefreshToken()).toBe('refresh-1');

    apiClient.setAuthTokens({ access_token: 'access-2', refresh_token: 'refresh-2' });
    expect(apiClient.getAccessToken()).toBe('access-2');
    expect(apiClient.getRefreshToken()).toBe('refresh-2');
    expect(apiClient.getAuthProvider()).toBe('OIDC');

    apiClient.clearAuth();
    expect(apiClient.getAccessToken()).toBeNull();
    expect(apiClient.getRefreshToken()).toBeNull();
    expect(apiClient.getAuthProvider()).toBe('JWT');
  });

  it('rejects refresh when refresh token is missing', async () => {
    await expect(apiClient.refresh()).rejects.toMatchObject({
      httpStatus: 401,
      error: { code: 'REFRESH_TOKEN_INVALID' }
    });
  });

  it('refreshes tokens and reuses the in-flight refresh promise', async () => {
    apiClient.setRefreshToken('refresh-abc');
    axiosMocks.client.post.mockResolvedValue({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh'
      }
    });

    const [first, second] = await Promise.all([
      apiClient.refresh(),
      apiClient.refresh()
    ]);

    expect(first.data.access_token).toBe('new-access');
    expect(second.data.access_token).toBe('new-access');
    expect(axiosMocks.client.post).toHaveBeenCalledTimes(1);
    expect(apiClient.getAccessToken()).toBe('new-access');
  });

  it('clears auth when refresh fails', async () => {
    apiClient.setRefreshToken('refresh-bad');
    axiosMocks.client.post.mockRejectedValue(new Error('refresh failed'));

    await expect(apiClient.refresh()).rejects.toThrow('refresh failed');
    expect(apiClient.getRefreshToken()).toBeNull();
  });

  it('logs out and clears auth even when API call fails', async () => {
    apiClient.setRefreshToken('refresh-1');
    axiosMocks.client.post.mockRejectedValue(new Error('logout failed'));

    await expect(apiClient.logout()).rejects.toThrow('logout failed');
    expect(apiClient.getRefreshToken()).toBeNull();
  });
});

describe('apiClient response normalization', () => {
  beforeEach(async () => {
    await loadClientModule();
  });

  it('wraps plain payloads and preserves success envelopes', async () => {
    const { responseHandlers } = axiosMocks;
    expect(responseHandlers.success({ data: { ok: true } })).toEqual({
      success: true,
      data: { ok: true }
    });
    expect(responseHandlers.success({
      data: { success: false, error: { code: 'X' } }
    })).toEqual({
      success: false,
      error: { code: 'X' }
    });
    expect(responseHandlers.success({
      config: { responseType: 'blob' },
      data: 'blob-data'
    })).toBe('blob-data');
  });

  it('normalizes network and API errors from interceptors', async () => {
    const { responseHandlers } = axiosMocks;
    await expect(responseHandlers.error({ config: null })).rejects.toEqual({ config: null });

    await expect(responseHandlers.error({
      config: { url: '/auth/refresh' },
      response: { status: 401, data: { error: { code: 'REFRESH' } } }
    })).rejects.toMatchObject({ error: { code: 'REFRESH' }, httpStatus: 401 });

    await expect(responseHandlers.error({
      config: { url: '/events' },
      code: 'ERR_NETWORK'
    })).rejects.toMatchObject({
      error: { code: 'NETWORK_ERROR' }
    });

    await expect(responseHandlers.error({
      config: { url: '/events' },
      message: 'timeout'
    })).rejects.toMatchObject({
      error: { code: 'UNKNOWN_ERROR', message: 'timeout' }
    });
  });
});

describe('apiClient endpoint wrappers', () => {
  let apiClient;

  beforeEach(async () => {
    const mod = await loadClientModule({
      VITE_API_BASE_URL: 'https://api.example.com'
    });
    apiClient = mod.apiClient;
    axiosMocks.client.get.mockResolvedValue({ data: { success: true, data: {} } });
    axiosMocks.client.post.mockResolvedValue({ data: { success: true, data: {} } });
    axiosMocks.client.delete.mockResolvedValue({ data: { success: true, data: {} } });
    axiosMocks.client.patch.mockResolvedValue({ data: { success: true, data: {} } });
  });

  it('calls auth and profile endpoints', async () => {
    await apiClient.getOIDCAuthorizeUrl();
    await apiClient.getOIDCAuthorizeUrl({ redirectUri: 'http://localhost/callback' });
    await apiClient.oidcCallback({ code: 'c1', state: 's1' });
    await apiClient.getMe();

    expect(axiosMocks.client.get).toHaveBeenCalledWith('/auth/oidc/authorize-url', { params: undefined });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/auth/oidc/authorize-url', {
      params: { redirect_uri: 'http://localhost/callback' }
    });
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/auth/oidc/callback', { code: 'c1', state: 's1' });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/auth/me');
  });

  it('calls event and registration endpoints', async () => {
    await apiClient.getEvents({ page: 1 });
    await apiClient.getEvent('evt-1');
    await apiClient.createRegistration({ event_id: 'evt-1' });
    await apiClient.patchRegistration('reg-1', { status: 'REGISTERED' });
    await apiClient.resumeRegistration('reg-1', { ticket_type_id: 'tt-1' });
    await apiClient.cancelRegistration('reg-1');
    await apiClient.forfeitRegistration('reg-1');
    await apiClient.confirmRegistration('reg-1');
    await apiClient.getMyRegistrations({ page: 1 });
    await apiClient.getMyTickets();
    await apiClient.getTicketQR('ticket-1');
    await apiClient.verifyTicket({ qr_payload: 'qr', device_id: 'dev' });

    expect(axiosMocks.client.get).toHaveBeenCalledWith('/events', { params: { page: 1 } });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/events/evt-1');
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/registrations', { event_id: 'evt-1' });
    expect(axiosMocks.client.patch).toHaveBeenCalledWith('/registrations/reg-1', { status: 'REGISTERED' });
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/registrations/reg-1/resume', { ticket_type_id: 'tt-1' });
    expect(axiosMocks.client.delete).toHaveBeenCalledWith('/registrations/reg-1');
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/registrations/reg-1/forfeit');
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/registrations/reg-1/confirm');
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/me/registrations', { params: { page: 1 } });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/me/tickets', { params: {} });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/me/tickets/ticket-1/qr');
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/verify/ticket', { qr_payload: 'qr', device_id: 'dev' });
  });

  it('calls notification endpoints', async () => {
    await apiClient.getNotifications({ unread_only: true });
    await apiClient.getUnreadCount();
    await apiClient.markNotificationRead('n-1');
    await apiClient.markAllRead();

    expect(axiosMocks.client.get).toHaveBeenCalledWith('/notifications', { params: { unread_only: true } });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/notifications/unread-count');
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/notifications/n-1/read');
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/notifications/mark-all-read');
  });

  it('calls admin endpoints and export helpers', async () => {
    await apiClient.adminCreateEvent({ title: 'Event' });
    await apiClient.adminGetEvents({ page: 1, page_size: 50 });
    await apiClient.adminGetEvent('evt-draft-1');
    await apiClient.adminPatchEvent('evt-1', { title: 'Updated' });
    await apiClient.adminCreateSession('evt-1', { name: 'S1' });
    await apiClient.adminCreateTicketType('sess-1', { name: 'VIP' });
    await apiClient.adminPublishEvent('evt-draft-1');
    await apiClient.adminRunLottery('sess-1');
    await apiClient.adminCancelEvent('evt-draft-1', 'DeleteDraft');
    await apiClient.adminGetSiteEmployeeCount(['site-a', 'site-b']);
    await apiClient.adminGetRegistrations('evt-1', { page: 1 });
    await apiClient.adminGetDashboard('evt-1');
    await apiClient.adminExportSync('evt-1', { format: 'csv' });
    await apiClient.adminExportAsync('evt-1', { format: 'csv' });
    await apiClient.adminGetExportTask('evt-1', 'task-1');
    await apiClient.adminDownloadExportTask('evt-1', 'task-1');

    expect(axiosMocks.client.post).toHaveBeenCalledWith('/admin/events', { title: 'Event' });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/admin/events', { params: { page: 1, page_size: 50 } });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/admin/events/evt-draft-1');
    expect(axiosMocks.client.patch).toHaveBeenCalledWith('/admin/events/evt-1', { title: 'Updated' });
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/admin/events/evt-1/sessions', { name: 'S1' });
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/admin/sessions/sess-1/ticket-types', { name: 'VIP' });
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/admin/events/evt-draft-1/publish');
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/admin/sessions/sess-1/run-lottery');
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/admin/events/evt-draft-1/cancel', { reason: 'DeleteDraft' });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/admin/sites/employee-count', {
      params: { sites: 'site-a,site-b' }
    });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/admin/events/evt-1/registrations', { params: { page: 1 } });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/admin/events/evt-1/dashboard');
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/admin/events/evt-1/export', {
      params: { format: 'csv' },
      responseType: 'blob'
    });
    expect(axiosMocks.client.post).toHaveBeenCalledWith('/admin/events/evt-1/export/async', null, {
      params: { format: 'csv' }
    });
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/admin/events/evt-1/export/tasks/task-1');
    expect(axiosMocks.client.get).toHaveBeenCalledWith('/admin/events/evt-1/export/tasks/task-1/download', {
      responseType: 'blob'
    });
    expect(apiClient.buildExportDownloadUrl('evt-1', 'task-1')).toBe(
      'https://api.example.com/admin/events/evt-1/export/tasks/task-1/download'
    );
    expect(apiClient.getWsUrl()).toBe('wss://api.example.com/ws');
  });
});
