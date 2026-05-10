import { vi, describe, it, expect, beforeEach } from 'vitest';

// mock axios before importing apiClient
const mocks = vi.hoisted(() => ({
  getMock: vi.fn().mockResolvedValue({ data: { items: [], unread_count: 0 } }),
  postMock: vi.fn().mockResolvedValue({ data: {} })
}));
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

import { apiClient } from '../client';

describe('apiClient basic http calls', () => {
  beforeEach(() => {
    mocks.getMock.mockClear();
    mocks.postMock.mockClear();
  });

  it('calls getNotifications and returns data', async () => {
    const res = await apiClient.getNotifications({ unread_only: true });
    expect(mocks.getMock).toHaveBeenCalled();
    const calledArgs = mocks.getMock.mock.calls[0];
    expect(calledArgs[0]).toBe('/notifications');
    expect(calledArgs[1]).toMatchObject({ params: { unread_only: true } });
    expect(res).toEqual({ data: { items: [], unread_count: 0 } });
  });

  it('calls login with email and password', async () => {
    mocks.postMock.mockResolvedValueOnce({
      data: { access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' }
    });
    const res = await apiClient.login({ email: 'u@test.com', password: 'Abc12345' });
    expect(mocks.postMock).toHaveBeenCalledWith('/auth/login', { email: 'u@test.com', password: 'Abc12345' });
    expect(res.data.access_token).toBe('a');
  });
});
