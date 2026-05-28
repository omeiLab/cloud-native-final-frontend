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
import { EVENT_STATUS_LABELS, REGISTRATION_STATUS_LABELS, labelOr } from '../utils/labels';
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
    const siteChartData = siteDistribution.map((siteItem) => ({
      name: SITE_LABELS[siteItem.site] || siteItem.site,
      value: siteItem.count,
      site: siteItem.site
    }));

    return (
      <>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={24} lg={12}>
            <Card title="報名趨勢">
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
                    name="累積報名"
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
            <Card title="開放廠區分布（含名稱）">
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

        <Card style={{ marginTop: 16 }} title="票種進度">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ticketTypeProgress}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="quota" name="名額" fill="#2b72d9" isAnimationActive={false} />
              <Bar dataKey="registered" name="已報名" fill="#f4a261" isAnimationActive={false} />
              <Bar dataKey="confirmed" name="已確認" fill="#2a9d8f" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <Table
            pagination={false}
            rowKey="ticket_type_id"
            dataSource={ticketTypeProgress}
            scroll={{ x: 640 }}
            columns={[
              { title: '票種', dataIndex: 'name' },
              { title: '名額', dataIndex: 'quota' },
              { title: '已報名', dataIndex: 'registered' },
              { title: '中籤', dataIndex: 'won' },
              { title: '已確認', dataIndex: 'confirmed' }
            ]}
          />
        </Card>
      </>
    );
  }
})));

const SITES = ['HSINCHU', 'TAINAN', 'TAICHUNG', 'TAIPEI', 'OVERSEAS'];
const SITE_LABELS = {
  HSINCHU: '新竹 HSINCHU',
  TAINAN: '台南 TAINAN',
  TAICHUNG: '台中 TAICHUNG',
  TAIPEI: '台北 TAIPEI',
  OVERSEAS: '海外 OVERSEAS'
};

const DISEASE_OPTIONS = [
  '心臟病／心血管疾病',
  '高血壓',
  '糖尿病',
  '氣喘／慢性呼吸道疾病',
  '癲癇',
  '肝炎／肝功能異常',
  '傳染性疾病（含發燒、流感等）',
  '近期重大手術或需醫師評估之狀況'
];

const defaultSession = {
  confirmation_deadline_hours: 48,
  ticket_types: [
    { name: '成人票', quota: 200, sort_order: 0, audience: 'EMPLOYEE' },
    { name: '兒童票', quota: 100, sort_order: 1, audience: 'DEPENDENT' }
  ]
};
const PIE_COLORS = ['#2b72d9', '#2a9d8f', '#f4a261', '#9b5de5', '#f28482'];

