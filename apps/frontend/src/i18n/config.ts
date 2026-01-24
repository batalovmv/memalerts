import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import enTranslations from '../locales/en.json';
import ruTranslations from '../locales/ru.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      ru: {
        translation: ruTranslations,
      },
    },
    fallbackLng: 'en',
    debug: false,
    saveMissing: true,
    missingKeyHandler: (_lng, _ns, key) => {
      console.warn(`Missing i18n key: ${key}`);
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;

