import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from 'antd';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, Legend } from 'recharts';
import { EVENT_IMAGES } from '../assets/media';
import dayjs from 'dayjs';
import { useNotifications } from '../context/NotificationContext';
import { EVENT_STATUS_LABELS, REGISTRATION_STATUS_LABELS, labelOr } from '../utils/labels';
import '../styles/AdminConsole.css';

const { Title, Paragraph, Text } = Typography;

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
  title: '上午場',
  venue: '新竹園區戶外廣場',
  starts_at: '2026-06-15T09:00:00+08:00',
  ends_at: '2026-06-15T12:00:00+08:00',
  registration_opens_at: '2026-05-01T00:00:00+08:00',
  registration_closes_at: '2026-06-01T23:59:59+08:00',
  lottery_at: '2026-06-02T10:00:00+08:00',
  waitlist_close_at: '2026-06-10T23:59:59+08:00',
  confirmation_deadline_hours: 48,
  ticket_types: [
    { name: '成人票', quota: 200, sort_order: 0 },
    { name: '兒童票', quota: 100, sort_order: 1 }
  ]
};
const PIE_COLORS = ['#2b72d9', '#2a9d8f', '#f4a261', '#9b5de5', '#f28482'];
const now = dayjs();

/** 儀表板 sessions_lottery 列（後端欄位可能用 id 或別名） */
const normalizeSessionsLotteryRows = (raw) => {
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw
    .map((row) => ({
      session_id: row.session_id || row.id,
      title: row.title,
      lottery_at: row.lottery_at,
      lottery_executed_at: row.lottery_executed_at ?? null,
      registered_pending:
        row.registered_pending ?? row.pending_registered_count ?? row.pending_count ?? undefined
    }))
    .filter((r) => r.session_id);
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
const NIGHTLY_LOTTERY_TIME = '03:00';
const defaultCreateValues = {
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
      starts_at: now.add(14, 'day'),
      ends_at: now.add(14, 'day').add(3, 'hour'),
      adult_quota: 120,
      require_child_ticket: true,
      child_quota: 80
    }
  ],
  allow_dependents: true,
  max_dependents_per_employee: 2,
  registration_closes_at: now.add(7, 'day'),
  registration_opens_at: now.subtract(1, 'day'),
  lottery_at: now.add(7, 'day').add(3, 'hour'),
  waitlist_close_at: now.add(10, 'day'),
  allowed_sites: ['HSINCHU']
};

const CETS_ELIGIBILITY_MARKER_PREFIX = '<!--CETS_ELIGIBILITY:';
const CETS_ELIGIBILITY_MARKER_SUFFIX = '-->';

const injectEligibilityMarker = (rawDescription, eligibility) => {
  const description = String(rawDescription || '');
  const encoded = encodeURIComponent(JSON.stringify(eligibility || {}));
  const marker = `${CETS_ELIGIBILITY_MARKER_PREFIX}${encoded}${CETS_ELIGIBILITY_MARKER_SUFFIX}`;
  const startIdx = description.indexOf(CETS_ELIGIBILITY_MARKER_PREFIX);
  if (startIdx >= 0) {
    const endIdx = description.indexOf(CETS_ELIGIBILITY_MARKER_SUFFIX, startIdx);
    if (endIdx >= 0) {
      return `${description.slice(0, startIdx).trimEnd()}\n\n${marker}`;
    }
  }
  if (!encoded || encoded === '%7B%7D') {
    return description;
  }
  return `${description.trimEnd()}\n\n${marker}`.trim();
};

const parseEligibilityFromDescription = (rawDescription) => {
  const description = String(rawDescription || '');
  const startIdx = description.indexOf(CETS_ELIGIBILITY_MARKER_PREFIX);
  if (startIdx < 0) {
    return { cleanDescription: description, eligibility: null };
  }
  const endIdx = description.indexOf(CETS_ELIGIBILITY_MARKER_SUFFIX, startIdx);
  if (endIdx < 0) {
    return { cleanDescription: description, eligibility: null };
  }
  const encoded = description.slice(startIdx + CETS_ELIGIBILITY_MARKER_PREFIX.length, endIdx);
  const cleanDescription = `${description.slice(0, startIdx)}${description.slice(endIdx + CETS_ELIGIBILITY_MARKER_SUFFIX.length)}`
    .trim();
  try {
    const eligibility = JSON.parse(decodeURIComponent(encoded));
    return { cleanDescription, eligibility };
  } catch {
    return { cleanDescription, eligibility: null };
  }
};

