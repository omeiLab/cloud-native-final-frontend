import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '../AuthContext';
import { OIDC_STATE_KEY } from '../../constant';

const apiMocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getRefreshToken: vi.fn(),
  getMe: vi.fn(),
  refresh: vi.fn(),
  clearAuth: vi.fn(),
  setAuthTokens: vi.fn(),
  logout: vi.fn(),
  getOIDCAuthorizeUrl: vi.fn(),
  oidcCallback: vi.fn()
}));

vi.mock('../../api/client', () => ({
  apiClient: apiMocks
}));

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthProvider', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    sessionStorage.clear();
    localStorage.clear();
    apiMocks.getAccessToken.mockReturnValue(null);
    apiMocks.getRefreshToken.mockReturnValue(null);
  });

  it('starts unauthenticated when no tokens exist', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('loads the current user when access token exists', async () => {
    apiMocks.getAccessToken.mockReturnValue('access-token');
    apiMocks.getMe.mockResolvedValue({ data: { id: 'u1', role: 'EMPLOYEE' } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(result.current.user?.id).toBe('u1');
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('refreshes token before loading user when only refresh token exists', async () => {
    apiMocks.getAccessToken.mockReturnValue(null);
    apiMocks.getRefreshToken.mockReturnValue('refresh-token');
    apiMocks.refresh.mockResolvedValue({});
    apiMocks.getMe.mockResolvedValue({ data: { id: 'u2', role: 'ADMIN' } });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(result.current.user?.role).toBe('ADMIN');
    });
    expect(apiMocks.refresh).toHaveBeenCalled();
  });

  it('starts OIDC login and stores state', async () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { origin: 'http://localhost:5173', href: '' };
    apiMocks.getOIDCAuthorizeUrl.mockResolvedValue({
      data: { authorize_url: 'https://auth.example.com/authorize', state: 'state-abc' }
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startOIDCLogin({ targetPath: '/admin' });
    });

    expect(sessionStorage.getItem(OIDC_STATE_KEY)).toBe('state-abc');
    expect(sessionStorage.getItem('cets_post_login_redirect')).toBe('/admin');
    expect(window.location.href).toContain('auth.example.com');
    window.location = originalLocation;
  });

  it('finishes OIDC login when state matches', async () => {
    sessionStorage.setItem(OIDC_STATE_KEY, 'state-abc');
    apiMocks.oidcCallback.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r' } });
    apiMocks.setAuthTokens.mockImplementation(() => {
      apiMocks.getAccessToken.mockReturnValue('a');
      apiMocks.getRefreshToken.mockReturnValue('r');
    });
    apiMocks.getMe.mockResolvedValue({ data: { id: 'u3', role: 'EMPLOYEE' } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let user;
    await act(async () => {
      user = await result.current.finishOIDCLogin({ code: 'code-1', state: 'state-abc' });
    });
    expect(user.id).toBe('u3');
    expect(apiMocks.setAuthTokens).toHaveBeenCalled();
  });

  it('logs out and clears auth state', async () => {
    apiMocks.getAccessToken.mockReturnValue('access-token');
    apiMocks.getRefreshToken.mockReturnValue('refresh-token');
    apiMocks.getMe.mockResolvedValue({ data: { id: 'u1', role: 'EMPLOYEE' } });
    apiMocks.logout.mockResolvedValue({});

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(apiMocks.clearAuth).toHaveBeenCalled();
  });
});
