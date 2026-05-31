import en from './en';
import zhTW from './zh-TW';

export const LOCALES = {
  en: { code: 'en', label: 'English', bundle: en },
  'zh-TW': { code: 'zh-TW', label: '繁體中文', bundle: zhTW }
};

export const getLocaleBundle = (locale) => (
  LOCALES[locale]?.bundle || LOCALES.en.bundle
);

export { labelOr } from './labelOr';