/** 儀表板 sessions_lottery 列（後端欄位可能用 id 或別名） */
const normalizeSessionsLotteryRows = (raw) => {
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

/** GET /admin/.../dashboard 若未附 sessions_lottery，改由 GET /events/{id} 場次補齊，抽籤按鈕才可操作 */
const mergeDashboardSessionsLottery = (dash, eventDetail) => {
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
const createDefaultCreateValues = () => {
  const current = dayjs().second(0).millisecond(0);
  const sessionStartsAt = current.add(14, 'day');

  return {
    title: '2026 春季家庭日',
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
        title: '第 1 場',
        venue: '新竹園區戶外廣場',
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

const adminStateReducer = (state, action) => {
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

const normalizeCoverImageUrlForBackend = (value) => {
  const trimmed = String(value || '').trim();
  return trimmed ? publicRootPath(trimmed) : null;
};

const CETS_ELIGIBILITY_MARKER_PREFIX = '<!--CETS_ELIGIBILITY:';
const CETS_ELIGIBILITY_MARKER_SUFFIX = '-->';

const stripEligibilityMarkerForBackend = (rawDescription) => {
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

const resolveSessionTicketFields = (session) => {
  const ticketTypes = Array.isArray(session?.ticket_types) ? session.ticket_types : [];
  const adultTicket =
    ticketTypes.find((t) => String(t?.name || '').includes('成人')) ||
    ticketTypes.find((t) => t?.audience === 'EMPLOYEE') ||
    ticketTypes[0] ||
    {};
  const childTicket =
    ticketTypes.find((t) => String(t?.name || '').includes('兒童')) ||
    ticketTypes.find((t) => t?.audience === 'DEPENDENT') ||
    null;
  return { adultTicket, childTicket };
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
    return max ? dayjs(max).format('YYYY-MM-DD HH:mm') : '未設定';
  }, [watchedSessions]);
  const anyRequireChildTicket = useMemo(
    () => (watchedSessions || []).some((s) => Boolean(s?.require_child_ticket)),
    [watchedSessions]
  );
  const adultHasLimits = Form.useWatch('adult_has_limits', createForm);
  const childHasLimits = Form.useWatch('child_has_limits', createForm);
  const adultHealthUnlimited = Form.useWatch('adult_health_unlimited', createForm);
  const childHealthUnlimited = Form.useWatch('child_health_unlimited', createForm);
  const getErrorMessage = (error, fallback) => {
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
    if (error?.httpStatus === 404) return '後端找不到此 API（HTTP 404），可能尚未部署此端點';
    return fallback;
  };
  const getEventId = (eventLike) => eventLike?.data?.id || eventLike?.data?.event_id || eventLike?.id || eventLike?.event_id || '';
  const getSessionId = (sessionLike) => sessionLike?.data?.id || sessionLike?.data?.session_id || sessionLike?.id || sessionLike?.session_id || '';
  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId), [events, selectedEventId]);
  const dashboardEventOptions = useMemo(() => {
    return events.map((event) => {
      const statusLabel = labelOr(EVENT_STATUS_LABELS, event.status, event.status);
      const sitesLabel = event.allowed_sites?.length ? event.allowed_sites.join(', ') : '全廠區';
      return {
        label: `${event.title}（${statusLabel}）`,
        value: event.id,
        searchText: `${event.title || ''} ${event.status || ''} ${statusLabel} ${sitesLabel}`
      };
    });
  }, [events]);
  const draftEvents = useMemo(() => events.filter((e) => e.status === 'DRAFT'), [events]);
  const isEditing = Boolean(editingEventId);

  const resolveLimitedLotteryAt = (registrationClosesAt) => {
    const closesAt = dayjs(registrationClosesAt);
    if (!closesAt.isValid()) return closesAt;
    // 後端抽籤批次改為「每分鐘掃描可抽籤場次」，前端以「報名截止後 + 1 分鐘」作為 lottery_at，
    // 讓測試流程可在幾分鐘內完成。
    return closesAt.add(1, 'minute');
  };

  const resolveLimitedWaitlistCloseAt = (values, startsAt) => {
    const manual = values?.waitlist_close_at ? dayjs(values.waitlist_close_at) : null;
    if (manual?.isValid()) {
      return manual;
    }
    return dayjs(startsAt).subtract(1, 'minute');
  };

  const validateSessionTimeline = (values) => {
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
      throw new Error('報名開放時間必須早於報名截止時間');
    }
    if (!registrationClosesAt.isBefore(startsAt)) {
      throw new Error('報名截止時間必須早於活動開始時間');
    }
    if (registrationMode === 'LIMITED') {
      if (!registrationClosesAt.isBefore(lotteryAt)) {
        throw new Error('抽籤時間必須晚於報名截止時間');
      }
      if (!lotteryAt.isBefore(waitlistCloseAt)) {
        throw new Error('候補截止時間必須晚於抽籤時間');
      }
      if (!waitlistCloseAt.isBefore(startsAt)) {
        throw new Error('候補截止時間必須早於活動開始時間');
      }
    }
  };

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

  const buildCreatePayload = (values) => {
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
        ? [{ name: '一般票（不限額）', quota: totalQuota, sort_order: 0, audience: 'EMPLOYEE' }]
        : requireChildTicket
          ? [
            { name: '成人票', quota: adultQuota, sort_order: 0, audience: 'EMPLOYEE' },
            { name: '兒童票', quota: childQuota, sort_order: 1, audience: 'DEPENDENT' }
          ]
          : [{ name: '成人票', quota: adultQuota, sort_order: 0, audience: 'EMPLOYEE' }];
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

  const createEvent = async (publishAfterCreate) => {
    if (!isAdminFull) {
      message.warning('你目前是唯讀管理員（ADMIN_VIEWER），無法建立或發布活動');
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
        throw new Error('後端未回傳新活動 ID，請稍後在儀表板確認是否已建立');
      }
      // 相容兩種後端：
      // 1) 建活動時就會把 sessions/ticket_types 一起建立
      // 2) 只建 event(DRAFT)，需再呼叫 /admin/events/{id}/sessions 與 /admin/sessions/{id}/ticket-types
      if ((createdEvent?.sessions?.length || 0) === 0) {
        await Promise.all(sessions.map(async (sessionPayload) => {
          const { ticket_types: ticketTypes, ...sessionBody } = sessionPayload;
          const createdSession = await apiClient.adminCreateSession(createdEventId, sessionBody);
          const createdSessionId = getSessionId(createdSession);
          if (!createdSessionId) {
            throw new Error('建立場次成功但未取得 session_id，請稍後重新整理後檢查');
          }
          await Promise.all((ticketTypes || []).map((tt) => apiClient.adminCreateTicketType(createdSessionId, tt)));
        }));
      }
      if (publishAfterCreate) {
        try {
          await apiClient.adminPublishEvent(createdEventId);
          message.success('活動建立並發布成功');
        } catch (publishError) {
          const code = publishError?.error?.code;
          if (code === 'INVALID_STATE_TRANSITION') {
            message.warning('活動已建立為草稿；目前後端回覆「發布前必須至少有一個場次」。請先補齊場次後再發布。');
          } else {
            throw publishError;
          }
        }
      } else {
        message.success('草稿活動建立成功');
      }
      resetCreateFormToDefaults();
      await loadEvents();
      setSelectedEventId(createdEventId);
      await loadDashboard(createdEventId);
    } catch (error) {
      message.error(getErrorMessage(error, '建立活動失敗，請檢查欄位與權限'));
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
      || String(adultTicket?.name || '').includes('不限');

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
      message.warning('你目前是唯讀管理員（ADMIN_VIEWER），無法編輯活動');
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
      message.success('已載入活動資料，可完整編輯所有欄位');
    } catch (error) {
      message.error(getErrorMessage(error, '載入活動資料失敗'));
    } finally {
      setEditLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedEventId) return;
    if (!isAdminFull) {
      message.warning('你目前是唯讀管理員（ADMIN_VIEWER），無法發布活動');
      return;
    }
    setPublishing(true);
    try {
      await apiClient.adminPublishEvent(selectedEventId);
      message.success('活動已發布');
      await loadEvents();
      await loadDashboard(selectedEventId);
    } catch (error) {
      message.error(getErrorMessage(error, '發布活動失敗'));
    } finally {
      setPublishing(false);
    }
  };

  const updateEvent = async (publishAfterSave) => {
    if (!editingEventId) return;
    if (!isAdminFull) {
      message.warning('你目前是唯讀管理員（ADMIN_VIEWER），無法編輯或發布活動');
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
        message.success('活動已更新並發布');
      } else {
        message.success('活動更新成功');
      }
      await loadEvents();
      await loadDashboard(editingEventId);
      setSelectedEventId(editingEventId);
      resetEditMode();
      setActiveTabKey('dashboard');
    } catch (error) {
      message.error(getErrorMessage(error, '更新活動失敗，請確認後端是否支援完整欄位更新'));
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedEventId) return;
    if (!isAdminFull) {
      message.warning('你目前是唯讀管理員（ADMIN_VIEWER），無法取消活動');
      return;
    }
    const reason = await new Promise((resolve) => {
      let input = '';
      Modal.confirm({
        title: '刪除活動（後端聯動取消）',
        content: (
          <Input.TextArea
            rows={3}
            placeholder="刪除／取消原因（將寫入受影響員工的通知內容，請後端連同 WebSocket 一併推送）"
            onChange={(e) => {
              input = e.target.value;
            }}
          />
        ),
        onOk: () => resolve(input || '臨時取消'),
        onCancel: () => resolve('')
      });
    });

    if (!reason) return;
    setCancelling(true);
    try {
      await apiClient.adminCancelEvent(selectedEventId, reason);
      message.success(
        '活動已取消。已向所有曾報名此活動的員工發送通知（原因會顯示在通知內）；若未收到請確認後端已實作推播與原因欄位。'
      );
      await loadEvents();
      await loadDashboard(selectedEventId);
      refreshList({ page_size: 30 }).catch(() => {});
    } catch (error) {
      message.error(getErrorMessage(error, '取消活動失敗'));
    } finally {
      setCancelling(false);
    }
  };

  const handleDeleteDraft = (eventRecord) => {
    if (!eventRecord?.id) return;
    if (!isAdminFull) {
      message.warning('你目前是唯讀管理員（ADMIN_VIEWER），無法刪除草稿');
      return;
    }
    Modal.confirm({
      title: '刪除草稿',
      content: `確定要刪除「${eventRecord.title || '未命名草稿'}」嗎？此動作無法復原。`,
      okText: '刪除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDeletingDraftId(eventRecord.id);
        try {
          await apiClient.adminCancelEvent(eventRecord.id, '刪除草稿');
          if (editingEventId === eventRecord.id) {
            resetEditMode();
          }
          message.success('草稿已刪除');
          const nextEvents = await loadEvents();
          const nextSelectedEventId = selectedEventId === eventRecord.id
            ? nextEvents.find((event) => event.id !== eventRecord.id)?.id || ''
            : selectedEventId;
          setSelectedEventId(nextSelectedEventId);
          await loadDashboard(nextSelectedEventId);
        } catch (error) {
          message.error(getErrorMessage(error, '刪除草稿失敗'));
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
      message.warning('你目前是唯讀管理員（ADMIN_VIEWER），無法發佈草稿');
      return;
    }
    setPublishingDraftId(eventRecord.id);
    try {
      await apiClient.adminPublishEvent(eventRecord.id);
      if (editingEventId === eventRecord.id) {
        resetEditMode();
      }
      message.success('草稿已發佈');
      await loadEvents();
      const nextSelectedEventId = selectedEventId || eventRecord.id;
      setSelectedEventId(nextSelectedEventId);
      await loadDashboard(nextSelectedEventId);
    } catch (error) {
      message.error(getErrorMessage(error, '發佈草稿失敗'));
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
      message.error(getErrorMessage(error, '同步匯出失敗'));
    } finally {
      setExportingSync(false);
    }
  };

  const handleRunLottery = (sessionId, sessionTitle) => {
    if (!selectedEventId) return;
    Modal.confirm({
      title: `執行抽籤：${sessionTitle}`,
      content: '將對該場次所有「已報名(REGISTERED)」名單洗牌並分配中籤(WON)與候補(LOST)。每個場次僅能執行一次。',
      okText: '開始抽籤',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await apiClient.adminRunLottery(sessionId);
          message.success(`抽籤完成：中籤 ${res.data?.winners_count ?? 0} 人 / 報名 ${res.data?.total_candidates ?? 0} 人`);
          await loadDashboard(selectedEventId);
        } catch (error) {
          message.error(getErrorMessage(error, '抽籤失敗'));
          throw error;
        }
      }
    });
  };

  const runInstantLotteryForSelectedEvent = async () => {
    if (!selectedEventId) return;
    if (!isAdminFull) {
      message.warning('你目前是唯讀管理員（ADMIN_VIEWER），無法執行抽籤');
      return;
    }
    const rows = dashboard?.sessions_lottery || [];
    const pending = rows.filter((r) => r?.session_id && !r?.lottery_executed_at);
    if (!pending.length) {
      message.info('目前沒有尚未執行抽籤的場次');
      return;
    }
    Modal.confirm({
      title: '即時抽籤（未執行場次）',
      content: `將對此活動 ${pending.length} 個尚未抽籤的場次立即執行抽籤。抽籤完成後，員工需至活動頁面「確認參加並領票」才會發行票券（發票）。`,
      okText: '開始即時抽籤',
      cancelText: '取消',
      onOk: async () => {
        setAutoLotteryRunning(true);
        try {
          await Promise.all(pending.map((row) => apiClient.adminRunLottery(row.session_id)));
          message.success(`即時抽籤完成：${pending.length}/${pending.length}`);
          await loadDashboard(selectedEventId);
        } catch (e) {
          message.error(getErrorMessage(e, '即時抽籤失敗'));
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

const AdminConsoleHero = ({ loading, isAdminViewer }) => (
  <Card loading={loading} className="admin-console-hero">
    <div className="admin-console-hero-main">
      <div>
        <Text className="admin-console-kicker">管理後台</Text>
        <Title level={3}>主控台</Title>
        <Paragraph>建立活動、查看報名、抽籤與報表集中在同一個工作區。</Paragraph>
      </div>
    </div>
    {isAdminViewer ? (
      <Alert
        type="warning"
        showIcon
        message="你目前是 ADMIN_VIEWER（唯讀）"
        description="可查看儀表板與報名資料，但不能建立、發布、取消活動或執行抽籤。"
      />
    ) : null}
  </Card>
);

const AdminConsoleTabs = ({ controller }) => {
  const draftTabLabel = '草稿活動' + (controller.draftEvents.length ? ' (' + controller.draftEvents.length + ')' : '');

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
          label: controller.isEditing ? '編輯活動' : '建立活動',
          children: <EventCreateTab controller={controller} />
        },
        {
          key: 'drafts',
          label: draftTabLabel,
          children: <DraftsTab controller={controller} />
        },
        {
          key: 'dashboard',
          label: '儀表板',
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

const EventBasicFields = () => (
  <>
    <Divider orientation="left" style={{ marginTop: 0 }}>基本資料</Divider>
    <Row gutter={16}>
      <Col xs={24} lg={14}>
        <Form.Item name="title" label="活動標題" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </Col>
      <Col xs={24} lg={10}>
        <Form.Item
          name="registration_mode"
          label="報名模式"
          rules={[{ required: true, message: '請選擇報名模式' }]}
        >
          <Select
            options={[
              { value: 'UNLIMITED', label: '無人數限制（前端自動帶入抽籤/候補時間）' },
              { value: 'LIMITED', label: '有人數限制（需設定名額、抽籤、候補）' }
            ]}
          />
        </Form.Item>
      </Col>
      <Col xs={24}>
        <Form.Item name="description" label="活動描述（選填）">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Col>
    </Row>
  </>
);

const TicketRestrictionFields = ({ controller }) => {
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
        message="無人數限制模式"
        description="使用者報名後不受名額限制。因後端 API 目前仍要求抽籤/候補欄位，前端會自動填入系統時間參數，你不需要手動填寫。"
      />
    );
  }

  return (
    <>
      <Divider style={{ marginTop: 6 }}>報名資格限制</Divider>

      <Card type="inner" title="成人票限制" style={{ marginBottom: 12 }}>
        <Form.Item name="adult_has_limits" valuePropName="checked" style={{ marginBottom: 10 }}>
          <Checkbox>有限制（勾選後展開設定）</Checkbox>
        </Form.Item>
        {adultHasLimits ? (
          <>
            <Row gutter={12}>
              <Col xs={24} md={16}>
                <Form.Item name="adult_gender" label="性別限制" initialValue="ANY">
                  <Select
                    options={[
                      { value: 'ANY', label: '不限' },
                      { value: 'M', label: '限男性' },
                      { value: 'F', label: '限女性' }
                    ]}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col xs={12} md={6}>
                <Form.Item name="adult_height_min_cm" label="身高下限(cm)">
                  <InputNumber min={0} max={250} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="adult_height_max_cm" label="身高上限(cm)">
                  <InputNumber min={0} max={250} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="adult_age_min" label="年齡下限">
                  <InputNumber min={0} max={120} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="adult_age_max" label="年齡上限">
                  <InputNumber min={0} max={120} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col xs={24} md={8}>
                <Form.Item name="adult_health_unlimited" valuePropName="checked" label="健康狀態限制">
                  <Checkbox>無限制</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item name="adult_health_no_diseases" label="可勾選：需符合「無以下疾病」">
                  <Checkbox.Group
                    disabled={adultHealthUnlimited}
                    options={DISEASE_OPTIONS}
                  />
                </Form.Item>
              </Col>
            </Row>
          </>
        ) : (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>目前設定：無限制</Paragraph>
        )}
        <Form.Item
          name="adult_other_restrictions"
          label="其他注意事項(選填)"
        >
          <Input.TextArea rows={2} placeholder="每行一則" />
        </Form.Item>
      </Card>

      {anyRequireChildTicket ? (
        <Card type="inner" title="兒童票限制">
          <Form.Item name="child_has_limits" valuePropName="checked" style={{ marginBottom: 10 }}>
            <Checkbox>有限制（勾選後展開設定）</Checkbox>
          </Form.Item>
          {childHasLimits ? (
            <>
              <Row gutter={12}>
                <Col xs={12} md={8}>
                  <Form.Item name="child_age_min" label="兒童年齡下限">
                    <InputNumber min={0} max={120} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item name="child_age_max" label="兒童年齡上限">
                    <InputNumber min={0} max={120} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item name="child_health_unlimited" valuePropName="checked" label="健康狀態限制">
                    <Checkbox>無限制</Checkbox>
                  </Form.Item>
                </Col>
                <Col xs={24} md={16}>
                  <Form.Item name="child_health_no_diseases" label="可勾選：需符合「無以下疾病」">
                    <Checkbox.Group
                      disabled={childHealthUnlimited}
                      options={DISEASE_OPTIONS}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </>
          ) : (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>目前設定：無限制</Paragraph>
          )}
          <Form.Item
            name="child_other_restrictions"
            label="兒童票其他注意事項(選填)"
          >
            <Input.TextArea rows={2} placeholder="每行一則" />
          </Form.Item>
        </Card>
      ) : null}
    </>
  );
};

const CoverAndSiteFields = ({ controller }) => {
  const { selectedCoverImage, handleSelectCoverImage } = controller;

  return (
    <>
      <Divider orientation="left">圖片與廠區</Divider>
      <Form.Item label="活動圖片" required>
        <Form.Item name="cover_image_url" noStyle>
          <Input type="hidden" />
        </Form.Item>
        <fieldset className="admin-cover-choice">
          <legend className="sr-only">活動圖片</legend>
          {EVENT_IMAGES.map((src, idx) => (
            <button
              key={src}
              type="button"
              className={'admin-cover-option' + (selectedCoverImage === src ? ' is-selected' : '')}
              aria-label={`選擇活動圖片 ${idx + 1}`}
              aria-pressed={selectedCoverImage === src}
              onClick={() => handleSelectCoverImage(src)}
            >
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </fieldset>
      </Form.Item>
      <Form.Item name="allowed_sites" label="開放廠區" rules={[{ required: true, message: '請至少選擇一個開放廠區' }]}>
        <Checkbox.Group options={SITES} />
      </Form.Item>
    </>
  );
};

const SessionsFields = ({ controller }) => {
  const { createRegistrationMode, latestSessionEndLabel } = controller;

  return (
    <>
      <Divider style={{ marginTop: 6 }}>場次設定</Divider>

      <Form.List name="sessions">
        {(fields, { add, remove }) => (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {fields.map((field, idx) => {
              const { key, ...fieldProps } = field;
              return (
                <Card
                  key={key}
                  type="inner"
                  title={'場次 ' + (idx + 1)}
                  extra={fields.length > 1 ? <Button danger onClick={() => remove(field.name)}>刪除</Button> : null}
                >
                  <Row gutter={12}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        {...fieldProps}
                        name={[field.name, 'title']}
                        label="場次名稱"
                        rules={[{ required: true, message: '請填寫場次名稱' }]}
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={16}>
                      <Form.Item
                        {...fieldProps}
                        name={[field.name, 'venue']}
                        label="場次地點"
                        rules={[{ required: true, message: '請填寫場次地點' }]}
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
                            label="成人票數量（本場次）"
                            rules={[{ required: true, message: '請輸入成人票數量' }]}
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
                            label="是否需要兒童票（本場次）"
                            valuePropName="checked"
                          >
                            <Checkbox>需要兒童票</Checkbox>
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
                                  label="兒童票數量（本場次）"
                                  rules={[{ required: true, message: '請輸入兒童票數量' }]}
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
                        label="開始時間"
                        rules={[{ required: true, message: '請選擇開始時間' }]}
                      >
                        <DatePicker showTime style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item
                        {...fieldProps}
                        name={[field.name, 'ends_at']}
                        label="結束時間"
                        dependencies={[['sessions', field.name, 'starts_at']]}
                        rules={[
                          { required: true, message: '請選擇結束時間' },
                          ({ getFieldValue }) => ({
                            validator(_, value) {
                              const start = getFieldValue(['sessions', field.name, 'starts_at']);
                              if (!start || !value) return Promise.resolve();
                              const a = dayjs(start);
                              const b = dayjs(value);
                              if (!a.isValid() || !b.isValid()) return Promise.resolve();
                              if (b.isAfter(a)) return Promise.resolve();
                              return Promise.reject(new Error('結束時間必須晚於開始時間'));
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
                新增場次
              </Button>
              <div className="admin-session-summary" aria-live="polite">
                <span className="admin-session-summary-label">活動結束</span>
                <span className="admin-session-summary-note">取所有場次最晚結束</span>
                <strong>{latestSessionEndLabel}</strong>
              </div>
            </Space>
          </Space>
        )}
      </Form.List>
    </>
  );
};

const RegistrationTimelineFields = ({ createRegistrationMode }) => (
  <>
    <Divider orientation="left">報名時間</Divider>
    <Row gutter={12}>
      <Col xs={24} md={createRegistrationMode === 'LIMITED' ? 8 : 12}>
        <Form.Item name="registration_opens_at" label="報名開放時間（所有場次共用）" rules={[{ required: true, message: '請選擇報名開放時間' }]}>
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
      </Col>
      <Col xs={24} md={createRegistrationMode === 'LIMITED' ? 8 : 12}>
        <Form.Item name="registration_closes_at" label="報名截止時間（所有場次共用）" rules={[{ required: true, message: '請選擇報名截止時間' }]}>
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
      </Col>
      {createRegistrationMode === 'LIMITED' ? (
        <Col xs={24} md={8}>
          <Form.Item
            name="waitlist_close_at"
            label="候補截止時間（所有場次共用）"
            rules={[{ required: true, message: '請選擇候補截止時間' }]}
          >
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      ) : null}
    </Row>
  </>
);

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
              發佈
            </Button>
            <Button onClick={() => updateEvent(false)} loading={creating} disabled={!isAdminFull}>
              儲存成草稿
            </Button>
            <Button
              className="admin-create-cancel"
              onClick={() => {
                resetEditMode();
                setActiveTabKey('dashboard');
              }}
            >
              取消編輯
            </Button>
          </>
        ) : (
          <>
            <Button type="primary" onClick={handleCreate} loading={creating} disabled={!isAdminFull}>發佈</Button>
            <Button onClick={handleCreateDraft} loading={creating} disabled={!isAdminFull}>儲存成草稿</Button>
            <Button className="admin-create-cancel" onClick={resetCreateFormToDefaults}>取消編輯</Button>
          </>
        )}
      </div>
    </>
  );
};

const DraftsTab = ({ controller }) => {
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
          <Text className="admin-dashboard-section-label">草稿活動</Text>
          <Title level={4}>未發布活動管理</Title>
          <Paragraph type="secondary">
            載入草稿後可回到表單修改欄位，再儲存或發佈。
          </Paragraph>
        </div>
      </div>
      <Table
        rowKey="id"
        dataSource={draftEvents}
        pagination={false}
        locale={{ emptyText: '目前沒有草稿活動' }}
        columns={[
          {
            title: '活動名稱',
            dataIndex: 'title',
            key: 'title',
            render: (title, record) => (
              <Space direction="vertical" size={2}>
                <Text strong>{title}</Text>
                <Text type="secondary">
                  {record.allowed_sites?.length ? record.allowed_sites.join(', ') : '全廠區'}
                </Text>
              </Space>
            )
          },
          {
            title: '狀態',
            dataIndex: 'status',
            key: 'status',
            render: (status) => <Tag>{labelOr(EVENT_STATUS_LABELS, status, status)}</Tag>
          },
          {
            title: '建立時間',
            dataIndex: 'created_at',
            key: 'created_at',
            render: (value) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-')
          },
          {
            title: '操作',
            key: 'action',
            render: (_, record) => (
              <Space wrap>
                <Button
                  loading={editLoading && editingEventId === record.id}
                  disabled={!isAdminFull || deletingDraftId === record.id || publishingDraftId === record.id}
                  onClick={() => enterEditMode(record.id)}
                >
                  載入編輯
                </Button>
                <Button
                  type="primary"
                  loading={publishingDraftId === record.id}
                  disabled={!isAdminFull || editLoading || deletingDraftId === record.id}
                  onClick={() => handlePublishDraft(record)}
                >
                  立即發佈
                </Button>
                <Button
                  danger
                  loading={deletingDraftId === record.id}
                  disabled={!isAdminFull || editLoading || publishingDraftId === record.id}
                  onClick={() => handleDeleteDraft(record)}
                >
                  刪除
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
            <Text className="admin-dashboard-section-label">儀表板活動</Text>
            <div className="admin-dashboard-select-row">
              <Select
                className="admin-event-select"
                placeholder="搜尋並選擇活動"
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
              <Text className="admin-dashboard-section-label">活動管理</Text>
              <Space wrap className="admin-dashboard-actions">
                <Button type="primary" onClick={handlePublish} loading={publishing} disabled={!isAdminFull || !selectedEvent || selectedEvent.status !== 'DRAFT'}>
                  發布活動
                </Button>
                <Button onClick={() => enterEditMode(selectedEventId)} loading={editLoading} disabled={!isAdminFull || !selectedEvent}>
                  編輯活動
                </Button>
                <Button danger onClick={handleCancel} loading={cancelling} disabled={!isAdminFull || !selectedEvent}>
                  刪除活動
                </Button>
              </Space>
            </div>
            <div className="admin-dashboard-action-block">
              <Text className="admin-dashboard-section-label">抽籤與報表</Text>
              <Space wrap className="admin-dashboard-actions">
                <Button
                  type="primary"
                  onClick={runInstantLotteryForSelectedEvent}
                  loading={autoLotteryRunning}
                  disabled={!isAdminFull || !selectedEventId}
                >
                  即時抽籤
                </Button>
                <Button onClick={handleExportSync} loading={exportingSync} disabled={!selectedEventId}>
                  匯出 CSV
                </Button>
              </Space>
            </div>
          </section>
        </div>
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="已報名" value={registeredTotal} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="已確認" value={dashboard?.attendance?.total_confirmed || 0} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="已入場" value={dashboard?.attendance?.checked_in || 0} />
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

      <Card style={{ marginTop: 16 }} title="報名清單">
        <Table
          rowKey="id"
          dataSource={registrations}
          scroll={{ x: 860 }}
          columns={[
            { title: '員工編號', dataIndex: ['user', 'employee_id'] },
            { title: '姓名', dataIndex: ['user', 'name'] },
            { title: '部門', dataIndex: ['user', 'department'] },
            { title: '場次', dataIndex: 'session_title' },
            { title: '票種', dataIndex: 'ticket_type_name' },
            {
              title: '狀態',
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

      <Card style={{ marginTop: 16 }} title="抽籤執行（依場次）">
        <Table
          rowKey="session_id"
          pagination={false}
          dataSource={dashboard?.sessions_lottery || []}
          scroll={{ x: 760 }}
          columns={[
            { title: '場次', dataIndex: 'title' },
            { title: '抽籤時間', dataIndex: 'lottery_at' },
            {
              title: '狀態',
              key: 'st',
              render: (_, row) =>
                row.lottery_executed_at ? (
                  <Tag color="green">已執行 ({row.lottery_executed_at})</Tag>
                ) : (
                  <Tag color="orange">待執行</Tag>
                )
            },
            {
              title: '待抽籤人數（已報名）',
              dataIndex: 'registered_pending',
              render: (v) => (v == null ? '—' : v)
            },
            {
              title: '操作',
              key: 'act',
              render: (_, row) => (
                <Button
                  type="primary"
                  disabled={!isAdminFull || !!row.lottery_executed_at || !selectedEventId}
                  onClick={() => handleRunLottery(row.session_id, row.title)}
                >
                  執行抽籤
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
