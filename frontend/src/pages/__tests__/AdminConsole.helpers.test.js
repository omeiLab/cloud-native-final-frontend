import { describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'ADMIN' } })
}));

vi.mock('../../context/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 })
}));

vi.mock('../../api/client', () => ({
  apiClient: {}
}));

vi.mock('recharts', () => ({}));

import {
  adminStateReducer,
  buildCreatePayload,
  createDefaultCreateValues,
  getErrorMessage,
  getEventId,
  getSessionId,
  mergeDashboardSessionsLottery,
  normalizeCoverImageUrlForBackend,
  normalizeSessionsLotteryRows,
  resolveLimitedLotteryAt,
  resolveLimitedWaitlistCloseAt,
  resolveSessionTicketFields,
  stripEligibilityMarkerForBackend,
  validateSessionTimeline
} from '../AdminConsolePage';

describe('AdminConsole helpers', () => {
  it('normalizes dashboard lottery session rows', () => {
    expect(normalizeSessionsLotteryRows(null)).toEqual([]);
    expect(normalizeSessionsLotteryRows([
      { id: 'sess-1', title: 'Session 1', lottery_at: '2026-06-01', pending_count: 3 },
      { session_id: '', title: 'skip me' }
    ])).toEqual([
      {
        session_id: 'sess-1',
        title: 'Session 1',
        lottery_at: '2026-06-01',
        lottery_executed_at: null,
        registered_pending: 3
      }
    ]);
  });

  it('merges dashboard lottery rows from event detail when dashboard is sparse', () => {
    const fromDash = mergeDashboardSessionsLottery({
      sessions_lottery: [{ session_id: 's1', title: 'A' }]
    }, null);
    expect(fromDash).toHaveLength(1);

    const fromEvent = mergeDashboardSessionsLottery({}, {
      sessions: [{ id: 's2', title: 'B', lottery_at: '2026-06-02' }]
    });
    expect(fromEvent[0].session_id).toBe('s2');
  });

  it('creates default event form values', () => {
    const values = createDefaultCreateValues();
    expect(values.title).toContain('Family Day');
    expect(values.sessions).toHaveLength(1);
    expect(values.allowed_sites).toEqual(['HSINCHU']);
  });

  it('updates admin state through reducer', () => {
    const initial = { loading: false, events: [] };
    expect(adminStateReducer(initial, { type: 'set', key: 'loading', value: true }).loading).toBe(true);
    expect(adminStateReducer(initial, {
      type: 'set',
      key: 'events',
      value: (current) => [...current, { id: 'evt-1' }]
    }).events).toEqual([{ id: 'evt-1' }]);
  });

  it('normalizes cover image URLs and strips eligibility markers', () => {
    expect(normalizeCoverImageUrlForBackend(' /image/event_1.webp ')).toBe('/image/event_1.webp');
    expect(normalizeCoverImageUrlForBackend('   ')).toBeNull();
    expect(stripEligibilityMarkerForBackend('Hello <!--CETS_ELIGIBILITY:{}--> World')).toBe('Hello  World');
    expect(stripEligibilityMarkerForBackend('Plain description')).toBe('Plain description');
  });

  it('resolves adult and child ticket fields from session ticket types', () => {
    const resolved = resolveSessionTicketFields({
      ticket_types: [
        { name: 'Adult ticket', audience: 'EMPLOYEE', id: 'adult' },
        { name: 'Child ticket', audience: 'DEPENDENT', id: 'child' }
      ]
    });
    expect(resolved.adultTicket.id).toBe('adult');
    expect(resolved.childTicket.id).toBe('child');
  });

  it('formats API and validation errors', () => {
    expect(getErrorMessage({ error: { message: 'Quota full' } }, 'fallback')).toBe('Quota full');
    expect(getErrorMessage({ detail: 'bad request' }, 'fallback')).toBe('bad request');
    expect(getErrorMessage({ detail: [{ msg: 'Field error' }] }, 'fallback')).toBe('Field error');
    expect(getErrorMessage({ httpStatus: 404 }, 'fallback')).toContain('404');
    expect(getErrorMessage({}, 'fallback')).toBe('fallback');
  });

  it('extracts event and session ids from nested API responses', () => {
    expect(getEventId({ data: { id: 'evt-1' } })).toBe('evt-1');
    expect(getEventId({ event_id: 'evt-2' })).toBe('evt-2');
    expect(getSessionId({ data: { session_id: 'sess-1' } })).toBe('sess-1');
    expect(getSessionId({ id: 'sess-2' })).toBe('sess-2');
  });

  it('derives lottery and waitlist timestamps for limited mode', () => {
    const closesAt = '2026-06-01T12:00:00+08:00';
    const lotteryAt = resolveLimitedLotteryAt(closesAt);
    expect(lotteryAt.diff(dayjs(closesAt), 'minute')).toBe(1);

    const startsAt = '2026-06-10T09:00:00+08:00';
    const waitlist = resolveLimitedWaitlistCloseAt({}, startsAt);
    expect(waitlist.diff(dayjs(startsAt), 'minute')).toBe(-1);
  });

  it('validates registration timeline ordering', () => {
    const values = createDefaultCreateValues();
    expect(() => validateSessionTimeline(values)).not.toThrow();

    const invalidOpens = {
      ...values,
      registration_opens_at: values.registration_closes_at
    };
    expect(() => validateSessionTimeline(invalidOpens)).toThrow('Registration open time must be before registration close time');

    const invalidCloses = {
      ...values,
      registration_closes_at: values.sessions[0].starts_at
    };
    expect(() => validateSessionTimeline(invalidCloses)).toThrow('Registration close time must be before event start time');
  });

  it('builds child ticket payload when required', () => {
    const payload = buildCreatePayload({
      ...createDefaultCreateValues(),
      sessions: [{
        ...createDefaultCreateValues().sessions[0],
        require_child_ticket: true,
        adult_quota: 50,
        child_quota: 20
      }]
    });
    expect(payload.sessions[0].ticket_types).toHaveLength(2);
  });

  it('builds create payloads for limited and unlimited modes', () => {
    const limited = buildCreatePayload(createDefaultCreateValues());
    expect(limited.title).toContain('Family Day');
    expect(limited.sessions[0].ticket_types).toHaveLength(2);
    expect(limited.description).not.toContain('CETS_ELIGIBILITY');

    const unlimited = buildCreatePayload({
      ...createDefaultCreateValues(),
      registration_mode: 'UNLIMITED',
      description: 'Hello <!--CETS_ELIGIBILITY:{}--> World'
    });
    expect(unlimited.sessions[0].ticket_types[0].name).toContain('unlimited');
    expect(unlimited.description).toBe('Hello  World');
  });
});
