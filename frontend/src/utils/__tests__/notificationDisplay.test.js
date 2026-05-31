import { describe, expect, it } from 'vitest';
import {
  extractCancellationReason,
  shouldShowCancellationReasonLine
} from '../notificationDisplay';

describe('notificationDisplay helpers', () => {
  it('extracts cancellation reason from common payload keys', () => {
    expect(extractCancellationReason({ payload: { reason: '  Weather conditions  ' } })).toBe('Weather conditions');
    expect(extractCancellationReason({ payload: { cancel_reason: 'Venue issue' } })).toBe('Venue issue');
    expect(extractCancellationReason({ payload: { cancellation_reason: 'Postponed' } })).toBe('Postponed');
    expect(extractCancellationReason({ payload: { revoke_reason: 'Revoked' } })).toBe('Revoked');
    expect(extractCancellationReason({ payload: {} })).toBe('');
    expect(extractCancellationReason(null)).toBe('');
  });

  it('decides whether to show an extra cancellation reason line', () => {
    expect(shouldShowCancellationReasonLine({ type: 'REGISTRATION_CONFIRMED' })).toBe(false);
    expect(shouldShowCancellationReasonLine({ type: 'EVENT_CANCELLED', payload: {} })).toBe(false);
    expect(shouldShowCancellationReasonLine({
      type: 'EVENT_CANCELLED',
      payload: { reason: 'Typhoon' },
      body: 'Event cancelled'
    })).toBe(true);
    expect(shouldShowCancellationReasonLine({
      type: 'EVENT_CANCELLED',
      payload: { reason: 'Typhoon' },
      body: 'Event cancelled. Reason: Typhoon'
    })).toBe(false);
  });
});
