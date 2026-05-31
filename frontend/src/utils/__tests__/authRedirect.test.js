import { describe, expect, it } from 'vitest';
import { getPostLoginRedirectPath, getRoleHomePath, isSafeInternalPath } from '../authRedirect';

describe('auth redirect helpers', () => {
  it('maps authenticated roles to their default landing pages', () => {
    expect(getRoleHomePath('EMPLOYEE')).toBe('/');
    expect(getRoleHomePath('ADMIN')).toBe('/admin');
    expect(getRoleHomePath('ADMIN_VIEWER')).toBe('/admin');
    expect(getRoleHomePath('VERIFIER')).toBe('/verify');
    expect(getRoleHomePath('DEPENDENT')).toBe('/');
  });

  it('falls back to the role landing page when a saved path belongs to another role', () => {
    expect(getPostLoginRedirectPath({ role: 'ADMIN' }, '/events/event-1')).toBe('/admin');
    expect(getPostLoginRedirectPath({ role: 'ADMIN_VIEWER' }, '/verify')).toBe('/admin');
    expect(getPostLoginRedirectPath({ role: 'VERIFIER' }, '/me')).toBe('/verify');
    expect(getPostLoginRedirectPath({ role: 'EMPLOYEE' }, '/admin')).toBe('/');
  });

  it('only preserves safe internal paths that match the user role', () => {
    expect(getPostLoginRedirectPath({ role: 'ADMIN' }, '/admin')).toBe('/admin');
    expect(getPostLoginRedirectPath({ role: 'VERIFIER' }, '/verify')).toBe('/verify');
    expect(getPostLoginRedirectPath({ role: 'EMPLOYEE' }, '/events/event-1')).toBe('/events/event-1');
    expect(getPostLoginRedirectPath({ role: 'DEPENDENT' }, '/events/event-1')).toBe('/');
    expect(isSafeInternalPath('//evil.example/path')).toBe(false);
    expect(isSafeInternalPath('/safe/path')).toBe(true);
  });
});
