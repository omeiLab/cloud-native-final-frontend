import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from './AuthContext';

const NotificationContext = createContext(null);

export const NotificationProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const unreadCatchUpTimerRef = useRef(null);

  const refreshList = useCallback(async (params = {}) => {
    if (!isAuthenticated) {
      return;
    }
    const res = await apiClient.getNotifications({ unread_only: false, page: 1, page_size: 20, ...params });
    setItems(res.data.items || []);
    setUnreadCount(res.data.unread_count || 0);
  }, [isAuthenticated]);

  const refreshUnread = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }
    const res = await apiClient.getUnreadCount();
    setUnreadCount(res.data.unread_count || 0);
  }, [isAuthenticated]);

  const fetchUnreadAndMerge = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await apiClient.getNotifications({ unread_only: true, page: 1, page_size: 50 });
      const newItems = res.data.items || [];
      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const merged = [
          ...newItems.filter((i) => !existingIds.has(i.id)),
          ...prev
        ].slice(0, 50);
        return merged;
      });
      setUnreadCount(res.data.unread_count || 0);
    } catch (err) {
      // ignore fetch errors - will try again on next reconnect
    }
  }, [isAuthenticated]);

  const markRead = useCallback(async (notificationId) => {
    await apiClient.markNotificationRead(notificationId);
    setItems((prev) => prev.map((item) => (item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    const res = await apiClient.markAllRead();
    setItems((prev) => prev.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
    setUnreadCount((prev) => Math.max(0, prev - (res.data.updated_count || 0)));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setItems([]);
      setUnreadCount(0);
      if (unreadCatchUpTimerRef.current) {
        clearTimeout(unreadCatchUpTimerRef.current);
        unreadCatchUpTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'logout');
        wsRef.current = null;
      }
      return;
    }

    refreshList().catch(() => {});

    const connect = () => {
      const ws = new WebSocket(apiClient.getWsUrl());
      wsRef.current = ws;
      let unreadCatchUpDone = false;

      const runUnreadCatchUp = () => {
        if (unreadCatchUpDone) {
          return;
        }
        unreadCatchUpDone = true;
        fetchUnreadAndMerge().catch(() => {});
      };

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(false);
        ws.send(JSON.stringify({ type: 'auth', token: apiClient.getAccessToken() }));
        if (unreadCatchUpTimerRef.current) {
          globalThis.clearTimeout(unreadCatchUpTimerRef.current);
        }
        unreadCatchUpTimerRef.current = globalThis.setTimeout(() => {
          runUnreadCatchUp();
        }, 1200);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'auth_ok') {
            setConnected(true);
            runUnreadCatchUp();
            return;
          }
          if (message.type === 'notification' && message.data) {
            setItems((prev) => [message.data, ...prev].slice(0, 20));
            setUnreadCount((prev) => prev + 1);
            /** 管理員取消活動常批次寫 DB；WS 可先顯示一則後再同步完整列表避免漏載 */
            if (message.data.type === 'EVENT_CANCELLED') {
              globalThis.setTimeout(() => {
                refreshList({ page: 1, page_size: 30 }).catch(() => {});
              }, 600);
            }
          }
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (error) {
          // Ignore malformed message from network retries.
        }
      };

      ws.onclose = (event) => {
        setConnected(false);
        wsRef.current = null;
        if (unreadCatchUpTimerRef.current) {
          globalThis.clearTimeout(unreadCatchUpTimerRef.current);
          unreadCatchUpTimerRef.current = null;
        }
        if (!isAuthenticated) {
          return;
        }
        if (event.code === 1000) {
          return;
        }
        // 4001: token 過期/缺少/10 秒內未送 auth；嘗試 refresh 後重連
        if (event.code === 4001) {
          const refreshToken = apiClient.getRefreshToken?.();
          if (refreshToken) {
            apiClient.refresh(refreshToken).finally(() => {
              setTimeout(() => connect(), 800);
            });
            return;
          }
        }
        const retryInMs = Math.min(30000, 1000 * (2 ** retryRef.current));
        retryRef.current += 1;
        setTimeout(() => {
          connect();
        }, retryInMs);
      };
    };

    connect();

    return () => {
      if (unreadCatchUpTimerRef.current) {
        globalThis.clearTimeout(unreadCatchUpTimerRef.current);
        unreadCatchUpTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'cleanup');
      }
    };
  }, [isAuthenticated, refreshList]);

  const value = useMemo(() => ({
    items,
    unreadCount,
    connected,
    refreshList,
    refreshUnread,
    markRead,
    markAllRead
  }), [items, unreadCount, connected, refreshList, refreshUnread, markRead, markAllRead]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used inside NotificationProvider');
  }
  return ctx;
};
