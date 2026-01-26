import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { XIcon } from './icons';

import type { Submission } from '@memalerts/api-contracts';

import { AiStatusBadge, Button, IconButton, Input, Modal } from '@/shared/ui';
import TagInput from '@/shared/ui/TagInput/TagInput';

export type ApproveSubmissionModalProps = {
  isOpen: boolean;
  submission?: Submission | null;
  priceCoins: string;
  onPriceCoinsChange: (next: string) => void;
  tags: string[];
  onTagsChange: (next: string[]) => void;
  onClose: () => void;
  onApprove: () => void | Promise<void>;
};

export function ApproveSubmissionModal({
  isOpen,
  submission,
  priceCoins,
  onPriceCoinsChange,
  tags,
  onTagsChange,
  onClose,
  onApprove,
}: ApproveSubmissionModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  const aiDecision = submission?.aiDecision ?? null;
  const aiStatus = submission?.aiStatus ?? null;
  const aiAutoTags = Array.isArray(submission?.aiAutoTagNamesJson)
    ? (submission?.aiAutoTagNamesJson as unknown[]).filter((x) => typeof x === 'string') as string[]
    : [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="overflow-y-auto"
      contentClassName="relative rounded-2xl max-w-md w-full overflow-hidden"
      ariaLabelledBy={titleId}
    >
      <div className="sticky top-0 bg-white/40 dark:bg-black/20 backdrop-blur border-b border-black/5 dark:border-white/10 px-5 py-4 flex items-center justify-between">
        <h2 id={titleId} className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
          {t('admin.approveSubmission', { defaultValue: 'Approve submission' })}
        </h2>
        <IconButton
          icon={<XIcon className="h-5 w-5" />}
          onClick={onClose}
          aria-label={t('common.close', { defaultValue: 'Close' })}
        />
      </div>

      <div className="p-5 space-y-4">
        {(aiDecision || aiStatus) ? (
          <div className="flex flex-wrap items-center gap-2">
            <AiStatusBadge decision={aiDecision} status={aiStatus} />
          </div>
        ) : null}

        {aiDecision === 'high' ? (
          <div className="rounded-lg bg-rose-500/10 ring-1 ring-rose-500/20 p-3 text-sm text-rose-800 dark:text-rose-200">
            {t('submissions.aiHighApproveWarning', { defaultValue: 'Скорее всего approve будет запрещён (карантин/пурж MemeAsset).' })}
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('admin.priceCoins', { defaultValue: 'Price (coins)' })}
          </label>
          <Input
            type="number"
            min={1}
            value={priceCoins}
            onChange={(e) => onPriceCoinsChange(e.target.value)}
            required
            inputMode="numeric"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('admin.priceCoinsDescription', { defaultValue: 'Minimum 1 coin' })}
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('submit.tags', { defaultValue: 'Tags (optional)' })}
          </label>
          <TagInput
            tags={tags}
            onChange={onTagsChange}
            placeholder={t('submit.addTags', { defaultValue: 'Add tags to help categorize your meme...' })}
          />
          {tags.length === 0 && aiAutoTags.length > 0 ? (
            <div className="pt-1 text-xs text-gray-600 dark:text-gray-300">
              <div className="mb-2">
                {t('submissions.aiSuggestedTags', { defaultValue: 'AI предложил теги:' })}{' '}
                <span className="font-semibold">{aiAutoTags.join(', ')}</span>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => onTagsChange(aiAutoTags)}>
                {t('submissions.fillTagsFromAi', { defaultValue: 'Заполнить из AI' })}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="button" variant="success" className="flex-1" onClick={() => void onApprove()}>
            {t('admin.approve', { defaultValue: 'Approve' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

