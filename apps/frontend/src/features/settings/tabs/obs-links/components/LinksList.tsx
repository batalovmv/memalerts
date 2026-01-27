import { useTranslation } from 'react-i18next';

import { RotateIcon } from '../../obs/ui/RotateIcon';

import { HelpTooltip, IconButton } from '@/shared/ui';
import SecretCopyField from '@/shared/ui/SecretCopyField/SecretCopyField';

type LinksListProps = {
  overlayUrlWithDefaults: string;
  overlayToken: string;
  loadingToken: boolean;
  rotatingOverlayToken: boolean;
  onRotateOverlayToken: () => void | Promise<void>;
};

export function LinksList({
  overlayUrlWithDefaults,
  overlayToken,
  loadingToken,
  rotatingOverlayToken,
  onRotateOverlayToken,
}: LinksListProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
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
    </div>
  );
}
