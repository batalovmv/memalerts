const ERROR_MESSAGES: Record<string, string> = {
  // HTTP/base
  BAD_REQUEST: 'Bad request',
  INVALID_LIMIT: 'Invalid limit',
  VALIDATION_ERROR: 'Validation error',
  UNAUTHORIZED: 'Authentication required',
  SESSION_EXPIRED: 'Session expired',
  FORBIDDEN: 'Access denied',
  ROLE_REQUIRED: 'Role required',
  BETA_ACCESS_REQUIRED: 'Beta access required',
  CSRF_INVALID: 'Invalid CSRF token',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  TOO_MANY_REQUESTS: 'Too many requests',
  INTERNAL_ERROR: 'Internal server error',
  FEATURE_NOT_AVAILABLE: 'Feature not available',

  // Channel/resource
  CHANNEL_NOT_FOUND: 'Channel not found',
  MISSING_CHANNEL_ID: 'Missing channel id',
  CHANNEL_REQUIRED: 'Channel required',
  ALREADY_IN_CHANNEL: 'Already in channel',

  // Bot
  BOT_NOT_CONFIGURED: 'Bot is not configured',
  BOT_DISABLED: 'Bot is disabled',
  BOT_NOT_LINKED: 'Bot is not linked',
  BOT_ALREADY_LINKED: 'Bot is already linked',
  BOT_ENTITLEMENT_REQUIRED: 'Custom bot entitlement required',
  TWITCH_BOT_NOT_CONFIGURED: 'Twitch bot is not configured',
  YOUTUBE_BOT_NOT_CONFIGURED: 'YouTube bot is not configured',
  YOUTUBE_RELINK_REQUIRED: 'YouTube relink required',
  YOUTUBE_CHANNEL_REQUIRED: 'YouTube channel required',
  YOUTUBE_API_NOT_CONFIGURED: 'YouTube API not configured',
  YOUTUBE_API_QUOTA: 'YouTube API quota exceeded',
  YOUTUBE_ENABLE_FAILED: 'Failed to enable YouTube',
  VKVIDEO_BOT_NOT_CONFIGURED: 'VKVideo bot is not configured',
  TROVO_BOT_NOT_CONFIGURED: 'Trovo bot is not configured',
  KICK_BOT_NOT_CONFIGURED: 'Kick bot is not configured',

  // Submissions
  STREAMER_SUBMISSIONS_DISABLED: 'Submissions are disabled by the streamer',
  SUBMISSIONS_DISABLED: 'Submissions are disabled',
  SUBMISSIONS_OFFLINE: 'Submissions are allowed only while the stream is live',
  USER_SPAM_BANNED: 'Temporarily blocked from submitting memes',
  ONLY_WHEN_LIVE: 'Available only while live',
  SUBMISSION_NOT_FOUND: 'Submission not found',
  SUBMISSION_NOT_PENDING: 'Submission is not pending',
  SUBMISSION_ALREADY_PROCESSED: 'Submission already processed',
  SUBMISSION_REVISION_LIMIT: 'Resubmit limit reached',
  SUBMISSION_FILE_TOO_LARGE: 'Submission file is too large',
  SUBMISSION_INVALID_FORMAT: 'Invalid submission format',

  // Memes & assets
  MEME_NOT_FOUND: 'Meme not found',
  CHANNEL_MEME_NOT_FOUND: 'Channel meme not found',
  MEME_ASSET_NOT_FOUND: 'Meme asset not found',
  ASSET_PURGED_OR_QUARANTINED: 'Asset is deleted or quarantined',
  MEME_INSUFFICIENT_COINS: 'Insufficient coins',
  MEME_ACTIVATION_RATE_LIMITED: 'Meme activation rate limited',
  MEME_COOLDOWN_ACTIVE: 'This meme is cooling down. Try again soon.',

  // Upload/media
  INVALID_TITLE: 'Invalid title',
  INVALID_MEDIA_URL: 'Invalid media URL',
  INVALID_MEDIA_TYPE: 'Unsupported media type',
  INVALID_FILE_TYPE: 'Unsupported file type',
  INVALID_FILE_CONTENT: 'Invalid file content',
  FILE_TOO_LARGE: 'File too large',
  VIDEO_TOO_LONG: 'Video too long',
  UPLOAD_TIMEOUT: 'Upload timeout',
  UPLOAD_FAILED: 'Upload failed',
  MEDIA_NOT_AVAILABLE: 'Media not available',
  TRANSCODE_FAILED: 'Transcode failed',
  RATE_LIMITED: 'Rate limited',
  TIMEOUT: 'Operation timeout',

  // Twitch
  TWITCH_NOT_LINKED: 'Twitch not linked',
  TWITCH_ALREADY_LINKED: 'Twitch already linked',
  TWITCH_CHANNEL_NOT_LINKED: 'Twitch channel not linked',
  TWITCH_ACCOUNT_MISMATCH: 'Twitch account mismatch',
  TWITCH_ELIGIBILITY_UNKNOWN: 'Twitch eligibility unknown',
  TWITCH_ELIGIBILITY_CHECK_FAILED: 'Twitch eligibility check failed',
  TWITCH_REWARD_NOT_AVAILABLE: 'Twitch reward not available',
  REWARD_COST_COINS_REQUIRED: 'Reward cost is required',
  REWARD_DISABLED_OFFLINE: 'Reward is disabled while offline',

  // OAuth
  OAUTH_FAILED: 'OAuth failed',
  OAUTH_STATE_MISMATCH: 'OAuth state mismatch',
  ACCOUNT_ALREADY_LINKED: 'Account already linked',

  // Boosty
  BOOSTY_INVALID_TOKEN: 'Boosty token invalid',
  BOOSTY_RATE_LIMITED: 'Boosty rate limited',
  BOOSTY_UNAVAILABLE: 'Boosty unavailable',
  BOOSTY_ACCOUNT_ALREADY_LINKED: 'Boosty already linked',

  // AI
  AI_PROCESSING: 'AI processing in progress',
  AI_UNAVAILABLE: 'AI unavailable',
  AI_RATE_LIMITED: 'AI rate limited',

  // System
  RELAY_UNAVAILABLE: 'Relay unavailable',
};

export function getErrorMessage(errorCode?: string): string | null {
  if (!errorCode) return null;
  return ERROR_MESSAGES[errorCode] ?? null;
}
