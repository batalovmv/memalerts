import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

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

export const getStarterMemes = async (req: AuthRequest, res: Response) => {
  const channelId = typeof req.channelId === 'string' ? req.channelId : null;
  if (!channelId) {
    return res.status(400).json({ errorCode: 'CHANNEL_REQUIRED', error: 'Channel required' });
  }

  const limitRaw = parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10);
  const limit = clampInt(limitRaw, 1, MAX_LIMIT);

  const rows = await prisma.memeAsset.findMany({
    where: {
      poolVisibility: 'visible',
      purgedAt: null,
      fileUrl: { not: null },
      aiStatus: 'done',
      NOT: {
        channelMemes: {
          some: {
            channelId,
            deletedAt: null,
          },
        },
      },
    },
    orderBy: [{ qualityScore: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      type: true,
      fileUrl: true,
      durationMs: true,
      qualityScore: true,
      createdAt: true,
      aiAutoTitle: true,
      aiAutoTagNamesJson: true,
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
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: {
          title: true,
          priceCoins: true,
        },
      },
    },
  });

  const items = rows.map((r) => {
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
    const aiAutoTagNames = Array.isArray(r.aiAutoTagNamesJson)
      ? (r.aiAutoTagNamesJson as unknown[])
          .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
          .map((tag) => tag.trim())
      : null;
    const sample = Array.isArray(r.channelMemes) && r.channelMemes.length > 0 ? r.channelMemes[0] : null;
    return {
      id: r.id,
      memeAssetId: r.id,
      type: r.type,
      previewUrl: preview?.fileUrl ?? null,
      variants,
      fileUrl: variants[0]?.fileUrl ?? preview?.fileUrl ?? r.fileUrl ?? null,
      durationMs: r.durationMs ?? null,
      qualityScore: r.qualityScore ?? null,
      usageCount: r._count.channelMemes ?? 0,
      sampleTitle: sample?.title ?? null,
      samplePriceCoins: sample?.priceCoins ?? null,
      aiAutoTitle: r.aiAutoTitle ?? null,
      aiAutoTagNames,
    };
  });

  return res.json(items);
};
