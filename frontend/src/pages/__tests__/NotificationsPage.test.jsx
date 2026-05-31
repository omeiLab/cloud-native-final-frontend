import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithRouter';
import { describe, expect, it, vi } from 'vitest';
import NotificationsPage from '../NotificationsPage';

const refreshListMock = vi.fn().mockResolvedValue(undefined);
const markReadMock = vi.fn();
const markAllReadMock = vi.fn();

vi.mock('../../context/NotificationContext', () => ({
  useNotifications: () => ({
    items: [{
      id: 'n1',
      title: 'Registration succeeded ??Spring Family Day',
      body: 'You registered successfully',
      type: 'REGISTRATION_CONFIRMED',
      created_at: '2026-05-30T10:00:00+08:00'
    }],
    unreadCount: 1,
    refreshList: refreshListMock,
    markRead: markReadMock,
    markAllRead: markAllReadMock
  })
}));

describe('NotificationsPage', () => {
  it('renders notifications and supports mark-all-read', async () => {
    renderWithProviders(<NotificationsPage />);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(await screen.findByText('Registration succeeded ??Spring Family Day')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Mark all read'));
    expect(markAllReadMock).toHaveBeenCalled();
  });

  it('marks a single notification as read when clicked', async () => {
    renderWithProviders(<NotificationsPage />);
    fireEvent.click(await screen.findByText('Mark read'));
    expect(markReadMock).toHaveBeenCalledWith('n1');
  });
});
