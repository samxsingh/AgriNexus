import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import translationEN from './locales/en/translation.json';
import translationHI from './locales/hi/translation.json';
import translationMR from './locales/mr/translation.json';
import translationPA from './locales/pa/translation.json';
import translationGU from './locales/gu/translation.json';
import translationBN from './locales/bn/translation.json';
import translationTA from './locales/ta/translation.json';
import translationTE from './locales/te/translation.json';
import translationKN from './locales/kn/translation.json';
import translationML from './locales/ml/translation.json';

const resources = {
  en: { translation: translationEN },
  hi: { translation: translationHI },
  mr: { translation: translationMR },
  pa: { translation: translationPA },
  gu: { translation: translationGU },
  bn: { translation: translationBN },
  ta: { translation: translationTA },
  te: { translation: translationTE },
  kn: { translation: translationKN },
  ml: { translation: translationML },
};

const savedLanguage = localStorage.getItem('languagePreference') || 'en';
const initialLng = resources[savedLanguage] ? savedLanguage : 'en';

// Humanize raw key so dots like 'farmer.book_slot' never appear raw in UI
const formatMissingKey = (key) => {
  if (import.meta.env.DEV) {
    console.warn(`[i18n Warning] Missing translation key: "${key}" in language: "${i18n.language || savedLanguage}"`);
  }
  const segment = key.includes('.') ? key.split('.').pop() : key;
  return segment
    .split('_')
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLng,
    fallbackLng: 'en',
    returnEmptyString: false,
    returnNull: false,
    parseMissingKeyHandler: formatMissingKey,
    missingKeyHandler: (lng, ns, key) => {
      if (import.meta.env.DEV) {
        console.warn(`[i18n Missing] [${lng}:${ns}] "${key}"`);
      }
    },
    interpolation: {
      escapeValue: false, // React handles XSS escaping
    },
  });

export default i18n;
