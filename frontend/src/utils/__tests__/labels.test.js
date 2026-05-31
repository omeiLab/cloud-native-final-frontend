import { describe, expect, it } from 'vitest';
import {
  EVENT_STATUS_LABELS,
  NOTIFICATION_TYPE_LABELS,
  REGISTRATION_STATUS_LABELS,
  ROLE_LABELS,
  SESSION_STATUS_LABELS,
  TICKET_STATUS_LABELS,
  labelOr
} from '../labels';

describe('label maps', () => {
  it('exposes expected status labels', () => {
    expect(EVENT_STATUS_LABELS.PUBLISHED).toBe('Published');
    expect(SESSION_STATUS_LABELS.LOTTERY_COMPLETED).toBe('Lottery completed');
    expect(REGISTRATION_STATUS_LABELS.CONFIRMED).toBe('Confirmed');
    expect(TICKET_STATUS_LABELS.ISSUED).toBe('Issued');
    expect(ROLE_LABELS.ADMIN).toBe('Admin');
    expect(NOTIFICATION_TYPE_LABELS.EVENT_CANCELLED).toBe('Event cancelled');
  });

  it('returns mapped labels or sensible fallbacks', () => {
    expect(labelOr(EVENT_STATUS_LABELS, 'DRAFT', 'Unknown')).toBe('Draft');
    expect(labelOr(EVENT_STATUS_LABELS, 'UNKNOWN', 'Unknown')).toBe('Unknown');
    expect(labelOr(EVENT_STATUS_LABELS, 'UNKNOWN', null)).toBe('UNKNOWN');
    expect(labelOr(EVENT_STATUS_LABELS, null, 'Default')).toBe('Default');
  });
});
