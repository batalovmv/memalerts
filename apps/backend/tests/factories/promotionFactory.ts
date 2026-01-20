import type { Prisma, Promotion } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { uniqueId } from './utils.js';

type PromotionClient = Prisma.TransactionClient | typeof prisma;

export async function createPromotion(
  overrides: Partial<Prisma.PromotionUncheckedCreateInput> = {},
  opts: { prisma?: PromotionClient } = {}
): Promise<Promotion> {
  const seed = uniqueId('promo');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const now = new Date();
  const data: Prisma.PromotionUncheckedCreateInput = {
    channelId,
    name: `Promo ${seed}`,
    discountPercent: 10,
    startDate: new Date(now.getTime() - 1000),
    endDate: new Date(now.getTime() + 60_000),
    isActive: true,
    ...overrides,
  };
  const client = opts.prisma ?? prisma;
  return client.promotion.create({ data });
}
