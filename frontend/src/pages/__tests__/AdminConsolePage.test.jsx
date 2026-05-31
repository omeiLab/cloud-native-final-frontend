import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from 'antd';

const refreshListMock = vi.fn().mockResolvedValue(undefined);

const adminMocks = vi.hoisted(() => ({
  adminGetEvents: vi.fn(),
  adminGetDashboard: vi.fn(),
  adminGetRegistrations: vi.fn(),
  adminGetEvent: vi.fn(),
  adminExportSync: vi.fn(),
  adminRunLottery: vi.fn(),
  adminPublishEvent: vi.fn(),
  adminCreateEvent: vi.fn(),
  adminCreateSession: vi.fn(),
  adminCreateTicketType: vi.fn(),
  adminCancelEvent: vi.fn(),
  adminPatchEvent: vi.fn(),
  useAuthMock: vi.fn(() => ({ user: { role: 'ADMIN', name: 'Admin' } }))
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => adminMocks.useAuthMock()
}));

vi.mock('../../context/NotificationContext', () => ({
  useNotifications: () => ({ refreshList: refreshListMock })
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    adminGetEvents: adminMocks.adminGetEvents,
    adminGetDashboard: adminMocks.adminGetDashboard,
    adminGetRegistrations: adminMocks.adminGetRegistrations,
    adminGetEvent: adminMocks.adminGetEvent,
    getEvents: vi.fn().mockResolvedValue({ data: { items: [] } }),
    getEvent: vi.fn().mockResolvedValue({ data: null }),
    adminCreateEvent: adminMocks.adminCreateEvent,
    adminCreateSession: adminMocks.adminCreateSession,
    adminCreateTicketType: adminMocks.adminCreateTicketType,
    adminPublishEvent: adminMocks.adminPublishEvent,
    adminCancelEvent: adminMocks.adminCancelEvent,
    adminUpdateEvent: vi.fn(),
    adminPatchEvent: adminMocks.adminPatchEvent,
    adminRunLottery: adminMocks.adminRunLottery,
    adminExportSync: adminMocks.adminExportSync,
    adminDeleteDraft: vi.fn()
  }
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="chart">{children}</div>,
  LineChart: ({ children }) => <div>{children}</div>,
  BarChart: ({ children }) => <div>{children}</div>,
  PieChart: ({ children }) => <div>{children}</div>,
  Line: () => null,
  Bar: () => null,
  Pie: () => null,
  Cell: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null
}));

import AdminConsolePage from '../AdminConsolePage';

const draftEventList = {
  data: {
    items: [{
      id: 'draft-1',
      title: 'Draft Family Day',
      status: 'DRAFT',
      allowed_sites: ['HSINCHU'],
      created_at: '2026-05-01T10:00:00+08:00'
    }]
  }
};

const draftEventDetail = {
  data: {
    id: 'draft-1',
    title: 'Draft Family Day',
    status: 'DRAFT',
    description: 'Family day draft',
    allowed_sites: ['HSINCHU'],
    registration_mode: 'LIMITED',
    sessions: [{
      id: 'sess-1',
      title: 'Session 1',
      venue: 'Hsinchu plaza',
      starts_at: '2026-06-10T09:00:00+08:00',
      ends_at: '2026-06-10T18:00:00+08:00',
      registration_opens_at: '2026-05-01T00:00:00+08:00',
      registration_closes_at: '2026-06-09T23:59:59+08:00',
      lottery_at: '2026-06-09T23:59:59+08:00',
      waitlist_close_at: '2026-06-10T08:59:00+08:00',
      ticket_types: [
        { id: 'tt-a', name: 'Adult ticket', audience: 'EMPLOYEE', quota: 100 },
        { id: 'tt-c', name: 'Child ticket', audience: 'CHILD', quota: 50 }
      ]
    }]
  }
};

