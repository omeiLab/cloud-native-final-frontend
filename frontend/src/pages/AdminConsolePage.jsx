import React, { Suspense, lazy, useCallback, useEffect, useMemo, useReducer } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from 'antd';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import dayjs from 'dayjs';
import { useNotifications } from '../context/NotificationContext';
import { EVENT_STATUS_LABELS, REGISTRATION_STATUS_LABELS, labelOr, useI18n } from '../utils/labels';
import { EVENT_IMAGES, resolvePublicAssetUrl, publicRootPath } from '../assets/media';
import '../styles/AdminConsole.css';

const { Title, Paragraph, Text } = Typography;

const EMPTY_ARRAY = [];
const loadRecharts = () => import('recharts');
const DashboardCharts = lazy(() => loadRecharts().then(({
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
}) => ({
  default: function DashboardCharts({
    registrationTimeline,
    siteDistribution,
    ticketTypeProgress
  }) {
    const { m } = useI18n();
    const t = m.admin;

    const siteChartData = siteDistribution.map((siteItem) => ({
      name: SITE_LABELS[siteItem.site] || siteItem.site,
      value: siteItem.count,
      site: siteItem.site
    }));

    return (
      <>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={24} lg={12}>
            <Card title={t.registrationTrend}>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={registrationTimeline}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name={t.totalRegistrations}
                    stroke="#2b72d9"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title={t.sitesDistribution}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={siteChartData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    label
                    isAnimationActive={false}
                  >
                    {siteChartData.map((entry, idx) => (
                      <Cell key={entry.site} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </Col>
        </Row>

        <Card style={{ marginTop: 16 }} title={t.ticketProgress}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ticketTypeProgress}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="quota" name={t.quota} fill="#2b72d9" isAnimationActive={false} />
              <Bar dataKey="registered" name={t.registered} fill="#f4a261" isAnimationActive={false} />
              <Bar dataKey="confirmed" name={t.confirmed} fill="#2a9d8f" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <Table
            pagination={false}
            rowKey="ticket_type_id"
            dataSource={ticketTypeProgress}
            scroll={{ x: 640 }}
            columns={[
              { title: t.ticketType, dataIndex: 'name' },
              { title: t.quota, dataIndex: 'quota' },
              { title: t.registered, dataIndex: 'registered' },
              { title: t.won || 'Won', dataIndex: 'won' },
              { title: t.confirmed, dataIndex: 'confirmed' }
            ]}
          />
        </Card>
      </>
    );
  }
})));

const SITES = ['HSINCHU', 'TAINAN', 'TAICHUNG', 'TAIPEI', 'OVERSEAS'];
const SITE_LABELS = {
  HSINCHU: 'Hsinchu HSINCHU',
  TAINAN: 'Tainan TAINAN',
  TAICHUNG: 'Taichung TAICHUNG',
  TAIPEI: 'Taipei TAIPEI',
  OVERSEAS: 'Overseas OVERSEAS'
};

const DISEASE_OPTIONS = [
  'Heart disease / cardiovascular condition',
  'Hypertension',
  'Diabetes',
  'Asthma / chronic respiratory disease',
  'Epilepsy',
  'Hepatitis / abnormal liver function',
  'Infectious disease (fever, flu, etc.)',
  'Recent major surgery or condition requiring physician clearance'
];

const defaultSession = {
  confirmation_deadline_hours: 48,
  ticket_types: [
    { name: 'Adult ticket', quota: 200, sort_order: 0, audience: 'EMPLOYEE' },
    { name: 'Child ticket', quota: 100, sort_order: 1, audience: 'DEPENDENT' }
  ]
};
const PIE_COLORS = ['#2b72d9', '#2a9d8f', '#f4a261', '#9b5de5', '#f28482'];

/** Normalize dashboard sessions_lottery rows (backend may alias id fields). */
export const normalizeSessionsLotteryRows = (raw) => {
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.flatMap((row) => {
    const normalized = {
      session_id: row.session_id || row.id,
      title: row.title,
      lottery_at: row.lottery_at,
      lottery_executed_at: row.lottery_executed_at ?? null,
      registered_pending:
        row.registered_pending ?? row.pending_registered_count ?? row.pending_count ?? undefined
    };
    return normalized.session_id ? [normalized] : [];
  });
};

/** Merge sessions_lottery from GET /events/{id} when dashboard payload is sparse. */
export const mergeDashboardSessionsLottery = (dash, eventDetail) => {
  const fromDash = normalizeSessionsLotteryRows(dash?.sessions_lottery);
  if (fromDash.length) return fromDash;
  const fromDashSessions = normalizeSessionsLotteryRows(dash?.sessions);
  if (fromDashSessions.length) return fromDashSessions;
  const sessions = eventDetail?.sessions || [];
  return sessions.map((s) => ({
    session_id: s.id,
    title: s.title,
    lottery_at: s.lottery_at,
    lottery_executed_at: s.lottery_executed_at ?? null,
    registered_pending: undefined
  }));
};
export const createDefaultCreateValues = () => {
  const current = dayjs().second(0).millisecond(0);
  const sessionStartsAt = current.add(14, 'day');

  return {
    title: '2026 Spring Family Day',
    cover_image_url: EVENT_IMAGES[0],
    registration_mode: 'LIMITED',
    adult_has_limits: false,
    adult_gender: 'ANY',
    adult_height_min_cm: null,
    adult_height_max_cm: null,
    adult_age_min: null,
    adult_age_max: null,
    adult_health_unlimited: true,
    adult_health_no_diseases: [],
    child_has_limits: false,
    child_age_min: null,
    child_age_max: null,
    child_health_unlimited: true,
    child_health_no_diseases: [],
    adult_other_restrictions: '',
    child_other_restrictions: '',
    session_count: 1,
    sessions: [
      {
        title: 'Session 1',
        venue: 'Hsinchu campus outdoor plaza',
        starts_at: sessionStartsAt,
        ends_at: sessionStartsAt.add(3, 'hour'),
        adult_quota: 120,
        require_child_ticket: true,
        child_quota: 80
      }
    ],
    registration_closes_at: current.add(7, 'day'),
    registration_opens_at: current,
    lottery_at: current.add(7, 'day').add(3, 'hour'),
    waitlist_close_at: current.add(10, 'day'),
    allowed_sites: ['HSINCHU']
  };
};

const adminInitialState = {
  events: [],
  selectedEventId: '',
  dashboard: null,
  registrations: [],
  loading: false,
  creating: false,
  publishing: false,
  cancelling: false,
  exportingSync: false,
  deletingDraftId: '',
  publishingDraftId: '',
  editLoading: false,
  activeTabKey: 'event-create',
  editingEventId: '',
  autoLotteryRunning: false
};

export const adminStateReducer = (state, action) => {
  switch (action.type) {
    case 'set': {
      const nextValue = typeof action.value === 'function'
        ? action.value(state[action.key])
        : action.value;
      return { ...state, [action.key]: nextValue };
    }
    default:
      return state;
  }
};

export const normalizeCoverImageUrlForBackend = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed ? publicRootPath(trimmed) : null;
};

const CETS_ELIGIBILITY_MARKER_PREFIX = '<!--CETS_ELIGIBILITY:';
const CETS_ELIGIBILITY_MARKER_SUFFIX = '-->';

export const stripEligibilityMarkerForBackend = (rawDescription) => {
  const description = String(rawDescription || '');
  const startIdx = description.indexOf(CETS_ELIGIBILITY_MARKER_PREFIX);
  if (startIdx < 0) {
    return description;
  }
  const endIdx = description.indexOf(CETS_ELIGIBILITY_MARKER_SUFFIX, startIdx);
  if (endIdx < 0) {
    return description;
  }
  return `${description.slice(0, startIdx)}${description.slice(endIdx + CETS_ELIGIBILITY_MARKER_SUFFIX.length)}`
    .trim();
};

export const resolveSessionTicketFields = (session) => {
  const ticketTypes = Array.isArray(session?.ticket_types) ? session.ticket_types : [];
  const adultTicket =
    ticketTypes.find((t) => String(t?.name || '').includes('Adult')) ||
    ticketTypes.find((t) => t?.audience === 'EMPLOYEE') ||
    ticketTypes[0] ||
    {};
  const childTicket =
    ticketTypes.find((t) => String(t?.name || '').includes('Child')) ||
    ticketTypes.find((t) => t?.audience === 'DEPENDENT') ||
    null;
  return { adultTicket, childTicket };
};

export const getErrorMessage = (error, fallback) => {
  if (error?.error?.message) return error.error.message;
  if (typeof error?.detail === 'string') return error.detail;
  if (Array.isArray(error?.detail)) {
    const joined = error.detail
      .flatMap((d) => {
        const msg = typeof d?.msg === 'string' ? d.msg : JSON.stringify(d);
        return msg ? [msg] : [];
      })
      .join('；');
    if (joined) return joined;
  }
  if (error?.message) return error.message;
  if (error?.httpStatus === 404) return 'Backend API not found (HTTP 404). The endpoint may not be deployed yet.';
  return fallback;
};

export const getEventId = (eventLike) =>
  eventLike?.data?.id || eventLike?.data?.event_id || eventLike?.id || eventLike?.event_id || '';

export const getSessionId = (sessionLike) =>
  sessionLike?.data?.id || sessionLike?.data?.session_id || sessionLike?.id || sessionLike?.session_id || '';

export const resolveLimitedLotteryAt = (registrationClosesAt) => {
  const closesAt = dayjs(registrationClosesAt);
  if (!closesAt.isValid()) return closesAt;
  return closesAt.add(1, 'minute');
};

export const resolveLimitedWaitlistCloseAt = (values, startsAt) => {
  const manual = values?.waitlist_close_at ? dayjs(values.waitlist_close_at) : null;
  if (manual?.isValid()) {
    return manual;
  }
  return dayjs(startsAt).subtract(1, 'minute');
};

export const validateSessionTimeline = (values) => {
  const registrationMode = values.registration_mode || 'LIMITED';
  const sessions = Array.isArray(values.sessions) ? values.sessions : [];
  const startsAtValue = sessions.reduce((min, session) => {
    const cur = session?.starts_at;
    if (!cur) return min;
    if (!min) return cur;
    const a = dayjs(min);
    const b = dayjs(cur);
    if (!a.isValid()) return cur;
    if (!b.isValid()) return min;
    return b.isBefore(a) ? cur : min;
  }, null);
  const startsAt = startsAtValue ? dayjs(startsAtValue) : null;
  const registrationOpensAt = values.registration_opens_at ? dayjs(values.registration_opens_at) : null;
  const registrationClosesAt = values.registration_closes_at ? dayjs(values.registration_closes_at) : null;
  const lotteryAt = resolveLimitedLotteryAt(registrationClosesAt);
  const waitlistCloseAt = resolveLimitedWaitlistCloseAt(values, startsAt);

  if (!startsAt || !registrationOpensAt || !registrationClosesAt) {
    return;
  }
  if (!registrationOpensAt.isBefore(registrationClosesAt)) {
    throw new Error('Registration open time must be before registration close time');
  }
  if (!registrationClosesAt.isBefore(startsAt)) {
    throw new Error('Registration close time must be before event start time');
  }
  if (registrationMode === 'LIMITED') {
    if (!registrationClosesAt.isBefore(lotteryAt)) {
      throw new Error('Lottery time must be after registration close time');
    }
    if (!lotteryAt.isBefore(waitlistCloseAt)) {
      throw new Error('Waitlist close time must be after lottery time');
    }
    if (!waitlistCloseAt.isBefore(startsAt)) {
      throw new Error('Waitlist close time must be before event start time');
    }
  }
};

export const buildCreatePayload = (values) => {
  const fallbackNow = dayjs().second(0).millisecond(0);
  const registrationMode = values.registration_mode || 'LIMITED';
  const registrationClosesAt = values.registration_closes_at || fallbackNow.add(7, 'day');
  const isUnlimited = registrationMode === 'UNLIMITED';
  const lotteryAt = isUnlimited ? dayjs(registrationClosesAt).add(1, 'minute') : resolveLimitedLotteryAt(registrationClosesAt);
  const sessionsInput = Array.isArray(values.sessions) ? values.sessions : [];
  const startsAtForWaitlist = sessionsInput?.[0]?.starts_at || fallbackNow.add(14, 'day');
  const waitlistCloseAt = isUnlimited
    ? dayjs(startsAtForWaitlist).subtract(1, 'minute')
    : resolveLimitedWaitlistCloseAt(values, startsAtForWaitlist);
  const sessions = (sessionsInput || []).map((s) => {
    const starts = dayjs(s?.starts_at || fallbackNow.add(14, 'day'));
    const ends = dayjs(s?.ends_at || starts.add(3, 'hour'));
    const closes = dayjs(registrationClosesAt);
    const opens = dayjs(values.registration_opens_at || fallbackNow);
    const lottery = dayjs(lotteryAt);
    const waitlist = dayjs(waitlistCloseAt);
    const adultQuota = Math.max(0, Number(s?.adult_quota || 0));
    const requireChildTicket = Boolean(s?.require_child_ticket);
    const childQuota = requireChildTicket ? Math.max(0, Number(s?.child_quota || 0)) : 0;
    const totalQuota = isUnlimited ? 999999 : adultQuota + childQuota;
    const ticketTypes = isUnlimited
      ? [{ name: 'General ticket (unlimited)', quota: totalQuota, sort_order: 0, audience: 'EMPLOYEE' }]
      : requireChildTicket
        ? [
          { name: 'Adult ticket', quota: adultQuota, sort_order: 0, audience: 'EMPLOYEE' },
          { name: 'Child ticket', quota: childQuota, sort_order: 1, audience: 'DEPENDENT' }
        ]
        : [{ name: 'Adult ticket', quota: adultQuota, sort_order: 0, audience: 'EMPLOYEE' }];
    return {
      ...defaultSession,
      title: s?.title,
      venue: s?.venue,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      registration_opens_at: opens.toISOString(),
      registration_closes_at: closes.toISOString(),
      lottery_at: lottery.toISOString(),
      waitlist_close_at: waitlist.toISOString(),
      ticket_types: ticketTypes
    };
  });

  return {
    title: values.title,
    description: stripEligibilityMarkerForBackend(values.description || ''),
    cover_image_url: normalizeCoverImageUrlForBackend(values.cover_image_url),
    allowed_sites: values.allowed_sites || [],
    sessions
  };
};

const useAdminConsoleController = () => {
  const { user } = useAuth();
  const { refreshList } = useNotifications();
  const isAdminFull = user?.role === 'ADMIN';
  const isAdminViewer = user?.role === 'ADMIN_VIEWER';
  const [adminState, dispatchAdminState] = useReducer(adminStateReducer, adminInitialState);
  const setAdminState = useCallback((key, value) => {
    dispatchAdminState({ type: 'set', key, value });
  }, []);
  const {
    events,
    selectedEventId,
    dashboard,
    registrations,
    loading,
    creating,
    publishing,
    cancelling,
    exportingSync,
    deletingDraftId,
    publishingDraftId,
    editLoading,
    activeTabKey,
    editingEventId,
    autoLotteryRunning
  } = adminState;
  const setEvents = useCallback((value) => setAdminState('events', value), [setAdminState]);
  const setSelectedEventId = useCallback((value) => setAdminState('selectedEventId', value), [setAdminState]);
  const setDashboard = useCallback((value) => setAdminState('dashboard', value), [setAdminState]);
  const setRegistrations = useCallback((value) => setAdminState('registrations', value), [setAdminState]);
  const setLoading = useCallback((value) => setAdminState('loading', value), [setAdminState]);
  const setCreating = useCallback((value) => setAdminState('creating', value), [setAdminState]);
  const setPublishing = useCallback((value) => setAdminState('publishing', value), [setAdminState]);
  const setCancelling = useCallback((value) => setAdminState('cancelling', value), [setAdminState]);
  const setExportingSync = useCallback((value) => setAdminState('exportingSync', value), [setAdminState]);
  const setDeletingDraftId = useCallback((value) => setAdminState('deletingDraftId', value), [setAdminState]);
  const setPublishingDraftId = useCallback((value) => setAdminState('publishingDraftId', value), [setAdminState]);
  const setEditLoading = useCallback((value) => setAdminState('editLoading', value), [setAdminState]);
  const setActiveTabKey = useCallback((value) => setAdminState('activeTabKey', value), [setAdminState]);
  const setEditingEventId = useCallback((value) => setAdminState('editingEventId', value), [setAdminState]);
  const setAutoLotteryRunning = useCallback((value) => setAdminState('autoLotteryRunning', value), [setAdminState]);
  const [createForm] = Form.useForm();
  const initialCreateValues = useMemo(() => createDefaultCreateValues(), []);
  const resetCreateFormToDefaults = useCallback(() => {
    createForm.resetFields();
    createForm.setFieldsValue(createDefaultCreateValues());
  }, [createForm]);
  const createRegistrationMode = Form.useWatch('registration_mode', createForm) || 'LIMITED';
  const selectedCoverImage = Form.useWatch('cover_image_url', createForm) || '';
  const watchedSessions = Form.useWatch('sessions', createForm) || EMPTY_ARRAY;
  const latestSessionEndLabel = useMemo(() => {
    const max = (watchedSessions || []).reduce((m, session) => {
      const cur = session?.ends_at;
      if (!cur) return m;
      if (!m) return cur;
      const a = dayjs(m);
      const b = dayjs(cur);
      if (!a.isValid()) return cur;
      if (!b.isValid()) return m;
      return b.isAfter(a) ? cur : m;
    }, null);
    return max ? dayjs(max).format('YYYY-MM-DD HH:mm') : 'Not set';
  }, [watchedSessions]);
  const anyRequireChildTicket = useMemo(
    () => (watchedSessions || []).some((s) => Boolean(s?.require_child_ticket)),
    [watchedSessions]
  );
  const adultHasLimits = Form.useWatch('adult_has_limits', createForm);
  const childHasLimits = Form.useWatch('child_has_limits', createForm);
  const adultHealthUnlimited = Form.useWatch('adult_health_unlimited', createForm);
  const childHealthUnlimited = Form.useWatch('child_health_unlimited', createForm);
  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId), [events, selectedEventId]);
  const dashboardEventOptions = useMemo(() => {
    return events.map((event) => {
      const statusLabel = labelOr(EVENT_STATUS_LABELS, event.status, event.status);
      const sitesLabel = event.allowed_sites?.length ? event.allowed_sites.join(', ') : 'All sites';
      return {
        label: `${event.title}（${statusLabel}）`,
        value: event.id,
        searchText: `${event.title || ''} ${event.status || ''} ${statusLabel} ${sitesLabel}`
      };
    });
  }, [events]);
  const draftEvents = useMemo(() => events.filter((e) => e.status === 'DRAFT'), [events]);
  const isEditing = Boolean(editingEventId);

  const loadEvents = useCallback(async () => {
    const res = isAdminFull
      ? await apiClient.adminGetEvents({ page: 1, page_size: 50 })
      : await apiClient.getEvents({ scope: 'all', page: 1, page_size: 50 });
    const fetchedItems = res.data.items || [];
    const merged = [...fetchedItems];
    setEvents(merged);
    setSelectedEventId((current) => {
      if (current && merged.some((event) => event.id === current)) {
        return current;
      }
      return merged[0]?.id || '';
    });
    return merged;
  }, [isAdminFull, setEvents, setSelectedEventId]);

  const loadDashboard = useCallback(async (eventId) => {
    if (!eventId) {
      setDashboard(null);
      setRegistrations([]);
      return;
    }
    const [dashboardRes, regRes, eventRes] = await Promise.all([
      apiClient.adminGetDashboard(eventId).catch(() => ({ data: {} })),
      apiClient
        .adminGetRegistrations(eventId, { page: 1, page_size: 20, mask_pii: true })
        .catch(() => ({ data: { items: [] } })),
      (isAdminFull ? apiClient.adminGetEvent(eventId) : apiClient.getEvent(eventId))
        .catch(() => ({ data: null }))
    ]);
    const dash = dashboardRes.data || {};
    const eventData = eventRes?.data ?? null;
    const sessionsLottery = mergeDashboardSessionsLottery(dash, eventData);
    setDashboard({ ...dash, sessions_lottery: sessionsLottery });
    setRegistrations(regRes.data?.items || []);
  }, [isAdminFull, setDashboard, setRegistrations]);

  useEffect(() => {
    setLoading(true);
    loadEvents().finally(() => setLoading(false));
  }, [loadEvents, setLoading]);

  useEffect(() => {
    loadDashboard(selectedEventId).catch(() => {});
  }, [loadDashboard, selectedEventId]);

  const createEvent = async (publishAfterCreate) => {
    if (!isAdminFull) {
      message.warning('You are a read-only admin (ADMIN_VIEWER) and cannot create or publish events');
      return;
    }
    setCreating(true);
    try {
      const values = await createForm.validateFields();
      validateSessionTimeline(values);
      const payload = buildCreatePayload(values);
      const { sessions = [], ...eventPayload } = payload;
      const created = await apiClient.adminCreateEvent(eventPayload);
      const createdEventId = getEventId(created);
      const createdEvent = created?.data && typeof created.data === 'object' ? created.data : null;
      if (!createdEventId) {
        throw new Error('Backend did not return a new event ID. Refresh the dashboard to confirm creation.');
      }
      // Support two backend modes:
      // 1) sessions/ticket_types created with the event
      // 2) event-only draft requires follow-up session/ticket-type APIs
      if ((createdEvent?.sessions?.length || 0) === 0) {
        await Promise.all(sessions.map(async (sessionPayload) => {
          const { ticket_types: ticketTypes, ...sessionBody } = sessionPayload;
          const createdSession = await apiClient.adminCreateSession(createdEventId, sessionBody);
          const createdSessionId = getSessionId(createdSession);
          if (!createdSessionId) {
            throw new Error('Session was created but session_id is missing. Refresh and verify.');
          }
          await Promise.all((ticketTypes || []).map((tt) => apiClient.adminCreateTicketType(createdSessionId, tt)));
        }));
      }
      if (publishAfterCreate) {
        try {
          await apiClient.adminPublishEvent(createdEventId);
          message.success('Event created and published');
        } catch (publishError) {
          const code = publishError?.error?.code;
          if (code === 'INVALID_STATE_TRANSITION') {
            message.warning('Event saved as draft. Backend requires at least one session before publish. Add sessions first.');
          } else {
            throw publishError;
          }
        }
      } else {
        message.success('Draft event created');
      }
      resetCreateFormToDefaults();
      await loadEvents();
      setSelectedEventId(createdEventId);
      await loadDashboard(createdEventId);
    } catch (error) {
      message.error(getErrorMessage(error, 'Failed to create event. Check fields and permissions.'));
    } finally {
      setCreating(false);
    }
  };

  const handleCreate = async () => createEvent(true);
  const handleCreateDraft = async () => createEvent(false);
  const handleSelectCoverImage = (src) => {
    createForm.setFieldsValue({ cover_image_url: src });
  };

  const resetEditMode = () => {
    setEditingEventId('');
    resetCreateFormToDefaults();
  };

  const buildEditInitialValues = (detail) => {
    const defaults = createDefaultCreateValues();
    const sessions = Array.isArray(detail?.sessions) ? detail.sessions : [];
    const firstSession = sessions[0] || {};
    const { adultTicket, childTicket } = resolveSessionTicketFields(firstSession);
    const cleanDescription = stripEligibilityMarkerForBackend(detail?.description || '');
    const isUnlimitedMode = String(detail?.registration_mode || '').toUpperCase() === 'UNLIMITED'
      || String(adultTicket?.name || '').includes('unlimited');

    return {
      ...defaults,
      title: detail?.title || '',
      description: cleanDescription || '',
      cover_image_url: EVENT_IMAGES.includes(resolvePublicAssetUrl(detail?.cover_image_url))
        ? resolvePublicAssetUrl(detail?.cover_image_url)
        : EVENT_IMAGES[0],
      registration_mode: isUnlimitedMode ? 'UNLIMITED' : 'LIMITED',
      adult_quota: Number(adultTicket?.quota || 0),
      require_child_ticket: Boolean(childTicket),
      child_quota: Number(childTicket?.quota || 0),
      session_count: Math.max(1, sessions.length || detail?.session_count || 1),
      sessions: sessions.length
        ? sessions.map((s) => {
          const { adultTicket: sessionAdultTicket, childTicket: sessionChildTicket } = resolveSessionTicketFields(s);
          return {
            title: s?.title || '',
            venue: s?.venue || '',
            starts_at: s?.starts_at ? dayjs(s.starts_at) : null,
            ends_at: s?.ends_at ? dayjs(s.ends_at) : null,
            adult_quota: Number(sessionAdultTicket?.quota || 0),
            require_child_ticket: Boolean(sessionChildTicket),
            child_quota: Number(sessionChildTicket?.quota || 0)
          };
        })
        : defaults.sessions,
      registration_closes_at: firstSession?.registration_closes_at ? dayjs(firstSession.registration_closes_at) : defaults.registration_closes_at,
      registration_opens_at: firstSession?.registration_opens_at ? dayjs(firstSession.registration_opens_at) : defaults.registration_opens_at,
      waitlist_close_at: firstSession?.waitlist_close_at ? dayjs(firstSession.waitlist_close_at) : defaults.waitlist_close_at,
      lottery_at: firstSession?.lottery_at ? dayjs(firstSession.lottery_at) : defaults.lottery_at,
      allowed_sites: detail?.allowed_sites || []
    };
  };

  const enterEditMode = async (eventId) => {
    if (!eventId) return;
    if (!isAdminFull) {
      message.warning('You are a read-only admin (ADMIN_VIEWER) and cannot edit events');
      return;
    }
    setEditLoading(true);
    try {
      const res = await apiClient.adminGetEvent(eventId);
      const detail = res.data || {};
      createForm.setFieldsValue(buildEditInitialValues(detail));
      setEditingEventId(eventId);
      setSelectedEventId(eventId);
      setActiveTabKey('event-create');
      message.success('Event loaded. All fields are editable.');
    } catch (error) {
      message.error(getErrorMessage(error, 'Failed to load event data'));
    } finally {
      setEditLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedEventId) return;
    if (!isAdminFull) {
      message.warning('You are a read-only admin (ADMIN_VIEWER) and cannot publish events');
      return;
    }
    setPublishing(true);
    try {
      await apiClient.adminPublishEvent(selectedEventId);
      message.success('Event published');
      await loadEvents();
      await loadDashboard(selectedEventId);
    } catch (error) {
      message.error(getErrorMessage(error, 'Failed to publish event'));
    } finally {
      setPublishing(false);
    }
  };

  const updateEvent = async (publishAfterSave) => {
    if (!editingEventId) return;
    if (!isAdminFull) {
      message.warning('You are a read-only admin (ADMIN_VIEWER) and cannot edit or publish events');
      return;
    }
    setCreating(true);
    try {
      const values = await createForm.validateFields();
      validateSessionTimeline(values);
      const status = selectedEvent?.status;
      const payload = status === 'PUBLISHED'
        ? {
          title: values.title,
          description: stripEligibilityMarkerForBackend(values.description || ''),
          cover_image_url: normalizeCoverImageUrlForBackend(values.cover_image_url)
        }
        : (() => {
          const eventPayload = buildCreatePayload(values);
          delete eventPayload.sessions;
          return eventPayload;
        })();
      await apiClient.adminPatchEvent(editingEventId, payload);
      if (publishAfterSave) {
        await apiClient.adminPublishEvent(editingEventId);
        message.success('Event updated and published');
      } else {
        message.success('Event updated');
      }
      await loadEvents();
      await loadDashboard(editingEventId);
      setSelectedEventId(editingEventId);
      resetEditMode();
      setActiveTabKey('dashboard');
    } catch (error) {
      message.error(getErrorMessage(error, 'Failed to update event. Confirm backend supports full field updates.'));
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedEventId) return;
    if (!isAdminFull) {
      message.warning('You are a read-only admin (ADMIN_VIEWER) and cannot cancel events');
      return;
    }
    const reason = await new Promise((resolve) => {
      let input = '';
      Modal.confirm({
        title: 'Delete event (backend cascades cancellation)',
        content: (
          <Input.TextArea
            rows={3}
            placeholder="Deletion/cancellation reason (included in employee notifications via WebSocket)"
            onChange={(e) => {
              input = e.target.value;
            }}
          />
        ),
        onOk: () => resolve(input || 'Temporary cancellation'),
        onCancel: () => resolve('')
      });
    });

    if (!reason) return;
    setCancelling(true);
    try {
      await apiClient.adminCancelEvent(selectedEventId, reason);
      message.success(
        'Event cancelled. Notifications were sent to all registrants with the reason. Confirm backend push delivery if missing.'
      );
      await loadEvents();
      await loadDashboard(selectedEventId);
      refreshList({ page_size: 30 }).catch(() => {});
    } catch (error) {
      message.error(getErrorMessage(error, 'Failed to cancel event'));
    } finally {
      setCancelling(false);
    }
  };

  const handleDeleteDraft = (eventRecord) => {
    if (!eventRecord?.id) return;
    if (!isAdminFull) {
      message.warning('You are a read-only admin (ADMIN_VIEWER) and cannot delete drafts');
      return;
    }
    Modal.confirm({
      title: 'DeleteDraft',
      content: `Delete "${eventRecord.title || 'Untitled draft'}"? This action cannot be undone.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        setDeletingDraftId(eventRecord.id);
        try {
          await apiClient.adminCancelEvent(eventRecord.id, 'DeleteDraft');
          if (editingEventId === eventRecord.id) {
            resetEditMode();
          }
          message.success('Draft deleted');
          const nextEvents = await loadEvents();
          const nextSelectedEventId = selectedEventId === eventRecord.id
            ? nextEvents.find((event) => event.id !== eventRecord.id)?.id || ''
            : selectedEventId;
          setSelectedEventId(nextSelectedEventId);
          await loadDashboard(nextSelectedEventId);
        } catch (error) {
          message.error(getErrorMessage(error, 'Failed to delete draft'));
          throw error;
        } finally {
          setDeletingDraftId('');
        }
      }
    });
  };

  const handlePublishDraft = async (eventRecord) => {
    if (!eventRecord?.id) return;
    if (!isAdminFull) {
      message.warning('You are a read-only admin (ADMIN_VIEWER) and cannot publish drafts');
      return;
    }
    setPublishingDraftId(eventRecord.id);
    try {
      await apiClient.adminPublishEvent(eventRecord.id);
      if (editingEventId === eventRecord.id) {
        resetEditMode();
      }
      message.success('Draft published');
      await loadEvents();
      const nextSelectedEventId = selectedEventId || eventRecord.id;
      setSelectedEventId(nextSelectedEventId);
      await loadDashboard(nextSelectedEventId);
    } catch (error) {
      message.error(getErrorMessage(error, 'Failed to publish draft'));
    } finally {
      setPublishingDraftId('');
    }
  };

  const handleExportSync = async () => {
    if (!selectedEventId) return;
    setExportingSync(true);
    try {
      const blob = await apiClient.adminExportSync(selectedEventId, { format: 'csv', mask_pii: true });
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `registrations_${selectedEventId}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      message.error(getErrorMessage(error, 'Failed to export synchronously'));
    } finally {
      setExportingSync(false);
    }
  };

  const handleRunLottery = (sessionId, sessionTitle) => {
    if (!selectedEventId) return;
    Modal.confirm({
      title: `Run lottery：${sessionTitle}`,
      content: 'Shuffle all REGISTERED entries for this session into WON and LOST outcomes. Each session can run once.',
      okText: 'Start lottery',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const res = await apiClient.adminRunLottery(sessionId);
          message.success(`Lottery complete: won ${res.data?.winners_count ?? 0} winners / registered ${res.data?.total_candidates ?? 0} people`);
          await loadDashboard(selectedEventId);
        } catch (error) {
          message.error(getErrorMessage(error, 'Lottery failed'));
          throw error;
        }
      }
    });
  };

  const runInstantLotteryForSelectedEvent = async () => {
    if (!selectedEventId) return;
    if (!isAdminFull) {
      message.warning('You are a read-only admin (ADMIN_VIEWER) and cannot run lotteries');
      return;
    }
    const rows = dashboard?.sessions_lottery || [];
    const pending = rows.filter((r) => r?.session_id && !r?.lottery_executed_at);
    if (!pending.length) {
      message.info('No sessions pending lottery');
      return;
    }
    Modal.confirm({
      title: 'Run lottery now (pending sessions)',
      content: `This will immediately run lottery for ${pending.length} pending session(s). Employees must confirm attendance on the event page to receive tickets.`,
      okText: 'Start instant lottery',
      cancelText: 'Cancel',
      onOk: async () => {
        setAutoLotteryRunning(true);
        try {
          await Promise.all(pending.map((row) => apiClient.adminRunLottery(row.session_id)));
          message.success(`Instant lottery complete: ${pending.length}/${pending.length}`);
          await loadDashboard(selectedEventId);
        } catch (e) {
          message.error(getErrorMessage(e, 'Instant lottery failed'));
          throw e;
        } finally {
          setAutoLotteryRunning(false);
        }
      }
    });
  };

  return {
    loading,
    isAdminViewer,
    isAdminFull,
    activeTabKey,
    setActiveTabKey,
    createForm,
    initialCreateValues,
    resetCreateFormToDefaults,
    createRegistrationMode,
    selectedCoverImage,
    latestSessionEndLabel,
    anyRequireChildTicket,
    adultHasLimits,
    childHasLimits,
    adultHealthUnlimited,
    childHealthUnlimited,
    dashboardEventOptions,
    draftEvents,
    isEditing,
    selectedEventId,
    setSelectedEventId,
    selectedEvent,
    dashboard,
    registrations,
    creating,
    publishing,
    cancelling,
    exportingSync,
    deletingDraftId,
    publishingDraftId,
    editLoading,
    editingEventId,
    autoLotteryRunning,
    handleSelectCoverImage,
    handleCreate,
    handleCreateDraft,
    updateEvent,
    resetEditMode,
    enterEditMode,
    handleDeleteDraft,
    handlePublishDraft,
    handlePublish,
    handleCancel,
    runInstantLotteryForSelectedEvent,
    handleExportSync,
    handleRunLottery
  };
};

