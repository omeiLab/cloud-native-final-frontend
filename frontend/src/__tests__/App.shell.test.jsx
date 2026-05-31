import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/renderWithRouter';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../pages/EventsList', () => ({ default: () => <div>Events Home</div> }));
vi.mock('../pages/EventDetail', () => ({ default: () => <div>Event Detail</div> }));
vi.mock('../pages/UserProfile', () => ({ default: () => <div>Profile</div> }));
vi.mock('../pages/NotificationsPage', () => ({ default: () => <div>Notifications</div> }));
vi.mock('../pages/AdminConsolePage', () => ({ default: () => <div>Admin</div> }));
vi.mock('../pages/VerifierPage', () => ({ default: () => <div>Verify</div> }));
vi.mock('../pages/LoginPage', () => ({ default: () => <div>Login</div> }));
vi.mock('../pages/ApiExplorerPage', () => ({ default: () => <div>API Explorer</div> }));
vi.mock('../pages/OIDCCallbackPage', () => ({ default: () => <div>OIDC</div> }));
vi.mock('../components/Header', () => ({ default: () => <header>Header</header> }));
vi.mock('../components/MobileBottomBar', () => ({ default: () => <nav>Bottom</nav> }));
vi.mock('../components/BackgroundMusic', () => ({ default: () => <div data-testid="bg-music">music</div> }));

const authState = vi.hoisted(() => ({
  user: { role: 'EMPLOYEE' },
  loading: false
}));

vi.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => authState
}));

vi.mock('../context/NotificationContext', () => ({
  NotificationProvider: ({ children }) => children,
  useNotifications: () => ({ unreadCount: 0, connected: true })
}));

import App from '../App';

describe('App shell', () => {
  it('renders layout, footer, and background music on standard routes', async () => {
    renderWithProviders(<App />);
    expect(await screen.findByText('Events Home')).toBeInTheDocument();
    expect(screen.getByText(/CETS Events/)).toBeInTheDocument();
    expect(screen.getByTestId('bg-music')).toBeInTheDocument();
  });
});
