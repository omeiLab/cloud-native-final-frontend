import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EventsList from '../EventsList';

const getEventsMock = vi.fn();
const getEventMock = vi.fn();
const startOIDCLoginMock = vi.fn();

const eventsListMocks = vi.hoisted(() => ({
  user: { role: 'EMPLOYEE', id: 'u1' },
  authLoading: false
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    getEvents: (...args) => getEventsMock(...args),
    getEvent: (...args) => getEventMock(...args)
  }
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: eventsListMocks.user,
    loading: eventsListMocks.authLoading,
    startOIDCLogin: startOIDCLoginMock
  })
}));

describe('EventsList page', () => {
  beforeEach(() => {
    eventsListMocks.user = { role: 'EMPLOYEE', id: 'u1' };
    eventsListMocks.authLoading = false;
    getEventsMock.mockReset();
    getEventMock.mockReset();
    getEventsMock.mockResolvedValue({
      data: {
        items: [{
          id: 'evt-1',
          title: 'Spring Family Day',
          status: 'PUBLISHED',
          is_registration_open: true,
          is_eligible: true,
          session_count: 1
        }],
        has_next: false
      }
    });
    getEventMock.mockResolvedValue({
      data: {
        id: 'evt-1',
        sessions: [{
          id: 'sess-1',
          venue: 'Hsinchu plaza',
          registration_opens_at: '2026-05-01T00:00:00+08:00',
          registration_closes_at: '2026-12-31T23:59:59+08:00',
          status: 'REGISTRATION_OPEN',
          ticket_types: [{ quota: 100 }]
        }]
      }
    });
  });

  it('renders loaded events for authenticated employees', async () => {
    render(
      <MemoryRouter>
        <EventsList />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Event catalog')).toBeInTheDocument();
    });
    expect(await screen.findByText('Spring Family Day')).toBeInTheDocument();
    expect(getEventsMock).toHaveBeenCalled();
  });

  it('renders guest hero and sign-in action when unauthenticated', async () => {
    eventsListMocks.user = null;

    render(
      <MemoryRouter>
        <EventsList />
      </MemoryRouter>
    );

    expect(await screen.findByText('CETS Events')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(startOIDCLoginMock).toHaveBeenCalled();
  });

  it('filters events by keyword and refreshes the list', async () => {
    render(
      <MemoryRouter>
        <EventsList />
      </MemoryRouter>
    );

    await screen.findByText('Spring Family Day');
    const searchInput = screen.getByLabelText('Search events, venue, or site');
    fireEvent.change(searchInput, { target: { value: 'Family' } });

    await waitFor(() => {
      expect(screen.getByText('Spring Family Day')).toBeInTheDocument();
    });

    getEventsMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => {
      expect(getEventsMock).toHaveBeenCalled();
    });
  });
});
