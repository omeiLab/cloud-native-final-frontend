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
import { pickEventImage, resolvePublicAssetUrl } from '../assets/media';
import { REGISTRATION_STATUS_LABELS, SESSION_STATUS_LABELS, labelOr } from '../utils/labels';
import '../styles/EventDetail.css';

const { Title, Paragraph } = Typography;
const REGISTRATION_ALLOWED_ROLES = new Set(['EMPLOYEE']);
/** These statuses do not consume quota and allow re-registration while registration is open. */
const RE_REGISTER_ELIGIBLE_STATUSES = new Set(['CANCELLED', 'FORFEITED']);
const NON_OCCUPYING_REGISTRATION_STATUSES = new Set(['CANCELLED', 'FORFEITED']);

export const registrationErrMsg = (e) =>
  e?.error?.message || (typeof e?.detail === 'string' ? e.detail : '') || '';

export const isAlreadyRegisteredError = (e) =>
  e?.error?.code === 'ALREADY_REGISTERED' ||
  /Already registered for this session|already registered|ALREADY_REGISTERED/i.test(registrationErrMsg(e));

const CETS_ELIGIBILITY_MARKER_PREFIX = '<!--CETS_ELIGIBILITY:';
const CETS_ELIGIBILITY_MARKER_SUFFIX = '-->';

export const getTicketAudienceLabel = (ticketType) => {
  const audience = String(ticketType?.audience || '').toUpperCase();
  const name = String(ticketType?.name || '');
  if (audience === 'DEPENDENT' || /Child|child/i.test(name)) return 'Child';
  if (audience === 'EMPLOYEE' || /Adult|adult/i.test(name)) return 'Adult';
  return 'Ticket type';
};

export const getDefaultTicketType = (ticketTypes = []) => (
  ticketTypes.find((tt) => getTicketAudienceLabel(tt) === 'Adult') ||
  ticketTypes[0] ||
  null
);

