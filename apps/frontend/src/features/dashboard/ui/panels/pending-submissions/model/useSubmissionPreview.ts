import { useEffect, useRef, useState } from 'react';

export function useSubmissionPreview(src: string) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<{ name?: string; message?: string } | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);

  const cardRef = useRef<HTMLLIElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null!);

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
      { root: null, rootMargin: '300px 0px', threshold: 0.01 },
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

  // When media fails to load, try a cheap HEAD request to give a better hint (401/403/404/etc).
  // This runs only after an actual media error and only once per src.
  useEffect(() => {
    if (!error) return;
    if (!src) return;
    let cancelled = false;
    setHttpStatus(null);

    void (async () => {
      try {
        const resp = await fetch(src, { method: 'HEAD', credentials: 'include' });
        if (cancelled) return;
        setHttpStatus(resp.status);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [error, src]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      // Keep attribute and property in sync (some browsers can be finicky with programmatic play).
      video.muted = isMuted;
      setPlayError(null);
      if (video.paused) {
        await video.play();
        setIsPlaying(true);
      } else {
        video.pause();
        setIsPlaying(false);
      }
    } catch (e: unknown) {
      const err = e as { name?: unknown; message?: unknown };
      setPlayError({
        name: typeof err?.name === 'string' ? err.name : undefined,
        message: typeof err?.message === 'string' ? err.message : undefined,
      });
    }
  };

  return {
    cardRef,
    videoRef,
    shouldLoad,
    aspectRatio,
    isPlaying,
    setIsPlaying,
    isMuted,
    setIsMuted,
    togglePlay,
    error,
    playError,
    httpStatus,
    onVideoError: () => {
      // Keep it minimal; the preview component will render details.
      setError('MEDIA_ERROR');
    },
  };
}


