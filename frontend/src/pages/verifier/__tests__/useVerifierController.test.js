import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChecksumException, FormatException, NotFoundException } from '@zxing/library';
import {
  formatVerifyError,
  getScannerMissHint,
  isScannerMiss,
  useVerifierController,
  verifierReducer
} from '../useVerifierController';

const verifyTicketMock = vi.fn();

vi.mock('../../../api/client', () => ({
  apiClient: {
    verifyTicket: (...args) => verifyTicketMock(...args)
  }
}));

const decodeFromConstraintsMock = vi.fn();

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: vi.fn().mockImplementation(() => ({
    decodeFromConstraints: (...args) => decodeFromConstraintsMock(...args)
  }))
}));

const initialState = {
  scanning: false,
  result: null,
  error: '',
  deviceId: 'scanner-A-01',
  manualPayload: '',
  scannerHint: 'Scanner idle',
  lastDetectedText: '',
  lastDetectedAt: ''
};

describe('verifierReducer', () => {
  it('handles scan lifecycle transitions', () => {
    expect(verifierReducer(initialState, { type: 'scanStarting' })).toMatchObject({
      scanning: true,
      scannerHint: 'Initializing camera…'
    });
    expect(verifierReducer(initialState, { type: 'scanReady' })).toMatchObject({
      scanning: true,
      scannerHint: 'Camera ready — waiting for QR code'
    });
    expect(verifierReducer(initialState, { type: 'scanStopped' })).toMatchObject({
      scanning: false,
      scannerHint: 'Scanning stopped'
    });
    expect(verifierReducer(initialState, {
      type: 'scanFailed',
      error: 'Camera failed',
      hint: 'Initialization failed'
    })).toMatchObject({
      scanning: false,
      error: 'Camera failed',
      scannerHint: 'Initialization failed'
    });
  });

  it('handles verify success and failure states', () => {
    const detected = verifierReducer(initialState, {
      type: 'qrDetected',
      text: 'qr-1',
      detectedAt: '2026-01-01'
    });
    expect(detected.scannerHint).toBe('QR detected — verifying…');

    const success = verifierReducer(detected, { type: 'verifySuccess', data: { ticket_id: 't1' } });
    expect(success.result).toEqual({ ok: true, data: { ticket_id: 't1' } });

    const failed = verifierReducer(detected, { type: 'verifyFailed', error: 'Invalid ticket' });
    expect(failed.error).toBe('Invalid ticket');
  });

  it('updates device and manual payload fields', () => {
    expect(verifierReducer(initialState, { type: 'deviceIdChanged', value: 'dev-2' }).deviceId).toBe('dev-2');
    expect(verifierReducer(initialState, { type: 'manualPayloadChanged', value: 'payload' }).manualPayload).toBe('payload');
    expect(verifierReducer(initialState, { type: 'unknown' })).toEqual(initialState);
  });
});

describe('formatVerifyError', () => {
  it('formats API and plain errors', () => {
    expect(formatVerifyError({ error: { message: 'Ticket already used' } })).toBe('Ticket already used');
    expect(formatVerifyError({ message: 'Network error' })).toBe('Network error');
    expect(formatVerifyError({})).toBe('Verification failed');
    expect(formatVerifyError({
      error: {
        message: 'Invalid ticket',
        details: { ticket_id: 't1', request_id: 'req-1', gate: 'A' }
      }
    })).toBe('Invalid ticket（ticket_id: t1 · gate: A）');
  });
});

describe('scanner miss helpers', () => {
  it('classifies transient decode errors', () => {
    expect(isScannerMiss(NotFoundException.getNotFoundInstance())).toBe(true);
    expect(isScannerMiss(FormatException.getFormatInstance())).toBe(true);
    expect(isScannerMiss(ChecksumException.getChecksumInstance())).toBe(true);
    expect(isScannerMiss('No QR code found')).toBe(true);
    expect(isScannerMiss(new Error('camera denied'))).toBe(false);
  });

  it('returns actionable hints for scanner misses', () => {
    expect(getScannerMissHint(FormatException.getFormatInstance())).toContain('incomplete');
    expect(getScannerMissHint(NotFoundException.getNotFoundInstance())).toContain('QR code not detected yet');
  });
});

