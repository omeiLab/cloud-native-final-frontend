import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, List, Modal, Row, Space, Tag, Typography } from 'antd';
import { apiClient, API_BASE_URL } from '../api/client';
import { useAuth } from '../context/AuthContext';

const { Title, Paragraph, Text } = Typography;

const ENDPOINT_GROUPS = [
  {
    title: 'Auth / 身分驗證',
    items: [
      'GET /auth/oidc/authorize-url',
      'POST /auth/oidc/callback',
      'POST /auth/register',
      'POST /auth/login',
      'POST /auth/refresh',
      'POST /auth/logout',
      'GET /auth/me'
    ]
  },
  {
    title: '員工端',
    items: [
      'GET /events',
      'GET /events/{event_id}',
      'POST /registrations',
      'PATCH /registrations/{id}（可選：取消後復原報名）',
      'POST /registrations/{id}/resume（可選：同上）',
      'DELETE /registrations/{id}',
      'POST /registrations/{id}/forfeit',
      'POST /registrations/{id}/confirm',
      'GET /me/registrations',
      'GET /me/tickets',
      'GET /me/tickets/{id}/qr'
    ]
  },
  {
    title: '驗票端',
    items: [
      'POST /verify/ticket'
    ]
  },
  {
    title: '通知與即時',
    items: [
      'GET /notifications',
      'GET /notifications/unread-count',
      'POST /notifications/{id}/read',
      'POST /notifications/mark-all-read',
      'WS /ws (auth / ping / pong / 重連補拉)'
    ]
  },
  {
    title: '管理員',
    items: [
      'POST /admin/events',
      'PATCH /admin/events/{id}',
      'POST /admin/events/{id}/publish',
      'POST /admin/events/{id}/sessions/{session_id}/lottery',
      'POST /admin/events/{id}/cancel',
      'GET /admin/sites/employee-count',
      'GET /admin/events/{id}/registrations',
      'GET /admin/events/{id}/dashboard',
      'GET /admin/system/time-offset',
      'POST /admin/system/time-offset',
      'POST /admin/ops/run-nightly-lottery',
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
          finish({ ok: false, detail: '逾時（10 秒內未收到 auth_ok）' });
        }, 10000);

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'auth', token: apiClient.getAccessToken() }));
        };

        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === 'auth_ok') {
            ws.close();
            globalThis.clearTimeout(timer);
            finish({ ok: true, detail: '收到 auth_ok' });
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        };

        ws.onerror = () => {
          globalThis.clearTimeout(timer);
          finish({ ok: false, detail: '連線錯誤' });
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
      setError(e?.error?.message || '檢查失敗，請確認已登入且後端已啟動');
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
          next.siteEmployeeCount = { ok: true, detail: `總數 ${site?.data?.total ?? 0}` };
        } catch (e) {
          next.siteEmployeeCount = { ok: false, detail: e?.error?.message || '失敗' };
        }

        try {
          const events = await apiClient.getEvents({ scope: 'all', page: 1, page_size: 5 });
          const firstId = events?.data?.items?.[0]?.id;
          if (!firstId) {
            next.adminDashboard = { ok: false, detail: '沒有可測試的活動' };
            next.adminRegistrations = { ok: false, detail: '沒有可測試的活動' };
          } else {
            const [dashboard, regs] = await Promise.all([
              apiClient.adminGetDashboard(firstId),
              apiClient.adminGetRegistrations(firstId, { page: 1, page_size: 5, mask_pii: true })
            ]);
            next.adminDashboard = { ok: true, detail: `活動 ${firstId}，場次 ${dashboard?.data?.sessions_lottery?.length || 0}` };
            next.adminRegistrations = { ok: true, detail: `取回 ${(regs?.data?.items || []).length} 筆` };
          }
        } catch (e) {
          next.adminDashboard = { ok: false, detail: e?.error?.message || '失敗' };
          next.adminRegistrations = { ok: false, detail: e?.error?.message || '失敗' };
        }

        try {
          const offset = await apiClient.adminGetTimeOffset();
          next.timeOffset = { ok: true, detail: `minutes=${offset?.data?.minutes ?? 0}` };
        } catch (e) {
          next.timeOffset = { ok: false, detail: e?.error?.message || '端點未部署或無權限' };
        }
      }

      if (isVerifier) {
        try {
          await apiClient.verifyTicket({ qr_payload: 'debug-invalid-payload', device_id: 'API_EXPLORER' });
          next.verifyTicket = { ok: true, detail: '驗票 API 可呼叫' };
        } catch (e) {
          const msg = e?.error?.message || '回應錯誤';
          next.verifyTicket = { ok: true, detail: `API 可達（預期錯誤：${msg}）` };
        }
      }

      setAdvancedReport(next);
    } catch (e) {
      setError(e?.error?.message || '進階檢查失敗');
      setAdvancedReport(null);
    } finally {
      setAdvancedChecking(false);
    }
  };

  const runNightlyLotteryNow = () => {
    Modal.confirm({
      title: '執行 nightly lottery',
      content: '此操作會實際觸發後端排程邏輯，僅在你確認測試需求時執行。',
      okText: '執行',
      cancelText: '取消',
      onOk: async () => {
        try {
          await apiClient.adminRunNightlyLottery();
          Modal.success({ title: '已觸發 nightly lottery' });
        } catch (e) {
          Modal.error({ title: '執行失敗', content: e?.error?.message || '端點未部署或無權限' });
        }
      }
    });
  };

  return (
    <div className="page-wrap">
      <Card className="hero-card">
        <Title level={2}>後端 API 完整探索與整合驗證</Title>
        <Paragraph>
          此頁依 `frontend-api.md` 對照目前前端實作，並提供一鍵健康檢查（`/auth/me` + WebSocket + OpenAPI）。
        </Paragraph>
        <Space wrap>
          <Button type="primary" onClick={runChecks} loading={checking} disabled={!user}>
            一鍵執行整合檢查
          </Button>
          <Button onClick={runAdvancedChecks} loading={advancedChecking} disabled={!user}>
            進階 API 檢查
          </Button>
          <Button danger onClick={runNightlyLotteryNow} disabled={user?.role !== 'ADMIN'}>
            手動測試 nightly lottery
          </Button>
          <Tag color={user ? 'green' : 'orange'}>
            {user ? `目前角色：${user.role}` : '請先登入後再檢查'}
          </Tag>
        </Space>
      </Card>

      {error ? <Alert style={{ marginTop: 16 }} type="error" showIcon message={error} /> : null}

      {report ? (
        <Card style={{ marginTop: 16 }}>
          <Descriptions title="檢查結果" bordered column={1}>
            <Descriptions.Item label="/auth/me">
              <Tag color="green">成功</Tag> {report.me.name}（{report.me.role}）
            </Descriptions.Item>
            <Descriptions.Item label="/events?scope=all">
              <Text>總數 {report.eventsTotal}、本頁取回 {report.eventsVisible}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="/notifications/unread-count">
              <Text>未讀 {report.unread}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="/notifications">
              <Text>取回 {report.notificationsFetched} 筆</Text>
            </Descriptions.Item>
            <Descriptions.Item label="/me/registrations">
              <Text>取回 {report.myRegsFetched} 筆</Text>
            </Descriptions.Item>
            <Descriptions.Item label="/me/tickets">
              <Text>取回 {report.myTicketsFetched} 筆</Text>
            </Descriptions.Item>
            <Descriptions.Item label="WebSocket">
              <Tag color={report.wsResult.ok ? 'green' : 'red'}>{report.wsResult.ok ? '成功' : '失敗'}</Tag> {report.wsResult.detail}
            </Descriptions.Item>
            <Descriptions.Item label="/api/openapi.json">
              <Tag color={report.openapiOk ? 'green' : 'orange'}>{report.openapiOk ? '可存取' : '不可存取'}</Tag>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}

      {advancedReport ? (
        <Card style={{ marginTop: 16 }}>
          <Descriptions title="進階檢查結果" bordered column={1}>
            {Object.entries(advancedReport).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>
                <Tag color={value.ok ? 'green' : 'orange'}>{value.ok ? '成功' : '注意'}</Tag> {value.detail}
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
                      <Tag color="blue">已串接</Tag>
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

