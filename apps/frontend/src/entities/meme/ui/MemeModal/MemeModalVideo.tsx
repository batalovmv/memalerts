import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import type { Meme } from '@/types';
import type { RefObject } from 'react';

import { resolveMediaUrl } from '@/lib/urls';

type MemeModalVideoProps = {
  meme: Meme;
  variants: Array<{
    format: string;
    fileUrl: string;
    sourceType: string;
  }>;
  hasPreview: boolean;
  previewUrl: string;
  videoUrl: string;
  isFullReady: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  videoRef: RefObject<HTMLVideoElement>;
  previewVideoRef: RefObject<HTMLVideoElement>;
  onPlayPause: () => void;
  onMute: () => void;
  onVolumeChange: (next: number) => void;
  onPreviewPlay: () => void;
  onPreviewPause: () => void;
  onPreviewTimeUpdate: () => void;
  onPreviewError: () => void;
  onFullPlay: () => void;
  onFullPause: () => void;
  onFullCanPlay: () => void;
};

export function MemeModalVideo({
  meme,
  variants,
  hasPreview,
  previewUrl,
  videoUrl,
  isFullReady,
  isPlaying,
  isMuted,
  volume,
  videoRef,
  previewVideoRef,
  onPlayPause,
  onMute,
  onVolumeChange,
  onPreviewPlay,
  onPreviewPause,
  onPreviewTimeUpdate,
  onPreviewError,
  onFullPlay,
  onFullPause,
  onFullCanPlay,
}: MemeModalVideoProps) {
  const { t } = useTranslation();
  const fullCandidates = useMemo(() => {
    const urls = variants
      .map((variant) => ({
        url: resolveMediaUrl(variant.fileUrl),
        sourceType: variant.sourceType,
      }))
      .filter((entry) => Boolean(entry.url));

    if (videoUrl) {
      urls.push({ url: resolveMediaUrl(videoUrl), sourceType: '' });
    }

    const seen = new Set<string>();
    return urls.filter((entry) => {
      if (!entry.url) return false;
      if (seen.has(entry.url)) return false;
      seen.add(entry.url);
      return true;
    });
  }, [variants, videoUrl]);
  const [fullIndex, setFullIndex] = useState(0);

  useEffect(() => {
    setFullIndex(0);
  }, [meme.id]);

  const fullCandidate = fullCandidates[fullIndex];
  const backdropUrl = hasPreview ? previewUrl : fullCandidate?.url || videoUrl;
  const showBackdropVideo = Boolean(backdropUrl);
  const handleFullError = () => {
    const next = fullIndex + 1;
    if (next < fullCandidates.length) {
      setFullIndex(next);
      return;
    }
    toast.error(t('memeModal.videoLoadFailed', { defaultValue: 'Не удалось загрузить видео' }));
  };

  return (
    <section
      className="bg-black flex items-center justify-center relative w-full md:flex-1 h-[65vh] md:h-[82vh] overflow-hidden"
      aria-label="Video player"
    >
      {showBackdropVideo ? (
        <video
          src={backdropUrl || undefined}
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover blur-3xl scale-125 opacity-60 saturate-150"
          preload="metadata"
          aria-hidden="true"
        />
      ) : null}
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_55%)]"
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-black/45" aria-hidden="true" />

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
            onPlay={onPreviewPlay}
            onPause={onPreviewPause}
            onTimeUpdate={onPreviewTimeUpdate}
            onError={onPreviewError}
            aria-label={t('memeModal.ariaVideo', { defaultValue: 'Видео' }) + `: ${meme.title}`}
          />
        ) : null}

        <video
          ref={videoRef}
          src={fullCandidate?.url}
          muted={isMuted}
          loop
          playsInline
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${
            !hasPreview || isFullReady ? 'opacity-100' : 'opacity-0'
          }`}
          preload={hasPreview && !isFullReady ? 'metadata' : 'auto'}
          onPlay={onFullPlay}
          onPause={onFullPause}
          onCanPlay={onFullCanPlay}
          onError={handleFullError}
          aria-label={t('memeModal.ariaVideo', { defaultValue: 'Видео' }) + `: ${meme.title}`}
        />
      </div>

      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-full bg-white/15 px-2 py-2 backdrop-blur-md ring-1 ring-white/20 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
        <button
          type="button"
          onClick={onPlayPause}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-colors hover:bg-white/30"
          aria-label={
            isPlaying ? t('common.pause', { defaultValue: 'Пауза' }) : t('common.play', { defaultValue: 'Воспроизвести' })
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
            onClick={onMute}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-colors hover:bg-white/30"
            aria-label={isMuted ? t('common.soundOn', { defaultValue: 'Со звуком' }) : t('common.mute', { defaultValue: 'Без звука' })}
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
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                className="h-1 w-24 cursor-pointer rounded-full bg-white/40 accent-white"
                aria-label={t('common.volume', { defaultValue: 'Громкость' })}
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
