import { useTranslation } from 'react-i18next';

import { Spinner } from '@/shared/ui';

export type SubmissionPreviewProps = {
  src: string;
  shouldLoad: boolean;
  aspectRatio: number;
  isPlaying: boolean;
  isMuted: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  onPlayPause: () => void;
  onToggleMute: () => void;
  onPlay: () => void;
  onPause: () => void;
};

export function SubmissionPreview({
  src,
  shouldLoad,
  aspectRatio,
  isPlaying,
  isMuted,
  videoRef,
  onPlayPause,
  onToggleMute,
  onPlay,
  onPause,
}: SubmissionPreviewProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl overflow-hidden bg-black/80" style={{ aspectRatio }}>
      {!shouldLoad || !src ? (
        <div className="w-full h-full flex items-center justify-center text-white/80 text-sm">
          <div className="flex items-center gap-2">
            <Spinner className="h-4 w-4 border-gray-200/40 border-t-white/90" />
            <span>{t('common.loading', { defaultValue: 'Loading...' })}</span>
          </div>
        </div>
      ) : (
        <div className="relative w-full h-full">
          <video
            ref={videoRef}
            src={src}
            playsInline
            preload="metadata"
            className="w-full h-full object-contain"
            onPlay={onPlay}
            onPause={onPause}
            onClick={(e) => {
              e.preventDefault();
              onPlayPause();
            }}
          />

          {/* Controls overlay */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Play button */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPlayPause();
              }}
              className="pointer-events-auto absolute inset-0 flex items-center justify-center"
              aria-label={
                isPlaying ? t('common.pause', { defaultValue: 'Pause' }) : t('common.play', { defaultValue: 'Play' })
              }
              aria-pressed={isPlaying}
            >
              <span className="glass-btn bg-black/40 hover:bg-black/50 text-white rounded-full w-14 h-14 flex items-center justify-center">
                {isPlaying ? (
                  <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                  </svg>
                ) : (
                  <svg className="w-7 h-7 ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </span>
            </button>

            {/* Sound toggle */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleMute();
              }}
              className="pointer-events-auto absolute top-2 right-2 glass-btn bg-black/40 hover:bg-black/50 text-white rounded-full w-10 h-10 flex items-center justify-center"
              aria-label={isMuted ? t('common.soundOn', { defaultValue: 'Sound on' }) : t('common.mute', { defaultValue: 'Mute' })}
              aria-pressed={isMuted}
              title={isMuted ? t('common.soundOn', { defaultValue: 'Sound on' }) : t('common.mute', { defaultValue: 'Mute' })}
            >
              {isMuted ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H3v6h3l5 4V5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M23 9l-6 6M17 9l6 6" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H3v6h3l5 4V5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 9a3 3 0 010 6" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7a6 6 0 010 10" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


