import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { Button } from '@/shared/ui';

export function BotSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<'enable' | 'disable' | null>(null);

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
    </div>
  );
}