const AdminConsolePage = () => {
  const controller = useAdminConsoleController();

  return (
    <div className="page-wrap admin-console-page">
      <AdminConsoleHero loading={controller.loading} isAdminViewer={controller.isAdminViewer} />
      <AdminConsoleTabs controller={controller} />
    </div>
  );
};

const AdminConsoleHero = ({ loading, isAdminViewer }) => {
  const { m } = useI18n();
  const t = m.admin;
  return (
  <Card loading={loading} className="admin-console-hero">
    <div className="admin-console-hero-main">
      <div>
        <Text className="admin-console-kicker">{t.kicker}</Text>
        <Title level={3}>{t.title}</Title>
        <Paragraph>{t.desc}</Paragraph>
      </div>
    </div>
    {isAdminViewer ? (
      <Alert
        type="warning"
        showIcon
        message={t.viewerWarning}
        description={t.viewerDesc}
      />
    ) : null}
  </Card>
  );
};

const AdminConsoleTabs = ({ controller }) => {
  const { m } = useI18n();
  const t = m.admin;
  const draftTabLabel = t.draftEvents + (controller.draftEvents.length ? ' (' + controller.draftEvents.length + ')' : '');

  return (
    <Tabs
      activeKey={controller.activeTabKey}
      onChange={controller.setActiveTabKey}
      className="admin-console-tabs"
      style={{ marginTop: 16 }}
      animated={false}
      items={[
        {
          key: 'event-create',
          label: controller.isEditing ? t.editEvent : t.createEvent,
          children: <EventCreateTab controller={controller} />
        },
        {
          key: 'drafts',
          label: draftTabLabel,
          children: <DraftsTab controller={controller} />
        },
        {
          key: 'dashboard',
          label: t.dashboard,
          children: <DashboardTab controller={controller} />
        }
      ]}
    />
  );
};

