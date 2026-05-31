import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from '../LoginPage';

const startOIDCLoginMock = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ startOIDCLogin: startOIDCLoginMock })
}));

describe('LoginPage', () => {
  it('renders enterprise login CTA and triggers OIDC login', async () => {
    startOIDCLoginMock.mockResolvedValue(undefined);
    render(<LoginPage />);

    expect(screen.getByText('TSMC employee event platform')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Corporate sign-in/ }));
    expect(startOIDCLoginMock).toHaveBeenCalled();
  });

  it('shows an error message when OIDC login fails', async () => {
    startOIDCLoginMock.mockRejectedValue({ error: { message: 'Backend unavailable' } });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /Corporate sign-in/ }));
    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument();
  });
});
