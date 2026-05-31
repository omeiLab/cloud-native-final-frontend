import React from 'react';
import { AuditOutlined, HomeOutlined, BellOutlined, IdcardOutlined, QrcodeOutlined } from '@ant-design/icons';
import { Link, useLocation } from 'react-router-dom';
import { Badge } from 'antd';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import useI18n from '../hooks/useI18n';

const MobileBottomBar = () => {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { unreadCount } = useNotifications();
  const { m } = useI18n();

  if (!user) return null;

  const entries = [
    { to: '/', label: m.mobileNav.home, icon: <HomeOutlined /> }
  ];

  if (user.role === 'EMPLOYEE') {
    entries.push({ to: '/notifications', label: m.mobileNav.alerts, icon: <Badge size="small" count={unreadCount}><BellOutlined /></Badge> });
    entries.push({ to: '/me', label: m.mobileNav.tickets, icon: <IdcardOutlined /> });
  }

  if (user.role === 'ADMIN' || user.role === 'ADMIN_VIEWER') {
    entries.push({ to: '/admin', label: m.mobileNav.admin, icon: <AuditOutlined /> });
  }

  if (user.role === 'VERIFIER') {
    entries.push({ to: '/verify', label: m.mobileNav.verify, icon: <QrcodeOutlined /> });
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
