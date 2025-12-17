import { useState, useRef, useEffect } from 'react';
import type { Meme } from '../types';

interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
}

export default function MemeCard({ meme, onClick }: MemeCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>('aspect-video');
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isLoadingMetadataRef = useRef<boolean>(false);

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

  // Determine real video aspect ratio - only load metadata on hover
  useEffect(() => {
    if (videoRef.current && meme.type === 'video' && isHovered) {
      const video = videoRef.current;
      
      const handleLoadedMetadata = () => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MemeCard.tsx:handleLoadedMetadata',message:'metadata loaded',data:{memeId:meme.id,readyState:video.readyState,width:video.videoWidth,height:video.videoHeight},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        isLoadingMetadataRef.current = false;
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

      // Reset loading flag when hover ends
      if (!isHovered) {
        isLoadingMetadataRef.current = false;
        return;
      }

      if (video.readyState >= 1) {
        // Metadata already loaded
        handleLoadedMetadata();
      } else if (!isLoadingMetadataRef.current) {
        // Load metadata when hovered, but only if not already loading
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MemeCard.tsx:load-metadata',message:'loading metadata',data:{memeId:meme.id,readyState:video.readyState,isHovered,isLoading:isLoadingMetadataRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        isLoadingMetadataRef.current = true;
        video.load();
        video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      }

      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        // Reset loading flag on cleanup
        if (!isHovered) {
          isLoadingMetadataRef.current = false;
        }
      };
    } else if (meme.type !== 'video') {
      // For images/gifs, use default aspect ratio
      setAspectRatio('aspect-video');
    } else if (!isHovered) {
      // Reset loading flag when not hovered
      isLoadingMetadataRef.current = false;
    }
  }, [meme.type, meme.fileUrl, isHovered, meme.id]);

  useEffect(() => {
    if (videoRef.current) {
      if (isHovered) {
        videoRef.current.play().catch(() => {
          // Ignore autoplay errors
        });
        // Enable sound if user has interacted with page (not just this card)
        videoRef.current.muted = !hasUserInteracted;
      } else {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
        videoRef.current.muted = true; // Always mute when not hovered
      }
    }
  }, [isHovered, hasUserInteracted]);

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
            preload="none"
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
          <div 
            className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-3 text-center transition-opacity duration-200"
            aria-label={`Meme title: ${meme.title}`}
          >
            <p className="text-lg font-semibold">{meme.title}</p>
          </div>
        )}
      </div>
    </article>
  );
}
