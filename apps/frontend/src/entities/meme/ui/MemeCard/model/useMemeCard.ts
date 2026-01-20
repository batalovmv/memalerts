import { useEffect, useRef, useState } from 'react';

import type { Meme } from '@/types';

import { useHasUserInteracted } from '@/lib/userInteraction';
import { getMemePrimaryId } from '@/shared/lib/memeIds';

export type MemeCardPreviewMode = 'hoverWithSound' | 'hoverMuted' | 'autoplayMuted';

export function useMemeCard(params: { meme: Meme; mediaUrl: string; previewMode: MemeCardPreviewMode; onClick: () => void }) {
  const { meme, mediaUrl, previewMode, onClick } = params;

  const [isHovered, setIsHovered] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const hasUserInteracted = useHasUserInteracted();
  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const memePrimaryId = getMemePrimaryId(meme);

  const cardRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Lazy-load heavy media only when card is near/inside viewport.
  // This matches the "seen N cards -> load N previews" behavior from the reference grid.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    // If we've already decided to load media, keep it loaded (avoid re-buffering while scrolling).
    if (shouldLoadMedia) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoadMedia(true);
            obs.disconnect();
            return;
          }
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0.01 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [shouldLoadMedia]);

  // Handle media metadata loading and precise aspect ratio (video/image)
  useEffect(() => {
    let cancelled = false;

    if (!shouldLoadMedia) return;

    if (meme.type === 'video') {
      const video = videoRef.current;
      if (!video) return;

      const handleLoadedMetadata = () => {
        if (cancelled) return;
        if (video.videoWidth && video.videoHeight) {
          const ratio = video.videoWidth / video.videoHeight;
          if (Number.isFinite(ratio) && ratio > 0) {
            setAspectRatio(ratio);
          }
        }
      };

      if (video.readyState >= 1) {
        handleLoadedMetadata();
      } else {
        video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      }

      return () => {
        cancelled = true;
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
    }

    // Images/GIFs: load dimensions
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const ratio = w && h ? w / h : null;
      if (ratio && Number.isFinite(ratio) && ratio > 0) {
        setAspectRatio(ratio);
      }
    };
    img.src = mediaUrl;

    return () => {
      cancelled = true;
    };
  }, [memePrimaryId, meme.type, mediaUrl, shouldLoadMedia]);

  // Handle video playback on hover (unified logic)
  useEffect(() => {
    if (!videoRef.current || meme.type !== 'video') return;
    const video = videoRef.current;
    if (!shouldLoadMedia) {
      video.pause();
      return;
    }

    if (previewMode === 'autoplayMuted') {
      // Feed-style preview: always muted autoplay (browser allows autoplay only when muted).
      void video.play().catch(() => {});
      return;
    }

    // Hover previews: only play while hovered (keeps UX predictable and avoids background audio).
    if (isHovered) {
      // Make sure volume is sane; muting is controlled by JSX for reliability.
      video.volume = 1;
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [meme.type, isHovered, previewMode, shouldLoadMedia]);

  const handleCardInteraction = () => {
    if (videoRef.current) {
      // Only unmute on direct user interaction if sound-on mode is enabled.
      if (previewMode === 'hoverWithSound') {
        videoRef.current.muted = false;
      }
    }
  };

  return {
    // state
    aspectRatio,
    isHovered,
    shouldLoadMedia,
    // refs
    setCardEl: (node: HTMLElement | null) => {
      cardRef.current = node;
    },
    videoRef,
    // derived
    getVideoMuted: () => (previewMode === 'hoverWithSound' ? !(hasUserInteracted && isHovered) : true),
    // handlers
    onMouseEnter: () => {
      setIsHovered(true);
      if (!shouldLoadMedia) return;
      if (videoRef.current && meme.type === 'video') {
        // Restart on hover (matches expected UX)
        try {
          videoRef.current.currentTime = 0;
        } catch {
          // ignore
        }
        // Do not call play() here; playback/unmute is coordinated in the effect to avoid races.
      }
    },
    onMouseLeave: () => {
      setIsHovered(false);
      // Important: don't reset/restart here. Leaving should not cause a replay.
    },
    onClick: () => onClick(),
    onMouseDown: handleCardInteraction,
    onTouchStart: handleCardInteraction,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
  };
}


