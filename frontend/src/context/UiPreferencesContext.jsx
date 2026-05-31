import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { theme as antdTheme } from 'antd';

const UiPreferencesContext = createContext(null);

const STORAGE_KEYS = {
  colorMode: 'cets_color_mode',
  textScale: 'cets_text_scale',
  locale: 'cets_locale_v2'
};

/** First-visit defaults: Traditional Chinese, dark theme, large text. */
export const UI_PREFERENCE_DEFAULTS = {
  colorMode: 'dark',
  textScale: 'large',
  locale: 'zh-TW'
};

const readStored = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

const readInitialLocale = () => {
  const stored =
    readStored(STORAGE_KEYS.locale, null)
    ?? readStored('cets_locale', null);
  if (stored === 'en' || stored === 'zh-TW') {
    return stored;
  }
  return UI_PREFERENCE_DEFAULTS.locale;
};

export const UiPreferencesProvider = ({ children }) => {
  const [colorMode, setColorMode] = useState(() =>
    readStored(STORAGE_KEYS.colorMode, UI_PREFERENCE_DEFAULTS.colorMode)
  );
  const [textScale, setTextScale] = useState(() =>
    readStored(STORAGE_KEYS.textScale, UI_PREFERENCE_DEFAULTS.textScale)
  );
  const [locale, setLocale] = useState(readInitialLocale);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.colorMode, colorMode);
      localStorage.setItem(STORAGE_KEYS.textScale, textScale);
      localStorage.setItem(STORAGE_KEYS.locale, locale);
    } catch {
      // ignore
    }
  }, [colorMode, textScale, locale]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale === 'zh-TW' ? 'zh-Hant-TW' : 'en';
    root.classList.toggle('theme-dark', colorMode === 'dark');
    root.classList.toggle('theme-light', colorMode !== 'dark');
    root.classList.toggle('text-large', textScale === 'large');
    root.classList.toggle('text-xlarge', textScale === 'xlarge');
  }, [colorMode, textScale, locale]);

  const antdConfig = useMemo(() => {
    const isDark = colorMode === 'dark';
    const baseFontSize = textScale === 'xlarge' ? 20 : textScale === 'large' ? 16 : 14;
    return {
      theme: {
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#da291c',
          colorInfo: '#da291c',
          colorSuccess: '#03904a',
          colorWarning: '#f13a2c',
          colorError: '#da291c',
          colorText: isDark ? '#ffffff' : '#181818',
          colorTextSecondary: isDark ? '#b7b7b7' : '#666666',
          colorBorder: isDark ? 'rgba(255, 255, 255, 0.16)' : '#d6d6d6',
          colorBgLayout: isDark ? '#181818' : '#f4f4f4',
          colorBgContainer: isDark ? '#242424' : '#ffffff',
          colorBgElevated: isDark ? '#303030' : '#ffffff',
          borderRadius: 12,
          borderRadiusSM: 8,
          borderRadiusXS: 6,
          borderRadiusLG: 24,
          fontSize: baseFontSize,
          fontFamily: "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif",
          boxShadowSecondary: isDark ? '0 22px 58px rgba(0, 0, 0, 0.44)' : '0 20px 54px rgba(24, 24, 24, 0.14)'
        },
        components: {
          Card: {
            borderRadiusLG: 24,
            headerFontSize: baseFontSize + 1
          },
          Button: {
            controlHeight: textScale === 'xlarge' ? 52 : textScale === 'large' ? 44 : 40,
            borderRadius: 999,
            fontWeight: 700
          },
          Input: { borderRadius: 12 },
          InputNumber: { borderRadius: 12 },
          Select: { borderRadius: 12 },
          DatePicker: { borderRadius: 12 },
          Modal: { borderRadiusLG: 24 },
          Table: { borderRadiusLG: 18 },
          Drawer: { borderRadiusLG: 24 }
        }
      }
    };
  }, [colorMode, textScale]);

  const value = useMemo(() => ({
    colorMode,
    setColorMode,
    textScale,
    setTextScale,
    locale,
    setLocale,
    antdConfig
  }), [colorMode, textScale, locale, antdConfig]);

  return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>;
};

export const useUiPreferences = () => {
  const ctx = useContext(UiPreferencesContext);
  if (!ctx) {
    throw new Error('useUiPreferences must be used inside UiPreferencesProvider');
  }
  return ctx;
};
