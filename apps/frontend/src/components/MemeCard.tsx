import { useState, useRef, useEffect } from 'react';
import type { Meme } from '../types';

interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
  previewMode?: 'hoverWithSound' | 'hoverMuted' | 'autoplayMuted';
}

export default function MemeCard({ meme, onClick, previewMode = 'hoverWithSound' }: MemeCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const hasUserInteractedRef = useRef(false);
  const [shouldLoadMedia, setShouldLoadMedia] = useState(false);
  const [hasEverHovered, setHasEverHovered] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Track user interaction at page level (any click/touch on page)
  useEffect(() => {
    const handlePageInteraction = () => {
      setHasUserInteracted(true);
      hasUserInteractedRef.current = true;
    };
    
    // Listen for any user interaction on the page
    document.addEventListener('click', handlePageInteraction, { once: true });
    document.addEventListener('touchstart', handlePageInteraction, { once: true });
    
    return () => {
      document.removeEventListener('click', handlePageInteraction);
      document.removeEventListener('touchstart', handlePageInteraction);
    };
  }, []);

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
      { root: null, rootMargin: '300px 0px', threshold: 0.01 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [shouldLoadMedia]);

  // Resolve preview URL for images/videos
  const getVideoUrl = () => {
    // If already absolute URL, return as is
    if (meme.fileUrl.startsWith('http://') || meme.fileUrl.startsWith('https://')) {
      return meme.fileUrl;
    }
    
    // For beta domain, always use production domain for static files (uploads)
    const isBetaDomain = typeof window !== 'undefined' && window.location.hostname.includes('beta.');
    if (isBetaDomain && meme.fileUrl.startsWith('/uploads/')) {
      return `https://twitchmemes.ru${meme.fileUrl}`;
    }
    
    // For production or non-upload paths, use normal logic
    const apiUrl = import.meta.env.VITE_API_URL || '';
    if (apiUrl && !meme.fileUrl.startsWith('/')) {
      return `${apiUrl}/${meme.fileUrl}`;
    }
    return meme.fileUrl.startsWith('/') ? meme.fileUrl : `/${meme.fileUrl}`;
  };

  const mediaUrl = getVideoUrl();

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
  }, [meme.id, meme.type, mediaUrl, shouldLoadMedia]);

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

  const handleCardClick = () => {
    setHasUserInteracted(true);
    hasUserInteractedRef.current = true;
    onClick();
  };

  const handleCardInteraction = () => {
    setHasUserInteracted(true);
    hasUserInteractedRef.current = true;
    if (videoRef.current) {
      // Only unmute on direct user interaction if sound-on mode is enabled.
      if (previewMode === 'hoverWithSound') {
        videoRef.current.muted = false;
      }
    }
  };

  return (
    <article
      ref={(node) => {
        cardRef.current = node;
      }}
      className="block w-full bg-transparent overflow-hidden rounded-xl cursor-pointer break-inside-avoid mb-[5px] will-change-transform transition-transform duration-200 ease-out hover:scale-[1.02]"
      onMouseEnter={() => {
        setIsHovered(true);
        setHasEverHovered(true);
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
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        // Important: don't reset/restart here. Leaving should not cause a replay.
      }}
      onClick={handleCardClick}
      onMouseDown={handleCardInteraction}
      onTouchStart={handleCardInteraction}
      role="button"
      tabIndex={0}
      aria-label={`View meme: ${meme.title}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      <div className="relative w-full bg-gray-900" style={{ aspectRatio }}>
        {!shouldLoadMedia ? (
          <div className="w-full h-full bg-gray-900" aria-hidden="true" />
        ) : meme.type === 'video' ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            // Reliability > cleverness:
            // Keep `muted` controlled by React to avoid "stuck muted" states.
            // Sound is allowed only when:
            // - user enabled hover sound (previewMode === hoverWithSound)
            // - browser saw a user interaction (hasUserInteracted)
            // - the card is currently hovered (no background audio)
            muted={previewMode === 'hoverWithSound' ? !(hasUserInteracted && isHovered) : true}
            autoPlay={previewMode === 'autoplayMuted'}
            loop
            playsInline
            className="w-full h-full object-contain"
            preload="metadata"
            aria-label={`Video preview: ${meme.title}`}
          />
        ) : (
          <img
            src={mediaUrl}
            alt={meme.title}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        )}
        {isHovered && (
          <div 
            className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-2 text-center transition-opacity duration-200 z-0"
            aria-label={`Meme title: ${meme.title}`}
          >
            <p className="text-sm font-medium truncate px-2">{meme.title}</p>
          </div>
        )}
      </div>
    </article>
  );
}
