import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { parseTagNames, resolveTagIds } from '../cache.js';
import { sendSearchResponse, type SearchContext } from './searchShared.js';

export async function handleLegacySearch(ctx: SearchContext, rawQuery: Record<string, unknown>) {
  const where: Prisma.MemeWhereInput = {
    status: 'approved',
    deletedAt: null,
  };

  if (ctx.targetChannelId) {
    where.channelId = ctx.targetChannelId;
  }

  const qRaw = rawQuery.q;
  if (qRaw) {
    const qStr = String(qRaw).trim().slice(0, 100);
    if (qStr) {
      const or: Prisma.MemeWhereInput[] = [
        { title: { contains: qStr, mode: 'insensitive' } },
        { tags: { some: { tag: { name: { contains: qStr.toLowerCase(), mode: 'insensitive' } } } } },
      ];
      if (ctx.includeUploaderEnabled) {
        or.push({ createdBy: { displayName: { contains: qStr, mode: 'insensitive' } } });
      }
      where.OR = or;
    }
  }

  if (ctx.minPrice) {
    const existing = typeof where.priceCoins === 'object' ? where.priceCoins : {};
    where.priceCoins = {
      ...existing,
      gte: parseInt(String(ctx.minPrice), 10),
    };
  }
  if (ctx.maxPrice) {
    const existing = typeof where.priceCoins === 'object' ? where.priceCoins : {};
    where.priceCoins = {
      ...existing,
      lte: parseInt(String(ctx.maxPrice), 10),
    };
  }

  if (ctx.tagsStr) {
    const tagNames = parseTagNames(ctx.tagsStr);
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
      return ctx.res.json([]);
    }
  }

  const normalizedSortOrder: Prisma.SortOrder =
    String(rawQuery.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  let orderBy: Prisma.MemeOrderByWithRelationInput = {};
  if (rawQuery.sortBy === 'priceCoins') {
    orderBy.priceCoins = normalizedSortOrder;
  } else if (rawQuery.sortBy === 'popularity') {
    orderBy.createdAt = normalizedSortOrder;
  } else {
    orderBy.createdAt = normalizedSortOrder;
  }

  const favoritesEnabled = ctx.favoritesEnabled;
  const favoritesStatuses = ['queued', 'playing', 'done', 'completed'];
  if (favoritesEnabled && !rawQuery.q && !rawQuery.tags && !ctx.minPrice && !ctx.maxPrice && rawQuery.sortBy !== 'priceCoins') {
    const rows = await prisma.memeActivation.groupBy({
      by: ['memeId'],
      where: {
        channelId: ctx.targetChannelId!,
        userId: ctx.req.userId!,
        status: { in: favoritesStatuses },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: ctx.parsedLimit,
      skip: ctx.parsedOffset,
    });

    const ids = rows.map((r) => r.memeId);
    if (ids.length === 0) return ctx.res.json([]);

    const memesById = await prisma.meme.findMany({
      where: { id: { in: ids }, status: 'approved', deletedAt: null },
      include: {
        createdBy: { select: { id: true, displayName: true } },
        tags: { include: { tag: true } },
      },
    });

    const map = new Map(memesById.map((m) => [m.id, m]));
    const ordered = ids.map((id) => map.get(id)).filter(Boolean);
    return ctx.res.json(ordered);
  }

  const popularityStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (rawQuery.sortBy === 'popularity') {
    const safeLimit = Number.isFinite(ctx.parsedLimit) && ctx.parsedLimit > 0 ? Math.min(ctx.parsedLimit, 100) : 50;
    const safeOffset = Number.isFinite(ctx.parsedOffset) && ctx.parsedOffset >= 0 ? ctx.parsedOffset : 0;
    const dir = String(rawQuery.sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const qStr = rawQuery.q ? String(rawQuery.q).trim() : '';
    const includeUploaderEnabled = ctx.includeUploaderEnabled;

    const conditions: Prisma.Sql[] = [PrismaNs.sql`m.status = 'approved'`, PrismaNs.sql`m."deletedAt" IS NULL`];
    if (ctx.targetChannelId) {
      conditions.push(PrismaNs.sql`m."channelId" = ${ctx.targetChannelId}`);
    }

    if (ctx.minPrice) {
      const v = parseInt(String(ctx.minPrice), 10);
      if (Number.isFinite(v)) conditions.push(PrismaNs.sql`m."priceCoins" >= ${v}`);
    }
    if (ctx.maxPrice) {
      const v = parseInt(String(ctx.maxPrice), 10);
      if (Number.isFinite(v)) conditions.push(PrismaNs.sql`m."priceCoins" <= ${v}`);
    }

    if (ctx.tagsStr) {
      const tagNames = parseTagNames(ctx.tagsStr);
      const tagIds = await resolveTagIds(tagNames);
      if (tagIds.length === 0) return ctx.res.json([]);

      conditions.push(
        PrismaNs.sql`EXISTS (
            SELECT 1 FROM "MemeTag" mt
            WHERE mt."memeId" = m.id AND mt."tagId" IN (${PrismaNs.join(tagIds)})
          )`
      );
    }

    if (qStr) {
      const like = `%${qStr}%`;
      const tagLike = `%${qStr.toLowerCase()}%`;
      const or: Prisma.Sql[] = [
        PrismaNs.sql`m.title ILIKE ${like}`,
        PrismaNs.sql`EXISTS (
            SELECT 1
            FROM "MemeTag" mt
            JOIN "Tag" t ON t.id = mt."tagId"
            WHERE mt."memeId" = m.id AND t.name ILIKE ${tagLike}
          )`,
      ];
      if (includeUploaderEnabled) {
        or.push(
          PrismaNs.sql`EXISTS (
              SELECT 1
              FROM "User" u
              WHERE u.id = m."createdByUserId" AND u."displayName" ILIKE ${like}
            )`
        );
      }
      conditions.push(PrismaNs.sql`(${PrismaNs.join(or, ' OR ')})`);
    }

    let rows: Array<{ id: string; pop: number }> = [];
    let fallbackToDefaultSort = false;
    try {
      if (ctx.targetChannelId) {
        rows = await prisma.$queryRaw<Array<{ id: string; pop: number }>>`
          SELECT
            m.id,
            COALESCE(s."completedActivationsCount", 0)::int AS pop
          FROM "Meme" m
          LEFT JOIN "ChannelMemeStats30d" s
            ON s."channelId" = m."channelId"
           AND s."memeId" = m.id
          WHERE ${PrismaNs.join(conditions, ' AND ')}
          ORDER BY pop ${PrismaNs.raw(dir)}, m."createdAt" ${PrismaNs.raw(dir)}
          LIMIT ${safeLimit} OFFSET ${safeOffset}
        `;
      } else {
        rows = await prisma.$queryRaw<Array<{ id: string; pop: number }>>`
          SELECT
            m.id,
            COALESCE(s."completedActivationsCount", 0)::int AS pop
          FROM "Meme" m
          LEFT JOIN "GlobalMemeStats30d" s
            ON s."memeId" = m.id
          WHERE ${PrismaNs.join(conditions, ' AND ')}
          ORDER BY pop ${PrismaNs.raw(dir)}, m."createdAt" ${PrismaNs.raw(dir)}
          LIMIT ${safeLimit} OFFSET ${safeOffset}
        `;
      }
    } catch (error) {
      const prismaError = error as { code?: string };
      if (prismaError.code === 'P2021') {
        if (ctx.targetChannelId) {
          rows = await prisma.$queryRaw<Array<{ id: string; pop: number }>>`
            SELECT
              m.id,
              COALESCE(COUNT(a.id), 0)::int AS pop
            FROM "Meme" m
            LEFT JOIN "MemeActivation" a
              ON a."memeId" = m.id
             AND a."channelId" = ${ctx.targetChannelId}
             AND a.status IN ('done', 'completed')
             AND a."createdAt" >= ${popularityStartDate}
            WHERE ${PrismaNs.join(conditions, ' AND ')}
            GROUP BY m.id, m."createdAt"
            ORDER BY pop ${PrismaNs.raw(dir)}, m."createdAt" ${PrismaNs.raw(dir)}
            LIMIT ${safeLimit} OFFSET ${safeOffset}
          `;
        } else {
          fallbackToDefaultSort = true;
        }
      } else {
        throw error;
      }
    }

    if (!fallbackToDefaultSort) {
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return ctx.res.json([]);

      const byId = await prisma.meme.findMany({
        where: { id: { in: ids }, status: 'approved', ...(ctx.targetChannelId ? { channelId: ctx.targetChannelId } : {}) },
        include: {
          createdBy: { select: { id: true, displayName: true } },
          tags: { include: { tag: true } },
        },
      });

      const map = new Map(byId.map((m) => [m.id, m]));
      const popById = new Map(rows.map((r) => [r.id, r.pop]));
      const ordered = ids
        .map((id) => {
          const item = map.get(id);
          if (!item) return null;
          return Object.assign(item, { _count: { activations: popById.get(id) ?? 0 } });
        })
        .filter((item): item is (typeof byId)[number] & { _count: { activations: number } } => item !== null);
      return sendSearchResponse(ctx.req, ctx.res, ordered);
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
            rawQuery.sortBy === 'popularity'
              ? { where: { status: { in: ['done', 'completed'] }, createdAt: { gte: popularityStartDate } } }
              : true,
        },
      },
    },
    orderBy,
    take: ctx.parsedLimit,
    skip: ctx.parsedOffset,
  });

  if (favoritesEnabled) {
    const counts = await prisma.memeActivation.groupBy({
      by: ['memeId'],
      where: {
        channelId: ctx.targetChannelId!,
        userId: ctx.req.userId!,
        status: { in: favoritesStatuses },
        memeId: { in: memes.map((m) => m.id) },
      },
      _count: { id: true },
    });
    const byId = new Map(counts.map((c) => [c.memeId, c._count.id]));
    memes.sort((a, b) => (byId.get(b.id) || 0) - (byId.get(a.id) || 0));
  }

  if (!favoritesEnabled) {
    return sendSearchResponse(ctx.req, ctx.res, memes);
  }
  return ctx.res.json(memes);
}
