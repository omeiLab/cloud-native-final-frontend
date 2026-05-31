import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UiPreferencesProvider, useUiPreferences } from '../UiPreferencesContext';

describe('UiPreferencesContext', () => {
  it('defaults to zh-TW, dark mode, and large text when storage is empty', () => {
    localStorage.clear();
    const wrapper = ({ children }) => <UiPreferencesProvider>{children}</UiPreferencesProvider>;
    const { result } = renderHook(() => useUiPreferences(), { wrapper });

    expect(result.current.locale).toBe('zh-TW');
    expect(result.current.colorMode).toBe('dark');
    expect(result.current.textScale).toBe('large');
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.classList.contains('text-large')).toBe(true);
    expect(result.current.antdConfig.theme.token.fontSize).toBe(16);
  });

  it('persists color mode and text scale preferences', () => {
    localStorage.clear();
    const wrapper = ({ children }) => <UiPreferencesProvider>{children}</UiPreferencesProvider>;
    const { result } = renderHook(() => useUiPreferences(), { wrapper });

    act(() => {
      result.current.setColorMode('light');
      result.current.setTextScale('xlarge');
    });

    expect(result.current.colorMode).toBe('light');
    expect(result.current.textScale).toBe('xlarge');
    expect(localStorage.getItem('cets_color_mode')).toBe('light');
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    expect(result.current.antdConfig.theme.token.fontSize).toBe(20);
  });
});
