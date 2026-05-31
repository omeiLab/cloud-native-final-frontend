import React, { memo, useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Button, Card, Col, Descriptions, Empty, List, Modal, Row, Space, Spin, Tabs, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined, FullscreenExitOutlined, FullscreenOutlined, QrcodeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import QRCode from 'qrcode';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { pickAvatarImage } from '../assets/media';
import { REGISTRATION_STATUS_LABELS, TICKET_STATUS_LABELS, labelOr, useI18n } from '../utils/labels';
import '../styles/Profile.css';

const { Title, Paragraph, Text } = Typography;

const TICKET_QR_IMAGE_SIZE = 640;
const TICKET_QR_MARGIN_MODULES = 4;

export const normalizeTicketTypeLabel = (name, fallbackId = '') => {
  const text = String(name || '');
  if (/Adult/.test(text)) return 'Adult';
  if (/Child/.test(text)) return 'Child';
  return text || fallbackId || '-';
};

export const buildFallbackEventTitle = (reg) => {
  if (reg?.event_id) {
    return `Event ${reg.event_id}`;
  }
  if (reg?.session_id) {
    return `Event (session ${reg.session_id})`;
  }
  return 'Event details pending sync';
};

export const getQrSecondsRemaining = (expiresAt) => {
  if (!expiresAt) return null;
  return Math.max(dayjs(expiresAt).diff(dayjs(), 'second'), 0);
};

export const formatQrCountdown = (seconds, copy) => {
  if (seconds === null) return copy?.calculatingCountdown || 'Calculating countdown';
  if (seconds <= 0) return copy?.refreshing || 'Refreshing';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = String(seconds % 60).padStart(2, '0');
  return `${copy?.remaining || 'Remaining'} ${minutes}:${remainingSeconds}`;
};

/** Prefer payload.event_title; notification titles often use "prefix — event name". */
export const eventTitleFromNotification = (item) => {
  const p = item?.payload || {};
  const direct = typeof p.event_title === 'string' ? p.event_title.trim() : '';
  if (direct) return direct;
  const raw = String(item?.title || '').trim();
  if (!raw) return '';
  const seps = [' — ', ' – ', ' - ', '—', '–'];
  for (const sep of seps) {
    const i = raw.indexOf(sep);
    if (i !== -1) return raw.slice(i + sep.length).trim();
  }
  return raw;
};

/**
 * When an event disappears from the list (for example after admin cancellation), getEvents cannot backfill titles; align via notification payload registration_id / session_id.
 */
export const enrichRegistrationsFromNotifications = (regs, notificationItems) => {
  if (!regs.length || !notificationItems.length) return regs;
  const byRegistrationId = new Map();
  const bySessionId = new Map();
  notificationItems.forEach((n) => {
    const p = n?.payload || {};
    const title = eventTitleFromNotification(n);
    if (!title) return;
    if (p.registration_id) {
      byRegistrationId.set(p.registration_id, title);
    }
    if (p.session_id) {
      const ts = dayjs(n.created_at).valueOf();
      const arr = bySessionId.get(p.session_id) || [];
      arr.push({ title, ts });
      bySessionId.set(p.session_id, arr);
    }
  });
  return regs.map((reg) => {
    const fallbackTitle = buildFallbackEventTitle(reg);
    const isFallback = !reg.event_title || reg.event_title === fallbackTitle;
    if (!isFallback) return reg;
    let fromNote = byRegistrationId.get(reg.id);
    if (!fromNote && bySessionId.has(reg.session_id)) {
      const regTs = dayjs(reg.created_at).valueOf();
      const candidates = bySessionId.get(reg.session_id);
      let best = null;
      let bestDiff = Infinity;
      candidates.forEach(({ title, ts }) => {
        const d = Math.abs(ts - regTs);
        if (d < bestDiff) {
          bestDiff = d;
          best = title;
        }
      });
      if (best && bestDiff < 14 * 24 * 60 * 60 * 1000) {
        fromNote = best;
      }
    }
    if (!fromNote) return reg;
    return { ...reg, event_title: fromNote };
  });
};

const initialTicketQrModalState = {
  qrData: null,
  qrImageUrl: '',
  qrSecondsRemaining: null,
  fullscreen: false,
  copyingPayload: false
};

export const ticketQrModalReducer = (state, action) => {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        qrData: action.qrData,
        qrImageUrl: action.qrImageUrl,
        qrSecondsRemaining: action.qrSecondsRemaining
      };
    case 'countdownUpdated':
      return { ...state, qrSecondsRemaining: action.qrSecondsRemaining };
    case 'fullscreenToggled':
      return { ...state, fullscreen: !state.fullscreen };
    case 'copyingUpdated':
      return { ...state, copyingPayload: action.copyingPayload };
    case 'reset':
      return initialTicketQrModalState;
    default:
      return state;
  }
};