const buildEligibilityFromFormValues = (values) => {
  const adultUnlimited = !Boolean(values.adult_has_limits);
  const childUnlimited = !Boolean(values.child_has_limits);
  const requireChildTicket = Boolean(values.require_child_ticket);

  const adultOther = String(values.adult_other_restrictions || '').trim();
  const adult = {
    unlimited: adultUnlimited,
    gender: values.adult_gender || 'ANY',
    height_min_cm: values.adult_height_min_cm ?? null,
    height_max_cm: values.adult_height_max_cm ?? null,
    age_min: values.adult_age_min ?? null,
    age_max: values.adult_age_max ?? null,
    health: {
      unlimited: Boolean(values.adult_health_unlimited),
      no_diseases: Array.isArray(values.adult_health_no_diseases) ? values.adult_health_no_diseases : []
    },
    ...(adultOther ? { other_restrictions: adultOther } : {})
  };

  const childOther = String(values.child_other_restrictions || '').trim();
  const child = {
    unlimited: childUnlimited,
    age_min: values.child_age_min ?? null,
    age_max: values.child_age_max ?? null,
    health: {
      unlimited: Boolean(values.child_health_unlimited),
      no_diseases: Array.isArray(values.child_health_no_diseases) ? values.child_health_no_diseases : []
    },
    ...(requireChildTicket && childOther ? { other_restrictions: childOther } : {})
  };

  return {
    version: 1,
    require_child_ticket: requireChildTicket,
    adult,
    child: requireChildTicket ? child : { ...child, unlimited: true, health: { unlimited: true, no_diseases: [] } }
  };
};

const resolveAnyRequireChildTicket = (values) => {
  if (values?.require_child_ticket !== undefined && values?.require_child_ticket !== null) {
    return Boolean(values.require_child_ticket);
  }
  const sessions = Array.isArray(values?.sessions) ? values.sessions : [];
  return sessions.some((s) => Boolean(s?.require_child_ticket));
};