const EventCreateTab = ({ controller }) => (
  <Card className="admin-create-card">
    <Form
      form={controller.createForm}
      layout="vertical"
      initialValues={controller.initialCreateValues}
      className="admin-create-form"
    >
      <EventBasicFields />
      <TicketRestrictionFields controller={controller} />
      <CoverAndSiteFields controller={controller} />
      <RegistrationTimelineFields createRegistrationMode={controller.createRegistrationMode} />
      <SessionsFields controller={controller} />
      <EventCreateActions controller={controller} />
    </Form>
  </Card>
);

const EventBasicFields = () => {
  const { m } = useI18n();
  const t = m.admin;

  return (
    <>
      <Divider orientation="left" style={{ marginTop: 0 }}>{t.basicInfo}</Divider>
      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Form.Item name="title" label={t.eventTitle} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} lg={10}>
          <Form.Item
            name="registration_mode"
            label={t.registrationMode}
            rules={[{ required: true, message: t.selectRegistrationMode }]}
          >
            <Select
              options={[
                { value: 'UNLIMITED', label: t.unlimitedMode },
                { value: 'LIMITED', label: t.limitedMode }
              ]}
            />
          </Form.Item>
        </Col>
        <Col xs={24}>
          <Form.Item name="description" label={t.eventDescription}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
};

