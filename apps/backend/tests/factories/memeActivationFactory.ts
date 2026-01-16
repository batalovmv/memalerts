import type { MemeActivation, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { createMeme } from './memeFactory.js';
import { createUser } from './userFactory.js';

type ActivationClient = Prisma.TransactionClient | typeof prisma;

export async function createMemeActivation(
  overrides: Partial<Prisma.MemeActivationUncheckedCreateInput> = {},
  opts: { prisma?: ActivationClient } = {}
): Promise<MemeActivation> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const userId = overrides.userId ?? (await createUser()).id;
  let memeId = overrides.memeId;
  if (!memeId) {
    const meme = await createMeme({ channelId });
    memeId = meme.id;
  }
  const data: Prisma.MemeActivationUncheckedCreateInput = {
    channelId,
    userId,
    memeId,
    coinsSpent: 100,
    status: 'done',
    ...overrides,
  };
  const client = opts.prisma ?? prisma;
  return client.memeActivation.create({ data });
}