const AdminConsolePage = () => {
  const { user } = useAuth();
  const { refreshList } = useNotifications();
  const isAdminFull = user?.role === 'ADMIN';
  const isAdminViewer = user?.role === 'ADMIN_VIEWER';
  const [events, setEvents] = useState([]);
  const [localDraftEvents, setLocalDraftEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [exportingSync, setExportingSync] = useState(false);
  const [siteCount, setSiteCount] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState('event-create');
  const [editingEventId, setEditingEventId] = useState('');
  const [autoLotteryEnabled, setAutoLotteryEnabled] = useState(true);
  const [autoLotteryRunning, setAutoLotteryRunning] = useState(false);
  const [autoLotteryStatus, setAutoLotteryStatus] = useState('待命中');
  const [autoLotteryLastRunAt, setAutoLotteryLastRunAt] = useState('');
  const [nightlyScheduleEnabled, setNightlyScheduleEnabled] = useState(() => localStorage.getItem('cets_nightly_enabled') === '1');
  const [nightlyRunning, setNightlyRunning] = useState(false);
  const [nightlyStatus, setNightlyStatus] = useState('未啟用');
  const [nightlyLastRunDate, setNightlyLastRunDate] = useState(() => localStorage.getItem('cets_nightly_last_date') || '');
  const [createForm] = Form.useForm();
  const selectedCreateCover = Form.useWatch('cover_image_url', createForm);
  const createRegistrationMode = Form.useWatch('registration_mode', createForm) || 'LIMITED';
  const watchedSessions = Form.useWatch('sessions', createForm) || [];
  const latestSessionEndLabel = useMemo(() => {
    const ends = (watchedSessions || []).map((s) => s?.ends_at).filter(Boolean);
    const max = ends.reduce((m, cur) => {
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
        .map((d) => (typeof d?.msg === 'string' ? d.msg : JSON.stringify(d)))
        .filter(Boolean)
        .join('；');
      if (joined) return joined;
    }
    if (error?.message) return error.message;
    if (error?.httpStatus === 404) return '後端找不到此 API（HTTP 404），可能尚未實作排程抽籤端點';
    return fallback;
  };
  const getEventId = (eventLike) => eventLike?.data?.id || eventLike?.data?.event_id || eventLike?.id || eventLike?.event_id || '';
  const getSessionId = (sessionLike) => sessionLike?.data?.id || sessionLike?.data?.session_id || sessionLike?.id || sessionLike?.session_id || '';
  const selectCreateCover = useCallback((img) => {
    createForm.setFieldValue('cover_image_url', img);
  }, [createForm]);

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
    const startsAtValue = sessions
      .map((s) => s?.starts_at)
      .filter(Boolean)
      .reduce((min, cur) => {
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

  const loadEvents = async (draftsOverride) => {
    const drafts = draftsOverride || localDraftEvents;
    const res = await apiClient.getEvents({ scope: 'all', page: 1, page_size: 50 });
    const fetchedItems = res.data.items || [];
    const merged = [...fetchedItems];
    drafts.forEach((draft) => {
      if (!merged.find((e) => e.id === draft.id)) {
        merged.unshift(draft);
      }
    });
    setEvents(merged);
    if (!selectedEventId && merged.length) {
      setSelectedEventId(merged[0].id);
    }
  };

  const loadDashboard = async (eventId) => {
    if (!eventId) return;
    const [dashboardRes, regRes, eventRes] = await Promise.all([
      apiClient.adminGetDashboard(eventId).catch(() => ({ data: {} })),
      apiClient
        .adminGetRegistrations(eventId, { page: 1, page_size: 20, mask_pii: true })
        .catch(() => ({ data: { items: [] } })),
      apiClient.getEvent(eventId).catch(() => ({ data: null }))
    ]);
    const dash = dashboardRes.data || {};
    const eventData = eventRes?.data ?? null;
    const sessionsLottery = mergeDashboardSessionsLottery(dash, eventData);
    setDashboard({ ...dash, sessions_lottery: sessionsLottery });
    setRegistrations(regRes.data?.items || []);
  };

  useEffect(() => {
    setLoading(true);
    loadEvents().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadDashboard(selectedEventId).catch(() => {});
  }, [selectedEventId]);

  const buildCreatePayload = (values) => {
    const requireChildTicketAny = resolveAnyRequireChildTicket(values);
    const registrationMode = values.registration_mode || 'LIMITED';
    const registrationClosesAt = values.registration_closes_at || now.add(7, 'day');
    const isUnlimited = registrationMode === 'UNLIMITED';
    const lotteryAt = isUnlimited ? dayjs(registrationClosesAt).add(1, 'minute') : resolveLimitedLotteryAt(registrationClosesAt);
    const sessionsInput = Array.isArray(values.sessions) && values.sessions.length ? values.sessions : defaultCreateValues.sessions;
    const startsAtForWaitlist = sessionsInput?.[0]?.starts_at || now.add(14, 'day');
    const waitlistCloseAt = isUnlimited
      ? dayjs(startsAtForWaitlist).subtract(1, 'minute')
      : resolveLimitedWaitlistCloseAt(values, startsAtForWaitlist);
    const allowDependents = Boolean(values.allow_dependents);
    const maxDependents = allowDependents ? Number(values.max_dependents_per_employee || 0) : 0;
    const sessions = (sessionsInput || []).map((s, idx) => {
      const starts = dayjs(s?.starts_at || now.add(14, 'day'));
      const ends = dayjs(s?.ends_at || starts.add(3, 'hour'));
      const closes = dayjs(registrationClosesAt);
      const opens = dayjs(values.registration_opens_at || defaultSession.registration_opens_at);
      const lottery = dayjs(lotteryAt);
      const waitlist = dayjs(waitlistCloseAt);
      const adultQuota = Math.max(0, Number(s?.adult_quota || 0));
      const requireChildTicket = Boolean(s?.require_child_ticket);
      const childQuota = requireChildTicket ? Math.max(0, Number(s?.child_quota || 0)) : 0;
      const totalQuota = isUnlimited ? 999999 : adultQuota + childQuota;
      const ticketTypes = isUnlimited
        ? [{ name: '一般票（不限額）', quota: totalQuota, sort_order: 0 }]
        : requireChildTicket
          ? [
            { name: '成人票', quota: adultQuota, sort_order: 0 },
            { name: '兒童票', quota: childQuota, sort_order: 1 }
          ]
          : [{ name: '成人票', quota: adultQuota, sort_order: 0 }];
      return {
        ...defaultSession,
        title: s?.title || `第 ${idx + 1} 場`,
        venue: s?.venue || defaultSession.venue,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        registration_opens_at: opens.toISOString(),
        registration_closes_at: closes.toISOString(),
        lottery_at: lottery.toISOString(),
        waitlist_close_at: waitlist.toISOString(),
        allow_dependents: allowDependents,
        max_dependents_per_employee: maxDependents,
        ticket_types: ticketTypes
      };
    });

    return {
      title: values.title,
      description: injectEligibilityMarker(
        values.description || '',
        buildEligibilityFromFormValues({ ...values, require_child_ticket: requireChildTicketAny })
      ),
      cover_image_url: values.cover_image_url,
      allowed_sites: values.allowed_sites || [],
      allow_dependents: allowDependents,
      max_dependents_per_employee: maxDependents,
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
      const created = await apiClient.adminCreateEvent(payload);
      const createdEventId = getEventId(created);
      const createdEvent = created?.data?.id ? created.data : null;
      if (!createdEventId) {
        throw new Error('後端未回傳新活動 ID，請稍後在儀表板確認是否已建立');
      }
      // 相容兩種後端：
      // 1) 建活動時就會把 sessions/ticket_types 一起建立
      // 2) 只建 event(DRAFT)，需再呼叫 /admin/events/{id}/sessions 與 /admin/sessions/{id}/ticket-types
      if ((createdEvent?.sessions?.length || 0) === 0) {
        for (const sessionPayload of payload.sessions || []) {
          const { ticket_types: ticketTypes, ...sessionBody } = sessionPayload;
          const createdSession = await apiClient.adminCreateSession(createdEventId, sessionBody);
          const createdSessionId = getSessionId(createdSession);
          if (!createdSessionId) {
            throw new Error('建立場次成功但未取得 session_id，請稍後重新整理後檢查');
          }
          for (const tt of ticketTypes || []) {
            await apiClient.adminCreateTicketType(createdSessionId, tt);
          }
        }
      }
      let nextDrafts = localDraftEvents;
      if (createdEvent?.status === 'DRAFT') {
        nextDrafts = [createdEvent, ...localDraftEvents.filter((e) => e.id !== createdEvent.id)];
        setLocalDraftEvents(nextDrafts);
      }
      if (publishAfterCreate) {
        try {
          await apiClient.adminPublishEvent(createdEventId);
          setLocalDraftEvents((prev) => prev.filter((e) => e.id !== createdEventId));
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
      createForm.resetFields();
      await loadEvents(nextDrafts);
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

  const resetEditMode = () => {
    setEditingEventId('');
    setSiteCount(null);
    createForm.resetFields();
  };

  const buildEditInitialValues = (detail) => {
    const sessions = Array.isArray(detail?.sessions) ? detail.sessions : [];
    const firstSession = sessions[0] || {};
    const ticketTypes = Array.isArray(firstSession?.ticket_types) ? firstSession.ticket_types : [];
    const adultTicket = ticketTypes.find((t) => String(t?.name || '').includes('成人')) || ticketTypes[0] || {};
    const childTicket = ticketTypes.find((t) => String(t?.name || '').includes('兒童')) || null;
    const { cleanDescription, eligibility } = parseEligibilityFromDescription(detail?.description || '');
    const adultEligibility = eligibility?.adult || {};
    const childEligibility = eligibility?.child || {};
    const isUnlimitedMode = String(detail?.registration_mode || '').toUpperCase() === 'UNLIMITED'
      || String(adultTicket?.name || '').includes('不限');

    return {
      ...defaultCreateValues,
      title: detail?.title || '',
      description: cleanDescription || '',
      cover_image_url: detail?.cover_image_url || EVENT_IMAGES[0],
      registration_mode: isUnlimitedMode ? 'UNLIMITED' : 'LIMITED',
      adult_quota: Number(adultTicket?.quota || 0),
      require_child_ticket: Boolean(childTicket),
      child_quota: Number(childTicket?.quota || 0),
      adult_has_limits: !Boolean(adultEligibility?.unlimited ?? true),
      adult_gender: adultEligibility?.gender || 'ANY',
      adult_height_min_cm: adultEligibility?.height_min_cm ?? null,
      adult_height_max_cm: adultEligibility?.height_max_cm ?? null,
      adult_age_min: adultEligibility?.age_min ?? null,
      adult_age_max: adultEligibility?.age_max ?? null,
      adult_health_unlimited: Boolean(adultEligibility?.health?.unlimited ?? true),
      adult_health_no_diseases: Array.isArray(adultEligibility?.health?.no_diseases) ? adultEligibility.health.no_diseases : [],
      child_has_limits: !Boolean(childEligibility?.unlimited ?? true),
      child_age_min: childEligibility?.age_min ?? null,
      child_age_max: childEligibility?.age_max ?? null,
      child_health_unlimited: Boolean(childEligibility?.health?.unlimited ?? true),
      child_health_no_diseases: Array.isArray(childEligibility?.health?.no_diseases) ? childEligibility.health.no_diseases : [],
      adult_other_restrictions: adultEligibility?.other_restrictions || '',
      child_other_restrictions: childEligibility?.other_restrictions || '',
      session_count: Math.max(1, sessions.length || detail?.session_count || 1),
      sessions: sessions.length
        ? sessions.map((s, idx) => ({
          title: s?.title || `第 ${idx + 1} 場`,
          venue: s?.venue || defaultSession.venue,
          starts_at: s?.starts_at ? dayjs(s.starts_at) : now.add(14, 'day'),
          ends_at: s?.ends_at ? dayjs(s.ends_at) : now.add(14, 'day').add(3, 'hour')
        }))
        : defaultCreateValues.sessions,
      allow_dependents: Boolean(firstSession?.allow_dependents ?? detail?.allow_dependents),
      max_dependents_per_employee: Number(
        firstSession?.max_dependents_per_employee
        ?? detail?.max_dependents_per_employee
        ?? defaultCreateValues.max_dependents_per_employee
      ),
      registration_closes_at: firstSession?.registration_closes_at ? dayjs(firstSession.registration_closes_at) : defaultCreateValues.registration_closes_at,
      registration_opens_at: firstSession?.registration_opens_at ? dayjs(firstSession.registration_opens_at) : defaultCreateValues.registration_opens_at,
      waitlist_close_at: firstSession?.waitlist_close_at ? dayjs(firstSession.waitlist_close_at) : defaultCreateValues.waitlist_close_at,
      lottery_at: firstSession?.lottery_at ? dayjs(firstSession.lottery_at) : defaultCreateValues.lottery_at,
      allowed_sites: detail?.allowed_sites || []
    };
  };

  const enterEditMode = async (eventId) => {
    if (!eventId) return;
    setEditLoading(true);
    try {
      const res = await apiClient.getEvent(eventId);
      const detail = res.data || {};
      createForm.setFieldsValue(buildEditInitialValues(detail));
      setEditingEventId(eventId);
      setSelectedEventId(eventId);
      setActiveTabKey('event-create');
      handleSitePreview(detail?.allowed_sites || []).catch(() => {});
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
      setLocalDraftEvents((prev) => prev.filter((e) => e.id !== selectedEventId));
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
      const requireChildTicketAny = resolveAnyRequireChildTicket(values);
      const payload = status === 'PUBLISHED'
        ? {
          title: values.title,
          description: injectEligibilityMarker(
            values.description || '',
            buildEligibilityFromFormValues({ ...values, require_child_ticket: requireChildTicketAny })
          ),
          cover_image_url: values.cover_image_url || null
        }
        : buildCreatePayload(values);
      await apiClient.adminPatchEvent(editingEventId, payload);
      if (publishAfterSave) {
        await apiClient.adminPublishEvent(editingEventId);
        setLocalDraftEvents((prev) => prev.filter((e) => e.id !== editingEventId));
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

  const handleSitePreview = async (sites) => {
    if (!sites?.length) {
      setSiteCount(null);
      return;
    }
    const res = await apiClient.adminGetSiteEmployeeCount(sites);
    setSiteCount(res.data);
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
          const res = await apiClient.adminRunLottery(selectedEventId, sessionId);
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
        setAutoLotteryStatus(`即時抽籤執行中（${pending.length} 場）...`);
        let successCount = 0;
        try {
          for (const row of pending) {
            await apiClient.adminRunLottery(selectedEventId, row.session_id);
            successCount += 1;
          }
          setAutoLotteryLastRunAt(dayjs().format('YYYY-MM-DD HH:mm:ss'));
          setAutoLotteryStatus(`即時抽籤完成：${successCount}/${pending.length}`);
          message.success(`即時抽籤完成：${successCount}/${pending.length}`);
          await loadDashboard(selectedEventId);
        } catch (e) {
          setAutoLotteryStatus(`即時抽籤失敗：${getErrorMessage(e, '請稍後重試')}`);
          message.error(getErrorMessage(e, '即時抽籤失敗'));
          throw e;
        } finally {
          setAutoLotteryRunning(false);
        }
      }
    });
  };

  const runDueLotteries = useCallback(async ({ silent = true } = {}) => {
    if (!isAdminFull || !selectedEventId) return;
    const sessions = dashboard?.sessions_lottery || [];
    const nowAt = dayjs();
    const dueSessions = sessions.filter((row) => {
      if (row?.lottery_executed_at) return false;
      if (!row?.lottery_at) return false;
      const lotteryAt = dayjs(row.lottery_at);
      if (!lotteryAt.isValid()) return false;
      return nowAt.isAfter(lotteryAt) || nowAt.isSame(lotteryAt);
    });
    if (!dueSessions.length) {
      if (!silent) {
        setAutoLotteryStatus('目前沒有到點且未執行的場次');
      }
      return;
    }
    setAutoLotteryRunning(true);
    setAutoLotteryStatus(`偵測到 ${dueSessions.length} 個到點場次，執行中...`);
    let successCount = 0;
    try {
      for (const row of dueSessions) {
        await apiClient.adminRunLottery(selectedEventId, row.session_id);
        successCount += 1;
      }
      setAutoLotteryLastRunAt(dayjs().format('YYYY-MM-DD HH:mm:ss'));
      setAutoLotteryStatus(`自動抽籤已完成：${successCount}/${dueSessions.length}`);
      await loadDashboard(selectedEventId);
      if (!silent) {
        message.success(`自動抽籤完成：${successCount}/${dueSessions.length}`);
      }
    } catch (error) {
      setAutoLotteryStatus(`自動抽籤失敗：${getErrorMessage(error, '請稍後重試')}`);
      if (!silent) {
        message.error(getErrorMessage(error, '自動抽籤失敗'));
      }
    } finally {
      setAutoLotteryRunning(false);
    }
  }, [dashboard, isAdminFull, selectedEventId]);

  useEffect(() => {
    if (!autoLotteryEnabled || !isAdminFull || !selectedEventId) {
      return undefined;
    }
    runDueLotteries({ silent: true });
    const timerId = globalThis.setInterval(() => {
      runDueLotteries({ silent: true });
    }, 30000);
    return () => {
      globalThis.clearInterval(timerId);
    };
  }, [autoLotteryEnabled, isAdminFull, selectedEventId, runDueLotteries]);

  useEffect(() => {
    localStorage.setItem('cets_nightly_enabled', nightlyScheduleEnabled ? '1' : '0');
  }, [nightlyScheduleEnabled]);

  useEffect(() => {
    if (nightlyLastRunDate) {
      localStorage.setItem('cets_nightly_last_date', nightlyLastRunDate);
    }
  }, [nightlyLastRunDate]);

  const runNightlyLotteryNow = useCallback(async ({ silent = true } = {}) => {
    if (!isAdminFull) return;
    setNightlyRunning(true);
    setNightlyStatus('排程抽籤執行中...');
    const runFallbackPendingForSelectedEvent = async () => {
      const rows = dashboard?.sessions_lottery || [];
      const pending = rows.filter((r) => r?.session_id && !r?.lottery_executed_at);
      if (!pending.length) {
        throw new Error('NO_PENDING');
      }
      let successCount = 0;
      for (const row of pending) {
        await apiClient.adminRunLottery(selectedEventId, row.session_id);
        successCount += 1;
      }
      return successCount;
    };
    try {
      const res = await apiClient.adminRunNightlyLottery();
      const executed = res?.data?.executed_sessions ?? res?.data?.processed_sessions ?? '未知';
      setNightlyStatus(`排程抽籤完成，執行場次：${executed}`);
      setAutoLotteryLastRunAt(dayjs().format('YYYY-MM-DD HH:mm:ss'));
      if (!silent) {
        message.success(`排程抽籤完成，執行場次：${executed}`);
      }
      if (selectedEventId) {
        await loadDashboard(selectedEventId);
      }
    } catch (error) {
      const httpStatus = error?.httpStatus;
      const detailStr = typeof error?.detail === 'string' ? error.detail : '';
      const useClientFallback =
        selectedEventId &&
        (httpStatus === 404 ||
          httpStatus === 405 ||
          /not found/i.test(detailStr) ||
          /無此路由|不存在/i.test(getErrorMessage(error, '')));

      if (useClientFallback) {
        try {
          const n = await runFallbackPendingForSelectedEvent();
          setNightlyStatus(`後端未提供全站排程抽籤 API，已改為對「目前選定活動」${n} 個未抽籤場次完成抽籤`);
          setNightlyLastRunDate(dayjs().format('YYYY-MM-DD'));
          setAutoLotteryLastRunAt(dayjs().format('YYYY-MM-DD HH:mm:ss'));
          if (!silent) {
            message.success(`已對本活動 ${n} 個場次執行抽籤（後備模式）`);
          }
          await loadDashboard(selectedEventId);
        } catch (inner) {
          if (inner?.message === 'NO_PENDING') {
            setNightlyStatus(
              `排程抽籤 API 不可用，且目前活動沒有「尚未抽籤」的場次（請確認已選活動，或改用上方「立即檢查並執行」）`
            );
            if (!silent) {
              message.warning('沒有可抽籤的場次');
            }
          } else {
            setNightlyStatus(`排程抽籤失敗：${getErrorMessage(error, '請稍後重試')}；後備抽籤亦失敗：${getErrorMessage(inner, '請稍後重試')}`);
            if (!silent) {
              message.error(getErrorMessage(inner, '抽籤失敗'));
            }
          }
        }
      } else {
        setNightlyStatus(`排程抽籤失敗：${getErrorMessage(error, '請稍後重試')}`);
        if (!silent) {
          message.error(getErrorMessage(error, '排程抽籤失敗'));
        }
      }
    } finally {
      setNightlyRunning(false);
    }
  }, [isAdminFull, selectedEventId, dashboard?.sessions_lottery]);

  useEffect(() => {
    if (!nightlyScheduleEnabled || !isAdminFull) {
      return undefined;
    }
    const schedulerId = globalThis.setInterval(() => {
      if (nightlyRunning) return;
      const nowAt = dayjs();
      const currentTime = nowAt.format('HH:mm');
      const today = nowAt.format('YYYY-MM-DD');
      if (currentTime === NIGHTLY_LOTTERY_TIME && nightlyLastRunDate !== today) {
        setNightlyLastRunDate(today);
        runNightlyLotteryNow({ silent: true });
      }
    }, 30000);
    return () => {
      globalThis.clearInterval(schedulerId);
    };
  }, [nightlyScheduleEnabled, nightlyLastRunDate, nightlyRunning, isAdminFull, runNightlyLotteryNow]);

  return (
    <div className="page-wrap admin-console-page">
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

      <Tabs
        activeKey={activeTabKey}
        onChange={setActiveTabKey}
        className="admin-console-tabs"
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'event-create',
            label: isEditing ? '編輯活動' : '建立活動',
            children: (
              <Card className="admin-create-card">
                <Form form={createForm} layout="vertical" initialValues={defaultCreateValues} className="admin-create-form">
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
                  {createRegistrationMode === 'LIMITED' ? (
                    <>
                      <Divider style={{ marginTop: 6 }}>報名資格限制（顯示給員工確認）</Divider>

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
                          extra="會逐行顯示在員工報名視窗；可不勾選「有限制」僅填寫本欄。"
                        >
                          <Input.TextArea rows={2} placeholder={'每行一則，例：須穿著防滑鞋\n禁止攜帶寵物'} />
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
                            extra="會逐行顯示在員工報名兒童票時的注意事項。"
                          >
                            <Input.TextArea rows={2} placeholder="每行一則補充說明" />
                          </Form.Item>
                        </Card>
                      ) : null}
                    </>
                  ) : (
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 16 }}
                      message="無人數限制模式"
                      description="使用者報名後不受名額限制。因後端 API 目前仍要求抽籤/候補欄位，前端會自動填入系統時間參數，你不需要手動填寫。"
                    />
                  )}
                  <Divider orientation="left">圖片與廠區</Divider>
                  <Form.Item
                    name="cover_image_url"
                    label="快速套用活動圖"
                    rules={[{ required: true, message: '請先選擇活動圖片' }]}
                  >
                    <Space wrap>
                      {EVENT_IMAGES.map((img) => (
                        <button
                          key={img}
                          type="button"
                          className={`admin-cover-choice${selectedCreateCover === img ? ' selected' : ''}`}
                          aria-pressed={selectedCreateCover === img}
                          onClick={() => selectCreateCover(img)}
                        >
                          <img
                            src={img}
                            alt="cover candidate"
                            loading="lazy"
                            decoding="async"
                          />
                        </button>
                      ))}
                    </Space>
                  </Form.Item>
                  <Form.Item name="allowed_sites" label="開放廠區" rules={[{ required: true, message: '請至少選擇一個開放廠區' }]}>
                    <Checkbox.Group options={SITES} onChange={handleSitePreview} />
                  </Form.Item>
                  <Divider style={{ marginTop: 6 }}>場次設定（每一場需填地點、開始與結束）</Divider>

                  <Form.List name="sessions">
                    {(fields, { add, remove }) => (
                      <Space direction="vertical" style={{ width: '100%' }} size={12}>
                        {fields.map((field, idx) => {
                          const { key, ...fieldProps } = field;
                          return (
                            <Card
                              key={key}
                              type="inner"
                              title={`場次 ${idx + 1}`}
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
                                    <Input placeholder={`例如：第 ${idx + 1} 場`} />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={16}>
                                  <Form.Item
                                    {...fieldProps}
                                    name={[field.name, 'venue']}
                                    label="場次地點"
                                    rules={[{ required: true, message: '請填寫場次地點' }]}
                                  >
                                    <Input placeholder="例如：新竹園區戶外廣場" />
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
                              title: `第 ${fields.length + 1} 場`,
                              venue: defaultSession.venue,
                              starts_at: now.add(14, 'day'),
                              ends_at: now.add(14, 'day').add(3, 'hour'),
                              adult_quota: 120,
                              require_child_ticket: true,
                              child_quota: 80
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

                  <Row gutter={12} style={{ marginTop: 12 }}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="allow_dependents"
                        label="是否允許眷屬報名"
                        valuePropName="checked"
                      >
                        <Checkbox>允許員工攜眷屬</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="max_dependents_per_employee"
                        label="每位員工最多眷屬數"
                        rules={[{ required: true, message: '請設定眷屬上限' }]}
                      >
                        <InputNumber min={0} max={10} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>

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

                  {siteCount ? (
                    <Alert
                      type={siteCount.total > 0 ? 'info' : 'warning'}
                      showIcon
                      message={`勾選廠區員工總數（預覽）：${siteCount.total}`}
                      description={
                        siteCount.total > 0
                          ? Object.entries(siteCount.sites || {}).map(([site, count]) => `${SITE_LABELS[site] || site}：${count}`).join(' / ')
                          : '這只是開放廠區的人數預覽，不是必填條件；就算顯示 0 也不會擋建立活動。'
                      }
                    />
                  ) : null}

                  <Divider />
                  <Space wrap className="admin-create-actions">
                    {isEditing ? (
                      <>
                        <Button type="primary" onClick={() => updateEvent(false)} loading={creating} disabled={!isAdminFull}>
                          儲存活動
                        </Button>
                        <Button onClick={() => updateEvent(true)} loading={creating} disabled={!isAdminFull}>
                          儲存並直接發布
                        </Button>
                        <Button
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
                        <Button type="primary" onClick={handleCreate} loading={creating} disabled={!isAdminFull}>建立並發布活動</Button>
                        <Button onClick={handleCreateDraft} loading={creating} disabled={!isAdminFull}>只建立草稿</Button>
                        <Button onClick={() => createForm.resetFields()}>清除</Button>
                      </>
                    )}
                  </Space>
                </Form>
              </Card>
            )
          },
          {
            key: 'drafts',
            label: `草稿活動${draftEvents.length ? ` (${draftEvents.length})` : ''}`,
            children: (
              <Card className="admin-draft-card">
                <div className="admin-draft-header">
                  <div>
                    <Text className="admin-dashboard-section-label">草稿活動</Text>
                    <Title level={4}>未發布活動管理</Title>
                    <Paragraph type="secondary">
                      草稿活動會保留在這裡；載入後可回到表單修改欄位，再儲存或直接發布。
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
                        <Button
                          type="primary"
                          loading={editLoading && editingEventId === record.id}
                          disabled={!isAdminFull}
                          onClick={() => enterEditMode(record.id)}
                        >
                          載入編輯
                        </Button>
                      )
                    }
                  ]}
                />
              </Card>
            )
          },
          {
            key: 'dashboard',
            label: '儀表板',
            children: (
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
                          <Button onClick={() => enterEditMode(selectedEventId)} loading={editLoading} disabled={!selectedEvent}>
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
                      <Statistic title="已報名" value={dashboard?.ticket_type_progress?.reduce((sum, x) => sum + x.registered, 0) || 0} />
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

                <Row gutter={16} style={{ marginTop: 16 }}>
                  <Col xs={24} lg={12}>
                    <Card title="報名趨勢">
                      <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={dashboard?.registration_timeline || []}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="count" name="累積報名" stroke="#2b72d9" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card title="開放廠區分布（含名稱）">
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie data={(dashboard?.site_distribution || []).map((s) => ({ name: SITE_LABELS[s.site] || s.site, value: s.count }))} dataKey="value" nameKey="name" outerRadius={90} label>
                            {(dashboard?.site_distribution || []).map((entry, idx) => (
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
                    <BarChart data={dashboard?.ticket_type_progress || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="quota" name="名額" fill="#2b72d9" />
                      <Bar dataKey="registered" name="已報名" fill="#f4a261" />
                      <Bar dataKey="confirmed" name="已確認" fill="#2a9d8f" />
                    </BarChart>
                  </ResponsiveContainer>
                  <Table
                    pagination={false}
                    rowKey="ticket_type_id"
                    dataSource={dashboard?.ticket_type_progress || []}
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
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="後端／瀏覽器除錯重點"
                    description={
                      <span>
                        已用 <code>GET https://cets.alanh.uk/api/openapi.json</code> 比對：<strong>目前部署的規格書裡並未列出任何「執行抽籤」的 POST 路徑</strong>，
                        <code>{'PATCH /admin/sessions/{id}'}</code> 也僅支援改時間／提早關閉報名，文件寫<strong>「狀態由 lottery-runner／排程」</strong>驅動。
                        前端仍會呼叫 <code>/admin/events/…/sessions/…/lottery</code> 與 <code>/admin/sessions/…/lottery</code>，
                        兩者在線上環境會回<strong>404（畫面上的 Not Found／抽籤失敗）</strong>。
                        若同學已實作但路徑不同，請在 <code>.env</code> 設定 <code>VITE_ADMIN_LOTTERY_POST_URL</code>（見 <code>.env.example</code>）。
                      </span>
                    }
                  />
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="流程說明（需後端提供抽籤 API 或由排程完成）"
                    description={(
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <span>
                          下表場次若後端儀表板未回傳 <code>sessions_lottery</code>，會改由活動詳情（GET /events）的場次補上；「待抽籤人數」可能顯示為 —，仍可手動按「執行抽籤」。
                        </span>
                        <span>
                          「立即檢查並執行／即時抽籤」按下後會呼叫<strong>同上抽籤 POST</strong>；若後端未提供該路由，會一律失敗，需要由{' '}
                          <strong>後端 lottery-runner／排程</strong>在 <code>lottery_at</code> 到點時處理，或請後端公開手動抽籤 API。
                        </span>
                        <Space wrap>
                          <span>自動抽籤：</span>
                          <Switch
                            checked={autoLotteryEnabled}
                            onChange={setAutoLotteryEnabled}
                            disabled={!isAdminFull}
                            checkedChildren="開啟"
                            unCheckedChildren="關閉"
                          />
                          <Button
                            size="small"
                            onClick={() => runDueLotteries({ silent: false })}
                            loading={autoLotteryRunning}
                            disabled={!isAdminFull || !selectedEventId}
                          >
                            立即檢查並執行
                          </Button>
                        </Space>
                        <span>自動抽籤狀態：{autoLotteryStatus}</span>
                        <span>最近執行時間：{autoLotteryLastRunAt || '尚未執行'}</span>
                        <Divider style={{ margin: '8px 0' }} />
                        <span>排程抽籤（每天固定時間跑一次，會掃描目前可抽籤場次）</span>
                        <Space wrap>
                          <span>每日排程：</span>
                          <Switch
                            checked={nightlyScheduleEnabled}
                            onChange={setNightlyScheduleEnabled}
                            disabled={!isAdminFull}
                            checkedChildren="開啟"
                            unCheckedChildren="關閉"
                          />
                          <Tag color="blue">{NIGHTLY_LOTTERY_TIME}</Tag>
                          <Button
                            size="small"
                            onClick={() => runNightlyLotteryNow({ silent: false })}
                            loading={nightlyRunning}
                            disabled={!isAdminFull}
                          >
                            立即執行一次
                          </Button>
                        </Space>
                        <span>排程狀態：{nightlyStatus}</span>
                        <span>今日是否已跑：{nightlyLastRunDate === dayjs().format('YYYY-MM-DD') ? '是' : '否'}</span>
                      </Space>
                    )}
                  />
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
            )
          }
        ]}
      />

    </div>
  );
};

export default AdminConsolePage;
