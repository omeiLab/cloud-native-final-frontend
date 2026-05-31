import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithRouter';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppHeader from '../Header';

const logoutMock = vi.fn();
const startOIDCLoginMock = vi.fn();
const setTextScaleMock = vi.fn();

const headerMocks = vi.hoisted(() => ({
  user: { role: 'EMPLOYEE', name: 'Alice' },
  unreadCount: 2,
  connected: true
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: headerMocks.user,
    logout: logoutMock,
    startOIDCLogin: startOIDCLoginMock
  })
}));

vi.mock('../../context/NotificationContext', () => ({
  useNotifications: () => ({
    unreadCount: headerMocks.unreadCount,
    connected: headerMocks.connected
  })
}));

vi.mock('../../context/UiPreferencesContext', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useUiPreferences: () => ({
      colorMode: 'dark',
      textScale: 'large',
      setTextScale: setTextScaleMock,
      locale: 'en',
      setLocale: vi.fn(),
      antdConfig: { theme: {} }
    })
  };
});

describe('Header', () => {
  beforeEach(() => {
    headerMocks.user = { role: 'EMPLOYEE', name: 'Alice' };
    headerMocks.unreadCount = 2;
    headerMocks.connected = true;
    logoutMock.mockReset();
    startOIDCLoginMock.mockReset();
    setTextScaleMock.mockReset();
  });

  it('renders employee navigation actions', () => {
    renderWithProviders(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );

    expect(screen.getByText('CETS Events')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Open account menu'));
    expect(screen.getByText('My tickets')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('shows admin console link for admin users', () => {
    headerMocks.user = { role: 'ADMIN', name: 'Admin User' };

    renderWithProviders(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText('Open account menu'));
    expect(screen.getByText('Admin console')).toBeInTheDocument();
    expect(screen.queryByText('My tickets')).not.toBeInTheDocument();
  });

  it('shows verifier portal link for verifier users', () => {
    headerMocks.user = { role: 'VERIFIER', name: 'Verifier User' };

    renderWithProviders(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText('Open account menu'));
    expect(screen.getByText('Verifier portal')).toBeInTheDocument();
  });

  it('shows sign in button for guests and triggers OIDC login', async () => {
    headerMocks.user = null;
    startOIDCLoginMock.mockResolvedValue(undefined);

    renderWithProviders(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' })[0]);
    expect(startOIDCLoginMock).toHaveBeenCalled();
  });

  it('opens mobile navigation drawer with account links', () => {
    renderWithProviders(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText('Open navigation menu'));
    expect(screen.getByText('Navigation menu')).toBeInTheDocument();
    expect(screen.getByText('My tickets')).toBeInTheDocument();
  });

  it('cycles text scale when the font size button is clicked', () => {
    renderWithProviders(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Large|Extra large|Standard/i }));
    expect(setTextScaleMock).toHaveBeenCalledWith('xlarge');
  });
});
