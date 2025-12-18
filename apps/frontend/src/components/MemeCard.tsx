import { useState, useRef, useEffect } from 'react';
import type { Meme } from '../types';

interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
  onActivate?: (memeId: string) => void;
  walletBalance?: number;
  canActivate?: boolean;
}

export default function MemeCard({ meme, onClick, onActivate, walletBalance, canActivate }: MemeCardProps) {
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
      
      if (isHovered) {
        // When hovered, play video
        video.play().catch(() => {
          // Ignore autoplay errors
        });
        // Enable sound if user has interacted with page
        video.muted = !hasUserInteracted;
      } else {
        // When not hovered, pause and reset
        video.pause();
        video.currentTime = 0;
        video.muted = true; // Always mute when not hovered
      }
    }
  }, [meme.type, isHovered, hasUserInteracted]);

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
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
            muted={!hasUserInteracted || !isHovered}
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
        {isHovered && (
          <>
            <div 
              className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-3 text-center transition-opacity duration-200"
              aria-label={`Meme title: ${meme.title}`}
            >
              <p className="text-lg font-semibold">{meme.title}</p>
            </div>
            {onActivate && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/90 text-white p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{meme.priceCoins} coins</span>
                  {!canActivate && walletBalance !== undefined && (
                    <span className="text-xs text-yellow-300">
                      Need {meme.priceCoins - walletBalance} more
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onActivate(meme.id);
                  }}
                  disabled={!canActivate}
                  className={`w-full font-semibold py-2 px-4 rounded-lg transition-colors ${
                    canActivate
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-gray-600 text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {canActivate ? 'Activate Meme' : 'Insufficient Coins'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
