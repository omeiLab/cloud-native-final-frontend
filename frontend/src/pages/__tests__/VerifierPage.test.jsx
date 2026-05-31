import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VerifierPage from '../VerifierPage';

const controllerMock = vi.fn();

vi.mock('../verifier/useVerifierController', () => ({
  useVerifierController: () => controllerMock()
}));

describe('VerifierPage', () => {
  it('renders idle scanner UI', () => {
    controllerMock.mockReturnValue({
      videoRef: { current: null },
      state: {
        deviceId: 'scanner-A-01',
        error: '',
        manualPayload: '',
        result: null,
        scannerHint: 'Scanner idle',
        scanning: false
      },
      statusTone: 'idle',
      handleStartScan: vi.fn(),
      handleStopScan: vi.fn(),
      handleDeviceIdChange: vi.fn(),
      handleManualPayloadChange: vi.fn(),
      handleManualVerify: vi.fn()
    });

    render(<VerifierPage />);
    expect(screen.getByText('Ticket verification')).toBeInTheDocument();
    expect(screen.getByText('Start camera scan')).toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('renders success and error result panels', () => {
    controllerMock.mockReturnValue({
      videoRef: { current: null },
      state: {
        deviceId: 'scanner-A-01',
        error: 'Ticket already verified',
        manualPayload: 'payload',
        result: {
          ok: true,
          data: {
            ticket_id: 't-1',
            user_name: 'Alice',
            used_at: '2026-05-30'
          }
        },
        scannerHint: 'Verified — entry allowed',
        scanning: true
      },
      statusTone: 'success',
      handleStartScan: vi.fn(),
      handleStopScan: vi.fn(),
      handleDeviceIdChange: vi.fn(),
      handleManualPayloadChange: vi.fn(),
      handleManualVerify: vi.fn()
    });

    render(<VerifierPage />);
    expect(screen.getByText('Scanning')).toBeInTheDocument();
    expect(screen.getByText('Verification succeeded')).toBeInTheDocument();
    expect(screen.getByText('Ticket already verified')).toBeInTheDocument();
    expect(screen.getByText('Stop scanning')).toBeInTheDocument();
  });
});
