import { prisma } from '../lib/prisma.js';

/**
 * Get active promotion for a channel at current time
 * Returns the promotion with highest discount if multiple active
 */
export async function getActivePromotion(channelId: string): Promise<{ discountPercent: number } | null> {
  const now = new Date();
  
  const promotions = await prisma.promotion.findMany({
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
    return null;
  }

  return {
    discountPercent: promotions[0].discountPercent,
  };
}

/**
 * Calculate final price with promotion discount
 */
export function calculatePriceWithDiscount(originalPrice: number, discountPercent: number): number {
  const discount = (originalPrice * discountPercent) / 100;
  return Math.max(0, Math.floor(originalPrice - discount));
}

