import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import {
  OIDC_STATE_KEY,
  POST_LOGIN_REDIRECT_KEY
} from '../constant';

const AuthContext = createContext(null);

const isSafeInternalPath = (path) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    if (!apiClient.getAccessToken() && !apiClient.getRefreshToken()) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      if (!apiClient.getAccessToken()) {
        await apiClient.refresh();
      }
      const res = await apiClient.getMe();
      setUser(res.data);
    } catch (error) {
      apiClient.clearAuth();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const startOIDCLogin = useCallback(async ({ targetPath, loginHint } = {}) => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    const res = await apiClient.getOIDCAuthorizeUrl({ redirectUri });
    const authorizeUrlRaw = res.data?.authorize_url;
    const state = res.data?.state;
    if (!authorizeUrlRaw || !state) {
      throw new Error('OIDC authorize-url response missing authorize_url/state');
    }
    localStorage.setItem(OIDC_STATE_KEY, state);

    if (isSafeInternalPath(targetPath)) {
      sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, targetPath);
    } else {
      sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    }

    let authorizeUrl = authorizeUrlRaw;
    if (loginHint) {
      try {
        const url = new URL(authorizeUrlRaw);
        url.searchParams.set('login_hint', loginHint);
        url.searchParams.set('prompt', 'login');
        url.searchParams.set('max_age', '0');
        authorizeUrl = url.toString();
      } catch {
        authorizeUrl = authorizeUrlRaw;
      }
    }

    window.location.href = authorizeUrl;
  }, []);

  const finishOIDCLogin = useCallback(async ({ code, state }) => {
    const expectedState = localStorage.getItem(OIDC_STATE_KEY);
    if (!expectedState || expectedState !== state) {
      throw new Error('OIDC state mismatch');
    }
    const res = await apiClient.oidcCallback({ code, state });
    localStorage.removeItem(OIDC_STATE_KEY);
    apiClient.setAuthTokens(res.data);
    await fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } catch (error) {
      apiClient.clearAuth();
    }
    localStorage.removeItem(OIDC_STATE_KEY);
    sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    isAuthenticated: !!user,
    fetchMe,
    startOIDCLogin,
    finishOIDCLogin,
    logout
  }), [user, loading, fetchMe, startOIDCLogin, finishOIDCLogin, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
};
