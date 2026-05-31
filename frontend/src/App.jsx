import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout, Spin } from 'antd';
import Header from './components/Header';
import MobileBottomBar from './components/MobileBottomBar';
import BackgroundMusic from './components/BackgroundMusic';
import useI18n from './hooks/useI18n';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { publicAssetPath } from './assets/media';
import './styles/App.css';

const { Content, Footer } = Layout;
const EventsList = lazy(() => import('./pages/EventsList'));
const EventDetail = lazy(() => import('./pages/EventDetail'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const AdminConsolePage = lazy(() => import('./pages/AdminConsolePage'));
const VerifierPage = lazy(() => import('./pages/VerifierPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ApiExplorerPage = lazy(() => import('./pages/ApiExplorerPage'));
const OIDCCallbackPage = lazy(() => import('./pages/OIDCCallbackPage'));
const routerBasename = import.meta.env.BASE_URL === '/'
  ? undefined
  : import.meta.env.BASE_URL.replace(/\/$/, '');
const appBackgroundStyle = {
  '--app-bg-light': `url("${publicAssetPath('/backgrounds/background-light.webp')}")`,
  '--app-bg-dark': `url("${publicAssetPath('/backgrounds/background-dark.webp')}")`
};

const FullscreenLoader = () => (
  <div className="fullscreen-loader">
    <Spin size="large" />
  </div>
);

export const ProtectedRoute = ({ children, allowRoles }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <FullscreenLoader />;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (allowRoles && !allowRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const AppShell = () => {
  const location = useLocation();
  const { user } = useAuth();
  const { m } = useI18n();
  const hideBackgroundMusic = location.pathname === '/verify';
  return (
    <Layout
      className={`app-layout ${user ? 'app-layout-authenticated' : 'app-layout-guest'}`}
      style={appBackgroundStyle}
    >
      <Header />
      <Content className="main-content">
        <Suspense fallback={<FullscreenLoader />}>
          <Routes>
            <Route path="/" element={<EventsList />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<OIDCCallbackPage />} />
            <Route path="/auth/oidc/callback" element={<OIDCCallbackPage />} />
            <Route path="/oidc/callback" element={<OIDCCallbackPage />} />
            <Route path="/register" element={<Navigate to="/login" replace />} />
            <Route path="/events/:eventId" element={<EventDetail />} />
            <Route path="/api-explorer" element={<ApiExplorerPage />} />
            <Route
              path="/me"
              element={
                <ProtectedRoute allowRoles={['EMPLOYEE']}>
                  <UserProfile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/notifications"
              element={
                <ProtectedRoute>
                  <NotificationsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowRoles={['ADMIN', 'ADMIN_VIEWER']}>
                  <AdminConsolePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/verify"
              element={
                <ProtectedRoute allowRoles={['VERIFIER']}>
                  <VerifierPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Content>
      <Footer className="app-footer">{m.footer.text}</Footer>
      <MobileBottomBar />
      {!hideBackgroundMusic ? <BackgroundMusic /> : null}
    </Layout>
  );
};

const App = () => {
  return (
    <AuthProvider>
      <NotificationProvider>
        <BrowserRouter
          basename={routerBasename}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <AppShell />
        </BrowserRouter>
      </NotificationProvider>
    </AuthProvider>
  );
};

export default App;
