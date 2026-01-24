export type ExpandCard = null | 'submissionsControl' | 'bots';

export type DashboardCardId =
  | 'submit'
  | 'mySubmissions'
  | 'memes'
  | 'settings'
  | 'submissionsControl'
  | 'bots';

export type BotIntegration = { provider: string; enabled: boolean | null };

export type PublicSubmissionsStatus = { enabled: boolean; channelSlug?: string };

export type BulkActionKind = 'approve' | 'reject' | 'needs_changes';

export type SubmissionsControlState = {
  revealable: boolean;
  token?: string;
  url?: string;
  message?: string;
};
