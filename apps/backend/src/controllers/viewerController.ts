import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { debugLog, debugError } from '../utils/debug.js';
import { activateMemeSchema } from '../shared/index.js';
import { getActivePromotion, calculatePriceWithDiscount } from '../utils/promotions.js';
import { logMemeActivation } from '../utils/auditLogger.js';
import { Server } from 'socket.io';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';

type CacheEntry<T> = { ts: number; data: T };
const channelMetaCache = new Map<string, CacheEntry<any>>();
const CHANNEL_META_CACHE_MS_DEFAULT = 60_000;

type TagIdCacheEntry = { ts: number; id: string | null };
const tagIdCache = new Map<string, TagIdCacheEntry>();
const TAG_ID_CACHE_MS_DEFAULT = 5 * 60_000;
const TAG_ID_CACHE_MAX = 10_000;

function getChannelMetaCacheMs(): number {
  const raw = parseInt(String(process.env.CHANNEL_META_CACHE_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : CHANNEL_META_CACHE_MS_DEFAULT;
}

function getTagIdCacheMs(): number {
  const raw = parseInt(String(process.env.TAG_ID_CACHE_MS || ''), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : TAG_ID_CACHE_MS_DEFAULT;
}

function parseTagNames(raw: unknown): string[] {
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

async function resolveTagIds(tagNames: string[]): Promise<string[]> {
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

function setChannelMetaCacheHeaders(req: any, res: Response) {
  // On production this route is public. On beta it is gated via auth/beta-access middleware.
  // Either way the response is not user-personalized; we use conservative caching when authenticated.
  const isAuthed = !!req?.userId;
  if (isAuthed) {
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  }
}

export const viewerController = {
  getChannelBySlug: async (req: any, res: Response) => {
    const slug = String(req.params.slug || '').trim();
    // Optional parameter to exclude memes from response for performance
    const includeMemes = req.query.includeMemes !== 'false'; // Default to true for backward compatibility

    // Optional pagination for memes when includeMemes=true (defensive cap to protect server/DB).
    const limitRaw = req.query.limit as string | undefined;
    const offsetRaw = req.query.offset as string | undefined;
    const maxFromEnv = parseInt(String(process.env.CHANNEL_MEMES_MAX || ''), 10);
    const MAX_MEMES = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 200;
    const requestedLimit = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined;
    const requestedOffset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : undefined;
    const memesLimit =
      includeMemes
        ? Math.min(
            MAX_MEMES,
            Number.isFinite(requestedLimit as number) && (requestedLimit as number) > 0 ? (requestedLimit as number) : MAX_MEMES
          )
        : 0;
    const memesOffset =
      includeMemes && Number.isFinite(requestedOffset as number) && (requestedOffset as number) > 0 ? (requestedOffset as number) : 0;

    // Cache channel metadata (colors/icons/reward settings) when we are NOT returning memes.
    // Safe because response is not user-personalized.
    const cacheKey = String(slug || '').trim().toLowerCase();
    if (!includeMemes) {
      setChannelMetaCacheHeaders(req, res);
      const cached = channelMetaCache.get(cacheKey);
      const ttl = getChannelMetaCacheMs();
      if (cached && Date.now() - cached.ts < ttl) {
        return res.json(cached.data);
      }
    }

    try {
      const channel = await prisma.channel.findFirst({
        where: {
          slug: {
            equals: slug,
            mode: 'insensitive',
          },
        },
        include: {
          memes: includeMemes ? {
            where: { status: 'approved' },
            orderBy: { createdAt: 'desc' },
            take: memesLimit,
            skip: memesOffset,
            select: {
              id: true,
              title: true,
              type: true,
              fileUrl: true,
              durationMs: true,
              priceCoins: true,
              createdAt: true,
            },
          } : false,
          users: {
            where: { role: 'streamer' },
            take: 1,
            select: {
              id: true,
              displayName: true,
              profileImageUrl: true,
            },
          },
          _count: {
            select: {
              memes: { where: { status: 'approved' } },
              users: true,
            },
          },
        },
      });

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const owner = channel.users?.[0] || null;
      const response: any = {
        id: channel.id,
        slug: channel.slug,
        name: channel.name,
        coinPerPointRatio: channel.coinPerPointRatio,
        overlayMode: (channel as any).overlayMode ?? 'queue',
        overlayShowSender: (channel as any).overlayShowSender ?? false,
        overlayMaxConcurrent: (channel as any).overlayMaxConcurrent ?? 3,
        rewardIdForCoins: (channel as any).rewardIdForCoins ?? null,
        rewardEnabled: (channel as any).rewardEnabled ?? false,
        rewardTitle: (channel as any).rewardTitle ?? null,
        rewardCost: (channel as any).rewardCost ?? null,
        rewardCoins: (channel as any).rewardCoins ?? null,
        submissionRewardCoins: (channel as any).submissionRewardCoins ?? 0,
        coinIconUrl: (channel as any).coinIconUrl ?? null,
        primaryColor: (channel as any).primaryColor ?? null,
        secondaryColor: (channel as any).secondaryColor ?? null,
        accentColor: (channel as any).accentColor ?? null,
        createdAt: channel.createdAt,
        owner: owner ? {
          id: owner.id,
          displayName: owner.displayName,
          profileImageUrl: owner.profileImageUrl,
        } : null,
        stats: {
          memesCount: channel._count.memes,
          usersCount: channel._count.users,
        },
      };

      // Only include memes if includeMemes is true
      if (includeMemes) {
        response.memes = channel.memes || [];
        response.memesPage = {
          limit: memesLimit,
          offset: memesOffset,
          returned: Array.isArray(response.memes) ? response.memes.length : 0,
          total: channel._count.memes,
        };
      }

      if (!includeMemes) {
        channelMetaCache.set(cacheKey, { ts: Date.now(), data: response });
      }
      res.json(response);
    } catch (error: any) {
      // If error is about missing columns, try query without color fields
      if (error.message && error.message.includes('does not exist')) {
        const channel = await prisma.$queryRaw`
          SELECT id, slug, name, "coinPerPointRatio", "createdAt"
          FROM "Channel"
          WHERE slug = ${slug}
        ` as any[];
        
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
        
        const response: any = {
          id: channel[0].id,
          slug: channel[0].slug,
          name: channel[0].name,
          coinPerPointRatio: channel[0].coinPerPointRatio,
          submissionRewardCoins: 0,
          primaryColor: null,
          secondaryColor: null,
          accentColor: null,
          createdAt: channel[0].createdAt,
          stats: {
            memesCount,
            usersCount,
          },
        };

        // Only include memes if includeMemes is true
        if (includeMemes) {
          response.memes = memes;
          response.memesPage = {
            limit: memesLimit,
            offset: memesOffset,
            returned: Array.isArray(memes) ? memes.length : 0,
            total: memesCount,
          };
        }

        if (!includeMemes) {
          setChannelMetaCacheHeaders(req, res);
          channelMetaCache.set(cacheKey, { ts: Date.now(), data: response });
        }
        return res.json(response);
      }
      throw error;
    }
  },

  getMe: async (req: AuthRequest, res: Response) => {
    debugLog('[DEBUG] getMe started', { userId: req.userId });
    try {
      const startTime = Date.now();
      const user = await prisma.user.findUnique({
        where: { id: req.userId! },
        include: {
          wallets: true,
          channel: {
            select: {
              id: true,
              slug: true,
              name: true,
            },
          },
        },
      });
      const dbDuration = Date.now() - startTime;
      debugLog('[DEBUG] getMe db query completed', { userId: req.userId, found: !!user, dbDuration });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const response = {
        id: user.id,
        displayName: user.displayName,
        profileImageUrl: user.profileImageUrl || null,
        role: user.role,
        channelId: user.channelId,
        channel: user.channel,
        wallets: user.wallets,
      };
      debugLog('[DEBUG] getMe sending response', { userId: user.id, hasChannel: !!user.channelId });
      res.json(response);
    } catch (error: any) {
      debugError('[DEBUG] getMe error', error);
      throw error;
    }
  },

  getWallet: async (req: AuthRequest, res: Response) => {
    const channelId = req.query.channelId as string | undefined;
    
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID is required' });
    }

    const wallet = await prisma.wallet.findUnique({
      where: { 
        userId_channelId: {
          userId: req.userId!,
          channelId: channelId,
        }
      },
    });

    if (!wallet) {
      // Return wallet with 0 balance if not found
      return res.json({
        id: '',
        userId: req.userId!,
        channelId: channelId,
        balance: 0,
        updatedAt: new Date(),
      });
    }

    res.json(wallet);
  },

  getWalletForChannel: async (req: AuthRequest, res: Response) => {
    const slug = String(req.params.slug || '').trim();
    
    try {
      // Find channel by slug with timeout protection
      const channelPromise = prisma.channel.findUnique({
        where: { slug }, // fast path (case-sensitive)
        select: { id: true },
      });
      
      const channelTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Channel lookup timeout')), 5000);
      });
      
      let channel = await Promise.race([channelPromise, channelTimeout]) as any;

      // Fallback: case-insensitive lookup (handles user-entered mixed-case slugs)
      if (!channel) {
        const ciChannelPromise = prisma.channel.findFirst({
          where: { slug: { equals: slug, mode: 'insensitive' } },
          select: { id: true },
        });
        channel = await Promise.race([ciChannelPromise, channelTimeout]) as any;
      }

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      // Use upsert to find or create wallet atomically (prevents race conditions)
      const walletPromise = prisma.wallet.upsert({
        where: {
          userId_channelId: {
            userId: req.userId!,
            channelId: channel.id,
          }
        },
        update: {}, // If exists, just return it
        create: {
          userId: req.userId!,
          channelId: channel.id,
          balance: 0,
        },
      });
      
      const walletTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Wallet operation timeout')), 5000);
      });
      
      const wallet = await Promise.race([walletPromise, walletTimeout]) as any;
      
      res.json(wallet);
    } catch (error: any) {
      console.error('Error in getWalletForChannel:', error);
      
      // If timeout or database error, return a default wallet instead of failing
      if (error.message?.includes('timeout') || error.message?.includes('ECONNREFUSED')) {
        return res.json({
          id: '',
          userId: req.userId!,
          channelId: '',
          balance: 0,
          updatedAt: new Date(),
        });
      }
      
      // Handle unique constraint errors gracefully
      if (error.message?.includes('Unique constraint failed')) {
        // Try to fetch existing wallet
        try {
          const channel = await prisma.channel.findUnique({
            where: { slug },
            select: { id: true },
          });
          
          if (channel) {
            const wallet = await prisma.wallet.findUnique({
              where: {
                userId_channelId: {
                  userId: req.userId!,
                  channelId: channel.id,
                }
              },
            });
            
            if (wallet) {
              return res.json(wallet);
            }
          }
        } catch (fetchError) {
          console.error('Error fetching wallet after constraint error:', fetchError);
        }
      }
      
      res.status(500).json({ error: 'Failed to get wallet', message: error.message });
    }
  },

  // Public: list approved memes for a channel by slug (supports pagination)
  getChannelMemesPublic: async (req: any, res: Response) => {
    const slug = String(req.params.slug || '').trim();

    const maxFromEnv = parseInt(String(process.env.CHANNEL_MEMES_PAGE_MAX || ''), 10);
    const MAX_PAGE = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 50;
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
    const offsetRaw = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_PAGE) : 30;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    // Cacheable on production (public). On beta it's gated via auth; still safe but keep it private.
    if (req?.userId) res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    else res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');

    if (!slug) {
      return res.status(400).json({ error: 'Channel slug is required' });
    }

    const channel = await prisma.channel.findFirst({
      where: { slug: { equals: slug, mode: 'insensitive' } },
      select: { id: true, slug: true },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const memes = await prisma.meme.findMany({
      where: {
        channelId: channel.id,
        status: 'approved',
      },
      include: {
        createdBy: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    res.json(memes);
  },

  getMemes: async (req: AuthRequest, res: Response) => {
    const channelSlug = req.query.channelSlug as string | undefined;
    const channelId = req.channelId || (req.query.channelId as string | undefined);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    let targetChannelId: string | null = null;

    if (channelSlug) {
      const channel = await prisma.channel.findUnique({
        where: { slug: channelSlug },
        select: { id: true },
      });
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      targetChannelId = channel.id;
    } else if (channelId) {
      targetChannelId = channelId;
    } else {
      return res.status(400).json({ error: 'Channel ID or slug required' });
    }

    const memes = await prisma.meme.findMany({
      where: {
        channelId: targetChannelId,
        status: 'approved',
      },
      include: {
        createdBy: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      ...(limit !== undefined && { take: limit }),
      ...(offset !== undefined && { skip: offset }),
    });

    res.json(memes);
  },

  searchMemes: async (req: any, res: Response) => {
    // Prevent browser/proxy caching for dynamic search/favorites results.
    // This endpoint is used for personalized results (favorites) and must always be fresh.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
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

    // Search query - search in title + tags; optionally uploader (dashboard)
    if (q) {
      const qStr = String(q).trim();
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

    // Execute query
    const parsedLimit = parseInt(limit as string, 10);
    const parsedOffset = parseInt(offset as string, 10);

    // "My favorites": order by the user's activation count for this channel.
    // We intentionally include in-progress activations (queued/playing) so the list is useful immediately
    // after a user activates a meme (otherwise it would stay empty until the activation completes).
    const favoritesStatuses = ['queued', 'playing', 'done', 'completed'];
    if (
      favoritesEnabled &&
      !q &&
      !tags &&
      !minPrice &&
      !maxPrice &&
      sortBy !== 'priceCoins'
    ) {
      const rows = await prisma.memeActivation.groupBy({
        by: ['memeId'],
        where: {
          channelId: targetChannelId!,
          userId: req.userId!,
          status: { in: favoritesStatuses },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: Number.isFinite(parsedLimit) ? parsedLimit : 50,
        skip: Number.isFinite(parsedOffset) ? parsedOffset : 0,
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

      const conditions: Prisma.Sql[] = [
        Prisma.sql`m.status = 'approved'`,
        Prisma.sql`m."channelId" = ${targetChannelId}`,
      ];

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
        conditions.push(Prisma.sql`(${Prisma.join(or, Prisma.sql` OR `)})`);
      }

      // Rank memes by activation count in the last 30 days for this channel.
      // Include memes with 0 activations (they come after popular ones, tie-broken by createdAt).
      const rows = await prisma.$queryRaw<Array<{ id: string; pop: number }>>(Prisma.sql`
        SELECT
          m.id,
          COALESCE(COUNT(a.id), 0)::int AS pop
        FROM "Meme" m
        LEFT JOIN "MemeActivation" a
          ON a."memeId" = m.id
         AND a."channelId" = ${targetChannelId}
         AND a.status IN ('done', 'completed')
         AND a."createdAt" >= ${popularityStartDate}
        WHERE ${Prisma.join(conditions, Prisma.sql` AND `)}
        GROUP BY m.id, m."createdAt"
        ORDER BY pop ${Prisma.raw(dir)}, m."createdAt" ${Prisma.raw(dir)}
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `);

      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return res.json([]);

      const activationWhere = {
        channelId: targetChannelId,
        status: { in: ['done', 'completed'] as const },
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
      return res.json(ordered);
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
            activations: sortBy === 'popularity'
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

    res.json(memes);
  },

  getMemeStats: async (req: any, res: Response) => {
    const {
      period = 'month', // day, week, month, year, all
      limit = 10,
      channelId,
      channelSlug,
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

    // Calculate date range
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(0); // All time
    }

    // Build where clause
    const where: any = {
      status: { in: ['done', 'completed'] }, // Only count completed activations
      createdAt: {
        gte: startDate,
      },
    };

    if (targetChannelId) {
      where.channelId = targetChannelId;
    }

    // Stats are meant to reflect viewer behavior; exclude "self" when authenticated (e.g. streamer viewing own stats).
    if (req.userId) {
      where.userId = { not: req.userId };
    }

    // Get meme statistics
    const activations = await prisma.memeActivation.groupBy({
      by: ['memeId'],
      where,
      _count: {
        id: true,
      },
      _sum: {
        coinsSpent: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: parseInt(limit as string, 10),
    });

    // Get meme details
    const memeIds = activations.map((a) => a.memeId);
    const memes = await prisma.meme.findMany({
      where: {
        id: {
          in: memeIds,
        },
      },
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
      },
    });

    // Combine data
    const stats = activations.map((activation) => {
      const meme = memes.find((m) => m.id === activation.memeId);
      return {
        meme: meme
          ? {
              id: meme.id,
              title: meme.title,
              priceCoins: meme.priceCoins,
              tags: meme.tags,
            }
          : null,
        activationsCount: activation._count.id,
        totalCoinsSpent: activation._sum.coinsSpent || 0,
      };
    });

    res.json({
      period,
      startDate,
      endDate: now,
      stats,
    });
  },

  activateMeme: async (req: AuthRequest, res: Response) => {
    const { id: memeId } = req.params;
    const io: Server = req.app.get('io');

    try {
      const parsed = activateMemeSchema.parse({ memeId });

      // Get user wallet and meme in transaction
      const result = await prisma.$transaction(async (tx) => {
        const meme = await tx.meme.findUnique({
          where: { id: parsed.memeId },
          include: { channel: true },
        });

        if (!meme) {
          throw new Error('Meme not found');
        }

        if (meme.status !== 'approved') {
          throw new Error('Meme is not approved');
        }

        // Find or create wallet for this user and channel
        let wallet = await tx.wallet.findUnique({
          where: {
            userId_channelId: {
              userId: req.userId!,
              channelId: meme.channelId,
            }
          },
        });

        if (!wallet) {
          // Create wallet with 0 balance if it doesn't exist
          wallet = await tx.wallet.create({
            data: {
              userId: req.userId!,
              channelId: meme.channelId,
              balance: 0,
            },
          });
        }

        // Check if user is the owner of the channel (free activation for channel owner)
        const isChannelOwner = req.channelId === meme.channelId;

        // Check for active promotion
        const promotion = await getActivePromotion(meme.channelId);
        const finalPrice = promotion
          ? calculatePriceWithDiscount(meme.priceCoins, promotion.discountPercent)
          : meme.priceCoins;

        let updatedWallet = wallet;
        let coinsSpent = 0;

        if (!isChannelOwner) {
          // Only check balance and deduct coins if user is not the channel owner
          if (wallet.balance < finalPrice) {
            throw new Error('Insufficient balance');
          }

          // Deduct coins
          updatedWallet = await tx.wallet.update({
            where: { 
              userId_channelId: {
                userId: req.userId!,
                channelId: meme.channelId,
              }
            },
            data: {
              balance: {
                decrement: finalPrice,
              },
            },
          });
          coinsSpent = finalPrice;
        }
        // If isChannelOwner, coinsSpent remains 0 and wallet is not updated

        const activation = await tx.memeActivation.create({
          data: {
            channelId: meme.channelId,
            userId: req.userId!,
            memeId: meme.id,
            coinsSpent: coinsSpent,
            status: 'queued',
          },
        });

        const sender = await tx.user.findUnique({
          where: { id: req.userId! },
          select: { displayName: true },
        });

        return { activation, meme, wallet: updatedWallet, senderDisplayName: sender?.displayName ?? null };
      });

      // Emit to overlay.
      // IMPORTANT: Always emit to a normalized room name to avoid case mismatches
      // between stored slugs, older clients, and token-based overlay joins.
      const channelSlug = String(result.meme.channel.slug || '').toLowerCase();
      io.to(`channel:${channelSlug}`).emit('activation:new', {
        id: result.activation.id,
        memeId: result.activation.memeId,
        type: result.meme.type,
        fileUrl: result.meme.fileUrl,
        durationMs: result.meme.durationMs,
        title: result.meme.title,
        senderDisplayName: result.senderDisplayName,
      });

      // Publish wallet update so other instances (beta/prod) can emit it to connected clients.
      // Also emit locally for immediate feedback to current instance.
      if (result.activation.coinsSpent && result.activation.coinsSpent > 0) {
        const walletUpdateData = {
          userId: result.activation.userId,
          channelId: result.activation.channelId,
          balance: result.wallet.balance,
          delta: -result.activation.coinsSpent,
          reason: 'meme_activation',
          channelSlug: result.meme.channel.slug,
        };
        emitWalletUpdated(io, walletUpdateData as any);
        void relayWalletUpdatedToPeer(walletUpdateData as any);
      }

      // Get promotion info for response
      const promotion = await getActivePromotion(result.meme.channelId);
      const originalPrice = result.meme.priceCoins;
      const finalPrice = promotion
        ? calculatePriceWithDiscount(originalPrice, promotion.discountPercent)
        : originalPrice;

      res.json({
        activation: result.activation,
        wallet: result.wallet,
        originalPrice,
        finalPrice,
        discountApplied: promotion ? promotion.discountPercent : 0,
        isFree: req.channelId === result.meme.channelId, // Indicate if activation was free for channel owner
      });
    } catch (error: any) {
      if (error.message === 'Wallet not found' || error.message === 'Meme not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message === 'Insufficient balance' || error.message === 'Meme is not approved') {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
  },
};


