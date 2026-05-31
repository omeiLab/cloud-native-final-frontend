import { useCallback, useEffect, useReducer, useRef } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import {
  BarcodeFormat,
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException
} from '@zxing/library';
import { apiClient } from '../../api/client';
import { messages as enMessages } from '../../i18n/en';

const DEFAULT_VERIFIER_COPY = enMessages.verifier;

const DEFAULT_VERIFIER_DEVICE_ID = import.meta.env.VITE_VERIFIER_DEVICE_ID || 'scanner-A-01';
const SCAN_DEDUP_MS = 3500;
const NOT_FOUND_HINT_INTERVAL_MS = 1800;

const QR_HINTS = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]],
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.CHARACTER_SET, 'UTF-8']
]);

const QR_READER_OPTIONS = {
  delayBetweenScanAttempts: 120,
  delayBetweenScanSuccess: 900,
  tryPlayVideoTimeout: 8000
};

export const formatVerifyError = (e, fallback = 'Verification failed') => {
  const msg = e?.error?.message || e?.message || fallback;
  const details = e?.error?.details;
  if (!details || typeof details !== 'object') {
    return msg;
  }
  const extra = Object.entries(details).reduce((parts, [key, value]) => {
    if (key !== 'request_id') {
      parts.push(`${key}: ${value}`);
    }
    return parts;
  }, []);
  return extra.length ? `${msg}（${extra.join(' · ')}）` : msg;
};

const buildVideoConstraints = () => ({
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
    advanced: [
      { focusMode: 'continuous' },
      { exposureMode: 'continuous' },
      { whiteBalanceMode: 'continuous' }
    ]
  }
});

export const isScannerMiss = (error) => (
  error instanceof NotFoundException ||
  error instanceof FormatException ||
  error instanceof ChecksumException ||
  /NotFoundException|FormatException|ChecksumException|No MultiFormat Readers|No QR code|not found/i.test(String(error || ''))
);

export const getScannerMissHint = (error, copy) => (
  error instanceof FormatException ||
  error instanceof ChecksumException ||
  /FormatException|ChecksumException/i.test(String(error || ''))
    ? (copy?.qrBlurry || 'QR detected but frame is incomplete or blurry. Center the full code.')
    : (copy?.qrNotDetected || 'QR code not detected yet. Move closer and keep focus.')
);

const createInitialVerifierState = (copy) => ({
  scanning: false,
  result: null,
  error: '',
  deviceId: DEFAULT_VERIFIER_DEVICE_ID,
  manualPayload: '',
  scannerHint: copy?.scannerIdle || 'Scanner idle',
  lastDetectedText: '',
  lastDetectedAt: ''
});

export const verifierReducer = (state, action) => {
  switch (action.type) {
    case 'scanStarting':
      return {
        ...state,
        scanning: true,
        error: '',
        result: null,
        scannerHint: action.hint
      };
    case 'scanReady':
      return {
        ...state,
        scanning: true,
        scannerHint: action.hint
      };
    case 'scanStopped':
      return {
        ...state,
        scanning: false,
        scannerHint: action.hint
      };
    case 'scanFailed':
      return {
        ...state,
        scanning: false,
        error: action.error,
        scannerHint: action.hint
      };
    case 'scanMissed':
      return { ...state, scannerHint: action.hint };
    case 'qrDetected':
      return {
        ...state,
        result: null,
        error: '',
        lastDetectedText: action.text,
        lastDetectedAt: action.detectedAt,
        scannerHint: action.hint
      };
    case 'scannerMessage':
      return { ...state, scannerHint: action.message };
    case 'verifySuccess':
      return {
        ...state,
        result: { ok: true, data: action.data },
        error: '',
        scannerHint: action.hint
      };
    case 'verifyFailed':
      return {
        ...state,
        result: null,
        error: action.error,
        scannerHint: action.hint
      };
    case 'deviceIdChanged':
      return { ...state, deviceId: action.value };
    case 'manualPayloadChanged':
      return { ...state, manualPayload: action.value };
    case 'resetCopy':
      return { ...state, scannerHint: action.hint };
    default:
      return state;
  }
};

