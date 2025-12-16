import { useState, useEffect } from 'react';
import type { Meme } from '../types';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

interface MemeModalProps {
  meme: Meme | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  isOwner: boolean;
}

export default function MemeModal({ meme, isOpen, onClose, onUpdate, isOwner }: MemeModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    priceCoins: 0,
    durationMs: 0,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (meme) {
      setFormData({
        title: meme.title,
        priceCoins: meme.priceCoins,
        durationMs: meme.durationMs,
      });
    }
  }, [meme]);

  if (!isOpen || !meme) return null;

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
  const source = meme.fileUrl.startsWith('http://') || meme.fileUrl.startsWith('https://') 
    ? 'imported' 
    : 'uploaded';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.patch(`/admin/memes/${meme.id}`, formData);
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
    if (meme) {
      setFormData({
        title: meme.title,
        priceCoins: meme.priceCoins,
        durationMs: meme.durationMs,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-2xl font-bold">
              {isEditing ? 'Edit Meme' : meme.title}
            </h2>
            <div className="flex gap-2">
              {isOwner && !isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded"
                >
                  Edit
                </button>
              )}
              <button
                onClick={onClose}
                className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded"
              >
                Close
              </button>
            </div>
          </div>

          {isEditing ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Price (coins)
                  </label>
                  <input
                    type="number"
                    value={formData.priceCoins}
                    onChange={(e) => setFormData({ ...formData, priceCoins: parseInt(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Duration (ms)
                  </label>
                  <input
                    type="number"
                    value={formData.durationMs}
                    onChange={(e) => setFormData({ ...formData, durationMs: parseInt(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    min="1"
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white px-4 py-2 rounded"
                >
                  {loading ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="mb-4">
                <video
                  src={videoUrl}
                  controls
                  className="w-full rounded-lg"
                  preload="metadata"
                />
              </div>
              <div className="space-y-2">
                <div>
                  <span className="font-semibold">Price:</span> {meme.priceCoins} coins
                </div>
                <div>
                  <span className="font-semibold">Duration:</span> {meme.durationMs}ms
                </div>
                <div>
                  <span className="font-semibold">Created by:</span> {creatorName}
                </div>
                <div>
                  <span className="font-semibold">Source:</span> <span className="capitalize">{source}</span>
                </div>
                {meme.status && (
                  <div>
                    <span className="font-semibold">Status:</span> {meme.status}
                  </div>
                )}
                {meme.createdAt && (
                  <div>
                    <span className="font-semibold">Created:</span>{' '}
                    {new Date(meme.createdAt).toLocaleString()}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

