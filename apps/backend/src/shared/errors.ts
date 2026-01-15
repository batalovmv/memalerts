export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_LIMIT: 'INVALID_LIMIT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  ROLE_REQUIRED: 'ROLE_REQUIRED',
  BETA_ACCESS_REQUIRED: 'BETA_ACCESS_REQUIRED',
  CSRF_INVALID: 'CSRF_INVALID',
  NOT_FOUND: 'NOT_FOUND',
  CHANNEL_NOT_FOUND: 'CHANNEL_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  ALREADY_IN_CHANNEL: 'ALREADY_IN_CHANNEL',
  // Bots / integrations (streamer panel contract)
  MISSING_CHANNEL_ID: 'MISSING_CHANNEL_ID',
  TWITCH_BOT_NOT_CONFIGURED: 'TWITCH_BOT_NOT_CONFIGURED',
  YOUTUBE_RELINK_REQUIRED: 'YOUTUBE_RELINK_REQUIRED',
  YOUTUBE_CHANNEL_REQUIRED: 'YOUTUBE_CHANNEL_REQUIRED',
  YOUTUBE_API_NOT_CONFIGURED: 'YOUTUBE_API_NOT_CONFIGURED',
  YOUTUBE_API_QUOTA: 'YOUTUBE_API_QUOTA',
  YOUTUBE_BOT_NOT_CONFIGURED: 'YOUTUBE_BOT_NOT_CONFIGURED',
  YOUTUBE_ENABLE_FAILED: 'YOUTUBE_ENABLE_FAILED',
  VKVIDEO_BOT_NOT_CONFIGURED: 'VKVIDEO_BOT_NOT_CONFIGURED',
  TROVO_BOT_NOT_CONFIGURED: 'TROVO_BOT_NOT_CONFIGURED',
  KICK_BOT_NOT_CONFIGURED: 'KICK_BOT_NOT_CONFIGURED',
  // Submissions / uploads
  STREAMER_SUBMISSIONS_DISABLED: 'STREAMER_SUBMISSIONS_DISABLED',
  ONLY_WHEN_LIVE: 'ONLY_WHEN_LIVE',
  SUBMISSIONS_DISABLED: 'SUBMISSIONS_DISABLED',
  SUBMISSIONS_OFFLINE: 'SUBMISSIONS_OFFLINE',
  SUBMISSION_NOT_FOUND: 'SUBMISSION_NOT_FOUND',
  SUBMISSION_NOT_PENDING: 'SUBMISSION_NOT_PENDING',
  MEME_NOT_FOUND: 'MEME_NOT_FOUND',
  CHANNEL_MEME_NOT_FOUND: 'CHANNEL_MEME_NOT_FOUND',
  MEME_ASSET_NOT_FOUND: 'MEME_ASSET_NOT_FOUND',
  INVALID_TITLE: 'INVALID_TITLE',
  INVALID_MEDIA_URL: 'INVALID_MEDIA_URL',
  INVALID_MEDIA_TYPE: 'INVALID_MEDIA_TYPE',
  UPLOAD_TIMEOUT: 'UPLOAD_TIMEOUT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  VIDEO_TOO_LONG: 'VIDEO_TOO_LONG',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  MEDIA_NOT_AVAILABLE: 'MEDIA_NOT_AVAILABLE',
  ASSET_PURGED_OR_QUARANTINED: 'ASSET_PURGED_OR_QUARANTINED',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  INVALID_FILE_CONTENT: 'INVALID_FILE_CONTENT',
  TRANSCODE_FAILED: 'TRANSCODE_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  // Twitch / rewards
  TWITCH_CHANNEL_NOT_LINKED: 'TWITCH_CHANNEL_NOT_LINKED',
  TWITCH_ACCOUNT_MISMATCH: 'TWITCH_ACCOUNT_MISMATCH',
  TWITCH_ELIGIBILITY_UNKNOWN: 'TWITCH_ELIGIBILITY_UNKNOWN',
  TWITCH_REWARD_NOT_AVAILABLE: 'TWITCH_REWARD_NOT_AVAILABLE',
  TWITCH_ELIGIBILITY_CHECK_FAILED: 'TWITCH_ELIGIBILITY_CHECK_FAILED',
  REWARD_COST_COINS_REQUIRED: 'REWARD_COST_COINS_REQUIRED',
  REWARD_DISABLED_OFFLINE: 'REWARD_DISABLED_OFFLINE',
  // OAuth / linking (public contract)
  OAUTH_FAILED: 'OAUTH_FAILED',
  OAUTH_STATE_MISMATCH: 'OAUTH_STATE_MISMATCH',
  TWITCH_NOT_LINKED: 'TWITCH_NOT_LINKED',
  TWITCH_ALREADY_LINKED: 'TWITCH_ALREADY_LINKED',
  ACCOUNT_ALREADY_LINKED: 'ACCOUNT_ALREADY_LINKED',
  // Bots / relay (public contract)
  BOT_NOT_CONFIGURED: 'BOT_NOT_CONFIGURED',
  BOT_DISABLED: 'BOT_DISABLED',
  RELAY_UNAVAILABLE: 'RELAY_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  FEATURE_NOT_AVAILABLE: 'FEATURE_NOT_AVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  BAD_REQUEST: 'Bad request',
  INVALID_LIMIT: 'Invalid limit',
  VALIDATION_ERROR: 'Validation failed',
  UNAUTHORIZED: 'Unauthorized',
  SESSION_EXPIRED: 'Session expired',
  FORBIDDEN: 'Forbidden',
  ROLE_REQUIRED: 'Role required',
  BETA_ACCESS_REQUIRED: 'Beta access required',
  CSRF_INVALID: 'CSRF validation failed',
  NOT_FOUND: 'Not found',
  CHANNEL_NOT_FOUND: 'Channel not found',
  CONFLICT: 'Conflict',
  TOO_MANY_REQUESTS: 'Too many requests',
  ALREADY_IN_CHANNEL: 'This meme is already in your channel',
  MISSING_CHANNEL_ID: 'Missing channelId',
  TWITCH_BOT_NOT_CONFIGURED: 'Twitch bot is not configured',
  YOUTUBE_RELINK_REQUIRED: 'YouTube re-link required',
  YOUTUBE_CHANNEL_REQUIRED: 'YouTube channel required',
  YOUTUBE_API_NOT_CONFIGURED: 'YouTube API is not configured',
  YOUTUBE_API_QUOTA: 'YouTube API quota exceeded',
  YOUTUBE_BOT_NOT_CONFIGURED: 'YouTube bot is not configured',
  YOUTUBE_ENABLE_FAILED: 'Failed to enable YouTube bot',
  VKVIDEO_BOT_NOT_CONFIGURED: 'VKVideo bot is not configured',
  TROVO_BOT_NOT_CONFIGURED: 'Trovo bot is not configured',
  KICK_BOT_NOT_CONFIGURED: 'Kick bot is not configured',
  STREAMER_SUBMISSIONS_DISABLED: 'Submissions are disabled for this channel',
  ONLY_WHEN_LIVE: 'Submissions are allowed only while the stream is live',
  SUBMISSIONS_DISABLED: 'Submissions are disabled for this channel',
  SUBMISSIONS_OFFLINE: 'Submissions are allowed only while the stream is live',
  SUBMISSION_NOT_FOUND: 'Submission not found',
  SUBMISSION_NOT_PENDING: 'Submission is not pending',
  MEME_NOT_FOUND: 'Meme not found',
  CHANNEL_MEME_NOT_FOUND: 'Meme not found',
  MEME_ASSET_NOT_FOUND: 'Meme asset not found',
  INVALID_TITLE: 'Invalid title',
  INVALID_MEDIA_URL: 'Invalid media URL',
  INVALID_MEDIA_TYPE: 'Invalid media type',
  UPLOAD_TIMEOUT: 'Upload timed out',
  FILE_TOO_LARGE: 'File too large',
  VIDEO_TOO_LONG: 'Video is too long',
  UPLOAD_FAILED: 'Upload failed',
  MEDIA_NOT_AVAILABLE: 'Media not available',
  ASSET_PURGED_OR_QUARANTINED: 'Asset is quarantined or purged',
  INVALID_FILE_TYPE: 'Invalid file type',
  INVALID_FILE_CONTENT: 'Invalid file content',
  TRANSCODE_FAILED: 'Failed to transcode media',
  RATE_LIMITED: 'Too many requests',
  TIMEOUT: 'Request timed out',
  TWITCH_CHANNEL_NOT_LINKED: 'Twitch channel is not linked',
  TWITCH_ACCOUNT_MISMATCH: 'Twitch account mismatch',
  TWITCH_ELIGIBILITY_UNKNOWN: 'Twitch eligibility could not be determined',
  TWITCH_REWARD_NOT_AVAILABLE: 'Twitch reward is not available',
  TWITCH_ELIGIBILITY_CHECK_FAILED: 'Failed to check Twitch reward eligibility',
  REWARD_COST_COINS_REQUIRED: 'Reward cost and coins are required',
  REWARD_DISABLED_OFFLINE: 'Reward is disabled while offline',
  OAUTH_FAILED: 'OAuth failed',
  OAUTH_STATE_MISMATCH: 'OAuth state mismatch',
  TWITCH_NOT_LINKED: 'Twitch account is not linked',
  TWITCH_ALREADY_LINKED: 'Twitch account already linked',
  ACCOUNT_ALREADY_LINKED: 'Account already linked',
  BOT_NOT_CONFIGURED: 'Bot is not configured',
  BOT_DISABLED: 'Bot is disabled',
  RELAY_UNAVAILABLE: 'Relay unavailable',
  INTERNAL_ERROR: 'Internal server error',
  FEATURE_NOT_AVAILABLE: 'Feature not available',
};

