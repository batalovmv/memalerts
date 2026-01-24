export type UserRole = 'viewer' | 'streamer' | 'admin';

export type MemeCatalogMode = 'channel' | 'pool_all';

export type StorageProvider = 'local' | 's3';

export type BotProvider = 'twitch' | 'youtube' | 'vkvideo' | 'trovo' | 'kick';

export type SubmissionSourceKind = 'upload' | 'url' | 'pool';

export type MemeAssetStatus = 'active' | 'hidden' | 'quarantined' | 'deleted';

export type AudioNormStatus = 'pending' | 'processing' | 'done' | 'failed' | 'failed_final';

export type MemeType = 'image' | 'gif' | 'video' | 'audio';

// Backends evolved from legacy active/inactive to channel-scoped moderation statuses.
// Keep the union broad for back-compat across endpoints.
export type MemeStatus =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'disabled'
  | 'deleted';

export type SubmissionStatus = 'pending' | 'needs_changes' | 'approved' | 'rejected';

export type SubmissionAiStatus = 'pending' | 'processing' | 'done' | 'failed' | 'failed_final';
export type SubmissionAiDecision = 'low' | 'medium' | 'high';