const TicketQrModal = memo(({ ticketId, onClose, copy }) => {
  const [state, dispatch] = useReducer(ticketQrModalReducer, initialTicketQrModalState);
  const { qrData, qrImageUrl, qrSecondsRemaining, fullscreen, copyingPayload } = state;
  const open = Boolean(ticketId);

  const handleClose = useCallback(() => {
    dispatch({ type: 'reset' });
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!ticketId) {
      dispatch({ type: 'reset' });
      return undefined;
    }

    let cancelled = false;
    let timer;
    const refreshQr = async () => {
      try {
        const res = await apiClient.getTicketQR(ticketId);
        const image = await QRCode.toDataURL(res.data.qr_payload, {
          errorCorrectionLevel: 'M',
          margin: TICKET_QR_MARGIN_MODULES,
          width: TICKET_QR_IMAGE_SIZE,
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        });
        if (!cancelled) {
          dispatch({
            type: 'loaded',
            qrData: res.data,
            qrImageUrl: image,
            qrSecondsRemaining: getQrSecondsRemaining(res.data.qr_expires_at)
          });
        }
      } catch (e) {
        if (!cancelled) {
          message.warning(e?.error?.message || copy.qrNotAvailable);
          dispatch({ type: 'reset' });
          onClose();
        }
      }
    };

    refreshQr();
    timer = setInterval(refreshQr, 25000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [onClose, ticketId]);

  useEffect(() => {
    if (!open || !qrData?.qr_expires_at) {
      return undefined;
    }

    const updateCountdown = () => {
      dispatch({
        type: 'countdownUpdated',
        qrSecondsRemaining: getQrSecondsRemaining(qrData.qr_expires_at)
      });
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [open, qrData?.qr_expires_at]);

  const copyQrPayload = useCallback(async () => {
    const payload = qrData?.qr_payload;
    if (!payload) {
      message.warning(copy.qrPayloadNotReady);
      return;
    }
    dispatch({ type: 'copyingUpdated', copyingPayload: true });
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const el = document.createElement('textarea');
        el.value = payload;
        el.style.cssText = 'position: fixed; left: -9999px; top: 0;';
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      message.success(copy.qrCopied);
    } catch {
      message.error(copy.copyFailed);
    } finally {
      dispatch({ type: 'copyingUpdated', copyingPayload: false });
    }
  }, [qrData?.qr_payload, copy]);

  return (
    <Modal
      title={copy.ticketDetails}
      open={open}
      onCancel={handleClose}
      footer={null}
      width={fullscreen ? '100vw' : 456}
      className={`ticket-modal${fullscreen ? ' ticket-fullscreen-modal' : ''}`}
    >
      {ticketId ? (
        <div className={`ticket-detail-modal${fullscreen ? ' fullscreen' : ''}`}>
          {!qrData ? <Spin /> : null}
          {qrData ? (
            <>
              <div className="ticket-modal-toolbar">
                <Button
                  type="default"
                  icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={() => dispatch({ type: 'fullscreenToggled' })}
                >
                  {fullscreen ? copy.exitFullscreen : copy.enterFullscreen}
                </Button>
                <Button
                  type="primary"
                  icon={<QrcodeOutlined />}
                  loading={copyingPayload}
                  onClick={copyQrPayload}
                >
                  {copy.copyQrPayload}
                </Button>
              </div>
              <div className="ticket-summary-panel">
                <QrcodeOutlined className="ticket-summary-icon" />
                <div className="ticket-summary-copy">
                  <Text className="ticket-summary-label">{copy.qrCountdown}</Text>
                  <Text strong className="ticket-summary-countdown">
                    {formatQrCountdown(qrSecondsRemaining, copy)}
                  </Text>
                </div>
              </div>
              <div className="ticket-qr-frame">
                {qrImageUrl ? <img src={qrImageUrl} alt="ticket qr" /> : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
});

const TabsLoading = memo(() => (
  <div className="loading-container">
    <Spin size="large" />
  </div>
));

const TicketCard = memo(({ ticket, registration, onOpenTicket, onForfeitTicket, copy, ticketLabels, labelOrFn }) => {
  const canForfeit = registration?.status === 'WON' || registration?.status === 'CONFIRMED';
  const canShowQr = ticket.status === 'ISSUED';

  const handleOpen = useCallback(() => {
    if (!canShowQr) {
      message.warning(copy.ticketStatusNoQr.replace('{status}', ticket.status));
      return;
    }
    onOpenTicket(ticket.id);
  }, [canShowQr, onOpenTicket, ticket.id, ticket.status]);

  const handleForfeit = useCallback((e) => {
    e.stopPropagation();
    onForfeitTicket(ticket);
  }, [onForfeitTicket, ticket]);

  return (
    <Card hoverable onClick={handleOpen}>
      <Paragraph strong>
        {registration?.event_title || ticket.event_title || buildFallbackEventTitle(registration) || ticket.id}
      </Paragraph>
      <Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {(registration?.session_title || ticket.session_title)
          ? `${copy.session}：${registration?.session_title || ticket.session_title}`
          : null}
        {(registration?.ticket_type_name || ticket.ticket_type_name || registration?.ticket_type_id || ticket.ticket_type_id)
          ? `　${copy.ticketType}：${normalizeTicketTypeLabel(
            registration?.ticket_type_name || ticket.ticket_type_name,
            registration?.ticket_type_id || ticket.ticket_type_id
          )}`
          : null}
      </Paragraph>
      <Paragraph>
        {copy.status}：
        <Tag color={ticket.status === 'ISSUED' ? 'green' : 'default'}>
          {labelOrFn(ticketLabels, ticket.status, ticket.status)}
        </Tag>
      </Paragraph>
      <Paragraph type="secondary">{copy.issuedAt}:  {dayjs(ticket.issued_at).format('YYYY-MM-DD HH:mm')}</Paragraph>
      <Button danger size="small" onClick={handleForfeit} disabled={!canForfeit}>
        {copy.forfeitTicket}
      </Button>
    </Card>
  );
});

const TicketsPanel = memo(({ loading, tickets, registrationById, onOpenTicket, onForfeitTicket, copy, ticketLabels, labelOrFn }) => (
  <div className="tabs-content">
    {loading ? (
      <TabsLoading />
    ) : !tickets.length ? (
      <Empty description={copy.noTickets} />
    ) : (
      <Row gutter={[16, 16]}>
        {tickets.map((ticket) => (
          <Col key={ticket.id} xs={24} sm={12} md={8}>
            <TicketCard
              ticket={ticket}
              registration={registrationById.get(ticket.registration_id)}
              onOpenTicket={onOpenTicket}
              onForfeitTicket={onForfeitTicket}
              copy={copy}
              ticketLabels={ticketLabels}
              labelOrFn={labelOrFn}
            />
            />
          </Col>
        ))}
      </Row>
    )}
  </div>
));

const RegistrationsPanel = memo(({ loading, registrations, copy, registrationLabels, labelOrFn }) => (
  <div className="tabs-content">
    {loading ? (
      <TabsLoading />
    ) : registrations.length === 0 ? (
      <Empty description={copy.noRegistrations} />
    ) : (
      <List
        dataSource={registrations}
        renderItem={(reg) => (
          <List.Item
            actions={[
              <Tag key="status" color={reg.status === 'CONFIRMED' ? 'green' : 'blue'}>
                {labelOrFn(registrationLabels, reg.status, reg.status)}
              </Tag>
            ]}
          >
            <List.Item.Meta
              title={reg.event_title || buildFallbackEventTitle(reg)}
              description={
                <Space direction="vertical" size={0}>
                  <span>{copy.session}：{reg.session_title || reg.session_id}</span>
                  <span>{copy.ticketType}：{normalizeTicketTypeLabel(reg.ticket_type_name, reg.ticket_type_id)}</span>
                  <span>{copy.createdAt}: {dayjs(reg.created_at).format('YYYY-MM-DD HH:mm')}</span>
                </Space>
              }
            />
          </List.Item>
        )}
      />
    )}
  </div>
));

const ProfileHeader = memo(({ user, ticketCount, onLogout, copy, common }) => (
  <Card className="profile-header-card">
    <Row gutter={[24, 24]}>
      <Col xs={24} md={8} style={{ textAlign: 'center' }}>
        <div className="avatar">
          <img src={pickAvatarImage(`${user?.name || ''}${user?.email || ''}`)} alt="profile avatar" loading="lazy" decoding="async" />
        </div>
        <Title level={3} style={{ marginTop: 12 }}>🐣 {user?.name}</Title>
        <Paragraph type="secondary">{user?.email}</Paragraph>
        <Tag>{user?.role}</Tag>
        <br />
        <Button type="primary" danger style={{ marginTop: 16 }} onClick={onLogout}>
          {common.signOut}
        </Button>
      </Col>
      <Col xs={24} md={16}>
        <Descriptions title={copy.employeeInfo} column={1}>
          <Descriptions.Item label={copy.employeeId}>{user?.employee_id}</Descriptions.Item>
          <Descriptions.Item label={copy.department}>{user?.department || '-'}</Descriptions.Item>
          <Descriptions.Item label={copy.site}>{user?.site}</Descriptions.Item>
          <Descriptions.Item label={copy.accountStatus}>{user?.status}</Descriptions.Item>
          <Descriptions.Item label={copy.availableTickets}>{ticketCount}</Descriptions.Item>
        </Descriptions>
      </Col>
    </Row>
  </Card>
));

const UserProfile = () => {
  const { user, logout } = useAuth();
  const {
    m,
    TICKET_STATUS_LABELS: ticketLabels,
    REGISTRATION_STATUS_LABELS: registrationLabels,
    labelOr: labelOrFn
  } = useI18n();
  const copy = m.profile;
  const common = m.common;
  const [registrations, setRegistrations] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicketId, setSelectedTicketId] = useState('');

  const loadData = useCallback(async ({ showLoading = true } = {}) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const [registrationsRes, ticketsRes] = await Promise.all([
        apiClient.getMyRegistrations({ page: 1, page_size: 100 }),
        apiClient.getMyTickets({ page: 1, page_size: 100 })
      ]);
      const registrationItems = registrationsRes.data.items || [];
      const ticketItems = ticketsRes.data.items || [];
      let enrichedRegistrations = registrationItems;
      let enrichedTickets = ticketItems;
      if (registrationItems.length) {
        try {
          const registrationEventIds = Array.from(new Set(registrationItems.flatMap((r) => (r.event_id ? [r.event_id] : []))));
          const directEventPairs = await Promise.all(
            registrationEventIds.map(async (eventId) => {
              try {
                const detailRes = await apiClient.getEvent(eventId);
                return [eventId, detailRes.data];
              } catch {
                return [eventId, null];
              }
            })
          );

          const neededSessionIds = new Set(registrationItems.flatMap((r) => (r.session_id ? [r.session_id] : [])));
          const sessionMap = new Map();
          const ticketTypeMap = new Map();

          const mergeDetailIntoMaps = (detail) => {
            if (!detail) return;
            (detail?.sessions || []).forEach((session) => {
              sessionMap.set(session.id, {
                eventTitle: detail?.title || '',
                sessionTitle: session.title || session.id
              });
              (session.ticket_types || []).forEach((tt) => {
                ticketTypeMap.set(tt.id, tt.name || tt.id);
              });
            });
          };

          const allSessionsResolved = () =>
            !neededSessionIds.size || [...neededSessionIds].every((sid) => sessionMap.has(sid));

          let page = 1;
          let hasNext = true;
          const MAX_EVENT_PAGES = 50;
          while (hasNext && page <= MAX_EVENT_PAGES) {
            const eventsRes = await apiClient.getEvents({ scope: 'all', page, page_size: 100 });
            const pageItems = eventsRes.data.items || [];
            const detailPairs = await Promise.all(
              pageItems.map(async (evt) => {
                try {
                  const detailRes = await apiClient.getEvent(evt.id);
                  return detailRes.data;
                } catch {
                  return null;
                }
              })
            );
            detailPairs.forEach(mergeDetailIntoMaps);
            if (allSessionsResolved()) break;
            hasNext = Boolean(eventsRes.data.has_next);
            page += 1;
          }

          directEventPairs.forEach(([, detail]) => mergeDetailIntoMaps(detail));

          enrichedRegistrations = registrationItems.map((reg) => {
            const sessionMeta = sessionMap.get(reg.session_id);
            return {
              ...reg,
              event_title: reg.event_title || sessionMeta?.eventTitle || buildFallbackEventTitle(reg),
              session_title: reg.session_title || sessionMeta?.sessionTitle || reg.session_id,
              ticket_type_name: normalizeTicketTypeLabel(
                reg.ticket_type_name || ticketTypeMap.get(reg.ticket_type_id),
                reg.ticket_type_id
              )
            };
          });

          // Ticket list may be more complete than registrations; enrich display via session_id / ticket_type_id.
          enrichedTickets = ticketItems.map((t) => {
            const sessionMeta = sessionMap.get(t.session_id);
            const inferredTicketTypeName = ticketTypeMap.get(t.ticket_type_id);
            return {
              ...t,
              event_title: t.event_title || sessionMeta?.eventTitle || '',
              session_title: t.session_title || sessionMeta?.sessionTitle || '',
              ticket_type_name: t.ticket_type_name || inferredTicketTypeName || ''
            };
          });

          let noteItems = [];
          try {
            const noteRes = await apiClient.getNotifications({ page: 1, page_size: 100 });
            noteItems = noteRes.data?.items || [];
          } catch {
            noteItems = [];
          }
          enrichedRegistrations = enrichRegistrationsFromNotifications(enrichedRegistrations, noteItems);
        } catch {
          enrichedRegistrations = registrationItems.map((reg) => ({
            ...reg,
            event_title: reg.event_title || buildFallbackEventTitle(reg),
            session_title: reg.session_title || reg.session_id,
            ticket_type_name: normalizeTicketTypeLabel(reg.ticket_type_name, reg.ticket_type_id)
          }));
        }
      }
      setRegistrations(enrichedRegistrations);
      setTickets(enrichedTickets);
    } catch (err) {
      message.error(err?.error?.message || copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    loadData({ showLoading: false });
  }, [loadData]);

  const ticketCount = useMemo(() => tickets.filter((t) => t.status === 'ISSUED').length, [tickets]);
  const registrationById = useMemo(
    () => new Map(registrations.map((reg) => [reg.id, reg])),
    [registrations]
  );

  const handleForfeitTicket = useCallback((ticket) => {
    const registrationId = ticket?.registration_id;
    if (!registrationId) {
      message.warning(copy.loadFailed);
      return;
    }
    Modal.confirm({
      title: copy.confirmForfeitTitle,
      content: copy.confirmForfeitContent,
      okText: copy.forfeitTicket,
      cancelText: common.cancel,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await apiClient.forfeitRegistration(registrationId);
          message.success(copy.forfeitSuccess);
          await loadData();
        } catch (e) {
          message.error(e?.error?.message || copy.loadFailed);
        }
      }
    });
  }, [common.cancel, copy, loadData]);

  const handleCloseTicketModal = useCallback(() => {
    setSelectedTicketId('');
  }, []);

  const handleOpenTicket = useCallback((ticketId) => {
    setSelectedTicketId(ticketId);
  }, []);

  const tabItems = useMemo(() => [
    {
      key: 'tickets',
      label: (
        <span>
          <QrcodeOutlined /> {copy.myTickets}
        </span>
      ),
      children: (
        <TicketsPanel
          loading={loading}
          tickets={tickets}
          registrationById={registrationById}
          onOpenTicket={handleOpenTicket}
          onForfeitTicket={handleForfeitTicket}
          copy={copy}
          ticketLabels={ticketLabels}
          labelOrFn={labelOrFn}
        />
      )
    },
    {
      key: 'registrations',
      label: (
        <span>
          <CheckCircleOutlined /> {copy.myRegistrations}
        </span>
      ),
      children: (
        <RegistrationsPanel
          loading={loading}
          registrations={registrations}
          copy={copy}
          registrationLabels={registrationLabels}
          labelOrFn={labelOrFn}
        />
      )
    }
  ], [copy, handleForfeitTicket, handleOpenTicket, labelOrFn, loading, registrationById, registrationLabels, registrations, ticketLabels, tickets]);

  return (
    <div className="page-wrap profile-container">
      <ProfileHeader user={user} ticketCount={ticketCount} onLogout={logout} copy={copy} common={common} />

      <Tabs
        defaultActiveKey="tickets"
        style={{ marginTop: 24 }}
        items={tabItems}
      />

      <TicketQrModal ticketId={selectedTicketId} onClose={handleCloseTicketModal} copy={copy} />
    </div>
  );
};

export default UserProfile;