export type ApiErrorResponse = {
  errorCode: ErrorCode;
  error: string;
  requestId?: string;
  traceId?: string | null;
  details?: unknown;
};

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === 'string' && Object.values(ERROR_CODES).includes(v as ErrorCode);
}

export function defaultErrorCodeForStatus(status: number): ErrorCode {
  if (status === 400) return ERROR_CODES.BAD_REQUEST;
  if (status === 401) return ERROR_CODES.UNAUTHORIZED;
  if (status === 403) return ERROR_CODES.FORBIDDEN;
  if (status === 404) return ERROR_CODES.NOT_FOUND;
  if (status === 408) return ERROR_CODES.TIMEOUT;
  if (status === 409) return ERROR_CODES.CONFLICT;
  if (status === 410) return ERROR_CODES.MEDIA_NOT_AVAILABLE;
  // Precondition Failed: treat as a client-side / contract issue by default.
  // (Some endpoints use 412 for "relink required".)
  if (status === 412) return ERROR_CODES.BAD_REQUEST;
  if (status === 413) return ERROR_CODES.FILE_TOO_LARGE;
  if (status === 429) return ERROR_CODES.RATE_LIMITED;
  if (status === 502) return ERROR_CODES.UPLOAD_FAILED;
  if (status === 503) return ERROR_CODES.RELAY_UNAVAILABLE;
  return ERROR_CODES.INTERNAL_ERROR;
}
