import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileBottomBar from '../MobileBottomBar';

const mobileMocks = vi.hoisted(() => ({
  user: { role: 'EMPLOYEE' },
  unreadCount: 1
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mobileMocks.user })
}));

vi.mock('../../context/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: mobileMocks.unreadCount })
}));

describe('MobileBottomBar', () => {
  beforeEach(() => {
    mobileMocks.user = { role: 'EMPLOYEE' };
    mobileMocks.unreadCount = 1;
  });

  it('renders employee navigation links', () => {
    render(
      <MemoryRouter>
        <MobileBottomBar />
      </MemoryRouter>
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.getByText('Tickets')).toBeInTheDocument();
  });

  it('renders admin navigation for admin users', () => {
    mobileMocks.user = { role: 'ADMIN' };

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <MobileBottomBar />
      </MemoryRouter>
    );

    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('Tickets')).not.toBeInTheDocument();
  });

  it('renders verifier navigation for verifier users', () => {
    mobileMocks.user = { role: 'VERIFIER' };

    render(
      <MemoryRouter initialEntries={['/verify']}>
        <MobileBottomBar />
      </MemoryRouter>
    );

    expect(screen.getByText('Verify')).toBeInTheDocument();
  });

  it('renders nothing for guests', () => {
    mobileMocks.user = null;

    const { container } = render(
      <MemoryRouter>
        <MobileBottomBar />
      </MemoryRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
