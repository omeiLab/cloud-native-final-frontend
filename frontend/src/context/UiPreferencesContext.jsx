import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { theme as antdTheme } from 'antd';

const UiPreferencesContext = createContext(null);

const STORAGE_KEYS = {
  colorMode: 'cets_color_mode',
  textScale: 'cets_text_scale'
};

const readStored = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

export const UiPreferencesProvider = ({ children }) => {
  const [colorMode, setColorMode] = useState(() => readStored(STORAGE_KEYS.colorMode, 'dark'));
  const [textScale, setTextScale] = useState(() => readStored(STORAGE_KEYS.textScale, 'large'));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.colorMode, colorMode);
      localStorage.setItem(STORAGE_KEYS.textScale, textScale);
    } catch {
      // ignore
    }
  }, [colorMode, textScale]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-dark', colorMode === 'dark');
    root.classList.toggle('text-large', textScale === 'large');
    root.classList.toggle('text-xlarge', textScale === 'xlarge');
  }, [colorMode, textScale]);

  const antdConfig = useMemo(() => {
    const isDark = colorMode === 'dark';
    const baseFontSize = textScale === 'xlarge' ? 20 : textScale === 'large' ? 16 : 14;
    return {
      theme: {
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#c8102e',
          colorInfo: '#c8102e',
          borderRadius: 12,
          borderRadiusLG: 16,
          fontSize: baseFontSize,
          boxShadowSecondary: isDark ? '0 16px 36px rgba(0, 0, 0, 0.45)' : '0 16px 36px rgba(35, 12, 16, 0.14)'
        },
        components: {
          Card: { borderRadiusLG: 16 },
          Button: { controlHeight: textScale === 'xlarge' ? 52 : textScale === 'large' ? 44 : 40, borderRadius: 12 }
        }
      }
    };
  }, [colorMode, textScale]);

  const value = useMemo(() => ({
    colorMode,
    setColorMode,
    textScale,
    setTextScale,
    antdConfig
  }), [colorMode, textScale, antdConfig]);

  return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>;
};

export const useUiPreferences = () => {
  const ctx = useContext(UiPreferencesContext);
  if (!ctx) {
    throw new Error('useUiPreferences must be used inside UiPreferencesProvider');
  }
  return ctx;
};

