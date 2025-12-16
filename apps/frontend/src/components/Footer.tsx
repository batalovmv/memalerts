import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';

export default function Footer() {
  const { theme, toggleTheme } = useTheme();
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'ru' : 'en';
    i18n.changeLanguage(newLang);
  };

  return (
    <footer className="bg-gray-800 dark:bg-gray-900 text-white mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="mb-4 md:mb-0">
            <p className="text-sm">
              Made by <span className="font-semibold">Баталов Михаил</span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Language Toggle */}
            <button
              onClick={toggleLanguage}
              className="text-sm hover:text-purple-400 transition-colors px-3 py-1 rounded border border-gray-600 hover:border-purple-400"
              title={i18n.language === 'en' ? 'Switch to Russian' : 'Переключить на английский'}
            >
              {i18n.language === 'en' ? '🇷🇺 RU' : '🇬🇧 EN'}
            </button>
            
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="text-sm hover:text-purple-400 transition-colors px-3 py-1 rounded border border-gray-600 hover:border-purple-400"
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            
            <a
              href="https://twitch.tv/LOTAS_bro"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:text-purple-400 transition-colors"
            >
              twitch.tv/LOTAS_bro
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

