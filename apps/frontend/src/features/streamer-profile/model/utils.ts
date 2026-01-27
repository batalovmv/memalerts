import type { ChannelInfo } from '@/features/streamer-profile/model/types';
import type { MemePoolItem } from '@/shared/api/memes';
import type { ChannelEconomy, MemeDetail } from '@memalerts/api-contracts';

import { api } from '@/lib/api';
import { getMemePrimaryId } from '@/shared/lib/memeIds';
import { toRecord } from '@/shared/lib/parsing';

export { toRecord };

export function looksLikeSpaHtml(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  const head = data.slice(0, 256).toLowerCase();
  return head.includes('<!doctype html') || head.includes('<html');
}

/**
 * Normalize API response to MemeDetail[].
 * Handles both array responses and { items: [...] } object responses.
 */
export function extractMemesFromResponse(resp: unknown): MemeDetail[] {
  if (Array.isArray(resp)) return resp as MemeDetail[];
  const rec = toRecord(resp);
  if (rec && Array.isArray(rec.items)) return rec.items as MemeDetail[];
  return [];
}

export function mergeMemesById(prev: MemeDetail[], next: MemeDetail[]): MemeDetail[] {
  if (next.length === 0) return prev;
  const nextById = new Map(next.map((m) => [getMemePrimaryId(m), m]));
  const seen = new Set(nextById.keys());
  const tail = prev.filter((m) => !seen.has(getMemePrimaryId(m)));
  return [...next, ...tail];
}

export function toPoolCardMeme(m: MemePoolItem, fallbackTitle: string): MemeDetail {
  // Pool items represent MemeAsset (channel-independent). MemeCard expects MemeDetail-like shape.
  const previewUrl =
    typeof (m as unknown as { previewUrl?: unknown }).previewUrl === 'string'
      ? ((m as unknown as { previewUrl: string }).previewUrl || '').trim() || null
      : null;
  const fileUrl =
    (typeof (m as unknown as { fileUrl?: unknown }).fileUrl === 'string' && (m as unknown as { fileUrl: string }).fileUrl) ||
    (typeof (m as unknown as { url?: unknown }).url === 'string' && (m as unknown as { url: string }).url) ||
    previewUrl ||
    '';
  const variants = Array.isArray((m as unknown as { variants?: unknown }).variants)
    ? ((m as unknown as { variants: MemeDetail['variants'] }).variants ?? undefined)
    : undefined;
  const tags = Array.isArray((m as unknown as { tags?: unknown }).tags)
    ? ((m as unknown as { tags: MemeDetail['tags'] }).tags ?? undefined)
    : undefined;
  const aiAutoTagNames = Array.isArray((m as unknown as { aiAutoTagNames?: unknown }).aiAutoTagNames)
    ? ((m as unknown as { aiAutoTagNames: MemeDetail['aiAutoTagNames'] }).aiAutoTagNames ?? undefined)
    : undefined;

  const title =
    typeof m.sampleTitle === 'string' && m.sampleTitle.trim() ? m.sampleTitle.trim() : typeof fallbackTitle === 'string' ? fallbackTitle : '';
  const priceCoins = typeof m.samplePriceCoins === 'number' && Number.isFinite(m.samplePriceCoins) ? m.samplePriceCoins : 0;
  const durationMs = typeof m.durationMs === 'number' && Number.isFinite(m.durationMs) ? m.durationMs : 0;
  const type = (m.type as MemeDetail['type'] | undefined) || 'video';

  // Prefer explicit memeAssetId, fallback to id.
  const memeAssetId =
    typeof m.memeAssetId === 'string' && m.memeAssetId.trim()
      ? m.memeAssetId.trim()
      : typeof m.id === 'string' && m.id.trim()
        ? m.id.trim()
        : '';

  return {
    id: memeAssetId,
    title,
    type,
    previewUrl,
    variants: variants ?? [],
    fileUrl,
    priceCoins,
    durationMs,
    activationsCount: 0,
    createdAt: new Date().toISOString(),
    tags,
    aiAutoTagNames,
  };
}

export async function fetchMemesPool(opts: {
  limit: number;
  offset: number;
  q?: string;
  tags?: string;
  channelSlug?: string;
  timeoutMs?: number;
}): Promise<MemeDetail[]> {
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit));
  params.set('offset', String(opts.offset));
  if (typeof opts.q === 'string' && opts.q.trim()) params.set('q', opts.q.trim());
  if (typeof opts.tags === 'string' && opts.tags.trim()) params.set('tags', opts.tags.trim());
  if (typeof opts.channelSlug === 'string' && opts.channelSlug.trim()) {
    params.set('channelSlug', opts.channelSlug.trim().toLowerCase());
  }
  // Avoid stale cache after recent toggles (proxy/CDN/browser).
  params.set('_ts', String(Date.now()));

  const resp = await api.get<unknown>(`/memes/pool?${params.toString()}`, {
    timeout: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000,
    headers: { 'Cache-Control': 'no-store' },
  });

  const items = Array.isArray(resp) ? (resp as MemePoolItem[]) : [];
  return items.map((x, idx) => toPoolCardMeme(x, `Meme #${opts.offset + idx + 1}`));
}

