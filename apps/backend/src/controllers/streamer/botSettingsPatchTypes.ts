import type { AuthRequest } from '../../middleware/auth.js';
import type { BotProviderActive, BotIntegrationPatchBody } from './botIntegrationsShared.js';

export type BotPatchContext = {
  req: AuthRequest;
  channelId: string;
  provider: BotProviderActive;
  enabled: boolean;
  customBotEntitled: boolean;
  body: BotIntegrationPatchBody;
};

export type BotPatchPrepared = {
  twitchLogin?: string | null;
  twitchChannelId?: string | null;
  youtubeChannelId?: string | null;
  trovoChannelId?: string | null;
  kickChannelId?: string | null;
  vkvideoChannelId?: string | null;
  vkvideoChannelUrl?: string | null;
};

export type BotPatchResult =
  | { ok: true; data: BotPatchPrepared }
  | { ok: false; status: number; body: Record<string, unknown> };

export type BotPatchApplyResult = { ok: true } | { ok: false; status: number; body: Record<string, unknown> };
