import type { Channel, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { uniqueId } from './utils.js';

type ChannelClient = Prisma.TransactionClient | typeof prisma;

export async function createChannel(
  overrides: Partial<Prisma.ChannelUncheckedCreateInput> = {},
  opts: { prisma?: ChannelClient } = {}
): Promise<Channel> {
  const seed = uniqueId('channel');
  const client = opts.prisma ?? prisma;
  // Ensure twitchChannelId stays numeric (for resolve helpers) but avoid uniqueness collisions.
  let twitchChannelId = overrides.twitchChannelId;
  if (twitchChannelId) {
    const existing = await client.channel.findUnique({
      where: { twitchChannelId },
      select: { id: true },
    });
    if (existing) {
      twitchChannelId = `${twitchChannelId}_${seed}`;
    }
  }
  const data: Prisma.ChannelUncheckedCreateInput = {
    slug: `ch-${seed}`,
    name: `Channel ${seed}`,
    ...overrides,
    ...(twitchChannelId ? { twitchChannelId } : {}),
  };
  return client.channel.create({ data });
}
