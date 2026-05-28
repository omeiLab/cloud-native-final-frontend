import { useCallback, useEffect, useReducer, useRef } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';
import { apiClient } from '../../api/client';

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

const formatVerifyError = (e) => {
  const msg = e?.error?.message || e?.message || '核銷失敗';
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

const isScannerMiss = (error) => (
  error instanceof NotFoundException ||
  /NotFoundException|No MultiFormat Readers|No QR code|not found/i.test(String(error || ''))
);

const initialVerifierState = {
  scanning: false,
  result: null,
  error: '',
  deviceId: DEFAULT_VERIFIER_DEVICE_ID,
  manualPayload: '',
  scannerHint: '尚未啟動掃描',
  lastDetectedText: '',
  lastDetectedAt: ''
};

const verifierReducer = (state, action) => {
  switch (action.type) {
    case 'scanStarting':
      return {
        ...state,
        scanning: true,
        error: '',
        result: null,
        scannerHint: '正在初始化相機...'
      };
    case 'scanReady':
      return {
        ...state,
        scanning: true,
        scannerHint: '相機已啟動，等待辨識 QR...'
      };
    case 'scanStopped':
      return {
        ...state,
        scanning: false,
        scannerHint: '已停止掃描'
      };
    case 'scanFailed':
      return {
        ...state,
        scanning: false,
        error: action.error,
        scannerHint: action.hint
      };
    case 'scanMissed':
      return { ...state, scannerHint: '尚未辨識到 QR，請靠近並保持對焦' };
    case 'qrDetected':
      return {
        ...state,
        result: null,
        error: '',
        lastDetectedText: action.text,
        lastDetectedAt: action.detectedAt,
        scannerHint: '已辨識到 QR，送出核銷中...'
      };
    case 'scannerMessage':
      return { ...state, scannerHint: action.message };
    case 'verifySuccess':
      return {
        ...state,
        result: { ok: true, data: action.data },
        error: '',
        scannerHint: '核銷成功：可入場'
      };
    case 'verifyFailed':
      return {
        ...state,
        result: null,
        error: action.error,
        scannerHint: '核銷失敗：請查看下方錯誤訊息'
      };
    case 'deviceIdChanged':
      return { ...state, deviceId: action.value };
    case 'manualPayloadChanged':
      return { ...state, manualPayload: action.value };
    default:
      return state;
  }
};

export const useVerifierController = () => {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastScanRef = useRef({ text: '', at: 0 });
  const lastNotFoundLogAtRef = useRef(0);
  const verifyPayloadRef = useRef(null);
  const deviceIdRef = useRef(DEFAULT_VERIFIER_DEVICE_ID);
  const manualPayloadRef = useRef('');
  const [state, dispatch] = useReducer(verifierReducer, initialVerifierState);

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
    const currentPayload = String(qrPayload || '').trim();
    dispatch({ type: 'qrDetected', text: currentPayload, detectedAt: new Date().toLocaleString() });
    try {
      if (!currentPayload) {
        throw new Error('請先提供 QR payload。');
      }
      const currentDeviceId = String(deviceIdRef.current || '').trim();
      if (!currentDeviceId) {
        throw new Error('驗票裝置 ID 尚未設定。');
      }
      const res = await apiClient.verifyTicket({ qr_payload: currentPayload, device_id: currentDeviceId });
      dispatch({ type: 'verifySuccess', data: res.data });
      playTone('success');
    } catch (e) {
      dispatch({ type: 'verifyFailed', error: formatVerifyError(e) });
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
    if (!window.isSecureContext) {
      dispatch({
        type: 'scanFailed',
        error: '目前網址不是安全來源（HTTPS/localhost），手機 Chrome 會封鎖相機。',
        hint: '安全性檢查失敗：目前不是 HTTPS/localhost'
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({
        type: 'scanFailed',
        error: '目前瀏覽器不支援相機 API。',
        hint: '瀏覽器不支援 mediaDevices.getUserMedia'
      });
      return;
    }

    releaseScanner();
    dispatch({ type: 'scanStarting' });
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
              dispatch({ type: 'scanMissed' });
              lastNotFoundLogAtRef.current = Date.now();
            }
            return;
          }
          if (scanErr) {
            dispatch({ type: 'scannerMessage', message: `掃描器訊息：${String(scanErr).slice(0, 80)}` });
          }
        }
      );
      scannerControlsRef.current = controls;
      dispatch({ type: 'scanReady' });
    } catch {
      releaseScanner();
      dispatch({
        type: 'scanFailed',
        error: '相機掃碼啟動失敗。',
        hint: '相機初始化失敗'
      });
    }
  }, [releaseScanner]);

  const handleStopScan = useCallback(() => {
    releaseScanner();
    dispatch({ type: 'scanStopped' });
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
