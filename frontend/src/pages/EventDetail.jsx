import React, { useEffect, useMemo, useReducer } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Modal,
  Row,
  Radio,
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
const NON_OCCUPYING_REGISTRATION_STATUSES = new Set(['CANCELLED', 'FORFEITED']);

const registrationErrMsg = (e) =>
  e?.error?.message || (typeof e?.detail === 'string' ? e.detail : '') || '';

const isAlreadyRegisteredError = (e) =>
  e?.error?.code === 'ALREADY_REGISTERED' ||
  /已報名此場次|already registered|ALREADY_REGISTERED/i.test(registrationErrMsg(e));

const CETS_ELIGIBILITY_MARKER_PREFIX = '<!--CETS_ELIGIBILITY:';
const CETS_ELIGIBILITY_MARKER_SUFFIX = '-->';

const getTicketAudienceLabel = (ticketType) => {
  const audience = String(ticketType?.audience || '').toUpperCase();
  const name = String(ticketType?.name || '');
  if (audience === 'DEPENDENT' || /兒童|孩童|小孩|child/i.test(name)) return '兒童';
  if (audience === 'EMPLOYEE' || /成人|adult/i.test(name)) return '成人';
  return '票種';
};

const getDefaultTicketType = (ticketTypes = []) => (
  ticketTypes.find((tt) => getTicketAudienceLabel(tt) === '成人') ||
  ticketTypes[0] ||
  null
);

/** Strip legacy hidden eligibility marker so old event descriptions stay readable. */
const stripEligibilityMarkerFromDescription = (rawDescription) => {
  const description = String(rawDescription || '');
  const start = description.indexOf(CETS_ELIGIBILITY_MARKER_PREFIX);
  if (start < 0) return description.trim();
  const end = description.indexOf(CETS_ELIGIBILITY_MARKER_SUFFIX, start);
  if (end < 0) return description.trim();
  const before = description.slice(0, start).trimEnd();
  const after = description.slice(end + CETS_ELIGIBILITY_MARKER_SUFFIX.length).trimStart();
  return before && after ? `${before}\n${after}` : (before || after).trim();
};

const registrationDialogInitialState = {
  open: false,
  registering: false,
  session: null,
  ticketType: null,
  ticketTypes: [],
  eligibilityConfirmed: false
};

const registrationDialogReducer = (state, action) => {
  switch (action.type) {
    case 'open': {
      const ticketTypes = Array.isArray(action.ticketTypes) ? action.ticketTypes : [];
      return {
        ...registrationDialogInitialState,
        open: true,
        session: action.session,
        ticketType: action.ticketType || getDefaultTicketType(ticketTypes),
        ticketTypes
      };
    }
    case 'close':
      return registrationDialogInitialState;
    case 'select_ticket_type': {
      const nextTicketType = state.ticketTypes.find((tt) => tt.id === action.ticketTypeId) || state.ticketType;
      return {
        ...state,
        ticketType: nextTicketType,
        eligibilityConfirmed:
          nextTicketType?.id === state.ticketType?.id ? state.eligibilityConfirmed : false
      };
    }
    case 'set_confirmed':
      return { ...state, eligibilityConfirmed: action.value };
    case 'set_registering':
      return { ...state, registering: action.value };
    default:
      return state;
  }
};

const eventDetailPageInitialState = {
  event: null,
  registrations: [],
  loading: false,
  error: ''
};

const eventDetailPageReducer = (state, patch) => ({ ...state, ...patch });

