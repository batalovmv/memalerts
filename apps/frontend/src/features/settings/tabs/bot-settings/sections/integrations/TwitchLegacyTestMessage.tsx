import { useTranslation } from 'react-i18next';

import type { UseBotSettingsResult } from '../../hooks/useBotSettings';

import { Button, HelpTooltip, Textarea } from '@/shared/ui';

type TwitchLegacyTestMessageProps = {
  settings: UseBotSettingsResult;
};

export const TwitchLegacyTestMessage = ({ settings }: TwitchLegacyTestMessageProps) => {
  const { t } = useTranslation();
  const { testMessage, setTestMessage, sendingTestMessage, sendTestMessage, renderOutboxStatus } = settings;

  return (
    <div className="rounded-xl bg-white/40 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 p-4">
      <div className="font-semibold text-gray-900 dark:text-white">
        {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
        {t('admin.botTestMessageHint', {
          defaultValue:
            'Send a message from the bot into your chat. This helps confirm the bot is connected and visible.',
        })}
      </div>

      <div className="mt-3 space-y-3">
        <Textarea
          rows={2}
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          placeholder={t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ?' })}
        />
        <HelpTooltip
          content={t('help.settings.bot.sendTestMessage', {
            defaultValue: 'Send a message from the bot to chat to check that it works.',
          })}
        >
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              void sendTestMessage('twitch');
            }}
            disabled={sendingTestMessage}
          >
            {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
          </Button>
        </HelpTooltip>
        {renderOutboxStatus('twitch')}
      </div>
    </div>
  );
};
