import { useTranslation } from 'react-i18next';

type SubmitInfoPanelProps = {
  isOwnerBypassTarget: boolean;
};

export function SubmitInfoPanel({ isOwnerBypassTarget }: SubmitInfoPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="glass p-3 sm:p-4">
      <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
        <strong>{t('submitModal.whatHappensNext', { defaultValue: 'What happens next?' })}</strong>{' '}
        {isOwnerBypassTarget
          ? t('submitModal.directApprovalProcess', {
              defaultValue: 'Since you are submitting to your own channel, the meme will be added immediately.',
            })
          : t('submitModal.approvalProcess', {
              defaultValue:
                'Your submission will be reviewed by moderators. Once approved, it will appear in the meme list.',
            })}
      </p>
    </div>
  );
}
