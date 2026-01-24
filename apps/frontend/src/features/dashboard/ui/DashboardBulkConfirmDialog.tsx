import { useTranslation } from 'react-i18next';

import type { BulkActionKind } from '@/features/dashboard/types';
import type { NeedsChangesPreset } from '@/features/dashboard/ui/modals/NeedsChangesModal';

import { Input, Textarea } from '@/shared/ui';
import ConfirmDialog from '@/shared/ui/modals/ConfirmDialog';

type DashboardBulkConfirmDialogProps = {
  isOpen: boolean;
  action: BulkActionKind;
  bulkCount: number;
  isLoading: boolean;
  bulkPriceCoins: string;
  onBulkPriceCoinsChange: (next: string) => void;
  bulkRejectReason: string;
  onBulkRejectReasonChange: (next: string) => void;
  bulkNeedsChangesPreset: NeedsChangesPreset;
  onBulkNeedsChangesPresetChange: (next: NeedsChangesPreset) => void;
  bulkNeedsChangesText: string;
  onBulkNeedsChangesTextChange: (next: string) => void;
  checkboxClassName: string;
  onConfirm: () => void;
  onClose: () => void;
};

export function DashboardBulkConfirmDialog({
  isOpen,
  action,
  bulkCount,
  isLoading,
  bulkPriceCoins,
  onBulkPriceCoinsChange,
  bulkRejectReason,
  onBulkRejectReasonChange,
  bulkNeedsChangesPreset,
  onBulkNeedsChangesPresetChange,
  bulkNeedsChangesText,
  onBulkNeedsChangesTextChange,
  checkboxClassName,
  onConfirm,
  onClose,
}: DashboardBulkConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      isLoading={isLoading}
      title={
        action === 'approve'
          ? t('dashboard.bulk.approveTitle', { defaultValue: 'Approve {{count}} submissions', count: bulkCount })
          : action === 'needs_changes'
            ? t('dashboard.bulk.needsChangesTitle', { defaultValue: 'Send {{count}} submissions for changes', count: bulkCount })
            : t('dashboard.bulk.rejectTitle', { defaultValue: 'Reject {{count}} submissions', count: bulkCount })
      }
      confirmText={
        action === 'approve'
          ? t('admin.approve', { defaultValue: 'Approve' })
          : action === 'needs_changes'
            ? t('submissions.sendForChanges', { defaultValue: 'Send' })
            : t('admin.reject', { defaultValue: 'Reject' })
      }
      cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
      confirmButtonClass={
        action === 'approve'
          ? 'bg-emerald-600 hover:bg-emerald-700'
          : action === 'needs_changes'
            ? 'bg-amber-500 hover:bg-amber-600'
            : 'bg-red-600 hover:bg-red-700'
      }
      message={
        action === 'approve' ? (
          <div className="space-y-3">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {t('dashboard.bulk.confirmHint', {
                defaultValue: 'This will apply to {{count}} submissions.',
                count: bulkCount,
              })}
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.priceCoins', { defaultValue: 'Price (coins)' })}
              </label>
              <Input
                type="number"
                min={1}
                value={bulkPriceCoins}
                onChange={(e) => onBulkPriceCoinsChange(e.target.value)}
                required
                inputMode="numeric"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('admin.priceCoinsDescription', { defaultValue: 'Minimum 1 coin' })}
              </p>
            </div>
          </div>
        ) : action === 'needs_changes' ? (
          <div className="space-y-4">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {t('dashboard.bulk.confirmHint', {
                defaultValue: 'This will apply to {{count}} submissions.',
                count: bulkCount,
              })}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('submissions.quickReasons', { defaultValue: 'Quick reasons' })}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 select-none">
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={bulkNeedsChangesPreset.badTitle}
                  onChange={(e) => onBulkNeedsChangesPresetChange({ ...bulkNeedsChangesPreset, badTitle: e.target.checked })}
                />
                {t('submissions.reasonBadTitle', { defaultValue: 'Title is not OK' })}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 select-none">
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={bulkNeedsChangesPreset.noTags}
                  onChange={(e) => onBulkNeedsChangesPresetChange({ ...bulkNeedsChangesPreset, noTags: e.target.checked })}
                />
                {t('submissions.reasonNoTags', { defaultValue: 'No tags' })}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 select-none">
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={bulkNeedsChangesPreset.other}
                  onChange={(e) => onBulkNeedsChangesPresetChange({ ...bulkNeedsChangesPreset, other: e.target.checked })}
                />
                {t('submissions.reasonOther', { defaultValue: 'Other (write below)' })}
              </label>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('submissions.messageToUser', { defaultValue: 'Message to user (optional)' })}
              </label>
              <Textarea
                value={bulkNeedsChangesText}
                onChange={(e) => onBulkNeedsChangesTextChange(e.target.value)}
                rows={4}
                placeholder={t('submissions.messagePlaceholder', { defaultValue: 'Explain what to fix:' })}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('submissions.messageHint', { defaultValue: 'This will be shown to the submitter.' })}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {t('dashboard.bulk.confirmHint', {
                defaultValue: 'This will apply to {{count}} submissions.',
                count: bulkCount,
              })}
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('dashboard.bulk.rejectReasonLabel', { defaultValue: 'Reject reason (optional)' })}
              </label>
              <Textarea
                value={bulkRejectReason}
                onChange={(e) => onBulkRejectReasonChange(e.target.value)}
                rows={4}
                placeholder={t('dashboard.bulk.rejectReasonPlaceholder', { defaultValue: 'Reason for rejection (optional)' })}
              />
            </div>
          </div>
        )
      }
    />
  );
}
