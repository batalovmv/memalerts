import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../store/hooks';
import UserMenu from '../components/UserMenu';
import TagInput from '../components/TagInput';
import toast from 'react-hot-toast';
import { api } from '../lib/api';

type MySubmission = {
  id: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  createdAt: string;
  moderatorNotes?: string | null;
};

export default function Submit() {
  const { user } = useAppSelector((state) => state.auth);
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
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [mySubmissions, setMySubmissions] = useState<MySubmission[]>([]);
  const [loadingMySubmissions, setLoadingMySubmissions] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/');
    }
  }, [user, navigate]);

  const loadMySubmissions = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingMySubmissions(true);
      const data = await api.get<MySubmission[]>('/submissions', { timeout: 10000 });
      setMySubmissions(Array.isArray(data) ? data : []);
    } catch (err) {
    } finally {
      setLoadingMySubmissions(false);
    }
  }, [user]);

  useEffect(() => {
    void loadMySubmissions();
  }, [loadMySubmissions]);

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

      let durationMsToSend: number | null = null;
      try {
        const duration = await durationCheck;
        durationMsToSend = Number.isFinite(duration) ? Math.round(duration * 1000) : null;
        if (duration > 15) {
          toast.error(`Video duration exceeds 15 seconds. Current duration: ${duration.toFixed(2)}s`);
          return;
        }
      } catch (error) {
      }

      setLoading(true);
      setUploadProgress(0);
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
        // Provide durationMs as a fallback for servers where ffprobe is unavailable
        if (durationMsToSend !== null) {
          formDataToSend.append('durationMs', String(durationMsToSend));
        }

        // Use axios directly for upload progress tracking
        const { api } = await import('../lib/api');
        await api.post('/submissions', formDataToSend, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setUploadProgress(percentCompleted);
            }
          },
        });
        
        toast.success('Submission created! Waiting for approval.');
        navigate('/dashboard');
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number; data?: { error?: string } }; code?: string; message?: string };
        // Handle 524 Cloudflare timeout specifically
        if (apiError.code === 'ECONNABORTED' || apiError.response?.status === 524 || apiError.message?.includes('timeout')) {
          toast.error('Upload timeout. The file may have been uploaded successfully. Please check your submissions.');
          // Still navigate to dashboard - submission might have been created
          setTimeout(() => navigate('/dashboard'), 2000);
        } else {
          toast.error(apiError.response?.data?.error || apiError.message || 'Failed to submit meme');
        }
      } finally {
        setLoading(false);
        setUploadProgress(0);
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
      } catch (error: unknown) {
        const apiError = error as { response?: { data?: { error?: string } } };
        toast.error(apiError.response?.data?.error || 'Failed to import meme');
      } finally {
        setLoading(false);
      }
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold dark:text-white">Mem Alerts</h1>
            <UserMenu />
          </div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h2 className="text-2xl font-bold mb-6 dark:text-white">Submit a Meme</h2>
        
        {/* Mode selector */}
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-secondary/20">
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                mode === 'upload'
                  ? 'bg-primary text-white border border-secondary/30'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-secondary/10 dark:hover:bg-secondary/10 border border-secondary/20'
              }`}
            >
              Upload Video
            </button>
            <button
              type="button"
              onClick={() => setMode('import')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                mode === 'import'
                  ? 'bg-primary text-white border border-secondary/30'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-secondary/10 dark:hover:bg-secondary/10 border border-secondary/20'
              }`}
            >
              Import from memalerts.com
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4 border border-secondary/20">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
              className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
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
                className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
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
                className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
              />
              <div className="mt-2 p-3 bg-accent/10 rounded-lg border border-accent/20">
                <p className="text-sm text-gray-700 font-medium mb-1">How to copy video URL:</p>
                <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1">
                  <li>Go to memalerts.com and find the video</li>
                  <li>Right-click on the video</li>
                  <li>Select &quot;Copy video address&quot; or &quot;Copy video URL&quot;</li>
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
              className="w-full border border-secondary/30 dark:border-secondary/30 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>

          {loading && uploadProgress > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
              <div
                className="bg-primary h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-secondary disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors border border-secondary/30"
          >
            {loading ? (uploadProgress > 0 ? `Uploading... ${uploadProgress}%` : 'Submitting...') : 'Submit'}
          </button>
        </form>

        {/* My submissions (so submitter can see rejection reason / status) */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-secondary/20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold dark:text-white">My submissions</h3>
            <button
              type="button"
              onClick={loadMySubmissions}
              disabled={loadingMySubmissions}
              className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-800 dark:text-gray-200 font-semibold py-2 px-3 rounded-lg transition-colors"
            >
              {loadingMySubmissions ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {mySubmissions.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">No submissions yet.</div>
          ) : (
            <div className="space-y-3">
              {mySubmissions.slice(0, 20).map((s) => {
                const statusColor =
                  s.status === 'approved'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : s.status === 'rejected'
                      ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';

                return (
                  <div key={s.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-white">{s.title}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {new Date(s.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColor}`}>{s.status}</span>
                    </div>

                    {s.status === 'rejected' && (
                      <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                        <div className="font-semibold mb-1">Rejection reason</div>
                        <div className="text-gray-600 dark:text-gray-400">
                          {s.moderatorNotes?.trim() ? s.moderatorNotes : 'No reason provided.'}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
