import { useState, useRef, useEffect, useMemo } from 'react';
import type { Meme } from '../types';

interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
}

export default function MemeCard({ meme, onClick, isOwner = false }: MemeCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Generate consistent aspect ratio based on meme ID for stable layout
  const aspectRatio = useMemo(() => {
    // Use meme ID to deterministically assign aspect ratio
    const hash = meme.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return hash % 2 === 0 ? 'aspect-[9/16]' : 'aspect-square';
  }, [meme.id]);

  useEffect(() => {
    if (videoRef.current) {
      if (isHovered) {
        videoRef.current.play().catch(() => {
          // Ignore autoplay errors
        });
      } else {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
  }, [isHovered]);

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
      className="bg-white overflow-hidden cursor-pointer break-inside-avoid mb-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`View meme: ${meme.title}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className={`relative w-full ${aspectRatio} bg-gray-900`}>
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          loop
          playsInline
          className="w-full h-full object-cover"
          preload="metadata"
          aria-label={`Video preview: ${meme.title}`}
        />
        {isOwner && (
          <div 
            className="absolute top-2 right-2 bg-purple-600 bg-opacity-80 text-white text-xs px-2 py-1 rounded"
            aria-label="Your meme"
          >
            Your Meme
          </div>
        )}
      </div>
    </article>
  );
}

