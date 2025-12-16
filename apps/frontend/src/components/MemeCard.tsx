import { useState, useRef, useEffect } from 'react';
import type { Meme } from '../types';

interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
}

export default function MemeCard({ meme, onClick, isOwner = false }: MemeCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>('aspect-video');
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Determine real video aspect ratio
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

      if (video.readyState >= 1) {
        // Metadata already loaded
        handleLoadedMetadata();
      } else {
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
      }

      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
    } else if (meme.type !== 'video') {
      // For images/gifs, use default aspect ratio
      setAspectRatio('aspect-video');
    }
  }, [meme.type, meme.fileUrl]);

  useEffect(() => {
    if (videoRef.current) {
      if (isHovered) {
        videoRef.current.play().catch(() => {
          // Ignore autoplay errors
        });
        // Enable sound if user has interacted
        if (hasUserInteracted) {
          videoRef.current.muted = false;
        }
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
    if (meme.fileUrl.startsWith('http://') || meme.fileUrl.startsWith('https://')) {
      return meme.fileUrl;
    }
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
