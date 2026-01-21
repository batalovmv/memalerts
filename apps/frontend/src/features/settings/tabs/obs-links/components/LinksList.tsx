import { useTranslation } from 'react-i18next';

import { RotateIcon } from '../../obs/ui/RotateIcon';

import SecretCopyField from '@/components/SecretCopyField';
import { Button, HelpTooltip, IconButton } from '@/shared/ui';

type LinksListProps = {
  overlayKind: 'memes' | 'credits';
  setOverlayKind: (kind: 'memes' | 'credits') => void;
  creditsEnabled: boolean;
  overlayUrlWithDefaults: string;
  creditsUrlWithDefaults: string;
  overlayToken: string;
  creditsToken: string;
  loadingToken: boolean;
  loadingCreditsToken: boolean;
  rotatingOverlayToken: boolean;
  rotatingCreditsToken: boolean;
  onRotateOverlayToken: () => void | Promise<void>;
  onRotateCreditsToken: () => void | Promise<void>;
};

export function LinksList({
  overlayKind,
  setOverlayKind,
  creditsEnabled,
  overlayUrlWithDefaults,
  creditsUrlWithDefaults,
  overlayToken,
  creditsToken,
  loadingToken,
  loadingCreditsToken,
  rotatingOverlayToken,
  rotatingCreditsToken,
  onRotateOverlayToken,
  onRotateCreditsToken,
}: LinksListProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={overlayKind === 'memes' ? 'primary' : 'secondary'}
          className={overlayKind === 'memes' ? '' : 'glass-btn'}
          onClick={() => setOverlayKind('memes')}
        >
          {t('admin.obsOverlayKindMemes', { defaultValue: 'Мемы' })}
        </Button>
        {creditsEnabled ? (
          <Button
            type="button"
            size="sm"
            variant={overlayKind === 'credits' ? 'primary' : 'secondary'}
            className={overlayKind === 'credits' ? '' : 'glass-btn'}
            onClick={() => setOverlayKind('credits')}
          >
            {t('admin.obsOverlayKindCredits', { defaultValue: 'Титры' })}
          </Button>
        ) : null}
      </div>

      {overlayKind === 'memes' ? (
        <SecretCopyField
          label={t('admin.obsOverlayUrl', { defaultValue: 'Overlay URL (Browser Source)' })}
          value={overlayUrlWithDefaults}
          masked={true}
          emptyText={t('common.notAvailable', { defaultValue: 'Not available' })}
          description={
            loadingToken
              ? t('common.loading', { defaultValue: 'Loading:' })
              : t('admin.obsOverlayUrlHint', { defaultValue: 'Click to copy. You can reveal the URL with the eye icon.' })
          }
          rightActions={
            <HelpTooltip
              content={t('help.settings.obs.rotateLink', {
                defaultValue: 'Generate a new overlay link. Use this if the link was leaked - the old one will stop working.',
              })}
            >
              <IconButton
                type="button"
                variant="ghost"
                className="rounded-xl text-gray-700 dark:text-gray-200"
                onClick={(e) => {
                  e.stopPropagation();
                  void onRotateOverlayToken();
                }}
                disabled={rotatingOverlayToken || loadingToken || !overlayToken}
                aria-label={t('admin.obsOverlayRotateLink', { defaultValue: 'Update overlay link' })}
                icon={<RotateIcon />}
              />
            </HelpTooltip>
          }
        />
      ) : (
        <SecretCopyField
          label={t('admin.obsCreditsUrl', { defaultValue: 'Credits URL (Browser Source)' })}
          value={creditsUrlWithDefaults}
          masked={true}
          emptyText={t('common.notAvailable', { defaultValue: 'Not available' })}
          description={
            loadingCreditsToken
              ? t('common.loading', { defaultValue: 'Loading:' })
              : t('admin.obsOverlayUrlHint', { defaultValue: 'Click to copy. You can reveal the URL with the eye icon.' })
          }
          rightActions={
            <HelpTooltip
              content={t('help.settings.obs.rotateLink', {
                defaultValue: 'Generate a new overlay link. Use this if the link was leaked - the old one will stop working.',
              })}
            >
              <IconButton
                type="button"
                variant="ghost"
                className="rounded-xl text-gray-700 dark:text-gray-200"
                onClick={(e) => {
                  e.stopPropagation();
                  void onRotateCreditsToken();
                }}
                disabled={rotatingCreditsToken || loadingCreditsToken || !creditsToken}
                aria-label={t('admin.obsOverlayRotateLink', { defaultValue: 'Update overlay link' })}
                icon={<RotateIcon />}
              />
            </HelpTooltip>
          }
        />
      )}
    </div>
  );
}
