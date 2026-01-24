import { useEffect, useRef, useState } from 'react';

import { getUserPreferences, patchUserPreferences } from '@/shared/lib/userPreferences';

type UseMemeModalPlaybackParams = {
  isOpen: boolean;
  memeId?: string;
  hasPreview: boolean;
  userId?: string;
};

export function useMemeModalPlayback({ isOpen, memeId, hasPreview, userId }: UseMemeModalPlaybackParams) {
  const MUTED_STORAGE_KEY = 'memalerts:memeModalMuted';
  const VOLUME_STORAGE_KEY = 'memalerts:memeModalVolume';
  const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1);

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
  const [isFullReady, setIsFullReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const lastNonZeroVolumeRef = useRef<number>(1);
  const volumeRef = useRef<number>(1);
  const lastPreviewTimeRef = useRef<number>(0);
  const lastActivePlayingRef = useRef<boolean>(true);

  const persistAudioToLocalStorage = (nextMuted: boolean, nextVolume: number) => {
    try {
      window.localStorage.setItem(MUTED_STORAGE_KEY, nextMuted ? '1' : '0');
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(nextVolume));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setIsFullReady(false);
    lastPreviewTimeRef.current = 0;
  }, [memeId]);

  useEffect(() => {
    if (!isOpen) return;
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isOpen, memeId, isMuted]);

  useEffect(() => {
    if (!isOpen) return;
    if (videoRef.current) videoRef.current.volume = clamp01(volume);
  }, [isOpen, memeId, volume]);

  useEffect(() => {
    volumeRef.current = volume;
    if (volume > 0) lastNonZeroVolumeRef.current = volume;
  }, [volume]);

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
  }, [userId]);

  useEffect(() => {
    if (isOpen && memeId) {
      const target = !hasPreview || isFullReady ? videoRef.current : previewVideoRef.current;
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
  }, [hasPreview, isFullReady, isOpen, memeId]);

  const getActiveVideo = () => (!hasPreview || isFullReady ? videoRef.current : previewVideoRef.current);

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
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    if (nextMuted && volume > 0) lastNonZeroVolumeRef.current = volume;
    const nextVolume = nextMuted ? 0 : clamp01(lastNonZeroVolumeRef.current || 1);

    if (!nextMuted && nextVolume > 0) lastNonZeroVolumeRef.current = nextVolume;
    videoRef.current.muted = nextMuted;
    videoRef.current.volume = nextVolume;

    setIsMuted(nextMuted);
    setVolume(nextVolume);
    persistAudioToLocalStorage(nextMuted, nextVolume);

    if (userId) void patchUserPreferences({ memeModalMuted: nextMuted, memeModalVolume: nextVolume });
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
    if (userId) void patchUserPreferences({ memeModalMuted: nextMuted, memeModalVolume: nextVolume });
  };

  const handlePreviewPlay = () => {
    setIsPlaying(true);
    lastActivePlayingRef.current = true;
  };

  const handlePreviewPause = () => {
    setIsPlaying(false);
    lastActivePlayingRef.current = false;
  };

  const handlePreviewTimeUpdate = () => {
    if (previewVideoRef.current) {
      lastPreviewTimeRef.current = previewVideoRef.current.currentTime || 0;
    }
  };

  const handleFullPlay = () => {
    setIsPlaying(true);
    lastActivePlayingRef.current = true;
  };

  const handleFullPause = () => {
    setIsPlaying(false);
    lastActivePlayingRef.current = false;
  };

  const handleFullCanPlay = () => {
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
  };

  return {
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
  };
}
