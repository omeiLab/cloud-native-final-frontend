import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Input, message, Row, Select, Skeleton, Tag, Typography } from 'antd';
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

const LOGIN_ERROR_MESSAGE = 'Sign-in failed. Verify that backend services are running.';
const { Title, Paragraph } = Typography;

const ALL_FILTER_VALUE = 'all';

const STATUS_FILTER_OPTIONS = [
  { label: 'All events', value: ALL_FILTER_VALUE },
  { label: 'Open for registration', value: 'open' },
  { label: 'Not open / closed', value: 'closed' },
  { label: 'Ineligible', value: 'ineligible' },
  { label: 'Cancelled', value: 'cancelled' }
];

const DATE_FILTER_OPTIONS = [
  { label: 'All dates', value: ALL_FILTER_VALUE },
  { label: 'Within one week', value: 'week' },
  { label: 'Within one month', value: 'month' },
  { label: 'Within three months', value: 'quarter' }
];

const SKELETON_CARD_KEYS = [
  'event-skeleton-1',
  'event-skeleton-2',
  'event-skeleton-3',
  'event-skeleton-4',
  'event-skeleton-5',
  'event-skeleton-6'
];

const INITIAL_FILTERS = {
  keyword: '',
  dateWindow: ALL_FILTER_VALUE,
  statusFilter: ALL_FILTER_VALUE
};

const getEventSearchText = (event) => (
  `${event.title || ''} ${event.venue || ''} ${(event.allowed_sites || []).join(' ')}`
    .toLowerCase()
);

export const isDateInRange = (date, rangeStart, rangeEnd) => (
  (date.isAfter(rangeStart) || date.isSame(rangeStart))
  && (date.isBefore(rangeEnd) || date.isSame(rangeEnd))
);

export const resolveDateWindow = (dateWindow) => {
  if (dateWindow === 'week') return [dayjs().startOf('day'), dayjs().add(7, 'day').endOf('day')];
  if (dateWindow === 'month') return [dayjs().startOf('day'), dayjs().add(1, 'month').endOf('day')];
  if (dateWindow === 'quarter') return [dayjs().startOf('day'), dayjs().add(3, 'month').endOf('day')];
  return null;
};

export const isEventWithinDateWindow = (event, dateWindow) => {
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

export const canRegisterEventForRole = (event, role) => {
  const roleCanRegister = role === 'EMPLOYEE';
  const isPublished = event.status === 'PUBLISHED';
  const isRegistrationOpen = Boolean(event.is_registration_open);
  return roleCanRegister && isPublished && isRegistrationOpen && Boolean(event.is_eligible);
};

export const getPrimaryEventStatus = (event, role) => {
  const isPublished = event.status === 'PUBLISHED';
  const isRegistrationOpen = Boolean(event.is_registration_open);
  if (event.status === 'CANCELLED') return { label: 'Cancelled', color: 'red' };
  if (!isPublished) return { label: 'Event not published', color: 'default' };
  if (role !== 'EMPLOYEE') return { label: 'This role cannot register', color: 'warning' };
  if (!isRegistrationOpen) return { label: 'Closed / not open', color: 'default' };
  if (!event.is_eligible) return { label: 'Ineligible', color: 'default' };
  return { label: 'Open for registration', color: 'success' };
};

export const getEventStatusFilterValue = (event, role) => {
  if (event.status === 'CANCELLED') return 'cancelled';
  if (!event.is_eligible) return 'ineligible';
  if (canRegisterEventForRole(event, role)) return 'open';
  return 'closed';
};

export const filterVisibleEvents = (events, filters, role) => {
  const term = filters.keyword.trim().toLowerCase();
  return events.filter((event) => {
    if (term && !getEventSearchText(event).includes(term)) return false;
    if (!isEventWithinDateWindow(event, filters.dateWindow)) return false;
    if (filters.statusFilter !== ALL_FILTER_VALUE && getEventStatusFilterValue(event, role) !== filters.statusFilter) {
      return false;
    }
    return true;
  });
};

export const sortVisibleEvents = (events, role) => events.slice().sort((a, b) => {
  const aCanRegister = canRegisterEventForRole(a, role);
  const bCanRegister = canRegisterEventForRole(b, role);
  if (aCanRegister !== bCanRegister) {
    return bCanRegister - aCanRegister;
  }
  const aCreated = dayjs(a.created_at || a.createdAt || 0).valueOf();
  const bCreated = dayjs(b.created_at || b.createdAt || 0).valueOf();
  if (aCreated !== bCreated) return bCreated - aCreated;
  const aUpdated = dayjs(a.updated_at || a.updatedAt || 0).valueOf();
  const bUpdated = dayjs(b.updated_at || b.updatedAt || 0).valueOf();
  if (aUpdated !== bUpdated) return bUpdated - aUpdated;
  return String(a.id || '').localeCompare(String(b.id || ''));
});

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
          Allowed sites：{event.allowed_sites?.length ? event.allowed_sites.join(', ') : 'All sites'}
        </Paragraph>

        <div className="event-details">
          <div className="detail-item">
            <CalendarOutlined />
            <span>Event starts: {startDate.format('YYYY-MM-DD HH:mm')}</span>
          </div>
          <div className="detail-item">
            <ClockCircleOutlined />
            <span>Event ends: {event.ends_at ? dayjs(event.ends_at).format('YYYY-MM-DD HH:mm') : 'Not set'}</span>
          </div>
          <div className="detail-item">
            <EnvironmentOutlined />
            <span>{event.venue || 'See session announcement'}</span>
          </div>
          <div className="detail-item">
            <TeamOutlined />
            <span>Session {event.session_count}</span>
          </div>
        </div>

        <div className="event-footer">
          <span className="event-footer-note">
            Registration closes：{event.registration_closes_at ? dayjs(event.registration_closes_at).format('MM/DD HH:mm') : 'Not set'}
          </span>
          <Button type="primary" onClick={(e) => {
            e.stopPropagation();
            onOpen(event.id);
          }}>
            View details
          </Button>
        </div>
      </div>
    </Card>
  );
};

