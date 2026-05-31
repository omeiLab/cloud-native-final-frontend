import React from 'react';
import { describe, expect, it } from 'vitest';
import { messages, EVENT_STATUS_LABELS, ROLE_LABELS } from '../en.js';

describe('en copy module', () => {
  it('exports app and status labels', () => {
    expect(messages.header.brandLine2).toBe('CETS Events');
    expect(EVENT_STATUS_LABELS.PUBLISHED).toBe('Published');
    expect(ROLE_LABELS.EMPLOYEE).toBe('Employee');
  });
});
