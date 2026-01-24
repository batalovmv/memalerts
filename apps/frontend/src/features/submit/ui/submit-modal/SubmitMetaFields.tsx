import { useTranslation } from 'react-i18next';

import type { SubmitModalFormData } from '@/features/submit/model/submitModalTypes';

import { HelpTooltip, Input } from '@/shared/ui';
import TagInput from '@/shared/ui/TagInput/TagInput';

type SubmitMetaFieldsProps = {
  formData: SubmitModalFormData;
  isSubmitLocked: boolean;
  onTitleChange: (next: string) => void;
  onTagsChange: (next: string[]) => void;
};

export function SubmitMetaFields({ formData, isSubmitLocked, onTitleChange, onTagsChange }: SubmitMetaFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('submit.titleLabel')}</label>
        <HelpTooltip content={t('help.submitModal.title', { defaultValue: 'Name of the meme in the channel. Viewers will see this title.' })}>
          <Input type="text" value={formData.title} onChange={(e) => onTitleChange(e.target.value)} disabled={isSubmitLocked} />
        </HelpTooltip>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('submit.tags')}</label>
        <HelpTooltip content={t('help.submitModal.tags', { defaultValue: 'Add a few tags to help search and moderation (optional).' })}>
          <div>
            <TagInput tags={formData.tags} onChange={onTagsChange} placeholder={t('submit.addTags')} />
          </div>
        </HelpTooltip>
      </div>
    </>
  );
}
