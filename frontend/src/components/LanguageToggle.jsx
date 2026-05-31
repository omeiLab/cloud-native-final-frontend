import React from 'react';
import { Button, Tooltip } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import useI18n from '../hooks/useI18n';
import { LOCALES } from '../i18n';

const LanguageToggle = ({ className = 'ghost-btn', block = false }) => {
  const { locale, setLocale, m } = useI18n();
  const nextLocale = locale === 'zh-TW' ? 'en' : 'zh-TW';
  const currentLabel = locale === 'zh-TW' ? LOCALES['zh-TW'].label : LOCALES.en.label;
  const nextLabel = nextLocale === 'zh-TW' ? LOCALES['zh-TW'].label : LOCALES.en.label;

  return (
    <Tooltip title={`${m.language.toggle}：${nextLabel}`}>
      <Button
        className={className}
        block={block}
        icon={<GlobalOutlined />}
        aria-label={`${m.language.toggle}，目前 ${currentLabel}`}
        onClick={() => setLocale(nextLocale)}
      >
        {currentLabel}
      </Button>
    </Tooltip>
  );
};

export default LanguageToggle;
