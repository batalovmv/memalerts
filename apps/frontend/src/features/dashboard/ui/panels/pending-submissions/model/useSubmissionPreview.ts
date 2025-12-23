import { useEffect, useRef, useState } from 'react';

export function useSubmissionPreview(src: string) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

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
  };
}


