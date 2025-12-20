import { useState } from 'react';

interface VideoPreviewProps {
  src: string;
  title?: string;
  className?: string;
}

export default function VideoPreview({ src, title, className = '' }: VideoPreviewProps) {
  const [error, setError] = useState<string | null>(null);

  const normalizedSrc = (src || '').trim();
  const hasSrc = normalizedSrc.length > 0;

  // Construct full URL - handle both relative and absolute URLs
  const getVideoUrl = () => {
    if (!hasSrc) return '';
    // If already absolute URL, return as is
    if (normalizedSrc.startsWith('http://') || normalizedSrc.startsWith('https://')) {
      return normalizedSrc;
    }
    
    // For beta domain, always use production domain for static files (uploads)
    const isBetaDomain = typeof window !== 'undefined' && window.location.hostname.includes('beta.');
    if (isBetaDomain && normalizedSrc.startsWith('/uploads/')) {
      return `https://twitchmemes.ru${normalizedSrc}`;
    }
    
    // For production or non-upload paths, use normal logic
    const apiUrl = import.meta.env.VITE_API_URL || '';
    if (apiUrl && !normalizedSrc.startsWith('/')) {
      return `${apiUrl}/${normalizedSrc}`;
    }
    return normalizedSrc.startsWith('/') ? normalizedSrc : `/${normalizedSrc}`;
  };

  const videoUrl = getVideoUrl();

  const handleError = () => {
    setError('Failed to load video');
  };

  const handleDownload = () => {
    if (!videoUrl) return;
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
        {!hasSrc ? (
          <div className="aspect-video flex items-center justify-center bg-gray-800">
            <div className="text-center text-gray-200">
              <p className="font-medium">Processing…</p>
              <p className="text-sm text-gray-400 mt-1">Video is being prepared</p>
            </div>
          </div>
        ) : error ? (
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
      {hasSrc && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={handleDownload}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            Download video
          </button>
          <span className="text-sm text-gray-500">URL: {videoUrl}</span>
        </div>
      )}
    </div>
  );
}

