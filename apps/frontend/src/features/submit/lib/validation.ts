import { getRuntimeConfig } from '@/shared/config/runtimeConfig';

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

export type Translator = (key: string, options?: Record<string, unknown>) => string;

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 300;

export const getMaxFileSizeBytes = (): number => {
  const runtime = getRuntimeConfig();
  const maxMb = runtime?.maxUploadSizeMb;
  if (typeof maxMb === 'number' && Number.isFinite(maxMb) && maxMb > 0) {
    return Math.round(maxMb * 1024 * 1024);
  }
  return MAX_FILE_SIZE_BYTES;
};

export const getMaxFileSizeMb = (): number => Math.max(1, Math.round(getMaxFileSizeBytes() / (1024 * 1024)));

export const getVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      if (video.duration && Number.isFinite(video.duration)) {
        resolve(video.duration);
      } else {
        reject(new Error('Cannot read duration'));
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Cannot load video'));
    };

    video.src = URL.createObjectURL(file);
  });
};

export const validateFile = async (
  file: File,
  t: Translator,
  getDuration: (file: File) => Promise<number> = getVideoDuration,
): Promise<ValidationResult> => {
  const errors: string[] = [];

  const maxFileSizeBytes = getMaxFileSizeBytes();
  const maxFileSizeMb = getMaxFileSizeMb();

  if (file.size > maxFileSizeBytes) {
    errors.push(
      t('submit.errors.fileTooLarge', { defaultValue: 'File is too large. Maximum {{maxMb}} MB.', maxMb: maxFileSizeMb }),
    );
  }

  if (!file.type || !file.type.startsWith('video/')) {
    errors.push(t('submit.errors.invalidType', { defaultValue: 'Invalid file type. Upload a video.' }));
  }

  try {
    const duration = await getDuration(file);
    if (duration > MAX_DURATION_SECONDS) {
      errors.push(t('submit.errors.videoTooLong', { defaultValue: 'Video is too long. Maximum 5 minutes.' }));
    }
  } catch {
    errors.push(t('submit.errors.cannotReadDuration', { defaultValue: 'Cannot read video duration.' }));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};