const TicketRestrictionFields = ({ controller }) => {
  const { m } = useI18n();
  const t = m.admin;

  const {
    createRegistrationMode,
    anyRequireChildTicket,
    adultHasLimits,
    childHasLimits,
    adultHealthUnlimited,
    childHealthUnlimited
  } = controller;

  if (createRegistrationMode !== 'LIMITED') {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t.unlimitedMode}
        description={t.desc}
      />
    );
  }

  return (
    <>
      <Divider style={{ marginTop: 6 }}>{t.eligibilityRestrictions}</Divider>

      <Card type="inner" title={`${t.adultTicketRestriction}`} style={{ marginBottom: 12 }}>
        <Form.Item name="adult_has_limits" valuePropName="checked" style={{ marginBottom: 10 }}>
          <Checkbox>{t.expandSettings}</Checkbox>
        </Form.Item>
        {adultHasLimits ? (
          <>
            <Row gutter={12}>
              <Col xs={24} md={16}>
                <Form.Item name="adult_gender" label={t.genderRestriction} initialValue="ANY">
                  <Select
                    options={[
                      { value: 'ANY', label: t.genderAny },
                      { value: 'M', label: t.genderMale },
                      { value: 'F', label: t.genderFemale }
                    ]}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col xs={12} md={6}>
                <Form.Item name="adult_height_min_cm" label={t.minHeight}>
                  <InputNumber min={0} max={250} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="adult_height_max_cm" label={t.maxHeight}>
                  <InputNumber min={0} max={250} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="adult_age_min" label={t.minAge}>
                  <InputNumber min={0} max={120} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="adult_age_max" label={t.maxAge}>
                  <InputNumber min={0} max={120} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col xs={24} md={8}>
                <Form.Item name="adult_health_unlimited" valuePropName="checked" label={t.healthRestrictions}>
                  <Checkbox>{t.noHealthRestrictions}</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item name="adult_health_no_diseases" label={t.healthCheckHint}>
                  <Checkbox.Group
                    disabled={adultHealthUnlimited}
                    options={DISEASE_OPTIONS}
                  />
                </Form.Item>
              </Col>
            </Row>
          </>
        ) : (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>{t.noRestrictions}</Paragraph>
        )}
        <Form.Item name="adult_other_restrictions" label={t.otherNotes}>
          <Input.TextArea rows={2} placeholder={t.oneNotePerLine} />
        </Form.Item>
      </Card>

      {anyRequireChildTicket ? (
        <Card type="inner" title={`${t.childTicketRestriction}`}>
          <Form.Item name="child_has_limits" valuePropName="checked" style={{ marginBottom: 10 }}>
            <Checkbox>{t.expandSettings}</Checkbox>
          </Form.Item>
          {childHasLimits ? (
            <>
              <Row gutter={12}>
                <Col xs={12} md={8}>
                  <Form.Item name="child_age_min" label={t.minAge}>
                    <InputNumber min={0} max={120} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item name="child_age_max" label={t.maxAge}>
                    <InputNumber min={0} max={120} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item name="child_health_unlimited" valuePropName="checked" label={t.healthRestrictions}>
                    <Checkbox>{t.noHealthRestrictions}</Checkbox>
                  </Form.Item>
                </Col>
                <Col xs={24} md={16}>
                  <Form.Item name="child_health_no_diseases" label={t.healthCheckHint}>
                    <Checkbox.Group
                      disabled={childHealthUnlimited}
                      options={DISEASE_OPTIONS}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </>
          ) : (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>{t.noRestrictions}</Paragraph>
          )}
          <Form.Item name="child_other_restrictions" label={t.otherNotes}>
            <Input.TextArea rows={2} placeholder={t.oneNotePerLine} />
          </Form.Item>
        </Card>
      ) : null}
    </>
  );
};

