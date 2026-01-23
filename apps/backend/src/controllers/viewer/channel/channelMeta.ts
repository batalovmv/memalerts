import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../../../middleware/auth.js';
import { prisma } from '../../../lib/prisma.js';
import {
  channelMetaCache,
  getChannelMetaCacheMs,
  setChannelMetaCacheHeaders,
  makeEtagFromString,
  ifNoneMatchHit,
  CHANNEL_META_CACHE_MAX,
  pruneOldestEntries,
} from '../cache.js';
import { nsKey, redisGetString, redisSetStringEx } from '../../../utils/redisCache.js';
import { normalizeDashboardCardOrder } from '../../../utils/dashboardCardOrder.js';
import { getSourceType, loadLegacyTagsById, toChannelMemeListItemDto } from '../channelMemeListDto.js';
import type { ChannelMemeRow, ChannelResponse, ChannelWithOwner, PoolAssetRow } from './shared.js';

export const getChannelBySlug = async (req: AuthRequest, res: Response) => {
  const slug = String(req.params.slug || '').trim();
  const includeMemes = req.query.includeMemes !== 'false';

  const limitRaw = req.query.limit as string | undefined;
  const offsetRaw = req.query.offset as string | undefined;
  const sortByRaw = String(req.query.sortBy || '').trim();
  const sortOrderRaw = String(req.query.sortOrder || '')
    .trim()
    .toLowerCase();
  const maxFromEnv = parseInt(String(process.env.CHANNEL_MEMES_MAX || ''), 10);
  const MAX_MEMES = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 200;
  const requestedLimit = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined;
  const requestedOffset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : undefined;
  const memesLimit = includeMemes
    ? Math.min(
        MAX_MEMES,
        Number.isFinite(requestedLimit as number) && (requestedLimit as number) > 0
          ? (requestedLimit as number)
          : MAX_MEMES
      )
    : 0;
  const memesOffset =
    includeMemes && Number.isFinite(requestedOffset as number) && (requestedOffset as number) > 0
      ? (requestedOffset as number)
      : 0;

  const sortBy = sortByRaw === 'priceCoins' ? 'priceCoins' : 'createdAt';
  const sortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';
  const orderBy =
    sortBy === 'priceCoins'
      ? [{ priceCoins: sortOrder }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: sortOrder }, { id: 'desc' as const }];

  const cacheKey = String(slug || '')
    .trim()
    .toLowerCase();
  const canCacheMeta = !req?.userId;
  if (!includeMemes) {
    if (canCacheMeta) {
      setChannelMetaCacheHeaders(req, res);
      const cached = channelMetaCache.get(cacheKey);
      const ttl = getChannelMetaCacheMs();
      if (cached && Date.now() - cached.ts < ttl) {
        if (cached.etag) res.setHeader('ETag', cached.etag);
        if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
        return res.json(cached.data);
      }

      try {
        const rkey = nsKey('channel_meta', cacheKey);
        const body = await redisGetString(rkey);
        if (body) {
          const etag = makeEtagFromString(body);
          res.setHeader('ETag', etag);
          if (ifNoneMatchHit(req, etag)) return res.status(304).end();
          return res.type('application/json').send(body);
        }
      } catch {
        // ignore
      }
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }

  try {
    const channel = (await prisma.channel.findFirst({
      where: {
        slug: {
          equals: slug,
          mode: 'insensitive',
        },
      },
      include: {
        users: {
          take: 5,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            displayName: true,
            profileImageUrl: true,
            role: true,
          },
        },
        _count: {
          select: {
            channelMemes: { where: { status: 'approved', deletedAt: null } },
            users: true,
          },
        },
      },
    })) as ChannelWithOwner;

    if (!channel) {
      return res
        .status(404)
        .json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });
    }

    const owner =
      channel.users?.find((u) => u.role === 'streamer') ||
      channel.users?.find((u) => u.role === 'admin') ||
      channel.users?.[0] ||
      null;
    const memeCatalogMode = String(channel.memeCatalogMode || 'channel');
    const rawDashboardCardOrder = channel.dashboardCardOrder ?? null;
    const dashboardCardOrder =
      rawDashboardCardOrder === null ? null : normalizeDashboardCardOrder(rawDashboardCardOrder);
    const response: ChannelResponse = {
      id: channel.id,
      slug: channel.slug,
      name: channel.name,
      memeCatalogMode,
      coinPerPointRatio: channel.coinPerPointRatio,
      overlayMode: channel.overlayMode ?? 'queue',
      overlayShowSender: channel.overlayShowSender ?? false,
      overlayMaxConcurrent: channel.overlayMaxConcurrent ?? 3,
      rewardIdForCoins: channel.rewardIdForCoins ?? null,
      rewardEnabled: channel.rewardEnabled ?? false,
      rewardTitle: channel.rewardTitle ?? null,
      rewardCost: channel.rewardCost ?? null,
      rewardCoins: channel.rewardCoins ?? null,
      rewardOnlyWhenLive: channel.rewardOnlyWhenLive ?? false,
      kickRewardEnabled: channel.kickRewardEnabled ?? false,
      kickRewardIdForCoins: channel.kickRewardIdForCoins ?? null,
      kickCoinPerPointRatio: channel.kickCoinPerPointRatio ?? 1.0,
      kickRewardCoins: channel.kickRewardCoins ?? null,
      kickRewardOnlyWhenLive: channel.kickRewardOnlyWhenLive ?? false,
      trovoManaCoinsPerUnit: channel.trovoManaCoinsPerUnit ?? 0,
      trovoElixirCoinsPerUnit: channel.trovoElixirCoinsPerUnit ?? 0,
      vkvideoRewardEnabled: channel.vkvideoRewardEnabled ?? false,
      vkvideoRewardIdForCoins: channel.vkvideoRewardIdForCoins ?? null,
      vkvideoCoinPerPointRatio: channel.vkvideoCoinPerPointRatio ?? 1.0,
      vkvideoRewardCoins: channel.vkvideoRewardCoins ?? null,
      vkvideoRewardOnlyWhenLive: channel.vkvideoRewardOnlyWhenLive ?? false,
      youtubeLikeRewardEnabled: channel.youtubeLikeRewardEnabled ?? false,
      youtubeLikeRewardCoins: channel.youtubeLikeRewardCoins ?? 0,
      youtubeLikeRewardOnlyWhenLive: channel.youtubeLikeRewardOnlyWhenLive ?? false,
      submissionRewardCoins: channel.submissionRewardCoins ?? 0,
      submissionRewardOnlyWhenLive: channel.submissionRewardOnlyWhenLive ?? false,
      submissionsEnabled: channel.submissionsEnabled ?? true,
      submissionsOnlyWhenLive: channel.submissionsOnlyWhenLive ?? false,
      coinIconUrl: channel.coinIconUrl ?? null,
      primaryColor: channel.primaryColor ?? null,
      secondaryColor: channel.secondaryColor ?? null,
      accentColor: channel.accentColor ?? null,
      dashboardCardOrder,
      createdAt: channel.createdAt,
      owner: owner
        ? {
            id: owner.id,
            displayName: owner.displayName,
            profileImageUrl: owner.profileImageUrl,
          }
        : null,
      stats: {
        memesCount: channel._count.channelMemes,
        usersCount: channel._count.users,
      },
    };

    if (includeMemes) {
      if (memeCatalogMode === 'pool_all') {
        const poolWhere: Prisma.MemeAssetWhereInput = {
          poolVisibility: 'visible',
          purgedAt: null,
          fileUrl: { not: null },
          NOT: {
            channelMemes: {
              some: {
                channelId: channel.id,
                OR: [{ status: { not: 'approved' } }, { deletedAt: { not: null } }],
              },
            },
          },
        };

        const poolCount = await prisma.memeAsset.count({ where: poolWhere });
        response.stats.memesCount = poolCount;

        const rows = await prisma.memeAsset.findMany({
          where: poolWhere,
          orderBy: { createdAt: sortOrder },
          take: memesLimit,
          skip: memesOffset,
          select: {
            id: true,
            type: true,
            fileUrl: true,
            fileHash: true,
            durationMs: true,
            variants: {
              select: {
                format: true,
                fileUrl: true,
                status: true,
                priority: true,
                fileSizeBytes: true,
              },
            },
            createdAt: true,
            aiAutoTitle: true,
            createdBy: { select: { id: true, displayName: true } },
            channelMemes: {
              where: { channelId: channel.id, status: 'approved', deletedAt: null },
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: { title: true, priceCoins: true },
            },
          },
        });

        const defaultPriceCoins = Number.isFinite(channel.defaultPriceCoins) ? channel.defaultPriceCoins : 100;
        response.memes = (rows as PoolAssetRow[]).map((r) => {
          const ch = Array.isArray(r.channelMemes) && r.channelMemes.length > 0 ? r.channelMemes[0] : null;
          const title = String(ch?.title || r.aiAutoTitle || 'Meme').slice(0, 200);
          const channelPrice = ch?.priceCoins;
          const priceCoins = Number.isFinite(channelPrice) ? (channelPrice as number) : defaultPriceCoins;
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
          return {
            id: r.id,
            channelId: channel.id,
            channelMemeId: r.id,
            memeAssetId: r.id,
            title,
            type: r.type,
            previewUrl: preview?.fileUrl ?? null,
            variants,
            fileUrl: variants[0]?.fileUrl ?? preview?.fileUrl ?? r.fileUrl ?? null,
            durationMs: r.durationMs,
            priceCoins,
            status: 'approved',
            deletedAt: null,
            createdAt: r.createdAt,
            createdBy: r.createdBy ? { id: r.createdBy.id, displayName: r.createdBy.displayName } : null,
            fileHash: null,
          };
        });
        response.memesPage = {
          limit: memesLimit,
          offset: memesOffset,
          returned: Array.isArray(response.memes) ? response.memes.length : 0,
          total: poolCount,
        };
      } else {
        const rows = await prisma.channelMeme.findMany({
          where: { channelId: channel.id, status: 'approved', deletedAt: null },
          orderBy: orderBy as Prisma.ChannelMemeOrderByWithRelationInput[],
          take: memesLimit,
          skip: memesOffset,
          select: {
            id: true,
            legacyMemeId: true,
            memeAssetId: true,
            title: true,
            priceCoins: true,
            status: true,
            createdAt: true,
            memeAsset: {
              select: {
                type: true,
                fileUrl: true,
                fileHash: true,
                durationMs: true,
                variants: {
                  select: {
                    format: true,
                    fileUrl: true,
                    status: true,
                    priority: true,
                    fileSizeBytes: true,
                  },
                },
                aiStatus: true,
                aiAutoTitle: true,
                createdBy: { select: { id: true, displayName: true } },
              },
            },
          },
        });

        const legacyTagsById = await loadLegacyTagsById((rows as ChannelMemeRow[]).map((r) => r.legacyMemeId));
        response.memes = (rows as ChannelMemeRow[]).map((r) => {
          const item = toChannelMemeListItemDto(req, channel.id, r);
          const tags = legacyTagsById.get(r.legacyMemeId ?? '');
          return tags && tags.length > 0 ? { ...item, tags } : item;
        });
        response.memesPage = {
          limit: memesLimit,
          offset: memesOffset,
          returned: Array.isArray(response.memes) ? response.memes.length : 0,
          total: channel._count.channelMemes,
        };
      }
    }

    if (!includeMemes && canCacheMeta) {
      const body = JSON.stringify(response);
      const etag = makeEtagFromString(body);
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) {
        channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
        pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
        void redisSetStringEx(nsKey('channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
        return res.status(304).end();
      }
      channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
      pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
      void redisSetStringEx(nsKey('channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
      return res.type('application/json').send(body);
    }

    res.json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    if (message && message.includes('does not exist')) {
      const channel = (await prisma.$queryRaw`
          SELECT id, slug, name, "coinPerPointRatio", "createdAt"
          FROM "Channel"
          WHERE slug = ${slug}
        `) as Array<{ id: string; slug: string; name: string; coinPerPointRatio: number | null; createdAt: Date }>;

      if (!channel || channel.length === 0) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const memes = await prisma.meme.findMany({
        where: {
          channelId: channel[0].id,
          status: 'approved',
        },
        orderBy: { createdAt: 'desc' },
        take: includeMemes ? memesLimit : undefined,
        skip: includeMemes ? memesOffset : undefined,
        select: {
          id: true,
          title: true,
          type: true,
          fileUrl: true,
          durationMs: true,
          priceCoins: true,
          createdAt: true,
        },
      });

      const memesCount = await prisma.meme.count({
        where: {
          channelId: channel[0].id,
          status: 'approved',
        },
      });

      const usersCount = await prisma.user.count({
        where: { channelId: channel[0].id },
      });

      const response: ChannelResponse = {
        id: channel[0].id,
        slug: channel[0].slug,
        name: channel[0].name,
        memeCatalogMode: 'channel',
        coinPerPointRatio: channel[0].coinPerPointRatio,
        overlayMode: 'queue',
        overlayShowSender: false,
        overlayMaxConcurrent: 3,
        rewardIdForCoins: null,
        rewardEnabled: false,
        rewardTitle: null,
        rewardCost: null,
        rewardCoins: null,
        rewardOnlyWhenLive: false,
        kickRewardEnabled: false,
        kickRewardIdForCoins: null,
        kickCoinPerPointRatio: 1.0,
        kickRewardCoins: null,
        kickRewardOnlyWhenLive: false,
        trovoManaCoinsPerUnit: 0,
        trovoElixirCoinsPerUnit: 0,
        vkvideoRewardEnabled: false,
        vkvideoRewardIdForCoins: null,
        vkvideoCoinPerPointRatio: 1.0,
        vkvideoRewardCoins: null,
        vkvideoRewardOnlyWhenLive: false,
        youtubeLikeRewardEnabled: false,
        youtubeLikeRewardCoins: 0,
        youtubeLikeRewardOnlyWhenLive: false,
        submissionRewardCoins: 0,
        submissionRewardOnlyWhenLive: false,
        submissionsEnabled: true,
        submissionsOnlyWhenLive: false,
        coinIconUrl: null,
        primaryColor: null,
        secondaryColor: null,
        accentColor: null,
        dashboardCardOrder: null,
        createdAt: channel[0].createdAt,
        owner: null,
        stats: {
          memesCount,
          usersCount,
        },
      };

      if (includeMemes) {
        response.memes = memes;
        response.memesPage = {
          limit: memesLimit,
          offset: memesOffset,
          returned: Array.isArray(memes) ? memes.length : 0,
          total: memesCount,
        };
      }

      if (!includeMemes && canCacheMeta) {
        setChannelMetaCacheHeaders(req, res);
        const body = JSON.stringify(response);
        const etag = makeEtagFromString(body);
        res.setHeader('ETag', etag);
        channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
        pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
        void redisSetStringEx(nsKey('channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
        if (ifNoneMatchHit(req, etag)) return res.status(304).end();
        return res.type('application/json').send(body);
      }
      return res.json(response);
    }
    throw error;
  }
};