export async function fetchChannelMemesSearch(opts: {
  channelSlug: string;
  params: URLSearchParams;
  preferPublic?: boolean;
  timeoutMs?: number;
}): Promise<unknown> {
  const slug = String(opts.channelSlug || '').trim();
  const timeout = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000;

  const publicParams = new URLSearchParams(opts.params);
  // Public endpoint already scopes by slug in path.
  publicParams.delete('channelSlug');
  publicParams.delete('channelId');

  const publicUrl = `/public/channels/${encodeURIComponent(slug)}/memes/search?${publicParams.toString()}`;
  const channelUrl = `/channels/memes/search?${opts.params.toString()}`;

  const doPublic = async () => {
    const resp = await api.get<unknown>(publicUrl, {
      timeout,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (looksLikeSpaHtml(resp)) {
      throw new Error('Public channel memes endpoint returned HTML');
    }
    return resp;
  };

  const doChannel = async () =>
    api.get<unknown>(channelUrl, {
      timeout,
      headers: { 'Cache-Control': 'no-store' },
    });

  if (opts.preferPublic) {
    try {
      return await doPublic();
    } catch {
      return await doChannel();
    }
  }

  try {
    return await doChannel();
  } catch {
    return await doPublic();
  }
}

export function normalizeChannelInfo(raw: unknown, fallbackSlug: string): ChannelInfo | null {
  const r = toRecord(raw);
  if (!r) return null;

  const id = typeof r.id === 'string' ? r.id : null;
  const name = typeof r.name === 'string' ? r.name : null;
  const slug = typeof r.slug === 'string' && r.slug.trim() ? r.slug.trim() : fallbackSlug;
  if (!id || !name) return null;

  const memeCatalogMode =
    r.memeCatalogMode === 'pool_all' || r.memeCatalogMode === 'channel' ? (r.memeCatalogMode as 'pool_all' | 'channel') : undefined;

  const ownerRaw = toRecord(r.owner);
  const owner = ownerRaw
    ? {
        id: typeof ownerRaw.id === 'string' ? ownerRaw.id : '',
        displayName: typeof ownerRaw.displayName === 'string' ? ownerRaw.displayName : '',
        profileImageUrl: typeof ownerRaw.profileImageUrl === 'string' ? ownerRaw.profileImageUrl : null,
      }
    : null;

  const statsRaw = toRecord(r.stats);
  const memesCount = typeof statsRaw?.memesCount === 'number' && Number.isFinite(statsRaw.memesCount) ? statsRaw.memesCount : 0;
  const usersCount = typeof statsRaw?.usersCount === 'number' && Number.isFinite(statsRaw.usersCount) ? statsRaw.usersCount : 0;
  const economy = toRecord(r.economy) ? (r.economy as ChannelEconomy) : undefined;

  return {
    id,
    slug,
    name,
    memeCatalogMode,
    coinPerPointRatio: typeof r.coinPerPointRatio === 'number' && Number.isFinite(r.coinPerPointRatio) ? r.coinPerPointRatio : 0,
    coinIconUrl: typeof r.coinIconUrl === 'string' ? r.coinIconUrl : r.coinIconUrl === null ? null : null,
    rewardTitle: typeof r.rewardTitle === 'string' ? r.rewardTitle : r.rewardTitle === null ? null : null,
    primaryColor: typeof r.primaryColor === 'string' ? r.primaryColor : r.primaryColor === null ? null : null,
    secondaryColor: typeof r.secondaryColor === 'string' ? r.secondaryColor : r.secondaryColor === null ? null : null,
    accentColor: typeof r.accentColor === 'string' ? r.accentColor : r.accentColor === null ? null : null,
    submissionsEnabled: typeof r.submissionsEnabled === 'boolean' ? r.submissionsEnabled : undefined,
    submissionsOnlyWhenLive: typeof r.submissionsOnlyWhenLive === 'boolean' ? r.submissionsOnlyWhenLive : undefined,
    wheelEnabled: typeof r.wheelEnabled === 'boolean' ? r.wheelEnabled : undefined,
    wheelPaidSpinCostCoins: typeof r.wheelPaidSpinCostCoins === 'number' ? r.wheelPaidSpinCostCoins : r.wheelPaidSpinCostCoins === null ? null : undefined,
    wheelPrizeMultiplier: typeof r.wheelPrizeMultiplier === 'number' ? r.wheelPrizeMultiplier : undefined,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    memes: [],
    owner,
    stats: { memesCount, usersCount },
    economy,
  };
}


