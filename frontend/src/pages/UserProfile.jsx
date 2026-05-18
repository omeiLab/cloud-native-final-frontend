import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Descriptions, Empty, List, Modal, Row, Space, Spin, Tabs, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined, FullscreenExitOutlined, FullscreenOutlined, QrcodeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import QRCode from 'qrcode';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { pickAvatarImage } from '../assets/media';
import { REGISTRATION_STATUS_LABELS, TICKET_STATUS_LABELS, labelOr } from '../utils/labels';
import '../styles/Profile.css';

const { Title, Paragraph, Text } = Typography;

const normalizeTicketTypeLabel = (name, fallbackId = '') => {
  const text = String(name || '');
  if (/成人/.test(text)) return '成人';
  if (/兒童/.test(text)) return '兒童';
  return text || fallbackId || '-';
};

const buildFallbackEventTitle = (reg) => {
  if (reg?.event_id) {
    return `活動 ${reg.event_id}`;
  }
  if (reg?.session_id) {
    return `活動（場次 ${reg.session_id}）`;
  }
  return '活動資訊待同步';
};

/** 通知 title 常為「前綴 — 活動名」；payload.event_title 若有則優先 */
const eventTitleFromNotification = (item) => {
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
 * 活動已從列表消失（例如管理員取消）時，getEvents 無法補全；用通知 payload 對齊 registration_id / session_id。
 */
const enrichRegistrationsFromNotifications = (regs, notificationItems) => {
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

const UserProfile = () => {
  const { user, logout } = useAuth();
  const [registrations, setRegistrations] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [qrImageUrl, setQrImageUrl] = useState('');
  const [ticketFullscreen, setTicketFullscreen] = useState(false);
  const [copyingPayload, setCopyingPayload] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!showQRModal || !selectedTicketId) {
      return;
    }

    let timer;
    const refreshQr = async () => {
      try {
        const res = await apiClient.getTicketQR(selectedTicketId);
        setQrData(res.data);
        const image = await QRCode.toDataURL(res.data.qr_payload, {
          width: 320,
          margin: 1
        });
        setQrImageUrl(image);
      } catch (e) {
        // 若票券不可產生 QR（例如 USED/REVOKED），直接提示並關閉視窗，避免一直轉圈還要手動關閉。
        message.warning(e?.error?.message || '此票券目前無法產生 QR');
        setShowQRModal(false);
        setQrData(null);
        setQrImageUrl('');
        setTicketFullscreen(false);
      }
    };

    refreshQr();
    timer = setInterval(refreshQr, 25000);
    return () => clearInterval(timer);
  }, [selectedTicketId, showQRModal]);

  const loadData = async () => {
    try {
      setLoading(true);
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
          const registrationEventIds = Array.from(new Set(registrationItems.map((r) => r.event_id).filter(Boolean)));
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

          const neededSessionIds = new Set(registrationItems.map((r) => r.session_id).filter(Boolean));
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

          // 票券列表可能比報名列表更完整（例如分頁/舊資料），用 session_id / ticket_type_id 補齊顯示資訊。
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
      message.error(err?.error?.message || '載入個人資料失敗');
    } finally {
      setLoading(false);
    }
  };

  const ticketCount = useMemo(() => tickets.filter((t) => t.status === 'ISSUED').length, [tickets]);
  const registrationById = useMemo(
    () => new Map(registrations.map((reg) => [reg.id, reg])),
    [registrations]
  );

  const handleForfeitTicket = (ticket) => {
    const registrationId = ticket?.registration_id;
    if (!registrationId) {
      message.warning('此票券缺少 registration_id，暫時無法放棄');
      return;
    }
    Modal.confirm({
      title: '確認放棄票券',
      content: '放棄後名額會回流；若尚未超過候補截止時間，系統會嘗試遞補候補者。確定要放棄嗎？',
      okText: '確認放棄',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await apiClient.forfeitRegistration(registrationId);
          message.success('已放棄票券，名額已回流');
          await loadData();
        } catch (e) {
          message.error(e?.error?.message || '目前狀態不可放棄，請聯繫管理員');
        }
      }
    });
  };

  const copyQrPayload = async () => {
    const payload = qrData?.qr_payload;
    if (!payload) {
      message.warning('尚未取得 QR payload');
      return;
    }
    setCopyingPayload(true);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const el = document.createElement('textarea');
        el.value = payload;
        el.style.position = 'fixed';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      message.success('已複製 QR payload，可貼到「驗票端」手動核銷');
    } catch {
      message.error('複製失敗，請手動長按選取或改用電腦瀏覽器');
    } finally {
      setCopyingPayload(false);
    }
  };

  return (
    <div className="page-wrap profile-container">
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
            <Button type="primary" danger style={{ marginTop: 16 }} onClick={logout}>
              登出
            </Button>
          </Col>
          <Col xs={24} md={16}>
            <Descriptions title="員工資訊" column={1}>
              <Descriptions.Item label="員工編號">{user?.employee_id}</Descriptions.Item>
              <Descriptions.Item label="部門">{user?.department || '-'}</Descriptions.Item>
              <Descriptions.Item label="廠區">{user?.site}</Descriptions.Item>
              <Descriptions.Item label="帳號狀態">{user?.status}</Descriptions.Item>
              <Descriptions.Item label="可用票券">{ticketCount}</Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      <Tabs
        defaultActiveKey="tickets"
        style={{ marginTop: 24 }}
        items={[
          {
            key: 'tickets',
            label: (
              <span>
                <QrcodeOutlined /> 我的票匣
              </span>
            ),
            children: (
              <div className="tabs-content">
                {loading ? (
                  <div className="loading-container">
                    <Spin size="large" />
                  </div>
                ) : !tickets.length ? (
                  <Empty description="暫無票券" />
                ) : (
                  <Row gutter={[16, 16]}>
                    {tickets.map((ticket) => (
                      <Col key={ticket.id} xs={24} sm={12} md={8}>
                        {(() => {
                          const reg = registrationById.get(ticket.registration_id);
                          const canForfeit = reg?.status === 'WON' || reg?.status === 'CONFIRMED';
                          const canShowQr = ticket.status === 'ISSUED';
                          return (
                        <Card
                          hoverable
                          onClick={() => {
                            if (!canShowQr) {
                              message.warning(`票券狀態為 ${ticket.status}，無法產生 QR`);
                              return;
                            }
                            setSelectedTicketId(ticket.id);
                            setShowQRModal(true);
                          }}
                        >
                          <Paragraph strong>
                            {reg?.event_title || ticket.event_title || buildFallbackEventTitle(reg) || ticket.id}
                          </Paragraph>
                          <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                            {(reg?.session_title || ticket.session_title)
                              ? `場次：${reg?.session_title || ticket.session_title}`
                              : null}
                            {(reg?.ticket_type_name || ticket.ticket_type_name || reg?.ticket_type_id || ticket.ticket_type_id)
                              ? `　票種：${normalizeTicketTypeLabel(
                                reg?.ticket_type_name || ticket.ticket_type_name,
                                reg?.ticket_type_id || ticket.ticket_type_id
                              )}`
                              : null}
                          </Paragraph>
                          <Paragraph>
                            狀態：
                            <Tag color={ticket.status === 'ISSUED' ? 'green' : 'default'}>
                              {labelOr(TICKET_STATUS_LABELS, ticket.status, ticket.status)}
                            </Tag>
                          </Paragraph>
                          <Paragraph type="secondary">發行時間: {dayjs(ticket.issued_at).format('YYYY-MM-DD HH:mm')}</Paragraph>
                          <Button
                            danger
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleForfeitTicket(ticket);
                            }}
                            disabled={!canForfeit}
                          >
                            放棄票券
                          </Button>
                        </Card>
                          );
                        })()}
                      </Col>
                    ))}
                  </Row>
                )}
              </div>
            )
          },
          {
            key: 'registrations',
            label: (
              <span>
                <CheckCircleOutlined /> 我的報名
              </span>
            ),
            children: (
              <div className="tabs-content">
                {loading ? (
                  <div className="loading-container">
                    <Spin size="large" />
                  </div>
                ) : registrations.length === 0 ? (
                  <Empty description="暫無報名記錄" />
                ) : (
                  <List
                    dataSource={registrations}
                    renderItem={(reg) => (
                      <List.Item
                        actions={[
                          <Tag key="status" color={reg.status === 'CONFIRMED' ? 'green' : 'blue'}>
                            {labelOr(REGISTRATION_STATUS_LABELS, reg.status, reg.status)}
                          </Tag>
                        ]}
                      >
                        <List.Item.Meta
                          title={reg.event_title || buildFallbackEventTitle(reg)}
                          description={
                            <Space direction="vertical" size={0}>
                              <span>場次：{reg.session_title || reg.session_id}</span>
                              <span>票種：{normalizeTicketTypeLabel(reg.ticket_type_name, reg.ticket_type_id)}</span>
                              <span>建立時間: {dayjs(reg.created_at).format('YYYY-MM-DD HH:mm')}</span>
                            </Space>
                          }
                        />
                      </List.Item>
                    )}
                  />
                )}
              </div>
            )
          }
        ]}
      />

      {/* 票券詳情 Modal */}
      <Modal
        title="票券詳情"
        open={showQRModal}
        onCancel={() => {
          setShowQRModal(false);
          setQrData(null);
          setQrImageUrl('');
          setTicketFullscreen(false);
        }}
        footer={null}
        width={ticketFullscreen ? '100vw' : 456}
        className={`ticket-modal${ticketFullscreen ? ' ticket-fullscreen-modal' : ''}`}
      >
        {selectedTicketId ? (
          <div className={`ticket-detail-modal${ticketFullscreen ? ' fullscreen' : ''}`}>
            {!qrData ? <Spin /> : null}
            {qrData ? (
              <>
                <div className="ticket-modal-toolbar">
                  <Button
                    type="default"
                    icon={ticketFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                    onClick={() => setTicketFullscreen((v) => !v)}
                  >
                    {ticketFullscreen ? '退出全螢幕' : '全螢幕展示'}
                  </Button>
                  <Button
                    type="primary"
                    icon={<QrcodeOutlined />}
                    loading={copyingPayload}
                    onClick={copyQrPayload}
                  >
                    複製 QR payload
                  </Button>
                </div>
                <div className="ticket-summary-panel">
                  <QrcodeOutlined className="ticket-summary-icon" />
                  <div className="ticket-summary-copy">
                    <Text className="ticket-summary-label">票券</Text>
                    <Text strong className="ticket-summary-id">{qrData.ticket.id}</Text>
                    <Text className="ticket-summary-expiry">
                      QR 約 60 秒更新一次（到期: {dayjs(qrData.qr_expires_at).format('HH:mm:ss')}）
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
    </div>
  );
};

export default UserProfile;