const EventsList = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, startOIDCLogin } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const { keyword, dateWindow, statusFilter } = filters;

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
          .flatMap((s) => (s?.ends_at ? [s.ends_at] : []))
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
          venue: item.venue || firstSession?.venue || 'See session announcement',
          ends_at: item.ends_at || derivedEndsAt || null,
          remaining_quota: Number.isFinite(remainingQuota) ? remainingQuota : 0,
          is_registration_open: item.is_registration_open ?? derivedIsOpen,
          // Prefer backend is_eligible; derive from session status only when missing
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
        setError('You are not signed in or your session expired. Sign in and try again.');
      } else {
        setError(msg || 'Failed to load event list');
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

  const canRegisterEvent = useCallback((event) => canRegisterEventForRole(event, user?.role), [user?.role]);

  const getPrimaryStatus = useCallback((event) => getPrimaryEventStatus(event, user?.role), [user?.role]);

  const getStatusFilterValue = useCallback(
    (event) => getEventStatusFilterValue(event, user?.role),
    [user?.role]
  );

  const visibleEvents = useMemo(
    () => filterVisibleEvents(events, filters, user?.role),
    [events, filters, user?.role]
  );

  const sortedVisibleEvents = useMemo(
    () => sortVisibleEvents(visibleEvents, user?.role),
    [user?.role, visibleEvents]
  );

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

  const updateFilter = useCallback((key, value) => {
    setFilters((currentFilters) => (
      currentFilters[key] === value
        ? currentFilters
        : { ...currentFilters, [key]: value }
    ));
  }, []);

  const handleKeywordChange = useCallback((event) => {
    updateFilter('keyword', event.target.value);
  }, [updateFilter]);

  const handleDateWindowChange = useCallback((value) => {
    updateFilter('dateWindow', value);
  }, [updateFilter]);

  const handleStatusFilterChange = useCallback((value) => {
    updateFilter('statusFilter', value);
  }, [updateFilter]);

  const handleLogin = useCallback(async () => {
    try {
      await startOIDCLogin();
    } catch (err) {
      message.error(err?.error?.message || LOGIN_ERROR_MESSAGE);
    }
  }, [startOIDCLogin]);

  return (
    <div className="events-list-container page-wrap">
      {authLoading ? (
        <Card className="hero-card">
          <Skeleton active paragraph={{ rows: 2 }} />
        </Card>
      ) : !user ? (
        <Card className="events-hero hero-card guest-hero">
          <Title level={2}>CETS Events</Title>
          <Button
            type="primary"
            size="large"
            className="guest-login-button"
            onClick={handleLogin}
          >
            Sign in
          </Button>
        </Card>
      ) : (
        <Card className="events-hero hero-card">
          <Title level={2}>Event catalog</Title>
          <Paragraph>
            Fair lotteries, realtime notifications, and digital tickets for employee events. Pick a session to register and track ticket status.
          </Paragraph>
          <div className="hero-stats">
            <div><strong>{events.length}</strong><span>Total events</span></div>
            <div><strong>{eligibleCount}</strong><span>Eligible</span></div>
          </div>
        </Card>
      )}

      {!user ? null : (
        <>
          <div className="events-filters">
            <div className="events-filter-row">
              <Input
                className="events-search"
                aria-label="Search events, venue, or site"
                allowClear
                prefix={<SearchOutlined />}
                placeholder="Search events, venue, or site"
                value={keyword}
                onChange={handleKeywordChange}
              />
              <Select
                className="events-date-filter"
                aria-label="Event date"
                value={dateWindow}
                options={DATE_FILTER_OPTIONS}
                onChange={handleDateWindowChange}
              />
              <Select
                className="events-status-filter"
                aria-label="Registration status"
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={handleStatusFilterChange}
              />
              <Button
                className="events-refresh-button"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => fetchEvents()}
              >
                <span className="events-refresh-text">Refresh</span>
              </Button>
            </div>
          </div>

          {error ? <Alert style={{ marginBottom: 16 }} type="error" message={error} showIcon /> : null}

          {loading ? (
            <div className="loading-container">
              <Row gutter={[24, 24]} style={{ width: '100%' }}>
                {SKELETON_CARD_KEYS.map((key) => (
                  <Col key={key} xs={24} sm={12} md={8}>
                    <Card className="event-card">
                      <Skeleton active avatar paragraph={{ rows: 4 }} />
                    </Card>
                  </Col>
                ))}
              </Row>
            </div>
          ) : !sortedVisibleEvents.length ? (
            <Empty description={hasActiveFilters ? 'No events match the filters' : 'No events yet'} />
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
