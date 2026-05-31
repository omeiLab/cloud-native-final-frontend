import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, List, Row, Space, Tag, Typography } from 'antd';
import { apiClient, API_BASE_URL } from '../api/client';
import { useAuth } from '../context/AuthContext';

const { Title, Paragraph, Text } = Typography;

const ENDPOINT_GROUPS = [
  {
    title: 'Auth / identity',
    items: [
      'GET /auth/oidc/authorize-url',
      'POST /auth/oidc/callback',
      'POST /auth/refresh',
      'POST /auth/logout',
      'GET /auth/me'
    ]
  },
  {
    title: 'Employee APIs',
    items: [
      'GET /events',
      'GET /events/{event_id}',
      'POST /registrations',
      'PATCH /registrations/{id} (optional resume after cancel)',
      'POST /registrations/{id}/resume (optional, same as above)',
      'DELETE /registrations/{id}',
      'POST /registrations/{id}/forfeit',
      'POST /registrations/{id}/confirm',
      'GET /me/registrations',
      'GET /me/tickets',
      'GET /me/tickets/{id}/qr'
    ]
  },
  {
    title: 'Ticket verification',
    items: [
      'POST /verify/ticket'
    ]
  },
  {
    title: 'Notifications and realtime',
    items: [
      'GET /notifications',
      'GET /notifications/unread-count',
      'POST /notifications/{id}/read',
      'POST /notifications/mark-all-read',
      'WS /ws (auth / ping / pong / reconnect catch-up)'
    ]
  },
  {
    title: 'Admin APIs',
    items: [
      'POST /admin/events',
      'PATCH /admin/events/{id}',
      'POST /admin/events/{id}/publish',
      'POST /admin/sessions/{session_id}/run-lottery',
      'POST /admin/events/{id}/cancel',
      'GET /admin/sites/employee-count',
      'GET /admin/events/{id}/registrations',
      'GET /admin/events/{id}/dashboard',
      'GET /admin/events/{id}/export',
      'POST /admin/events/{id}/export/async',
      'GET /admin/events/{id}/export/tasks/{task_id}',
      'GET /admin/events/{id}/export/tasks/{task_id}/download'
    ]
  }
];

