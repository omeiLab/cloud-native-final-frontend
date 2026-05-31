import { describe, expect, it } from 'vitest';
import {
  clearOidcTransientState,
  forceInteractiveLogin,
  readOidcState,
  storeOidcState
} from '../AuthContext';
import { OIDC_STATE_KEY, POST_LOGIN_REDIRECT_KEY } from '../../constant';

describe('AuthContext helpers', () => {
  it('stores and clears OIDC transient state', () => {
    storeOidcState('state-123');
    expect(readOidcState()).toBe('state-123');
    expect(localStorage.getItem(OIDC_STATE_KEY)).toBeNull();
    clearOidcTransientState();
    expect(readOidcState()).toBeNull();
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)).toBeNull();
  });

  it('forces interactive login on authorize URLs', () => {
    const url = forceInteractiveLogin('https://auth.example.com/authorize?client_id=abc');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('prompt')).toBe('login');
    expect(parsed.searchParams.get('max_age')).toBe('0');
    expect(forceInteractiveLogin('not-a-url')).toContain('prompt=login');
  });
});
