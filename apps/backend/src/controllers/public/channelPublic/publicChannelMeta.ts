import type { AuthRequest } from '../../../middleware/auth.js';
import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  channelMetaCache,
  getChannelMetaCacheMs,
  ifNoneMatchHit,
  makeEtagFromString,
  pruneOldestEntries,
  setChannelMetaCacheHeaders,
  CHANNEL_META_CACHE_MAX,
} from '../../viewer/cache.js';
import { nsKey, redisGetString, redisSetStringEx } from '../../../utils/redisCache.js';
import {
  buildChannelMemeWhere,
  buildChannelPoolWhere,
  buildListOrderings,
  mapPoolAssetsToDtos,
  type PublicChannelMetaQuery,
  type PublicChannelResponse,
} from './shared.js';
import { toPublicChannelMemeListItemDto } from '../dto/publicChannelMemeListItemDto.js';
import { loadLegacyTagsById } from '../../viewer/channelMemeListDto.js';
import {
  applyDynamicPricingToItems,
  collectChannelMemeIds,
  loadDynamicPricingSnapshot,
  normalizeDynamicPricingSettings,
} from '../../../services/meme/dynamicPricing.js';

export const getPublicChannelBySlug = async (req: AuthRequest, res: Response) => {
  const query = req.query as PublicChannelMetaQuery;
  const slug = String(req.params.slug || '').trim();
  const includeMemes = String(query.includeMemes || '').toLowerCase() === 'true';

  const limitRaw = query.limit;
  const offsetRaw = query.offset;
  const sortByRaw = String(query.sortBy || '').trim();
  const sortOrderRaw = String(query.sortOrder || '')
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
  const sortOrder: Prisma.SortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';
  const orderings = buildListOrderings(sortBy, sortOrder);

  const cacheKey = String(slug || '')
    .trim()
    .toLowerCase();
  const canCacheMeta = !req.userId;
  if (!includeMemes && canCacheMeta) {
    setChannelMetaCacheHeaders(req, res);
    const cached = channelMetaCache.get(cacheKey);
    const ttl = getChannelMetaCacheMs();
    if (cached && Date.now() - cached.ts < ttl) {
      if (cached.etag) res.setHeader('ETag', cached.etag);
      if (ifNoneMatchHit(req, cached.etag)) return res.status(304).end();
      return res.json(cached.data);
    }

    try {
      const rkey = nsKey('public_channel_meta', cacheKey);
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
  } else if (!includeMemes && !canCacheMeta) {
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  }

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: {
      id: true,
      slug: true,
      name: true,
      coinIconUrl: true,
      primaryColor: true,
      secondaryColor: true,
      accentColor: true,
      rewardTitle: true,
      rewardOnlyWhenLive: true,
      submissionRewardCoins: true,
      submissionRewardOnlyWhenLive: true,
      submissionsEnabled: true,
      submissionsOnlyWhenLive: true,
      memeCatalogMode: true,
      defaultPriceCoins: true,
      dynamicPricingEnabled: true,
      dynamicPricingMinMult: true,
      dynamicPricingMaxMult: true,
      users: {
        take: 5,
        orderBy: { createdAt: 'asc' },
        select: { id: true, displayName: true, profileImageUrl: true, role: true },
      },
      _count: {
        select: {
          channelMemes: { where: { status: 'approved', deletedAt: null } },
          users: true,
        },
      },
    },
  });

  if (!channel) {
    return res
      .status(404)
      .json({ errorCode: 'CHANNEL_NOT_FOUND', error: 'Channel not found', details: { entity: 'channel', slug } });
  }

  const owner =
    channel.users.find((u) => u.role === 'streamer') ||
    channel.users.find((u) => u.role === 'admin') ||
    channel.users[0] ||
    null;
  const memeCatalogMode = channel.memeCatalogMode ?? 'channel';
  const defaultPriceCoins = Number.isFinite(channel.defaultPriceCoins ?? NaN) ? (channel.defaultPriceCoins ?? 0) : 100;
  const response: PublicChannelResponse = {
    id: channel.id,
    slug: channel.slug,
    name: channel.name,
    coinIconUrl: channel.coinIconUrl,
    primaryColor: channel.primaryColor,
    secondaryColor: channel.secondaryColor,
    accentColor: channel.accentColor,
    rewardTitle: channel.rewardTitle,
    rewardOnlyWhenLive: channel.rewardOnlyWhenLive,
    submissionRewardCoins: Number.isFinite(channel.submissionRewardCoins ?? NaN)
      ? (channel.submissionRewardCoins ?? 0)
      : 0,
    submissionRewardOnlyWhenLive: channel.submissionRewardOnlyWhenLive,
    submissionsEnabled: channel.submissionsEnabled,
    submissionsOnlyWhenLive: channel.submissionsOnlyWhenLive,
    owner: owner ? { id: owner.id, displayName: owner.displayName, profileImageUrl: owner.profileImageUrl } : null,
    stats: {
      memesCount: channel._count.channelMemes,
      usersCount: channel._count.users,
    },
  };

  if (includeMemes) {
    if (memeCatalogMode === 'pool_all') {
      const poolWhere = buildChannelPoolWhere(channel.id);
      const poolCount = await prisma.memeAsset.count({ where: poolWhere });
      response.stats.memesCount = poolCount;

      const rows = await prisma.memeAsset.findMany({
        where: poolWhere,
        orderBy: orderings.memeAsset,
        take: memesLimit,
        skip: memesOffset,
        select: {
          id: true,
          type: true,
          fileUrl: true,
          durationMs: true,
          qualityScore: true,
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
          aiAutoTagNamesJson: true,
          createdBy: { select: { id: true, displayName: true } },
          channelMemes: {
            where: { channelId: channel.id, status: 'approved', deletedAt: null },
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              title: true,
              priceCoins: true,
              legacyMemeId: true,
              cooldownMinutes: true,
              lastActivatedAt: true,
              _count: {
                select: {
                  activations: {
                    where: { status: 'done' },
                  },
                },
              },
            },
          },
        },
      });

      const legacyTagsById = await loadLegacyTagsById(rows.map((row) => row.channelMemes?.[0]?.legacyMemeId ?? null));
      response.memes = mapPoolAssetsToDtos(rows, channel.id, defaultPriceCoins).map((item, idx) => {
        const legacyId = rows[idx]?.channelMemes?.[0]?.legacyMemeId ?? '';
        const tags = legacyTagsById.get(legacyId);
        return tags && tags.length > 0 ? { ...item, tags } : item;
      });
      if (response.memes.length > 0) {
        const dynamicSettings = normalizeDynamicPricingSettings(channel);
        const snapshot = await loadDynamicPricingSnapshot({
          channelId: channel.id,
          channelMemeIds: collectChannelMemeIds(response.memes as Array<Record<string, unknown>>),
          settings: dynamicSettings,
        });
        response.memes = applyDynamicPricingToItems(
          response.memes as Array<Record<string, unknown>>,
          snapshot,
        ) as typeof response.memes;
      }
      response.memesPage = {
        limit: memesLimit,
        offset: memesOffset,
        returned: response.memes.length,
        total: poolCount,
      };
    } else {
      const channelRows = await prisma.channelMeme.findMany({
        where: buildChannelMemeWhere(channel.id),
        orderBy: orderings.channelMeme,
        take: memesLimit,
        skip: memesOffset,
        select: {
          id: true,
          legacyMemeId: true,
          memeAssetId: true,
          title: true,
          priceCoins: true,
          cooldownMinutes: true,
          lastActivatedAt: true,
          aiAutoTagNamesJson: true,
          status: true,
          createdAt: true,
          memeAsset: {
            select: {
              type: true,
              fileUrl: true,
              durationMs: true,
              qualityScore: true,
              variants: {
                select: {
                  format: true,
                  fileUrl: true,
                  status: true,
                  priority: true,
                  fileSizeBytes: true,
                },
              },
              createdBy: { select: { id: true, displayName: true } },
            },
          },
          _count: {
            select: {
              activations: {
                where: { status: 'done' },
              },
            },
          },
        },
      });

      const legacyTagsById = await loadLegacyTagsById(channelRows.map((row) => row.legacyMemeId));
      const mapped = channelRows.map((row) => {
        const item = toPublicChannelMemeListItemDto(channel.id, row);
        const tags = legacyTagsById.get(row.legacyMemeId ?? '');
        return tags && tags.length > 0 ? { ...item, tags } : item;
      });
      let items = mapped;
      if (items.length > 0) {
        const dynamicSettings = normalizeDynamicPricingSettings(channel);
        const snapshot = await loadDynamicPricingSnapshot({
          channelId: channel.id,
          channelMemeIds: collectChannelMemeIds(items as Array<Record<string, unknown>>),
          settings: dynamicSettings,
        });
        items = applyDynamicPricingToItems(items as Array<Record<string, unknown>>, snapshot) as typeof items;
      }
      response.memes = items;
      response.memesPage = {
        limit: memesLimit,
        offset: memesOffset,
        returned: response.memes.length,
        total: channel._count.channelMemes,
      };
    }
  }

  if (!includeMemes && canCacheMeta) {
    try {
      const body = JSON.stringify(response);
      const etag = makeEtagFromString(body);
      res.setHeader('ETag', etag);
      if (ifNoneMatchHit(req, etag)) {
        channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
        pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
        void redisSetStringEx(nsKey('public_channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
        return res.status(304).end();
      }
      channelMetaCache.set(cacheKey, { ts: Date.now(), data: response, etag });
      pruneOldestEntries(channelMetaCache, CHANNEL_META_CACHE_MAX);
      void redisSetStringEx(nsKey('public_channel_meta', cacheKey), Math.ceil(getChannelMetaCacheMs() / 1000), body);
      return res.type('application/json').send(body);
    } catch {
      // fall through
    }
  }

  return res.json(response);
};
