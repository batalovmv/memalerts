import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

type DbClient = PrismaClient | Prisma.TransactionClient;
type PromotionCacheEntry = { ts: number; discountPercent: number | null };

const promoCache = new Map<string, PromotionCacheEntry>();
const PROMO_CACHE_MS_DEFAULT = 5_000;
const PROMO_CACHE_MAX = 5_000;

function getPromoCacheMs(): number {
  const raw = parseInt(String(process.env.PROMO_CACHE_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : PROMO_CACHE_MS_DEFAULT;
}

/**
 * Get active promotion for a channel at current time
 * Returns the promotion with highest discount if multiple active
 */
export async function getActivePromotion(channelId: string, db: DbClient = prisma): Promise<{ discountPercent: number } | null> {
  // Best-effort short cache: promotions don't change frequently, but this endpoint can be hot (activation/search).
  const ttl = getPromoCacheMs();
  const cached = promoCache.get(channelId);
  const nowMs = Date.now();
  if (cached && nowMs - cached.ts < ttl) {
    return cached.discountPercent === null ? null : { discountPercent: cached.discountPercent };
  }

  const now = new Date(nowMs);

  const promotions = await db.promotion.findMany({
    where: {
      channelId,
      isActive: true,
      startDate: {
        lte: now,
      },
      endDate: {
        gte: now,
      },
    },
    orderBy: {
      discountPercent: 'desc', // Get highest discount
    },
    take: 1,
  });

  if (promotions.length === 0) {
    promoCache.set(channelId, { ts: nowMs, discountPercent: null });
    if (promoCache.size > PROMO_CACHE_MAX) promoCache.clear();
    return null;
  }

  const discountPercent = promotions[0].discountPercent;
  promoCache.set(channelId, { ts: nowMs, discountPercent });
  if (promoCache.size > PROMO_CACHE_MAX) promoCache.clear();

  return { discountPercent };
}

/**
 * Calculate final price with promotion discount
 */
export function calculatePriceWithDiscount(originalPrice: number, discountPercent: number): number {
  const discount = (originalPrice * discountPercent) / 100;
  return Math.max(0, Math.floor(originalPrice - discount));
}


