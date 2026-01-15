import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';

export type ChannelEntitlementKey = 'custom_bot';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { ts: number; value: boolean }>();

function cacheKey(channelId: string, key: ChannelEntitlementKey): string {
  return `${channelId}:${key}`;
}

function isPrismaTableMissingError(e: unknown): boolean {
  // Prisma "table does not exist" (feature not deployed / migrations not applied)
  return (e as { code?: string })?.code === 'P2021';
}

function isEntitlementActive(row: { enabled: boolean; expiresAt: Date | null } | null | undefined, now: Date): boolean {
  if (!row?.enabled) return false;
  if (!row.expiresAt) return true;
  return row.expiresAt.getTime() > now.getTime();
}

export async function hasChannelEntitlement(channelIdRaw: string, key: ChannelEntitlementKey): Promise<boolean> {
  const channelId = String(channelIdRaw || '').trim();
  if (!channelId) return false;

  const k = cacheKey(channelId, key);
  const nowMs = Date.now();
  const cached = cache.get(k);
  if (cached && nowMs - cached.ts <= CACHE_TTL_MS) return cached.value;

  const now = new Date(nowMs);
  try {
    const row = await prisma.channelEntitlement.findUnique({
      where: { channelId_key: { channelId, key } },
      select: { enabled: true, expiresAt: true },
    });
    const value = isEntitlementActive(row ?? null, now);
    cache.set(k, { ts: nowMs, value });
    return value;
  } catch (error) {
    if (isPrismaTableMissingError(error)) {
      cache.set(k, { ts: nowMs, value: false });
      return false;
    }
    const err = error as Error;
    logger.warn('entitlements.has_failed', { channelId, key, errorMessage: err.message || String(error) });
    cache.set(k, { ts: nowMs, value: false });
    return false;
  }
}

export async function getEntitledChannelIds(channelIdsRaw: string[], key: ChannelEntitlementKey): Promise<Set<string>> {
  const ids = Array.from(new Set((channelIdsRaw || []).map((c) => String(c || '').trim()).filter(Boolean)));
  if (ids.length === 0) return new Set();

  const nowMs = Date.now();
  const now = new Date(nowMs);

  // Try to reuse cache first.
  const out = new Set<string>();
  const toQuery: string[] = [];
  for (const channelId of ids) {
    const k = cacheKey(channelId, key);
    const cached = cache.get(k);
    if (cached && nowMs - cached.ts <= CACHE_TTL_MS) {
      if (cached.value) out.add(channelId);
    } else {
      toQuery.push(channelId);
    }
  }

  if (toQuery.length === 0) return out;

  try {
    const rows = await prisma.channelEntitlement.findMany({
      where: {
        channelId: { in: toQuery },
        key,
        enabled: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { channelId: true },
    });

    const entitled = new Set<string>(rows.map((r) => String(r.channelId || '').trim()).filter(Boolean));

    // Update cache for queried ids.
    for (const channelId of toQuery) {
      const value = entitled.has(channelId);
      cache.set(cacheKey(channelId, key), { ts: nowMs, value });
      if (value) out.add(channelId);
    }

    return out;
  } catch (error) {
    if (isPrismaTableMissingError(error)) {
      for (const channelId of toQuery) cache.set(cacheKey(channelId, key), { ts: nowMs, value: false });
      return out;
    }
    const err = error as Error;
    logger.warn('entitlements.bulk_failed', { key, count: toQuery.length, errorMessage: err.message || String(error) });
    for (const channelId of toQuery) cache.set(cacheKey(channelId, key), { ts: nowMs, value: false });
    return out;
  }
}
