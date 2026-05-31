import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import OIDCCallbackPage from '../OIDCCallbackPage';

const finishOIDCLoginMock = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ finishOIDCLogin: finishOIDCLoginMock })
}));

describe('OIDCCallbackPage', () => {
  it('shows error when callback params are missing', () => {
    render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <Routes>
          <Route path="/auth/callback" element={<OIDCCallbackPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/Missing OIDC callback parameters/)).toBeInTheDocument();
  });

  it('completes login and redirects on success', async () => {
    finishOIDCLoginMock.mockResolvedValue({ role: 'EMPLOYEE' });
    render(
      <MemoryRouter initialEntries={['/auth/callback?code=abc&state=xyz']}>
        <Routes>
          <Route path="/auth/callback" element={<OIDCCallbackPage />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(finishOIDCLoginMock).toHaveBeenCalledWith({ code: 'abc', state: 'xyz' });
    });
  });
});
