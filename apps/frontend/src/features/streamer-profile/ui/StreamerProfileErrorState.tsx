import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChannelLoadError } from '@/features/streamer-profile/model/useStreamerProfileChannel';

import Header from '@/components/Header';
import { Button, PageShell } from '@/shared/ui';

type StreamerProfileErrorStateProps = {
  error: ChannelLoadError;
  normalizedSlug: string;
  onLogin: () => void;
  onRequestBeta: () => void;
  onRetry: () => void;
  onGoHome: () => void;
};

export function StreamerProfileErrorState({
  error,
  normalizedSlug,
  onLogin,
  onRequestBeta,
  onRetry,
  onGoHome,
}: StreamerProfileErrorStateProps) {
  const { t } = useTranslation();
  const isBetaRequired = error === 'beta_required';

  const isBetaHost = useMemo(() => window.location.hostname.toLowerCase().includes('beta.'), []);
  const openProduction = () => {
    try {
      if (!isBetaHost) return;
      const origin = window.location.origin;
      const prodOrigin = origin.replace('//beta.', '//');
      window.location.href = `${prodOrigin}/channel/${normalizedSlug}`;
    } catch {
      // ignore
    }
  };

  return (
    <PageShell header={<Header />}>
      <div className="min-h-[50vh] flex items-center justify-center px-4">
        <div className="surface p-6 max-w-md w-full text-center">
          <div className="text-lg font-semibold text-gray-900 dark:text-white">
            {error === 'auth_required'
              ? t('profile.authRequiredTitle', { defaultValue: 'Login required' })
              : isBetaRequired
                ? t('betaAccess.title', { defaultValue: 'Beta access required' })
                : error === 'forbidden'
                  ? t('profile.accessDeniedTitle', { defaultValue: 'Access denied' })
                  : error === 'failed'
                    ? t('profile.failedToLoadTitle', { defaultValue: 'Failed to load channel' })
                    : t('profile.channelNotFoundTitle', { defaultValue: 'Channel not found' })}
          </div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {error === 'auth_required'
              ? t('profile.authRequiredHint', { defaultValue: 'Please log in to view this channel.' })
              : isBetaRequired
                ? t('betaAccess.pageDescription', {
                    defaultValue: 'Beta is for testing new features. You can request access below.',
                  })
                : error === 'forbidden'
                  ? t('profile.accessDeniedHint', { defaultValue: 'You do not have access to view this channel.' })
                  : error === 'failed'
                    ? t('profile.failedToLoadHint', {
                        defaultValue: 'Please retry. If the problem persists, try again later.',
                      })
                    : t('profile.channelNotFoundHint', { defaultValue: 'The link may be wrong, or the channel was removed.' })}
          </div>
          <div className="mt-5 flex justify-center gap-2">
            {error === 'auth_required' ? (
              <Button type="button" variant="primary" onClick={onLogin}>
                {t('auth.login', { defaultValue: 'Log in with Twitch' })}
              </Button>
            ) : isBetaRequired ? (
              <Button type="button" variant="primary" onClick={onRequestBeta}>
                {t('betaAccess.requestButton', { defaultValue: 'Request beta access' })}
              </Button>
            ) : null}
            {isBetaRequired && isBetaHost ? (
              <Button type="button" variant="secondary" onClick={openProduction}>
                {t('betaAccess.openProductionButton', { defaultValue: 'Open production' })}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onRetry}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
            <Button type="button" variant="secondary" onClick={onGoHome}>
              {t('common.goHome', { defaultValue: 'Go home' })}
            </Button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
