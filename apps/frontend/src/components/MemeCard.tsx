import { useState, useRef, useEffect } from 'react';
import type { Meme } from '../types';

interface MemeCardProps {
  meme: Meme;
  onClick: () => void;
  isOwner?: boolean;
}

export default function MemeCard({ meme, onClick, isOwner = false }: MemeCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

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
  const creatorName = meme.createdBy?.displayName || 'Unknown';

  return (
    <div
      className="bg-white rounded-lg shadow-md overflow-hidden cursor-pointer transform transition-transform hover:scale-105"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      <div className="relative aspect-video bg-gray-900">
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          loop
          playsInline
          className="w-full h-full object-cover"
          preload="metadata"
        />
        {isOwner && (
          <div className="absolute top-2 right-2 bg-purple-600 text-white text-xs px-2 py-1 rounded">
            Your Meme
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-lg mb-1 line-clamp-1">{meme.title}</h3>
        <p className="text-sm text-gray-600">
          {meme.priceCoins} coins • {meme.durationMs}ms
        </p>
        <p className="text-xs text-gray-500 mt-1">
          By {creatorName}
        </p>
      </div>
    </div>
  );
}

