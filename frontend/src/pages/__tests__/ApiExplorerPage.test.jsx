import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApiExplorerPage from '../ApiExplorerPage';

const apiMocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  getEvents: vi.fn(),
  getUnreadCount: vi.fn(),
  getNotifications: vi.fn(),
  getMyRegistrations: vi.fn(),
  getMyTickets: vi.fn(),
  adminGetSiteEmployeeCount: vi.fn(),
  adminGetDashboard: vi.fn(),
  adminGetRegistrations: vi.fn(),
  verifyTicket: vi.fn(),
  getWsUrl: vi.fn(() => 'ws://localhost'),
  getAccessToken: vi.fn(() => 'token')
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'ADMIN', name: 'Admin User' } })
}));

vi.mock('../../api/client', () => ({
  API_BASE_URL: 'https://api.example.com/api/v1',
  apiClient: apiMocks
}));

describe('ApiExplorerPage', () => {
  beforeEach(() => {
    apiMocks.getMe.mockResolvedValue({ data: { id: 'u1', name: 'Admin User', role: 'ADMIN' } });
    apiMocks.getEvents.mockResolvedValue({ data: { items: [] } });
    apiMocks.getUnreadCount.mockResolvedValue({ data: { unread_count: 0 } });
    apiMocks.getNotifications.mockResolvedValue({ data: { items: [], unread_count: 0 } });
    apiMocks.getMyRegistrations.mockResolvedValue({ data: { items: [] } });
    apiMocks.getMyTickets.mockResolvedValue({ data: { items: [] } });
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    global.WebSocket = class {
      constructor() {
        this.readyState = 1;
        Promise.resolve().then(() => {
          if (this.onopen) this.onopen();
          if (this.onmessage) {
            this.onmessage({ data: JSON.stringify({ type: 'auth_ok' }) });
          }
        });
      }
      send() {}
      close() {}
    };
  });

  it('renders API endpoint groups and health check actions', () => {
    render(<ApiExplorerPage />);
    expect(screen.getByText('Auth / identity')).toBeInTheDocument();
    expect(screen.getByText('Admin APIs')).toBeInTheDocument();
    expect(screen.getByText('Run integration checks')).toBeInTheDocument();
  });

  it('runs integrated checks and shows report', async () => {
    render(<ApiExplorerPage />);
    fireEvent.click(screen.getByText('Run integration checks'));

    await waitFor(() => {
      expect(apiMocks.getMe).toHaveBeenCalled();
    });
    expect(await screen.findByText('Check results')).toBeInTheDocument();
    expect(screen.getByText(/Admin User/)).toBeInTheDocument();
  });

  it('runs advanced admin checks', async () => {
    apiMocks.adminGetSiteEmployeeCount.mockResolvedValue({ data: { total: 42 } });
    apiMocks.getEvents.mockResolvedValue({ data: { items: [{ id: 'evt-1' }], total: 1 } });
    apiMocks.adminGetDashboard.mockResolvedValue({ data: { sessions_lottery: [] } });
    apiMocks.adminGetRegistrations.mockResolvedValue({ data: { items: [] } });

    render(<ApiExplorerPage />);
    fireEvent.click(screen.getByText('Run advanced API checks'));

    await waitFor(() => {
      expect(apiMocks.adminGetSiteEmployeeCount).toHaveBeenCalled();
    });
    expect(await screen.findByText('Advanced check results')).toBeInTheDocument();
  });

  it('reports integration check failures', async () => {
    apiMocks.getMe.mockRejectedValue({ error: { message: 'Unauthorized' } });

    render(<ApiExplorerPage />);
    fireEvent.click(screen.getByText('Run integration checks'));

    expect(await screen.findByText(/Unauthorized|Checks failed/i)).toBeInTheDocument();
  });

  it('handles missing events during advanced admin checks', async () => {
    apiMocks.adminGetSiteEmployeeCount.mockResolvedValue({ data: { total: 0 } });
    apiMocks.getEvents.mockResolvedValue({ data: { items: [] } });

    render(<ApiExplorerPage />);
    fireEvent.click(screen.getByText('Run advanced API checks'));

    expect(await screen.findByText('Advanced check results')).toBeInTheDocument();
    expect(screen.getAllByText(/No testable events/i).length).toBeGreaterThan(0);
  });

  it('handles admin site employee count failures in advanced checks', async () => {
    apiMocks.adminGetSiteEmployeeCount.mockRejectedValue({ error: { message: 'Forbidden' } });
    apiMocks.getEvents.mockResolvedValue({ data: { items: [{ id: 'evt-1' }] } });
    apiMocks.adminGetDashboard.mockResolvedValue({ data: { sessions_lottery: [] } });
    apiMocks.adminGetRegistrations.mockResolvedValue({ data: { items: [] } });

    render(<ApiExplorerPage />);
    fireEvent.click(screen.getByText('Run advanced API checks'));

    expect(await screen.findByText(/Forbidden/i)).toBeInTheDocument();
  });
});
