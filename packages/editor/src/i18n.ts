import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en, zh } from './locales';

export type PlumeLanguage = 'zh' | 'en';

const LANG_KEY = 'plume.lang';

export function readLanguage(): PlumeLanguage {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'zh';
}

export function setLanguage(language: PlumeLanguage): void {
  try {
    localStorage.setItem(LANG_KEY, language);
  } catch {
    /* storage unavailable */
  }
  void i18n.changeLanguage(language);
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: readLanguage(),
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en'],
    interpolation: { escapeValue: false },
  });
}

if (typeof document !== 'undefined') document.documentElement.lang = readLanguage();

export default i18n;