const ApiExplorerPage = () => {
  const { user } = useAuth();
  const [checking, setChecking] = useState(false);
  const [advancedChecking, setAdvancedChecking] = useState(false);
  const [report, setReport] = useState(null);
  const [advancedReport, setAdvancedReport] = useState(null);
  const [error, setError] = useState('');

  const baseOrigin = useMemo(() => API_BASE_URL.replace(/\/api\/v1$/, ''), []);

  const runChecks = async () => {
    setChecking(true);
    setError('');
    try {
      const me = await apiClient.getMe();
      const events = await apiClient.getEvents({ scope: 'all', page: 1, page_size: 20 });
      const unread = await apiClient.getUnreadCount();
      const notifications = await apiClient.getNotifications({ unread_only: false, page: 1, page_size: 5 });
      const myRegs = await apiClient.getMyRegistrations({ page: 1, page_size: 5 });
      const myTickets = await apiClient.getMyTickets({ page: 1, page_size: 5 });

      let openapiOk = false;
      try {
        const openapiRes = await fetch(`${baseOrigin}/api/openapi.json`);
        openapiOk = openapiRes.ok;
      } catch {
        openapiOk = false;
      }

      const wsResult = await new Promise((resolve) => {
        const ws = new WebSocket(apiClient.getWsUrl());
        let done = false;
        const finish = (value) => {
          if (done) return;
          done = true;
          resolve(value);
        };
        const timer = globalThis.setTimeout(() => {
          ws.close();
          finish({ ok: false, detail: 'Timed out (no auth_ok within 10 seconds)' });
        }, 10000);

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'auth', token: apiClient.getAccessToken() }));
        };

        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === 'auth_ok') {
            ws.close();
            globalThis.clearTimeout(timer);
            finish({ ok: true, detail: 'Received auth_ok' });
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        };

        ws.onerror = () => {
          globalThis.clearTimeout(timer);
          finish({ ok: false, detail: 'Connection error' });
        };
      });

      setReport({
        me: me.data,
        eventsTotal: events.data.total || 0,
        eventsVisible: (events.data.items || []).length,
        unread: unread.data.unread_count || 0,
        notificationsFetched: (notifications.data.items || []).length,
        myRegsFetched: (myRegs.data.items || []).length,
        myTicketsFetched: (myTickets.data.items || []).length,
        openapiOk,
        wsResult
      });
    } catch (e) {
      setError(e?.error?.message || 'Checks failed. Sign in and ensure the backend is running.');
      setReport(null);
    } finally {
      setChecking(false);
    }
  };

  const runAdvancedChecks = async () => {
    setAdvancedChecking(true);
    setError('');
    try {
      const next = {};
      const role = user?.role;
      const isAdmin = role === 'ADMIN' || role === 'ADMIN_VIEWER';
      const isVerifier = role === 'VERIFIER';

      if (isAdmin) {
        try {
          const site = await apiClient.adminGetSiteEmployeeCount(['HSINCHU', 'TAINAN']);
          next.siteEmployeeCount = { ok: true, detail: `Total ${site?.data?.total ?? 0}` };
        } catch (e) {
          next.siteEmployeeCount = { ok: false, detail: e?.error?.message || 'Failed' };
        }

        try {
          const events = await apiClient.getEvents({ scope: 'all', page: 1, page_size: 5 });
          const firstId = events?.data?.items?.[0]?.id;
          if (!firstId) {
            next.adminDashboard = { ok: false, detail: 'No testable events' };
            next.adminRegistrations = { ok: false, detail: 'No testable events' };
          } else {
            const [dashboard, regs] = await Promise.all([
              apiClient.adminGetDashboard(firstId),
              apiClient.adminGetRegistrations(firstId, { page: 1, page_size: 5, mask_pii: true })
            ]);
            next.adminDashboard = { ok: true, detail: `Event ${firstId}, sessions ${dashboard?.data?.sessions_lottery?.length || 0}` };
            next.adminRegistrations = { ok: true, detail: `Fetched ${(regs?.data?.items || []).length} records` };
          }
        } catch (e) {
          next.adminDashboard = { ok: false, detail: e?.error?.message || 'Failed' };
          next.adminRegistrations = { ok: false, detail: e?.error?.message || 'Failed' };
        }
      }

      if (isVerifier) {
        try {
          await apiClient.verifyTicket({ qr_payload: 'debug-invalid-payload', device_id: 'API_EXPLORER' });
          next.verifyTicket = { ok: true, detail: 'Verify API reachable' };
        } catch (e) {
          const msg = e?.error?.message || 'Response error';
          next.verifyTicket = { ok: true, detail: `API reachable (expected error: ${msg}）` };
        }
      }

      setAdvancedReport(next);
    } catch (e) {
      setError(e?.error?.message || 'Advanced checks failed');
      setAdvancedReport(null);
    } finally {
      setAdvancedChecking(false);
    }
  };

  return (
    <div className="page-wrap">
      <Card className="hero-card">
        <Title level={2}>Backend API explorer and integration checks</Title>
        <Paragraph>
          This page maps frontend-api.md to the current frontend and provides one-click health checks (/auth/me, WebSocket, OpenAPI).
        </Paragraph>
        <Space wrap>
          <Button type="primary" onClick={runChecks} loading={checking} disabled={!user}>
            Run integration checks
          </Button>
          <Button onClick={runAdvancedChecks} loading={advancedChecking} disabled={!user}>
            Run advanced API checks
          </Button>
          <Tag color={user ? 'green' : 'orange'}>
            {user ? `Current role: ${user.role}` : 'Sign in before running checks'}
          </Tag>
        </Space>
      </Card>

      {error ? <Alert style={{ marginTop: 16 }} type="error" showIcon message={error} /> : null}

      {report ? (
        <Card style={{ marginTop: 16 }}>
          <Descriptions title="Check results" bordered column={1}>
            <Descriptions.Item label="/auth/me">
              <Tag color="green">Success</Tag> {report.me.name}（{report.me.role}）
            </Descriptions.Item>
            <Descriptions.Item label="/events?scope=all">
              <Text>Total {report.eventsTotal}, fetched on page {report.eventsVisible}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="/notifications/unread-count">
              <Text>Unread {report.unread}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="/notifications">
              <Text>Fetched {report.notificationsFetched} records</Text>
            </Descriptions.Item>
            <Descriptions.Item label="/me/registrations">
              <Text>Fetched {report.myRegsFetched} records</Text>
            </Descriptions.Item>
            <Descriptions.Item label="/me/tickets">
              <Text>Fetched {report.myTicketsFetched} records</Text>
            </Descriptions.Item>
            <Descriptions.Item label="WebSocket">
              <Tag color={report.wsResult.ok ? 'green' : 'red'}>{report.wsResult.ok ? 'Success' : 'Failed'}</Tag> {report.wsResult.detail}
            </Descriptions.Item>
            <Descriptions.Item label="/api/openapi.json">
              <Tag color={report.openapiOk ? 'green' : 'orange'}>{report.openapiOk ? 'Available' : 'Unavailable'}</Tag>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}

      {advancedReport ? (
        <Card style={{ marginTop: 16 }}>
          <Descriptions title="Advanced check results" bordered column={1}>
            {Object.entries(advancedReport).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>
                <Tag color={value.ok ? 'green' : 'orange'}>{value.ok ? 'Success' : 'Attention'}</Tag> {value.detail}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      ) : null}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {ENDPOINT_GROUPS.map((group) => (
          <Col xs={24} lg={12} key={group.title}>
            <Card title={group.title}>
              <List
                size="small"
                dataSource={group.items}
                renderItem={(item) => (
                  <List.Item>
                    <Space>
                      <Tag color="blue">Integrated</Tag>
                      <Text code>{item}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default ApiExplorerPage;
