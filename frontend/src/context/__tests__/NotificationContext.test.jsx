import React from 'react';
import { act, render } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNotificationsMock: vi.fn().mockResolvedValue({ data: { items: [{ id: 'n1', title: 'New' }], unread_count: 1 } })
}));

// mock useAuth to be authenticated
vi.mock('../AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true })
}));

// mock apiClient
vi.mock('../../api/client', () => ({
  apiClient: {
    getWsUrl: () => 'ws://localhost',
    getAccessToken: () => 'token',
    getNotifications: mocks.getNotificationsMock,
    getUnreadCount: vi.fn().mockResolvedValue({ data: { unread_count: 1 } }),
    markNotificationRead: vi.fn(),
    markAllRead: vi.fn()
  }
}));

import { NotificationProvider } from '../NotificationContext';
import { apiClient } from '../../api/client';

describe('NotificationContext reconnect behavior', () => {
  let origWebSocket;
  let origSetTimeout;
  let origClearTimeout;
  let pendingTimers = [];
  class MockWebSocket {
    constructor(url) {
      this.url = url;
      MockWebSocket.instances.push(this);
      this.readyState = 1;
      this.sent = [];
      Promise.resolve().then(() => {
        if (this.onopen) this.onopen();
      });
    }
    send(d) { this.sent.push(d); }
    close() { this.readyState = 3; }
  }
  MockWebSocket.instances = [];

  beforeEach(() => {
    origWebSocket = global.WebSocket;
    origSetTimeout = global.setTimeout;
    origClearTimeout = global.clearTimeout;
    global.WebSocket = MockWebSocket;
    pendingTimers = [];
    global.setTimeout = vi.fn((fn, delay) => {
      const handle = { fn, delay };
      pendingTimers.push(handle);
      return handle;
    });
    global.clearTimeout = vi.fn((handle) => {
      pendingTimers = pendingTimers.filter((item) => item !== handle);
    });
    mocks.getNotificationsMock.mockClear();
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    global.WebSocket = origWebSocket;
    global.setTimeout = origSetTimeout;
    global.clearTimeout = origClearTimeout;
  });

  it('calls getNotifications(unread_only=true) after reconnect auth_ok message', async () => {
    await act(async () => {
      render(
        <NotificationProvider>
          <div data-testid="child" />
        </NotificationProvider>
      );
    });

    // wait for websocket instance
    await Promise.resolve();
    await Promise.resolve();
    expect(MockWebSocket.instances.length).toBe(1);
    const firstWs = MockWebSocket.instances[0];

    // first connect succeeds and catches up once
    await act(async () => {
      if (firstWs.onmessage) firstWs.onmessage({ data: JSON.stringify({ type: 'auth_ok' }) });
    });
    expect(apiClient.getNotifications).toHaveBeenCalledTimes(2);

    // reconnect path
    await act(async () => {
      if (firstWs.onclose) firstWs.onclose({ code: 1006 });
    });

    expect(pendingTimers.some((timer) => timer.delay >= 1000)).toBe(true);
    const reconnectTimer = pendingTimers.find((timer) => timer.delay >= 1000);
    reconnectTimer.fn();
    await Promise.resolve();
    await Promise.resolve();

    expect(MockWebSocket.instances.length).toBe(2);
    const secondWs = MockWebSocket.instances[1];

    await act(async () => {
      if (secondWs.onmessage) secondWs.onmessage({ data: JSON.stringify({ type: 'auth_ok' }) });
    });

    expect(apiClient.getNotifications).toHaveBeenCalledTimes(3);

    const calledWith = apiClient.getNotifications.mock.calls[2][0];
    expect(calledWith).toMatchObject({ unread_only: true });
  });
});
