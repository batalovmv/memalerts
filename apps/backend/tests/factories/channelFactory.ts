import type { Channel, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { uniqueId } from './utils.js';

type ChannelClient = Prisma.TransactionClient | typeof prisma;

export async function createChannel(
  overrides: Partial<Prisma.ChannelUncheckedCreateInput> = {},
  opts: { prisma?: ChannelClient } = {}
): Promise<Channel> {
  const seed = uniqueId('channel');
  const data: Prisma.ChannelUncheckedCreateInput = {
    slug: `ch-${seed}`,
    name: `Channel ${seed}`,
    ...overrides,
  };
  const client = opts.prisma ?? prisma;
  return client.channel.create({ data });
}
