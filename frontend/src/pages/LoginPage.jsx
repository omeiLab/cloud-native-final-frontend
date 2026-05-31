import React, { useState } from 'react';
import { Alert, Button, Card, Col, Row, Typography, message } from 'antd';
import { LoginOutlined, SafetyOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import '../styles/LoginPage.css';

const { Title, Paragraph } = Typography;

const LoginPage = () => {
  const { startOIDCLogin } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleOIDCLogin = async () => {
    setLoading(true);
    try {
      await startOIDCLogin();
    } catch (error) {
      message.error(error?.error?.message || 'Sign-in failed. Verify that backend services are running.');
      setLoading(false);
    }
  };

  return (
    <div className="page-wrap login-page fade-in-up">
      <Row gutter={[24, 24]} justify="center">
        <Col xs={24} md={14} lg={12}>
          <Card className="hero-card">
            <div className="login-kicker">CETS Events</div>
            <Title level={2}>TSMC employee event platform</Title>
            <Paragraph>
              Sign in with corporate SSO to access events. Confirm won registrations before the deadline and present your QR code at entry.
            </Paragraph>

            <Button
              block
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              loading={loading}
              onClick={handleOIDCLogin}
            >
              Corporate sign-in
            </Button>

            <Alert
              style={{ marginTop: 20 }}
              type="info"
              showIcon
              icon={<SafetyOutlined />}
              message="Sign-in help"
              description="You will be redirected to corporate sign-in. Use the identity service account provided by backend."
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default LoginPage;
