import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, IconButton, Modal, Textarea } from '@/shared/ui';

import { XIcon } from './icons';

export type NeedsChangesPreset = {
  badTitle: boolean;
  noTags: boolean;
  other: boolean;
};

export type NeedsChangesModalProps = {
  isOpen: boolean;
  remainingResubmits: number;
  preset: NeedsChangesPreset;
  onPresetChange: (next: NeedsChangesPreset) => void;
  message: string;
  onMessageChange: (next: string) => void;
  onClose: () => void;
  onSend: () => void | Promise<void>;
};

export function NeedsChangesModal({
  isOpen,
  remainingResubmits,
  preset,
  onPresetChange,
  message,
  onMessageChange,
  onClose,
  onSend,
}: NeedsChangesModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  const checkboxBase =
    'h-4 w-4 rounded border-black/10 dark:border-white/15 bg-white/50 dark:bg-white/10 text-primary focus:ring-2 focus:ring-primary/30';

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
          {t('submissions.needsChangesTitle', { defaultValue: 'Send for changes' })}
        </h2>
        <IconButton
          icon={<XIcon className="h-5 w-5" />}
          onClick={onClose}
          aria-label={t('common.close', { defaultValue: 'Close' })}
        />
      </div>

      <div className="p-5 space-y-4">
        <div className="rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20 px-4 py-3">
          <p className="text-sm text-amber-950 dark:text-amber-100 font-medium">
            {t('submissions.resubmitsInfo', {
              defaultValue: 'User can resubmit up to {{max}} times. Remaining: {{left}}.',
              max: 2,
              left: remainingResubmits,
            })}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('submissions.quickReasons', { defaultValue: 'Quick reasons' })}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 select-none">
            <input
              type="checkbox"
              className={checkboxBase}
              checked={preset.badTitle}
              onChange={(e) => onPresetChange({ ...preset, badTitle: e.target.checked })}
            />
            {t('submissions.reasonBadTitle', { defaultValue: 'Title is not OK' })}
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 select-none">
            <input
              type="checkbox"
              className={checkboxBase}
              checked={preset.noTags}
              onChange={(e) => onPresetChange({ ...preset, noTags: e.target.checked })}
            />
            {t('submissions.reasonNoTags', { defaultValue: 'No tags' })}
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 select-none">
            <input
              type="checkbox"
              className={checkboxBase}
              checked={preset.other}
              onChange={(e) => onPresetChange({ ...preset, other: e.target.checked })}
            />
            {t('submissions.reasonOther', { defaultValue: 'Other (write below)' })}
          </label>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('submissions.messageToUser', { defaultValue: 'Message to user (optional)' })}
          </label>
          <Textarea
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            rows={4}
            placeholder={t('submissions.messagePlaceholder', { defaultValue: 'Explain what to fix…' })}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('submissions.messageHint', { defaultValue: 'This will be shown to the submitter.' })}
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="button" variant="warning" className="flex-1" onClick={() => void onSend()}>
            {t('submissions.sendForChanges', { defaultValue: 'Send' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}


