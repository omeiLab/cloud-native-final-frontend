import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import dayjs from 'dayjs';
import {
  buildFallbackEventTitle,
  enrichRegistrationsFromNotifications,
  eventTitleFromNotification,
  formatQrCountdown,
  getQrSecondsRemaining,
  normalizeTicketTypeLabel,
  ticketQrModalReducer
} from '../UserProfile';

describe('UserProfile helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T10:00:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('normalizes ticket type labels', () => {
    expect(normalizeTicketTypeLabel('Adult ticket')).toBe('Adult');
    expect(normalizeTicketTypeLabel('Child ticket')).toBe('Child');
    expect(normalizeTicketTypeLabel('VIP', 'tt-1')).toBe('VIP');
    expect(normalizeTicketTypeLabel('', 'tt-2')).toBe('tt-2');
  });

  it('builds fallback event titles from registration metadata', () => {
    expect(buildFallbackEventTitle({ event_id: 'evt-1' })).toBe('Event evt-1');
    expect(buildFallbackEventTitle({ session_id: 'sess-1' })).toBe('Event (session sess-1)');
    expect(buildFallbackEventTitle({})).toBe('Event details pending sync');
  });

  it('formats QR countdown states', () => {
    const future = dayjs().add(90, 'second').toISOString();
    expect(getQrSecondsRemaining(future)).toBe(90);
    expect(getQrSecondsRemaining(null)).toBeNull();
    expect(formatQrCountdown(null)).toBe('Calculating countdown');
    expect(formatQrCountdown(0)).toBe('Refreshing');
    expect(formatQrCountdown(125)).toBe('Remaining 2:05');
  });

  it('extracts event titles from notifications', () => {
    expect(eventTitleFromNotification({
      title: 'Event cancelled — Spring Family Day',
      payload: {}
    })).toBe('Spring Family Day');
    expect(eventTitleFromNotification({
      title: 'Reminder',
      payload: { event_title: '  Direct title  ' }
    })).toBe('Direct title');
    expect(eventTitleFromNotification({ title: 'Single title' })).toBe('Single title');
  });

  it('enriches registrations using notification payload titles', () => {
    const regs = [{
      id: 'reg-1',
      session_id: 'sess-1',
      created_at: '2026-05-01T10:00:00+08:00'
    }];
    const notifications = [{
      title: 'Registration succeeded — Spring Family Day',
      created_at: '2026-05-01T10:05:00+08:00',
      payload: { registration_id: 'reg-1', session_id: 'sess-1' }
    }];

    const enriched = enrichRegistrationsFromNotifications(regs, notifications);
    expect(enriched[0].event_title).toBe('Spring Family Day');
    expect(enrichRegistrationsFromNotifications([], notifications)).toEqual([]);
  });

  it('updates ticket QR modal reducer state', () => {
    const initial = {
      qrData: null,
      qrImageUrl: '',
      qrSecondsRemaining: null,
      fullscreen: false,
      copyingPayload: false
    };
    const loaded = ticketQrModalReducer(initial, {
      type: 'loaded',
      qrData: { qr_payload: 'p1' },
      qrImageUrl: 'data:image/png;base64,abc',
      qrSecondsRemaining: 30
    });
    expect(loaded.qrImageUrl).toContain('data:image');
    expect(ticketQrModalReducer(loaded, { type: 'fullscreenToggled' }).fullscreen).toBe(true);
    expect(ticketQrModalReducer(loaded, { type: 'reset' })).toEqual(initial);
  });
});
