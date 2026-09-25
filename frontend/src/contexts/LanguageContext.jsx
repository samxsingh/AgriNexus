import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchSupportedLanguages,
  fetchLanguageBundle,
  translateWithBhashini,
  speakTextWithBhashini
} from '../services/bhashiniService';

const LanguageContext = createContext(null);

const DEFAULT_SUPPORTED = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिंदी' }
];

export const LanguageProvider = ({ children }) => {
  const { i18n } = useTranslation();
  const [language, setLanguage] = useState(() => localStorage.getItem('languagePreference') || 'en');
  const [supportedLanguages, setSupportedLanguages] = useState(DEFAULT_SUPPORTED);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isLoadingLanguages, setIsLoadingLanguages] = useState(true);

  // 1. Discover officially supported languages from backend Bhashini configuration
  useEffect(() => {
    let isMounted = true;
    const loadLanguages = async () => {
      try {
        setIsLoadingLanguages(true);
        const langs = await fetchSupportedLanguages();
        if (isMounted && Array.isArray(langs) && langs.length > 0) {
          setSupportedLanguages(langs);

          // If currently saved language is not among supported Bhashini languages, safely revert to English
          const isSupported = langs.some((l) => l.code === language);
          if (!isSupported && language !== 'en') {
            console.warn(`[LanguageContext] Saved language "${language}" is not supported by current Bhashini pipeline. Reverting to English.`);
            setLanguage('en');
            localStorage.setItem('languagePreference', 'en');
            i18n.changeLanguage('en');
          }
        }
      } catch (err) {
        console.warn('[LanguageContext] Failed to load supported languages:', err.message);
      } finally {
        if (isMounted) setIsLoadingLanguages(false);
      }
    };

    loadLanguages();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Load translation resource bundle and switch language
  const changeLanguage = useCallback(
    async (newLang) => {
      if (!newLang) return;
      const targetLang = newLang.toLowerCase();

      if (targetLang === 'en') {
        setLanguage('en');
        localStorage.setItem('languagePreference', 'en');
        await i18n.changeLanguage('en');
        return;
      }

      try {
        setIsTranslating(true);

        // If resource bundle for target language is not yet in react-i18next store, fetch from backend
        if (!i18n.hasResourceBundle(targetLang, 'translation')) {
          const bundle = await fetchLanguageBundle(targetLang);
          if (bundle && Object.keys(bundle).length > 0) {
            i18n.addResourceBundle(targetLang, 'translation', bundle, true, true);
          } else {
            console.warn(`[LanguageContext] No translation bundle returned for ${targetLang}. Using fallback.`);
          }
        }

        await i18n.changeLanguage(targetLang);
        setLanguage(targetLang);
        localStorage.setItem('languagePreference', targetLang);
      } catch (err) {
        console.error(`[LanguageContext] Failed to change language to ${targetLang}:`, err);
        // Resilient fallback to English on critical failure
        await i18n.changeLanguage('en');
        setLanguage('en');
      } finally {
        setIsTranslating(false);
      }
    },
    [i18n]
  );

  // 3. Ensure saved non-English language bundle is loaded on initial startup
  useEffect(() => {
    if (language && language !== 'en') {
      if (!i18n.hasResourceBundle(language, 'translation')) {
        changeLanguage(language);
      } else {
        i18n.changeLanguage(language);
      }
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    const nextLang = language === 'en' ? 'hi' : 'en';
    changeLanguage(nextLang);
  }, [language, changeLanguage]);

  // Translate any dynamic or runtime string using Bhashini proxy
  const translateDynamic = useCallback(
    async (text, targetLang = null) => {
      const target = targetLang || language;
      if (!text || target === 'en') return text;
      try {
        setIsTranslating(true);
        const res = await translateWithBhashini(text, target, 'en');
        return res;
      } finally {
        setIsTranslating(false);
      }
    },
    [language]
  );

  // Voice narration helper using Bhashini TTS or browser speech
  const speakText = useCallback(
    async (text, lang = null) => {
      const targetLang = lang || language;
      return await speakTextWithBhashini(text, targetLang);
    },
    [language]
  );

  const currentLanguageMeta = supportedLanguages.find((l) => l.code === language) || {
    code: language,
    name: language.toUpperCase(),
    nativeName: language.toUpperCase()
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        currentLanguageMeta,
        supportedLanguages,
        changeLanguage,
        toggleLanguage,
        translateDynamic,
        speakText,
        isTranslating,
        isLoadingLanguages
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

export default LanguageContext;
