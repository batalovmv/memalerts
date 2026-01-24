export const MEME_VARIANTS = {
  PREVIEW: 'preview',
  WEBM: 'webm',
  MP4: 'mp4',
  DONE: 'done',
} as const;

export const CACHE_TTL = {
  ALLOWED_SLUG: 60_000,
  WINDOW_MIN: 60_000,
  CHANNEL_ID: 60_000,
  BOT_OUTBOX: 5_000,
} as const;

export { LIMITS } from './limits';

export const SUBMISSION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  NEEDS_CHANGES: 'needs_changes',
} as const;
