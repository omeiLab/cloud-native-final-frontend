import { vi, describe, it, expect, beforeEach } from 'vitest';

// mock axios before importing apiClient
const mocks = vi.hoisted(() => ({
  getMock: vi.fn().mockResolvedValue({ data: { items: [], unread_count: 0 } }),
  postMock: vi.fn().mockResolvedValue({ data: {} })
}));

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
    create: () => ({
      get: mocks.getMock,
      post: mocks.postMock,
      delete: vi.fn(),
      patch: vi.fn(),
      interceptors: { response: { use: vi.fn() } }
    })
  },
  create: () => ({
    get: mocks.getMock,
    post: mocks.postMock,
    delete: vi.fn(),
    patch: vi.fn(),
    interceptors: { response: { use: vi.fn() } }
  })
}));

describe('apiClient basic http calls', () => {
  let apiClient;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', storageMock);
    storageMock.clear();
    mocks.getMock.mockClear();
    mocks.postMock.mockClear();
    return import('../client').then((module) => {
      apiClient = module.apiClient;
    });
  });

  it('calls getNotifications and returns data', async () => {
    const res = await apiClient.getNotifications({ unread_only: true });
    expect(mocks.getMock).toHaveBeenCalled();
    const calledArgs = mocks.getMock.mock.calls[0];
    expect(calledArgs[0]).toBe('/notifications');
    expect(calledArgs[1]).toMatchObject({ params: { unread_only: true } });
    expect(res).toEqual({ data: { items: [], unread_count: 0 } });
  });

  it('calls OIDC authorize-url and callback endpoints', async () => {
    mocks.getMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: { authorize_url: 'https://example.auth0.com/authorize', state: 'state-1' }
      }
    });
    mocks.postMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: { access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' }
      }
    });

    const authorizeRes = await apiClient.getOIDCAuthorizeUrl({ redirectUri: 'http://localhost:5173/auth/callback' });
    const callbackRes = await apiClient.oidcCallback({ code: 'code-1', state: 'state-1' });

    expect(mocks.getMock).toHaveBeenCalledWith('/auth/oidc/authorize-url', {
      params: { redirect_uri: 'http://localhost:5173/auth/callback' }
    });
    expect(mocks.postMock).toHaveBeenCalledWith('/auth/oidc/callback', { code: 'code-1', state: 'state-1' });
    expect(authorizeRes.data.data.state).toBe('state-1');
    expect(callbackRes.data.data.access_token).toBe('a');
  });

  it('calls admin event list and detail endpoints for admin draft flow', async () => {
    await apiClient.adminGetEvents({ page: 1, page_size: 50 });
    await apiClient.adminGetEvent('evt-draft-1');
    await apiClient.adminCancelEvent('evt-draft-1', '刪除草稿');

    expect(mocks.getMock).toHaveBeenNthCalledWith(1, '/admin/events', {
      params: { page: 1, page_size: 50 }
    });
    expect(mocks.getMock).toHaveBeenNthCalledWith(2, '/admin/events/evt-draft-1');
    expect(mocks.postMock).toHaveBeenCalledWith('/admin/events/evt-draft-1/cancel', {
      reason: '刪除草稿'
    });
  });
});
