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
      message.error(error?.error?.message || '登入失敗，請確認後端服務是否正常');
      setLoading(false);
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

            <Button
              block
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              loading={loading}
              onClick={handleOIDCLogin}
            >
              企業登入
            </Button>

            <Alert
              style={{ marginTop: 20 }}
              type="info"
              showIcon
              icon={<SafetyOutlined />}
              message="登入說明"
              description="系統會導向企業登入頁，請使用後端身分服務提供的帳號完成驗證。"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default LoginPage;
