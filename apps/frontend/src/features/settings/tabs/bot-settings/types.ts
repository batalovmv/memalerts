export type ApiErrorData = {
  code?: unknown;
  error?: unknown;
  message?: unknown;
  needsRelink?: unknown;
  reason?: unknown;
  requiredScopesMissing?: unknown;
};

export type ApiErrorShape = {
  response?: {
    status?: number;
    data?: ApiErrorData;
  };
};

export type BotCommand = {
  id: string;
  trigger: string;
  response: string;
  enabled?: boolean;
  onlyWhenLive?: boolean;
  allowedRoles?: Array<'vip' | 'moderator' | 'subscriber' | 'follower'>;
  allowedUsers?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type StreamDurationSettings = {
  enabled?: boolean;
  trigger?: string | null;
  responseTemplate?: string | null;
  breakCreditMinutes?: number | null;
  onlyWhenLive?: boolean | null;
};

export type StreamerBotIntegration = {
  provider: 'twitch' | 'youtube' | 'vkvideo' | 'trovo' | 'kick' | string;
  enabled?: boolean;
  updatedAt?: string | null;
  useDefaultBot?: boolean;
  customBotLinked?: boolean;
  customBotDisplayName?: string | null;
  channelUrl?: string | null;
  vkvideoChannelId?: string | null;
  vkvideoChannelUrl?: string | null;
  trovoChannelId?: string | null;
  kickChannelId?: string | null;
};

export type BotStatusApi = {
  provider?: string;
  enabled?: boolean;
  useDefaultBot?: boolean;
  customBotLinked?: boolean;
  customBotDisplayName?: string | null;
  channelUrl?: string | null;
  updatedAt?: string | null;
};

export type ToggleSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
};

export type OverrideStatus = {
  enabled: boolean;
  updatedAt?: string | null;
  externalAccountId?: string | null;
  lockedBySubscription?: boolean | null;
};

export type CustomBotEntitlementStatus = 'unknown' | 'entitled' | 'not_entitled';
