import type {
  ChatBotCommand,
  ChatBotSubscription,
  GlobalKickBotCredential,
  GlobalTrovoBotCredential,
  GlobalTwitchBotCredential,
  GlobalVkVideoBotCredential,
  GlobalYouTubeBotCredential,
  KickBotIntegration,
  KickChatBotSubscription,
  Prisma,
  TrovoBotIntegration,
  TwitchBotIntegration,
  YouTubeChatBotSubscription,
  VkVideoBotIntegration,
  YouTubeBotIntegration,
} from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { createExternalAccount, createUser } from './userFactory.js';
import { uniqueId } from './utils.js';

export async function createKickChatBotSubscription(
  overrides: Partial<Prisma.KickChatBotSubscriptionUncheckedCreateInput> = {}
): Promise<KickChatBotSubscription> {
  const seed = uniqueId('kick');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const userId = overrides.userId ?? (await createUser({ channelId })).id;
  const data: Prisma.KickChatBotSubscriptionUncheckedCreateInput = {
    channelId,
    userId,
    kickChannelId: `kick_${seed}`,
    enabled: true,
    ...overrides,
  };
  return prisma.kickChatBotSubscription.create({ data });
}

export async function createChatBotCommand(
  overrides: Partial<Prisma.ChatBotCommandUncheckedCreateInput> = {}
): Promise<ChatBotCommand> {
  const seed = uniqueId('command');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const trigger = overrides.trigger ?? `!cmd_${seed}`;
  const triggerNormalized = overrides.triggerNormalized ?? trigger.toLowerCase();
  const data: Prisma.ChatBotCommandUncheckedCreateInput = {
    channelId,
    trigger,
    triggerNormalized,
    response: `Response ${seed}`,
    enabled: true,
    ...overrides,
  };
  return prisma.chatBotCommand.create({ data });
}

export async function createChatBotSubscription(
  overrides: Partial<Prisma.ChatBotSubscriptionUncheckedCreateInput> = {}
): Promise<ChatBotSubscription> {
  const seed = uniqueId('twitch');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const data: Prisma.ChatBotSubscriptionUncheckedCreateInput = {
    channelId,
    twitchLogin: `twitch_${seed}`,
    enabled: true,
    ...overrides,
  };
  return prisma.chatBotSubscription.create({ data });
}

export async function createYouTubeChatBotSubscription(
  overrides: Partial<Prisma.YouTubeChatBotSubscriptionUncheckedCreateInput> = {}
): Promise<YouTubeChatBotSubscription> {
  const seed = uniqueId('youtube');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const userId = overrides.userId ?? (await createUser({ channelId })).id;
  const data: Prisma.YouTubeChatBotSubscriptionUncheckedCreateInput = {
    channelId,
    userId,
    youtubeChannelId: `youtube_${seed}`,
    enabled: true,
    ...overrides,
  };
  return prisma.youTubeChatBotSubscription.create({ data });
}

export async function createTwitchBotIntegration(
  overrides: Partial<Prisma.TwitchBotIntegrationUncheckedCreateInput> = {}
): Promise<TwitchBotIntegration> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const externalAccountId = overrides.externalAccountId ?? (await createExternalAccount({ provider: 'twitch' })).id;
  const data: Prisma.TwitchBotIntegrationUncheckedCreateInput = {
    channelId,
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.twitchBotIntegration.create({ data });
}

export async function createYouTubeBotIntegration(
  overrides: Partial<Prisma.YouTubeBotIntegrationUncheckedCreateInput> = {}
): Promise<YouTubeBotIntegration> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const externalAccountId = overrides.externalAccountId ?? (await createExternalAccount({ provider: 'youtube' })).id;
  const data: Prisma.YouTubeBotIntegrationUncheckedCreateInput = {
    channelId,
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.youTubeBotIntegration.create({ data });
}

export async function createVkVideoBotIntegration(
  overrides: Partial<Prisma.VkVideoBotIntegrationUncheckedCreateInput> = {}
): Promise<VkVideoBotIntegration> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const externalAccountId = overrides.externalAccountId ?? (await createExternalAccount({ provider: 'vkvideo' })).id;
  const data: Prisma.VkVideoBotIntegrationUncheckedCreateInput = {
    channelId,
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.vkVideoBotIntegration.create({ data });
}

export async function createTrovoBotIntegration(
  overrides: Partial<Prisma.TrovoBotIntegrationUncheckedCreateInput> = {}
): Promise<TrovoBotIntegration> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const externalAccountId = overrides.externalAccountId ?? (await createExternalAccount({ provider: 'trovo' })).id;
  const data: Prisma.TrovoBotIntegrationUncheckedCreateInput = {
    channelId,
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.trovoBotIntegration.create({ data });
}

export async function createKickBotIntegration(
  overrides: Partial<Prisma.KickBotIntegrationUncheckedCreateInput> = {}
): Promise<KickBotIntegration> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const externalAccountId = overrides.externalAccountId ?? (await createExternalAccount({ provider: 'kick' })).id;
  const data: Prisma.KickBotIntegrationUncheckedCreateInput = {
    channelId,
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.kickBotIntegration.create({ data });
}

export async function createGlobalTwitchBotCredential(
  overrides: Partial<Prisma.GlobalTwitchBotCredentialUncheckedCreateInput> = {}
): Promise<GlobalTwitchBotCredential> {
  const externalAccountId =
    overrides.externalAccountId ?? (await createExternalAccount({ provider: 'twitch' })).id;
  const data: Prisma.GlobalTwitchBotCredentialUncheckedCreateInput = {
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.globalTwitchBotCredential.create({ data });
}

export async function createGlobalYouTubeBotCredential(
  overrides: Partial<Prisma.GlobalYouTubeBotCredentialUncheckedCreateInput> = {}
): Promise<GlobalYouTubeBotCredential> {
  const externalAccountId =
    overrides.externalAccountId ?? (await createExternalAccount({ provider: 'youtube' })).id;
  const data: Prisma.GlobalYouTubeBotCredentialUncheckedCreateInput = {
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.globalYouTubeBotCredential.create({ data });
}

export async function createGlobalVkVideoBotCredential(
  overrides: Partial<Prisma.GlobalVkVideoBotCredentialUncheckedCreateInput> = {}
): Promise<GlobalVkVideoBotCredential> {
  const externalAccountId =
    overrides.externalAccountId ?? (await createExternalAccount({ provider: 'vkvideo' })).id;
  const data: Prisma.GlobalVkVideoBotCredentialUncheckedCreateInput = {
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.globalVkVideoBotCredential.create({ data });
}

export async function createGlobalTrovoBotCredential(
  overrides: Partial<Prisma.GlobalTrovoBotCredentialUncheckedCreateInput> = {}
): Promise<GlobalTrovoBotCredential> {
  const externalAccountId =
    overrides.externalAccountId ?? (await createExternalAccount({ provider: 'trovo' })).id;
  const data: Prisma.GlobalTrovoBotCredentialUncheckedCreateInput = {
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.globalTrovoBotCredential.create({ data });
}

export async function createGlobalKickBotCredential(
  overrides: Partial<Prisma.GlobalKickBotCredentialUncheckedCreateInput> = {}
): Promise<GlobalKickBotCredential> {
  const externalAccountId =
    overrides.externalAccountId ?? (await createExternalAccount({ provider: 'kick' })).id;
  const data: Prisma.GlobalKickBotCredentialUncheckedCreateInput = {
    externalAccountId,
    enabled: true,
    ...overrides,
  };
  return prisma.globalKickBotCredential.create({ data });
}
