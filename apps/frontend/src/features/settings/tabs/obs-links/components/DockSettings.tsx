import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { GetDockTokenResponse, RotateDockTokenResponse } from '@memalerts/api-contracts';

import { SettingsSection } from '@/features/settings/ui/SettingsSection';
import { Button } from '@/shared/ui';
import SecretCopyField from '@/shared/ui/SecretCopyField/SecretCopyField';

export function DockSettings() {
  const { t } = useTranslation();
  const [dockUrl, setDockUrl] = useState('');
  const [dockExpiresIn, setDockExpiresIn] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rotating, setRotating] = useState(false);

  const fetchDockUrl = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { api } = await import('@/lib/api');
      const response = await api.get<GetDockTokenResponse>('/streamer/dock/token');
      if (response?.success) {
        setDockUrl(response.data.dockUrl || '');
        setDockExpiresIn(response.data.expiresIn || null);
      }
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToLoadDockUrl', { defaultValue: 'Failed to load dock URL.' }));
    } finally {
      setLoading(false);
    }
  }, [loading, t]);

  const rotateDockToken = useCallback(async () => {
    if (rotating) return;
    const ok = window.confirm(
      t('admin.obsDockRotateConfirm', { defaultValue: 'This will disconnect all existing dock connections. Continue?' }),
    );
    if (!ok) return;

    setRotating(true);
    try {
      const { api } = await import('@/lib/api');
      const response = await api.post<RotateDockTokenResponse>('/streamer/dock/token/rotate', {});
      if (response?.success) {
        setDockUrl(response.data.dockUrl || '');
        setDockExpiresIn(response.data.expiresIn || null);
        toast.success(t('admin.obsDockTokenRotated', { defaultValue: 'Dock link updated. Paste the new URL into OBS.' }));
      }
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || t('admin.failedToSave', { defaultValue: 'Failed to save' }));
    } finally {
      setRotating(false);
    }
  }, [rotating, t]);

  const dockDescription = dockExpiresIn
    ? t('admin.obsDockExpiresIn', { defaultValue: 'Expires in: {{value}}', value: dockExpiresIn })
    : t('admin.obsDockUrlHint', { defaultValue: 'Click to copy. You can reveal the URL with the eye icon.' });

  return (
    <SettingsSection
      title={t('admin.obsDockTitle', { defaultValue: 'OBS Dock Panel' })}
      description={t('admin.obsDockDescription', { defaultValue: 'Add this URL as a Custom Browser Dock in OBS for quick queue management.' })}
      contentClassName="space-y-4"
    >
      {!dockUrl ? (
        <Button type="button" variant="primary" onClick={() => void fetchDockUrl()} disabled={loading}>
          {loading ? t('common.loading', { defaultValue: 'Loading...' }) : t('admin.generateDockUrl', { defaultValue: 'Generate Dock URL' })}
        </Button>
      ) : (
        <div className="space-y-3">
          <SecretCopyField
            label={t('admin.obsDockUrl', { defaultValue: 'Dock URL (Custom Browser Dock)' })}
            value={dockUrl}
            masked={true}
            description={dockDescription}
            emptyText={t('common.notAvailable', { defaultValue: 'Not available' })}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void fetchDockUrl()}
              disabled={loading || rotating}
            >
              {loading ? t('common.loading', { defaultValue: 'Loading...' }) : t('common.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button type="button" variant="danger" onClick={() => void rotateDockToken()} disabled={rotating || loading}>
              {rotating ? t('common.loading', { defaultValue: 'Loading...' }) : t('admin.rotateDockToken', { defaultValue: 'Rotate Token' })}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl bg-black/5 dark:bg-white/5 p-4">
        <div className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
          {t('admin.obsDockHowToTitle', { defaultValue: 'How to add in OBS:' })}
        </div>
        <ol className="list-decimal list-inside text-sm text-gray-700 dark:text-gray-200 space-y-1">
          <li>{t('admin.obsDockHowToStep1', { defaultValue: 'In OBS, go to View \u2192 Docks \u2192 Custom Browser Docks.' })}</li>
          <li>{t('admin.obsDockHowToStep2', { defaultValue: 'Enter a name (e.g., "MemAlerts").' })}</li>
          <li>{t('admin.obsDockHowToStep3', { defaultValue: 'Paste the URL above.' })}</li>
          <li>{t('admin.obsDockHowToStep4', { defaultValue: 'Click Apply.' })}</li>
        </ol>
      </div>
    </SettingsSection>
  );
}
