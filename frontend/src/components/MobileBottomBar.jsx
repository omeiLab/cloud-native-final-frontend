import React from 'react';
import { AuditOutlined, HomeOutlined, BellOutlined, IdcardOutlined, QrcodeOutlined } from '@ant-design/icons';
import { Link, useLocation } from 'react-router-dom';
import { Badge } from 'antd';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';

const MobileBottomBar = () => {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { unreadCount } = useNotifications();

  if (!user) return null;

  const entries = [
    { to: '/', label: 'Home', icon: <HomeOutlined /> }
  ];

  if (user.role === 'EMPLOYEE') {
    entries.push({ to: '/notifications', label: 'Alerts', icon: <Badge size="small" count={unreadCount}><BellOutlined /></Badge> });
    entries.push({ to: '/me', label: 'Tickets', icon: <IdcardOutlined /> });
  }

  if (user.role === 'ADMIN' || user.role === 'ADMIN_VIEWER') {
    entries.push({ to: '/admin', label: 'Admin', icon: <AuditOutlined /> });
  }

  if (user.role === 'VERIFIER') {
    entries.push({ to: '/verify', label: 'Verify', icon: <QrcodeOutlined /> });
  }

  return (
    <nav className="mobile-bottom-bar">
      {entries.map((entry) => (
        <Link
          key={entry.to}
          to={entry.to}
          className={`mobile-bottom-item${pathname === entry.to ? ' active' : ''}`}
        >
          <span className="mobile-bottom-icon">{entry.icon}</span>
          <span>{entry.label}</span>
        </Link>
      ))}
    </nav>
  );
};

export default MobileBottomBar;
