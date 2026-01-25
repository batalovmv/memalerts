import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

const DEFAULT_MIN_MULTIPLIER = 0.5;
const DEFAULT_MAX_MULTIPLIER = 2.0;
const DYNAMIC_WINDOW_HOURS = 24;
const DYNAMIC_WINDOW_MS = DYNAMIC_WINDOW_HOURS * 60 * 60 * 1000;
const ACTIVE_STATUSES = ['queued', 'playing', 'done', 'completed'] as const;

export type DynamicPricingSettings = {
  enabled: boolean;
  minMultiplier: number;
  maxMultiplier: number;
};

export type DynamicPricingSnapshot = {
  enabled: boolean;
  minMultiplier: number;
  maxMultiplier: number;
  avgRecent: number;
  counts: Map<string, number>;
  windowHours: number;
};

export type DynamicPricingResult = {
  basePriceCoins: number;
  dynamicPriceCoins: number;
  priceMultiplier: number;
  priceTrend: 'rising' | 'falling' | 'stable';
};

type DynamicPricingChannel = {
  dynamicPricingEnabled?: boolean | null;
  dynamicPricingMinMult?: number | null;
  dynamicPricingMaxMult?: number | null;
};

type DynamicPricingDb = PrismaClient | Prisma.TransactionClient;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function normalizeDynamicPricingSettings(channel?: DynamicPricingChannel | null): DynamicPricingSettings {
  const enabled = channel?.dynamicPricingEnabled === true;
  const rawMin = typeof channel?.dynamicPricingMinMult === 'number' ? channel.dynamicPricingMinMult : DEFAULT_MIN_MULTIPLIER;
  const rawMax = typeof channel?.dynamicPricingMaxMult === 'number' ? channel.dynamicPricingMaxMult : DEFAULT_MAX_MULTIPLIER;
  const minNormalized = clamp(rawMin, 0.1, 5);
  const maxNormalized = clamp(rawMax, 0.1, 5);
  const minMultiplier = Math.min(minNormalized, maxNormalized);
  const maxMultiplier = Math.max(minNormalized, maxNormalized);
  return { enabled, minMultiplier, maxMultiplier };
}

export function computeDynamicMultiplier(params: {
  recent: number;
  avgRecent: number;
  minMultiplier: number;
  maxMultiplier: number;
}): { multiplier: number; trend: 'rising' | 'falling' | 'stable' } {
  const { recent, avgRecent, minMultiplier, maxMultiplier } = params;
  let multiplier = 1.0;

  if (avgRecent > 0) {
    const ratio = recent / avgRecent;
    if (ratio > 2) {
      multiplier = Math.min(2.0, 1.0 + (ratio - 1) * 0.2);
    } else if (ratio < 0.3) {
      multiplier = Math.max(0.5, 0.5 + ratio);
    }
  }

  multiplier = clamp(multiplier, minMultiplier, maxMultiplier);
  const trend = multiplier > 1.1 ? 'rising' : multiplier < 0.9 ? 'falling' : 'stable';
  return { multiplier, trend };
}

export function computeDynamicPricing(params: {
  basePriceCoins: number;
  recent: number;
  avgRecent: number;
  settings: DynamicPricingSettings;
}): DynamicPricingResult {
  const basePriceCoins = Math.max(1, Math.round(params.basePriceCoins));
  const { multiplier, trend } = computeDynamicMultiplier({
    recent: params.recent,
    avgRecent: params.avgRecent,
    minMultiplier: params.settings.minMultiplier,
    maxMultiplier: params.settings.maxMultiplier,
  });
  const dynamicPriceCoins = Math.max(1, Math.round(basePriceCoins * multiplier));
  return {
    basePriceCoins,
    dynamicPriceCoins,
    priceMultiplier: multiplier,
    priceTrend: trend,
  };
}

export async function loadDynamicPricingSnapshot(params: {
  channelId: string;
  channelMemeIds: string[];
  settings: DynamicPricingSettings;
  now?: Date;
  db?: DynamicPricingDb;
}): Promise<DynamicPricingSnapshot | null> {
  const { channelId, channelMemeIds, settings, now, db } = params;
  if (!settings.enabled) return null;

  const uniqueIds = Array.from(new Set(channelMemeIds.filter((id) => typeof id === 'string' && id.length > 0)));
  const client = (db ?? prisma) as DynamicPricingDb;
  const since = new Date((now ?? new Date()).getTime() - DYNAMIC_WINDOW_MS);

  const [countsRows, totalActivations, totalMemes] = await Promise.all([
    uniqueIds.length > 0
      ? client.memeActivation.groupBy({
          by: ['channelMemeId'],
          where: {
            channelId,
            channelMemeId: { in: uniqueIds },
            status: { in: ACTIVE_STATUSES as unknown as string[] },
            createdAt: { gte: since },
          },
          _count: { id: true },
        })
      : Promise.resolve([] as Array<{ channelMemeId: string | null; _count: { id: number } }>),
    client.memeActivation.count({
      where: {
        channelId,
        status: { in: ACTIVE_STATUSES as unknown as string[] },
        createdAt: { gte: since },
      },
    }),
    client.channelMeme.count({
      where: { channelId, status: 'approved', deletedAt: null },
    }),
  ]);

  const counts = new Map<string, number>();
  for (const row of countsRows) {
    if (!row.channelMemeId) continue;
    counts.set(String(row.channelMemeId), Number(row._count?.id ?? 0));
  }

  const avgRecent = totalMemes > 0 ? totalActivations / totalMemes : 0;
  return {
    enabled: true,
    minMultiplier: settings.minMultiplier,
    maxMultiplier: settings.maxMultiplier,
    avgRecent,
    counts,
    windowHours: DYNAMIC_WINDOW_HOURS,
  };
}

export function collectChannelMemeIds(items: Array<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (const item of items) {
    const raw = item?.channelMemeId;
    if (typeof raw === 'string' && raw.trim().length > 0) ids.push(raw.trim());
  }
  return ids;
}

export function applyDynamicPricingToItems<T extends Record<string, unknown>>(
  items: T[],
  snapshot: DynamicPricingSnapshot | null
): T[] {
  if (!snapshot || !snapshot.enabled) return items;
  return items.map((item) => {
    const basePriceRaw = item?.priceCoins;
    const basePrice =
      typeof basePriceRaw === 'number' && Number.isFinite(basePriceRaw) ? (basePriceRaw as number) : null;
    if (basePrice === null) return item;

    const channelMemeId = typeof item?.channelMemeId === 'string' ? String(item.channelMemeId) : null;
    const recent = channelMemeId ? snapshot.counts.get(channelMemeId) ?? 0 : 0;
    const dynamic = computeDynamicPricing({
      basePriceCoins: basePrice,
      recent,
      avgRecent: snapshot.avgRecent,
      settings: {
        enabled: snapshot.enabled,
        minMultiplier: snapshot.minMultiplier,
        maxMultiplier: snapshot.maxMultiplier,
      },
    });

    return {
      ...(item as T),
      basePriceCoins: dynamic.basePriceCoins,
      dynamicPriceCoins: dynamic.dynamicPriceCoins,
      priceMultiplier: dynamic.priceMultiplier,
      priceTrend: dynamic.priceTrend,
    };
  });
}
