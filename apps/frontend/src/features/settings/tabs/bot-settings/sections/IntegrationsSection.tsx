import { useTranslation } from 'react-i18next';

import { TwitchPanel } from './integrations/TwitchPanel';
import { VkPanel } from './integrations/VkPanel';
import { YouTubePanel } from './integrations/YouTubePanel';

import type { UseBotSettingsResult } from '../hooks/useBotSettings';

type IntegrationsSectionProps = {
  settings: UseBotSettingsResult;
};

export const IntegrationsSection = ({ settings }: IntegrationsSectionProps) => {
  const { t } = useTranslation();
  const { botTab, setBotTab } = settings;

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
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
      </div>

      {botTab === 'twitch' ? <TwitchPanel settings={settings} /> : botTab === 'youtube' ? <YouTubePanel settings={settings} /> : <VkPanel settings={settings} />}
    </>
  );
};
