import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  clampInt,
  getSearchCacheMs,
  ifNoneMatchHit,
  makeEtagFromString,
  parseTagNames,
  SEARCH_CACHE_MAX,
  searchCache,
  setSearchCacheHeaders,
} from './cache.js';
import { loadLegacyTagsById } from './channelMemeListDto.js';
import { nsKey, redisGetString, redisSetStringEx } from '../../utils/redisCache.js';
import { buildSearchTerms } from '../../shared/utils/searchTerms.js';
import { applyViewerMemeState, buildMemeAssetVisibilityFilter, loadViewerMemeState } from './memeViewerState.js';

function getSourceType(format: 'webm' | 'mp4' | 'preview'): string {
  switch (format) {
    case 'preview':
      return 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    case 'webm':
      return 'video/webm; codecs="vp9, opus"';
    case 'mp4':
      return 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"';
  }
}

export const getMemePool = async (req: AuthRequest, res: Response) => {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const qRaw = query.q ? String(query.q).trim() : '';
  const q = qRaw.length > 100 ? qRaw.slice(0, 100) : qRaw;
  const tagsRaw = query.tags ? String(query.tags).trim() : '';
  const tagNames = parseTagNames(tagsRaw);
  const limitRaw = query.limit ? parseInt(String(query.limit), 10) : 50;
  const offsetRaw = query.offset ? parseInt(String(query.offset), 10) : 0;
  const isAdmin = String(req.userRole || '') === 'admin';
  const channelIdRaw = query.channelId ? String(query.channelId).trim() : '';
  const channelSlugRaw = query.channelSlug ? String(query.channelSlug).trim() : '';

  let targetChannelId: string | null = channelIdRaw || null;
  if (!targetChannelId && channelSlugRaw) {
    const channel = await prisma.channel.findFirst({
      where: { slug: { equals: channelSlugRaw, mode: 'insensitive' } },
      select: { id: true },
    });
    targetChannelId = channel?.id ?? null;
  }

  const maxFromEnv = parseInt(String(process.env.SEARCH_PAGE_MAX || ''), 10);
  const MAX_PAGE = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 50;
  const limit = clampInt(limitRaw, 1, MAX_PAGE, 50);
  const offset = clampInt(offsetRaw, 0, 1_000_000, 0);

  const personalized = !!req.userId;
  if (personalized) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    // Non-personalized → allow short cache + ETag/304
    setSearchCacheHeaders(req, res);
  }

  const tagsKey = tagNames.join(',');
  const cacheKey = [
    'pool',
    'v2',
    isAdmin ? 'admin' : 'public',
    targetChannelId ?? '',
    q.toLowerCase(),
    tagsKey,
    String(limit),
    String(offset),
  ].join('|');

  if (!personalized) {
    const ttl = getSearchCacheMs();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ttl) {
      res.setHeader('ETag', cached.etag);
      if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
      return res.type('application/json').send(cached.body);
    }

    // Redis shared cache (optional)
    try {
      const rkey = nsKey('search', cacheKey);
      const body = await redisGetString(rkey);
      if (body) {
        const etag = makeEtagFromString(body);
        res.setHeader('ETag', etag);
        if (ifNoneMatchHit(req, etag)) return res.status(304).end();
        searchCache.set(cacheKey, { ts: Date.now(), body, etag });
        if (searchCache.size > SEARCH_CACHE_MAX) searchCache.clear();
        return res.type('application/json').send(body);
      }
    } catch {
      // ignore
    }
  }

  // IMPORTANT (product): pool visibility is governed by MemeAsset moderation only.
  // ChannelMeme adoption (approved/disabled/deletedAt) must NOT hide the asset from the pool.
  // Search is best-effort via historical channel titles (even if disabled).
  const where: Prisma.MemeAssetWhereInput = {
    status: 'active',
    deletedAt: null,
  };
  const visibility = buildMemeAssetVisibilityFilter({
    channelId: targetChannelId,
    userId: req.userId ?? null,
    includeUserHidden: true,
  });
  if (visibility) Object.assign(where, visibility);

  if (tagNames.length > 0) {
    where.AND = tagNames.map((tag) => ({ aiSearchText: { contains: tag, mode: 'insensitive' } }));
  }

  if (q) {
    const terms = buildSearchTerms(q);
    const searchTerms = terms.length > 0 ? terms : [q];
    where.OR = searchTerms.flatMap((term) => [
      { aiAutoTitle: { contains: term, mode: 'insensitive' } },
      { aiSearchText: { contains: term, mode: 'insensitive' } },
      {
        channelMemes: {
          some: {
            title: {
              contains: term,
              mode: 'insensitive',
            },
          },
        },
      },
    ]);
  }

  // Order by most recently created asset; later можно заменить на popularity rollups.
  const rows = await prisma.memeAsset.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    select: {
      id: true,
      type: true,
      fileUrl: true,
      durationMs: true,
      qualityScore: true,
      createdAt: true,
      aiAutoTitle: true,
      aiAutoTagNames: true,
      ...(isAdmin ? { aiStatus: true, aiAutoDescription: true } : {}),
      variants: {
        select: {
          format: true,
          fileUrl: true,
          status: true,
          priority: true,
          fileSizeBytes: true,
        },
      },
      _count: {
        select: {
          channelMemes: true,
        },
      },
      channelMemes: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          title: true,
          priceCoins: true,
          channelId: true,
        },
      },
    },
  });

  const legacyTagsById = await loadLegacyTagsById(
    rows.flatMap((row) => (Array.isArray(row.channelMemes) ? row.channelMemes.map((ch) => ch?.id ?? null) : []))
  );

  const items = rows.map((r) => {
    const aiAutoTagNames = Array.isArray(r.aiAutoTagNames)
      ? r.aiAutoTagNames.filter((tag) => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim())
      : null;
    const aiAutoTitle = typeof (r as { aiAutoTitle?: unknown }).aiAutoTitle === 'string'
      ? String((r as { aiAutoTitle?: string }).aiAutoTitle).trim()
      : null;
    const aiAutoDescription = isAdmin && typeof (r as { aiAutoDescription?: unknown }).aiAutoDescription === 'string'
      ? String((r as { aiAutoDescription?: string }).aiAutoDescription)
      : null;
    const aiStatus = isAdmin && typeof (r as { aiStatus?: unknown }).aiStatus === 'string'
      ? String((r as { aiStatus?: string }).aiStatus)
      : null;
    const doneVariants = Array.isArray(r.variants)
      ? r.variants.filter((v) => String(v.status || '') === 'done')
      : [];
    const preview = doneVariants.find((v) => String(v.format || '') === 'preview');
    const variants = doneVariants
      .filter((v) => String(v.format || '') !== 'preview')
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((v) => {
        const format = (String(v.format || '') as 'webm' | 'mp4') || 'mp4';
        return {
          format,
          fileUrl: v.fileUrl,
          sourceType: getSourceType(format),
          fileSizeBytes: typeof v.fileSizeBytes === 'bigint' ? Number(v.fileSizeBytes) : null,
        };
      });
    const legacyTags = legacyTagsById.get(r.channelMemes?.[0]?.id ?? '');
    return {
      id: r.id,
      memeAssetId: r.id,
      type: r.type,
      previewUrl: preview?.fileUrl ?? null,
      variants,
      fileUrl: variants[0]?.fileUrl ?? preview?.fileUrl ?? r.fileUrl,
      durationMs: r.durationMs,
      qualityScore: r.qualityScore ?? null,
      createdAt: r.createdAt,
      usageCount: r._count.channelMemes,
      sampleTitle: r.channelMemes?.[0]?.title ?? null,
      samplePriceCoins: r.channelMemes?.[0]?.priceCoins ?? null,
      aiAutoTitle,
      aiAutoTagNames,
      ...(isAdmin ? { aiAutoDescription, aiStatus } : {}),
      ...(legacyTags && legacyTags.length > 0 ? { tags: legacyTags } : {}),
    };
  });

  const withState = await (async () => {
    if (!req.userId || !targetChannelId || items.length === 0) return items;
    const state = await loadViewerMemeState({
      userId: req.userId,
      channelId: targetChannelId,
      memeAssetIds: items.map((item) => String(item.memeAssetId || item.id || '')).filter(Boolean),
    });
    return applyViewerMemeState(items, state);
  })();

  // Cache (best-effort)
  try {
    const body = JSON.stringify(withState);
    const etag = makeEtagFromString(body);
    if (!personalized) {
      searchCache.set(cacheKey, { ts: Date.now(), body, etag });
      if (searchCache.size > SEARCH_CACHE_MAX) searchCache.clear();
      void redisSetStringEx(nsKey('search', cacheKey), Math.ceil(getSearchCacheMs() / 1000), body);
    }
    res.setHeader('ETag', etag);
    if (ifNoneMatchHit(req, etag)) return res.status(304).end();
    return res.type('application/json').send(body);
  } catch {
    // fall through
  }

  return res.json(withState);
};
