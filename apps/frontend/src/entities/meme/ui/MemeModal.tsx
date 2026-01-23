import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { AiRegenerateButton } from './AiRegenerateButton';

import type { Meme } from '@/types';

import { api } from '@/lib/api';
import { resolveMediaUrl } from '@/lib/urls';
import { isEffectivelyEmptyAiDescription } from '@/shared/lib/aiText';
import { getMemeIdForActivation, getMemePrimaryId } from '@/shared/lib/memeIds';
import { getUserPreferences, patchUserPreferences } from '@/shared/lib/userPreferences';
import { Button, HelpTooltip, Input, Pill, Spinner, Textarea } from '@/shared/ui';
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

export default function MemeModal({
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

  const MUTED_STORAGE_KEY = 'memalerts:memeModalMuted';
  const VOLUME_STORAGE_KEY = 'memalerts:memeModalVolume';
  const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1);

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
      return window.localStorage.getItem(MUTED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [volume, setVolume] = useState(() => {
    try {
      const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
      if (!raw) return 1;
      const parsed = Number.parseFloat(raw);
      return clamp01(parsed);
    } catch {
      return 1;
    }
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const lastNonZeroVolumeRef = useRef<number>(1);
  const volumeRef = useRef<number>(1);
  const lastPreviewTimeRef = useRef<number>(0);
  const lastActivePlayingRef = useRef<boolean>(true);
  const [isFullReady, setIsFullReady] = useState(false);

  const persistAudioToLocalStorage = (nextMuted: boolean, nextVolume: number) => {
    try {
      window.localStorage.setItem(MUTED_STORAGE_KEY, nextMuted ? '1' : '0');
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(nextVolume));
    } catch {
      // ignore
    }
  };

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

  useEffect(() => {
    setIsFullReady(false);
    lastPreviewTimeRef.current = 0;
  }, [currentMeme?.id]);

  // Sync mute onto the element as soon as the meme changes / modal opens.
  useEffect(() => {
    if (!isOpen) return;
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isOpen, currentMeme?.id, isMuted]);

  // Sync volume onto the element as soon as the meme changes / modal opens.
  useEffect(() => {
    if (!isOpen) return;
    if (videoRef.current) videoRef.current.volume = clamp01(volume);
  }, [isOpen, currentMeme?.id, volume]);

  // Keep last non-zero volume (and the latest value) to restore when toggling mute.
  useEffect(() => {
    volumeRef.current = volume;
    if (volume > 0) lastNonZeroVolumeRef.current = volume;
  }, [volume]);

  // Backend-first mute hydration (when logged in).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const prefs = await getUserPreferences();
      if (cancelled) return;
      if (typeof prefs?.memeModalVolume === 'number') {
        const v = clamp01(prefs.memeModalVolume);
        setVolume(v);
        setIsMuted(v === 0);
        if (v > 0) lastNonZeroVolumeRef.current = v;
        persistAudioToLocalStorage(v === 0, v);
        return;
      }
      if (typeof prefs?.memeModalMuted === 'boolean') {
        setIsMuted(prefs.memeModalMuted);
        const nextVolume = prefs.memeModalMuted ? 0 : clamp01(volumeRef.current);
        if (!prefs.memeModalMuted && nextVolume > 0) lastNonZeroVolumeRef.current = nextVolume;
        setVolume(nextVolume);
        persistAudioToLocalStorage(prefs.memeModalMuted, nextVolume);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]); // intentionally not depending on volume to avoid re-hydration loops

  // Auto-play video when modal opens
  useEffect(() => {
    if (isOpen && currentMeme) {
      const target = isFullReady ? videoRef.current : previewVideoRef.current;
      target?.play().catch(() => {
        // Ignore autoplay errors
      });
      setIsPlaying(true);
      lastActivePlayingRef.current = true;
    } else {
      previewVideoRef.current?.pause();
      videoRef.current?.pause();
      setIsPlaying(false);
      lastActivePlayingRef.current = false;
    }
  }, [isOpen, currentMeme, isFullReady]);

  if (!isOpen || !currentMeme) return null;

  const variants = Array.isArray(currentMeme?.variants) ? currentMeme.variants : [];
  const previewUrl = currentMeme.previewUrl ? resolveMediaUrl(currentMeme.previewUrl) : '';
  const hasPreview = Boolean(previewUrl);
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
  const tagNames = (() => {
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

  const getActiveVideo = () => (isFullReady || !hasPreview ? videoRef.current : previewVideoRef.current);

  const handlePlayPause = () => {
    const active = getActiveVideo();
    if (!active) return;
    if (isPlaying) {
      active.pause();
      setIsPlaying(false);
      lastActivePlayingRef.current = false;
    } else {
      active.play().catch(() => {
        // ignore autoplay errors
      });
      setIsPlaying(true);
      lastActivePlayingRef.current = true;
    }
  };

  const handleMute = () => {
    if (videoRef.current) {
      const nextMuted = !isMuted;
      if (nextMuted && volume > 0) lastNonZeroVolumeRef.current = volume;
      const nextVolume = nextMuted ? 0 : clamp01(lastNonZeroVolumeRef.current || 1);

      if (!nextMuted && nextVolume > 0) lastNonZeroVolumeRef.current = nextVolume;
      videoRef.current.muted = nextMuted;
      videoRef.current.volume = nextVolume;

      setIsMuted(nextMuted);
      setVolume(nextVolume);
      persistAudioToLocalStorage(nextMuted, nextVolume);

      if (user) void patchUserPreferences({ memeModalMuted: nextMuted, memeModalVolume: nextVolume });
    }
  };

  const handleVolumeChange = (nextRaw: number) => {
    const nextVolume = clamp01(nextRaw);
    const nextMuted = nextVolume === 0;
    if (nextVolume > 0) lastNonZeroVolumeRef.current = nextVolume;

    if (videoRef.current) {
      videoRef.current.volume = nextVolume;
      videoRef.current.muted = nextMuted;
    }

    setVolume(nextVolume);
    setIsMuted(nextMuted);
    persistAudioToLocalStorage(nextMuted, nextVolume);
    if (user) void patchUserPreferences({ memeModalMuted: nextMuted, memeModalVolume: nextVolume });
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
    mode === 'viewer' &&
    onActivate &&
    walletBalance !== undefined &&
    currentMeme &&
    walletBalance >= currentMeme.priceCoins;
  const isGuestViewer = mode === 'viewer' && onActivate && walletBalance === undefined;

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
      {/* Video Section - Left */}
      <section
        className="bg-black flex items-center justify-center relative w-full md:flex-1 h-[65vh] md:h-[82vh] overflow-hidden"
        aria-label="Video player"
      >
        {/* Blurred background to avoid black bars on vertical videos */}
        <video
          src={hasPreview ? previewUrl : variants.length === 0 ? videoUrl : undefined}
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-50"
          preload="auto"
          aria-hidden="true"
        >
          {!hasPreview && variants.length > 0
            ? variants.map((variant) => (
                <source key={variant.format} src={resolveMediaUrl(variant.fileUrl)} type={variant.sourceType} />
              ))
            : null}
        </video>
        <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

        <div className="absolute inset-0 z-10">
          {hasPreview ? (
            <video
              ref={previewVideoRef}
              src={previewUrl}
              muted
              loop
              playsInline
              className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${
                isFullReady ? 'opacity-0' : 'opacity-100'
              }`}
              preload="auto"
              onPlay={() => {
                setIsPlaying(true);
                lastActivePlayingRef.current = true;
              }}
              onPause={() => {
                setIsPlaying(false);
                lastActivePlayingRef.current = false;
              }}
              onTimeUpdate={() => {
                if (previewVideoRef.current) {
                  lastPreviewTimeRef.current = previewVideoRef.current.currentTime || 0;
                }
              }}
              aria-label={t('memeModal.ariaVideo', { defaultValue: 'Видео' }) + `: ${currentMeme.title}`}
            />
          ) : null}

          <video
            ref={videoRef}
            src={variants.length === 0 ? videoUrl : undefined}
            muted={isMuted}
            loop
            playsInline
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${
              !hasPreview || isFullReady ? 'opacity-100' : 'opacity-0'
            }`}
            preload="auto"
            onPlay={() => {
              setIsPlaying(true);
              lastActivePlayingRef.current = true;
            }}
            onPause={() => {
              setIsPlaying(false);
              lastActivePlayingRef.current = false;
            }}
            onCanPlay={() => {
              if (isFullReady) return;
              const previewTime = lastPreviewTimeRef.current;
              if (videoRef.current && Number.isFinite(previewTime)) {
                try {
                  videoRef.current.currentTime = Math.max(0, previewTime);
                } catch {
                  // ignore seek errors
                }
              }
              if (lastActivePlayingRef.current) {
                videoRef.current?.play().catch(() => {
                  // ignore autoplay errors
                });
              }
              previewVideoRef.current?.pause();
              setIsFullReady(true);
            }}
            onError={() => {
              toast.error(t('memeModal.videoLoadFailed', { defaultValue: 'Не удалось загрузить видео' }));
            }}
            aria-label={t('memeModal.ariaVideo', { defaultValue: 'Видео' }) + `: ${currentMeme.title}`}
          >
            {variants.length > 0
              ? variants.map((variant) => (
                  <source key={variant.format} src={resolveMediaUrl(variant.fileUrl)} type={variant.sourceType} />
                ))
              : null}
          </video>
        </div>

        {/* Custom Video Controls */}
        <div className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-full bg-white/15 px-2 py-2 backdrop-blur-md ring-1 ring-white/20 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
          <button
            type="button"
            onClick={handlePlayPause}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-colors hover:bg-white/30"
            aria-label={
              isPlaying
                ? t('common.pause', { defaultValue: 'Пауза' })
                : t('common.play', { defaultValue: 'Воспроизвести' })
            }
            aria-pressed={isPlaying}
          >
            {isPlaying ? (
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <div className="group/volume flex items-center gap-1 pr-1">
            <button
              type="button"
              onClick={handleMute}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-colors hover:bg-white/30"
              aria-label={
                isMuted
                  ? t('common.soundOn', { defaultValue: 'Со звуком' })
                  : t('common.mute', { defaultValue: 'Без звука' })
              }
              aria-pressed={isMuted}
            >
              {isMuted ? (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              )}
            </button>

            <div className="flex items-center overflow-hidden max-w-0 opacity-0 pointer-events-none transition-all duration-200 group-hover/volume:max-w-[96px] group-hover/volume:opacity-100 group-hover/volume:pointer-events-auto group-focus-within/volume:max-w-[96px] group-focus-within/volume:opacity-100 group-focus-within/volume:pointer-events-auto">
              <label className="ml-1 flex items-center">
                <span className="sr-only">{t('common.volume', { defaultValue: 'Громкость' })}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="h-1 w-24 cursor-pointer rounded-full bg-white/40 accent-white"
                  aria-label={t('common.volume', { defaultValue: 'Громкость' })}
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* Info Section - Right */}
      <aside
        className="w-full md:w-80 border-t md:border-t-0 border-black/5 dark:border-white/10 bg-gray-50 dark:bg-gray-900 overflow-y-auto relative"
        aria-label="Meme information"
      >
        {/* Action buttons in top right corner */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          {mode === 'admin' && isOwner && (
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
            {isEditing && mode === 'admin' ? (
              <Input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="text-2xl font-bold px-3 py-2"
                disabled={!isEditing}
              />
            ) : (
              <h2 id="meme-modal-title" className="text-2xl font-bold dark:text-white flex flex-wrap items-center gap-3">
                <span>{currentMeme.title}</span>
                {canViewAi && isAiProcessing ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                    <Spinner className="h-3 w-3" />
                    {t('submissions.aiProcessing', { defaultValue: 'AI: processing…' })}
                  </span>
                ) : null}
              </h2>
            )}
          </div>

          {tagNames.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t('memeModal.tags', { defaultValue: 'Tags' })}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {tagNames.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onTagSearch?.(tag)}
                    disabled={!canTagSearch}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors ${
                      canTagSearch
                        ? 'bg-white/70 text-gray-800 ring-black/5 hover:bg-white dark:bg-white/10 dark:text-gray-100 dark:ring-white/10 dark:hover:bg-white/20'
                        : 'bg-white/60 text-gray-500 ring-black/5 dark:bg-white/5 dark:text-gray-400 dark:ring-white/10'
                    }`}
                    aria-disabled={!canTagSearch}
                    aria-label={t('memeModal.searchByTag', { defaultValue: 'Search by tag {{tag}}', tag })}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          )}

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

              <div className="mt-2">
                <AiRegenerateButton meme={currentMeme} show={canRegenerateAi} />
              </div>

              {!hasAi ? (
                <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                  {t('memeModal.aiPending', { defaultValue: 'AI: данных пока нет (ещё в обработке или не записалось).' })}
                </div>
              ) : null}

              {hasAiDesc ? (
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

          {isEditing && mode === 'admin' ? (
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
                {mode === 'admin' && (
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
              {mode === 'viewer' && (
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
              {mode === 'admin' && isOwner && !isEditing && (
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
