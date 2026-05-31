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
import { REGISTRATION_STATUS_LABELS, SESSION_STATUS_LABELS, labelOr, useI18n } from '../utils/labels';
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

export const getTicketAudienceLabel = (ticketType, copy) => {
  const audience = String(ticketType?.audience || '').toUpperCase();
  const name = String(ticketType?.name || '');
  const adult = copy?.adult || 'Adult';
  const child = copy?.child || 'Child';
  const ticketTypeLabel = copy?.ticketType || 'Ticket type';
  if (audience === 'DEPENDENT' || /Child|child|兒童/i.test(name)) return child;
  if (audience === 'EMPLOYEE' || /Adult|adult|成人/i.test(name)) return adult;
  return ticketTypeLabel;
};

export const getDefaultTicketType = (ticketTypes = [], copy) => (
  ticketTypes.find((tt) => getTicketAudienceLabel(tt, copy) === (copy?.adult || 'Adult')) ||
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
      const copy = action.copy;
      return {
        ...registrationDialogInitialState,
        open: true,
        session: action.session,
        ticketType: action.ticketType || getDefaultTicketType(ticketTypes, copy),
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
  onForfeitRegistration,
  copy,
  registrationLabels,
  labelOrFn
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
    return <Tag color="warning">{copy.roleCannotRegister}</Tag>;
  }

  const ticketQuotaSummary = ticketTypes.length ? (
    <Space wrap>
      {ticketTypes.map((tt) => (
        <Tag key={tt.id} color={getTicketAudienceLabel(tt, copy) === copy.child ? 'cyan' : 'geekblue'}>
          {tt.name}：{copy.quota} {tt.quota ?? '-'}
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
        {copy.registerSession}
      </Button>
    ) : (
      <Tag>{copy.noTicketTypes}</Tag>
    )
  ) : null;

  const activeRegistrationRows = activeRegistrations.length ? (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      {activeRegistrations.map((reg) => (
        <Space key={reg.id} wrap>
          <Tag color="blue">
            {copy.registeredTicket}: {getTicketLabel(reg)}
          </Tag>
          <Tag>{labelOrFn(registrationLabels, reg.status, reg.status)}</Tag>
          {reg.status === 'REGISTERED' ? (
            <Button onClick={() => onCancelRegistration(reg.id)}>{copy.cancelRegistration}</Button>
          ) : null}
          {reg.status === 'WON' ? (
            <>
              <Button type="primary" onClick={() => onConfirmRegistration(reg.id)}>{copy.confirmAttendance}</Button>
              <Button danger onClick={() => onForfeitRegistration(reg.id)}>{copy.forfeit}</Button>
            </>
          ) : null}
        </Space>
      ))}
    </Space>
  ) : null;

  if (!isRegistrationOpen && !activeRegistrations.length) {
    return <Tag>{copy.notOpen}</Tag>;
  }

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      {ticketQuotaSummary}
      {activeRegistrationRows}
      {signupButton}
    </Space>
  );
};

const EventHeader = ({ event, primaryStatus, coverImage, fallbackImage, copy, common }) => (
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
          <Descriptions.Item label={copy.status}>{primaryStatus.label}</Descriptions.Item>
          <Descriptions.Item label={copy.allowedSites}>{event.allowed_sites?.length ? event.allowed_sites.join(', ') : common.allSites}</Descriptions.Item>
          <Descriptions.Item label={copy.createdAt}>{dayjs(event.created_at).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
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
  onForfeitRegistration,
  copy,
  common,
  sessionLabels,
  registrationLabels,
  labelOrFn
}) => (
  <Card style={{ marginTop: 16 }}>
    <Title level={4}>{copy.sessionsTitle}</Title>
    <Collapse
      defaultActiveKey={(event.sessions || []).map((session) => session.id)}
      items={(event.sessions || []).map((session) => ({
        key: session.id,
        label: `${session.title} | ${dayjs(session.starts_at).format('MM/DD HH:mm')} - ${dayjs(session.ends_at).format('HH:mm')} | ${labelOrFn(sessionLabels, session.status, session.status)}`,
        children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label={copy.venue}>{session.venue}</Descriptions.Item>
              <Descriptions.Item label={copy.registrationPeriod}>
                {dayjs(session.registration_opens_at).format('YYYY-MM-DD HH:mm')} - {dayjs(session.registration_closes_at).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              <Descriptions.Item label={copy.confirmationDeadline}>{session.confirmation_deadline_hours} {copy.hours}</Descriptions.Item>
            </Descriptions>
            <EventSessionActions
              session={session}
              user={user}
              registrationsBySession={registrationsBySession}
              onOpenRegister={onOpenRegister}
              onCancelRegistration={onCancelRegistration}
              onConfirmRegistration={onConfirmRegistration}
              onForfeitRegistration={onForfeitRegistration}
              copy={copy}
              registrationLabels={registrationLabels}
              labelOrFn={labelOrFn}
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
  onTicketTypeChange,
  copy,
  common
}) => (
  <Modal
    title={dialog.session ? `${copy.registerFor} ${dialog.session.title}` : copy.registerForEvent}
    open={dialog.open}
    onOk={onSubmit}
    onCancel={onClose}
    confirmLoading={dialog.registering}
    okButtonProps={{ disabled: !dialog.eligibilityConfirmed || !dialog.ticketType }}
    okText={copy.confirmEligibility}
    cancelText={common.cancel}
  >
    {dialog.session ? (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Paragraph style={{ marginBottom: 0 }}>
          {copy.sessionLabel}：{dialog.session.title}
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
                    {getTicketAudienceLabel(tt, copy)}｜{copy.quota} {tt.quota ?? '-'}
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
          {copy.confirmRequirements}
        </Checkbox>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label={copy.submissions}>{copy.oneRegistration}</Descriptions.Item>
          <Descriptions.Item label={copy.selectedTicketType}>{dialog.ticketType?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label={copy.ticketTypeQuota}>{dialog.ticketType?.quota ?? '-'}</Descriptions.Item>
        </Descriptions>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {copy.quotaNote}
        </Paragraph>
      </Space>
    ) : null}
  </Modal>
);

const EventDetail = () => {
  const { eventId } = useParams();
  const { user } = useAuth();
  const {
    m,
    EVENT_CARD_STATUS,
    SESSION_STATUS_LABELS: sessionLabels,
    REGISTRATION_STATUS_LABELS: registrationLabels,
    labelOr: labelOrFn
  } = useI18n();
  const copy = m.eventDetail;
  const common = m.common;
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
        error: e?.error?.message || copy.loadFailed
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
    if (event?.status === 'CANCELLED') return { label: EVENT_CARD_STATUS.cancelled, color: 'red' };
    if (event?.status !== 'PUBLISHED') return { label: EVENT_CARD_STATUS.notPublished, color: 'default' };
    if (user && !REGISTRATION_ALLOWED_ROLES.has(user.role)) return { label: EVENT_CARD_STATUS.roleCannotRegister, color: 'warning' };
    if (!hasOpenSession) return { label: EVENT_CARD_STATUS.closed, color: 'default' };
    return { label: EVENT_CARD_STATUS.open, color: 'success' };
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
      message.success(copy.registrationSuccess);
      await loadPage();
    } catch (e) {
      if (prior && isAlreadyRegisteredError(e)) {
        try {
          await tryReactivateRegistration(prior.id, ticketType);
          message.success(copy.registrationSuccess);
          await loadPage();
        } catch (e2) {
          message.error(registrationErrMsg(e2) || copy.registrationFailed);
        }
        return;
      }
      if (isAlreadyRegisteredError(e)) {
        message.error(copy.alreadyRegistered);
        return;
      }
      message.error(registrationErrMsg(e) || copy.registrationFailed);
    }
  };

  const openRegisterModal = (session, ticketTypes) => {
    dispatchRegistrationDialog({ type: 'open', session, ticketTypes, copy });
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
      message.success(copy.confirmSuccess);
      await loadPage();
    } catch (e) {
      message.error(e?.error?.message || copy.registrationFailed);
    }
  };

  const runForfeit = async (registrationId) => {
    Modal.confirm({
      title: copy.confirmForfeitTitle,
      content: copy.confirmForfeitContent,
      okText: copy.forfeit,
      cancelText: common.cancel,
      onOk: async () => {
        try {
          await apiClient.forfeitRegistration(registrationId);
          message.success(copy.forfeitSuccess);
          await loadPage();
        } catch (e) {
          message.error(e?.error?.message || copy.registrationFailed);
        }
      }
    });
  };

  const runCancel = async (registrationId) => {
    try {
      await apiClient.cancelRegistration(registrationId);
      message.success(copy.cancelSuccess);
      await loadPage();
    } catch (e) {
      message.error(e?.error?.message || copy.registrationFailed);
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
        <Empty description={copy.eventNotFound} />
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
        copy={copy}
        common={common}
      />
      <EventSessionsCard
        event={event}
        user={user}
        registrationsBySession={registrationsBySession}
        onOpenRegister={openRegisterModal}
        onCancelRegistration={runCancel}
        onConfirmRegistration={runConfirm}
        onForfeitRegistration={runForfeit}
        copy={copy}
        common={common}
        sessionLabels={sessionLabels}
        registrationLabels={registrationLabels}
        labelOrFn={labelOrFn}
      />
      <RegistrationModal
        dialog={registrationDialog}
        onSubmit={submitRegisterModal}
        onClose={() => dispatchRegistrationDialog({ type: 'close' })}
        onConfirmChange={(value) => dispatchRegistrationDialog({ type: 'set_confirmed', value })}
        onTicketTypeChange={(ticketTypeId) => dispatchRegistrationDialog({ type: 'select_ticket_type', ticketTypeId })}
        copy={copy}
        common={common}
      />
    </div>
  );
};

export default EventDetail;
