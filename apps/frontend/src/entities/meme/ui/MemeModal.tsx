import { memo, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { MemeModalInfo } from './MemeModal/MemeModalInfo';
import { MemeModalVideo } from './MemeModal/MemeModalVideo';
import { useMemeModalPlayback } from './MemeModal/useMemeModalPlayback';

import type { Meme } from '@/types';

import { api } from '@/lib/api';
import { resolveMediaUrl } from '@/lib/urls';
import { isEffectivelyEmptyAiDescription } from '@/shared/lib/aiText';
import { getMemeIdForActivation, getMemePrimaryId } from '@/shared/lib/memeIds';
import { Textarea } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal/Modal';
import ConfirmDialog from '@/shared/ui/modals/ConfirmDialog';
import { useAppSelector } from '@/store/hooks';
interface MemeModalProps {
  meme: Meme | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  isOwner: boolean;
  mode?: 'admin' | 'viewer';
  onActivate?: (memeId: string) => Promise<void>;
  walletBalance?: number;
  onTagSearch?: (tag: string) => void;
}

const MemeModal = memo(function MemeModal({
  meme,
  isOpen,
  onClose,
  onUpdate,
  isOwner,
  mode = 'admin',
  onActivate,
  walletBalance,
  onTagSearch,
}: MemeModalProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const userId = user?.id;

  const [isEditing, setIsEditing] = useState(false);
  const [currentMeme, setCurrentMeme] = useState<Meme | null>(meme);
  const [formData, setFormData] = useState({
    title: '',
    priceCoins: 0,
  });
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');

  // Update currentMeme when meme prop changes
  useEffect(() => {
    if (meme) {
      setCurrentMeme(meme);
      setFormData({
        title: meme.title,
        priceCoins: meme.priceCoins,
      });
      setIsEditing(false);
    }
  }, [meme]);

  const previewUrl = currentMeme?.previewUrl ? resolveMediaUrl(currentMeme.previewUrl) : '';
  const hasPreview = Boolean(previewUrl);

  const {
    isPlaying,
    isMuted,
    volume,
    isFullReady,
    videoRef,
    previewVideoRef,
    handlePlayPause,
    handleMute,
    handleVolumeChange,
    handlePreviewPlay,
    handlePreviewPause,
    handlePreviewTimeUpdate,
    handleFullPlay,
    handleFullPause,
    handleFullCanPlay,
  } = useMemeModalPlayback({
    isOpen,
    memeId: currentMeme?.id,
    hasPreview,
    userId,
  });

  if (!isOpen || !currentMeme) return null;

  const variants = Array.isArray(currentMeme.variants) ? currentMeme.variants : [];
  const videoUrl = resolveMediaUrl(variants[0]?.fileUrl || currentMeme.playFileUrl || currentMeme.fileUrl);
  const creatorName = currentMeme.createdBy?.displayName || 'Unknown';
  const hasAiFields = 'aiAutoDescription' in currentMeme || 'aiAutoTagNames' in currentMeme;
  const aiTags = Array.isArray(currentMeme.aiAutoTagNames) ? currentMeme.aiAutoTagNames.filter((x) => typeof x === 'string') : [];
  const aiDesc = typeof currentMeme.aiAutoDescription === 'string' ? currentMeme.aiAutoDescription : '';
  const canViewAi = mode === 'admin' && (!!isOwner || user?.role === 'admin');
  const aiDescEffectivelyEmpty = isEffectivelyEmptyAiDescription(currentMeme.aiAutoDescription, currentMeme.title);
  const hasAiDesc = !!aiDesc.trim() && !aiDescEffectivelyEmpty;
  const hasAi = aiTags.length > 0 || hasAiDesc;
  const canRegenerateAi = mode === 'admin' && (!!isOwner || user?.role === 'admin');
  const aiStatus = typeof currentMeme.aiStatus === 'string' ? currentMeme.aiStatus : null;
  const isAiProcessing = aiStatus === 'pending' || aiStatus === 'processing';
  const manualTagNames = (() => {
    const raw = Array.isArray(currentMeme.tags) ? currentMeme.tags : [];
    const names = raw
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return null;
        const tag = (item as { tag?: { name?: unknown } }).tag;
        return typeof tag?.name === 'string' ? tag.name : null;
      })
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .map((name) => name.trim());
    return Array.from(new Set(names));
  })();
  const aiTagNames = Array.from(
    new Set(aiTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))
  ).filter((tag) => !manualTagNames.includes(tag));
  const canTagSearch = typeof onTagSearch === 'function';

  const statusLabel = (() => {
    const s = (currentMeme.status || '').toLowerCase();
    if (!s) return null;
    if (s === 'approved') return t('meme.status.approved', { defaultValue: 'approved' });
    if (s === 'pending') return t('meme.status.pending', { defaultValue: 'pending' });
    if (s === 'rejected') return t('meme.status.rejected', { defaultValue: 'rejected' });
    return s;
  })();

  const getSource = () => {
    if (currentMeme.fileUrl.startsWith('http://') || currentMeme.fileUrl.startsWith('https://')) {
      try {
        const url = new URL(currentMeme.fileUrl);
        const host = url.hostname.toLowerCase();
        // Treat memalerts URLs as "imported" (viewer imported from external source)
        if (host === 'memalerts.com' || host.endsWith('.memalerts.com') || host === 'cdns.memealerts.com') {
          return 'imported';
        }
        return url.hostname; // Other external sources: show domain
      } catch {
        return 'imported';
      }
    }
    return 'uploaded';
  };
  const source = getSource();

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await api.patch<Meme>(`/streamer/memes/${currentMeme.id}`, formData);
      setCurrentMeme(response);
      toast.success('Meme updated successfully!');
      setIsEditing(false);
      onUpdate();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || 'Failed to update meme');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (currentMeme) {
      setFormData({
        title: currentMeme.title,
        priceCoins: currentMeme.priceCoins,
      });
    }
  };

  const handleDelete = () => {
    setDeleteReason('');
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!currentMeme) return;

    setLoading(true);
    try {
      await api.delete(`/streamer/memes/${currentMeme.id}`);
      toast.success(t('memeModal.deleted', { defaultValue: 'Meme deleted successfully!' }));
      // Optimistically remove from any open lists (dashboard/public) without a full refresh.
      try {
        const primaryId = getMemePrimaryId(currentMeme);
        window.dispatchEvent(
          new CustomEvent('memalerts:memeDeleted', {
            detail: {
              memeId: primaryId,
              // Prefer explicit legacy id from backend DTO; otherwise fall back to "id differs from primary".
              legacyMemeId:
                (currentMeme as Meme).legacyMemeId ||
                (currentMeme.id !== primaryId ? currentMeme.id : undefined),
              channelId: currentMeme.channelId,
            },
          }),
        );
      } catch {
        // ignore (older browsers / non-DOM environments)
      }
      setShowDeleteConfirm(false);
      onUpdate();
      onClose();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      toast.error(apiError.response?.data?.error || 'Failed to delete meme');
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    if (onActivate && currentMeme) {
      await onActivate(getMemeIdForActivation(currentMeme));
      onClose();
    }
  };

  const canActivate =
    mode === 'viewer' &&
    !!onActivate &&
    walletBalance !== undefined &&
    walletBalance >= currentMeme.priceCoins;
  const isGuestViewer = mode === 'viewer' && !!onActivate && walletBalance === undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="meme-modal-title"
      closeOnEsc
      useGlass={false}
      overlayClassName="items-center bg-black/75"
      contentClassName="bg-white dark:bg-gray-800 rounded-xl max-w-7xl max-h-[92vh] overflow-hidden flex flex-col md:flex-row"
    >
      <MemeModalVideo
        meme={currentMeme}
        variants={variants}
        hasPreview={hasPreview}
        previewUrl={previewUrl}
        videoUrl={videoUrl}
        isFullReady={isFullReady}
        isPlaying={isPlaying}
        isMuted={isMuted}
        volume={volume}
        videoRef={videoRef}
        previewVideoRef={previewVideoRef}
        onPlayPause={handlePlayPause}
        onMute={handleMute}
        onVolumeChange={handleVolumeChange}
        onPreviewPlay={handlePreviewPlay}
        onPreviewPause={handlePreviewPause}
        onPreviewTimeUpdate={handlePreviewTimeUpdate}
        onFullPlay={handleFullPlay}
        onFullPause={handleFullPause}
        onFullCanPlay={handleFullCanPlay}
      />
      <MemeModalInfo
        meme={currentMeme}
        mode={mode}
        isOwner={isOwner}
        isEditing={isEditing}
        loading={loading}
        title={formData.title}
        priceCoins={formData.priceCoins}
        onTitleChange={(value) => setFormData((prev) => ({ ...prev, title: value }))}
        onPriceChange={(value) => setFormData((prev) => ({ ...prev, priceCoins: value }))}
        onEdit={handleEdit}
        onCancel={handleCancel}
        onSave={handleSave}
        onDelete={handleDelete}
        onClose={onClose}
        creatorName={creatorName}
        source={source}
        statusLabel={statusLabel}
        manualTagNames={manualTagNames}
        aiTagNames={aiTagNames}
        canTagSearch={canTagSearch}
        onTagSearch={onTagSearch}
        canViewAi={canViewAi}
        canRegenerateAi={canRegenerateAi}
        hasAiFields={hasAiFields}
        hasAi={hasAi}
        hasAiDesc={hasAiDesc}
        aiTags={aiTags}
        aiDesc={aiDesc}
        isAiProcessing={isAiProcessing}
        canActivate={canActivate}
        isGuestViewer={isGuestViewer}
        walletBalance={walletBalance}
        onActivate={handleActivate}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
        title={t('memeModal.deleteMeme', { defaultValue: 'Delete Meme' })}
        message={
          <div>
            <p className="mb-2">
              {t('memeModal.deleteConfirm', {
                defaultValue: 'Are you sure you want to delete "{{title}}"?',
                title: currentMeme?.title || '',
              })}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('memeModal.deleteWarning', { defaultValue: 'This action cannot be undone.' })}
            </p>

            {/* Optional reason (nice-to-have for streamers) */}
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                {t('memeModal.deleteReasonLabel', { defaultValue: 'Reason (optional)' })}
              </label>
              <Textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                rows={3}
                className="w-full"
                placeholder={t('memeModal.deleteReasonPlaceholder', { defaultValue: 'Write a short note… (optional)' })}
              />
            </div>
          </div>
        }
        confirmText={t('common.delete', { defaultValue: 'Delete' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        isLoading={loading}
      />
    </Modal>
  );
});

export default MemeModal;
