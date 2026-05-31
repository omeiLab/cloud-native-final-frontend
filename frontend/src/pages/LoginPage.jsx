import React, { useState } from 'react';
import { Alert, Button, Card, Col, Row, Typography, message } from 'antd';
import { LoginOutlined, SafetyOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import useI18n from '../hooks/useI18n';
import '../styles/LoginPage.css';

const { Title, Paragraph } = Typography;

const LoginPage = () => {
  const { startOIDCLogin } = useAuth();
  const { m } = useI18n();
  const [loading, setLoading] = useState(false);

  const handleOIDCLogin = async () => {
    setLoading(true);
    try {
      await startOIDCLogin();
    } catch (error) {
      message.error(error?.error?.message || m.common.loginError);
      setLoading(false);
    }
  };

  return (
    <div className="page-wrap login-page fade-in-up">
      <Row gutter={[24, 24]} justify="center">
        <Col xs={24} md={14} lg={12}>
          <Card className="hero-card">
            <div className="login-kicker">{m.login.kicker}</div>
            <Title level={2}>{m.login.title}</Title>
            <Paragraph>{m.login.desc}</Paragraph>

            <Button
              block
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              loading={loading}
              onClick={handleOIDCLogin}
            >
              {m.login.corporateSignIn}
            </Button>

            <Alert
              style={{ marginTop: 20 }}
              type="info"
              showIcon
              icon={<SafetyOutlined />}
              message={m.login.helpTitle}
              description={m.login.helpDesc}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default LoginPage;
