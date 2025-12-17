import { useState, useEffect, useRef } from 'react';
import type { Meme } from '../types';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

interface MemeModalProps {
  meme: Meme | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  isOwner: boolean;
  mode?: 'admin' | 'viewer';
  onActivate?: (memeId: string) => Promise<void>;
  walletBalance?: number;
}

export default function MemeModal({ 
  meme, 
  isOpen, 
  onClose, 
  onUpdate, 
  isOwner, 
  mode = 'admin',
  onActivate,
  walletBalance
}: MemeModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [currentMeme, setCurrentMeme] = useState<Meme | null>(meme);
  const [formData, setFormData] = useState({
    title: '',
    priceCoins: 0,
    durationMs: 0,
  });
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Update currentMeme when meme prop changes
  useEffect(() => {
    if (meme) {
      setCurrentMeme(meme);
      setFormData({
        title: meme.title,
        priceCoins: meme.priceCoins,
        durationMs: meme.durationMs,
      });
      setIsEditing(false);
    }
  }, [meme]);

  // Auto-play video when modal opens
  useEffect(() => {
    if (isOpen && videoRef.current && currentMeme) {
      videoRef.current.play().catch(() => {
        // Ignore autoplay errors
      });
      setIsPlaying(true);
    } else if (!isOpen && videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, [isOpen, currentMeme]);

  if (!isOpen || !currentMeme) return null;

  const getVideoUrl = () => {
    // If already absolute URL, return as is
    if (currentMeme.fileUrl.startsWith('http://') || currentMeme.fileUrl.startsWith('https://')) {
      return currentMeme.fileUrl;
    }
    
    // For beta domain, always use production domain for static files (uploads)
    const isBetaDomain = typeof window !== 'undefined' && window.location.hostname.includes('beta.');
    if (isBetaDomain && currentMeme.fileUrl.startsWith('/uploads/')) {
      return `https://twitchmemes.ru${currentMeme.fileUrl}`;
    }
    
    // For production or non-upload paths, use normal logic
    const apiUrl = import.meta.env.VITE_API_URL || '';
    if (apiUrl && !currentMeme.fileUrl.startsWith('/')) {
      return `${apiUrl}/${currentMeme.fileUrl}`;
    }
    return currentMeme.fileUrl.startsWith('/') ? currentMeme.fileUrl : `/${currentMeme.fileUrl}`;
  };

  const videoUrl = getVideoUrl();
  const creatorName = currentMeme.createdBy?.displayName || 'Unknown';
  const source = currentMeme.fileUrl.startsWith('http://') || currentMeme.fileUrl.startsWith('https://') 
    ? 'imported' 
    : 'uploaded';

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const handleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await api.patch(`/admin/memes/${currentMeme.id}`, formData);
      setCurrentMeme(response.data);
      toast.success('Meme updated successfully!');
      setIsEditing(false);
      onUpdate();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update meme');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (currentMeme) {
      setFormData({
        title: currentMeme.title,
        priceCoins: currentMeme.priceCoins,
        durationMs: currentMeme.durationMs,
      });
    }
  };

  const handleActivate = async () => {
    if (onActivate && currentMeme) {
      await onActivate(currentMeme.id);
      onClose();
    }
  };

  const canActivate = mode === 'viewer' && onActivate && walletBalance !== undefined && currentMeme && walletBalance >= currentMeme.priceCoins;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="meme-modal-title"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        {/* Video Section - Left */}
        <section className="flex-1 bg-black flex items-center justify-center relative" aria-label="Video player">
          <video
            ref={videoRef}
            src={videoUrl}
            loop
            playsInline
            className="max-w-full max-h-full object-contain"
            preload="auto"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            aria-label={`Video: ${currentMeme.title}`}
          />
          
          {/* Custom Video Controls */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-3 bg-black bg-opacity-60 rounded-full px-4 py-2">
            <button
              onClick={handlePlayPause}
              className="text-white hover:text-gray-300 transition-colors"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={handleMute}
              className="text-white hover:text-gray-300 transition-colors"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              )}
            </button>
          </div>
        </section>

        {/* Info Section - Right */}
        <aside className="w-80 border-l border-secondary/30 dark:border-secondary/30 bg-gray-50 dark:bg-gray-900 overflow-y-auto relative" aria-label="Meme information">
          {/* Action buttons in top right corner */}
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            {mode === 'admin' && isOwner && (
              <button
                onClick={isEditing ? handleCancel : handleEdit}
                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors group"
                title={isEditing ? 'Cancel editing' : 'Edit meme'}
              >
                <svg
                  className={`w-5 h-5 ${isEditing ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400 group-hover:text-primary'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {isEditing ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  )}
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
              title="Close"
            >
              <svg
                className="w-5 h-5 text-gray-600 dark:text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 space-y-6 pt-16">
            {/* Title */}
            <div>
              {isEditing && mode === 'admin' ? (
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded px-3 py-2 text-2xl font-bold"
                  disabled={!isEditing}
                />
              ) : (
                <h2 id="meme-modal-title" className="text-2xl font-bold dark:text-white">
                  {currentMeme.title}
                </h2>
              )}
            </div>

            {isEditing && mode === 'admin' ? (
              <form onSubmit={handleSave} className="space-y-4" aria-label="Edit meme form">
                <div>
                  <label htmlFor="meme-price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Price (coins)
                  </label>
                  <input
                    id="meme-price"
                    type="number"
                    value={formData.priceCoins}
                    onChange={(e) => setFormData({ ...formData, priceCoins: parseInt(e.target.value) || 0 })}
                    className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
                    min="1"
                    required
                    aria-required="true"
                  />
                </div>
                <div>
                  <label htmlFor="meme-duration" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Duration (ms)
                  </label>
                  <input
                    id="meme-duration"
                    type="number"
                    value={formData.durationMs}
                    onChange={(e) => setFormData({ ...formData, durationMs: parseInt(e.target.value) || 0 })}
                    className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
                    min="1"
                    required
                    aria-required="true"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-primary hover:bg-secondary disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors font-medium border border-secondary/30"
                  >
                    {loading ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-secondary/20 dark:hover:bg-secondary/20 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg transition-colors font-medium border border-secondary/30"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Price</div>
                    <div className="text-lg font-semibold text-accent">{currentMeme.priceCoins} coins</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Duration</div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">{currentMeme.durationMs}ms</div>
                  </div>
                  {mode === 'admin' && (
                    <>
                      <div>
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Created by</div>
                        <div className="text-base text-gray-900 dark:text-white">{creatorName}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Source</div>
                        <div className="text-base text-gray-900 dark:text-white capitalize">{source}</div>
                      </div>
                      {currentMeme.status && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Status</div>
                          <div className="text-base text-gray-900 dark:text-white capitalize">{currentMeme.status}</div>
                        </div>
                      )}
                      {currentMeme.createdAt && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Created</div>
                          <div className="text-base text-gray-900 dark:text-white">
                            {new Date(currentMeme.createdAt).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Activate button for viewer mode */}
                {mode === 'viewer' && (
                  <div className="pt-4 border-t border-secondary/30 dark:border-secondary/30">
                    <button
                      onClick={handleActivate}
                      disabled={!canActivate}
                      className="w-full bg-primary hover:bg-secondary disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition-colors border border-secondary/30"
                    >
                      {walletBalance === undefined 
                        ? 'Loading...' 
                        : walletBalance < (currentMeme.priceCoins || 0)
                        ? `Insufficient coins (need ${currentMeme.priceCoins})`
                        : 'Activate'}
                    </button>
                    {walletBalance !== undefined && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
                        Your balance: {walletBalance} coins
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
