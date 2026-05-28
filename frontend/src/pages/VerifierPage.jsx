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
import '../styles/Verifier.css';

const { Title } = Typography;

const ScannerSurface = memo(({
  videoRef,
  scanning,
  scannerHint,
  statusTone,
  onStartScan,
  onStopScan
}) => (
  <section className="scanner-panel">
    <div className={`scan-state ${statusTone}`}>{scannerHint}</div>

    <div className="video-frame">
      <video ref={videoRef} playsInline muted aria-label="驗票相機畫面" />
      <div className="scan-guide" />
    </div>

    <div className="verifier-scan-actions">
      {!scanning ? (
        <Button type="primary" size="large" icon={<CameraOutlined />} onClick={onStartScan}>
          開啟相機掃描
        </Button>
      ) : (
        <Button danger size="large" icon={<StopOutlined />} onClick={onStopScan}>
          停止掃描
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
  onManualVerify
}) => (
  <Collapse
    className="verifier-manual"
    ghost
    items={[
      {
        key: 'manual',
        label: '備援核銷',
        children: (
          <div className="verifier-manual-controls">
            <Input
              value={deviceId}
              onChange={(e) => onDeviceIdChange(e.target.value)}
              addonBefore="裝置 ID"
            />
            <Input.TextArea
              value={manualPayload}
              onChange={(e) => onManualPayloadChange(e.target.value)}
              placeholder="貼上 qr_payload"
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
            <Button
              type="primary"
              icon={<QrcodeOutlined />}
              onClick={onManualVerify}
              disabled={!manualPayload.trim()}
            >
              核銷
            </Button>
          </div>
        )
      }
    ]}
  />
));

const VerificationResultPanel = memo(({ result, error }) => (
  <>
    {result?.ok ? (
      <div className="result-panel success">
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
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
        <Alert type="error" showIcon icon={<CloseCircleOutlined />} message="核銷失敗" description={error} />
      </div>
    ) : null}
  </>
));

const VerifierPage = () => {
  const {
    videoRef,
    state,
    statusTone,
    handleStartScan,
    handleStopScan,
    handleDeviceIdChange,
    handleManualPayloadChange,
    handleManualVerify
  } = useVerifierController();

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
          <Title level={3}>驗票端</Title>
          <Tag color={scanning ? 'processing' : 'default'}>{scanning ? '掃描中' : '待命'}</Tag>
        </div>

        <ScannerSurface
          videoRef={videoRef}
          scanning={scanning}
          scannerHint={scannerHint}
          statusTone={statusTone}
          onStartScan={handleStartScan}
          onStopScan={handleStopScan}
        />

        <ManualVerificationPanel
          deviceId={deviceId}
          manualPayload={manualPayload}
          onDeviceIdChange={handleDeviceIdChange}
          onManualPayloadChange={handleManualPayloadChange}
          onManualVerify={handleManualVerify}
        />

        <VerificationResultPanel result={result} error={error} />
      </Card>
    </div>
  );
};

export default VerifierPage;
