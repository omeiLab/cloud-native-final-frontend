import React, { useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Typography, message } from 'antd';
import { AuditOutlined, IdcardOutlined, QrcodeOutlined, SafetyOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { ROLE_LOGIN_OPTIONS } from '../constant';
import '../styles/LoginPage.css';

const { Title, Paragraph } = Typography;

const ROLE_ICONS = {
  EMPLOYEE: <IdcardOutlined />,
  ADMIN: <AuditOutlined />,
  VERIFIER: <QrcodeOutlined />
};

const LoginPage = () => {
  const { startOIDCLogin } = useAuth();
  const [loadingRole, setLoadingRole] = useState(null);

  const handleOIDCLogin = async (option) => {
    setLoadingRole(option.key);
    try {
      if (option.password && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(option.password).catch(() => {});
      }
      await startOIDCLogin({ targetPath: option.targetPath, loginHint: option.email });
    } catch (error) {
      message.error(error?.error?.message || '登入失敗，請確認後端服務是否正常');
      setLoadingRole(null);
    }
  };

  return (
    <div className="page-wrap login-page fade-in-up">
      <Row gutter={[24, 24]} justify="center">
        <Col xs={24} md={14} lg={12}>
          <Card className="hero-card">
            <div className="login-kicker">台積電晶彩活動通</div>
            <Title level={2}>台積電員工活動平台</Title>
            <Paragraph>
              使用企業登入進入活動平台。中籤後請於期限內確認領票，現場出示 QR 入場。
            </Paragraph>

            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              {ROLE_LOGIN_OPTIONS.map((option) => (
                <Button
                  key={option.key}
                  block
                  size="large"
                  icon={ROLE_ICONS[option.key]}
                  loading={loadingRole === option.key}
                  onClick={() => handleOIDCLogin(option)}
                  style={{ height: 'auto', paddingBlock: 12, textAlign: 'left' }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                    <small>帳號：{option.email}</small>
                    <small>密碼：{option.password}</small>
                  </span>
                </Button>
              ))}
            </Space>

            <Alert
              style={{ marginTop: 20 }}
              type="info"
              showIcon
              icon={<SafetyOutlined />}
              message="登入說明"
              description="測試帳號請在企業登入頁輸入。"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default LoginPage;
