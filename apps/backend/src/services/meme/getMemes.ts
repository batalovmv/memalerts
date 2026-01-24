import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { asRecord } from './memeShared.js';
import { parseQueryBool } from '../../shared/utils/queryParsers.js';

const getSourceType = (format: 'webm' | 'mp4' | 'preview'): string => {
  switch (format) {
    case 'preview':
      return 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    case 'webm':
      return 'video/webm; codecs="vp9, opus"';
    case 'mp4':
      return 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"';
  }
};

export const getMemes = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  const queryRec = asRecord(req.query);
  const includeAi = parseQueryBool(queryRec.includeAi);

  const clampInt = (n: number, min: number, max: number, fallback: number): number => {
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  };

  const all = String(req.query.all || '').toLowerCase();
  const includeTotal = parseQueryBool(req.query.includeTotal);
  const qRaw = String(req.query.q || '').trim();
  const q = qRaw.length > 100 ? qRaw.slice(0, 100) : qRaw;

  const statusRaw = String(req.query.status || '')
    .trim()
    .toLowerCase();
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'deleted']);

  const where: Record<string, unknown> = {
    channelId,
    ...(q
      ? {
          title: {
            contains: q,
            mode: 'insensitive',
          },
        }
      : {}),
  };

  if (statusRaw === 'all') {
    // no status filter
  } else if (allowedStatuses.has(statusRaw)) {
    where.status = statusRaw;
  } else {
    where.status = { not: 'deleted' };
  }

  if (where.status === 'deleted') {
    // include deletedAt
  } else {
    where.deletedAt = null;
  }

  const sortOrderRaw = String(req.query.sortOrder || '').toLowerCase();
  const sortOrder: 'asc' | 'desc' = sortOrderRaw === 'asc' ? 'asc' : 'desc';

  const maxFromEnv = parseInt(String(process.env.STREAMER_MEMES_MAX || ''), 10);
  const MAX_MEMES = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 500;
  const requestedLimit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : undefined;
  const requestedOffset = req.query.offset !== undefined ? parseInt(String(req.query.offset), 10) : undefined;

  const limit = clampInt(requestedLimit as number, 1, MAX_MEMES, Math.min(200, MAX_MEMES));
  const offset = clampInt(requestedOffset as number, 0, 1_000_000_000, 0);

  const usePaging = all !== '1' && all !== 'true' && all !== 'yes';

  const whereChannelMeme: Record<string, unknown> = {
    channelId,
    ...(q
      ? {
          title: {
            contains: q,
            mode: 'insensitive',
          },
        }
      : {}),
  };

  if (statusRaw === 'all') {
    // no status filter
  } else if (allowedStatuses.has(statusRaw)) {
    if (statusRaw === 'deleted') {
      whereChannelMeme.status = 'disabled';
    } else {
      whereChannelMeme.status = statusRaw;
    }
  } else {
    whereChannelMeme.status = { not: 'disabled' };
  }

  if (statusRaw === 'deleted') {
    // include deletedAt
  } else {
    whereChannelMeme.deletedAt = null;
  }

  const rows = await prisma.channelMeme.findMany({
    where: whereChannelMeme,
    ...(usePaging ? { take: limit + 1, skip: offset } : {}),
    orderBy: { createdAt: sortOrder },
    select: {
      id: true,
      legacyMemeId: true,
      channelId: true,
      title: true,
      priceCoins: true,
      status: true,
      deletedAt: true,
      createdAt: true,
      ...(includeAi
        ? {
            aiAutoDescription: true,
            aiAutoTagNamesJson: true,
          }
        : {}),
      memeAsset: {
        select: {
          id: true,
          type: true,
          fileUrl: true,
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
          ...(includeAi
            ? {
                fileHash: true,
                aiStatus: true,
                aiAutoTitle: true,
                aiCompletedAt: true,
                aiAutoDescription: true,
                aiAutoTagNamesJson: true,
              }
            : {}),
          createdBy: {
            select: {
              id: true,
              displayName: true,
              channel: { select: { slug: true } },
            },
          },
        },
      },
      approvedBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  });

  const latestAiByAssetId: Map<
    string,
    {
      submissionId: string;
      aiStatus: string;
      aiCompletedAt: Date | null;
      aiLastTriedAt: Date | null;
      aiRetryCount: number;
      aiError: string | null;
      aiPipelineVersion: string | null;
      aiModelVersionsJson: unknown | null;
    }
  > = new Map();
  if (includeAi) {
    const assetIds = Array.from(new Set(rows.map((r) => r.memeAsset?.id).filter((id): id is string => Boolean(id))));
    if (assetIds.length > 0) {
      try {
        const subs = await prisma.memeSubmission.findMany({
          where: {
            channelId,
            memeAssetId: { in: assetIds },
            sourceKind: { in: ['upload', 'url'] },
          },
          orderBy: [{ memeAssetId: 'asc' }, { createdAt: 'desc' }],
          distinct: ['memeAssetId'],
          select: {
            id: true,
            memeAssetId: true,
            aiStatus: true,
            aiCompletedAt: true,
            aiLastTriedAt: true,
            aiRetryCount: true,
            aiError: true,
            aiModelVersionsJson: true,
          },
        });

        for (const s of subs) {
          const mv = s.aiModelVersionsJson ?? null;
          const mvRec = mv && typeof mv === 'object' ? (mv as Record<string, unknown>) : null;
          const pipelineVersion = mvRec && typeof mvRec.pipelineVersion === 'string' ? mvRec.pipelineVersion : null;
          if (s.memeAssetId) {
            latestAiByAssetId.set(String(s.memeAssetId), {
              submissionId: String(s.id),
              aiStatus: String(s.aiStatus || ''),
              aiCompletedAt: s.aiCompletedAt ?? null,
              aiLastTriedAt: s.aiLastTriedAt ?? null,
              aiRetryCount: Number.isFinite(s.aiRetryCount) ? Number(s.aiRetryCount) : 0,
              aiError: s.aiError ? String(s.aiError) : null,
              aiPipelineVersion: pipelineVersion,
              aiModelVersionsJson: mvRec,
            });
          }
        }
      } catch {
        // ignore (back-compat if column/table missing on older DBs)
      }
    }
  }

  const memes = rows.map((r) => {
    const doneVariants = Array.isArray(r.memeAsset.variants)
      ? r.memeAsset.variants.filter((v) => String(v.status || '') === 'done')
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
      legacyMemeId: r.legacyMemeId,
      channelId: r.channelId,
      title: r.title,
      type: r.memeAsset.type,
      previewUrl: preview?.fileUrl ?? null,
      variants,
      fileUrl: variants[0]?.fileUrl ?? preview?.fileUrl ?? r.memeAsset.fileUrl ?? null,
      durationMs: r.memeAsset.durationMs,
      priceCoins: r.priceCoins,
      status: r.status,
      deletedAt: r.deletedAt,
      createdAt: r.createdAt,
      createdBy: r.memeAsset.createdBy,
    approvedBy: r.approvedBy,
    ...(includeAi
      ? {
          aiAutoDescription: asRecord(r as unknown).aiAutoDescription ?? null,
          aiAutoTagNames: Array.isArray(asRecord(r as unknown).aiAutoTagNamesJson)
            ? (asRecord(r as unknown).aiAutoTagNamesJson as string[])
            : null,
          aiStatus: asRecord(r.memeAsset as unknown).aiStatus ?? null,
          aiAutoTitle: asRecord(r.memeAsset as unknown).aiAutoTitle ?? null,
          aiCompletedAt: asRecord(r.memeAsset as unknown).aiCompletedAt
            ? new Date(String(asRecord(r.memeAsset as unknown).aiCompletedAt)).toISOString()
            : null,
          assetFileHash: asRecord(r.memeAsset as unknown).fileHash ?? null,
          assetAiAutoDescription: asRecord(r.memeAsset as unknown).aiAutoDescription ?? null,
          assetAiAutoTagNames: Array.isArray(asRecord(r.memeAsset as unknown).aiAutoTagNamesJson)
            ? (asRecord(r.memeAsset as unknown).aiAutoTagNamesJson as string[])
            : null,
          aiLastSubmission: (() => {
            const assetId = String(asRecord(r.memeAsset as unknown).id || '');
            if (!assetId) return null;
            const last = latestAiByAssetId.get(assetId);
            if (!last) return null;
            return {
              id: last.submissionId,
              aiStatus: last.aiStatus || null,
              aiPipelineVersion: last.aiPipelineVersion,
              aiRetryCount: last.aiRetryCount,
              aiLastTriedAt: last.aiLastTriedAt ? new Date(last.aiLastTriedAt).toISOString() : null,
              aiCompletedAt: last.aiCompletedAt ? new Date(last.aiCompletedAt).toISOString() : null,
              aiErrorShort: last.aiError ? String(last.aiError).slice(0, 500) : null,
              aiDebug: last.aiModelVersionsJson ? last.aiModelVersionsJson : null,
            };
          })(),
        }
      : {}),
    };
  });

  let hasMore = false;
  let items = memes;
  if (usePaging && memes.length > limit) {
    hasMore = true;
    items = memes.slice(0, limit);
  }

  if (usePaging) {
    res.setHeader('X-Limit', String(limit));
    res.setHeader('X-Offset', String(offset));
    res.setHeader('X-Has-More', hasMore ? '1' : '0');
  }

  if (includeTotal) {
    const total = await prisma.channelMeme.count({ where: whereChannelMeme });
    res.setHeader('X-Total-Count', String(total));
  }

  res.json(items);
};
