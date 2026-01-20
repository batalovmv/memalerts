import { useTranslation } from 'react-i18next';

import type { UseBotCommandsResult } from '../hooks/useBotCommands';
import type { UseBotSettingsResult } from '../hooks/useBotSettings';
import { CommandsSection } from './CommandsSection';
import { TriggersSection } from './TriggersSection';
import { KickPanel } from './integrations/KickPanel';
import { TrovoPanel } from './integrations/TrovoPanel';
import { TwitchPanel } from './integrations/TwitchPanel';
import { VkPanel } from './integrations/VkPanel';
import { YouTubePanel } from './integrations/YouTubePanel';

type IntegrationsSectionProps = {
  settings: UseBotSettingsResult;
  commands: UseBotCommandsResult;
};

export const IntegrationsSection = ({ settings, commands }: IntegrationsSectionProps) => {
  const { t } = useTranslation();
  const { botTab, setBotTab } = settings;

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => {
            setBotTab('commands');
          }}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            botTab === 'commands'
              ? 'bg-primary text-white border-primary'
              : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          {t('admin.botCommandsTitle', { defaultValue: 'Общие' })}
        </button>
        <button
          type="button"
          onClick={() => {
            setBotTab('twitch');
          }}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            botTab === 'twitch'
              ? 'bg-primary text-white border-primary'
              : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          Twitch
        </button>
        <button
          type="button"
          onClick={() => {
            setBotTab('youtube');
          }}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            botTab === 'youtube'
              ? 'bg-primary text-white border-primary'
              : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          YouTube
        </button>
        <button
          type="button"
          onClick={() => {
            setBotTab('vk');
          }}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            botTab === 'vk'
              ? 'bg-primary text-white border-primary'
              : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          VKVideo
        </button>
        <button
          type="button"
          onClick={() => {
            setBotTab('trovo');
          }}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            botTab === 'trovo'
              ? 'bg-primary text-white border-primary'
              : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          Trovo
        </button>
        <button
          type="button"
          onClick={() => {
            setBotTab('kick');
          }}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            botTab === 'kick'
              ? 'bg-primary text-white border-primary'
              : 'bg-transparent text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          Kick
        </button>
      </div>

      {botTab === 'commands' ? (
        <>
          <div className="glass p-5 sm:p-6 mb-4">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.botMenusTitle', { defaultValue: 'Общие' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.botCommandsHint', {
                defaultValue: 'Команды и шаблоны работают для всех платформ (Twitch/YouTube/VKVideo).',
              })}
            </div>
          </div>

          <TriggersSection commands={commands} />
          <CommandsSection commands={commands} />
        </>
      ) : botTab === 'twitch' ? (
        <TwitchPanel settings={settings} commands={commands} />
      ) : botTab === 'youtube' ? (
        <YouTubePanel settings={settings} />
      ) : botTab === 'trovo' ? (
        <TrovoPanel settings={settings} />
      ) : botTab === 'kick' ? (
        <KickPanel settings={settings} />
      ) : (
        <VkPanel settings={settings} />
      )}
    </>
  );
};
