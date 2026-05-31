import React, { useState } from 'react';
import { Avatar, Badge, Button, Drawer, Layout, Popover, Space, Tooltip, message } from 'antd';
import { AuditOutlined, BellOutlined, FontSizeOutlined, IdcardOutlined, LogoutOutlined, MenuOutlined, QrcodeOutlined, UserOutlined } from '@ant-design/icons';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useUiPreferences } from '../context/UiPreferencesContext';
import useI18n from '../hooks/useI18n';
import { LOGO_IMAGE } from '../assets/media';
import AnimatedThemeToggler from './AnimatedThemeToggler';
import LanguageToggle from './LanguageToggle';
import '../styles/Header.css';

const { Header } = Layout;

const AppHeader = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout, startOIDCLogin } = useAuth();
  const { unreadCount, connected } = useNotifications();
  const { colorMode, textScale, setTextScale } = useUiPreferences();
  const { m, ROLE_LABELS, labelOr } = useI18n();

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

  const textScaleLabel = textScale === 'normal'
    ? m.header.standard
    : textScale === 'large'
      ? m.header.large
      : m.header.extraLarge;

  const textScaleTooltip = textScale === 'normal'
    ? m.header.switchToLargeText
    : textScale === 'large'
      ? m.header.switchToExtraLargeText
      : m.header.switchToStandardText;

  const themeTooltip = colorMode === 'dark' ? m.header.switchToLight : m.header.switchToDark;

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
      message.error(error?.error?.message || m.common.loginError);
      setLoginLoading(false);
    }
  };

  const profilePopoverContent = user ? (
    <div className="profile-popover-card">
      <div className="profile-popover-actions">
        {canAccessAdmin ? (
          <Link to="/admin" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <AuditOutlined />
            <span>{m.header.adminConsole}</span>
          </Link>
        ) : null}
        {canAccessVerifier ? (
          <Link to="/verify" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <QrcodeOutlined />
            <span>{m.header.verifierPortal}</span>
          </Link>
        ) : null}
        {canAccessTicketBox ? (
          <Link to="/me" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <IdcardOutlined />
            <span>{m.header.myTickets}</span>
          </Link>
        ) : null}
        {canAccessNotifications ? (
          <Link to="/notifications" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <BellOutlined />
            <span>{m.header.notifications}</span>
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
          {m.common.signOut}
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
          aria-label={m.header.openNavMenu}
          onClick={() => setMobileMenuOpen(true)}
        />
        <Link to="/" className="logo" onClick={handleGoHome}>
          <img src={LOGO_IMAGE} alt="TSMC logo" className="logo-image" />
          <span>
            <strong className="logo-title">
              <span className="logo-title-line1">{m.header.brandLine1}</span>
              <span className="logo-title-line2">{m.header.brandLine2}</span>
            </strong>
            <small>{m.header.brandTagline}</small>
          </span>
        </Link>
      </div>

      <div className="header-right">
        <Space size="middle" wrap>
          <LanguageToggle />

          <Tooltip title={themeTooltip}>
            <AnimatedThemeToggler className="theme-toggle-btn" variant="circle" duration={520} />
          </Tooltip>

          <Tooltip title={textScaleTooltip}>
            <Button
              className="ghost-btn"
              icon={<FontSizeOutlined />}
              onClick={cycleTextScale}
            >
              {textScaleLabel}
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
                <Tooltip title={connected ? m.header.connected : m.header.offline}>
                  <span
                    className={`connection-dot ${connected ? 'connected' : 'offline'}`}
                    role="status"
                    aria-label={connected ? m.header.connected : m.header.offline}
                  />
                </Tooltip>
              </Button>
            </Popover>
          ) : (
            <Button type="primary" loading={loginLoading} onClick={handleLogin}>{m.common.signIn}</Button>
          )}
        </Space>
      </div>

      <div className="mobile-header-user">
        {user ? (
          <Button
            type="text"
            className="user-button mobile-header-profile-trigger"
            aria-label={m.header.openAccountMenu}
            onClick={() => setMobileMenuOpen(true)}
          >
            <Avatar size={28} icon={<UserOutlined />} />
          </Button>
        ) : (
          <Button type="primary" size="small" loading={loginLoading} onClick={handleLogin}>{m.common.signIn}</Button>
        )}
      </div>

      <Drawer
        title={m.header.navMenu}
        placement="left"
        onClose={() => setMobileMenuOpen(false)}
        open={mobileMenuOpen}
        width={300}
        className="mobile-action-drawer"
      >
        <div className="mobile-drawer-shell">
          <div className="mobile-drawer-main">
            <LanguageToggle className="mobile-drawer-item language-toggle-mobile" block />
            <Tooltip title={themeTooltip}>
              <AnimatedThemeToggler
                className="mobile-drawer-item theme-toggle-mobile"
                label={themeTooltip}
                variant="circle"
                duration={520}
              />
            </Tooltip>
            <Tooltip title={textScaleTooltip}>
              <Button
                block
                type="text"
                className="mobile-drawer-item"
                onClick={cycleTextScale}
              >
                <span className="mobile-drawer-item-main">
                  <FontSizeOutlined className="mobile-drawer-item-icon" />
                  {m.header.textSize}: {textScaleLabel}
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
                        <span>{m.header.adminConsole}</span>
                      </Link>
                    ) : null}
                    {canAccessVerifier ? (
                      <Link to="/verify" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                        <QrcodeOutlined />
                        <span>{m.header.verifierPortal}</span>
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
                    {m.common.signOut}
                  </Button>
                </div>
                <div className="mobile-drawer-account-actions">
                  {canAccessTicketBox ? (
                    <Link to="/me" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                      <IdcardOutlined />
                      <span>{m.header.myTickets}</span>
                    </Link>
                  ) : null}
                  {canAccessNotifications ? (
                    <Link to="/notifications" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                      <BellOutlined />
                      <span>{m.header.notifications}</span>
                      <Badge count={unreadCount} size="small" />
                    </Link>
                  ) : null}
                </div>
              </>
            ) : (
              <Button type="primary" className="mobile-drawer-login" loading={loginLoading} onClick={handleLogin}>
                {m.common.signIn}
              </Button>
            )}
          </div>
        </div>
      </Drawer>
    </Header>
  );
};

export default AppHeader;
