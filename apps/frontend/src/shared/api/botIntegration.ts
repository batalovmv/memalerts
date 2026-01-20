import { api } from '@/lib/api';
import type { BotProvider } from '@/types';

export type BotStatus = {
  provider: BotProvider;
  enabled: boolean;
  useDefaultBot: boolean;
  customBotLinked: boolean;
  customBotDisplayName?: string | null;
  channelUrl?: string | null;
};

export type AllBotsStatus = {
  bots: BotStatus[];
};

export async function getAllBotStatuses(): Promise<AllBotsStatus> {
  return api.get<AllBotsStatus>('/streamer/bots');
}

export async function updateBotSettings(
  provider: BotProvider,
  settings: { enabled?: boolean; useDefaultBot?: boolean; channelUrl?: string },
): Promise<BotStatus> {
  return api.patch<BotStatus>(`/streamer/bots/${encodeURIComponent(provider)}`, settings);
}

export async function getBotLinkUrl(provider: BotProvider): Promise<{ url: string }> {
  return api.get<{ url: string }>(`/streamer/bots/${encodeURIComponent(provider)}/bot/link`);
}

export async function unlinkBot(provider: BotProvider): Promise<void> {
  await api.delete(`/streamer/bots/${encodeURIComponent(provider)}/bot`);
}

export async function getVkVideoCandidates(): Promise<{ candidates: Array<{ id: string; name: string }> }> {
  return api.get<{ candidates: Array<{ id: string; name: string }> }>('/streamer/bots/vkvideo/candidates');
}