const mockModalConfirmOk = () => vi.spyOn(Modal, 'confirm').mockImplementation(({ onOk }) => {
  Promise.resolve(onOk?.());
  return { destroy: vi.fn(), update: vi.fn() };
});

const getCreateActions = () => within(document.querySelector('.admin-create-actions'));

describe('AdminConsolePage', () => {
  beforeEach(() => {
    refreshListMock.mockClear();
    adminMocks.useAuthMock.mockReturnValue({ user: { role: 'ADMIN', name: 'Admin' } });
    adminMocks.adminGetEvents.mockResolvedValue({
      data: {
        items: [{
          id: 'evt-1',
          title: '2026 Spring Family Day',
          status: 'PUBLISHED',
          allowed_sites: ['HSINCHU'],
          created_at: '2026-05-01T10:00:00+08:00'
        }]
      }
    });
    adminMocks.adminGetDashboard.mockResolvedValue({
      data: {
        registration_timeline: [{ date: '2026-06-01', count: 12 }],
        site_distribution: [{ site: 'HSINCHU', count: 8 }],
        ticket_type_progress: [{
          ticket_type_id: 'tt-1',
          name: 'Adult ticket',
          quota: 100,
          registered: 20,
          confirmed: 10,
          won: 15
        }],
        attendance: { total_confirmed: 10, checked_in: 4 },
        sessions_lottery: [{
          session_id: 'sess-1',
          title: 'Session 1',
          lottery_at: '2026-06-05T10:00:00+08:00',
          registered_pending: 5
        }]
      }
    });
    adminMocks.adminGetRegistrations.mockResolvedValue({
      data: {
        items: [{
          id: 'reg-1',
          status: 'CONFIRMED',
          session_title: 'Session 1',
          ticket_type_name: 'Adult ticket',
          user: { employee_id: 'E001', name: 'Alice', department: 'IT' }
        }]
      }
    });
    adminMocks.adminGetEvent.mockResolvedValue({
      data: {
        id: 'evt-1',
        sessions: [{ id: 'sess-1', title: 'Session 1', lottery_at: '2026-06-05T10:00:00+08:00' }]
      }
    });
    adminMocks.adminExportSync.mockResolvedValue('id,name\n1,Alice');
    adminMocks.adminRunLottery.mockResolvedValue({
      data: { winners_count: 3, total_candidates: 5 }
    });
    adminMocks.adminPublishEvent.mockResolvedValue({ data: { id: 'draft-1', status: 'PUBLISHED' } });
    adminMocks.adminCreateEvent.mockResolvedValue({ data: { id: 'new-evt-1' } });
    adminMocks.adminCreateSession.mockResolvedValue({ data: { id: 'sess-new' } });
    adminMocks.adminCreateTicketType.mockResolvedValue({ data: { id: 'tt-new' } });
    adminMocks.adminCancelEvent.mockResolvedValue({});
    adminMocks.adminPatchEvent.mockResolvedValue({});
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('renders admin hero and create form defaults', async () => {
    render(<AdminConsolePage />);
    expect(await screen.findByText('Admin console')).toBeInTheDocument();
    expect(screen.getByText('Control panel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026 Spring Family Day')).toBeInTheDocument();
    expect(screen.getByText('Basic info')).toBeInTheDocument();
  });

  it('loads dashboard tab with stats and registrations', async () => {
    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));

    await waitFor(() => {
      expect(adminMocks.adminGetDashboard).toHaveBeenCalled();
    });
    expect(await screen.findByText('Registration list')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Lottery by session')).toBeInTheDocument();
  });

  it('shows admin viewer warning when role is read-only', async () => {
    adminMocks.useAuthMock.mockReturnValue({ user: { role: 'ADMIN_VIEWER' } });

    render(<AdminConsolePage />);
    expect(await screen.findByText('You are signed in as ADMIN_VIEWER (read-only)')).toBeInTheDocument();
  });

  it('renders draft events tab when drafts exist', async () => {
    adminMocks.adminGetEvents.mockResolvedValue(draftEventList);

    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: /Draft events/ }));

    expect(await screen.findByText('Draft Family Day')).toBeInTheDocument();
    expect(screen.getByText('Load for edit')).toBeInTheDocument();
  });

  it('exports registrations as CSV from the dashboard tab', async () => {
    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    await screen.findByText('Export CSV');

    fireEvent.click(screen.getByText('Export CSV'));

    await waitFor(() => {
      expect(adminMocks.adminExportSync).toHaveBeenCalledWith('evt-1', { format: 'csv', mask_pii: true });
    });
  });

  it('runs session lottery after confirmation', async () => {
    const confirmSpy = mockModalConfirmOk();

    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run lottery' }));

    await waitFor(() => {
      expect(adminMocks.adminRunLottery).toHaveBeenCalledWith('sess-1');
    });
    confirmSpy.mockRestore();
  });

  it('runs instant lottery for all pending sessions', async () => {
    const confirmSpy = mockModalConfirmOk();

    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run lottery now' }));

    await waitFor(() => {
      expect(adminMocks.adminRunLottery).toHaveBeenCalledWith('sess-1');
    });
    confirmSpy.mockRestore();
  });

  it('creates a draft event from the create form', async () => {
    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(getCreateActions().getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => {
      expect(adminMocks.adminCreateEvent).toHaveBeenCalled();
      expect(adminMocks.adminCreateSession).toHaveBeenCalled();
    });
  });

  it('creates and publishes a new event', async () => {
    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(getCreateActions().getByRole('button', { name: 'Publish' }));

    await waitFor(() => {
      expect(adminMocks.adminCreateEvent).toHaveBeenCalled();
      expect(adminMocks.adminPublishEvent).toHaveBeenCalledWith('new-evt-1');
    });
  });

  it('cancels the selected event with a reason', async () => {
    const confirmSpy = mockModalConfirmOk();

    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete event' }));

    await waitFor(() => {
      expect(adminMocks.adminCancelEvent).toHaveBeenCalledWith('evt-1', 'Temporary cancellation');
      expect(refreshListMock).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
  });

  it('loads a draft event into edit mode and saves changes', async () => {
    adminMocks.adminGetEvents.mockResolvedValue(draftEventList);
    adminMocks.adminGetEvent.mockResolvedValue(draftEventDetail);

    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: /Draft events/ }));
    fireEvent.click(await screen.findByText('Load for edit'));

    await waitFor(() => {
      expect(adminMocks.adminGetEvent).toHaveBeenCalledWith('draft-1');
    });
    expect(await screen.findByDisplayValue('Draft Family Day')).toBeInTheDocument();

    fireEvent.click(getCreateActions().getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => {
      expect(adminMocks.adminPatchEvent).toHaveBeenCalledWith('draft-1', expect.any(Object));
    });
  });

  it('publishes a draft event from the dashboard tab', async () => {
    adminMocks.adminGetEvents.mockResolvedValue(draftEventList);

    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publish event' }));

    await waitFor(() => {
      expect(adminMocks.adminPublishEvent).toHaveBeenCalledWith('draft-1');
    });
  });

  it('publishes a draft directly from the drafts table', async () => {
    adminMocks.adminGetEvents.mockResolvedValue(draftEventList);

    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: /Draft events/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));

    await waitFor(() => {
      expect(adminMocks.adminPublishEvent).toHaveBeenCalledWith('draft-1');
    });
  });

  it('deletes a draft from the drafts table', async () => {
    adminMocks.adminGetEvents.mockResolvedValue(draftEventList);
    const confirmSpy = mockModalConfirmOk();

    render(<AdminConsolePage />);
    await screen.findByText('Admin console');
    fireEvent.click(screen.getByRole('tab', { name: /Draft events/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(adminMocks.adminCancelEvent).toHaveBeenCalledWith('draft-1', 'DeleteDraft');
    });
    confirmSpy.mockRestore();
  });
});
