import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNotificationsMock: vi.fn(),
  refreshMock: vi.fn(),
  getRefreshTokenMock: vi.fn()
}));

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true })
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    getWsUrl: () => 'ws://localhost',
    getAccessToken: () => 'token',
    getRefreshToken: mocks.getRefreshTokenMock,
    getNotifications: mocks.getNotificationsMock,
    getUnreadCount: vi.fn().mockResolvedValue({ data: { unread_count: 0 } }),
    markNotificationRead: vi.fn(),
    markAllRead: vi.fn(),
    refresh: mocks.refreshMock,
    clearAuth: vi.fn()
  }
}));

import { NotificationProvider } from '../NotificationContext';

class MockWebSocket {
  static instances = [];

  constructor() {
    this.readyState = 1;
    MockWebSocket.instances.push(this);
    Promise.resolve().then(() => {
      if (this.onopen) this.onopen();
    });
  }

  send(d) {
    this.sent = this.sent || [];
    this.sent.push(d);
  }

  close(code) {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code: code ?? 1000 });
    }
  }
}

describe('NotificationContext websocket messages', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    global.WebSocket = MockWebSocket;
    mocks.getNotificationsMock.mockResolvedValue({ data: { items: [], unread_count: 0 } });
    mocks.getRefreshTokenMock.mockReturnValue(null);
    mocks.refreshMock.mockResolvedValue({});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles notification and ping websocket messages', async () => {
    await act(async () => {
      render(
        <NotificationProvider>
          <div />
        </NotificationProvider>
      );
    });

    const ws = MockWebSocket.instances[0];
    await act(async () => {
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({
            type: 'notification',
            data: { id: 'n2', title: 'Event cancelled', type: 'EVENT_CANCELLED' }
          })
        });
      }
    });

    await act(async () => {
      if (ws.onmessage) {
        ws.onmessage({ data: JSON.stringify({ type: 'ping' }) });
      }
    });

    expect(ws.sent.some((msg) => msg.includes('"type":"pong"'))).toBe(true);
    expect(mocks.getNotificationsMock).toHaveBeenCalled();
  });

  it('marks connection as live after auth_ok and refreshes list on EVENT_CANCELLED', async () => {
    await act(async () => {
      render(
        <NotificationProvider>
          <div />
        </NotificationProvider>
      );
    });

    const ws = MockWebSocket.instances[0];
    await act(async () => {
      if (ws.onmessage) {
        ws.onmessage({ data: JSON.stringify({ type: 'auth_ok' }) });
      }
    });

    mocks.getNotificationsMock.mockClear();
    await act(async () => {
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({
            type: 'notification',
            data: { id: 'n3', title: 'Cancelled', type: 'EVENT_CANCELLED' }
          })
        });
      }
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(mocks.getNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, page_size: 30 })
    );
  });

  it('refreshes token and reconnects when websocket closes with code 4001', async () => {
    mocks.getRefreshTokenMock.mockReturnValue('refresh-token');

    await act(async () => {
      render(
        <NotificationProvider>
          <div />
        </NotificationProvider>
      );
    });

    const firstWs = MockWebSocket.instances[0];
    await act(async () => {
      if (firstWs.onclose) {
        firstWs.onclose({ code: 4001 });
      }
    });

    expect(mocks.refreshMock).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
  });
});
