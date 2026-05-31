import React, { useState } from 'react';
import { Avatar, Badge, Button, Drawer, Layout, Popover, Space, Tooltip, message } from 'antd';
import { AuditOutlined, BellOutlined, FontSizeOutlined, IdcardOutlined, LogoutOutlined, MenuOutlined, QrcodeOutlined, UserOutlined } from '@ant-design/icons';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useUiPreferences } from '../context/UiPreferencesContext';
import { LOGO_IMAGE } from '../assets/media';
import AnimatedThemeToggler from './AnimatedThemeToggler';
import { ROLE_LABELS, labelOr } from '../utils/labels';
import '../styles/Header.css';

const { Header } = Layout;

const AppHeader = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout, startOIDCLogin } = useAuth();
  const { unreadCount, connected } = useNotifications();
  const { colorMode, textScale, setTextScale } = useUiPreferences();
  const cycleTextScale = () => {
    if (textScale === 'normal') {
      setTextScale('large');
      return;
    }
    if (textScale === 'large') {
      setTextScale('xlarge');
      return;
    }
    setTextScale('normal');
  };

  const [loginLoading, setLoginLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);
  const canAccessTicketBox = user?.role === 'EMPLOYEE';
  const canAccessNotifications = user?.role === 'EMPLOYEE';
  const canAccessAdmin = user?.role === 'ADMIN' || user?.role === 'ADMIN_VIEWER';
  const canAccessVerifier = user?.role === 'VERIFIER';

  const handleGoHome = (event) => {
    event.preventDefault();
    setMobileMenuOpen(false);
    setProfilePopoverOpen(false);
    if (pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate('/');
  };

  const handleLogout = async () => {
    await logout();
    setProfilePopoverOpen(false);
    navigate('/');
  };

  const handleLogin = async () => {
    setMobileMenuOpen(false);
    setLoginLoading(true);
    try {
      await startOIDCLogin();
    } catch (error) {
      message.error(error?.error?.message || 'Sign-in failed. Verify that backend services are running.');
      setLoginLoading(false);
    }
  };

  const profilePopoverContent = user ? (
    <div className="profile-popover-card">
      <div className="profile-popover-actions">
        {canAccessAdmin ? (
          <Link to="/admin" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <AuditOutlined />
            <span>Admin console</span>
          </Link>
        ) : null}
        {canAccessVerifier ? (
          <Link to="/verify" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <QrcodeOutlined />
            <span>Verifier portal</span>
          </Link>
        ) : null}
        {canAccessTicketBox ? (
          <Link to="/me" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <IdcardOutlined />
            <span>My tickets</span>
          </Link>
        ) : null}
        {canAccessNotifications ? (
          <Link to="/notifications" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <BellOutlined />
            <span>Notifications</span>
            <Badge count={unreadCount} size="small" />
          </Link>
        ) : null}
        <Button
          type="text"
          danger
          className="profile-popover-logout"
          icon={<LogoutOutlined />}
          onClick={handleLogout}
        >
          Sign out
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <Header className="app-header">
      <div className="header-left">
        <Button
          type="text"
          className="mobile-menu-trigger"
          icon={<MenuOutlined />}
          aria-label="Open navigation menu"
          onClick={() => setMobileMenuOpen(true)}
        />
        <Link to="/" className="logo" onClick={handleGoHome}>
          <img src={LOGO_IMAGE} alt="TSMC logo" className="logo-image" />
          <span>
            <strong className="logo-title">
              <span className="logo-title-line1">TSMC</span>
              <span className="logo-title-line2">CETS Events</span>
            </strong>
            <small>TSMC employee event platform</small>
          </span>
        </Link>
      </div>

      <div className="header-right">
        <Space size="middle" wrap>
          <Tooltip title={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <AnimatedThemeToggler className="theme-toggle-btn" variant="circle" duration={520} />
          </Tooltip>

          <Tooltip title={textScale === 'normal' ? 'Switch to large text' : textScale === 'large' ? 'Switch to extra-large text' : 'Switch to standard text'}>
            <Button
              className="ghost-btn"
              icon={<FontSizeOutlined />}
              onClick={cycleTextScale}
            >
              {textScale === 'normal' ? 'Standard' : textScale === 'large' ? 'Large' : 'Extra large'}
            </Button>
          </Tooltip>

          {canAccessNotifications ? (
            <Link to="/notifications">
              <Badge count={unreadCount} size="small">
                <Button type="text" className="icon-btn" icon={<BellOutlined style={{ fontSize: 18 }} />} />
              </Badge>
            </Link>
          ) : null}

          {user ? (
            <Popover
              trigger="click"
              placement="bottom"
              open={profilePopoverOpen}
              onOpenChange={setProfilePopoverOpen}
              content={profilePopoverContent}
              arrow={{ pointAtCenter: true }}
              rootClassName="profile-popover"
            >
              <Button
                type="text"
                className="user-button"
                aria-haspopup="dialog"
                aria-expanded={profilePopoverOpen}
              >
                <Avatar size={32} icon={<UserOutlined />} />
                <span className="user-name">{user.name}（{labelOr(ROLE_LABELS, user.role)}）</span>
                <Tooltip title={connected ? 'Realtime notifications connected' : 'Realtime notifications offline (reconnecting)'}>
                  <span
                    className={`connection-dot ${connected ? 'connected' : 'offline'}`}
                    role="status"
                    aria-label={connected ? 'Realtime notifications connected' : 'Realtime alerts offline'}
                  />
                </Tooltip>
              </Button>
            </Popover>
          ) : (
            <Button type="primary" loading={loginLoading} onClick={handleLogin}>Sign in</Button>
          )}
        </Space>
      </div>

      <div className="mobile-header-user">
        {user ? (
          <Button
            type="text"
            className="user-button mobile-header-profile-trigger"
            aria-label="Open account menu"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Avatar size={28} icon={<UserOutlined />} />
          </Button>
        ) : (
          <Button type="primary" size="small" loading={loginLoading} onClick={handleLogin}>Sign in</Button>
        )}
      </div>

      <Drawer
        title="Navigation menu"
        placement="left"
        onClose={() => setMobileMenuOpen(false)}
        open={mobileMenuOpen}
        width={300}
        className="mobile-action-drawer"
      >
        <div className="mobile-drawer-shell">
          <div className="mobile-drawer-main">
            <Tooltip title={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              <AnimatedThemeToggler
                className="mobile-drawer-item theme-toggle-mobile"
                label={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                variant="circle"
                duration={520}
              />
            </Tooltip>
            <Tooltip title={textScale === 'normal' ? 'Switch to large text' : textScale === 'large' ? 'Switch to extra-large text' : 'Switch to standard text'}>
              <Button
                block
                type="text"
                className="mobile-drawer-item"
                onClick={cycleTextScale}
              >
                <span className="mobile-drawer-item-main">
                  <FontSizeOutlined className="mobile-drawer-item-icon" />
                  Text size: {textScale === 'normal' ? 'Standard' : textScale === 'large' ? 'Large' : 'Extra large'}
                </span>
              </Button>
            </Tooltip>
          </div>

          <div className="mobile-drawer-account">
            {user ? (
              <>
                {canAccessAdmin || canAccessVerifier ? (
                  <div className="mobile-drawer-account-actions">
                    {canAccessAdmin ? (
                      <Link to="/admin" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                        <AuditOutlined />
                        <span>Admin console</span>
                      </Link>
                    ) : null}
                    {canAccessVerifier ? (
                      <Link to="/verify" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                        <QrcodeOutlined />
                        <span>Verifier portal</span>
                      </Link>
                    ) : null}
                  </div>
                ) : null}
                <div className="mobile-drawer-account-row">
                  <div className="mobile-drawer-user-card">
                    <Avatar size={38} icon={<UserOutlined />} />
                    <span className="mobile-drawer-user-copy">
                      <strong>{user.name}</strong>
                      <span>{labelOr(ROLE_LABELS, user.role)}</span>
                    </span>
                  </div>
                  <Button
                    type="text"
                    danger
                    className="mobile-drawer-logout"
                    onClick={async () => {
                      await logout();
                      navigate('/');
                      setMobileMenuOpen(false);
                    }}
                  >
                    <LogoutOutlined />
                    Sign out
                  </Button>
                </div>
                <div className="mobile-drawer-account-actions">
                  {canAccessTicketBox ? (
                    <Link to="/me" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                      <IdcardOutlined />
                      <span>My tickets</span>
                    </Link>
                  ) : null}
                  {canAccessNotifications ? (
                    <Link to="/notifications" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                      <BellOutlined />
                      <span>Notifications</span>
                      <Badge count={unreadCount} size="small" />
                    </Link>
                  ) : null}
                </div>
              </>
            ) : (
              <Button type="primary" className="mobile-drawer-login" loading={loginLoading} onClick={handleLogin}>
                Sign in
              </Button>
            )}
          </div>
        </div>
      </Drawer>
    </Header>
  );
};

export default AppHeader;
