import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';

const AuthContext = createContext(null);

const decodeJwtPayload = (token) => {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const buildUserFromToken = (token) => {
  const claims = decodeJwtPayload(token);
  if (!claims?.role) {
    return null;
  }

  return {
    id: claims.sub || claims.jti || claims.employee_id || claims.role,
    employee_id: claims.employee_id || claims.sub || '',
    name: claims.name || claims.employee_id || claims.role,
    email: claims.email || '',
    department: claims.department || '',
    site: claims.site || 'HSINCHU',
    role: claims.role,
    status: 'ACTIVE'
  };
};

const normalizeRole = (role) => {
  if (role === 'FAMILY') {
    return 'EMPLOYEE';
  }
  return role;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromQuery = params.get('access_token') || params.get('token') || params.get('id_token');
    const roleFromQuery = normalizeRole(params.get('role') || '');

    if (tokenFromQuery) {
      apiClient.setIdpAccessToken(tokenFromQuery);
      if (roleFromQuery) {
        localStorage.setItem('cets_role_hint', roleFromQuery);
      }
      params.delete('access_token');
      params.delete('token');
      params.delete('id_token');
      params.delete('role');
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', next);
      return;
    }
  }, []);

  const fetchMe = useCallback(async () => {
    if (!apiClient.getAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient.getMe();
      setUser(res.data);
    } catch (error) {
      const fallbackUser = buildUserFromToken(apiClient.getAccessToken());
      if (fallbackUser) {
        setUser(fallbackUser);
        return;
      }
      apiClient.clearAuth();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const startOIDCLogin = useCallback(async () => {
    const res = await apiClient.getOIDCAuthorizeUrl();
    window.location.href = res.data.authorize_url;
  }, []);

  const finishOIDCLogin = useCallback(async ({ code, state }) => {
    const res = await apiClient.oidcCallback({ code, state });
    apiClient.setAuthTokens(res.data);
    await fetchMe();
  }, [fetchMe]);

  const loginAsRole = useCallback(async (role) => {
    apiClient.switchDevRole(normalizeRole(role));
    const fallbackUser = buildUserFromToken(apiClient.getAccessToken());
    if (fallbackUser) {
      setUser(fallbackUser);
      setLoading(false);
      return;
    }
    await fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } catch (error) {
      apiClient.clearAuth();
    }
    setUser(null);
  }, []);

  const register = useCallback(async (userData) => {
    try {
      const res = await apiClient.register(userData);
      apiClient.setAuthTokens(res.data);
      await fetchMe();
      return res;
    } catch (error) {
      throw error;
    }
  }, [fetchMe]);

  const loginWithPassword = useCallback(
    async ({ email, password }) => {
      const res = await apiClient.login({ email, password });
      apiClient.setAuthTokens(res.data);
      await fetchMe();
      return res;
    },
    [fetchMe]
  );

  const value = useMemo(() => ({
    user,
    loading,
    isAuthenticated: !!user,
    fetchMe,
    startOIDCLogin,
    finishOIDCLogin,
    loginAsRole,
    logout,
    register,
    loginWithPassword
  }), [user, loading, fetchMe, startOIDCLogin, finishOIDCLogin, loginAsRole, logout, register, loginWithPassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
};
