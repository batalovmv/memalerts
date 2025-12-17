import { useState } from 'react';

interface VideoPreviewProps {
  src: string;
  title?: string;
  className?: string;
}

export default function VideoPreview({ src, title, className = '' }: VideoPreviewProps) {
  const [error, setError] = useState<string | null>(null);

  // Construct full URL - handle both relative and absolute URLs
  const getVideoUrl = () => {
    // If already absolute URL, return as is
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }
    
    // For beta domain, always use production domain for static files (uploads)
    const isBetaDomain = typeof window !== 'undefined' && window.location.hostname.includes('beta.');
    if (isBetaDomain && src.startsWith('/uploads/')) {
      return `https://twitchmemes.ru${src}`;
    }
    
    // For production or non-upload paths, use normal logic
    const apiUrl = import.meta.env.VITE_API_URL || '';
    if (apiUrl && !src.startsWith('/')) {
      return `${apiUrl}/${src}`;
    }
    return src.startsWith('/') ? src : `/${src}`;
  };

  const videoUrl = getVideoUrl();

  const handleError = () => {
    setError('Failed to load video');
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = title || 'video';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={`relative ${className}`}>
      <div className="bg-gray-900 rounded-lg overflow-hidden">
        {error ? (
          <div className="aspect-video flex items-center justify-center bg-gray-800">
            <div className="text-center text-white">
              <p className="text-red-400 mb-2">{error}</p>
              <p className="text-sm text-gray-400">URL: {videoUrl}</p>
              <button
                onClick={handleDownload}
                className="mt-2 text-blue-400 hover:text-blue-300 underline text-sm"
              >
                Try to download
              </button>
            </div>
          </div>
        ) : (
          <video
            src={videoUrl}
            controls
            className="w-full max-h-96"
            onError={handleError}
            preload="metadata"
          >
            Your browser does not support the video tag.
          </video>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={handleDownload}
          className="text-sm text-blue-600 hover:text-blue-800 underline"
        >
          Download video
        </button>
        <span className="text-sm text-gray-500">URL: {videoUrl}</span>
      </div>
    </div>
  );
}

