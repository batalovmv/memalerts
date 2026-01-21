import { useTranslation } from 'react-i18next';

import { TwitchLegacyCommands } from './TwitchLegacyCommands';
import { TwitchLegacyTestMessage } from './TwitchLegacyTestMessage';
import { TwitchLegacyTriggers } from './TwitchLegacyTriggers';

import type { UseBotCommandsResult } from '../../hooks/useBotCommands';
import type { UseBotSettingsResult } from '../../hooks/useBotSettings';

type TwitchLegacyMenusProps = {
  settings: UseBotSettingsResult;
  commands: UseBotCommandsResult;
  showMenus: boolean;
  menusDisabled: boolean;
};

export const TwitchLegacyMenus = ({ settings, commands, showMenus, menusDisabled }: TwitchLegacyMenusProps) => {
  const { t } = useTranslation();
  const { menusOpen, setMenusOpen } = settings;

  return (
    <div className="mt-4 hidden">
      <button
        type="button"
        className={`w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors ${
          showMenus ? 'hover:bg-white/40 dark:hover:bg-white/5' : 'opacity-60 cursor-not-allowed'
        }`}
        disabled={!showMenus}
        onClick={() => setMenusOpen((v) => !v)}
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('admin.botMenusTitle', { defaultValue: 'Настройки' })}
        </span>
        <svg
          className={`w-4 h-4 text-gray-600 dark:text-gray-300 transition-transform ${menusOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showMenus && menusOpen && (
        <div className={`mt-3 space-y-4 ${menusDisabled ? 'pointer-events-none opacity-60' : ''}`}>
          <TwitchLegacyTriggers commands={commands} />
          <TwitchLegacyCommands commands={commands} showMenus={showMenus} />
          <TwitchLegacyTestMessage settings={settings} />
        </div>
      )}
    </div>
  );
};