describe('useVerifierController', () => {
  beforeEach(() => {
    verifyTicketMock.mockReset();
    decodeFromConstraintsMock.mockReset();
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn() }
    });
  });

  it('verifies manual payload successfully', async () => {
    verifyTicketMock.mockResolvedValue({ data: { ticket_id: 't-100' } });
    const { result } = renderHook(() => useVerifierController());

    act(() => {
      result.current.handleDeviceIdChange('gate-A');
      result.current.handleManualPayloadChange('qr-payload-1');
    });

    await act(async () => {
      result.current.handleManualVerify();
    });

    await waitFor(() => {
      expect(result.current.state.result?.ok).toBe(true);
    });
    expect(verifyTicketMock).toHaveBeenCalledWith({
      qr_payload: 'qr-payload-1',
      device_id: 'gate-A'
    });
    expect(result.current.statusTone).toBe('success');
  });

  it('surfaces verify failures from the API', async () => {
    verifyTicketMock.mockRejectedValue({
      error: { message: 'Ticket already verified', details: { ticket_id: 't-1' } }
    });
    const { result } = renderHook(() => useVerifierController());

    act(() => {
      result.current.handleDeviceIdChange('gate-A');
      result.current.handleManualPayloadChange('qr-payload-2');
    });

    await act(async () => {
      result.current.handleManualVerify();
    });

    await waitFor(() => {
      expect(result.current.state.error).toContain('Ticket already verified');
    });
    expect(result.current.statusTone).toBe('error');
  });

  it('rejects empty manual payload before calling API', async () => {
    const { result } = renderHook(() => useVerifierController());

    act(() => {
      result.current.handleDeviceIdChange('gate-A');
      result.current.handleManualPayloadChange('   ');
    });

    await act(async () => {
      result.current.handleManualVerify();
    });

    await waitFor(() => {
      expect(result.current.state.error).toContain('QR payload');
    });
    expect(verifyTicketMock).not.toHaveBeenCalled();
  });

  it('blocks scan start outside secure context', async () => {
    vi.stubGlobal('isSecureContext', false);
    const { result } = renderHook(() => useVerifierController());

    await act(async () => {
      await result.current.handleStartScan();
    });

    expect(result.current.state.error).toContain('HTTPS/localhost');
    expect(decodeFromConstraintsMock).not.toHaveBeenCalled();
  });

  it('starts and stops camera scanning', async () => {
    const stopMock = vi.fn();
    decodeFromConstraintsMock.mockResolvedValue({ stop: stopMock });
    const { result } = renderHook(() => useVerifierController());

    await act(async () => {
      await result.current.handleStartScan();
    });

    expect(result.current.state.scanning).toBe(true);
    expect(decodeFromConstraintsMock).toHaveBeenCalled();

    act(() => {
      result.current.handleStopScan();
    });

    expect(stopMock).toHaveBeenCalled();
    expect(result.current.state.scanning).toBe(false);
  });

  it('verifies QR codes detected by the camera scanner', async () => {
    verifyTicketMock.mockResolvedValue({ data: { ticket_id: 't-scan' } });
    let scanCallback;
    decodeFromConstraintsMock.mockImplementation(async (_constraints, _video, callback) => {
      scanCallback = callback;
      return { stop: vi.fn() };
    });

    const { result } = renderHook(() => useVerifierController());
    result.current.videoRef.current = document.createElement('video');

    await act(async () => {
      await result.current.handleStartScan();
    });

    await act(async () => {
      scanCallback({ getText: () => 'camera-qr-payload' }, null);
    });

    await waitFor(() => {
      expect(verifyTicketMock).toHaveBeenCalledWith({
        qr_payload: 'camera-qr-payload',
        device_id: 'scanner-A-01'
      });
    });
  });

  it('blocks scan start when mediaDevices is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const { result } = renderHook(() => useVerifierController());

    await act(async () => {
      await result.current.handleStartScan();
    });

    expect(result.current.state.error).toContain('does not support the camera API');
  });
});
