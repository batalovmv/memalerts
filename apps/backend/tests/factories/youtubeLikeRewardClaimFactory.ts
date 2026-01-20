import type { Prisma, YouTubeLikeRewardClaim } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { createUser } from './userFactory.js';
import { uniqueId } from './utils.js';

type ClaimClient = Prisma.TransactionClient | typeof prisma;

export async function createYouTubeLikeRewardClaim(
  overrides: Partial<Prisma.YouTubeLikeRewardClaimUncheckedCreateInput> = {},
  opts: { prisma?: ClaimClient } = {}
): Promise<YouTubeLikeRewardClaim> {
  const seed = uniqueId('ytclaim');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const userId = overrides.userId ?? (await createUser()).id;
  const data: Prisma.YouTubeLikeRewardClaimUncheckedCreateInput = {
    channelId,
    userId,
    videoId: `video_${seed}`,
    coinsGranted: 0,
    ...overrides,
  };
  const client = opts.prisma ?? prisma;
  return client.youTubeLikeRewardClaim.create({ data });
}
