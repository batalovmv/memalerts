import type { MemeActivation, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { createChannelMeme } from './memeFactory.js';
import { createUser } from './userFactory.js';

type ActivationClient = Prisma.TransactionClient | typeof prisma;

export async function createMemeActivation(
  overrides: Partial<Prisma.MemeActivationUncheckedCreateInput> = {},
  opts: { prisma?: ActivationClient } = {}
): Promise<MemeActivation> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const userId = overrides.userId ?? (await createUser()).id;
  let channelMemeId = overrides.channelMemeId;
  if (!channelMemeId) {
    const meme = await createChannelMeme({ channelId });
    channelMemeId = meme.id;
  }
  const data: Prisma.MemeActivationUncheckedCreateInput = {
    channelId,
    userId,
    channelMemeId,
    priceCoins: 100,
    volume: 1,
    status: 'done',
    ...overrides,
  };
  const client = opts.prisma ?? prisma;
  return client.memeActivation.create({ data });
}
