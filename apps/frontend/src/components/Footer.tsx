import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';

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
    <footer className="bg-gray-800 dark:bg-gray-900 text-white mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="mb-4 md:mb-0">
            <p className="text-sm">
              {t('footer.madeBy')} <span className="font-semibold">{t('footer.author')}</span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Language Toggle */}
            <button
              onClick={toggleLanguage}
              className="text-sm hover:text-accent transition-colors px-3 py-1 rounded border border-gray-600 hover:border-accent"
              title={i18n.language === 'ru' ? t('footer.switchToEnglish') : t('footer.switchToRussian')}
            >
              {currentLang}
            </button>
            
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="text-sm hover:text-accent transition-colors px-3 py-1 rounded border border-gray-600 hover:border-accent"
              title={theme === 'dark' ? t('footer.switchToLightTheme') : t('footer.switchToDarkTheme')}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            
            <a
              href="https://twitch.tv/LOTAS_bro"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:text-accent transition-colors"
            >
              twitch.tv/LOTAS_bro
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

