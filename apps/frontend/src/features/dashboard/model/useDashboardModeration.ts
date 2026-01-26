import { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { BulkActionKind } from '@/features/dashboard/types';
import type { NeedsChangesPreset } from '@/features/dashboard/ui/modals/NeedsChangesModal';
import type { Submission } from '@memalerts/api-contracts';

import { useAppDispatch } from '@/store/hooks';
import {
  approveSubmission,
  bulkModerateSubmissions,
  needsChangesSubmission,
  rejectSubmission,
} from '@/store/slices/submissionsSlice';

type UseDashboardModerationOptions = {
  submissions: Submission[];
  refreshPending: () => void;
};

const BULK_CHECKBOX_BASE =
  'h-4 w-4 rounded border-black/10 dark:border-white/15 bg-white/50 dark:bg-white/10 text-primary focus:ring-2 focus:ring-primary/30';

export function useDashboardModeration({ submissions, refreshPending }: UseDashboardModerationOptions) {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [approveModal, setApproveModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [rejectModal, setRejectModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [needsChangesModal, setNeedsChangesModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });
  const [priceCoins, setPriceCoins] = useState('100');
  const [approveTags, setApproveTags] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [needsChangesPreset, setNeedsChangesPreset] = useState<NeedsChangesPreset>({
    badTitle: false,
    noTags: false,
    other: false,
  });
  const [needsChangesText, setNeedsChangesText] = useState('');
  const [bulkModal, setBulkModal] = useState<{ open: boolean; action: BulkActionKind; submissionIds: string[] }>({
    open: false,
    action: 'approve',
    submissionIds: [],
  });
  const [bulkPriceCoins, setBulkPriceCoins] = useState('100');
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [bulkNeedsChangesPreset, setBulkNeedsChangesPreset] = useState<NeedsChangesPreset>({
    badTitle: false,
    noTags: false,
    other: false,
  });
  const [bulkNeedsChangesText, setBulkNeedsChangesText] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const buildNeedsChangesPayload = useCallback((preset: NeedsChangesPreset, message: string) => {
    const codes: string[] = [];
    if (preset.badTitle) codes.push('bad_title');
    if (preset.noTags) codes.push('no_tags');
    if (preset.other) codes.push('other');
    const msg = message.trim();
    const hasReason = codes.length > 0 || msg.length > 0;
    const otherNeedsText = preset.other && msg.length === 0;
    const packed = JSON.stringify({ v: 1, codes, message: msg });
    return { codes, message: msg, hasReason, otherNeedsText, packed };
  }, []);

  const openApproveModal = useCallback((submissionId: string) => {
    setApproveModal({ open: true, submissionId });
    setPriceCoins('100');
  }, []);

  const openRejectModal = useCallback((submissionId: string) => {
    setRejectModal({ open: true, submissionId });
    setRejectReason('');
  }, []);

  const openNeedsChangesModal = useCallback((submissionId: string) => {
    setNeedsChangesModal({ open: true, submissionId });
    setNeedsChangesPreset({ badTitle: false, noTags: false, other: false });
    setNeedsChangesText('');
  }, []);

  const openBulkModalFor = useCallback(
    (action: BulkActionKind, submissionIds: string[]) => {
      const uniqueIds = Array.from(new Set(submissionIds));
      if (uniqueIds.length === 0) return;
      setBulkModal({ open: true, action, submissionIds: uniqueIds });
      setBulkActionLoading(false);
      setBulkPriceCoins(priceCoins);
      setBulkRejectReason('');
      setBulkNeedsChangesPreset({ badTitle: false, noTags: false, other: false });
      setBulkNeedsChangesText('');
    },
    [priceCoins],
  );

  const closeApproveModal = useCallback(() => {
    setApproveModal({ open: false, submissionId: null });
    setApproveTags([]);
  }, []);

  const closeRejectModal = useCallback(() => {
    setRejectModal({ open: false, submissionId: null });
  }, []);

  const closeNeedsChangesModal = useCallback(() => {
    setNeedsChangesModal({ open: false, submissionId: null });
  }, []);

  const closeBulkModal = useCallback(() => {
    if (bulkActionLoading) return;
    setBulkModal({ open: false, action: bulkModal.action, submissionIds: [] });
  }, [bulkActionLoading, bulkModal.action]);

  const handleBulkConfirm = useCallback(async () => {
    if (!bulkModal.open || bulkActionLoading) return;
    const submissionIds = bulkModal.submissionIds.filter(Boolean);
    if (submissionIds.length === 0) return;

    if (bulkModal.action === 'approve') {
      const parsed = parseInt(bulkPriceCoins, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        toast.error(t('admin.invalidPrice', { defaultValue: 'Price must be at least 1 coin' }));
        return;
      }
    }

    if (bulkModal.action === 'needs_changes') {
      const { hasReason, otherNeedsText } = buildNeedsChangesPayload(bulkNeedsChangesPreset, bulkNeedsChangesText);
      if (!hasReason || otherNeedsText) {
        toast.error(
          t('submissions.needsChangesReasonRequired', {
            defaultValue: 'Select a reason or write a message.',
          }),
        );
        return;
      }
    }

    setBulkActionLoading(true);
    try {
      const payload: {
        submissionIds: string[];
        action: BulkActionKind;
        moderatorNotes?: string;
        priceCoins?: number;
      } = {
        submissionIds,
        action: bulkModal.action,
      };

      if (bulkModal.action === 'approve') {
        payload.priceCoins = parseInt(bulkPriceCoins, 10);
      } else if (bulkModal.action === 'needs_changes') {
        payload.moderatorNotes = buildNeedsChangesPayload(bulkNeedsChangesPreset, bulkNeedsChangesText).packed;
      } else if (bulkModal.action === 'reject') {
        const notes = bulkRejectReason.trim();
        if (notes) payload.moderatorNotes = notes;
      }

      const result = await dispatch(bulkModerateSubmissions(payload)).unwrap();
      const successCount = Array.isArray(result?.success) ? result.success.length : 0;
      const failedCount = Array.isArray(result?.failed) ? result.failed.length : 0;

      if (successCount > 0) {
        toast.success(
          t('dashboard.bulk.successToast', {
            defaultValue: 'Bulk action complete: {{success}} succeeded.',
            success: successCount,
          }),
        );
      }
      if (failedCount > 0) {
        toast.error(
          t('dashboard.bulk.failedToast', {
            defaultValue: 'Some items failed: {{failed}}.',
            failed: failedCount,
          }),
        );
      }

      setBulkModal({ open: false, action: bulkModal.action, submissionIds: [] });
      refreshPending();
    } catch {
      toast.error(t('dashboard.bulk.failedAllToast', { defaultValue: 'Failed to apply bulk action.' }));
    } finally {
      setBulkActionLoading(false);
    }
  }, [
    bulkActionLoading,
    bulkModal.action,
    bulkModal.open,
    bulkModal.submissionIds,
    bulkNeedsChangesPreset,
    bulkNeedsChangesText,
    bulkPriceCoins,
    bulkRejectReason,
    buildNeedsChangesPayload,
    dispatch,
    refreshPending,
    t,
  ]);

  const handleApprove = useCallback(async () => {
    if (!approveModal.submissionId) return;
    const parsed = parseInt(priceCoins, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      toast.error(t('admin.invalidPrice', { defaultValue: 'Price must be at least 1 coin' }));
      return;
    }
    try {
      await dispatch(
        approveSubmission({
          submissionId: approveModal.submissionId,
          priceCoins: parsed,
          tags: approveTags.length > 0 ? approveTags : undefined,
        }),
      ).unwrap();
      toast.success(t('admin.approve', { defaultValue: 'Approve' }));
      closeApproveModal();
      refreshPending();
    } catch {
      toast.error(t('admin.failedToApprove', { defaultValue: 'Failed to approve submission' }));
    }
  }, [approveModal.submissionId, approveTags, closeApproveModal, dispatch, priceCoins, refreshPending, t]);

  const handleReject = useCallback(async () => {
    if (!rejectModal.submissionId) return;
    const notes = rejectReason.trim() ? rejectReason.trim() : null;
    try {
      await dispatch(rejectSubmission({ submissionId: rejectModal.submissionId, moderatorNotes: notes })).unwrap();
      toast.success(t('admin.reject', { defaultValue: 'Reject' }));
      closeRejectModal();
      refreshPending();
    } catch {
      toast.error(t('admin.failedToReject', { defaultValue: 'Failed to reject submission' }));
    }
  }, [closeRejectModal, dispatch, refreshPending, rejectModal.submissionId, rejectReason, t]);

  const handleNeedsChanges = useCallback(async () => {
    if (!needsChangesModal.submissionId) return;
    const { hasReason, otherNeedsText, packed } = buildNeedsChangesPayload(needsChangesPreset, needsChangesText);
    if (!hasReason || otherNeedsText) {
      toast.error(
        t('submissions.needsChangesReasonRequired', {
          defaultValue: 'Select a reason or write a message.',
        }),
      );
      return;
    }
    try {
      await dispatch(
        needsChangesSubmission({
          submissionId: needsChangesModal.submissionId,
          moderatorNotes: packed,
        }),
      ).unwrap();
      toast.success(t('submissions.sentForChanges', { defaultValue: 'Sent for changes.' }));
      closeNeedsChangesModal();
      refreshPending();
    } catch {
      toast.error(t('submissions.failedToSendForChanges', { defaultValue: 'Failed to send for changes.' }));
    }
  }, [
    buildNeedsChangesPayload,
    closeNeedsChangesModal,
    dispatch,
    needsChangesModal.submissionId,
    needsChangesPreset,
    needsChangesText,
    refreshPending,
    t,
  ]);

  const needsChangesRemainingResubmits = useMemo(() => {
    const s = submissions.find((x) => x.id === needsChangesModal.submissionId);
    const revision = Math.max(0, Math.min(2, Number(s?.revision ?? 0) || 0));
    return Math.max(0, 2 - revision);
  }, [needsChangesModal.submissionId, submissions]);

  const bulkCount = bulkModal.submissionIds.length;

  return {
    approveModal,
    rejectModal,
    needsChangesModal,
    bulkModal,
    priceCoins,
    approveTags,
    rejectReason,
    needsChangesPreset,
    needsChangesText,
    bulkPriceCoins,
    bulkRejectReason,
    bulkNeedsChangesPreset,
    bulkNeedsChangesText,
    bulkActionLoading,
    needsChangesRemainingResubmits,
    bulkCount,
    bulkCheckboxBase: BULK_CHECKBOX_BASE,
    setPriceCoins,
    setApproveTags,
    setRejectReason,
    setNeedsChangesPreset,
    setNeedsChangesText,
    setBulkPriceCoins,
    setBulkRejectReason,
    setBulkNeedsChangesPreset,
    setBulkNeedsChangesText,
    openApproveModal,
    openRejectModal,
    openNeedsChangesModal,
    openBulkModalFor,
    closeApproveModal,
    closeRejectModal,
    closeNeedsChangesModal,
    closeBulkModal,
    handleApprove,
    handleReject,
    handleNeedsChanges,
    handleBulkConfirm,
  };
}

