import { useState } from 'react';

import { resolveMediaUrl } from '../lib/urls';

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
    return resolveMediaUrl(normalizedSrc);
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

