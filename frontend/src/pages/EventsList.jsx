import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Input, Row, Select, Skeleton, Tag, Typography } from 'antd';
import {
  CalendarOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { pickEventImage, resolvePublicAssetUrl } from '../assets/media';
import '../styles/EventsList.css';

const { Title, Paragraph } = Typography;

const ALL_FILTER_VALUE = 'all';

const STATUS_FILTER_OPTIONS = [
  { label: '全部活動', value: ALL_FILTER_VALUE },
  { label: '可報名', value: 'open' },
  { label: '未開放/已截止', value: 'closed' },
  { label: '不符合資格', value: 'ineligible' },
  { label: '已取消', value: 'cancelled' }
];

const DATE_FILTER_OPTIONS = [
  { label: '所有日期', value: ALL_FILTER_VALUE },
  { label: '一週內', value: 'week' },
  { label: '一個月內', value: 'month' },
  { label: '三個月內', value: 'quarter' }
];

const getEventSearchText = (event) => (
  `${event.title || ''} ${event.venue || ''} ${(event.allowed_sites || []).join(' ')}`
    .toLowerCase()
);

const isDateInRange = (date, rangeStart, rangeEnd) => (
  (date.isAfter(rangeStart) || date.isSame(rangeStart))
  && (date.isBefore(rangeEnd) || date.isSame(rangeEnd))
);

const resolveDateWindow = (dateWindow) => {
  if (dateWindow === 'week') return [dayjs().startOf('day'), dayjs().add(7, 'day').endOf('day')];
  if (dateWindow === 'month') return [dayjs().startOf('day'), dayjs().add(1, 'month').endOf('day')];
  if (dateWindow === 'quarter') return [dayjs().startOf('day'), dayjs().add(3, 'month').endOf('day')];
  return null;
};

const isEventWithinDateWindow = (event, dateWindow) => {
  const range = resolveDateWindow(dateWindow);
  if (!range) return true;
  const [rangeStart, rangeEnd] = range;
  const eventStart = dayjs(event.starts_at);
  const eventEnd = event.ends_at ? dayjs(event.ends_at) : eventStart;
  if (!eventStart.isValid()) return false;
  const resolvedEnd = eventEnd.isValid() ? eventEnd : eventStart;
  return isDateInRange(eventStart, rangeStart, rangeEnd)
    || isDateInRange(resolvedEnd, rangeStart, rangeEnd)
    || (eventStart.isBefore(rangeStart) && resolvedEnd.isAfter(rangeEnd));
};

const EventCard = ({ event, primaryStatus, onOpen }) => {
  const startDate = dayjs(event.starts_at);
  const fallbackImage = pickEventImage(event.id || event.title);

  return (
    <Card
      hoverable
      className="event-card"
      onClick={() => onOpen(event.id)}
      cover={(
        <img
          className="event-cover"
          src={resolvePublicAssetUrl(event.cover_image_url) || fallbackImage}
          alt={event.title}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = fallbackImage;
          }}
        />
      )}
    >
      <div className="event-card-content">
        <div className="event-header">
          <h3>{event.title}</h3>
          <Tag className="event-primary-status" color={primaryStatus.color}>
            {primaryStatus.label}
          </Tag>
        </div>

        <Paragraph className="event-description" ellipsis={{ rows: 2 }}>
          開放廠區：{event.allowed_sites?.length ? event.allowed_sites.join(', ') : '全廠區'}
        </Paragraph>

        <div className="event-details">
          <div className="detail-item">
            <CalendarOutlined />
            <span>活動時間：{startDate.format('YYYY-MM-DD HH:mm')}</span>
          </div>
          <div className="detail-item">
            <ClockCircleOutlined />
            <span>活動結束：{event.ends_at ? dayjs(event.ends_at).format('YYYY-MM-DD HH:mm') : '未設定'}</span>
          </div>
          <div className="detail-item">
            <EnvironmentOutlined />
            <span>{event.venue || '依場次公告'}</span>
          </div>
          <div className="detail-item">
            <TeamOutlined />
            <span>場次 {event.session_count}</span>
          </div>
        </div>

        <div className="event-footer">
          <span className="event-footer-note">
            報名截止：{event.registration_closes_at ? dayjs(event.registration_closes_at).format('MM/DD HH:mm') : '未設定'}
          </span>
          <Button type="primary" onClick={(e) => {
            e.stopPropagation();
            onOpen(event.id);
          }}>
            查看詳情
          </Button>
        </div>
      </div>
    </Card>
  );
};

