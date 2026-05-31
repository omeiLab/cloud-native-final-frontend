import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNotificationsMock: vi.fn(),
  getUnreadCountMock: vi.fn(),
  markNotificationReadMock: vi.fn(),
  markAllReadMock: vi.fn(),
  isAuthenticated: true
}));

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mocks.isAuthenticated })
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    getWsUrl: () => 'ws://localhost',
    getAccessToken: () => 'token',
    getRefreshToken: () => null,
    getNotifications: mocks.getNotificationsMock,
    getUnreadCount: mocks.getUnreadCountMock,
    markNotificationRead: mocks.markNotificationReadMock,
    markAllRead: mocks.markAllReadMock,
    refresh: vi.fn(),
    clearAuth: vi.fn()
  }
}));

import { NotificationProvider, useNotifications } from '../NotificationContext';

const Probe = ({ onReady }) => {
  const ctx = useNotifications();
  React.useEffect(() => {
    onReady(ctx);
  }, [ctx, onReady]);
  return <div data-testid="probe">{ctx.unreadCount}</div>;
};

describe('NotificationContext actions', () => {
  let ctxRef = null;

  beforeEach(() => {
    ctxRef = null;
    mocks.isAuthenticated = true;
    mocks.getNotificationsMock.mockResolvedValue({
      data: { items: [{ id: 'n1', title: 'Hello' }], unread_count: 1 }
    });
    mocks.getUnreadCountMock.mockResolvedValue({ data: { unread_count: 2 } });
    mocks.markNotificationReadMock.mockResolvedValue({});
    mocks.markAllReadMock.mockResolvedValue({ data: { updated_count: 1 } });
    global.WebSocket = class {
      constructor() {
        this.readyState = 1;
      }
      send() {}
      close() {}
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks one notification as read', async () => {
    await act(async () => {
      render(
        <NotificationProvider>
          <Probe onReady={(ctx) => { ctxRef = ctx; }} />
        </NotificationProvider>
      );
    });
    await act(async () => {
      await ctxRef.markRead('n1');
    });
    expect(mocks.markNotificationReadMock).toHaveBeenCalledWith('n1');
  });

  it('marks all notifications as read', async () => {
    await act(async () => {
      render(
        <NotificationProvider>
          <Probe onReady={(ctx) => { ctxRef = ctx; }} />
        </NotificationProvider>
      );
    });
    await act(async () => {
      await ctxRef.markAllRead();
    });
    expect(mocks.markAllReadMock).toHaveBeenCalled();
  });

  it('clears state when user logs out', async () => {
    mocks.isAuthenticated = false;
    await act(async () => {
      render(
        <NotificationProvider>
          <Probe onReady={(ctx) => { ctxRef = ctx; }} />
        </NotificationProvider>
      );
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('0');
  });
});
