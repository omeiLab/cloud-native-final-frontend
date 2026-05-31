import React from 'react';
import { describe, expect, it } from 'vitest';
import { APP_COPY, EVENT_STATUS_LABELS, ROLE_LABELS } from '../en.js';

describe('en copy module', () => {
  it('exports app and status labels', () => {
    expect(APP_COPY.brandName).toBe('CETS Events');
    expect(EVENT_STATUS_LABELS.PUBLISHED).toBe('Published');
    expect(ROLE_LABELS.EMPLOYEE).toBe('Employee');
  });
});
