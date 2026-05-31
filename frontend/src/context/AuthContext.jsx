import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import {
  OIDC_STATE_KEY,
  POST_LOGIN_REDIRECT_KEY
} from '../constant';
import { isSafeInternalPath } from '../utils/authRedirect';

const AuthContext = createContext(null);
const appBasePath = import.meta.env.BASE_URL === '/'
  ? ''
  : import.meta.env.BASE_URL.replace(/\/$/, '');

export const clearOidcTransientState = () => {
  localStorage.removeItem(OIDC_STATE_KEY);
  sessionStorage.removeItem(OIDC_STATE_KEY);
  sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
};

export const storeOidcState = (state) => {
  sessionStorage.setItem(OIDC_STATE_KEY, state);
  localStorage.removeItem(OIDC_STATE_KEY);
};

export const readOidcState = () => sessionStorage.getItem(OIDC_STATE_KEY) || localStorage.getItem(OIDC_STATE_KEY);

export const forceInteractiveLogin = (authorizeUrlRaw) => {
  try {
    const url = new URL(authorizeUrlRaw, window.location.origin);
    url.searchParams.set('prompt', 'login');
    url.searchParams.set('max_age', '0');
    return url.toString();
  } catch {
    return authorizeUrlRaw;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    if (!apiClient.getAccessToken() && !apiClient.getRefreshToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }

    setLoading(true);
    try {
      if (!apiClient.getAccessToken()) {
        await apiClient.refresh();
      }
      const res = await apiClient.getMe();
      const currentUser = res.data;
      setUser(currentUser);
      return currentUser;
    } catch (error) {
      apiClient.clearAuth();
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const startOIDCLogin = useCallback(async ({ targetPath } = {}) => {
    apiClient.clearAuth();
    setUser(null);
    clearOidcTransientState();

    const redirectUri = `${window.location.origin}${appBasePath}/auth/callback`;
    const res = await apiClient.getOIDCAuthorizeUrl({ redirectUri });
    const authorizeUrlRaw = res.data?.authorize_url;
    const state = res.data?.state;
    if (!authorizeUrlRaw || !state) {
      throw new Error('OIDC authorize-url response missing authorize_url/state');
    }
    storeOidcState(state);

    if (isSafeInternalPath(targetPath)) {
      sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, targetPath);
    } else {
      sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    }

    window.location.href = forceInteractiveLogin(authorizeUrlRaw);
  }, []);

  const finishOIDCLogin = useCallback(async ({ code, state }) => {
    const expectedState = readOidcState();
    if (!expectedState || expectedState !== state) {
      apiClient.clearAuth();
      clearOidcTransientState();
      throw new Error('OIDC state mismatch');
    }
    const res = await apiClient.oidcCallback({ code, state });
    clearOidcTransientState();
    apiClient.setAuthTokens(res.data);
    return fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async () => {
    setUser(null);
    clearOidcTransientState();
    try {
      await apiClient.logout();
    } catch (error) {
      apiClient.clearAuth();
    } finally {
      apiClient.clearAuth();
      clearOidcTransientState();
    }
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
