import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import TagInput from '@/components/TagInput';
import { Button, Input, Modal } from '@/shared/ui';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchMemes } from '@/store/slices/memesSlice';
import { fetchSubmissions } from '@/store/slices/submissionsSlice';

export interface SubmitModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelSlug?: string;
  channelId?: string;
}

export default function SubmitModal({ isOpen, onClose, channelSlug, channelId }: SubmitModalProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [loading, setLoading] = useState<boolean>(false);
  const [mode, setMode] = useState<'upload' | 'import'>('upload');
  const [formData, setFormData] = useState<{
    title: string;
    sourceUrl?: string;
    tags?: string[];
  }>({
    title: '',
    sourceUrl: '',
    tags: [],
  });
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        title: '',
        sourceUrl: '',
        tags: [],
      });
      setFile(null);
      setFilePreview(null);
      setUploadProgress(0);
      setMode('upload');
    }
  }, [isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);

    if (selectedFile) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    } else {
      setFilePreview(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();

    if (!user) {
      toast.error(t('submitModal.pleaseLogIn'));
      return;
    }

    if (mode === 'upload') {
      if (!file) {
        toast.error(t('submitModal.pleaseSelectFile'));
        return;
      }

      // Validate file size (50MB max)
      const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
      if (file.size > MAX_FILE_SIZE) {
        toast.error(t('submitModal.fileSizeExceeds', { size: (file.size / 1024 / 1024).toFixed(2) }));
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
          toast.error(t('submitModal.videoDurationExceeds', { duration: duration.toFixed(2) }));
          return;
        }
      } catch {
        // If we can't read metadata (codec/browser quirk), continue without duration hint.
        durationMsToSend = null;
      }

      setLoading(true);
      setUploadProgress(0);
      try {
        const formDataToSend = new FormData();
        formDataToSend.append('file', file);
        formDataToSend.append('title', formData.title);
        formDataToSend.append('type', 'video'); // Only video allowed
        // Add tags as JSON string (backend will parse it)
        if (formData.tags && formData.tags.length > 0) {
          formDataToSend.append('tags', JSON.stringify(formData.tags));
        }
        // Provide durationMs as a fallback for servers where ffprobe is unavailable
        if (durationMsToSend !== null) {
          formDataToSend.append('durationMs', String(durationMsToSend));
        }
        // Add channelId if provided (for submitting to another channel)
        if (channelId) {
          formDataToSend.append('channelId', channelId);
        }

        // Use axios directly for upload progress tracking
        const { api } = await import('@/lib/api');
        const respData = await api.post<Record<string, unknown>>('/submissions', formDataToSend, {
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

        const d = respData as Record<string, unknown> | null;
        const respStatus = typeof d?.status === 'string' ? d.status : null;

        toast.success(t('submit.submitted'));
        onClose();

        // Refresh relevant lists without forcing navigation.
        if (respStatus === 'pending') {
          dispatch(fetchSubmissions({ status: 'pending' }));
        } else if (respStatus === 'approved') {
          const targetChannelId = channelId || user?.channelId || null;
          if (targetChannelId) {
            dispatch(fetchMemes({ channelId: targetChannelId }));
          }
        }
      } catch (error: unknown) {
        const apiError = error as {
          response?: { status?: number; data?: { error?: string } };
          code?: string;
          message?: string;
        };
        // Handle 524 Cloudflare timeout specifically
        if (apiError.code === 'ECONNABORTED' || apiError.response?.status === 524 || apiError.message?.includes('timeout')) {
          toast.error(t('submitModal.uploadTimeout'));
          // Still close modal - submission might have been created
          setTimeout(() => {
            onClose();
          }, 2000);
        } else {
          toast.error(apiError.response?.data?.error || apiError.message || t('submitModal.failedToSubmit'));
        }
      } finally {
        setLoading(false);
        setUploadProgress(0);
      }
    } else {
      // Import mode
      if (!formData.sourceUrl) {
        toast.error(t('submitModal.pleaseEnterUrl'));
        return;
      }

      const isValidUrl =
        formData.sourceUrl.includes('memalerts.com') || formData.sourceUrl.includes('cdns.memealerts.com');
      if (!isValidUrl) {
        toast.error(t('submitModal.urlMustBeFromMemalerts'));
        return;
      }

      setLoading(true);
      try {
        const { api } = await import('@/lib/api');
        await api.post('/submissions/import', {
          title: formData.title,
          sourceUrl: formData.sourceUrl,
          tags: formData.tags || [],
          ...(channelId && { channelId }), // Add channelId if provided
        });
        toast.success(t('submit.importSubmitted'));
        onClose();
        if (channelSlug) {
          navigate(`/channel/${channelSlug}`);
        } else {
          // For viewers, the submissions list is on /submit; avoid sending them to /dashboard.
          navigate('/submit');
        }
      } catch (error: unknown) {
        const apiError = error as { response?: { data?: { error?: string } } };
        toast.error(apiError.response?.data?.error || t('submitModal.failedToImport'));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEsc={false}
      overlayClassName="overflow-y-auto"
      contentClassName="relative rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto"
      ariaLabel={t('submitModal.title')}
    >
      {/* Header */}
      <div className="sticky top-0 bg-white/40 dark:bg-black/20 backdrop-blur border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-4 flex justify-between items-center">
        <h2 className="text-xl sm:text-2xl font-bold dark:text-white">{t('submitModal.title')}</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label={t('submitModal.closeModal')}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6">
        {/* Mode selector */}
        <div className="mb-6 glass p-3 sm:p-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                mode === 'upload'
                  ? 'bg-primary text-white'
                  : 'bg-white/40 dark:bg-white/5 text-gray-700 dark:text-gray-200 hover:bg-white/60 dark:hover:bg-white/10'
              }`}
            >
              {t('submit.uploadVideo')}
            </button>
            <button
              type="button"
              onClick={() => setMode('import')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                mode === 'import'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-secondary/10 dark:hover:bg-secondary/10'
              }`}
            >
              {t('submit.import')}
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('submit.titleLabel')}
            </label>
            <Input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
            />
          </div>

          {mode === 'upload' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('submit.videoFile')}
              </label>
              <input
                type="file"
                onChange={handleFileChange}
                required
                accept="video/*"
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-white/60 dark:bg-white/10 text-gray-900 dark:text-white shadow-sm outline-none ring-1 ring-black/5 dark:ring-white/10 focus:ring-2 focus:ring-primary/40"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('submit.onlyVideos')}</p>
              {filePreview && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('submitModal.preview', 'Preview')}
                  </label>
                  <div className="rounded-xl p-4 bg-white/50 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10">
                    <video src={filePreview} controls className="max-w-full max-h-64 mx-auto rounded" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('submit.memalertsUrl')}
              </label>
              <Input
                type="url"
                value={formData.sourceUrl || ''}
                onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
                required
                placeholder={t('submit.memalertsUrlPlaceholder', { defaultValue: 'https://cdns.memealerts.com/.../alert_orig.webm' })}
              />
              <div className="mt-2 p-3 bg-accent/10 rounded-xl ring-1 ring-accent/20">
                <p className="text-sm text-gray-700 dark:text-gray-300 font-medium mb-1">{t('submit.howToCopy')}</p>
                <ol className="text-sm text-gray-600 dark:text-gray-400 list-decimal list-inside space-y-1">
                  {(t('submit.copyInstructions', { returnObjects: true }) as string[]).map(
                    (instruction: string, index: number) => (
                      <li key={index}>{instruction}</li>
                    ),
                  )}
                </ol>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {t('submit.memalertsUrlExample', { defaultValue: 'Example: https://cdns.memealerts.com/p/.../alert_orig.webm' })}
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('submit.tags')}</label>
            <TagInput
              tags={formData.tags || []}
              onChange={(tags) => setFormData({ ...formData, tags })}
              placeholder={t('submit.addTags')}
            />
          </div>

          {loading && uploadProgress > 0 && (
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-2">
              <div
                className="bg-primary h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}

          <div className="glass p-3 sm:p-4">
            <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
              <strong>{t('submitModal.whatHappensNext', { defaultValue: 'What happens next?' })}</strong>{' '}
              {t('submitModal.approvalProcess', {
                defaultValue:
                  'Your submission will be reviewed by moderators. Once approved, it will appear in the meme list.',
              })}
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={loading}>
              {loading
                ? uploadProgress > 0
                  ? `${t('submit.submitting')} ${uploadProgress}%`
                  : t('submit.submitting')
                : t('common.submit')}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}


