import { useState, useRef, useEffect } from 'react';
import type { Meme } from '../types';

interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
  onActivate?: (memeId: string) => void;
  walletBalance?: number;
  canActivate?: boolean;
  previewMode?: 'hoverWithSound' | 'autoplayMuted';
}

export default function MemeCard({ meme, onClick, onActivate, walletBalance, canActivate, previewMode = 'hoverWithSound' }: MemeCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>('aspect-video');
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

  // Handle video metadata loading and aspect ratio (runs once when video loads)
  useEffect(() => {
    if (videoRef.current && meme.type === 'video') {
      const video = videoRef.current;
      
      const handleLoadedMetadata = () => {
        if (video.videoWidth && video.videoHeight) {
          const ratio = video.videoWidth / video.videoHeight;
          
          // Determine aspect ratio class based on actual dimensions
          if (ratio > 1.3) {
            // Horizontal (16:9 or wider)
            setAspectRatio('aspect-video');
          } else if (ratio < 0.8) {
            // Vertical (9:16 or taller)
            setAspectRatio('aspect-[9/16]');
          } else {
            // Square (approximately 1:1)
            setAspectRatio('aspect-square');
          }
        }
      };

      // If metadata is already loaded, set aspect ratio immediately
      if (video.readyState >= 1) {
        handleLoadedMetadata();
      } else {
        // Listen for metadata load (only once per video)
        video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      }

      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
    } else if (meme.type !== 'video') {
      // For images/gifs, use default aspect ratio
      setAspectRatio('aspect-video');
    }
  }, [meme.type, meme.fileUrl, meme.id]);

  // Handle video playback on hover (unified logic)
  useEffect(() => {
    if (videoRef.current && meme.type === 'video') {
      const video = videoRef.current;

      // Autoplay preview mode (profile feed-style): always muted + looping.
      if (previewMode === 'autoplayMuted') {
        video.muted = true;
        // Try to keep playing (browser allows autoplay only if muted).
        video.play().catch(() => {
          // Ignore autoplay errors (e.g., low power mode / browser policy quirks)
        });
        return;
      }

      // Default mode: play on hover, unmute only after user interaction.
      if (isHovered) {
        video.play().catch(() => {
          // Ignore autoplay errors
        });
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

  const videoUrl = getVideoUrl();

  return (
    <article
      className="bg-white dark:bg-gray-800 overflow-hidden cursor-pointer break-inside-avoid mb-0 border border-secondary/10 hover:border-secondary/30 transition-colors"
      onMouseEnter={() => {
        setIsHovered(true);
        if (previewMode === 'autoplayMuted' && videoRef.current && meme.type === 'video') {
          // Restart preview on hover (as requested).
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
          // Restart again when leaving hover (so it always begins from start).
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
      <div className={`relative w-full ${aspectRatio} bg-gray-900`}>
        {meme.type === 'video' ? (
          <video
            ref={videoRef}
            src={videoUrl}
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
            src={videoUrl}
            alt={meme.title}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        )}
        {onActivate && (
          <div className="absolute top-2 right-2 z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onActivate(meme.id);
              }}
              disabled={!canActivate}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md shadow-lg transition-colors text-xs font-medium ${
                canActivate
                  ? 'bg-[var(--primary-color)] hover:bg-[var(--secondary-color)] text-white'
                  : 'bg-gray-600 text-gray-300 cursor-not-allowed'
              }`}
              title={!canActivate && walletBalance !== undefined 
                ? `Need ${meme.priceCoins - walletBalance} more coins` 
                : 'Activate Meme'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="hidden sm:inline">Activate</span>
            </button>
          </div>
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
      {/* Mobile: Always visible compact activate button */}
      {onActivate && (
        <div className="md:hidden absolute top-2 right-2 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onActivate(meme.id);
            }}
            disabled={!canActivate}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md shadow-lg transition-colors text-xs font-medium ${
              canActivate
                ? 'bg-[var(--primary-color)] hover:bg-[var(--secondary-color)] text-white'
                : 'bg-gray-600 text-gray-300 cursor-not-allowed'
            }`}
            title={!canActivate && walletBalance !== undefined 
              ? `Need ${meme.priceCoins - walletBalance} more coins` 
              : 'Activate Meme'}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Activate</span>
          </button>
        </div>
      )}
    </article>
  );
}
