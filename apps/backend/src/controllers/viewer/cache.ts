import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import crypto from 'crypto';

export type CacheEntry<T> = { ts: number; data: T; etag?: string };
export const channelMetaCache = new Map<string, CacheEntry<any>>();
const CHANNEL_META_CACHE_MS_DEFAULT = 60_000;
export const CHANNEL_META_CACHE_MAX = 2000;

export type TagIdCacheEntry = { ts: number; id: string | null };
export const tagIdCache = new Map<string, TagIdCacheEntry>();
const TAG_ID_CACHE_MS_DEFAULT = 5 * 60_000;
export const TAG_ID_CACHE_MAX = 10_000;

export type SearchCacheEntry = { ts: number; body: string; etag: string };
export const searchCache = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_MS_DEFAULT = 30_000;
export const SEARCH_CACHE_MAX = 1000;

export type MemeStatsCacheEntry = { ts: number; body: string; etag: string };
export const memeStatsCache = new Map<string, MemeStatsCacheEntry>();
const MEME_STATS_CACHE_MS_DEFAULT = 30_000;
export const MEME_STATS_CACHE_MAX = 500;

export function getChannelMetaCacheMs(): number {
  const raw = parseInt(String(process.env.CHANNEL_META_CACHE_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : CHANNEL_META_CACHE_MS_DEFAULT;
}

export function getTagIdCacheMs(): number {
  const raw = parseInt(String(process.env.TAG_ID_CACHE_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : TAG_ID_CACHE_MS_DEFAULT;
}

export function getSearchCacheMs(): number {
  const raw = parseInt(String(process.env.SEARCH_CACHE_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : SEARCH_CACHE_MS_DEFAULT;
}

export function getMemeStatsCacheMs(): number {
  const raw = parseInt(String(process.env.MEME_STATS_CACHE_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : MEME_STATS_CACHE_MS_DEFAULT;
}

export function setSearchCacheHeaders(req: any, res: Response) {
  // Search is public on production; optionally authenticated. Response is not personalized unless favorites=1.
  const isAuthed = !!req?.userId;
  if (isAuthed) res.setHeader('Cache-Control', 'private, max-age=20, stale-while-revalidate=40');
  else res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
}

export function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function parseTagNames(raw: unknown): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];

  // Defensive limits to avoid query-induced memory growth / expensive IN lists.
  if (s.length > 2000) return [];

  const names = s
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 25)
    .map((t) => (t.length > 50 ? t.slice(0, 50) : t));

  // De-dup
  return Array.from(new Set(names));
}

export async function resolveTagIds(tagNames: string[]): Promise<string[]> {
  if (tagNames.length === 0) return [];
  const ttl = getTagIdCacheMs();
  const now = Date.now();

  const out: string[] = [];
  const missing: string[] = [];

  for (const name of tagNames) {
    const cached = tagIdCache.get(name);
    if (cached && now - cached.ts < ttl) {
      if (cached.id) out.push(cached.id);
      continue;
    }
    missing.push(name);
  }

  if (missing.length > 0) {
    const rows = await prisma.tag.findMany({
      where: { name: { in: missing } },
      select: { id: true, name: true },
    });
    const byName = new Map(rows.map((r) => [String(r.name).toLowerCase(), r.id]));

    for (const name of missing) {
      const id = byName.get(name) ?? null;
      tagIdCache.set(name, { ts: now, id });
      if (id) out.push(id);
    }

    // Hard cap cache size to avoid unbounded growth in case of abusive traffic.
    if (tagIdCache.size > TAG_ID_CACHE_MAX) {
      tagIdCache.clear();
    }
  }

  return out;
}

export function setChannelMetaCacheHeaders(req: any, res: Response) {
  // On production this route is public. On beta it is gated via auth/beta-access middleware.
  // Either way the response is not user-personalized; we use conservative caching when authenticated.
  const isAuthed = !!req?.userId;
  if (isAuthed) {
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  }
}

export function makeEtagFromString(body: string): string {
  // Strong ETag for deterministic JSON payloads (we already cap sizes).
  const hash = crypto.createHash('sha1').update(body).digest('base64');
  return `"${hash}"`;
}

export function ifNoneMatchHit(req: any, etag: string | undefined): boolean {
  if (!etag) return false;
  const inm = req?.headers?.['if-none-match'];
  if (!inm) return false;
  const raw = Array.isArray(inm) ? inm.join(',') : String(inm);
  const normalize = (v: string) => {
    let s = String(v || '').trim();
    // Strip weak prefix.
    if (s.toLowerCase().startsWith('w/')) s = s.slice(2).trim();
    // Strip optional quotes: "abc" -> abc
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    return s.trim();
  };

  const target = normalize(etag);
  // Compare normalized values so clients can send either quoted or unquoted tags.
  return raw
    .split(',')
    .map((s) => normalize(s))
    .filter(Boolean)
    .includes(target);
}

export function pruneOldestEntries<K, V>(map: Map<K, V>, maxSize: number): void {
  if (maxSize <= 0) return;
  if (map.size <= maxSize) return;
  // Map preserves insertion order. Delete oldest keys first.
  const over = map.size - maxSize;
  let i = 0;
  for (const key of map.keys()) {
    map.delete(key);
    i += 1;
    if (i >= over) break;
  }
}


