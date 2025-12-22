import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  clampInt,
  getSearchCacheMs,
  ifNoneMatchHit,
  makeEtagFromString,
  parseTagNames,
  resolveTagIds,
  SEARCH_CACHE_MAX,
  searchCache,
  setSearchCacheHeaders,
} from './cache.js';

export const searchMemes = async (req: any, res: Response) => {
  const {
    q, // search query
    tags, // comma-separated tag names
    channelId,
    channelSlug,
    minPrice,
    maxPrice,
    sortBy = 'createdAt', // createdAt, priceCoins, popularity
    sortOrder = 'desc', // asc, desc
    includeUploader, // "1" enables searching by uploader name (dashboard only)
    favorites, // "1" returns user's most activated memes for this channel (requires auth)
    limit = 50,
    offset = 0,
  } = req.query;

  // Determine channel
  let targetChannelId: string | null = null;
  if (channelSlug) {
    const channel = await prisma.channel.findUnique({
      where: { slug: channelSlug as string },
      select: { id: true },
    });
    if (channel) {
      targetChannelId = channel.id;
    }
  } else if (channelId) {
    targetChannelId = channelId as string;
  }

  // Build where clause
  const where: any = {
    status: 'approved',
  };

  if (targetChannelId) {
    where.channelId = targetChannelId;
  }

  const favoritesEnabled = String(favorites || '') === '1' && !!req.userId && !!targetChannelId;

  // Pagination clamp (defensive): prevent expensive wide scans and large payloads.
  const parsedLimitRaw = parseInt(limit as string, 10);
  const parsedOffsetRaw = parseInt(offset as string, 10);
  const maxSearchFromEnv = parseInt(String(process.env.SEARCH_PAGE_MAX || ''), 10);
  const MAX_SEARCH_PAGE = Number.isFinite(maxSearchFromEnv) && maxSearchFromEnv > 0 ? maxSearchFromEnv : 50;
  const parsedLimit = clampInt(parsedLimitRaw, 1, MAX_SEARCH_PAGE, 50);
  const parsedOffset = clampInt(parsedOffsetRaw, 0, 1_000_000, 0);

  // Caching:
  // - favorites=1 is personalized -> no-store
  // - otherwise: short cache + ETag/304 (safe: response not personalized)
  if (favoritesEnabled) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    setSearchCacheHeaders(req, res);
    const qStr = q ? String(q).trim().slice(0, 100) : '';
    const tagsKey = parseTagNames(tags).join(',');
    const cacheKey = [
      'v1',
      targetChannelId ?? '',
      qStr.toLowerCase(),
      tagsKey,
      String(minPrice ?? ''),
      String(maxPrice ?? ''),
      String(sortBy ?? ''),
      String(sortOrder ?? ''),
      String(includeUploader ?? ''),
      String(parsedLimit),
      String(parsedOffset),
    ].join('|');

    const ttl = getSearchCacheMs();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ttl) {
      res.setHeader('ETag', cached.etag);
      if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
      return res.type('application/json').send(cached.body);
    }
    // Save for later in the request lifecycle (after we compute the response).
    (req as any).__searchCacheKey = cacheKey;
  }

  // Search query - search in title + tags; optionally uploader (dashboard)
  if (q) {
    const qStr = String(q).trim().slice(0, 100);
    if (qStr) {
      const or: any[] = [
        { title: { contains: qStr, mode: 'insensitive' } },
        { tags: { some: { tag: { name: { contains: qStr.toLowerCase(), mode: 'insensitive' } } } } },
      ];
      if (String(includeUploader || '') === '1') {
        or.push({ createdBy: { displayName: { contains: qStr, mode: 'insensitive' } } });
      }
      where.OR = or;
    }
  }

  // Price filters (optional)
  if (minPrice) {
    where.priceCoins = {
      ...where.priceCoins,
      gte: parseInt(minPrice as string, 10),
    };
  }
  if (maxPrice) {
    where.priceCoins = {
      ...where.priceCoins,
      lte: parseInt(maxPrice as string, 10),
    };
  }

  // Tag filters
  if (tags) {
    const tagNames = parseTagNames(tags);
    const tagIds = await resolveTagIds(tagNames);
    if (tagIds.length > 0) {
      where.tags = {
        some: {
          tagId: {
            in: tagIds,
          },
        },
      };
    } else {
      // If no tags found, return empty result
      return res.json([]);
    }
  }

  // Build orderBy
  let orderBy: any = {};
  if (sortBy === 'priceCoins') {
    orderBy.priceCoins = sortOrder;
  } else if (sortBy === 'popularity') {
    // Popularity = number of activations
    // We'll need to join with activations and count
    // For now, use createdAt as fallback
    orderBy.createdAt = sortOrder;
  } else {
    orderBy.createdAt = sortOrder;
  }

  // Execute query (clamped above)

  // "My favorites": order by the user's activation count for this channel.
  // We intentionally include in-progress activations (queued/playing) so the list is useful immediately
  // after a user activates a meme (otherwise it would stay empty until the activation completes).
  const favoritesStatuses = ['queued', 'playing', 'done', 'completed'];
  if (favoritesEnabled && !q && !tags && !minPrice && !maxPrice && sortBy !== 'priceCoins') {
    const rows = await prisma.memeActivation.groupBy({
      by: ['memeId'],
      where: {
        channelId: targetChannelId!,
        userId: req.userId!,
        status: { in: favoritesStatuses },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: parsedLimit,
      skip: parsedOffset,
    });

    const ids = rows.map((r) => r.memeId);
    if (ids.length === 0) return res.json([]);

    const memesById = await prisma.meme.findMany({
      where: { id: { in: ids }, status: 'approved' },
      include: {
        createdBy: { select: { id: true, displayName: true } },
        tags: { include: { tag: true } },
      },
    });

    const map = new Map(memesById.map((m) => [m.id, m]));
    const ordered = ids.map((id) => map.get(id)).filter(Boolean);
    // favorites is personalized; keep default JSON response.
    return res.json(ordered);
  }

  const popularityStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Popularity sorting: do it in DB so pagination is correct and we don't sort huge lists in memory.
  // This is only enabled when a targetChannelId is known (most common case); otherwise fall back to createdAt.
  if (sortBy === 'popularity' && targetChannelId) {
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 50;
    const safeOffset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
    const dir = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const qStr = q ? String(q).trim() : '';
    const includeUploaderEnabled = String(includeUploader || '') === '1';

    const conditions: Prisma.Sql[] = [Prisma.sql`m.status = 'approved'`, Prisma.sql`m."channelId" = ${targetChannelId}`];

    // Price filters (optional)
    if (minPrice) {
      const v = parseInt(minPrice as string, 10);
      if (Number.isFinite(v)) conditions.push(Prisma.sql`m."priceCoins" >= ${v}`);
    }
    if (maxPrice) {
      const v = parseInt(maxPrice as string, 10);
      if (Number.isFinite(v)) conditions.push(Prisma.sql`m."priceCoins" <= ${v}`);
    }

    // Tag filters (optional): any tag match (same semantics as Prisma "some")
    if (tags) {
      const tagNames = parseTagNames(tags);
      const tagIds = await resolveTagIds(tagNames);
      if (tagIds.length === 0) return res.json([]);

      conditions.push(
        Prisma.sql`EXISTS (
            SELECT 1 FROM "MemeTag" mt
            WHERE mt."memeId" = m.id AND mt."tagId" IN (${Prisma.join(tagIds)})
          )`
      );
    }

    // Search query (optional): title OR tag name OR uploader displayName
    if (qStr) {
      const like = `%${qStr}%`;
      const tagLike = `%${qStr.toLowerCase()}%`;
      const or: Prisma.Sql[] = [
        Prisma.sql`m.title ILIKE ${like}`,
        Prisma.sql`EXISTS (
            SELECT 1
            FROM "MemeTag" mt
            JOIN "Tag" t ON t.id = mt."tagId"
            WHERE mt."memeId" = m.id AND t.name ILIKE ${tagLike}
          )`,
      ];
      if (includeUploaderEnabled) {
        or.push(
          Prisma.sql`EXISTS (
              SELECT 1
              FROM "User" u
              WHERE u.id = m."createdByUserId" AND u."displayName" ILIKE ${like}
            )`
        );
      }
      // Prisma.join typing differs across client versions; keep separator as plain string for TS compatibility.
      conditions.push(Prisma.sql`(${Prisma.join(or, ' OR ')})`);
    }

    // Rank memes by activation count in the last 30 days for this channel.
    // Include memes with 0 activations (they come after popular ones, tie-broken by createdAt).
    const rows = await prisma.$queryRaw<Array<{ id: string; pop: number }>>`
        SELECT
          m.id,
          COALESCE(COUNT(a.id), 0)::int AS pop
        FROM "Meme" m
        LEFT JOIN "MemeActivation" a
          ON a."memeId" = m.id
         AND a."channelId" = ${targetChannelId}
         AND a.status IN ('done', 'completed')
         AND a."createdAt" >= ${popularityStartDate}
        WHERE ${Prisma.join(conditions, ' AND ')}
        GROUP BY m.id, m."createdAt"
        ORDER BY pop ${Prisma.raw(dir)}, m."createdAt" ${Prisma.raw(dir)}
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `;

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return res.json([]);

    const activationWhere = {
      channelId: targetChannelId,
      status: { in: ['done', 'completed'] as string[] },
      createdAt: { gte: popularityStartDate },
    };

    const byId = await prisma.meme.findMany({
      where: { id: { in: ids }, status: 'approved', channelId: targetChannelId },
      include: {
        createdBy: { select: { id: true, displayName: true } },
        tags: { include: { tag: true } },
        _count: { select: { activations: { where: activationWhere } } },
      },
    });

    const map = new Map(byId.map((m) => [m.id, m]));
    const ordered = ids.map((id) => map.get(id)).filter(Boolean);
    // Cache non-personalized responses (best-effort)
    try {
      const body = JSON.stringify(ordered);
      const etag = makeEtagFromString(body);
      const cacheKey = (req as any).__searchCacheKey as string | undefined;
      if (cacheKey) {
        searchCache.set(cacheKey, { ts: Date.now(), body, etag });
        if (searchCache.size > SEARCH_CACHE_MAX) searchCache.clear();
      }
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) return res.status(304).end();
      return res.type('application/json').send(body);
    } catch {
      return res.json(ordered);
    }
  }

  const memes = await prisma.meme.findMany({
    where,
    include: {
      createdBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
      _count: {
        select: {
          activations:
            sortBy === 'popularity'
              ? { where: { status: { in: ['done', 'completed'] }, createdAt: { gte: popularityStartDate } } }
              : true,
        },
      },
    },
    orderBy,
    take: parsedLimit,
    skip: parsedOffset,
  });

  // If favorites is enabled along with other filters, sort in-memory by user's activation count (done) as a best-effort.
  if (favoritesEnabled) {
    const counts = await prisma.memeActivation.groupBy({
      by: ['memeId'],
      where: {
        channelId: targetChannelId!,
        userId: req.userId!,
        status: { in: favoritesStatuses },
        memeId: { in: memes.map((m: any) => m.id) },
      },
      _count: { id: true },
    });
    const byId = new Map(counts.map((c) => [c.memeId, c._count.id]));
    memes.sort((a: any, b: any) => (byId.get(b.id) || 0) - (byId.get(a.id) || 0));
  }

  // Cache non-personalized responses (best-effort)
  if (!favoritesEnabled) {
    try {
      const body = JSON.stringify(memes);
      const etag = makeEtagFromString(body);
      const cacheKey = (req as any).__searchCacheKey as string | undefined;
      if (cacheKey) {
        searchCache.set(cacheKey, { ts: Date.now(), body, etag });
        if (searchCache.size > SEARCH_CACHE_MAX) searchCache.clear();
      }
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) return res.status(304).end();
      return res.type('application/json').send(body);
    } catch {
      // fall through
    }
  }
  return res.json(memes);
};


