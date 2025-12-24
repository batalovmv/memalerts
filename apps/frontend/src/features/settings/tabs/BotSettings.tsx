import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ensureMinDuration } from '@/shared/lib/ensureMinDuration';
import { Button } from '@/shared/ui';

export function BotSettings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<'toggle' | 'load' | null>(null);
  const [botEnabled, setBotEnabled] = useState<boolean | null>(null);

  const loadSubscription = async () => {
    try {
      setLoading('load');
      const { api } = await import('@/lib/api');
      const res = await api.get<{ enabled?: boolean | null }>('/streamer/bot/subscription', { timeout: 8000 });
      if (typeof res?.enabled === 'boolean') {
        setBotEnabled(res.enabled);
      } else {
        setBotEnabled(null);
      }
    } catch (error: unknown) {
      // If backend doesn't support it yet, keep optimistic UI (unknown until toggled).
      const apiError = error as { response?: { status?: number } };
      if (apiError.response?.status === 404) {
        setBotEnabled(null);
        return;
      }
      setBotEnabled(null);
      // Don't spam toast on initial page load; keep quiet unless user interacts.
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    void loadSubscription();
  }, []);

  const callToggle = async (nextEnabled: boolean) => {
    const startedAt = Date.now();
    try {
      setLoading('toggle');
      const { api } = await import('@/lib/api');
      await api.post(nextEnabled ? '/streamer/bot/enable' : '/streamer/bot/disable');
      setBotEnabled(nextEnabled);
      toast.success(nextEnabled ? t('admin.botEnabled', { defaultValue: 'Bot enabled.' }) : t('admin.botDisabled', { defaultValue: 'Bot disabled.' }));
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      const { getRequestIdFromError } = await import('@/lib/api');
      const rid = getRequestIdFromError(error);
      const fallback =
        nextEnabled
          ? t('admin.failedToEnableBot', { defaultValue: 'Failed to enable bot.' })
          : t('admin.failedToDisableBot', { defaultValue: 'Failed to disable bot.' });

      const msg = apiError.response?.data?.error || fallback;
      toast.error(rid ? `${msg} (${t('common.errorId', { defaultValue: 'Error ID' })}: ${rid})` : msg);
    } finally {
      await ensureMinDuration(startedAt, 500);
      setLoading(null);
    }
  };

  const isBusy = loading !== null;
  const isLoaded = botEnabled !== null;

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

      <div className={`glass p-4 ${isBusy ? 'pointer-events-none opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white">
              {t('admin.botToggleTitle', { defaultValue: 'Chat bot' })}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {t('admin.botToggleHint', { defaultValue: 'When enabled, the runner will join your chat.' })}
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={botEnabled ?? false}
              onChange={(e) => void callToggle(e.target.checked)}
              className="sr-only peer"
              disabled={isBusy || !isLoaded}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary" />
          </label>
        </div>

        {!isLoaded && (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {loading === 'load'
              ? t('admin.botStatusLoading', { defaultValue: 'Loading status…' })
              : t('admin.botStatusUnknown', { defaultValue: 'Status is unknown.' })}
          </div>
        )}

        <div className="mt-3 flex gap-3">
          <Button
            type="button"
            variant="primary"
            onClick={() => void callToggle(true)}
            disabled={isBusy || !isLoaded || botEnabled === true}
          >
            {t('admin.enableBot', { defaultValue: 'Enable' })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void callToggle(false)}
            disabled={isBusy || !isLoaded || botEnabled === false}
          >
            {t('admin.disableBot', { defaultValue: 'Disable' })}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void loadSubscription()} disabled={isBusy}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      </div>
    </div>
  );
}