const CoverAndSiteFields = ({ controller }) => {
  const { m } = useI18n();
  const t = m.admin;
  const { selectedCoverImage, handleSelectCoverImage } = controller;

  return (
    <>
      <Divider orientation="left">{t.sitesDistribution}</Divider>
      <Form.Item label="活動封面" required>
        <Form.Item name="cover_image_url" noStyle>
          <Input type="hidden" />
        </Form.Item>
        <fieldset className="admin-cover-choice">
          <legend className="sr-only">活動封面</legend>
          {EVENT_IMAGES.map((src, idx) => (
            <button
              key={src}
              type="button"
              className={'admin-cover-option' + (selectedCoverImage === src ? ' is-selected' : '')}
              aria-label={`選擇活動封面 ${idx + 1}`}
              aria-pressed={selectedCoverImage === src}
              onClick={() => handleSelectCoverImage(src)}
            >
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </fieldset>
      </Form.Item>
      <Form.Item name="allowed_sites" label={t.allSites} rules={[{ required: true, message: '請至少選擇一個開放廠區' }]}>
        <Checkbox.Group options={SITES} />
      </Form.Item>
    </>
  );
};

const SessionsFields = ({ controller }) => {
  const { m } = useI18n();
  const t = m.admin;
  const { createRegistrationMode, latestSessionEndLabel } = controller;

  return (
    <>
      <Divider style={{ marginTop: 6 }}>{t.lotteryBySession}</Divider>

      <Form.List name="sessions">
        {(fields, { add, remove }) => (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {fields.map((field, idx) => {
              const { key, ...fieldProps } = field;
              return (
                <Card
                  key={key}
                  type="inner"
                  title={`${m.eventsList.session} ${idx + 1}`}
                  extra={fields.length > 1 ? <Button danger onClick={() => remove(field.name)}>{t.delete}</Button> : null}
                >
                  <Row gutter={12}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        {...fieldProps}
                        name={[field.name, 'title']}
                        label={t.sessionTitle}
                        rules={[{ required: true, message: t.sessionTitle }]}
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={16}>
                      <Form.Item
                        {...fieldProps}
                        name={[field.name, 'venue']}
                        label={t.sessionVenue}
                        rules={[{ required: true, message: t.sessionVenue }]}
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  {createRegistrationMode === 'LIMITED' ? (
                    <>
                      <Row gutter={12}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            {...fieldProps}
                            name={[field.name, 'adult_quota']}
                            label={t.adultQuotaLabel}
                            rules={[{ required: true, message: t.adultQuotaLabel }]}
                          >
                            <InputNumber min={0} max={999999} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={12}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            {...fieldProps}
                            name={[field.name, 'require_child_ticket']}
                            label={t.requireChildTicket}
                            valuePropName="checked"
                          >
                            <Checkbox>{t.childTicketsRequired}</Checkbox>
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item
                        shouldUpdate={(prev, cur) =>
                          prev?.sessions?.[field.name]?.require_child_ticket !== cur?.sessions?.[field.name]?.require_child_ticket
                        }
                        noStyle
                      >
                        {({ getFieldValue }) =>
                          getFieldValue(['sessions', field.name, 'require_child_ticket']) ? (
                            <Row gutter={12}>
                              <Col xs={24} md={12}>
                                <Form.Item
                                  {...fieldProps}
                                  name={[field.name, 'child_quota']}
                                  label={t.childQuotaLabel}
                                  rules={[{ required: true, message: t.childQuotaLabel }]}
                                >
                                  <InputNumber min={0} max={999999} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                            </Row>
                          ) : null
                        }
                      </Form.Item>
                    </>
                  ) : null}
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        {...fieldProps}
                        name={[field.name, 'starts_at']}
                        label={t.startTime}
                        rules={[{ required: true, message: t.startTime }]}
                      >
                        <DatePicker showTime style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        {...fieldProps}
                        name={[field.name, 'ends_at']}
                        label={t.endTime}
                        dependencies={[['sessions', field.name, 'starts_at']]}
                        rules={[
                          { required: true, message: t.endTime },
                          ({ getFieldValue }) => ({
                            validator(_, value) {
                              const start = getFieldValue(['sessions', field.name, 'starts_at']);
                              if (!start || !value) return Promise.resolve();
                              const a = dayjs(start);
                              const b = dayjs(value);
                              if (!a.isValid() || !b.isValid()) return Promise.resolve();
                              if (b.isAfter(a)) return Promise.resolve();
                              return Promise.reject(new Error(t.endTimeValidation));
                            }
                          })
                        ]}
                      >
                        <DatePicker showTime style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              );
            })}

            <Space wrap>
              <Button
                onClick={() => add({
                  title: '',
                  venue: '',
                  starts_at: null,
                  ends_at: null,
                  adult_quota: null,
                  require_child_ticket: true,
                  child_quota: null
                })}
              >
                {t.addSession}
              </Button>
              <div className="admin-session-summary" aria-live="polite">
                <span className="admin-session-summary-label">{t.eventEndsAt} </span>
                <span className="admin-session-summary-note">{t.latestSessionEndNote} </span>
                <strong>{latestSessionEndLabel}</strong>
              </div>
            </Space>
          </Space>
        )}
      </Form.List>
    </>
  );
};

const RegistrationTimelineFields = ({ createRegistrationMode }) => {
  const { m } = useI18n();
  const t = m.admin;

  return (
    <>
      <Divider orientation="left">{t.registrationSchedule}</Divider>
      <Row gutter={12}>
        <Col xs={24} md={createRegistrationMode === 'LIMITED' ? 8 : 12}>
          <Form.Item name="registration_opens_at" label={t.regOpensShared} rules={[{ required: true, message: 'Select registration open time' }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={createRegistrationMode === 'LIMITED' ? 8 : 12}>
          <Form.Item name="registration_closes_at" label={t.regClosesShared} rules={[{ required: true, message: 'Select registration close time' }]}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        {createRegistrationMode === 'LIMITED' ? (
          <Col xs={24} md={8}>
            <Form.Item
              name="waitlist_close_at"
              label={t.waitlistClosesShared}
              rules={[{ required: true, message: 'Select waitlist close time' }]}
            >
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        ) : null}
      </Row>
    </>
  );
};

const EventCreateActions = ({ controller }) => {
  const {
    isEditing,
    creating,
    isAdminFull,
    resetCreateFormToDefaults,
    handleCreate,
    handleCreateDraft,
    updateEvent,
    resetEditMode,
    setActiveTabKey
  } = controller;

  return (
    <>
      <Divider />
      <div className="admin-create-actions">
        {isEditing ? (
          <>
            <Button type="primary" onClick={() => updateEvent(true)} loading={creating} disabled={!isAdminFull}>
              Publish
            </Button>
            <Button onClick={() => updateEvent(false)} loading={creating} disabled={!isAdminFull}>
              Save as draft
            </Button>
            <Button
              className="admin-create-cancel"
              onClick={() => {
                resetEditMode();
                setActiveTabKey('dashboard');
              }}
            >
              Cancel edit
            </Button>
          </>
        ) : (
          <>
            <Button type="primary" onClick={handleCreate} loading={creating} disabled={!isAdminFull}>Publish</Button>
            <Button onClick={handleCreateDraft} loading={creating} disabled={!isAdminFull}>Save as draft</Button>
            <Button className="admin-create-cancel" onClick={resetCreateFormToDefaults}>Cancel edit</Button>
          </>
        )}
      </div>
    </>
  );
};

const DraftsTab = ({ controller }) => {
  const { m } = useI18n();
  const t = m.admin;
  const c = m.common;

  const {
    draftEvents,
    editLoading,
    editingEventId,
    deletingDraftId,
    publishingDraftId,
    isAdminFull,
    enterEditMode,
    handleDeleteDraft,
    handlePublishDraft
  } = controller;

  return (
    <Card className="admin-draft-card">
      <div className="admin-draft-header">
        <div>
          <Text className="admin-dashboard-section-label">{t.draftEvents}</Text>
          <Title level={4}>{t.draftManagement}</Title>
          <Paragraph type="secondary">
            {t.draftManagementDesc}
          </Paragraph>
        </div>
      </div>
      <Table
        rowKey="id"
        dataSource={draftEvents}
        pagination={false}
        locale={{ emptyText: t.noMatch || 'No draft events' }}
        columns={[
          {
            title: t.eventName,
            dataIndex: 'title',
            key: 'title',
            render: (title, record) => (
              <Space direction="vertical" size={2}>
                <Text strong>{title}</Text>
                <Text type="secondary">
                  {record.allowed_sites?.length ? record.allowed_sites.join(', ') : t.allSites}
                </Text>
              </Space>
            )
          },
          {
            title: t.draftStatus || 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (status) => <Tag>{labelOr(EVENT_STATUS_LABELS, status, status)}</Tag>
          },
          {
            title: m.eventDetail.createdAt,
            dataIndex: 'created_at',
            key: 'created_at',
            render: (value) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-')
          },
          {
            title: t.actions,
            key: 'action',
            render: (_, record) => (
              <Space wrap>
                <Button
                  loading={editLoading && editingEventId === record.id}
                  disabled={!isAdminFull || deletingDraftId === record.id || publishingDraftId === record.id}
                  onClick={() => enterEditMode(record.id)}
                >
                  {t.loadForEdit}
                </Button>
                <Button
                  type="primary"
                  loading={publishingDraftId === record.id}
                  disabled={!isAdminFull || editLoading || deletingDraftId === record.id}
                  onClick={() => handlePublishDraft(record)}
                >
                  {t.publishDraft}
                </Button>
                <Button
                  danger
                  loading={deletingDraftId === record.id}
                  disabled={!isAdminFull || editLoading || publishingDraftId === record.id}
                  onClick={() => handleDeleteDraft(record)}
                >
                  {c.delete}
                </Button>
              </Space>
            )
          }
        ]}
      />
    </Card>
  );
};

const DashboardTab = ({ controller }) => {
  const { m } = useI18n();
  const t = m.admin;
  const {
    selectedEventId,
    setSelectedEventId,
    dashboardEventOptions,
    selectedEvent,
    dashboard,
    registrations,
    publishing,
    cancelling,
    exportingSync,
    editLoading,
    isAdminFull,
    autoLotteryRunning,
    handlePublish,
    enterEditMode,
    handleCancel,
    runInstantLotteryForSelectedEvent,
    handleExportSync,
    handleRunLottery
  } = controller;

  const registrationTimeline = dashboard?.registration_timeline || EMPTY_ARRAY;
  const siteDistribution = dashboard?.site_distribution || EMPTY_ARRAY;
  const ticketTypeProgress = dashboard?.ticket_type_progress || EMPTY_ARRAY;
  const registeredTotal = useMemo(
    () => ticketTypeProgress.reduce((sum, item) => sum + Number(item.registered || 0), 0),
    [ticketTypeProgress]
  );

  return (
    <>
      <Card className="admin-dashboard-toolbar">
        <div className="admin-dashboard-toolbar-grid">
          <section className="admin-dashboard-picker">
            <Text className="admin-dashboard-section-label">{t.dashboard} {m.eventDetail.sessionLabel}</Text>
            <div className="admin-dashboard-select-row">
              <Select
                className="admin-event-select"
                placeholder={t.selectRegistrationMode}
                value={selectedEventId || undefined}
                onChange={setSelectedEventId}
                options={dashboardEventOptions}
                showSearch
                filterOption={(input, option) =>
                  String(option?.searchText || option?.label || '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </div>
          </section>

          <section className="admin-dashboard-action-panel">
            <div className="admin-dashboard-action-block">
              <Text className="admin-dashboard-section-label">{t.eventManagement}</Text>
              <Space wrap className="admin-dashboard-actions">
                <Button type="primary" onClick={handlePublish} loading={publishing} disabled={!isAdminFull || !selectedEvent || selectedEvent.status !== 'DRAFT'}>
                  {t.publishDraft}
                </Button>
                <Button onClick={() => enterEditMode(selectedEventId)} loading={editLoading} disabled={!isAdminFull || !selectedEvent}>
                  {t.editEvent}
                </Button>
                <Button danger onClick={handleCancel} loading={cancelling} disabled={!isAdminFull || !selectedEvent}>
                  {t.deleteDraft}
                </Button>
              </Space>
            </div>
            <div className="admin-dashboard-action-block">
              <Text className="admin-dashboard-section-label">{t.lotteryAndReports}</Text>
              <Space wrap className="admin-dashboard-actions">
                <Button
                  type="primary"
                  onClick={runInstantLotteryForSelectedEvent}
                  loading={autoLotteryRunning}
                  disabled={!isAdminFull || !selectedEventId}
                >
                  {t.runLotteryNow}
                </Button>
                <Button onClick={handleExportSync} loading={exportingSync} disabled={!selectedEventId}>
                  {t.exportCsv}
                </Button>
              </Space>
            </div>
          </section>
        </div>
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title={t.registered} value={registeredTotal} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title={t.confirmed} value={dashboard?.attendance?.total_confirmed || 0} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title={t.checkedIn} value={dashboard?.attendance?.checked_in || 0} />
          </Card>
        </Col>
      </Row>

      <Suspense fallback={<div style={{ minHeight: 292, marginTop: 16 }} />}>
        <DashboardCharts
          registrationTimeline={registrationTimeline}
          siteDistribution={siteDistribution}
          ticketTypeProgress={ticketTypeProgress}
        />
      </Suspense>

      <Card style={{ marginTop: 16 }} title={t.registrationList}>
        <Table
          rowKey="id"
          dataSource={registrations}
          scroll={{ x: 860 }}
          columns={[
            { title: m.profile.employeeId, dataIndex: ['user', 'employee_id'] },
            { title: m.verifier.name, dataIndex: ['user', 'name'] },
            { title: m.profile.department, dataIndex: ['user', 'department'] },
            { title: m.profile.session, dataIndex: 'session_title' },
            { title: m.profile.ticketType, dataIndex: 'ticket_type_name' },
            {
              title: m.profile.status,
              dataIndex: 'status',
              render: (v) => (
                <Tag
                  color={
                    v === 'CONFIRMED'
                      ? 'green'
                      : v === 'WON'
                        ? 'gold'
                        : v === 'LOST'
                          ? 'default'
                          : 'blue'
                  }
                >
                  {labelOr(REGISTRATION_STATUS_LABELS, v, v)}
                </Tag>
              )
            }
          ]}
        />
      </Card>

      <Card style={{ marginTop: 16 }} title={t.lotteryBySession}>
        <Table
          rowKey="session_id"
          pagination={false}
          dataSource={dashboard?.sessions_lottery || []}
          scroll={{ x: 760 }}
          columns={[
            { title: m.profile.session, dataIndex: 'title' },
            { title: t.lotteryTime, dataIndex: 'lottery_at' },
            {
              title: m.profile.status,
              key: 'st',
              render: (_, row) =>
                row.lottery_executed_at ? (
                  <Tag color="green">{t.completed} ({row.lottery_executed_at})</Tag>
                ) : (
                  <Tag color="orange">{t.pending}</Tag>
                )
            },
            {
              title: `${t.pending}${t.runLottery} (${t.registered})`,
              dataIndex: 'registered_pending',
              render: (v) => (v == null ? '—' : v)
            },
            {
              title: t.actions,
              key: 'act',
              render: (_, row) => (
                <Button
                  type="primary"
                  disabled={!isAdminFull || !!row.lottery_executed_at || !selectedEventId}
                  onClick={() => handleRunLottery(row.session_id, row.title)}
                >
                  {t.runLottery}
                </Button>
              )
            }
          ]}
        />
      </Card>
    </>
  );
};


export default AdminConsolePage;
