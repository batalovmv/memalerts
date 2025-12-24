import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { Button, Textarea } from '@/shared/ui';

export function BotSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<'enable' | 'disable' | null>(null);
  const [testMessage, setTestMessage] = useState('');

  const defaultTestMessage = useMemo(
    () => t('admin.botDefaultTestMessage', { defaultValue: 'Bot connected ✅' }),
    [t]
  );

  const call = async (action: 'enable' | 'disable') => {
    const startedAt = Date.now();
    try {
      setLoading(action);
      const { api } = await import('@/lib/api');
      await api.post(`/streamer/bot/${action}`);
      toast.success(
        action === 'enable'
          ? t('admin.botEnabled', { defaultValue: 'Bot enabled.' })
          : t('admin.botDisabled', { defaultValue: 'Bot disabled.' })
      );
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      const fallback =
        action === 'enable'
          ? t('admin.failedToEnableBot', { defaultValue: 'Failed to enable bot.' })
          : t('admin.failedToDisableBot', { defaultValue: 'Failed to disable bot.' });

      const msg = apiError.response?.data?.error || fallback;
      toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
    } finally {
      await ensureMinDuration(startedAt, 500);
      setLoading(null);
    }
  };

  const sendTestMessage = async () => {
    const startedAt = Date.now();
    const raw = testMessage.trim() || defaultTestMessage.trim();
    if (!raw) {
      toast.error(t('admin.botTestMessageRequired', { defaultValue: 'Enter a message.' }));
      return;
    }
    if (raw.length > 450) {
      toast.error(t('admin.botTestMessageTooLong', { defaultValue: 'Message is too long.' }));
      return;
    }

    try {
      setLoading('enable'); // lock both buttons while sending
      const { api } = await import('@/lib/api');
      await api.post('/streamer/bot/say', { message: raw });
      toast.success(t('admin.botTestMessageSent', { defaultValue: 'Message sent.' }));
      setTestMessage('');
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      const msg =
        apiError.response?.data?.error ||
        t('admin.failedToSendBotTestMessage', { defaultValue: 'Failed to send message.' });
      toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
    } finally {
      await ensureMinDuration(startedAt, 500);
      setLoading(null);
    }
  };

  return (
    <div className="surface p-6">
      <h2 className="text-2xl font-bold mb-2 dark:text-white">{t('admin.botTitle', { defaultValue: 'Bot' })}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
        {t('admin.botDescription', {
          defaultValue:
            'Enable/disable the chat bot subscription for your channel. The bot joins/leaves chats automatically based on this setting.',
        })}
      </p>

      <div className="rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20 px-4 py-3 mb-5">
        <p className="text-sm text-amber-950 dark:text-amber-100">
          {t('admin.botRunnerHint', {
            defaultValue:
              'Important: for the bot to actually connect to Twitch chats, the backend chatbotRunner must be running as a persistent service.',
          })}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          type="button"
          variant="success"
          onClick={() => void call('enable')}
          disabled={loading !== null}
        >
          {loading === 'enable' ? t('admin.enabling', { defaultValue: 'Enabling…' }) : t('admin.enableBot', { defaultValue: 'Enable' })}
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => void call('disable')}
          disabled={loading !== null}
        >
          {loading === 'disable' ? t('admin.disabling', { defaultValue: 'Disabling…' }) : t('admin.disableBot', { defaultValue: 'Disable' })}
        </Button>
      </div>

      <div className="mt-6 pt-6 border-t border-black/5 dark:border-white/10">
        <h3 className="text-lg font-semibold mb-2 dark:text-white">
          {t('admin.botTestMessageTitle', { defaultValue: 'Test message' })}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
          {t('admin.botTestMessageHint', {
            defaultValue:
              'Send a message from the bot into your Twitch chat. This helps confirm the bot is connected and visible.',
          })}
        </p>

        <Textarea
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          rows={3}
          placeholder={defaultTestMessage}
          disabled={loading !== null}
        />

        <div className="mt-3">
          <Button type="button" variant="primary" onClick={() => void sendTestMessage()} disabled={loading !== null}>
            {t('admin.sendTestMessage', { defaultValue: 'Send test message' })}
          </Button>
        </div>
      </div>
    </div>
  );
}


