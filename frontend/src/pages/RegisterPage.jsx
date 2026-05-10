import React, { useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Row, Select, Typography, message } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/RegisterPage.css';

const { Title, Paragraph } = Typography;

const RegisterPage = () => {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      await register({
        email: values.email,
        password: values.password,
        name: values.name,
        role: values.role,
        employee_id: values.employee_id || '',
        department: values.department || '',
        site: values.site || 'HSINCHU'
      });
      message.success('註冊成功！歡迎加入台積電晶彩活動通');
      navigate('/');
    } catch (error) {
      message.error(error?.error?.message || '註冊失敗，請檢查您的資訊後重試');
    } finally {
      setLoading(false);
    }
  };

  const validatePassword = (_, value) => {
    if (!value || value.length < 6) {
      return Promise.reject(new Error('密碼至少需要 6 個字元'));
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(value)) {
      return Promise.reject(new Error('密碼需要包含大小寫字母和數字'));
    }
    return Promise.resolve();
  };

  const validateConfirmPassword = (_, value) => {
    if (!value || form.getFieldValue('password') === value) {
      return Promise.resolve();
    }
    return Promise.reject(new Error('兩次輸入的密碼不一致'));
  };

  return (
    <div className="page-wrap register-page fade-in-up">
      <Row gutter={[24, 24]} justify="center">
        <Col xs={24} md={14} lg={12}>
          <Card className="hero-card">
            <div className="register-kicker">台積電晶彩活動通</div>
            <Title level={2}>建立新帳戶</Title>
            <Paragraph>
              註冊完成後，即可報名公司活動、參與抽籤、取得電子票券並完成現場驗票。
            </Paragraph>

            <Form
              form={form}
              name="register"
              onFinish={onFinish}
              scrollToFirstError
              layout="vertical"
              size="large"
            >
              <Form.Item
                name="name"
                label="姓名"
                rules={[
                  { required: true, message: '請輸入您的姓名' },
                  { min: 2, message: '姓名至少需要 2 個字元' }
                ]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder="請輸入您的姓名"
                />
              </Form.Item>

              <Form.Item
                name="email"
                label="電子郵件 (帳號)"
                rules={[
                  { required: true, message: '請輸入電子郵件' },
                  { type: 'email', message: '請輸入有效的電子郵件地址' }
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  placeholder="example@company.com"
                />
              </Form.Item>

              <Form.Item
                name="password"
                label="密碼"
                rules={[
                  { required: true, message: '請輸入密碼' },
                  { validator: validatePassword }
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="請輸入密碼 (至少6字元，含大小寫字母和數字)"
                />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label="確認密碼"
                dependencies={['password']}
                rules={[
                  { required: true, message: '請確認您的密碼' },
                  { validator: validateConfirmPassword }
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="請再次輸入密碼"
                />
              </Form.Item>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="employee_id"
                    label="員工編號 (選填)"
                  >
                    <Input placeholder="員工編號" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="department"
                    label="部門 (選填)"
                  >
                    <Input placeholder="部門名稱" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="role"
                label="帳號身分（註冊時選定）"
                rules={[{ required: true, message: '請選擇身分' }]}
                initialValue="EMPLOYEE"
              >
                <Select
                  options={[
                    { value: 'EMPLOYEE', label: '員工 — 報名活動、抽籤、領票' },
                    { value: 'ADMIN', label: '管理員 — 建立活動、執行抽籤、匯出' },
                    { value: 'VERIFIER', label: '驗票員 — 現場掃碼核銷' }
                  ]}
                />
              </Form.Item>

              <Form.Item
                name="site"
                label="辦公廠區"
                initialValue="HSINCHU"
              >
                <Select
                  options={[
                    { value: 'HSINCHU', label: '新竹 HSINCHU' },
                    { value: 'TAINAN', label: '台南 TAINAN' },
                    { value: 'TAICHUNG', label: '台中 TAICHUNG' },
                    { value: 'TAIPEI', label: '台北 TAIPEI' },
                    { value: 'OVERSEAS', label: '海外 OVERSEAS' }
                  ]}
                />
              </Form.Item>

              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  block
                  size="large"
                >
                  註冊帳戶
                </Button>
              </Form.Item>
            </Form>

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Paragraph>
                已有帳戶？ <Link to="/login">立即登入</Link>
              </Paragraph>
            </div>

            <Alert
              style={{ marginTop: 20 }}
              type="info"
              showIcon
              message="安全提醒"
              description="您的密碼將被加密儲存，請確保使用強密碼並妥善保管。"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default RegisterPage;
