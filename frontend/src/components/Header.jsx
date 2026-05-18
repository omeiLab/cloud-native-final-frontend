import React, { useState } from 'react';
import { Avatar, Badge, Button, Drawer, Layout, Popover, Space, Tag, Tooltip, message } from 'antd';
import { AuditOutlined, BellOutlined, FontSizeOutlined, IdcardOutlined, LogoutOutlined, MenuOutlined, QrcodeOutlined, UserOutlined } from '@ant-design/icons';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useUiPreferences } from '../context/UiPreferencesContext';
import { LOGO_IMAGE } from '../assets/media';
import LoginModal from './LoginModal';
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

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginLoadingRole, setLoginLoadingRole] = useState(null);
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

  const openLoginModal = () => {
    setMobileMenuOpen(false);
    setLoginOpen(true);
  };

  const handleRoleLogin = async (option) => {
    setLoginLoadingRole(option.key);
    setMobileMenuOpen(false);
    try {
      await startOIDCLogin({ targetPath: option.targetPath });
    } catch (error) {
      message.error(error?.error?.message || '登入失敗，請確認後端服務是否正常');
      setLoginLoadingRole(null);
    }
  };

  const profilePopoverContent = user ? (
    <div className="profile-popover-card">
      <div className="profile-popover-actions">
        {canAccessAdmin ? (
          <Link to="/admin" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <AuditOutlined />
            <span>管理後台</span>
          </Link>
        ) : null}
        {canAccessVerifier ? (
          <Link to="/verify" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <QrcodeOutlined />
            <span>驗票入口</span>
          </Link>
        ) : null}
        {canAccessTicketBox ? (
          <Link to="/me" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <IdcardOutlined />
            <span>我的票匣</span>
          </Link>
        ) : null}
        {canAccessNotifications ? (
          <Link to="/notifications" className="profile-popover-action" onClick={() => setProfilePopoverOpen(false)}>
            <BellOutlined />
            <span>通知中心</span>
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
          登出
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
          aria-label="開啟功能選單"
          onClick={() => setMobileMenuOpen(true)}
        />
        <Link to="/" className="logo" onClick={handleGoHome}>
          <img src={LOGO_IMAGE} alt="TSMC logo" className="logo-image" />
          <span>
            <strong className="logo-title">
              <span className="logo-title-line1">台積電</span>
              <span className="logo-title-line2">晶彩活動通</span>
            </strong>
            <small>台積電員工活動平台</small>
          </span>
        </Link>
      </div>

      <div className="header-right">
        <Space size="middle" wrap>
          <Tooltip title={colorMode === 'dark' ? '切換為明亮模式' : '切換為暗黑模式'}>
            <AnimatedThemeToggler className="theme-toggle-btn" variant="circle" duration={520} />
          </Tooltip>

          <Tooltip title={textScale === 'normal' ? '切換為大字版' : textScale === 'large' ? '切換為超大字版' : '切換為標準字體'}>
            <Button
              className="ghost-btn"
              icon={<FontSizeOutlined />}
              onClick={cycleTextScale}
            >
              {textScale === 'normal' ? '標準字' : textScale === 'large' ? '大字版' : '超大字'}
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
                <Tooltip title={connected ? '即時通知連線正常' : '即時通知離線中（將自動重連）'}>
                  <Tag color={connected ? 'green' : 'orange'}>{connected ? '即時連線' : '離線中'}</Tag>
                </Tooltip>
              </Button>
            </Popover>
          ) : (
            <Button type="primary" onClick={openLoginModal}>登入</Button>
          )}
        </Space>
      </div>

      <div className="mobile-header-user">
        {user ? (
          <Button
            type="text"
            className="user-button mobile-header-profile-trigger"
            aria-label="開啟帳號功能"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Avatar size={28} icon={<UserOutlined />} />
          </Button>
        ) : (
          <Button type="primary" size="small" onClick={openLoginModal}>登入</Button>
        )}
      </div>

      <Drawer
        title="功能選單"
        placement="left"
        onClose={() => setMobileMenuOpen(false)}
        open={mobileMenuOpen}
        width={300}
        className="mobile-action-drawer"
      >
        <div className="mobile-drawer-shell">
          <div className="mobile-drawer-main">
            <Tooltip title={colorMode === 'dark' ? '切換為明亮模式' : '切換為暗黑模式'}>
              <AnimatedThemeToggler
                className="mobile-drawer-item theme-toggle-mobile"
                label={colorMode === 'dark' ? '切換為明亮模式' : '切換為暗黑模式'}
                variant="circle"
                duration={520}
              />
            </Tooltip>
            <Tooltip title={textScale === 'normal' ? '切換為大字版' : textScale === 'large' ? '切換為超大字版' : '切換為標準字體'}>
              <Button
                block
                type="text"
                className="mobile-drawer-item"
                onClick={cycleTextScale}
              >
                <span className="mobile-drawer-item-main">
                  <FontSizeOutlined className="mobile-drawer-item-icon" />
                  字體大小：{textScale === 'normal' ? '標準字' : textScale === 'large' ? '大字版' : '超大字'}
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
                        <span>管理後台</span>
                      </Link>
                    ) : null}
                    {canAccessVerifier ? (
                      <Link to="/verify" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                        <QrcodeOutlined />
                        <span>驗票入口</span>
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
                    登出
                  </Button>
                </div>
                <div className="mobile-drawer-account-actions">
                  {canAccessTicketBox ? (
                    <Link to="/me" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                      <IdcardOutlined />
                      <span>我的票匣</span>
                    </Link>
                  ) : null}
                  {canAccessNotifications ? (
                    <Link to="/notifications" className="mobile-drawer-account-link" onClick={() => setMobileMenuOpen(false)}>
                      <BellOutlined />
                      <span>通知中心</span>
                      <Badge count={unreadCount} size="small" />
                    </Link>
                  ) : null}
                </div>
              </>
            ) : (
              <Button type="primary" className="mobile-drawer-login" onClick={openLoginModal}>
                登入
              </Button>
            )}
          </div>
        </div>
      </Drawer>

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSelectRole={handleRoleLogin}
        loadingRole={loginLoadingRole}
      />
    </Header>
  );
};

export default AppHeader;
