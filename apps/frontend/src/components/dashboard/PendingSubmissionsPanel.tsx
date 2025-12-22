import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Submission } from '../../types';

type Props = {
  isOpen: boolean;
  submissions: Submission[];
  submissionsLoading: boolean;
  submissionsLoadingMore: boolean;
  pendingCount: number;
  total: number | null;
  onClose: () => void;
  onLoadMore: () => void;
  onApprove: (submissionId: string) => void;
  onReject: (submissionId: string) => void;
};

export function PendingSubmissionsPanel({
  isOpen,
  submissions,
  submissionsLoading,
  submissionsLoadingMore,
  pendingCount,
  total,
  onClose,
  onLoadMore,
  onApprove,
  onReject,
}: Props) {
  const { t } = useTranslation();
  const pendingSubmissions = useMemo(() => submissions.filter((s) => s.status === 'pending'), [submissions]);
  const hasMore = typeof total === 'number' ? pendingSubmissions.length < total : true;
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (!hasMore) return;
    if (submissionsLoading || submissionsLoadingMore) return;
    const el = loadMoreRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            onLoadMore();
            return;
          }
        }
      },
      { root: null, rootMargin: '400px 0px', threshold: 0.01 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [isOpen, hasMore, submissionsLoading, submissionsLoadingMore, onLoadMore]);

  const resolveMediaUrl = (src: string): string => {
    const normalizedSrc = (src || '').trim();
    if (!normalizedSrc) return '';
    if (normalizedSrc.startsWith('http://') || normalizedSrc.startsWith('https://')) return normalizedSrc;
    const isBetaDomain = typeof window !== 'undefined' && window.location.hostname.includes('beta.');
    if (isBetaDomain && normalizedSrc.startsWith('/uploads/')) return `https://twitchmemes.ru${normalizedSrc}`;
    const apiUrl = import.meta.env.VITE_API_URL || '';
    if (apiUrl && !normalizedSrc.startsWith('/')) return `${apiUrl}/${normalizedSrc}`;
    return normalizedSrc.startsWith('/') ? normalizedSrc : `/${normalizedSrc}`;
  };

  return (
    <section
      className={`${isOpen ? 'block' : 'hidden'} surface max-w-6xl mx-auto`}
      aria-label={t('dashboard.pendingSubmissionsTitle', 'Pending submissions')}
    >
      <div className="surface-header">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xl font-bold dark:text-white truncate">
            {t('dashboard.pendingSubmissionsTitle', 'Pending submissions')}
          </h2>
          {pendingCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2.5 py-1">
              {pendingCount}
            </span>
          )}
          {submissionsLoading && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('common.loading')}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={t('common.close', { defaultValue: 'Close' })}
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="surface-body max-h-[70vh] overflow-y-auto">
        {pendingSubmissions.length === 0 ? (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-6 text-gray-700 dark:text-gray-300 shadow-sm">
            <div className="font-semibold mb-1">{t('dashboard.noPendingSubmissions', 'No pending submissions')}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('dashboard.noPendingSubmissionsHint', { defaultValue: 'New submissions will appear here automatically.' })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingSubmissions.map((submission) => (
              <PendingSubmissionCard
                key={submission.id}
                submission={submission}
                resolveMediaUrl={resolveMediaUrl}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))}
            {/* Infinite-scroll sentinel */}
            <div ref={loadMoreRef} className="h-8" />
            {submissionsLoadingMore && (
              <div className="text-center text-xs text-gray-500 dark:text-gray-400">
                {t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function PendingSubmissionCard({
  submission,
  resolveMediaUrl,
  onApprove,
  onReject,
}: {
  submission: Submission;
  resolveMediaUrl: (src: string) => string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [shouldLoad, setShouldLoad] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const src = resolveMediaUrl(submission.fileUrlTemp || '');

  useEffect(() => {
    const el = cardRef.current;
    if (!el || shouldLoad) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShouldLoad(true);
            obs.disconnect();
            return;
          }
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0.01 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !shouldLoad) return;
    const handleLoadedMetadata = () => {
      if (video.videoWidth && video.videoHeight) {
        const r = video.videoWidth / video.videoHeight;
        if (Number.isFinite(r) && r > 0) setAspectRatio(r);
      }
    };
    if (video.readyState >= 1) handleLoadedMetadata();
    else video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, [shouldLoad, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
  }, [isMuted]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (video.paused) {
        await video.play();
        setIsPlaying(true);
      } else {
        video.pause();
        setIsPlaying(false);
      }
    } catch {
      // ignore autoplay/user-gesture restrictions
    }
  };

  return (
    <div ref={cardRef} className="glass p-4">
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="shrink-0 w-full lg:w-[249px]">
          <div className="rounded-xl overflow-hidden bg-black/80" style={{ aspectRatio }}>
            {!shouldLoad || !src ? (
              <div className="w-full h-full flex items-center justify-center text-white/70 text-sm">
                {t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : (
              <div className="relative w-full h-full">
                <video
                  ref={videoRef}
                  src={src}
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-contain"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onClick={(e) => {
                    e.preventDefault();
                    void togglePlay();
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
                      void togglePlay();
                    }}
                    className="pointer-events-auto absolute inset-0 flex items-center justify-center"
                    aria-label={isPlaying ? t('common.pause', { defaultValue: 'Pause' }) : t('common.play', { defaultValue: 'Play' })}
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
                      setIsMuted((v) => !v);
                    }}
                    className="pointer-events-auto absolute top-2 right-2 glass-btn bg-black/40 hover:bg-black/50 text-white rounded-full w-10 h-10 flex items-center justify-center"
                    aria-label={isMuted ? t('common.soundOn', { defaultValue: 'Sound on' }) : t('common.mute', { defaultValue: 'Mute' })}
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
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-lg dark:text-white truncate">{submission.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t('dashboard.submittedBy', { defaultValue: 'Submitted by {{name}}', name: submission.submitter?.displayName || 'Unknown' })}
              </p>

            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => onApprove(submission.id)}
                className="glass-btn bg-emerald-500/90 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl font-semibold"
              >
                {t('admin.approve', 'Approve')}
              </button>
              <button
                onClick={() => onReject(submission.id)}
                className="glass-btn bg-rose-500/85 hover:bg-rose-500 text-white px-4 py-2 rounded-xl font-semibold"
              >
                {t('admin.reject', 'Reject')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


