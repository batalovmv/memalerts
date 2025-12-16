import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { createSubmission } from '../store/slices/submissionsSlice';
import UserMenu from '../components/UserMenu';
import TagInput from '../components/TagInput';
import toast from 'react-hot-toast';

export default function Submit() {
  const { user } = useAppSelector((state) => state.auth);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState<boolean>(false);
  const [mode, setMode] = useState<'upload' | 'import'>('upload');
  const [formData, setFormData] = useState<{
    title: string;
    notes: string;
    sourceUrl?: string;
    tags?: string[];
  }>({
    title: '',
    notes: '',
    sourceUrl: '',
    tags: [],
  });
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    
    if (mode === 'upload') {
      if (!file) {
        toast.error('Please select a file');
        return;
      }

      // Validate file size (50MB max)
      const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`File size exceeds 50MB. Current size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
        return;
      }

      // Validate video duration (15 seconds max)
      // We'll validate this on backend, but show a warning here
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      const durationCheck = new Promise<number>((resolve, reject) => {
        video.onloadedmetadata = () => {
          window.URL.revokeObjectURL(video.src);
          resolve(video.duration);
        };
        video.onerror = () => {
          window.URL.revokeObjectURL(video.src);
          reject(new Error('Failed to load video metadata'));
        };
        video.src = URL.createObjectURL(file);
      });

      try {
        const duration = await durationCheck;
        if (duration > 15) {
          toast.error(`Video duration exceeds 15 seconds. Current duration: ${duration.toFixed(2)}s`);
          return;
        }
      } catch (error) {
        console.warn('Could not check video duration on frontend, will validate on backend');
      }

      setLoading(true);
      try {
        const formDataToSend = new FormData();
        formDataToSend.append('file', file);
        formDataToSend.append('title', formData.title);
        formDataToSend.append('type', 'video'); // Only video allowed
        if (formData.notes) {
          formDataToSend.append('notes', formData.notes);
        }
        // Add tags as JSON string (backend will parse it)
        if (formData.tags && formData.tags.length > 0) {
          formDataToSend.append('tags', JSON.stringify(formData.tags));
        }

        await dispatch(createSubmission(formDataToSend)).unwrap();
        toast.success('Submission created! Waiting for approval.');
        navigate('/dashboard');
      } catch (error: any) {
        toast.error(error.message || 'Failed to submit meme');
      } finally {
        setLoading(false);
      }
    } else {
      // Import mode
      if (!formData.sourceUrl) {
        toast.error('Please enter a memalerts.com URL');
        return;
      }

      const isValidUrl = formData.sourceUrl.includes('memalerts.com') || 
                        formData.sourceUrl.includes('cdns.memealerts.com');
      if (!isValidUrl) {
        toast.error('URL must be from memalerts.com or cdns.memealerts.com');
        return;
      }

      setLoading(true);
      try {
        const { api } = await import('../lib/api');
        await api.post('/submissions/import', {
          title: formData.title,
          sourceUrl: formData.sourceUrl,
          notes: formData.notes || null,
          tags: formData.tags || [],
        });
        toast.success('Meme import submitted! Waiting for approval.');
        navigate('/dashboard');
      } catch (error: any) {
        toast.error(error.response?.data?.error || 'Failed to import meme');
      } finally {
        setLoading(false);
      }
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold">Mem Alerts</h1>
            <UserMenu />
          </div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h2 className="text-2xl font-bold mb-6">Submit a Meme</h2>
        
        {/* Mode selector */}
        <div className="mb-6 bg-white rounded-lg shadow p-4">
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                mode === 'upload'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Upload Video
            </button>
            <button
              type="button"
              onClick={() => setMode('import')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                mode === 'import'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Import from memalerts.com
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>

          {mode === 'upload' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Video File
              </label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required
                accept="video/*"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              <p className="text-sm text-gray-500 mt-1">Only video files are allowed</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                memalerts.com URL
              </label>
              <input
                type="url"
                value={formData.sourceUrl || ''}
                onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
                required
                placeholder="https://cdns.memealerts.com/.../alert_orig.webm"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
              <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-gray-700 font-medium mb-1">How to copy video URL:</p>
                <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1">
                  <li>Go to memalerts.com and find the video</li>
                  <li>Right-click on the video</li>
                  <li>Select "Copy video address" or "Copy video URL"</li>
                  <li>Paste the URL here</li>
                </ol>
                <p className="text-xs text-gray-500 mt-2">
                  Example: https://cdns.memealerts.com/p/.../alert_orig.webm
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags (optional)
            </label>
            <TagInput
              tags={formData.tags || []}
              onChange={(tags) => setFormData({ ...formData, tags })}
              placeholder="Add tags to help categorize your meme..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            {loading ? 'Submitting...' : 'Submit'}
          </button>
        </form>
      </main>
    </div>
  );
}
