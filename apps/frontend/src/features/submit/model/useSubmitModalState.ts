import axios, { AxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { SubmitModalBlockedReason, SubmitModalFormData, SubmitMode, UploadStatus } from '@/features/submit/model/submitModalTypes';
import type { ChangeEvent, FormEvent } from 'react';

import { getMaxFileSizeMb, getVideoDuration, validateFile } from '@/features/submit/lib/validation';
import { createIdempotencyKey } from '@/shared/lib/idempotency';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchMemes } from '@/store/slices/memesSlice';
import { fetchSubmissions } from '@/store/slices/submissionsSlice';

type UseSubmitModalStateParams = {
  isOpen: boolean;
  onClose: () => void;
  channelSlug?: string;
  channelId?: string;
  initialBlockedReason?: SubmitModalBlockedReason;
};

export function useSubmitModalState({
  isOpen,
  onClose,
  channelSlug,
  channelId,
  initialBlockedReason = null,
}: UseSubmitModalStateParams) {
  const { t } = useTranslation();
  const { user } = useAppSelector((state) => state.auth);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const [blockedReason, setBlockedReason] = useState<SubmitModalBlockedReason>(null);
  const [mode, setMode] = useState<SubmitMode>('upload');
  const [formData, setFormData] = useState<SubmitModalFormData>({
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

  const resetForm = useCallback(() => {
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
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryIntervalRef.current) {
      window.clearInterval(retryIntervalRef.current);
      retryIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetForm();
      abortControllerRef.current?.abort();
      clearRetryTimer();
    }
  }, [clearRetryTimer, isOpen, resetForm]);

  useEffect(() => {
    if (!isOpen) return;
    if (!initialBlockedReason) return;
    setBlockedReason(initialBlockedReason);
  }, [initialBlockedReason, isOpen]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  const getBlockedCopy = (r: Exclude<SubmitModalBlockedReason, null>) => {
    if (r === 'disabled') return t('submitModal.submissionsDisabled', { defaultValue: 'Отправка мемов запрещена стримером' });
    return t('submitModal.submissionsOffline', { defaultValue: 'Отправка доступна только во время стрима' });
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
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

  const startRetryCountdown = (seconds: number, mode: 'rateLimit' | 'spamBan' = 'rateLimit') => {
    clearRetryTimer();
    const initial = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    setRetryAfterSeconds(initial);
    const key = mode === 'spamBan' ? 'submit.errors.spamBanned' : 'submit.errors.rateLimited';
    setErrorMessage(t(key, { seconds: initial }));
    if (initial <= 0) return;
    retryIntervalRef.current = window.setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev <= 1) {
          clearRetryTimer();
          setErrorMessage(t(key, { seconds: 0 }));
          return 0;
        }
        const next = prev - 1;
        setErrorMessage(t(key, { seconds: next }));
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
      if (errorCode === 'USER_SPAM_BANNED') {
        return t('submit.errors.spamBanned', { defaultValue: 'Temporarily blocked from submitting memes.' });
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
      const mode = errorCode === 'USER_SPAM_BANNED' ? 'spamBan' : 'rateLimit';
      startRetryCountdown(retryAfter, mode);
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

  const handleOpenPool = () => {
    onClose();
    const qs = new URLSearchParams();
    if (channelId) qs.set('channelId', channelId);
    if (channelSlug) qs.set('channelSlug', channelSlug);
    navigate(`/pool${qs.toString() ? `?${qs.toString()}` : ''}`);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
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
        formDataToSend.append('type', 'video');
        if (formData.tags && formData.tags.length > 0) {
          formDataToSend.append('tags', JSON.stringify(formData.tags));
        }
        if (durationMsToSend !== null) {
          formDataToSend.append('durationMs', String(durationMsToSend));
        }
        if (channelId) {
          formDataToSend.append('channelId', channelId);
        }

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

        if (respStatus === 'pending') {
          dispatch(fetchSubmissions({ status: 'pending' }));
        } else if (respStatus === 'approved') {
          const targetChannelId = channelId || user?.channelId || null;
          if (targetChannelId) {
            dispatch(fetchMemes({ channelId: targetChannelId }));
            window.dispatchEvent(
              new CustomEvent('memalerts:channelMemesUpdated', { detail: { channelId: targetChannelId } }),
            );
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
          ...(channelId && { channelId }),
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

        if (respStatus === 'pending') {
          dispatch(fetchSubmissions({ status: 'pending' }));
        } else if (respStatus === 'approved') {
          const targetChannelId = channelId || user?.channelId || null;
          if (targetChannelId) {
            dispatch(fetchMemes({ channelId: targetChannelId }));
            window.dispatchEvent(
              new CustomEvent('memalerts:channelMemesUpdated', { detail: { channelId: targetChannelId } }),
            );
          }
        }

        if (channelSlug) {
          navigate(`/channel/${channelSlug}`);
        } else if (!isOwnerBypassTarget || (!isDirectApproval && respStatus !== 'approved')) {
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

  return {
    blockedReason,
    blockedCopy: blockedReason ? getBlockedCopy(blockedReason) : null,
    canSubmit,
    errorMessage,
    file,
    filePreview,
    formData,
    handleCancelUpload,
    handleFileChange,
    handleOpenPool,
    handleRetry,
    handleSubmit,
    handleSubmitAnother,
    importLoading,
    isOwnerBypassTarget,
    isSubmitLocked,
    isUploading,
    isValidating,
    mode,
    retryAfterSeconds,
    setFormData,
    setMode,
    uploadProgress,
    uploadStatus,
    validationErrors,
  };
}
