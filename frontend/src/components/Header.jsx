import React, { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Drawer, Dropdown, Layout, Space, Tag, Tooltip } from 'antd';
import { BellOutlined, FontSizeOutlined, LogoutOutlined, MenuOutlined, MoonOutlined, ScanOutlined, SettingOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useUiPreferences } from '../context/UiPreferencesContext';
import { LOGO_IMAGE } from '../assets/media';
import LoginModal from './LoginModal';
import { ROLE_LABELS, labelOr } from '../utils/labels';
import '../styles/Header.css';

const { Header } = Layout;

const AppHeader = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const { unreadCount, connected } = useNotifications();
  const { colorMode, setColorMode, textScale, setTextScale } = useUiPreferences();
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const canAccessTicketBox = user?.role === 'EMPLOYEE';
  const canAccessNotifications = user?.role === 'EMPLOYEE';

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleGoHome = (event) => {
    event.preventDefault();
    if (pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate('/');
  };

  const userMenuItems = [
    ...(canAccessTicketBox
      ? [{
        key: 'me',
        icon: <UserOutlined />,
        label: <Link to="/me">我的票匣</Link>
      }]
      : []),
    ...(canAccessNotifications
      ? [{
        key: 'notifications',
        icon: <BellOutlined />,
        label: <Link to="/notifications">通知中心</Link>
      }]
      : []),
    {
      key: 'divider',
      type: 'divider'
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '登出',
      onClick: async () => {
        await logout();
        navigate('/');
      }
    }
  ];

  const afterLoginNavigate = (role) => {
    if (role === 'ADMIN') {
      navigate('/admin');
      return;
    }
    if (role === 'VERIFIER') {
      navigate('/verify');
      return;
    }
    navigate('/');
  };

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
            <Button
              className="ghost-btn"
              icon={colorMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              onClick={() => setColorMode(colorMode === 'dark' ? 'light' : 'dark')}
            >
              {colorMode === 'dark' ? '明亮' : '暗黑'}
            </Button>
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

          {user?.role === 'ADMIN' || user?.role === 'ADMIN_VIEWER' ? (
            <Link to="/admin">
              <Button icon={<SettingOutlined />}>管理端</Button>
            </Link>
          ) : null}

          {user?.role === 'VERIFIER' ? (
            <Link to="/verify">
              <Button icon={<ScanOutlined />}>驗票端</Button>
            </Link>
          ) : null}

          {canAccessNotifications ? (
            <Link to="/notifications">
              <Badge count={unreadCount} size="small">
                <Button type="text" className="icon-btn" icon={<BellOutlined style={{ fontSize: 18 }} />} />
              </Badge>
            </Link>
          ) : null}

          {user ? (
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
              <Button type="text" className="user-button">
                <Avatar size={32} icon={<UserOutlined />} />
                <span className="user-name">{user.name}（{labelOr(ROLE_LABELS, user.role)}）</span>
                <Tooltip title={connected ? '即時通知連線正常' : '即時通知離線中（將自動重連）'}>
                  <Tag color={connected ? 'green' : 'orange'}>{connected ? '即時連線' : '離線中'}</Tag>
                </Tooltip>
              </Button>
            </Dropdown>
          ) : (
            <Button type="primary" onClick={() => setLoginOpen(true)}>登入</Button>
          )}
        </Space>
      </div>

      <div className="mobile-header-user">
        {user ? (
          <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
            <Button type="text" className="user-button">
              <Avatar size={28} icon={<UserOutlined />} />
            </Button>
          </Dropdown>
        ) : (
          <Button type="primary" size="small" onClick={() => setLoginOpen(true)}>登入</Button>
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
        <div className="mobile-drawer-group">
          <div className="mobile-drawer-group-title">個人與通知</div>
          {user ? (
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
              <Button block type="text" className="mobile-drawer-item">
                <span className="mobile-drawer-item-main">
                  <UserOutlined className="mobile-drawer-item-icon" />
                  {canAccessTicketBox ? '帳號與票匣' : '帳號設定'}
                </span>
                <span className="mobile-drawer-item-meta">{labelOr(ROLE_LABELS, user.role)}</span>
              </Button>
            </Dropdown>
          ) : (
            <Button block type="text" className="mobile-drawer-item" onClick={() => setLoginOpen(true)}>
              <span className="mobile-drawer-item-main">
                <UserOutlined className="mobile-drawer-item-icon" />
                登入
              </span>
            </Button>
          )}
          {canAccessNotifications ? (
            <Link to="/notifications">
              <Button block type="text" className="mobile-drawer-item">
                <span className="mobile-drawer-item-main">
                  <BellOutlined className="mobile-drawer-item-icon" />
                  通知中心
                </span>
                <Badge count={unreadCount} size="small" />
              </Button>
            </Link>
          ) : null}
        </div>

        <div className="mobile-drawer-divider" />

        <div className="mobile-drawer-group">
          <div className="mobile-drawer-group-title">顯示與探索</div>
          <Tooltip title={colorMode === 'dark' ? '切換為明亮模式' : '切換為暗黑模式'}>
            <Button
              block
              type="text"
              className="mobile-drawer-item"
              onClick={() => setColorMode(colorMode === 'dark' ? 'light' : 'dark')}
            >
              <span className="mobile-drawer-item-main">
                {colorMode === 'dark' ? <SunOutlined className="mobile-drawer-item-icon" /> : <MoonOutlined className="mobile-drawer-item-icon" />}
                {colorMode === 'dark' ? '切換為明亮模式' : '切換為暗黑模式'}
              </span>
            </Button>
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

        {user?.role === 'ADMIN' || user?.role === 'ADMIN_VIEWER' || user?.role === 'VERIFIER' ? <div className="mobile-drawer-divider" /> : null}

        {user?.role === 'ADMIN' || user?.role === 'ADMIN_VIEWER' ? (
          <div className="mobile-drawer-group">
            <div className="mobile-drawer-group-title">管理工具</div>
            <Link to="/admin">
              <Button block type="text" className="mobile-drawer-item">
                <span className="mobile-drawer-item-main">
                  <SettingOutlined className="mobile-drawer-item-icon" />
                  管理端
                </span>
              </Button>
            </Link>
          </div>
        ) : null}
        {user?.role === 'VERIFIER' ? (
          <div className="mobile-drawer-group">
            <div className="mobile-drawer-group-title">管理工具</div>
            <Link to="/verify">
              <Button block type="text" className="mobile-drawer-item">
                <span className="mobile-drawer-item-main">
                  <ScanOutlined className="mobile-drawer-item-icon" />
                  驗票端
                </span>
              </Button>
            </Link>
          </div>
        ) : null}

        {user ? (
          <>
            <div className="mobile-drawer-divider" />
            <Button
              block
              type="text"
              danger
              className="mobile-drawer-item"
              onClick={async () => {
                await logout();
                navigate('/');
                setMobileMenuOpen(false);
              }}
            >
              <span className="mobile-drawer-item-main">
                <LogoutOutlined className="mobile-drawer-item-icon" />
                登出
              </span>
            </Button>
          </>
        ) : null}
      </Drawer>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} afterLoginNavigate={afterLoginNavigate} />
    </Header>
  );
};

export default AppHeader;
