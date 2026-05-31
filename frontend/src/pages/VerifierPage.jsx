import React, { memo } from 'react';
import { Alert, Button, Card, Collapse, Input, Tag, Typography } from 'antd';
import {
  CameraOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  QrcodeOutlined,
  StopOutlined
} from '@ant-design/icons';
import { useVerifierController } from './verifier/useVerifierController';
import useI18n from '../hooks/useI18n';
import '../styles/Verifier.css';

const { Title } = Typography;

const ScannerSurface = memo(({
  videoRef,
  scanning,
  scannerHint,
  statusTone,
  onStartScan,
  onStopScan,
  copy
}) => (
  <section className="scanner-panel">
    <div className={`scan-state ${statusTone}`}>{scannerHint}</div>

    <div className="video-frame">
      <video ref={videoRef} playsInline muted aria-label={copy.cameraFeed} />
      <div className="scan-guide" />
    </div>

    <div className="verifier-scan-actions">
      {!scanning ? (
        <Button type="primary" size="large" icon={<CameraOutlined />} onClick={onStartScan}>
          {copy.startScan}
        </Button>
      ) : (
        <Button danger size="large" icon={<StopOutlined />} onClick={onStopScan}>
          {copy.stopScan}
        </Button>
      )}
    </div>
  </section>
));

const ManualVerificationPanel = memo(({
  deviceId,
  manualPayload,
  onDeviceIdChange,
  onManualPayloadChange,
  onManualVerify,
  copy
}) => (
  <Collapse
    className="verifier-manual"
    ghost
    items={[
      {
        key: 'manual',
        label: copy.manual,
        children: (
          <div className="verifier-manual-controls">
            <Input
              value={deviceId}
              onChange={(e) => onDeviceIdChange(e.target.value)}
              addonBefore={copy.deviceId}
            />
            <Input.TextArea
              value={manualPayload}
              onChange={(e) => onManualPayloadChange(e.target.value)}
              placeholder={copy.pastePayload}
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
            <Button
              type="primary"
              icon={<QrcodeOutlined />}
              onClick={onManualVerify}
              disabled={!manualPayload.trim()}
            >
              {copy.verify}
            </Button>
          </div>
        )
      }
    ]}
  />
));

const VerificationResultPanel = memo(({ result, error, copy }) => (
  <>
    {result?.ok ? (
      <div className="result-panel success">
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message={copy.success}
          description={
            <div>
              <div>{copy.ticket}: {result.data.ticket_id}</div>
              <div>{copy.name}：{result.data.user_name}</div>
              <div>{copy.verifiedAt}: {result.data.used_at}</div>
              <Tag color="green" style={{ marginTop: 8 }}>{copy.entryAllowed}</Tag>
            </div>
          }
        />
      </div>
    ) : null}

    {error ? (
      <div className="result-panel error">
        <Alert type="error" showIcon icon={<CloseCircleOutlined />} message={copy.failed} description={error} />
      </div>
    ) : null}
  </>
));

const VerifierPage = () => {
  const { m } = useI18n();
  const copy = m.verifier;
  const {
    videoRef,
    state,
    statusTone,
    handleStartScan,
    handleStopScan,
    handleDeviceIdChange,
    handleManualPayloadChange,
    handleManualVerify
  } = useVerifierController(copy);

  const {
    deviceId,
    error,
    manualPayload,
    result,
    scannerHint,
    scanning
  } = state;

  return (
    <div className="page-wrap verifier-shell fade-in-up">
      <Card className="verifier-card">
        <div className="verifier-header">
          <Title level={3}>{copy.title}</Title>
          <Tag color={scanning ? 'processing' : 'default'}>{scanning ? copy.scanning : copy.idle}</Tag>
        </div>

        <ScannerSurface
          videoRef={videoRef}
          scanning={scanning}
          scannerHint={scannerHint}
          statusTone={statusTone}
          onStartScan={handleStartScan}
          onStopScan={handleStopScan}
          copy={copy}
        />

        <ManualVerificationPanel
          deviceId={deviceId}
          manualPayload={manualPayload}
          onDeviceIdChange={handleDeviceIdChange}
          onManualPayloadChange={handleManualPayloadChange}
          onManualVerify={handleManualVerify}
          copy={copy}
        />

        <VerificationResultPanel result={result} error={error} copy={copy} />
      </Card>
    </div>
  );
};

export default VerifierPage;
