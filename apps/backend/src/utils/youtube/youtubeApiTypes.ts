export type GoogleRefreshTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export type YouTubeApiErrorReason =
  | 'missing_oauth_env'
  | 'no_external_account'
  | 'missing_refresh_token'
  | 'missing_scopes'
  | 'invalid_grant'
  | 'refresh_failed'
  | 'api_unauthorized'
  | 'api_forbidden'
  | 'api_youtube_signup_required'
  | 'api_access_not_configured'
  | 'api_quota'
  | 'api_insufficient_permissions'
  | 'api_error'
  | 'unknown';

export type FetchMyYouTubeChannelIdDiagnostics = {
  ok: boolean;
  channelId: string | null;
  reason: YouTubeApiErrorReason | null;
  httpStatus: number | null;
  googleError: string | null;
  googleErrorDescription: string | null;
  youtubeErrorReason: string | null;
  youtubeErrorMessage: string | null;
  requiredScopesMissing: string[] | null;
  accountScopes: string | null;
};

export type YouTubeBotAuthErrorReason =
  | 'missing_bot_oauth_env'
  | 'missing_bot_refresh_token'
  | 'invalid_grant'
  | 'refresh_failed';

export type YouTubeVideoRating = 'like' | 'dislike' | 'none' | 'unspecified';

export type YouTubeLiveChatMessage = {
  id: string;
  snippet?: {
    displayMessage?: string;
    publishedAt?: string;
    type?: string;
  };
  authorDetails?: {
    displayName?: string;
    channelId?: string;
    isChatModerator?: boolean;
    isChatOwner?: boolean;
    isChatSponsor?: boolean;
    isVerified?: boolean;
  };
};
