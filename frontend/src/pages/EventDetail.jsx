import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Descriptions,
  Empty,
  InputNumber,
  Modal,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  message
} from 'antd';
import dayjs from 'dayjs';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { pickEventImage } from '../assets/media';
import { REGISTRATION_STATUS_LABELS, SESSION_STATUS_LABELS, labelOr } from '../utils/labels';
import '../styles/EventDetail.css';

const { Title, Paragraph } = Typography;
const REGISTRATION_ALLOWED_ROLES = new Set(['EMPLOYEE']);
/** 此狀態下不佔用報名額度，報名開放中可再次報名 */
const RE_REGISTER_ELIGIBLE_STATUSES = new Set(['CANCELLED', 'FORFEITED']);

const registrationErrMsg = (e) =>
  e?.error?.message || (typeof e?.detail === 'string' ? e.detail : '') || '';

const isAlreadyRegisteredError = (e) =>
  e?.error?.code === 'ALREADY_REGISTERED' ||
  /已報名此場次|already registered|ALREADY_REGISTERED/i.test(registrationErrMsg(e));
const CETS_ELIGIBILITY_MARKER_PREFIX = '<!--CETS_ELIGIBILITY:';
const CETS_ELIGIBILITY_MARKER_SUFFIX = '-->';

const parseEligibilityFromDescription = (rawDescription) => {
  const description = String(rawDescription || '');
  const start = description.indexOf(CETS_ELIGIBILITY_MARKER_PREFIX);
  if (start < 0) return null;
  const end = description.indexOf(CETS_ELIGIBILITY_MARKER_SUFFIX, start);
  if (end < 0) return null;
  const encoded = description.slice(start + CETS_ELIGIBILITY_MARKER_PREFIX.length, end).trim();
  if (!encoded) return null;
  try {
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
};

/** 畫面上不顯示內嵌的資格設定註解（避免出現整段 URL 編碼 JSON） */
const stripEligibilityMarkerFromDescription = (rawDescription) => {
  const description = String(rawDescription || '');
  const start = description.indexOf(CETS_ELIGIBILITY_MARKER_PREFIX);
  if (start < 0) return description.trim();
  const end = description.indexOf(CETS_ELIGIBILITY_MARKER_SUFFIX, start);
  if (end < 0) return description.trim();
  const before = description.slice(0, start).trimEnd();
  const after = description.slice(end + CETS_ELIGIBILITY_MARKER_SUFFIX.length).trimStart();
  return [before, after].filter(Boolean).join('\n').trim();
};

const ticketCategory = (ticketTypeName) => (/兒童|儿童/i.test(String(ticketTypeName || '')) ? 'child' : 'adult');

const buildEligibilityLines = (elig, category) => {
  const cfg = elig?.[category];
  if (!cfg) return [];
  const lines = [];
  const appendOtherRestrictions = () => {
    const raw = String(cfg.other_restrictions || '').trim();
    if (!raw) return;
    raw.split('\n').forEach((line) => {
      const t = line.trim();
      if (t) lines.push(t);
    });
  };

  if (cfg.unlimited) {
    appendOtherRestrictions();
    return lines;
  }

  if (category === 'adult') {
    if (cfg.gender === 'M') lines.push('性別：限男性');
    if (cfg.gender === 'F') lines.push('性別：限女性');
    if (typeof cfg.height_min_cm === 'number') lines.push(`身高：≥ ${cfg.height_min_cm} cm`);
    if (typeof cfg.height_max_cm === 'number') lines.push(`身高：≤ ${cfg.height_max_cm} cm`);
    if (typeof cfg.age_min === 'number') lines.push(`年齡：≥ ${cfg.age_min}`);
    if (typeof cfg.age_max === 'number') lines.push(`年齡：≤ ${cfg.age_max}`);
  } else {
    if (typeof cfg.age_min === 'number') lines.push(`年齡：≥ ${cfg.age_min}`);
    if (typeof cfg.age_max === 'number') lines.push(`年齡：≤ ${cfg.age_max}`);
  }
  const health = cfg.health;
  if (health && !health.unlimited) {
    const items = Array.isArray(health.no_diseases) ? health.no_diseases : [];
    if (items.length) {
      lines.push(`健康狀態：需符合「無以下疾病」：${items.join('、')}`);
    }
  }
  appendOtherRestrictions();
  return lines;
};

const EventDetail = () => {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [event, setEvent] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [pendingSession, setPendingSession] = useState(null);
  const [pendingTicketType, setPendingTicketType] = useState(null);
  const [selectedPeopleCount, setSelectedPeopleCount] = useState(1);
  const [eligibilityConfirmed, setEligibilityConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const registrationMap = useMemo(() => {
    const map = new Map();
    registrations.forEach((r) => map.set(r.session_id, r));
    return map;
  }, [registrations]);

  const loadPage = async () => {
    setLoading(true);
    setError('');
    try {
      const promises = [apiClient.getEvent(eventId)];
      if (apiClient.getAccessToken()) {
        promises.push(apiClient.getMyRegistrations({ page: 1, page_size: 100 }));
      }

      const [eventRes, regRes] = await Promise.all(promises);
      setEvent(eventRes.data);
      setRegistrations(regRes?.data?.items || []);
    } catch (e) {
      setError(e?.error?.message || '活動資料載入失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage();
  }, [eventId]);

  // 測試/實務：抽籤狀態在後端批次更新（每分鐘/排程）後，員工端需要刷新才能看到 WON/WAITLISTED/LOST。
  // 這裡在「待抽籤/抽籤中」狀態時做輕量輪詢，讓 E2E 測試流程更順。
  useEffect(() => {
    if (!apiClient.getAccessToken()) return undefined;
    const hasPending = (registrations || []).some((r) => ['IN_LOTTERY'].includes(r.status));
    const hasRunning = (event?.sessions || []).some((s) => ['LOTTERY_RUNNING'].includes(s.status));
    if (!hasPending && !hasRunning) return undefined;
    const timer = globalThis.setInterval(() => {
      loadPage().catch(() => {});
    }, 8000);
    return () => globalThis.clearInterval(timer);
  }, [event?.sessions, registrations]);

  const getEventPrimaryStatus = () => {
    const hasOpenSession = (event?.sessions || []).some((session) => session.status === 'REGISTRATION_OPEN');
    if (event?.status === 'CANCELLED') return { label: '已取消', color: 'red' };
    if (event?.status !== 'PUBLISHED') return { label: '活動未發布', color: 'default' };
    if (user && !REGISTRATION_ALLOWED_ROLES.has(user.role)) return { label: '此身分不可報名', color: 'warning' };
    if (!hasOpenSession) return { label: '已截止/未開放', color: 'default' };
    return { label: '可報名', color: 'success' };
  };

  const tryReactivateRegistration = async (registrationId, ticketType) => {
    const payload = {
      ticket_type_id: ticketType.id
    };
    const attempts = [
      () => apiClient.patchRegistration(registrationId, payload),
      () => apiClient.resumeRegistration(registrationId, payload)
    ];
    let lastErr;
    for (const run of attempts) {
      try {
        await run();
        return;
      } catch (e) {
        lastErr = e;
        const st = e?.httpStatus;
        if (st !== 404 && st !== 405) {
          throw e;
        }
      }
    }
    throw lastErr;
  };

  const registerSession = async (session, ticketType, ticketCount = 1) => {
    if (!user) {
      message.info('請先點選右上角「登入」完成登入後再報名。');
      return;
    }
    if (!REGISTRATION_ALLOWED_ROLES.has(user.role)) {
      Modal.warning({
        title: '此身分不可報名',
        content: `驗票員、管理員不可報名。你目前是 ${user.role} 身分。`
      });
      return;
    }
    const count = Math.max(1, Math.floor(Number(ticketCount || 1)));
    const prior = registrations.find(
      (r) => r.session_id === session.id && RE_REGISTER_ELIGIBLE_STATUSES.has(r.status)
    );
    try {
      for (let i = 0; i < count; i += 1) {
        await apiClient.createRegistration({
          session_id: session.id,
          ticket_type_id: ticketType.id
        });
      }
      message.success(count > 1 ? `已送出 ${count} 張${ticketType.name}報名` : '報名成功');
      await loadPage();
    } catch (e) {
      if (prior && isAlreadyRegisteredError(e)) {
        try {
          await tryReactivateRegistration(prior.id, ticketType);
          message.success('已重新報名');
          await loadPage();
        } catch (e2) {
          message.error(
            registrationErrMsg(e2) ||
              '無法再次報名：後端仍將「已取消」紀錄視為佔用場次。請請後端在 POST /registrations 排除 CANCELLED／FORFEITED，或實作 PATCH /registrations/{id}／POST .../resume。'
          );
        }
        return;
      }
      message.error(registrationErrMsg(e) || '報名失敗');
    }
  };

  const openRegisterModal = (session, ticketType) => {
    setPendingSession(session);
    setPendingTicketType(ticketType);
    setSelectedPeopleCount(1);
    setEligibilityConfirmed(false);
    setRegisterModalOpen(true);
  };

  const submitRegisterModal = async () => {
    if (!pendingSession || !pendingTicketType) return;
    if (!eligibilityConfirmed) {
      message.warning('請先確認您與同行者皆符合報名條件。');
      return;
    }
    const ticketCount = Math.max(1, Math.floor(Number(selectedPeopleCount || 1)));
    if (!Number.isFinite(ticketCount)) {
      message.error('請輸入有效張數');
      return;
    }

    setRegistering(true);
    try {
      await registerSession(pendingSession, pendingTicketType, ticketCount);
      setRegisterModalOpen(false);
    } finally {
      setRegistering(false);
    }
  };

  const runConfirm = async (registrationId) => {
    try {
      await apiClient.confirmRegistration(registrationId);
      message.success('確認完成，票券已發行');
      await loadPage();
    } catch (e) {
      message.error(e?.error?.message || '確認失敗');
    }
  };

  const runForfeit = async (registrationId) => {
    Modal.confirm({
      title: '確認棄權',
      content: '棄權後名額將遞補給候補者，確定要繼續嗎？',
      onOk: async () => {
        try {
          await apiClient.forfeitRegistration(registrationId);
          message.success('已棄權');
          await loadPage();
        } catch (e) {
          message.error(e?.error?.message || '棄權失敗');
        }
      }
    });
  };

  const runCancel = async (registrationId) => {
    try {
      await apiClient.cancelRegistration(registrationId);
      message.success('已取消報名');
      await loadPage();
    } catch (e) {
      message.error(e?.error?.message || '取消失敗');
    }
  };

  const renderActions = (session) => {
    const reg = registrationMap.get(session.id);
    const roleCanRegister = REGISTRATION_ALLOWED_ROLES.has(user?.role);
    const mayRegisterAgain = !reg || RE_REGISTER_ELIGIBLE_STATUSES.has(reg.status);

    if (user && !roleCanRegister) {
      return <Tag color="warning">驗票員 / 管理員不可報名</Tag>;
    }

    if (mayRegisterAgain) {
      if (session.status !== 'REGISTRATION_OPEN') {
        return <Tag>目前不可報名</Tag>;
      }
      const signupButtons = (
        <Space wrap>
          {(session.ticket_types || []).map((tt) => (
            <Button
              key={tt.id}
              type="primary"
              onClick={() => {
                openRegisterModal(session, tt);
              }}
            >
              報名 {tt.name}（名額：{tt.quota}）
            </Button>
          ))}
        </Space>
      );
      if (reg?.status === 'CANCELLED') {
        return (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Alert type="info" showIcon message="您先前已取消報名，於報名期間內可再次報名。" />
            {signupButtons}
          </Space>
        );
      }
      if (reg?.status === 'FORFEITED') {
        return (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Alert type="info" showIcon message="您先前已棄權，若本場次仍開放報名可再次報名。" />
            {signupButtons}
          </Space>
        );
      }
      return signupButtons;
    }

    if (reg.status === 'REGISTERED') {
      return <Button onClick={() => runCancel(reg.id)}>取消報名</Button>;
    }

    if (reg.status === 'WON') {
      return (
        <Space>
          <Button type="primary" onClick={() => runConfirm(reg.id)}>確認參加並領票</Button>
          <Button danger onClick={() => runForfeit(reg.id)}>棄權</Button>
        </Space>
      );
    }

    return <Tag color="blue">目前狀態：{labelOr(REGISTRATION_STATUS_LABELS, reg.status, reg.status)}</Tag>;
  };

  if (loading) {
    return (
      <div className="page-wrap centered-page">
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-wrap">
        <Alert type="error" showIcon message={error} />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page-wrap">
        <Empty description="查無活動" />
      </div>
    );
  }

  const primaryStatus = getEventPrimaryStatus();

  return (
    <div className="page-wrap event-detail-page">
      <Card className="event-head">
        <Row gutter={[24, 24]}>
          <Col xs={24} md={10}>
            <img
              className="event-detail-cover"
              src={event.cover_image_url || pickEventImage(event.id || event.title)}
              alt={event.title}
              loading="lazy"
              decoding="async"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = pickEventImage(event.id || event.title);
              }}
            />
          </Col>
          <Col xs={24} md={14}>
            <Space className="event-detail-title-row" align="start" wrap>
              <Title level={2}>{event.title}</Title>
              <Tag className="event-detail-status" color={primaryStatus.color}>
                {primaryStatus.label}
              </Tag>
            </Space>
            <Paragraph>{stripEligibilityMarkerFromDescription(event.description)}</Paragraph>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="狀態">{primaryStatus.label}</Descriptions.Item>
              <Descriptions.Item label="開放廠區">{event.allowed_sites?.length ? event.allowed_sites.join(', ') : '全廠區'}</Descriptions.Item>
              <Descriptions.Item label="建立時間">{dayjs(event.created_at).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Title level={4}>場次與票種</Title>
        <Collapse
          items={(event.sessions || []).map((session) => ({
            key: session.id,
            label: `${session.title} | ${dayjs(session.starts_at).format('MM/DD HH:mm')} - ${dayjs(session.ends_at).format('HH:mm')} | ${labelOr(SESSION_STATUS_LABELS, session.status, session.status)}`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="場地">{session.venue}</Descriptions.Item>
                  <Descriptions.Item label="報名期間">
                    {dayjs(session.registration_opens_at).format('YYYY-MM-DD HH:mm')} - {dayjs(session.registration_closes_at).format('YYYY-MM-DD HH:mm')}
                  </Descriptions.Item>
                  <Descriptions.Item label="確認期限">{session.confirmation_deadline_hours} 小時</Descriptions.Item>
                </Descriptions>
                {renderActions(session)}
              </Space>
            )
          }))}
        />
      </Card>

      <Modal
        title={pendingTicketType ? `報名 ${pendingTicketType.name}` : '報名活動'}
        open={registerModalOpen}
        onOk={submitRegisterModal}
        onCancel={() => setRegisterModalOpen(false)}
        confirmLoading={registering}
        okButtonProps={{ disabled: !eligibilityConfirmed }}
        okText="我已確認符合條件並報名"
        cancelText="取消"
      >
        {pendingSession ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            {(() => {
              const elig = parseEligibilityFromDescription(event?.description);
              const cat = ticketCategory(pendingTicketType?.name);
              const lines = buildEligibilityLines(elig, cat);
              if (!lines.length) return null;
              return (
                <Alert
                  type="warning"
                  showIcon
                  message={cat === 'child' ? '兒童票報名限制' : '成人票報名限制'}
                  description={(
                    <div>
                      {lines.map((line) => (
                        <div key={line}>- {line}</div>
                      ))}
                    </div>
                  )}
                />
              );
            })()}
            <Paragraph style={{ marginBottom: 0 }}>
              場次：{pendingSession.title}
            </Paragraph>
            <Paragraph style={{ marginBottom: 0 }}>
              票種：{pendingTicketType?.name}
            </Paragraph>
            <Checkbox
              checked={eligibilityConfirmed}
              onChange={(e) => setEligibilityConfirmed(e.target.checked)}
            >
              我已確認本人與同行者皆符合此票種報名條件
            </Checkbox>
            {(() => {
              const maxTickets = Math.max(1, Number(pendingTicketType?.quota || 1));
              return (
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Paragraph style={{ marginBottom: 0 }}>
                    {ticketCategory(pendingTicketType?.name) === 'child' ? '兒童票張數' : '成人票張數'}
                  </Paragraph>
                  <InputNumber
                    min={1}
                    max={maxTickets}
                    precision={0}
                    style={{ width: '100%' }}
                    value={selectedPeopleCount}
                    onChange={(v) => setSelectedPeopleCount(Math.max(1, Math.floor(Number(v || 1))))}
                  />
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    不需登記眷屬；請依實際同行人數分票種送出報名。
                  </Paragraph>
                </Space>
              );
            })()}
          </Space>
        ) : null}
      </Modal>
    </div>
  );
};

export default EventDetail;