const EventSessionActions = ({
  session,
  user,
  registrationsBySession,
  onOpenRegister,
  onCancelRegistration,
  onConfirmRegistration,
  onForfeitRegistration
}) => {
  const roleCanRegister = REGISTRATION_ALLOWED_ROLES.has(user?.role);
  const sessionRegistrations = registrationsBySession.get(session.id) || [];
  const activeRegistrations = sessionRegistrations.filter(
    (r) => !NON_OCCUPYING_REGISTRATION_STATUSES.has(r.status)
  );
  const inactiveRegistrations = sessionRegistrations.filter((r) => RE_REGISTER_ELIGIBLE_STATUSES.has(r.status));
  const isRegistrationOpen = session.status === 'REGISTRATION_OPEN';
  const ticketTypes = session.ticket_types || [];
  const getTicketLabel = (reg) =>
    reg.ticket_type_name || ticketTypes.find((tt) => tt.id === reg.ticket_type_id)?.name || reg.ticket_type_id;

  if (user && !roleCanRegister) {
    return <Tag color="warning">驗票員 / 管理員不可報名</Tag>;
  }

  const ticketQuotaSummary = ticketTypes.length ? (
    <Space wrap>
      {ticketTypes.map((tt) => (
        <Tag key={tt.id} color={getTicketAudienceLabel(tt) === '兒童' ? 'cyan' : 'geekblue'}>
          {tt.name}：名額 {tt.quota ?? '-'}
        </Tag>
      ))}
    </Space>
  ) : null;

  const signupButton = isRegistrationOpen && !activeRegistrations.length ? (
    ticketTypes.length ? (
      <Button
        type="primary"
        onClick={() => {
          onOpenRegister(session, ticketTypes);
        }}
      >
        報名此場次
      </Button>
    ) : (
      <Tag>此場次尚無可報名票種</Tag>
    )
  ) : null;

  const activeRegistrationRows = activeRegistrations.length ? (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      {activeRegistrations.map((reg) => (
        <Space key={reg.id} wrap>
          <Tag color="blue">
            報名票種：{getTicketLabel(reg)}
          </Tag>
          <Tag>{labelOr(REGISTRATION_STATUS_LABELS, reg.status, reg.status)}</Tag>
          {reg.status === 'REGISTERED' ? (
            <Button onClick={() => onCancelRegistration(reg.id)}>取消報名</Button>
          ) : null}
          {reg.status === 'WON' ? (
            <>
              <Button type="primary" onClick={() => onConfirmRegistration(reg.id)}>確認參加並領票</Button>
              <Button danger onClick={() => onForfeitRegistration(reg.id)}>棄權</Button>
            </>
          ) : null}
        </Space>
      ))}
    </Space>
  ) : null;

  if (!isRegistrationOpen && !activeRegistrations.length) {
    return <Tag>目前不可報名</Tag>;
  }

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      {inactiveRegistrations.length && isRegistrationOpen ? (
        <Alert type="info" showIcon message="您先前有取消或棄權紀錄，於報名期間內可再次報名。" />
      ) : null}
      {activeRegistrations.length && isRegistrationOpen ? (
        <Alert type="info" showIcon message="您已完成此場次報名；每位員工每場次只需一筆報名。若需更換票種，請先取消後重新報名。" />
      ) : null}
      {ticketQuotaSummary}
      {activeRegistrationRows}
      {signupButton}
    </Space>
  );
};

const EventHeader = ({ event, primaryStatus, coverImage, fallbackImage }) => (
  <Card className="event-head">
    <Row gutter={[24, 24]}>
      <Col xs={24} md={10}>
        <img
          className="event-detail-cover"
          src={coverImage}
          alt={event.title}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = fallbackImage;
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
);

const EventSessionsCard = ({
  event,
  user,
  registrationsBySession,
  onOpenRegister,
  onCancelRegistration,
  onConfirmRegistration,
  onForfeitRegistration
}) => (
  <Card style={{ marginTop: 16 }}>
    <Title level={4}>場次與票種</Title>
    <Collapse
      defaultActiveKey={(event.sessions || []).map((session) => session.id)}
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
            <EventSessionActions
              session={session}
              user={user}
              registrationsBySession={registrationsBySession}
              onOpenRegister={onOpenRegister}
              onCancelRegistration={onCancelRegistration}
              onConfirmRegistration={onConfirmRegistration}
              onForfeitRegistration={onForfeitRegistration}
            />
          </Space>
        )
      }))}
    />
  </Card>
);

