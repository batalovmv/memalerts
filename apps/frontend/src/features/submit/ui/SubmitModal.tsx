import { useEffect, useRef, useState } from 'react';
import axios, { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { getMaxFileSizeMb, getVideoDuration, validateFile } from '@/features/submit/lib/validation';

import TagInput from '@/components/TagInput';
import { Button, HelpTooltip, Input, Modal } from '@/shared/ui';
import { createIdempotencyKey } from '@/shared/lib/idempotency';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchMemes } from '@/store/slices/memesSlice';
import { fetchSubmissions } from '@/store/slices/submissionsSlice';

export interface SubmitModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelSlug?: string;
  channelId?: string;
  initialBlockedReason?: null | 'disabled' | 'offline';
}

type UploadStatus = 'idle' | 'selecting' | 'uploading' | 'success' | 'error';

export default function SubmitModal({ isOpen, onClose, channelSlug, channelId, initialBlockedReason = null }: SubmitModalProps) {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const [blockedReason, setBlockedReason] = useState<null | 'disabled' | 'offline'>(null);
  const [mode, setMode] = useState<'upload' | 'import'>('upload');
  const [formData, setFormData] = useState<{
    title: string;
    sourceUrl: string;
    tags: string[];
  }>({
    title: '',
    sourceUrl: '',
    tags: [],
  });
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number>(0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [canSubmit, setCanSubmit] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryIntervalRef = useRef<number | null>(null);
  const validationTokenRef = useRef(0);

  const isUploading = uploadStatus === 'uploading';
  const isSubmitLocked = importLoading || isUploading;

  const isOwnerBypassTarget =
    !!user &&
    (user.role === 'streamer' || user.role === 'admin') &&
    !!user.channelId &&
    (!channelId || String(channelId) === String(user.channelId));

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
      setUploadStatus('idle');
      setErrorMessage(null);
      setRetryAfterSeconds(0);
      setValidationErrors([]);
      setCanSubmit(false);
      setIsValidating(false);
      setMode('upload');
      setBlockedReason(null);
      abortControllerRef.current?.abort();
      if (retryIntervalRef.current) {
        window.clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
    }
  }, [isOpen]);

  // Allow parent to block the modal without making a submission request first
  // (e.g. when channel says submissionsEnabled=false).
  useEffect(() => {
    if (!isOpen) return;
    if (!initialBlockedReason) return;
    setBlockedReason(initialBlockedReason);
  }, [initialBlockedReason, isOpen]);

  const getBlockedCopy = (r: 'disabled' | 'offline') => {
    if (r === 'disabled') return t('submitModal.submissionsDisabled', { defaultValue: 'Отправка мемов запрещена стримером' });
    return t('submitModal.submissionsOffline', { defaultValue: 'Отправка доступна только во время стрима' });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);
    setUploadProgress(0);
    setErrorMessage(null);
    setRetryAfterSeconds(0);
    setUploadStatus(selectedFile ? 'selecting' : 'idle');
    setValidationErrors([]);
    setCanSubmit(false);
    setIsValidating(false);
    validationTokenRef.current += 1;
    const token = validationTokenRef.current;

    if (selectedFile) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
      setIsValidating(true);
      void validateFile(selectedFile, t)
        .then((result) => {
          if (validationTokenRef.current !== token) return;
          setValidationErrors(result.errors);
          setCanSubmit(result.valid);
        })
        .catch(() => {
          if (validationTokenRef.current !== token) return;
          setValidationErrors([t('submit.errors.cannotReadDuration', { defaultValue: 'Cannot read video duration.' })]);
          setCanSubmit(false);
        })
        .finally(() => {
          if (validationTokenRef.current !== token) return;
          setIsValidating(false);
        });
    } else {
      setFilePreview(null);
    }
  };

  const clearRetryTimer = () => {
    if (retryIntervalRef.current) {
      window.clearInterval(retryIntervalRef.current);
      retryIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      clearRetryTimer();
    };
  }, []);

  const startRetryCountdown = (seconds: number) => {
    clearRetryTimer();
    const initial = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    setRetryAfterSeconds(initial);
    setErrorMessage(t('submit.errors.rateLimited', { seconds: initial }));
    if (initial <= 0) return;
    retryIntervalRef.current = window.setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev <= 1) {
          clearRetryTimer();
          setErrorMessage(t('submit.errors.rateLimited', { seconds: 0 }));
          return 0;
        }
        const next = prev - 1;
        setErrorMessage(t('submit.errors.rateLimited', { seconds: next }));
        return next;
      });
    }, 1000);
  };

  const getErrorMessage = (error: AxiosError, errorCode: unknown) => {
    if (!error.response) {
      return t('submit.errors.networkError', { defaultValue: 'Network error. Check your connection.' });
    }
    if (typeof errorCode === 'string') {
      if (errorCode === 'FILE_TOO_LARGE') {
        return t('submit.errors.fileTooLarge', {
          defaultValue: 'File is too large. Maximum {{maxMb}} MB.',
          maxMb: getMaxFileSizeMb(),
        });
      }
      if (errorCode === 'VIDEO_TOO_LONG') {
        return t('submit.errors.videoTooLong', { defaultValue: 'Video is too long. Maximum 5 minutes.' });
      }
    }
    const rawMessage =
      error.response?.data && typeof error.response.data === 'object'
        ? ((error.response.data as Record<string, unknown>).error as string | undefined)
        : undefined;
    if (rawMessage) return rawMessage;
    return t('submit.errors.unknown', { defaultValue: 'Something went wrong. Please try again.' });
  };

  const handleUploadError = (error: AxiosError) => {
    const response = error.response;
    const errorCode =
      response?.data && typeof response.data === 'object'
        ? ((response.data as Record<string, unknown>).errorCode as unknown)
        : null;

    if (response?.status === 429) {
      const retryAfterRaw = response.headers?.['retry-after'];
      const retryAfter = Math.max(0, Number.parseInt(String(retryAfterRaw ?? '60'), 10) || 60);
      startRetryCountdown(retryAfter);
      return;
    }

    clearRetryTimer();
    setRetryAfterSeconds(0);
    setErrorMessage(getErrorMessage(error, errorCode));
  };

  const handleCancelUpload = () => {
    abortControllerRef.current?.abort();
    setUploadProgress(0);
    setUploadStatus('idle');
  };

  const handleRetry = () => {
    clearRetryTimer();
    setRetryAfterSeconds(0);
    setErrorMessage(null);
    setUploadProgress(0);
    setUploadStatus('idle');
  };

  const handleSubmitAnother = () => {
    clearRetryTimer();
    setRetryAfterSeconds(0);
    setErrorMessage(null);
    setUploadProgress(0);
    setUploadStatus('idle');
    setFormData((prev) => ({ ...prev, title: '', tags: [] }));
    setFile(null);
    setFilePreview(null);
    setValidationErrors([]);
    setCanSubmit(false);
    setIsValidating(false);
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
      if (isValidating || !canSubmit) {
        return;
      }

      let durationMsToSend: number | null = null;
      try {
        const durationSeconds = await getVideoDuration(file);
        durationMsToSend = Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null;
      } catch {
        // If we can't read metadata (codec/browser quirk), continue without duration hint.
        durationMsToSend = null;
      }

      setUploadStatus('uploading');
      setUploadProgress(0);
      setErrorMessage(null);
      setRetryAfterSeconds(0);
      clearRetryTimer();
      abortControllerRef.current = new AbortController();
      try {
        const formDataToSend = new FormData();
        formDataToSend.append('file', file);
        const titleToSend = formData.title.trim();
        if (titleToSend) {
          formDataToSend.append('title', titleToSend);
        }
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
        const idempotencyKey = createIdempotencyKey();
        const respData = await api.post<Record<string, unknown>>('/submissions', formDataToSend, {
          headers: {
            'Content-Type': 'multipart/form-data',
            'Idempotency-Key': idempotencyKey,
          },
          onUploadProgress: (progressEvent) => {
            const total = progressEvent.total ?? 0;
            const percentCompleted = Math.round((progressEvent.loaded * 100) / (total || progressEvent.loaded || 1));
            setUploadProgress(percentCompleted);
          },
          signal: abortControllerRef.current.signal,
        });

        const d = respData as Record<string, unknown> | null;
        const respStatus = typeof d?.status === 'string' ? d.status : null;
        const isDirectApproval = d?.isDirectApproval === true;
        const isRestored = d?.isRestored === true;

        toast.success(
          isRestored
            ? t('submit.restored', { defaultValue: 'Meme was restored in your channel.' })
            : isDirectApproval
              ? t('submit.directApproved', { defaultValue: 'Meme was added to your channel.' })
              : t('submit.submitted'),
        );
        setUploadProgress(100);
        setUploadStatus('success');

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
        const apiError = error as AxiosError;
        if (axios.isCancel(apiError) || apiError.code === 'ERR_CANCELED') {
          setUploadStatus('idle');
          setUploadProgress(0);
          return;
        }

        const maybeErrorCode =
          apiError.response?.data && typeof apiError.response.data === 'object'
            ? ((apiError.response.data as Record<string, unknown>).errorCode ?? null)
            : null;
        if (apiError.response?.status === 403 && maybeErrorCode === 'SUBMISSIONS_DISABLED') {
          setBlockedReason('disabled');
          setUploadStatus('idle');
          return;
        }
        if (apiError.response?.status === 403 && maybeErrorCode === 'SUBMISSIONS_OFFLINE') {
          setBlockedReason('offline');
          setUploadStatus('idle');
          return;
        }
        if (apiError.response?.status === 409 && maybeErrorCode === 'ALREADY_IN_CHANNEL') {
          setErrorMessage(t('submitModal.alreadyInChannel', { defaultValue: 'This meme is already in your channel.' }));
          setUploadStatus('error');
          return;
        }
        if (apiError.response?.status === 410) {
          setErrorMessage(t('submitModal.uploadBlockedDeleted', { defaultValue: 'This file is deleted/quarantined and cannot be uploaded again.' }));
          setUploadStatus('error');
          return;
        }
        handleUploadError(apiError);
        setUploadStatus('error');
      } finally {
        abortControllerRef.current = null;
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

      setImportLoading(true);
      try {
        const { api } = await import('@/lib/api');
        const payload: Record<string, unknown> = {
          sourceUrl: formData.sourceUrl,
          ...(channelId && { channelId }), // Add channelId if provided
        };
        const titleToSend = formData.title.trim();
        if (titleToSend) payload.title = titleToSend;
        if (Array.isArray(formData.tags) && formData.tags.length > 0) payload.tags = formData.tags;

        const respData = await api.post<Record<string, unknown>>('/submissions/import', payload);
        const d = respData as Record<string, unknown> | null;
        const respStatus = typeof d?.status === 'string' ? d.status : null;
        const isDirectApproval = d?.isDirectApproval === true;
        const isRestored = d?.isRestored === true;

        toast.success(
          isRestored
            ? t('submit.restored', { defaultValue: 'Meme was restored in your channel.' })
            : isDirectApproval
              ? t('submit.directApproved', { defaultValue: 'Meme was added to your channel.' })
              : t('submit.importSubmitted'),
        );
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

        if (channelSlug) {
          navigate(`/channel/${channelSlug}`);
        } else if (!isOwnerBypassTarget || (!isDirectApproval && respStatus !== 'approved')) {
          // For viewers (and non-direct submissions), the submissions list is on /submit.
          navigate('/submit');
        }
      } catch (error: unknown) {
        const apiError = error as { response?: { status?: number; data?: { error?: string; errorCode?: unknown } } };
        if (apiError.response?.status === 403 && apiError.response?.data?.errorCode === 'SUBMISSIONS_DISABLED') {
          setBlockedReason('disabled');
          return;
        }
        if (apiError.response?.status === 403 && apiError.response?.data?.errorCode === 'SUBMISSIONS_OFFLINE') {
          setBlockedReason('offline');
          return;
        }
        if (apiError.response?.status === 409 && apiError.response?.data?.errorCode === 'ALREADY_IN_CHANNEL') {
          toast.error(t('submitModal.alreadyInChannel', { defaultValue: 'This meme is already in your channel.' }));
          return;
        }
        if (apiError.response?.status === 410) {
          toast.error(t('submitModal.uploadBlockedDeleted', { defaultValue: 'This file is deleted/quarantined and cannot be uploaded again.' }));
          return;
        }
        toast.error(apiError.response?.data?.error || t('submitModal.failedToImport'));
      } finally {
        setImportLoading(false);
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
      <div className="sticky top-0 border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-4 flex justify-between items-center">
        <h2 className="text-xl sm:text-2xl font-bold dark:text-white">{t('submitModal.title')}</h2>
        <HelpTooltip content={t('help.submitModal.close', { defaultValue: 'Close without sending.' })}>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label={t('submitModal.closeModal')}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </HelpTooltip>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6">
        {blockedReason ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-danger/10 ring-1 ring-danger/20 p-4">
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {t('submitModal.unavailableTitle', { defaultValue: 'Отправка недоступна' })}
              </div>
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">{getBlockedCopy(blockedReason)}</div>
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t('common.close', { defaultValue: 'Close' })}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Mode selector */}
            <div className="mb-6 glass p-3 sm:p-4">
              <div className="flex gap-3" role="tablist" aria-label={t('submitModal.mode', { defaultValue: 'Submit mode' })}>
                <HelpTooltip content={t('help.submitModal.modeUpload', { defaultValue: 'Upload a video file from your device.' })}>
                  <button
                    type="button"
                    onClick={() => setMode('upload')}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                      mode === 'upload'
                        ? 'bg-primary text-white'
                        : 'bg-white/40 dark:bg-white/5 text-gray-700 dark:text-gray-200 hover:bg-white/60 dark:hover:bg-white/10'
                    }`}
                    role="tab"
                    id="submit-modal-tab-upload"
                    aria-controls="submit-modal-panel-upload"
                    aria-selected={mode === 'upload'}
                    tabIndex={mode === 'upload' ? 0 : -1}
                  >
                    {t('submit.uploadVideo')}
                  </button>
                </HelpTooltip>
                <HelpTooltip content={t('help.submitModal.modeImport', { defaultValue: 'Import by pasting a direct Memealerts media link.' })}>
                  <button
                    type="button"
                    onClick={() => setMode('import')}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                      mode === 'import'
                        ? 'bg-primary text-white'
                        : 'bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-secondary/10 dark:hover:bg-secondary/10'
                    }`}
                    role="tab"
                    id="submit-modal-tab-import"
                    aria-controls="submit-modal-panel-import"
                    aria-selected={mode === 'import'}
                    tabIndex={mode === 'import' ? 0 : -1}
                  >
                    {t('submit.import')}
                  </button>
                </HelpTooltip>
              </div>
              <div className="mt-3 flex justify-end">
                <HelpTooltip content={t('help.submitModal.openPool', { defaultValue: 'Open the Pool to choose a ready meme instead of uploading.' })}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="glass-btn bg-white/40 dark:bg-white/5"
                    onClick={() => {
                      onClose();
                      const qs = new URLSearchParams();
                      if (channelId) qs.set('channelId', channelId);
                      if (channelSlug) qs.set('channelSlug', channelSlug);
                      navigate(`/pool${qs.toString() ? `?${qs.toString()}` : ''}`);
                    }}
                  >
                    {t('submitModal.openPool', { defaultValue: 'Open pool' })}
                  </Button>
                </HelpTooltip>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'upload' ? (
                <div role="tabpanel" id="submit-modal-panel-upload" aria-labelledby="submit-modal-tab-upload">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('submit.videoFile')}
                  </label>
                  <HelpTooltip content={t('help.submitModal.file', { defaultValue: 'Choose a video file to upload. Supported: common video formats.' })}>
                    <Input
                      key="submit-upload-file"
                      type="file"
                      onChange={handleFileChange}
                      required
                      accept="video/*"
                      disabled={isUploading}
                    />
                  </HelpTooltip>
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
                  {validationErrors.length > 0 && (
                    <div className="mt-3 text-sm text-red-600 dark:text-red-400 space-y-1">
                      {validationErrors.map((err, index) => (
                        <p key={`${err}-${index}`}>! {err}</p>
                      ))}
                    </div>
                  )}
                  {uploadStatus === 'uploading' && (
                    <div className="mt-4 space-y-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {t('submit.uploading', { defaultValue: 'Uploading...' })} {uploadProgress}%
                      </span>
                    </div>
                  )}
                  {uploadStatus === 'success' && (
                    <div className="mt-4 rounded-xl bg-primary/10 ring-1 ring-primary/20 p-3 text-sm text-gray-900 dark:text-white">
                      {t('submit.success', { defaultValue: 'Meme submitted for moderation' })}
                    </div>
                  )}
                  {uploadStatus === 'error' && errorMessage && (
                    <div className="mt-4 text-sm text-red-600 dark:text-red-400">{errorMessage}</div>
                  )}
                </div>
              ) : (
                <div role="tabpanel" id="submit-modal-panel-import" aria-labelledby="submit-modal-tab-import">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('submit.memalertsUrl')}
                  </label>
                  <HelpTooltip content={t('help.submitModal.url', { defaultValue: 'Paste a direct link to the media file from Memealerts (cdns.memealerts.com).' })}>
                    <Input
                      key="submit-import-url"
                      type="url"
                      value={formData.sourceUrl || ''}
                      onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
                      required
                      placeholder={t('submit.memalertsUrlPlaceholder', { defaultValue: 'https://cdns.memealerts.com/.../alert_orig.webm' })}
                      disabled={importLoading}
                    />
                  </HelpTooltip>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('submit.titleLabel')}
                </label>
                <HelpTooltip content={t('help.submitModal.title', { defaultValue: 'Name of the meme in the channel. Viewers will see this title.' })}>
                  <Input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    disabled={isSubmitLocked}
                  />
                </HelpTooltip>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('submit.tags')}</label>
                <HelpTooltip content={t('help.submitModal.tags', { defaultValue: 'Add a few tags to help search and moderation (optional).' })}>
                  <div>
                    <TagInput
                      tags={formData.tags}
                      onChange={(tags) => setFormData({ ...formData, tags })}
                      placeholder={t('submit.addTags')}
                    />
                  </div>
                </HelpTooltip>
              </div>

              <div className="glass p-3 sm:p-4">
                <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                  <strong>{t('submitModal.whatHappensNext', { defaultValue: 'What happens next?' })}</strong>{' '}
                  {isOwnerBypassTarget
                    ? t('submitModal.directApprovalProcess', {
                        defaultValue: 'Since you are submitting to your own channel, the meme will be added immediately.',
                      })
                    : t('submitModal.approvalProcess', {
                        defaultValue:
                          'Your submission will be reviewed by moderators. Once approved, it will appear in the meme list.',
                      })}
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={isSubmitLocked}>
                  {t('common.cancel')}
                </Button>
                {mode === 'upload' ? (
                  uploadStatus === 'uploading' ? (
                    <Button type="button" variant="secondary" className="flex-1" onClick={handleCancelUpload}>
                      {t('submit.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                  ) : uploadStatus === 'success' ? (
                    <Button type="button" variant="primary" className="flex-1" onClick={handleSubmitAnother}>
                      {t('submit.submitAnother', { defaultValue: 'Submit another' })}
                    </Button>
                  ) : uploadStatus === 'error' ? (
                    <Button type="button" variant="primary" className="flex-1" onClick={handleRetry} disabled={retryAfterSeconds > 0}>
                      {retryAfterSeconds > 0
                        ? t('submit.retryIn', { defaultValue: 'Try again in {{seconds}}s', seconds: retryAfterSeconds })
                        : t('submit.retry', { defaultValue: 'Try again' })}
                    </Button>
                  ) : (
                    <HelpTooltip content={t('help.submitModal.submit', { defaultValue: 'Send the meme for review. If this is your own channel, it will be added instantly.' })}>
                      <Button type="submit" variant="primary" className="flex-1" disabled={!file || !canSubmit || isValidating || isSubmitLocked}>
                        {t('submit.submitButton', { defaultValue: 'Add' })}
                      </Button>
                    </HelpTooltip>
                  )
                ) : (
                  <HelpTooltip content={t('help.submitModal.submit', { defaultValue: 'Send the meme for review. If this is your own channel, it will be added instantly.' })}>
                    <Button type="submit" variant="primary" className="flex-1" disabled={importLoading}>
                      {importLoading ? t('submit.submitting') : t('submit.submitButton', { defaultValue: 'Add' })}
                    </Button>
                  </HelpTooltip>
                )}
              </div>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}
