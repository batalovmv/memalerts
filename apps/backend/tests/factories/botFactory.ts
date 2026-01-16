import type { ChatBotCommand, KickChatBotSubscription, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { createUser } from './userFactory.js';
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
