import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';

import { api } from '@/lib/api';
import { resolveMediaUrl } from '@/lib/urls';
import { getMemeIdForActivation, getMemePrimaryId } from '@/shared/lib/memeIds';
import { getUserPreferences, patchUserPreferences } from '@/shared/lib/userPreferences';
import { Button, HelpTooltip, Input, Pill, Textarea } from '@/shared/ui';
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
}

export default function MemeModal({
  meme,
  isOpen,
  onClose,
  onUpdate,
  isOwner,
  mode = 'admin',
  onActivate,
  walletBalance,
}: MemeModalProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((s) => s.auth);
  const userId = user?.id;
  // Keep mode as a union to avoid tsc-prod narrowing it to a literal and rejecting comparisons (TS2367).
  const viewMode: 'admin' | 'viewer' = mode ?? 'admin';
  const [isEditing, setIsEditing] = useState(false);
  const [currentMeme, setCurrentMeme] = useState<Meme | null>(meme);
  const [formData, setFormData] = useState({
    title: '',
    priceCoins: 0,
  });
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return window.localStorage.getItem('memalerts:memeModalMuted') === '1';
    } catch {
      return false;
    }
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

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

  // Sync mute onto the element as soon as the meme changes / modal opens.
  useEffect(() => {
    if (!isOpen) return;
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isOpen, currentMeme?.id, isMuted]);

  // Backend-first mute hydration (when logged in).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const prefs = await getUserPreferences();
      if (cancelled) return;
      if (typeof prefs?.memeModalMuted === 'boolean') setIsMuted(prefs.memeModalMuted);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Auto-play video when modal opens
  useEffect(() => {
    if (isOpen && videoRef.current && currentMeme) {
      videoRef.current.play().catch(() => {
        // Ignore autoplay errors
      });
      setIsPlaying(true);
    } else if (!isOpen && videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, [isOpen, currentMeme]);

  if (!isOpen || !currentMeme) return null;

  const videoUrl = resolveMediaUrl(currentMeme.fileUrl);
  const creatorName = currentMeme.createdBy?.displayName || 'Unknown';
  const hasAiFields = 'aiAutoDescription' in currentMeme || 'aiAutoTagNames' in currentMeme;
  const aiTags = Array.isArray(currentMeme.aiAutoTagNames) ? currentMeme.aiAutoTagNames.filter((x) => typeof x === 'string') : [];
  const aiDesc = typeof currentMeme.aiAutoDescription === 'string' ? currentMeme.aiAutoDescription : '';
  const canViewAi = viewMode === 'admin' && (!!isOwner || user?.role === 'admin');
  const hasAi = aiTags.length > 0 || !!aiDesc.trim();

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

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const handleMute = () => {
    if (videoRef.current) {
      const next = !isMuted;
      videoRef.current.muted = next;
      setIsMuted(next);
      if (user) {
        void patchUserPreferences({ memeModalMuted: next });
      } else {
        try {
          window.localStorage.setItem('memalerts:memeModalMuted', next ? '1' : '0');
        } catch {
          // ignore
        }
      }
    }
  };

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
    viewMode === 'viewer' &&
    onActivate &&
    walletBalance !== undefined &&
    currentMeme &&
    walletBalance >= currentMeme.priceCoins;
  const isGuestViewer = viewMode === 'viewer' && onActivate && walletBalance === undefined;

  const isViewerStickerPopup = viewMode === 'viewer';

  const overlayClassName = 'items-center bg-black/75';

  const contentClassName = isViewerStickerPopup
    ? 'p-0 bg-black text-white max-w-6xl max-h-[90vh] overflow-hidden flex flex-col rounded-none sm:rounded-2xl shadow-xl ring-1 ring-white/10'
    : 'bg-white dark:bg-gray-800 rounded-xl max-w-6xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="meme-modal-title"
      closeOnEsc
      useGlass={false}
      overlayClassName={overlayClassName}
      contentClassName={contentClassName}
    >
      {isViewerStickerPopup ? (
        <div className="flex flex-col h-full">
          {/* Top bar */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-black/60 backdrop-blur-md border-b border-white/10">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="h-8 w-8 rounded-full bg-white/10 ring-1 ring-white/10 flex items-center justify-center text-xs font-bold text-white/80"
                aria-hidden="true"
              >
                {(creatorName || 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{creatorName}</div>
              </div>
            </div>

            <HelpTooltip content={t('help.memeModal.close', { defaultValue: 'Close.' })}>
              <button
                type="button"
                onClick={onClose}
                className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/15 active:bg-white/20 ring-1 ring-white/10 text-white flex items-center justify-center transition-colors"
                aria-label={t('common.close', { defaultValue: 'Close' })}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </HelpTooltip>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            {/* Video Section - Left */}
            <section
              className="bg-black flex items-center justify-center relative w-full md:flex-1 h-[55vh] md:h-auto overflow-hidden"
              aria-label="Video player"
            >
              {/* Blurred background to avoid black bars on vertical videos */}
              <video
                src={videoUrl}
                muted
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-50"
                preload="auto"
                aria-hidden="true"
              />
              <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

              <video
                ref={videoRef}
                src={videoUrl}
                muted={isMuted}
                loop
                playsInline
                className="relative z-10 w-full h-full object-contain"
                preload="auto"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={() => {
                  toast.error(t('memeModal.videoLoadFailed', { defaultValue: 'Не удалось загрузить видео' }));
                }}
                aria-label={t('memeModal.ariaVideo', { defaultValue: 'Видео' }) + `: ${currentMeme.title}`}
              />

              {/* Custom Video Controls */}
              <div
                ref={controlsRef}
                className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-3 bg-black bg-opacity-60 rounded-full px-4 py-2"
              >
                <button
                  type="button"
                  onClick={handlePlayPause}
                  className="text-white hover:text-gray-300 transition-colors"
                  aria-label={
                    isPlaying
                      ? t('common.pause', { defaultValue: 'Пауза' })
                      : t('common.play', { defaultValue: 'Воспроизвести' })
                  }
                  aria-pressed={isPlaying}
                >
                  {isPlaying ? (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleMute}
                  className="text-white hover:text-gray-300 transition-colors"
                  aria-label={
                    isMuted
                      ? t('common.soundOn', { defaultValue: 'Со звуком' })
                      : t('common.mute', { defaultValue: 'Без звука' })
                  }
                  aria-pressed={isMuted}
                >
                  {isMuted ? (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                  )}
                </button>
              </div>
            </section>

            {/* Info Section - Right */}
            <aside
              ref={rightPanelRef}
              className="w-full md:w-96 border-t md:border-t-0 md:border-l border-white/10 bg-black/35 backdrop-blur-md overflow-y-auto relative"
              aria-label="Meme information"
            >
              <div className="p-5 md:p-6 flex flex-col min-h-full">
                <div className="space-y-4">
                  <h2 id="meme-modal-title" className="text-2xl font-bold text-white">
                    {currentMeme.title}
                  </h2>

                  <div>
                    <div className="text-xs font-semibold text-white/60 uppercase tracking-wide mb-1">
                      {t('memeModal.price', { defaultValue: 'Price' })}
                    </div>
                    <div className="text-lg font-semibold text-accent">
                      {t('memeModal.priceValue', { defaultValue: '{{price}} coins', price: currentMeme.priceCoins })}
                    </div>
                  </div>
                </div>

                <div className="mt-auto pt-4 border-t border-white/10">
                  <Button
                    type="button"
                    onClick={handleActivate}
                    disabled={!canActivate && !isGuestViewer}
                    variant="primary"
                    className="w-full"
                  >
                    {isGuestViewer
                      ? t('auth.loginToUse', { defaultValue: 'Log in to use' })
                      : walletBalance === undefined
                        ? t('common.loading', { defaultValue: 'Loading…' })
                        : walletBalance < (currentMeme.priceCoins || 0)
                          ? t('memeModal.insufficientCoins', {
                              defaultValue: 'Insufficient coins (need {{price}})',
                              price: currentMeme.priceCoins,
                            })
                          : t('dashboard.activate', { defaultValue: 'Activate' })}
                  </Button>

                  {walletBalance !== undefined ? (
                    <p className="text-sm text-white/60 mt-2 text-center">
                      {t('memeModal.yourBalance', { defaultValue: 'Your balance: {{balance}} coins', balance: walletBalance })}
                    </p>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        </div>
      ) : (
        <div className="contents">
          {/* Video Section - Left */}
          <section
            className="bg-black flex items-center justify-center relative w-full md:flex-1 h-[55vh] md:h-auto overflow-hidden"
            aria-label="Video player"
          >
            {/* Blurred background to avoid black bars on vertical videos */}
            <video
              src={videoUrl}
              muted
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-50"
              preload="auto"
              aria-hidden="true"
            />
            <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

            <video
              ref={videoRef}
              src={videoUrl}
              muted={isMuted}
              loop
              playsInline
              className="relative z-10 w-full h-full object-contain"
              preload="auto"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onError={() => {
                toast.error(t('memeModal.videoLoadFailed', { defaultValue: 'Не удалось загрузить видео' }));
              }}
              aria-label={t('memeModal.ariaVideo', { defaultValue: 'Видео' }) + `: ${currentMeme.title}`}
            />

            {/* Custom Video Controls */}
            <div
              ref={controlsRef}
              className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-3 bg-black bg-opacity-60 rounded-full px-4 py-2"
            >
              <button
                type="button"
                onClick={handlePlayPause}
                className="text-white hover:text-gray-300 transition-colors"
                aria-label={
                  isPlaying
                    ? t('common.pause', { defaultValue: 'Пауза' })
                    : t('common.play', { defaultValue: 'Воспроизвести' })
                }
                aria-pressed={isPlaying}
              >
                {isPlaying ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={handleMute}
                className="text-white hover:text-gray-300 transition-colors"
                aria-label={
                  isMuted
                    ? t('common.soundOn', { defaultValue: 'Со звуком' })
                    : t('common.mute', { defaultValue: 'Без звука' })
                }
                aria-pressed={isMuted}
              >
                {isMuted ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                )}
              </button>
            </div>
          </section>

          {/* Info Section - Right */}
          <aside
            ref={rightPanelRef}
            className="w-full md:w-80 border-t md:border-t-0 border-black/5 dark:border-white/10 bg-gray-50 dark:bg-gray-900 overflow-y-auto relative"
            aria-label="Meme information"
          >
            {/* Action buttons in top right corner */}
            <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
              {viewMode === 'admin' && isOwner && (
                <div className="flex gap-2">
              <HelpTooltip
                content={
                  isEditing
                    ? t('help.memeModal.cancelEdit', { defaultValue: 'Stop editing without saving.' })
                    : t('help.memeModal.edit', { defaultValue: 'Edit meme details (title, price, etc.).' })
                }
              >
                <button
                  type="button"
                  onClick={isEditing ? handleCancel : handleEdit}
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors group"
                  aria-label={isEditing ? t('common.cancel', { defaultValue: 'Cancel' }) : t('common.edit', { defaultValue: 'Edit' })}
                  disabled={loading}
                >
                  <svg
                    className={`w-5 h-5 ${
                      isEditing
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-600 dark:text-gray-400 group-hover:text-primary'
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {isEditing ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    ) : (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    )}
                  </svg>
                </button>
              </HelpTooltip>
              {!isEditing && (
                <HelpTooltip content={t('help.memeModal.delete', { defaultValue: 'Delete this meme.' })}>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded-full transition-colors group"
                    aria-label={t('common.delete', { defaultValue: 'Delete' })}
                    disabled={loading}
                  >
                    <svg
                      className="w-5 h-5 text-gray-600 dark:text-gray-400 group-hover:text-red-600 dark:group-hover:text-red-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </HelpTooltip>
              )}
                </div>
              )}
              <HelpTooltip content={t('help.memeModal.close', { defaultValue: 'Close.' })}>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                  aria-label={t('common.close', { defaultValue: 'Close' })}
                >
                  <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </HelpTooltip>
            </div>

        <div className="p-5 md:p-6 space-y-5 md:space-y-6 pt-16">
          {/* Title */}
          <div>
            {isEditing && viewMode === 'admin' ? (
              <Input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="text-2xl font-bold px-3 py-2"
                disabled={!isEditing}
              />
            ) : (
              <h2 id="meme-modal-title" className="text-2xl font-bold dark:text-white">
                {currentMeme.title}
              </h2>
            )}
          </div>

          {canViewAi && (hasAi || hasAiFields) ? (
            <section className="rounded-xl bg-black/5 dark:bg-white/5 p-4" aria-label="AI">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-bold text-gray-900 dark:text-white">AI</div>
                {aiTags.length > 0 ? (
                  <Pill variant="neutral" size="sm">
                    AI tags: {aiTags.length}
                  </Pill>
                ) : null}
              </div>

              {!hasAi ? (
                <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                  {t('memeModal.aiPending', { defaultValue: 'AI: данных пока нет (ещё в обработке или не записалось).' })}
                </div>
              ) : null}

              {aiDesc.trim() ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">AI description</div>
                  <div className="mt-1 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{aiDesc}</div>
                </div>
              ) : null}

              {aiTags.length > 0 ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">AI tags</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {aiTags.slice(0, 30).map((tag) => (
                      <Pill key={tag} variant="primary" size="sm">
                        {tag}
                      </Pill>
                    ))}
                    {aiTags.length > 30 ? (
                      <Pill variant="neutral" size="sm">
                        +{aiTags.length - 30}
                      </Pill>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {isEditing && viewMode === 'admin' ? (
            <form onSubmit={handleSave} className="space-y-4" aria-label="Edit meme form">
              <div>
                <label htmlFor="meme-price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('memeModal.priceCoins', { defaultValue: 'Price (coins)' })}
                </label>
                <Input
                  id="meme-price"
                  type="number"
                  value={formData.priceCoins}
                  onChange={(e) => setFormData({ ...formData, priceCoins: parseInt(e.target.value) || 0 })}
                  min="1"
                  required
                  aria-required="true"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" variant="primary" className="flex-1" disabled={loading}>
                  {loading ? t('common.loading', { defaultValue: 'Loading…' }) : t('common.save', { defaultValue: 'Save' })}
                </Button>
                <Button type="button" variant="secondary" className="flex-1" onClick={handleCancel} disabled={loading}>
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                    {t('memeModal.price', { defaultValue: 'Price' })}
                  </div>
                  <div className="text-lg font-semibold text-accent">
                    {t('memeModal.priceValue', { defaultValue: '{{price}} coins', price: currentMeme.priceCoins })}
                  </div>
                </div>
                {viewMode === 'admin' && (
                  <>
                    <div>
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                        {t('memeModal.createdBy', { defaultValue: 'Created by' })}
                      </div>
                      <div className="text-base text-gray-900 dark:text-white">{creatorName}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                        {t('memeModal.source', { defaultValue: 'Source' })}
                      </div>
                      <div className="text-base text-gray-900 dark:text-white capitalize">
                        {source === 'imported'
                          ? t('memeModal.sourceImported', { defaultValue: 'imported' })
                          : source === 'uploaded'
                            ? t('memeModal.sourceUploaded', { defaultValue: 'uploaded' })
                            : source}
                      </div>
                    </div>
                    {statusLabel && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                          {t('memeModal.status', { defaultValue: 'Status' })}
                        </div>
                        <div className="text-base text-gray-900 dark:text-white capitalize">{statusLabel}</div>
                      </div>
                    )}
                    {currentMeme.createdAt && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                          {t('memeModal.createdAt', { defaultValue: 'Created' })}
                        </div>
                        <div className="text-base text-gray-900 dark:text-white">{new Date(currentMeme.createdAt).toLocaleString()}</div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Activate button for viewer mode */}
              {viewMode === 'viewer' && (
                <div className="pt-4 border-t border-black/5 dark:border-white/10">
                  <Button
                    type="button"
                    onClick={handleActivate}
                    disabled={!canActivate && !isGuestViewer}
                    variant="primary"
                    className="w-full"
                  >
                    {isGuestViewer
                      ? t('auth.loginToUse', { defaultValue: 'Log in to use' })
                      : walletBalance === undefined
                        ? t('common.loading', { defaultValue: 'Loading…' })
                        : walletBalance < (currentMeme.priceCoins || 0)
                          ? t('memeModal.insufficientCoins', {
                              defaultValue: 'Insufficient coins (need {{price}})',
                              price: currentMeme.priceCoins,
                            })
                          : t('dashboard.activate', { defaultValue: 'Activate' })}
                  </Button>
                  {walletBalance !== undefined && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
                      {t('memeModal.yourBalance', { defaultValue: 'Your balance: {{balance}} coins', balance: walletBalance })}
                    </p>
                  )}
                </div>
              )}

              {/* Delete button for admin mode */}
              {viewMode === 'admin' && isOwner && !isEditing && (
                <div className="pt-4 border-t border-black/5 dark:border-white/10">
                  <Button type="button" variant="danger" className="w-full" onClick={handleDelete} disabled={loading}>
                    {loading ? t('common.loading', { defaultValue: 'Loading…' }) : t('memeModal.deleteMeme', { defaultValue: 'Delete Meme' })}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
        </div>
      )}

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
}


