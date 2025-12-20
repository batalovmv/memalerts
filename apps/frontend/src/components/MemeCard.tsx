import { useState, useRef, useEffect } from 'react';
import type { Meme } from '../types';

interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
  previewMode?: 'hoverWithSound' | 'autoplayMuted';
}

export default function MemeCard({ meme, onClick, previewMode = 'hoverWithSound' }: MemeCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Track user interaction at page level (any click/touch on page)
  useEffect(() => {
    const handlePageInteraction = () => {
      setHasUserInteracted(true);
    };
    
    // Listen for any user interaction on the page
    document.addEventListener('click', handlePageInteraction, { once: true });
    document.addEventListener('touchstart', handlePageInteraction, { once: true });
    
    return () => {
      document.removeEventListener('click', handlePageInteraction);
      document.removeEventListener('touchstart', handlePageInteraction);
    };
  }, []);

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
  }, [meme.id, meme.type, mediaUrl]);

  // Handle video playback on hover (unified logic)
  useEffect(() => {
    if (videoRef.current && meme.type === 'video') {
      const video = videoRef.current;
      if (previewMode === 'autoplayMuted') {
        // Feed-style preview: always muted autoplay (browser allows autoplay only when muted).
        video.muted = true;
        void video.play().catch(() => {});
        return;
      }

      // Default: hover preview, unmute only after user interaction.
      if (isHovered) {
        void video.play().catch(() => {});
        video.muted = !hasUserInteracted;
      } else {
        video.pause();
        video.currentTime = 0;
        video.muted = true;
      }
    }
  }, [meme.type, isHovered, hasUserInteracted, previewMode]);

  const handleCardClick = () => {
    setHasUserInteracted(true);
    onClick();
  };

  const handleCardInteraction = () => {
    setHasUserInteracted(true);
    if (videoRef.current) {
      videoRef.current.muted = false;
    }
  };

  return (
    <article
      className="inline-block w-full bg-white dark:bg-gray-800 overflow-hidden rounded-xl cursor-pointer break-inside-avoid mb-2 border border-secondary/10 hover:border-secondary/30 transition-colors"
      onMouseEnter={() => {
        setIsHovered(true);
        if (previewMode === 'autoplayMuted' && videoRef.current && meme.type === 'video') {
          try {
            videoRef.current.currentTime = 0;
          } catch {
            // ignore
          }
          void videoRef.current.play().catch(() => {});
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        if (previewMode === 'autoplayMuted' && videoRef.current && meme.type === 'video') {
          try {
            videoRef.current.currentTime = 0;
          } catch {
            // ignore
          }
          void videoRef.current.play().catch(() => {});
        }
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
        {meme.type === 'video' ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            muted={previewMode === 'autoplayMuted' ? true : (!hasUserInteracted || !isHovered)}
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