const RegistrationModal = ({
  dialog,
  onSubmit,
  onClose,
  onConfirmChange,
  onTicketTypeChange
}) => (
  <Modal
    title={dialog.session ? `報名 ${dialog.session.title}` : '報名活動'}
    open={dialog.open}
    onOk={onSubmit}
    onCancel={onClose}
    confirmLoading={dialog.registering}
    okButtonProps={{ disabled: !dialog.eligibilityConfirmed || !dialog.ticketType }}
    okText="我已確認符合條件並報名"
    cancelText="取消"
  >
    {dialog.session ? (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Paragraph style={{ marginBottom: 0 }}>
          場次：{dialog.session.title}
        </Paragraph>
        <Radio.Group
          className="registration-ticket-options"
          value={dialog.ticketType?.id}
          onChange={(e) => onTicketTypeChange(e.target.value)}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {(dialog.ticketTypes || []).map((tt) => (
              <Radio key={tt.id} value={tt.id} className="registration-ticket-option">
                <span className="registration-ticket-copy">
                  <span className="registration-ticket-name">{tt.name}</span>
                  <span className="registration-ticket-meta">
                    {getTicketAudienceLabel(tt)}｜名額 {tt.quota ?? '-'}
                  </span>
                </span>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
        <Checkbox
          checked={dialog.eligibilityConfirmed}
          onChange={(e) => onConfirmChange(e.target.checked)}
        >
          我已確認本人已符合此票種報名條件
        </Checkbox>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="送出份數">1 份報名</Descriptions.Item>
          <Descriptions.Item label="選擇票種">{dialog.ticketType?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="票種名額">{dialog.ticketType?.quota ?? '-'}</Descriptions.Item>
        </Descriptions>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          每位員工送出 1 份報名；票種名額僅供參考。
        </Paragraph>
      </Space>
    ) : null}
  </Modal>
);

const EventDetail = () => {
  const { eventId } = useParams();
  const { user } = useAuth();
  const [pageState, setPageState] = useReducer(eventDetailPageReducer, eventDetailPageInitialState);
  const [registrationDialog, dispatchRegistrationDialog] = useReducer(
    registrationDialogReducer,
    registrationDialogInitialState
  );
  const { event, registrations, loading, error } = pageState;

  const registrationsBySession = useMemo(() => {
    const map = new Map();
    registrations.forEach((r) => {
      const list = map.get(r.session_id) || [];
      list.push(r);
      map.set(r.session_id, list);
    });
    return map;
  }, [registrations]);

  const loadPage = async () => {
    setPageState({ loading: true, error: '' });
    try {
      const promises = [apiClient.getEvent(eventId)];
      if (apiClient.getAccessToken()) {
        promises.push(apiClient.getMyRegistrations({ page: 1, page_size: 100 }));
      }

      const [eventRes, regRes] = await Promise.all(promises);
      setPageState({
        event: eventRes.data,
        registrations: regRes?.data?.items || [],
        loading: false,
        error: ''
      });
    } catch (e) {
      setPageState({
        loading: false,
        error: e?.error?.message || '活動資料載入失敗'
      });
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
    try {
      await apiClient.patchRegistration(registrationId, payload);
      return;
    } catch (firstError) {
      const st = firstError?.httpStatus;
      if (st !== 404 && st !== 405) {
        throw firstError;
      }
      await apiClient.resumeRegistration(registrationId, payload);
    }
  };

  const registerSession = async (session, ticketType) => {
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
    const sessionRegistrations = registrationsBySession.get(session.id) || [];
    const activeRegistrations = sessionRegistrations.filter(
      (r) => !NON_OCCUPYING_REGISTRATION_STATUSES.has(r.status)
    );
    const prior = activeRegistrations.length
      ? null
      : sessionRegistrations.find((r) => RE_REGISTER_ELIGIBLE_STATUSES.has(r.status));
    try {
      await apiClient.createRegistration({
        session_id: session.id,
        ticket_type_id: ticketType.id
      });
      message.success('報名成功');
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
              '暫時無法恢復先前取消的報名，請稍後再試或聯繫管理員。'
          );
        }
        return;
      }
      if (isAlreadyRegisteredError(e)) {
        message.error('每位員工每場次只需一筆報名；若要更換票種，請先取消後重新報名。');
        return;
      }
      message.error(registrationErrMsg(e) || '報名失敗');
    }
  };

  const openRegisterModal = (session, ticketTypes) => {
    dispatchRegistrationDialog({ type: 'open', session, ticketTypes });
  };

  const submitRegisterModal = async () => {
    if (!registrationDialog.session || !registrationDialog.ticketType) return;
    if (!registrationDialog.eligibilityConfirmed) {
      message.warning('請先確認您已符合報名條件。');
      return;
    }

    dispatchRegistrationDialog({ type: 'set_registering', value: true });
    try {
      await registerSession(registrationDialog.session, registrationDialog.ticketType);
      dispatchRegistrationDialog({ type: 'close' });
    } finally {
      dispatchRegistrationDialog({ type: 'set_registering', value: false });
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
  const fallbackImage = pickEventImage(event.id || event.title);
  const coverImage = event.cover_image_url || fallbackImage;

  return (
    <div className="page-wrap event-detail-page">
      <EventHeader
        event={event}
        primaryStatus={primaryStatus}
        coverImage={coverImage}
        fallbackImage={fallbackImage}
      />
      <EventSessionsCard
        event={event}
        user={user}
        registrationsBySession={registrationsBySession}
        onOpenRegister={openRegisterModal}
        onCancelRegistration={runCancel}
        onConfirmRegistration={runConfirm}
        onForfeitRegistration={runForfeit}
      />
      <RegistrationModal
        dialog={registrationDialog}
        onSubmit={submitRegisterModal}
        onClose={() => dispatchRegistrationDialog({ type: 'close' })}
        onConfirmChange={(value) => dispatchRegistrationDialog({ type: 'set_confirmed', value })}
        onTicketTypeChange={(ticketTypeId) => dispatchRegistrationDialog({ type: 'select_ticket_type', ticketTypeId })}
      />
    </div>
  );
};

export default EventDetail;
