import React, { useState } from 'react';
import { Alert, Button, Card, Col, Divider, Form, Input, Row, Typography, message } from 'antd';
import { LockOutlined, MailOutlined, SafetyOutlined, TeamOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/LoginPage.css';

const { Title, Paragraph } = Typography;

const LoginPage = () => {
  const navigate = useNavigate();
  const { loginWithPassword, loginAsRole } = useAuth();
  const [form] = Form.useForm();
  const [pwdLoading, setPwdLoading] = useState(false);
  const [roleLoading, setRoleLoading] = useState(null);

  const onPasswordLogin = async (values) => {
    setPwdLoading(true);
    try {
      await loginWithPassword({ email: values.email, password: values.password });
      message.success('登入成功');
      navigate('/');
    } catch (error) {
      message.error(error?.error?.message || '登入失敗，請檢查帳號密碼');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleRoleLogin = async (role, targetPath) => {
    setRoleLoading(role);
    try {
      await loginAsRole(role);
      navigate(targetPath);
    } catch (error) {
      message.error(error?.error?.message || '切換角色失敗');
    } finally {
      setRoleLoading(null);
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
              使用註冊時的電子郵件與密碼登入；註冊時已選定身分（員工 / 管理員 / 驗票員）。中籤後請於期限內確認領票，現場出示 QR 入場。
            </Paragraph>

            <Form form={form} layout="vertical" size="large" onFinish={onPasswordLogin}>
              <Form.Item
                name="email"
                label="電子郵件"
                rules={[
                  { required: true, message: '請輸入電子郵件' },
                  { type: 'email', message: '請輸入有效的電子郵件' }
                ]}
              >
                <Input prefix={<MailOutlined />} placeholder="you@company.com" autoComplete="username" />
              </Form.Item>
              <Form.Item
                name="password"
                label="密碼"
                rules={[{ required: true, message: '請輸入密碼' }]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="密碼" autoComplete="current-password" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" block loading={pwdLoading} size="large">
                  電子郵件登入
                </Button>
              </Form.Item>
            </Form>

            <Divider>
              <TeamOutlined /> 角色快速切換
            </Divider>
            <Row gutter={12}>
              <Col span={8}>
                <Button block loading={roleLoading === 'EMPLOYEE'} onClick={() => handleRoleLogin('EMPLOYEE', '/')}>
                  員工
                </Button>
              </Col>
              <Col span={8}>
                <Button block loading={roleLoading === 'ADMIN'} onClick={() => handleRoleLogin('ADMIN', '/admin')}>
                  管理員
                </Button>
              </Col>
              <Col span={8}>
                <Button block loading={roleLoading === 'VERIFIER'} onClick={() => handleRoleLogin('VERIFIER', '/verify')}>
                  驗票員
                </Button>
              </Col>
            </Row>

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Paragraph>
                還沒有帳戶？ <Link to="/register">立即註冊</Link>
              </Paragraph>
            </div>

            <Alert
              style={{ marginTop: 20 }}
              type="info"
              showIcon
              icon={<SafetyOutlined />}
              message="展示模式說明"
              description="正式流程請使用註冊帳號登入；角色快速切換僅供課堂展示與測試。"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default LoginPage;
