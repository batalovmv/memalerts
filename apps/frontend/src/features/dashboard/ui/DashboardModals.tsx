import { Suspense, lazy } from 'react';

import type { BulkActionKind } from '@/features/dashboard/types';
import type { NeedsChangesPreset } from '@/features/dashboard/ui/modals/NeedsChangesModal';
import type { MemeDetail, Submission } from '@memalerts/api-contracts';

import { DashboardBulkConfirmDialog } from '@/features/dashboard/ui/DashboardBulkConfirmDialog';
import { ApproveSubmissionModal } from '@/features/dashboard/ui/modals/ApproveSubmissionModal';
import { NeedsChangesModal } from '@/features/dashboard/ui/modals/NeedsChangesModal';
import { RejectSubmissionModal } from '@/features/dashboard/ui/modals/RejectSubmissionModal';

const SubmitModal = lazy(() => import('@/components/SubmitModal'));
const MemeModal = lazy(() => import('@/components/MemeModal'));

type DashboardModalsProps = {
  channelId?: string | null;
  channelSlug?: string;
  isSubmitModalOpen: boolean;
  onCloseSubmitModal: () => void;
  isMemeModalOpen: boolean;
  selectedMeme: MemeDetail | null;
  onCloseMemeModal: () => void;
  approveModalOpen: boolean;
  approveSubmission: Submission | null;
  priceCoins: string;
  onPriceCoinsChange: (next: string) => void;
  approveTags: string[];
  onApproveTagsChange: (next: string[]) => void;
  onCloseApproveModal: () => void;
  onApprove: () => void | Promise<void>;
  needsChangesModalOpen: boolean;
  needsChangesRemainingResubmits: number;
  needsChangesPreset: NeedsChangesPreset;
  onNeedsChangesPresetChange: (next: NeedsChangesPreset) => void;
  needsChangesText: string;
  onNeedsChangesTextChange: (next: string) => void;
  onCloseNeedsChangesModal: () => void;
  onSendNeedsChanges: () => void;
  rejectModalOpen: boolean;
  rejectReason: string;
  onRejectReasonChange: (next: string) => void;
  onCloseRejectModal: () => void;
  onReject: () => void;
  bulkModalOpen: boolean;
  bulkAction: BulkActionKind;
  bulkCount: number;
  bulkActionLoading: boolean;
  bulkPriceCoins: string;
  onBulkPriceCoinsChange: (next: string) => void;
  bulkRejectReason: string;
  onBulkRejectReasonChange: (next: string) => void;
  bulkNeedsChangesPreset: NeedsChangesPreset;
  onBulkNeedsChangesPresetChange: (next: NeedsChangesPreset) => void;
  bulkNeedsChangesText: string;
  onBulkNeedsChangesTextChange: (next: string) => void;
  bulkCheckboxClassName: string;
  onBulkConfirm: () => void;
  onCloseBulkModal: () => void;
};

export function DashboardModals({
  channelId,
  channelSlug,
  isSubmitModalOpen,
  onCloseSubmitModal,
  isMemeModalOpen,
  selectedMeme,
  onCloseMemeModal,
  approveModalOpen,
  approveSubmission,
  priceCoins,
  onPriceCoinsChange,
  approveTags,
  onApproveTagsChange,
  onCloseApproveModal,
  onApprove,
  needsChangesModalOpen,
  needsChangesRemainingResubmits,
  needsChangesPreset,
  onNeedsChangesPresetChange,
  needsChangesText,
  onNeedsChangesTextChange,
  onCloseNeedsChangesModal,
  onSendNeedsChanges,
  rejectModalOpen,
  rejectReason,
  onRejectReasonChange,
  onCloseRejectModal,
  onReject,
  bulkModalOpen,
  bulkAction,
  bulkCount,
  bulkActionLoading,
  bulkPriceCoins,
  onBulkPriceCoinsChange,
  bulkRejectReason,
  onBulkRejectReasonChange,
  bulkNeedsChangesPreset,
  onBulkNeedsChangesPresetChange,
  bulkNeedsChangesText,
  onBulkNeedsChangesTextChange,
  bulkCheckboxClassName,
  onBulkConfirm,
  onCloseBulkModal,
}: DashboardModalsProps) {
  return (
    <>
      <Suspense fallback={null}>
        {channelId && (
          <SubmitModal
            isOpen={isSubmitModalOpen}
            onClose={onCloseSubmitModal}
            channelSlug={channelSlug}
            channelId={channelId}
          />
        )}

        {isMemeModalOpen && (
          <MemeModal
            meme={selectedMeme}
            isOpen={isMemeModalOpen}
            onClose={onCloseMemeModal}
            onUpdate={() => {
              // All memes panel is loaded via paginated search; no global refresh needed here.
            }}
            isOwner={true}
            mode="admin"
          />
        )}
      </Suspense>

      <ApproveSubmissionModal
        isOpen={approveModalOpen}
        submission={approveSubmission}
        priceCoins={priceCoins}
        onPriceCoinsChange={onPriceCoinsChange}
        tags={approveTags}
        onTagsChange={onApproveTagsChange}
        onClose={onCloseApproveModal}
        onApprove={onApprove}
      />

      <NeedsChangesModal
        isOpen={needsChangesModalOpen}
        remainingResubmits={needsChangesRemainingResubmits}
        preset={needsChangesPreset}
        onPresetChange={onNeedsChangesPresetChange}
        message={needsChangesText}
        onMessageChange={onNeedsChangesTextChange}
        onClose={onCloseNeedsChangesModal}
        onSend={onSendNeedsChanges}
      />

      <RejectSubmissionModal
        isOpen={rejectModalOpen}
        rejectReason={rejectReason}
        onRejectReasonChange={onRejectReasonChange}
        onClose={onCloseRejectModal}
        onReject={onReject}
      />

      <DashboardBulkConfirmDialog
        isOpen={bulkModalOpen}
        action={bulkAction}
        bulkCount={bulkCount}
        isLoading={bulkActionLoading}
        bulkPriceCoins={bulkPriceCoins}
        onBulkPriceCoinsChange={onBulkPriceCoinsChange}
        bulkRejectReason={bulkRejectReason}
        onBulkRejectReasonChange={onBulkRejectReasonChange}
        bulkNeedsChangesPreset={bulkNeedsChangesPreset}
        onBulkNeedsChangesPresetChange={onBulkNeedsChangesPresetChange}
        bulkNeedsChangesText={bulkNeedsChangesText}
        onBulkNeedsChangesTextChange={onBulkNeedsChangesTextChange}
        checkboxClassName={bulkCheckboxClassName}
        onConfirm={onBulkConfirm}
        onClose={onCloseBulkModal}
      />
    </>
  );
}


