import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useOidcLoginLoading } from '../useOidcLoginLoading';

describe('useOidcLoginLoading', () => {
  it('clears loading when user is not authenticated after pageshow', () => {
    const startOIDCLogin = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ authenticated }) => useOidcLoginLoading(startOIDCLogin, authenticated),
      { initialProps: { authenticated: false } }
    );

    act(() => {
      result.current.runLogin();
    });
    expect(result.current.loginLoading).toBe(true);

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(result.current.loginLoading).toBe(false);

    rerender({ authenticated: false });
    expect(result.current.loginLoading).toBe(false);
  });

  it('clears loading when login fails before redirect', async () => {
    const startOIDCLogin = vi.fn().mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useOidcLoginLoading(startOIDCLogin, false));

    await expect(act(async () => {
      await result.current.runLogin();
    })).rejects.toThrow('network');

    expect(result.current.loginLoading).toBe(false);
  });
});
