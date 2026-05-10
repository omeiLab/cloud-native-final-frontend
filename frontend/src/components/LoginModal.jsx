import React, { useMemo, useState } from 'react';
import { Button, Modal, Radio, Space, Typography, message } from 'antd';
import { useAuth } from '../context/AuthContext';

const { Paragraph, Text } = Typography;

const ROLE_OPTIONS = [
  {
    value: 'EMPLOYEE',
    title: '員工',
    desc: '瀏覽活動、報名、中籤確認、領票與 QR 入場'
  },
  {
    value: 'ADMIN',
    title: '管理員',
    desc: '建立/編輯/發布活動、查看儀表板與匯出報表'
  },
  {
    value: 'VERIFIER',
    title: '驗票員',
    desc: '掃描 QR 並核銷入場（驗票端）'
  }
];

const LoginModal = ({ open, onClose, afterLoginNavigate }) => {
  const { loginAsRole } = useAuth();
  const [role, setRole] = useState('EMPLOYEE');
  const [loading, setLoading] = useState(false);

  const roleHintText = useMemo(() => ROLE_OPTIONS.find((x) => x.value === role)?.title || role, [role]);

  const handleDevLogin = async () => {
    setLoading(true);
    try {
      await loginAsRole(role);
      message.success(`已以「${roleHintText}」身分登入`);
      onClose?.();
      afterLoginNavigate?.(role);
    } catch (e) {
      message.error(e?.error?.message || '登入失敗，請確認後端服務是否正常');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="登入"
      open={open}
      onCancel={onClose}
      footer={null}
      centered
    >
      <Paragraph style={{ marginBottom: 12 }}>請先選擇身分，再按下登入。</Paragraph>

      <Radio.Group
        value={role}
        onChange={(e) => setRole(e.target.value)}
        style={{ width: '100%' }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {ROLE_OPTIONS.map((opt) => (
            <Radio.Button key={opt.value} value={opt.value} style={{ width: '100%', textAlign: 'left', height: 'auto', padding: 12, borderRadius: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text strong>{opt.title}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{opt.desc}</Text>
              </div>
            </Radio.Button>
          ))}
        </Space>
      </Radio.Group>

      <Space style={{ width: '100%', marginTop: 16 }} direction="vertical">
        <Button block size="large" type="primary" onClick={handleDevLogin} loading={loading}>
          以展示模式登入
        </Button>
      </Space>
    </Modal>
  );
};

export default LoginModal;

