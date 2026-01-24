import { parsePositiveIntEnv } from '../semaphore.js';

export const DEFAULT_MAX_WIDTH = parsePositiveIntEnv('VIDEO_MAX_WIDTH', 1920);
export const DEFAULT_MAX_HEIGHT = parsePositiveIntEnv('VIDEO_MAX_HEIGHT', 1080);
export const DEFAULT_MAX_FPS = parsePositiveIntEnv('VIDEO_MAX_FPS', 30);
export const DEFAULT_TIMEOUT_MS = parsePositiveIntEnv('VIDEO_TRANSCODE_TIMEOUT_MS', 90_000);

export const FFPROBE_CONCURRENCY = parsePositiveIntEnv(
  'VIDEO_FFPROBE_CONCURRENCY',
  process.env.NODE_ENV === 'production' ? 2 : 4
);
export const TRANSCODE_CONCURRENCY = parsePositiveIntEnv(
  'VIDEO_TRANSCODE_CONCURRENCY',
  process.env.NODE_ENV === 'production' ? 1 : 2
);

export function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}
