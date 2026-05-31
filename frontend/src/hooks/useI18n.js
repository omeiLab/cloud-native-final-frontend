import { useMemo } from 'react';
import { useUiPreferences } from '../context/UiPreferencesContext';
import { getLocaleBundle } from '../i18n';

export const useI18n = () => {
  const { locale, setLocale } = useUiPreferences();
  const bundle = useMemo(() => getLocaleBundle(locale), [locale]);

  return useMemo(() => ({
    locale,
    setLocale,
    m: bundle.messages,
    labelOr: bundle.labelOr,
    EVENT_STATUS_LABELS: bundle.EVENT_STATUS_LABELS,
    SESSION_STATUS_LABELS: bundle.SESSION_STATUS_LABELS,
    REGISTRATION_STATUS_LABELS: bundle.REGISTRATION_STATUS_LABELS,
    TICKET_STATUS_LABELS: bundle.TICKET_STATUS_LABELS,
    ROLE_LABELS: bundle.ROLE_LABELS,
    NOTIFICATION_TYPE_LABELS: bundle.NOTIFICATION_TYPE_LABELS,
    EVENT_CARD_STATUS: bundle.EVENT_CARD_STATUS
  }), [bundle, locale, setLocale]);
};

export default useI18n;
