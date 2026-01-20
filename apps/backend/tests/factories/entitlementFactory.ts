import type { ChannelEntitlement, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { uniqueId } from './utils.js';

type EntitlementClient = Prisma.TransactionClient | typeof prisma;

export async function createChannelEntitlement(
  overrides: Partial<Prisma.ChannelEntitlementUncheckedCreateInput> = {},
  opts: { prisma?: EntitlementClient } = {}
): Promise<ChannelEntitlement> {
  const seed = uniqueId('entitlement');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const data: Prisma.ChannelEntitlementUncheckedCreateInput = {
    channelId,
    key: 'custom_bot',
    enabled: true,
    source: `test-${seed}`,
    ...overrides,
  };
  const client = opts.prisma ?? prisma;
  return client.channelEntitlement.create({ data });
}
