import React from 'react';
import { Button, Modal, Space, Typography } from 'antd';
import { AuditOutlined, IdcardOutlined, QrcodeOutlined } from '@ant-design/icons';
import { ROLE_LOGIN_OPTIONS } from '../constant';

const { Text } = Typography;

const ROLE_ICONS = {
  EMPLOYEE: <IdcardOutlined />,
  ADMIN: <AuditOutlined />,
  VERIFIER: <QrcodeOutlined />
};

const LoginModal = ({ open, onClose, onSelectRole, loadingRole }) => (
  <Modal
    title="選擇登入身分"
    open={open}
    onCancel={onClose}
    footer={null}
    centered
  >
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {ROLE_LOGIN_OPTIONS.map((option) => (
        <Button
          key={option.key}
          block
          size="large"
          icon={ROLE_ICONS[option.key]}
          loading={loadingRole === option.key}
          onClick={() => onSelectRole(option)}
          style={{ height: 'auto', paddingBlock: 12, textAlign: 'left' }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <Text strong>{option.title}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{option.description}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>帳號：{option.email}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>密碼：{option.password}</Text>
          </span>
        </Button>
      ))}
    </Space>
  </Modal>
);

export default LoginModal;
