import { useTranslation } from 'react-i18next';

import { useTheme } from '../contexts/ThemeContext';
import { Button, IconButton } from '@/shared/ui';

function SunIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364-1.414 1.414M7.05 16.95l-1.414 1.414m0-11.314L7.05 7.05m9.9 9.9 1.414 1.414M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"
      />
    </svg>
  );
}

export default function Footer() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const toggleLanguage = () => {
    // Fix: when language is 'ru', switch to 'en', when 'en', switch to 'ru'
    const newLang = i18n.language === 'ru' ? 'en' : 'ru';
    i18n.changeLanguage(newLang);
  };

  // Get current language for display
  const currentLang = i18n.language === 'ru' ? 'RU' : 'EN';

  return (
    <footer className="mt-auto glass rounded-none border-t border-black/5 dark:border-white/10">
      <div className="page-container py-5">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <p className="text-sm text-gray-800 dark:text-gray-100">
              {t('footer.madeBy')} <span className="font-semibold">{t('footer.author')}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={toggleLanguage}
              size="sm"
              variant="secondary"
              className="min-w-[52px] justify-center"
              title={i18n.language === 'ru' ? t('footer.switchToEnglish') : t('footer.switchToRussian')}
              aria-label={i18n.language === 'ru' ? t('footer.switchToEnglish') : t('footer.switchToRussian')}
            >
              {currentLang}
            </Button>

            <IconButton
              onClick={toggleTheme}
              variant="secondary"
              title={theme === 'dark' ? t('footer.switchToLightTheme') : t('footer.switchToDarkTheme')}
              aria-label={theme === 'dark' ? t('footer.switchToLightTheme') : t('footer.switchToDarkTheme')}
              icon={theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            />

            <a
              href="https://twitch.tv/LOTAS_bro"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-800 dark:text-gray-100 hover:text-accent transition-colors underline decoration-black/10 dark:decoration-white/15 hover:decoration-accent/40"
            >
              twitch.tv/LOTAS_bro
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

