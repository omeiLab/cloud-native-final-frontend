import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import dayjs from 'dayjs';
import {
  canRegisterEventForRole,
  filterVisibleEvents,
  getEventStatusFilterValue,
  getPrimaryEventStatus,
  isDateInRange,
  isEventWithinDateWindow,
  resolveDateWindow,
  sortVisibleEvents
} from '../EventsList';

describe('EventsList helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseEvent = {
    id: 'evt-1',
    title: 'Spring Family Day',
    venue: 'Hsinchu plaza',
    allowed_sites: ['HSINCHU'],
    status: 'PUBLISHED',
    is_registration_open: true,
    is_eligible: true,
    starts_at: '2026-06-10T09:00:00+08:00',
    ends_at: '2026-06-10T18:00:00+08:00',
    created_at: '2026-05-20T10:00:00+08:00'
  };

  it('resolves date windows and checks event ranges', () => {
    const week = resolveDateWindow('week');
    expect(week).toHaveLength(2);
    expect(resolveDateWindow('all')).toBeNull();
    expect(isEventWithinDateWindow(baseEvent, 'all')).toBe(true);
    expect(isDateInRange(dayjs('2026-06-05'), week[0], week[1])).toBe(true);
  });

  it('determines registration eligibility and status labels', () => {
    expect(canRegisterEventForRole(baseEvent, 'EMPLOYEE')).toBe(true);
    expect(canRegisterEventForRole(baseEvent, 'ADMIN')).toBe(false);
    expect(getPrimaryEventStatus(baseEvent, 'EMPLOYEE')).toEqual({ label: 'Open for registration', color: 'success' });
    expect(getPrimaryEventStatus({ ...baseEvent, status: 'CANCELLED' }, 'EMPLOYEE').label).toBe('Cancelled');
    expect(getEventStatusFilterValue(baseEvent, 'EMPLOYEE')).toBe('open');
    expect(getEventStatusFilterValue({ ...baseEvent, is_eligible: false }, 'EMPLOYEE')).toBe('ineligible');
  });

  it('filters and sorts visible events', () => {
    const events = [
      baseEvent,
      { ...baseEvent, id: 'evt-2', title: 'Taipei evening event', is_registration_open: false, created_at: '2026-05-21T10:00:00+08:00' }
    ];
    const filtered = filterVisibleEvents(events, {
      keyword: 'Spring',
      dateWindow: 'all',
      statusFilter: 'all'
    }, 'EMPLOYEE');
    expect(filtered).toHaveLength(1);
    const sorted = sortVisibleEvents(events, 'EMPLOYEE');
    expect(sorted[0].id).toBe('evt-1');
  });
});
