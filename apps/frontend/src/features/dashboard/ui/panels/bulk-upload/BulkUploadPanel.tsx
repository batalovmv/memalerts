import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getVideoDuration } from '@/features/submit/lib/validation';
import { api } from '@/lib/api';
import { cn } from '@/shared/lib/cn';
import { createIdempotencyKey } from '@/shared/lib/idempotency';
import { Spinner } from '@/shared/ui';
import { DropZone } from '@/shared/ui/DropZone/DropZone';

type UploadStatus = 'validating' | 'pending' | 'uploading' | 'done' | 'error';

type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: UploadStatus;
  error?: string;
  durationMs?: number | null;
};

const MAX_FILES = 20;
const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_DURATION_SECONDS = 15;

function createUploadId(file: File): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(16).slice(2)}`;
}

function trimExtension(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\.[^.]+$/, '').trim();
}

export function BulkUploadPanel() {
  const { t } = useTranslation();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const maxSizeMb = useMemo(() => Math.max(1, Math.round(MAX_SIZE_BYTES / (1024 * 1024))), []);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setUploads((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const validateFile = useCallback(
    async (file: File) => {
      const errors: string[] = [];

      if (!file.type || !file.type.startsWith('video/')) {
        errors.push(t('dashboard.bulkUpload.errors.invalidType', { defaultValue: 'Only video files are allowed.' }));
      }

      if (file.size > MAX_SIZE_BYTES) {
        errors.push(
          t('dashboard.bulkUpload.errors.tooLarge', { defaultValue: 'File is too large. Max {{maxMb}}MB.', maxMb: maxSizeMb }),
        );
      }

      let durationMs: number | null = null;
      try {
        const durationSeconds = await getVideoDuration(file);
        durationMs = Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null;
        if (durationSeconds > MAX_DURATION_SECONDS) {
          errors.push(
            t('dashboard.bulkUpload.errors.tooLong', {
              defaultValue: 'Video is too long. Max {{maxSeconds}}s.',
              maxSeconds: MAX_DURATION_SECONDS,
            }),
          );
        }
      } catch {
        errors.push(t('dashboard.bulkUpload.errors.durationFailed', { defaultValue: 'Cannot read video duration.' }));
      }

      return { valid: errors.length === 0, errors, durationMs };
    },
    [maxSizeMb, t],
  );

  const handleFilesDropped = useCallback(
    async (files: File[]) => {
      if (isUploading || files.length === 0) return;

      const accepted = files.slice(0, MAX_FILES);
      const overflow = files.slice(MAX_FILES);
      const items: UploadItem[] = [
        ...accepted.map<UploadItem>((file) => ({
          id: createUploadId(file),
          file,
          progress: 0,
          status: 'validating',
        })),
        ...overflow.map<UploadItem>((file) => ({
          id: createUploadId(file),
          file,
          progress: 0,
          status: 'error',
          error: t('dashboard.bulkUpload.errors.tooMany', { defaultValue: 'Too many files. Max {{max}}.', max: MAX_FILES }),
        })),
      ];

      setUploads(items);
      setIsUploading(true);

      const validated = await Promise.all(
        items.map(async (item) => {
          if (item.status === 'error') return item;
          const result = await validateFile(item.file);
          if (!result.valid) {
            return { ...item, status: 'error' as const, error: result.errors.join(' ') };
          }
          return { ...item, status: 'pending' as const, durationMs: result.durationMs ?? null };
        }),
      );

      setUploads(validated);

      try {
        for (const item of validated) {
          if (item.status !== 'pending') continue;

          updateItem(item.id, { status: 'uploading', progress: 0, error: undefined });

          const formData = new FormData();
          formData.append('file', item.file);
          formData.append('type', 'video');

          const title = trimExtension(item.file.name);
          if (title) {
            formData.append('title', title);
          }

          if (item.durationMs) {
            formData.append('durationMs', String(item.durationMs));
          }

          try {
            await api.post('/submissions', formData, {
              headers: {
                'Content-Type': 'multipart/form-data',
                'Idempotency-Key': createIdempotencyKey(),
              },
              onUploadProgress: (e) => {
                const total = e.total ?? 0;
                const progress = Math.round((e.loaded * 100) / (total || e.loaded || 1));
                updateItem(item.id, { progress });
              },
            });

            updateItem(item.id, { status: 'done', progress: 100 });
          } catch (error) {
            const message =
              (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
                ? error.message
                : t('dashboard.bulkUpload.errors.uploadFailed', { defaultValue: 'Upload failed.' });
            updateItem(item.id, { status: 'error', error: message });
          }
        }
      } finally {
        setIsUploading(false);
      }
    },
    [isUploading, t, updateItem, validateFile],
  );

  const statusLabel = (item: UploadItem) => {
    if (item.status === 'validating') return t('dashboard.bulkUpload.status.validating', { defaultValue: 'Validating' });
    if (item.status === 'pending') return t('dashboard.bulkUpload.status.pending', { defaultValue: 'Pending' });
    if (item.status === 'uploading') return t('dashboard.bulkUpload.status.uploading', { defaultValue: 'Uploading {{progress}}%', progress: item.progress });
    if (item.status === 'done') return t('dashboard.bulkUpload.status.done', { defaultValue: 'Done' });
    return t('dashboard.bulkUpload.status.error', { defaultValue: 'Error' });
  };

  return (
    <section className="surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold dark:text-white">
            {t('dashboard.bulkUpload.title', { defaultValue: 'Bulk upload' })}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('dashboard.bulkUpload.subtitle', {
              defaultValue: 'Drop up to {{maxFiles}} videos (max {{maxMb}}MB, {{maxSeconds}}s each).',
              maxFiles: MAX_FILES,
              maxMb: maxSizeMb,
              maxSeconds: MAX_DURATION_SECONDS,
            })}
          </p>
        </div>
        {isUploading ? <Spinner className="h-5 w-5" /> : null}
      </div>

      <div className="mt-4">
        <DropZone
          onFilesDropped={handleFilesDropped}
          accept="video/*"
          maxFiles={MAX_FILES}
          maxSize={MAX_SIZE_BYTES}
          disabled={isUploading}
          ariaLabel={t('dashboard.bulkUpload.dropZone', { defaultValue: 'Drop videos to upload' })}
        >
          <div className="space-y-2">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('dashboard.bulkUpload.dropTitle', { defaultValue: 'Drop videos here' })}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('dashboard.bulkUpload.dropHint', { defaultValue: 'Drag and drop or click to select files' })}
            </p>
          </div>
        </DropZone>
      </div>

      {uploads.length > 0 ? (
        <div className="mt-4 space-y-3">
          {uploads.map((item) => (
            <div key={item.id} className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.file.name}</div>
                  <div
                    className={cn(
                      'text-xs mt-1',
                      item.status === 'error' ? 'text-rose-600 dark:text-rose-300' : 'text-gray-500 dark:text-gray-400',
                    )}
                  >
                    {statusLabel(item)}
                  </div>
                </div>
                <div className={cn('text-xs font-semibold', item.status === 'done' ? 'text-emerald-600 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400')}>
                  {item.status === 'done' ? t('dashboard.bulkUpload.doneBadge', { defaultValue: 'OK' }) : null}
                </div>
              </div>
              <div className="mt-2">
                <progress
                  value={item.progress}
                  max={100}
                  className={cn(
                    'h-2 w-full overflow-hidden rounded-full',
                    item.status === 'error' ? 'accent-rose-500' : 'accent-primary',
                  )}
                />
              </div>
              {item.error ? (
                <div className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                  {item.error}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