const EventsList = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [dateWindow, setDateWindow] = useState(ALL_FILTER_VALUE);
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER_VALUE);

  const fetchEvents = useCallback(async (params = {}) => {
    try {
      setLoading(true);
      setError('');
      const restParams = { ...params };
      delete restParams.page;
      delete restParams.page_size;
      const listItems = [];
      let currentPage = 1;
      let hasNext = true;
      while (hasNext) {
        const response = await apiClient.getEvents({
          scope: 'all',
          ...restParams,
          page: currentPage,
          page_size: 100
        });
        const pageData = response.data || {};
        listItems.push(...(pageData.items || []));
        hasNext = Boolean(pageData.has_next);
        currentPage += 1;
      }
      const detailPairs = await Promise.all(
        listItems.map(async (item) => {
          try {
            const detailRes = await apiClient.getEvent(item.id);
            return [item.id, detailRes.data];
          } catch {
            return [item.id, null];
          }
        })
      );
      const detailMap = new Map(detailPairs);
      const normalized = listItems.map((item) => {
        const detail = detailMap.get(item.id);
        const firstSession = detail?.sessions?.[0];
        const derivedEndsAt = (detail?.sessions || [])
          .map((s) => s?.ends_at)
          .filter(Boolean)
          .reduce((max, cur) => {
            if (!max) return cur;
            const a = dayjs(max);
            const b = dayjs(cur);
            if (!a.isValid()) return cur;
            if (!b.isValid()) return max;
            return b.isAfter(a) ? cur : max;
          }, null);
        const sessionQuota = (firstSession?.ticket_types || []).reduce((sum, tt) => sum + Number(tt?.quota || 0), 0);
        const remainingQuotaRaw = item.remaining_quota;
        const remainingQuota = remainingQuotaRaw === undefined || remainingQuotaRaw === null
          ? sessionQuota
          : Number(remainingQuotaRaw);
        const registrationClosesAt = item.registration_closes_at || firstSession?.registration_closes_at || null;
        const registrationOpensAt = firstSession?.registration_opens_at || null;
        const nowAt = dayjs();
        const derivedIsOpen = registrationOpensAt && registrationClosesAt
          ? nowAt.isAfter(dayjs(registrationOpensAt)) && nowAt.isBefore(dayjs(registrationClosesAt))
          : false;
        const derivedIsEligible = detail?.sessions?.some((s) => s?.status === 'REGISTRATION_OPEN') ?? false;
        const resolvedIsEligible = item.is_eligible === undefined || item.is_eligible === null
          ? derivedIsEligible
          : Boolean(item.is_eligible);
        return {
          ...item,
          registration_closes_at: registrationClosesAt,
          venue: item.venue || firstSession?.venue || '依場次公告',
          ends_at: item.ends_at || derivedEndsAt || null,
          remaining_quota: Number.isFinite(remainingQuota) ? remainingQuota : 0,
          is_registration_open: item.is_registration_open ?? derivedIsOpen,
          // is_eligible 以後端 /events 為準；僅在缺值時才用場次狀態推導做保守兜底
          is_eligible: resolvedIsEligible
        };
      });
      setEvents(normalized);
    } catch (err) {
      const msg =
        err?.error?.message
        || err?.message
        || err?.detail
        || '';
      if (/401|unauth|not authenticated|token/i.test(msg)) {
        setError('尚未登入或登入已過期，請點右上角「登入」後重試。');
      } else {
        setError(msg || '無法載入活動列表');
      }
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchEvents();
  }, [fetchEvents, user]);

  const canRegisterEvent = useCallback((event) => {
    const roleCanRegister = user?.role === 'EMPLOYEE';
    const isPublished = event.status === 'PUBLISHED';
    const isRegistrationOpen = Boolean(event.is_registration_open);
    return roleCanRegister && isPublished && isRegistrationOpen && Boolean(event.is_eligible);
  }, [user?.role]);

  const getPrimaryStatus = useCallback((event) => {
    const isPublished = event.status === 'PUBLISHED';
    const isRegistrationOpen = Boolean(event.is_registration_open);
    if (event.status === 'CANCELLED') return { label: '已取消', color: 'red' };
    if (!isPublished) return { label: '活動未發布', color: 'default' };
    if (user?.role !== 'EMPLOYEE') return { label: '此身分不可報名', color: 'warning' };
    if (!isRegistrationOpen) return { label: '已截止/未開放', color: 'default' };
    if (!event.is_eligible) return { label: '不符合資格', color: 'default' };
    return { label: '可報名', color: 'success' };
  }, [user?.role]);

  const getStatusFilterValue = useCallback((event) => {
    if (event.status === 'CANCELLED') return 'cancelled';
    if (!event.is_eligible) return 'ineligible';
    if (canRegisterEvent(event)) return 'open';
    return 'closed';
  }, [canRegisterEvent]);

  const visibleEvents = useMemo(() => {
    const term = keyword.trim().toLowerCase();
    return events.filter((event) => {
      if (term && !getEventSearchText(event).includes(term)) return false;
      if (!isEventWithinDateWindow(event, dateWindow)) return false;
      if (statusFilter !== ALL_FILTER_VALUE && getStatusFilterValue(event) !== statusFilter) return false;
      return true;
    });
  }, [dateWindow, events, getStatusFilterValue, keyword, statusFilter]);

  const sortedVisibleEvents = useMemo(() => [...visibleEvents].sort((a, b) => {
    const aCanRegister = canRegisterEvent(a);
    const bCanRegister = canRegisterEvent(b);
    if (aCanRegister !== bCanRegister) {
      return bCanRegister - aCanRegister;
    }
    const aCreated = dayjs(a.created_at || a.createdAt || 0).valueOf();
    const bCreated = dayjs(b.created_at || b.createdAt || 0).valueOf();
    if (aCreated !== bCreated) return bCreated - aCreated;
    const aUpdated = dayjs(a.updated_at || a.updatedAt || 0).valueOf();
    const bUpdated = dayjs(b.updated_at || b.updatedAt || 0).valueOf();
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;
    return String(b.id || '').localeCompare(String(a.id || ''));
  }), [canRegisterEvent, visibleEvents]);

  const eligibleCount = useMemo(
    () => events.filter((event) => canRegisterEvent(event)).length,
    [canRegisterEvent, events]
  );

  const hasActiveFilters = useMemo(() => (
    Boolean(keyword.trim())
    || dateWindow !== ALL_FILTER_VALUE
    || statusFilter !== ALL_FILTER_VALUE
  ), [dateWindow, keyword, statusFilter]);

  const openEvent = useCallback((eventId) => {
    navigate(`/events/${eventId}`);
  }, [navigate]);

  return (
    <div className="events-list-container page-wrap">
      {authLoading ? (
        <Card className="hero-card">
          <Skeleton active paragraph={{ rows: 2 }} />
        </Card>
      ) : !user ? (
        <Card className="events-hero hero-card guest-hero">
          <Title level={2}>台積電晶彩活動通</Title>
        </Card>
      ) : (
        <Card className="events-hero hero-card">
          <Title level={2}>活動目錄</Title>
          <Paragraph>
            以公平抽籤、即時通知與電子票券串起員工活動流程。選擇合適場次後即可進入報名與票券狀態追蹤。
          </Paragraph>
          <div className="hero-stats">
            <div><strong>{events.length}</strong><span>活動總數</span></div>
            <div><strong>{eligibleCount}</strong><span>符合資格</span></div>
          </div>
        </Card>
      )}

      {!user ? null : (
        <>
          <div className="events-filters">
            <div className="events-filter-row">
              <Input
                className="events-search"
                aria-label="搜尋活動、地點、廠區"
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜尋活動、地點、廠區"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <Select
                className="events-date-filter"
                aria-label="活動日期"
                value={dateWindow}
                options={DATE_FILTER_OPTIONS}
                onChange={setDateWindow}
              />
              <Select
                className="events-status-filter"
                aria-label="報名狀態"
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={setStatusFilter}
              />
              <Button
                className="events-refresh-button"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => fetchEvents()}
              >
                <span className="events-refresh-text">重新整理</span>
              </Button>
            </div>
          </div>

          {error ? <Alert style={{ marginBottom: 16 }} type="error" message={error} showIcon /> : null}

          {loading ? (
            <div className="loading-container">
              <Row gutter={[24, 24]} style={{ width: '100%' }}>
                {[1, 2, 3, 4, 5, 6].map((idx) => (
                  <Col key={idx} xs={24} sm={12} md={8}>
                    <Card className="event-card">
                      <Skeleton active avatar paragraph={{ rows: 4 }} />
                    </Card>
                  </Col>
                ))}
              </Row>
            </div>
          ) : !sortedVisibleEvents.length ? (
            <Empty description={hasActiveFilters ? '沒有符合篩選條件的活動' : '暫無活動'} />
          ) : (
            <Row gutter={[24, 24]}>
              {sortedVisibleEvents.map((event) => (
                <Col key={event.id} xs={24} sm={12} md={8}>
                  <EventCard event={event} primaryStatus={getPrimaryStatus(event)} onOpen={openEvent} />
                </Col>
              ))}
            </Row>
          )}
        </>
      )}
    </div>
  );
};

export default EventsList;
