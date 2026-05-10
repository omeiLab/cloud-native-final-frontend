import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Tag, Typography } from 'antd';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { apiClient } from '../api/client';
import '../styles/Verifier.css';

const { Title, Paragraph } = Typography;

const decodeJwtPayload = (jwt) => {
  try {
    const [, payload] = String(jwt || '').split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const VerifierPage = () => {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [manualPayload, setManualPayload] = useState('');
  const [deviceId, setDeviceId] = useState('scanner-A-01');
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLoadError, setEventsLoadError] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [eventDetail, setEventDetail] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [scannerHint, setScannerHint] = useState('尚未啟動掃描');
  const [lastDetectedText, setLastDetectedText] = useState('');
  const [lastDetectedAt, setLastDetectedAt] = useState('');
  const audioCtxRef = useRef(null);
  const lastScanRef = useRef({ text: '', at: 0 });
  const lastNotFoundLogAtRef = useRef(0);
  const streamRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const loadEvents = async () => {
      setEventsLoading(true);
      setEventsLoadError('');
      try {
        const merged = [];
        let page = 1;
        let hasNext = true;
        const MAX_PAGES = 50;
        while (hasNext && page <= MAX_PAGES) {
          const res = await apiClient.getEvents({ scope: 'all', page, page_size: 100 });
          if (cancelled) return;
          merged.push(...(res.data.items || []));
          hasNext = Boolean(res.data.has_next);
          page += 1;
        }
        if (cancelled) return;
        setEvents(merged);
      } catch (e) {
        if (cancelled) return;
        setEvents([]);
        setEventsLoadError(formatVerifyError(e));
      } finally {
        if (!cancelled) {
          setEventsLoading(false);
        }
      }
    };
    loadEvents();
    return () => {
      cancelled = true;
      if (readerRef.current) {
        readerRef.current.reset();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setEventDetail(null);
      setSelectedSessionId('');
      return;
    }
    apiClient
      .getEvent(selectedEventId)
      .then((res) => {
        setEventDetail(res.data);
        setSelectedSessionId('');
      })
      .catch(() => {
        setEventDetail(null);
        setSelectedSessionId('');
      });
  }, [selectedEventId]);

  const playTone = (kind) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        return;
      }
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
    } catch (e) {
      // Ignore audio errors in restricted browsers.
    }
  };

  const formatVerifyError = (e) => {
    const msg = e?.error?.message || e?.message || '核銷失敗';
    const details = e?.error?.details;
    if (details && typeof details === 'object') {
      const extra = Object.entries(details)
        .filter(([k]) => k !== 'request_id')
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      return extra ? `${msg}（${extra}）` : msg;
    }
    return msg;
  };

  const allowedSessionIds = useMemo(() => new Set((eventDetail?.sessions || []).map((s) => s.id)), [eventDetail]);
  const isSelectionReady = Boolean(selectedEventId) && (selectedSessionId ? allowedSessionIds.has(selectedSessionId) : true);

  const enforceSessionScope = (qrPayload) => {
    if (!selectedEventId) {
      throw new Error('請先選擇活動後再進行驗票，避免核銷到非本活動票券。');
    }
    const claims = decodeJwtPayload(qrPayload);
    const sid = claims?.sid;
    if (!sid) {
      throw new Error('QR 內容無法解析場次（sid），請改用有效票券 QR。');
    }
    if (eventDetail && !allowedSessionIds.has(sid)) {
      throw new Error('警示：此票券不屬於你目前選擇的活動，已阻止核銷。請切換活動後再驗票。');
    }
    if (selectedSessionId && sid !== selectedSessionId) {
      throw new Error('警示：此票券不屬於你目前選擇的場次，已阻止核銷。請切換場次後再驗票。');
    }
  };

  const verifyPayload = async (qrPayload) => {
    setError('');
    setScannerHint('已辨識到 QR，送出核銷中...');
    try {
      enforceSessionScope(qrPayload);
      const res = await apiClient.verifyTicket({ qr_payload: qrPayload, device_id: deviceId });
      if (selectedSessionId && res?.data?.session_id && res.data.session_id !== selectedSessionId) {
        throw new Error('警示：後端回傳票券場次與目前選擇不一致，已視為無效核銷結果。');
      }
      if (eventDetail && res?.data?.session_id && !allowedSessionIds.has(res.data.session_id)) {
        throw new Error('警示：後端回傳票券不屬於目前選擇活動，已視為無效核銷結果。');
      }
      setResult({ ok: true, data: res.data });
      setScannerHint('核銷成功：可入場');
      playTone('success');
    } catch (e) {
      setResult(null);
      setError(formatVerifyError(e));
      setScannerHint('核銷失敗：請查看下方錯誤訊息');
      playTone('error');
    }
  };

  const startScan = async () => {
    if (!selectedEventId) {
      setError('請先選擇活動後再啟動掃碼，避免驗到非該活動/場次的門票。');
      return;
    }
    setScanning(true);
    setError('');
    setScannerHint('正在初始化相機與掃描器...');
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    try {
      if (!window.isSecureContext) {
        setError('目前網址不是安全來源（HTTPS/localhost），手機 Chrome 會封鎖相機。請改用 HTTPS 網址或先用手動貼上 QR payload。');
        setScannerHint('安全性檢查失敗：目前不是 HTTPS/localhost');
        setScanning(false);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('目前瀏覽器不支援相機 API，請改用手動貼上 QR payload。');
        setScannerHint('瀏覽器不支援 mediaDevices.getUserMedia');
        setScanning(false);
        return;
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }
      setScannerHint('相機已啟動，等待辨識 QR...');

      await reader.decodeFromVideoElement(videoRef.current, (scanResult, scanErr) => {
        if (scanResult?.getText()) {
          const nextText = scanResult.getText();
          const nowAt = Date.now();
          if (lastScanRef.current.text === nextText && nowAt - lastScanRef.current.at < 2000) {
            return;
          }
          lastScanRef.current = { text: nextText, at: nowAt };
          setLastDetectedText(nextText);
          setLastDetectedAt(new Date(nowAt).toLocaleString());
          verifyPayload(nextText);
        }
        if (scanErr && String(scanErr).includes('NotFoundException')) {
          if (Date.now() - lastNotFoundLogAtRef.current > 1500) {
            setScannerHint('有偵測到畫面，但尚未辨識到 QR（請靠近、調亮、保持對焦）');
            lastNotFoundLogAtRef.current = Date.now();
          }
          return;
        }
        if (scanErr) {
          setScannerHint(`掃描器訊息：${String(scanErr).slice(0, 80)}`);
        }
      });
    } catch (e) {
      setError('相機掃碼啟動失敗，請改用手動貼上 QR payload');
      setScannerHint('相機初始化失敗');
      setScanning(false);
    }
  };

  const stopScan = () => {
    if (readerRef.current) {
      readerRef.current.reset();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScannerHint('已停止掃描');
    setScanning(false);
  };

  return (
    <div className="page-wrap verifier-shell fade-in-up">
      <Card className="verifier-card">
        <Title level={3}>驗票端</Title>
        <Paragraph>先選擇活動/場次，再掃描員工 QR Code，避免核銷到非本場次票券。</Paragraph>

        {eventsLoadError ? (
          <Alert
            style={{ marginBottom: 16 }}
            type="error"
            showIcon
            message="無法載入活動列表"
            description={eventsLoadError}
          />
        ) : null}

        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            style={{ width: 320 }}
            placeholder="選擇活動"
            value={selectedEventId || undefined}
            onChange={(v) => setSelectedEventId(v)}
            options={events.map((e) => ({ value: e.id, label: e.title }))}
            showSearch
            optionFilterProp="label"
            loading={eventsLoading}
            notFoundContent={eventsLoading ? '載入中…' : '尚無活動'}
          />
          <Select
            style={{ width: 260 }}
            placeholder="選擇場次（可選）"
            value={selectedSessionId || undefined}
            onChange={(v) => setSelectedSessionId(v)}
            options={(eventDetail?.sessions || []).map((s) => ({ value: s.id, label: s.title || s.id }))}
            disabled={!selectedEventId}
            allowClear
          />
        </Space>

        <div className={`scan-state ${scanning ? 'scanning' : 'idle'}`}>
          {scanning ? '掃描中：請將 QR Code 對準框線中央' : '待命中：點擊啟動相機掃碼'}
        </div>

        <Space style={{ marginBottom: 16 }} wrap>
          <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} addonBefore="裝置 ID" style={{ width: 260 }} />
          {!scanning ? (
            <Button type="primary" onClick={startScan} disabled={!isSelectionReady}>啟動相機掃碼</Button>
          ) : (
            <Button danger onClick={stopScan}>停止掃碼</Button>
          )}
        </Space>

        <div className="video-frame">
          <video ref={videoRef} />
          <div className="scan-guide" />
        </div>

        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message={`掃描器狀態：${scannerHint}`}
          description={lastDetectedText ? `最近辨識時間：${lastDetectedAt || '-'} ｜ 內容前 40 字：${lastDetectedText.slice(0, 40)}` : '尚未辨識到 QR 字串'}
        />

        <Card style={{ marginTop: 16 }} type="inner" title="手動核銷備援">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={manualPayload}
              onChange={(e) => setManualPayload(e.target.value)}
              placeholder="貼上 qr_payload"
            />
            <Button type="primary" onClick={() => verifyPayload(manualPayload)} disabled={!isSelectionReady}>
              核銷
            </Button>
          </Space.Compact>
        </Card>

        {result?.ok ? (
          <div className="result-panel success">
            <Alert
              type="success"
              showIcon
              message="核銷成功"
              description={
                <div>
                  <div>票券：{result.data.ticket_id}</div>
                  <div>姓名：{result.data.user_name}</div>
                  <div>核銷時間：{result.data.used_at}</div>
                  <Tag color="green" style={{ marginTop: 8 }}>允許入場</Tag>
                </div>
              }
            />
          </div>
        ) : null}

        {error ? (
          <div className="result-panel error">
            <Alert type="error" showIcon message="核銷失敗" description={error} />
          </div>
        ) : null}
      </Card>
    </div>
  );
};

export default VerifierPage;