export const useVerifierController = (copy = DEFAULT_VERIFIER_COPY) => {
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastScanRef = useRef({ text: '', at: 0 });
  const lastNotFoundLogAtRef = useRef(0);
  const verifyPayloadRef = useRef(null);
  const deviceIdRef = useRef(DEFAULT_VERIFIER_DEVICE_ID);
  const manualPayloadRef = useRef('');
  const [state, dispatch] = useReducer(verifierReducer, copy, createInitialVerifierState);

  const { error, result, scanning } = state;
  const statusTone = error ? 'error' : result?.ok ? 'success' : scanning ? 'scanning' : 'idle';

  const releaseScanner = useCallback(() => {
    if (scannerControlsRef.current) {
      scannerControlsRef.current.stop();
      scannerControlsRef.current = null;
    }
    if (readerRef.current) {
      readerRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const playTone = useCallback((kind) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;
      const notes = kind === 'success' ? [880, 1174] : [220, 196, 165];

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.09 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.09 + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.09);
      });
    } catch {
      // Ignore audio errors in restricted browsers.
    }
  }, []);

  const verifyPayload = useCallback(async (qrPayload) => {
    const c = copyRef.current;
    const currentPayload = String(qrPayload || '').trim();
    dispatch({
      type: 'qrDetected',
      text: currentPayload,
      detectedAt: new Date().toLocaleString(),
      hint: c.qrDetected
    });
    try {
      if (!currentPayload) {
        throw new Error(c.providePayload);
      }
      const currentDeviceId = String(deviceIdRef.current || '').trim();
      if (!currentDeviceId) {
        throw new Error(c.deviceNotSet);
      }
      const res = await apiClient.verifyTicket({ qr_payload: currentPayload, device_id: currentDeviceId });
      dispatch({ type: 'verifySuccess', data: res.data, hint: c.verifiedEntry });
      playTone('success');
    } catch (e) {
      dispatch({
        type: 'verifyFailed',
        error: formatVerifyError(e, c.verifyFailedDefault),
        hint: c.verifyFailedHint
      });
      playTone('error');
    }
  }, [playTone]);

  useEffect(() => {
    verifyPayloadRef.current = verifyPayload;
  }, [verifyPayload]);

  useEffect(() => releaseScanner, [releaseScanner]);

  const handleDeviceIdChange = useCallback((value) => {
    deviceIdRef.current = value;
    dispatch({ type: 'deviceIdChanged', value });
  }, []);

  const handleManualPayloadChange = useCallback((value) => {
    manualPayloadRef.current = value;
    dispatch({ type: 'manualPayloadChanged', value });
  }, []);

  const handleManualVerify = useCallback(() => {
    verifyPayloadRef.current?.(manualPayloadRef.current);
  }, []);

  const handleStartScan = useCallback(async () => {
    const c = copyRef.current;
    if (!window.isSecureContext) {
      dispatch({
        type: 'scanFailed',
        error: c.httpsRequired,
        hint: c.httpsHint
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({
        type: 'scanFailed',
        error: c.noCameraApi,
        hint: c.noGetUserMedia
      });
      return;
    }

    releaseScanner();
    dispatch({ type: 'scanStarting', hint: c.initializing });
    const reader = new BrowserQRCodeReader(QR_HINTS, QR_READER_OPTIONS);
    readerRef.current = reader;

    try {
      const controls = await reader.decodeFromConstraints(
        buildVideoConstraints(),
        videoRef.current,
        (scanResult, scanErr) => {
          if (scanResult?.getText()) {
            const nextText = scanResult.getText();
            const nowAt = Date.now();
            if (lastScanRef.current.text === nextText && nowAt - lastScanRef.current.at < SCAN_DEDUP_MS) {
              return;
            }
            lastScanRef.current = { text: nextText, at: nowAt };
            verifyPayloadRef.current?.(nextText);
            return;
          }
          if (scanErr && isScannerMiss(scanErr)) {
            if (Date.now() - lastNotFoundLogAtRef.current > NOT_FOUND_HINT_INTERVAL_MS) {
              dispatch({ type: 'scanMissed', hint: getScannerMissHint(scanErr, copyRef.current) });
              lastNotFoundLogAtRef.current = Date.now();
            }
            return;
          }
          if (scanErr) {
            dispatch({
              type: 'scannerMessage',
              message: `${copyRef.current.scannerMessage}: ${String(scanErr).slice(0, 80)}`
            });
          }
        }
      );
      scannerControlsRef.current = controls;
      dispatch({ type: 'scanReady', hint: copyRef.current.cameraReady });
    } catch {
      releaseScanner();
      dispatch({
        type: 'scanFailed',
        error: copyRef.current.cameraInitFailed,
        hint: copyRef.current.cameraInitHint
      });
    }
  }, [releaseScanner]);

  const handleStopScan = useCallback(() => {
    releaseScanner();
    dispatch({ type: 'scanStopped', hint: copyRef.current.scanStopped });
  }, [releaseScanner]);

  return {
    videoRef,
    state,
    statusTone,
    handleStartScan,
    handleStopScan,
    handleDeviceIdChange,
    handleManualPayloadChange,
    handleManualVerify
  };
};
