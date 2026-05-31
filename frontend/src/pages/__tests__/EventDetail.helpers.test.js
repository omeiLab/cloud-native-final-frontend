import { describe, expect, it } from 'vitest';
import {
  eventDetailPageReducer,
  getDefaultTicketType,
  getTicketAudienceLabel,
  isAlreadyRegisteredError,
  registrationDialogReducer,
  registrationErrMsg,
  stripEligibilityMarkerFromDescription
} from '../EventDetail';

describe('EventDetail helpers', () => {
  it('formats registration errors', () => {
    expect(registrationErrMsg({ error: { message: 'Quota full' } })).toBe('Quota full');
    expect(isAlreadyRegisteredError({ error: { code: 'ALREADY_REGISTERED' } })).toBe(true);
    expect(isAlreadyRegisteredError({ detail: 'Already registered for this session' })).toBe(true);
  });

  it('labels ticket audiences and picks defaults', () => {
    expect(getTicketAudienceLabel({ audience: 'EMPLOYEE', name: 'Adult ticket' })).toBe('Adult');
    expect(getTicketAudienceLabel({ audience: 'DEPENDENT', name: 'Child ticket' })).toBe('Child');
    expect(getDefaultTicketType([
      { id: 'child', name: 'Child ticket', audience: 'DEPENDENT' },
      { id: 'adult', name: 'Adult ticket', audience: 'EMPLOYEE' }
    ]).id).toBe('adult');
  });

  it('strips hidden eligibility markers from descriptions', () => {
    expect(stripEligibilityMarkerFromDescription('Hello <!--CETS_ELIGIBILITY:{}--> World')).toBe('Hello\nWorld');
    expect(stripEligibilityMarkerFromDescription('Plain text')).toBe('Plain text');
  });

  it('manages registration dialog reducer state', () => {
    const opened = registrationDialogReducer({
      open: false,
      registering: false,
      session: null,
      ticketType: null,
      ticketTypes: [],
      eligibilityConfirmed: false
    }, {
      type: 'open',
      session: { id: 'sess-1' },
      ticketTypes: [{ id: 'tt-1', name: 'Adult ticket', audience: 'EMPLOYEE' }],
      ticketType: { id: 'tt-1', name: 'Adult ticket', audience: 'EMPLOYEE' }
    });
    expect(opened.open).toBe(true);
    expect(opened.ticketType.id).toBe('tt-1');

    const confirmed = registrationDialogReducer(opened, { type: 'set_confirmed', value: true });
    expect(confirmed.eligibilityConfirmed).toBe(true);
    expect(registrationDialogReducer(confirmed, { type: 'close' }).open).toBe(false);
  });

  it('merges event detail page state patches', () => {
    expect(eventDetailPageReducer({ loading: false, error: '' }, { loading: true })).toMatchObject({
      loading: true,
      error: ''
    });
  });
});
