import type { BotProvider, Channel, ChannelEntitlement } from '@/types';

import { api } from '@/lib/api';

export async function getDefaultBotStatus(provider: BotProvider): Promise<{ linked: boolean; displayName?: string }> {
  return api.get<{ linked: boolean; displayName?: string }>(`/owner/bots/${encodeURIComponent(provider)}/default/status`);
}

export async function getDefaultBotLinkUrl(provider: BotProvider): Promise<{ url: string }> {
  return api.get<{ url: string }>(`/owner/bots/${encodeURIComponent(provider)}/default/link`);
}

export async function unlinkDefaultBot(provider: BotProvider): Promise<void> {
  await api.delete(`/owner/bots/${encodeURIComponent(provider)}/default`);
}

export async function resolveChannel(query: {
  provider: string;
  externalId: string;
}): Promise<{ channel: Channel | null }> {
  return api.get<{ channel: Channel | null }>('/owner/channels/resolve', { params: query });
}

export async function getCustomBotEntitlements(): Promise<{ entitlements: ChannelEntitlement[] }> {
  return api.get<{ entitlements: ChannelEntitlement[] }>('/owner/entitlements/custom-bot');
}

export async function grantCustomBotEntitlement(channelId: string): Promise<ChannelEntitlement> {
  return api.post<ChannelEntitlement>('/owner/entitlements/custom-bot/grant', { channelId });
}

export async function revokeCustomBotEntitlement(channelId: string): Promise<void> {
  await api.post('/owner/entitlements/custom-bot/revoke', { channelId });
}

export async function grantEntitlementByProvider(provider: string, externalId: string): Promise<ChannelEntitlement> {
  return api.post<ChannelEntitlement>('/owner/entitlements/custom-bot/grant-by-provider', { provider, externalId });
}
