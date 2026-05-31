import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithRouter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import { Modal } from 'antd';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,abc')
  }
}));

import UserProfile from '../UserProfile';

const logoutMock = vi.fn();
const profileMocks = vi.hoisted(() => ({
  getMyRegistrations: vi.fn(),
  getMyTickets: vi.fn(),
  getTicketQR: vi.fn(),
  forfeitRegistration: vi.fn(),
  getEvent: vi.fn(),
  getEvents: vi.fn(),
  getNotifications: vi.fn()
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      name: 'Alice',
      email: 'alice@example.com',
      role: 'EMPLOYEE',
      employee_id: 'E001',
      department: 'IT',
      site: 'HSINCHU',
      status: 'ACTIVE'
    },
    logout: logoutMock
  })
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    getMyRegistrations: profileMocks.getMyRegistrations,
    getMyTickets: profileMocks.getMyTickets,
    getTicketQR: profileMocks.getTicketQR,
    forfeitRegistration: profileMocks.forfeitRegistration,
    getNotifications: profileMocks.getNotifications,
    getEvent: profileMocks.getEvent,
    getEvents: profileMocks.getEvents
  }
}));

describe('UserProfile page', () => {
  beforeEach(() => {
    profileMocks.getEvent.mockResolvedValue({ data: null });
    profileMocks.getEvents.mockResolvedValue({ data: { items: [], has_next: false } });
    profileMocks.getNotifications.mockResolvedValue({ data: { items: [] } });
    profileMocks.getTicketQR.mockResolvedValue({
      data: {
        qr_payload: 'QR-PAYLOAD-123',
        qr_expires_at: dayjs().add(2, 'minute').toISOString()
      }
    });
    profileMocks.forfeitRegistration.mockResolvedValue({});
    profileMocks.getMyRegistrations.mockResolvedValue({
      data: {
        items: [{
          id: 'reg-1',
          status: 'CONFIRMED',
          event_title: 'Spring Family Day',
          session_title: 'Session 1',
          ticket_type_name: 'Adult ticket'
        }]
      }
    });
    profileMocks.getMyTickets.mockResolvedValue({
      data: {
        items: [{
          id: 'ticket-1',
          registration_id: 'reg-1',
          status: 'ISSUED',
          issued_at: '2026-05-01T10:00:00+08:00',
          event_title: 'Spring Family Day',
          session_title: 'Session 1',
          ticket_type_name: 'Adult ticket'
        }]
      }
    });
  });

  it('renders profile header and tabs after loading', async () => {
    renderWithProviders(<UserProfile />);
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Employee info')).toBeInTheDocument();
    });
    expect(screen.getByText('My registrations')).toBeInTheDocument();
    expect(screen.getByText('My tickets')).toBeInTheDocument();
  });

  it('renders ticket cards in the default tickets tab', async () => {
    renderWithProviders(<UserProfile />);
    expect(await screen.findByText('Spring Family Day')).toBeInTheDocument();
    expect(screen.getByText('Forfeit ticket')).toBeInTheDocument();
    expect(screen.getByText('Issued')).toBeInTheDocument();
  });

  it('switches to registrations tab', async () => {
    renderWithProviders(<UserProfile />);
    await screen.findByText(/Alice/);
    fireEvent.click(screen.getByText('My registrations'));
    await waitFor(() => {
      expect(screen.getAllByText('Spring Family Day').length).toBeGreaterThan(0);
    });
  });

  it('opens ticket QR modal when an issued ticket card is clicked', async () => {
    renderWithProviders(<UserProfile />);
    const title = await screen.findByText('Spring Family Day');
    fireEvent.click(title.closest('.ant-card'));

    expect(await screen.findByText('Ticket details')).toBeInTheDocument();
    await waitFor(() => {
      expect(profileMocks.getTicketQR).toHaveBeenCalledWith('ticket-1');
    });
    expect(await screen.findByAltText('ticket qr')).toBeInTheDocument();
  });

  it('forfeits a ticket after confirmation', async () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(({ onOk }) => {
      Promise.resolve(onOk?.());
      return { destroy: vi.fn(), update: vi.fn() };
    });

    renderWithProviders(<UserProfile />);
    await screen.findByText('Forfeit ticket');
    fireEvent.click(screen.getByText('Forfeit ticket'));

    await waitFor(() => {
      expect(profileMocks.forfeitRegistration).toHaveBeenCalledWith('reg-1');
    });
    confirmSpy.mockRestore();
  });

  it('closes ticket QR modal from the dialog', async () => {
    renderWithProviders(<UserProfile />);
    const title = await screen.findByText('Spring Family Day');
    fireEvent.click(title.closest('.ant-card'));
    const modal = await screen.findByRole('dialog');
    expect(modal).toBeInTheDocument();

    fireEvent.click(modal.querySelector('.ant-modal-close'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('enriches registration titles from event detail API', async () => {
    profileMocks.getMyRegistrations.mockResolvedValue({
      data: {
        items: [{
          id: 'reg-2',
          event_id: 'evt-2',
          session_id: 'sess-2',
          ticket_type_id: 'tt-2',
          status: 'CONFIRMED',
          created_at: '2026-05-01T10:00:00+08:00'
        }]
      }
    });
    profileMocks.getMyTickets.mockResolvedValue({ data: { items: [] } });
    profileMocks.getEvent.mockResolvedValue({
      data: {
        id: 'evt-2',
        title: 'Enriched Family Day',
        sessions: [{
          id: 'sess-2',
          title: 'Morning session',
          ticket_types: [{ id: 'tt-2', name: 'Adult ticket' }]
        }]
      }
    });

    renderWithProviders(<UserProfile />);
    await screen.findByText('My registrations');
    fireEvent.click(screen.getByText('My registrations'));
    expect(await screen.findByText('Enriched Family Day')).toBeInTheDocument();
    expect(await screen.findByText(/Morning session/)).toBeInTheDocument();
  });
});