/** Strip legacy hidden eligibility marker so old event descriptions stay readable. */
export const stripEligibilityMarkerFromDescription = (rawDescription) => {
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

export const registrationDialogReducer = (state, action) => {
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

export const eventDetailPageReducer = (state, patch) => ({ ...state, ...patch });

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
  const isRegistrationOpen = session.status === 'REGISTRATION_OPEN';
  const ticketTypes = session.ticket_types || [];
  const getTicketLabel = (reg) =>
    reg.ticket_type_name || ticketTypes.find((tt) => tt.id === reg.ticket_type_id)?.name || reg.ticket_type_id;

  if (user && !roleCanRegister) {
    return <Tag color="warning">Verifiers and admins cannot register for events</Tag>;
  }

  const ticketQuotaSummary = ticketTypes.length ? (
    <Space wrap>
      {ticketTypes.map((tt) => (
        <Tag key={tt.id} color={getTicketAudienceLabel(tt) === 'Child' ? 'cyan' : 'geekblue'}>
          {tt.name}：Quota {tt.quota ?? '-'}
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
        Register for this session
      </Button>
    ) : (
      <Tag>No ticket types open for registration in this session</Tag>
    )
  ) : null;

  const activeRegistrationRows = activeRegistrations.length ? (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      {activeRegistrations.map((reg) => (
        <Space key={reg.id} wrap>
          <Tag color="blue">
            Registered ticket type: {getTicketLabel(reg)}
          </Tag>
          <Tag>{labelOr(REGISTRATION_STATUS_LABELS, reg.status, reg.status)}</Tag>
          {reg.status === 'REGISTERED' ? (
            <Button onClick={() => onCancelRegistration(reg.id)}>Cancel registration</Button>
          ) : null}
          {reg.status === 'WON' ? (
            <>
              <Button type="primary" onClick={() => onConfirmRegistration(reg.id)}>Confirm attendance and receive ticket</Button>
              <Button danger onClick={() => onForfeitRegistration(reg.id)}>Forfeit</Button>
            </>
          ) : null}
        </Space>
      ))}
    </Space>
  ) : null;

  if (!isRegistrationOpen && !activeRegistrations.length) {
    return <Tag>Not open for registration</Tag>;
  }

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
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
          <Descriptions.Item label="Status">{primaryStatus.label}</Descriptions.Item>
          <Descriptions.Item label="Allowed sites">{event.allowed_sites?.length ? event.allowed_sites.join(', ') : 'All sites'}</Descriptions.Item>
          <Descriptions.Item label="Created at">{dayjs(event.created_at).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
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
    <Title level={4}>Sessions and ticket types</Title>
    <Collapse
      defaultActiveKey={(event.sessions || []).map((session) => session.id)}
      items={(event.sessions || []).map((session) => ({
        key: session.id,
        label: `${session.title} | ${dayjs(session.starts_at).format('MM/DD HH:mm')} - ${dayjs(session.ends_at).format('HH:mm')} | ${labelOr(SESSION_STATUS_LABELS, session.status, session.status)}`,
        children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Venue">{session.venue}</Descriptions.Item>
              <Descriptions.Item label="Registration period">
                {dayjs(session.registration_opens_at).format('YYYY-MM-DD HH:mm')} - {dayjs(session.registration_closes_at).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              <Descriptions.Item label="Confirmation deadline">{session.confirmation_deadline_hours} hours</Descriptions.Item>
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
    title={dialog.session ? `Register for ${dialog.session.title}` : 'Register for event'}
    open={dialog.open}
    onOk={onSubmit}
    onCancel={onClose}
    confirmLoading={dialog.registering}
    okButtonProps={{ disabled: !dialog.eligibilityConfirmed || !dialog.ticketType }}
    okText="I confirm eligibility and register"
    cancelText="Cancel"
  >
    {dialog.session ? (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Paragraph style={{ marginBottom: 0 }}>
          Session：{dialog.session.title}
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
                    {getTicketAudienceLabel(tt)}｜Quota {tt.quota ?? '-'}
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
          I confirm that I meet this ticket type requirements
        </Checkbox>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="Submissions">1 registration</Descriptions.Item>
          <Descriptions.Item label="Selected ticket type">{dialog.ticketType?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="Ticket type quota">{dialog.ticketType?.quota ?? '-'}</Descriptions.Item>
        </Descriptions>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Each employee submits one registration. Ticket type quota is for reference only.
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
        error: e?.error?.message || 'Failed to load event data'
      });
    }
  };

  useEffect(() => {
    loadPage();
  }, [eventId]);

  // After backend batch lottery updates, employees must refresh to see WON/WAITLISTED/LOST.
  // Poll lightly while lottery status is pending so E2E flows stay smooth.
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
    if (event?.status === 'CANCELLED') return { label: 'Cancelled', color: 'red' };
    if (event?.status !== 'PUBLISHED') return { label: 'Event not published', color: 'default' };
    if (user && !REGISTRATION_ALLOWED_ROLES.has(user.role)) return { label: 'This role cannot register', color: 'warning' };
    if (!hasOpenSession) return { label: 'Closed / not open', color: 'default' };
    return { label: 'Open for registration', color: 'success' };
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
      message.info('Sign in from the top-right menu before registering.');
      return;
    }
    if (!REGISTRATION_ALLOWED_ROLES.has(user.role)) {
      Modal.warning({
        title: 'This role cannot register',
        content: `Verifiers and admins cannot register. Your current role is ${user.role} role.`
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
      message.success('Registration succeeded');
      await loadPage();
    } catch (e) {
      if (prior && isAlreadyRegisteredError(e)) {
        try {
          await tryReactivateRegistration(prior.id, ticketType);
          message.success('Re-registered successfully');
          await loadPage();
        } catch (e2) {
          message.error(
            registrationErrMsg(e2) ||
              'Unable to resume the cancelled registration. Try again later or contact an admin.'
          );
        }
        return;
      }
      if (isAlreadyRegisteredError(e)) {
        message.error('Only one registration per employee per session. Cancel first to change ticket type.');
        return;
      }
      message.error(registrationErrMsg(e) || 'Registration failed');
    }
  };

  const openRegisterModal = (session, ticketTypes) => {
    dispatchRegistrationDialog({ type: 'open', session, ticketTypes });
  };

  const submitRegisterModal = async () => {
    if (!registrationDialog.session || !registrationDialog.ticketType) return;
    if (!registrationDialog.eligibilityConfirmed) {
      message.warning('Confirm that you meet the eligibility requirements first.');
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
      message.success('Confirmed. Ticket issued.');
      await loadPage();
    } catch (e) {
      message.error(e?.error?.message || 'Confirmation failed');
    }
  };

  const runForfeit = async (registrationId) => {
    Modal.confirm({
      title: 'Confirm forfeit',
      content: 'Forfeiting releases quota to waitlisted users. Continue?',
      onOk: async () => {
        try {
          await apiClient.forfeitRegistration(registrationId);
          message.success('Forfeited');
          await loadPage();
        } catch (e) {
          message.error(e?.error?.message || 'Forfeit failed');
        }
      }
    });
  };

  const runCancel = async (registrationId) => {
    try {
      await apiClient.cancelRegistration(registrationId);
      message.success('Registration cancelled');
      await loadPage();
    } catch (e) {
      message.error(e?.error?.message || 'Cancellation failed');
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
        <Empty description="Event not found" />
      </div>
    );
  }

  const primaryStatus = getEventPrimaryStatus();
  const fallbackImage = pickEventImage(event.id || event.title);
  const coverImage = resolvePublicAssetUrl(event.cover_image_url) || fallbackImage;

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
