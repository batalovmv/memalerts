import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { getAiModerationSchedulerStatus } from '../../jobs/aiModerationSubmissions.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export const aiStatusController = {
  status: async (req: AuthRequest, res: Response) => {
    const intervalMs = clampInt(parseInt(String(process.env.AI_MODERATION_INTERVAL_MS || ''), 10), 1_000, 60 * 60_000, 30_000);
    const openaiApiKeySet = !!String(process.env.OPENAI_API_KEY || '').trim();
    const metaEnabled = String(process.env.AI_METADATA_ENABLED ?? '1').toLowerCase() !== '0';
    const visionEnabled = String(process.env.AI_VISION_ENABLED ?? '1').toLowerCase() !== '0';

    const stuckMs = clampInt(parseInt(String(process.env.AI_MODERATION_STUCK_MS || ''), 10), 5_000, 7 * 24 * 60 * 60_000, 10 * 60_000);
    const now = new Date();
    const stuckBefore = new Date(Date.now() - stuckMs);

    const processingTake = clampInt(parseInt(String(req.query.take || ''), 10), 1, 100, 20);
    const pendingTake = clampInt(parseInt(String((req.query as any).pendingTake || ''), 10), 0, 100, 20);
    const failedTake = clampInt(parseInt(String((req.query as any).failedTake || ''), 10), 0, 100, 20);
    const stuckTake = clampInt(parseInt(String((req.query as any).stuckTake || ''), 10), 0, 100, 20);

    const [pending, failedReady, processingStuck, processingItems, pendingItems, failedItems, stuckItems] = await Promise.all([
      prisma.memeSubmission.count({
        where: {
          status: { in: ['pending', 'approved'] },
          sourceKind: { in: ['upload', 'url'] },
          aiStatus: 'pending',
        },
      }),
      prisma.memeSubmission.count({
        where: {
          status: { in: ['pending', 'approved'] },
          sourceKind: { in: ['upload', 'url'] },
          aiStatus: 'failed',
          OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }],
        },
      }),
      prisma.memeSubmission.count({
        where: {
          status: { in: ['pending', 'approved'] },
          sourceKind: { in: ['upload', 'url'] },
          aiStatus: 'processing',
          aiLastTriedAt: { lt: stuckBefore },
        },
      }),
      prisma.memeSubmission.findMany({
        where: {
          status: { in: ['pending', 'approved'] },
          sourceKind: { in: ['upload', 'url'] },
          aiStatus: 'processing',
        },
        orderBy: [{ aiLastTriedAt: 'desc' }, { createdAt: 'asc' }],
        take: processingTake,
        select: {
          id: true,
          channelId: true,
          title: true,
          type: true,
          fileUrlTemp: true,
          fileHash: true,
          aiRetryCount: true,
          aiLastTriedAt: true,
          aiNextRetryAt: true,
          aiError: true,
          createdAt: true,
          channel: { select: { slug: true } },
        },
      }),
      pendingTake > 0
        ? prisma.memeSubmission.findMany({
            where: {
              status: { in: ['pending', 'approved'] },
              sourceKind: { in: ['upload', 'url'] },
              aiStatus: 'pending',
            },
            orderBy: [{ createdAt: 'asc' }],
            take: pendingTake,
            select: {
              id: true,
              channelId: true,
              title: true,
              type: true,
              fileUrlTemp: true,
              fileHash: true,
              aiRetryCount: true,
              aiLastTriedAt: true,
              aiNextRetryAt: true,
              aiError: true,
              createdAt: true,
              channel: { select: { slug: true } },
            },
          })
        : Promise.resolve([] as any[]),
      failedTake > 0
        ? prisma.memeSubmission.findMany({
            where: {
              status: { in: ['pending', 'approved'] },
              sourceKind: { in: ['upload', 'url'] },
              aiStatus: 'failed',
              OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }],
            },
            orderBy: [{ aiNextRetryAt: 'asc' }, { aiLastTriedAt: 'desc' }, { createdAt: 'asc' }],
            take: failedTake,
            select: {
              id: true,
              channelId: true,
              title: true,
              type: true,
              fileUrlTemp: true,
              fileHash: true,
              aiRetryCount: true,
              aiLastTriedAt: true,
              aiNextRetryAt: true,
              aiError: true,
              createdAt: true,
              channel: { select: { slug: true } },
            },
          })
        : Promise.resolve([] as any[]),
      stuckTake > 0
        ? prisma.memeSubmission.findMany({
            where: {
              status: { in: ['pending', 'approved'] },
              sourceKind: { in: ['upload', 'url'] },
              aiStatus: 'processing',
              aiLastTriedAt: { lt: stuckBefore },
            },
            orderBy: [{ aiLastTriedAt: 'asc' }, { createdAt: 'asc' }],
            take: stuckTake,
            select: {
              id: true,
              channelId: true,
              title: true,
              type: true,
              fileUrlTemp: true,
              fileHash: true,
              aiRetryCount: true,
              aiLastTriedAt: true,
              aiNextRetryAt: true,
              aiError: true,
              createdAt: true,
              channel: { select: { slug: true } },
            },
          })
        : Promise.resolve([] as any[]),
    ]);

    const scheduler = getAiModerationSchedulerStatus();

    const toItem = (s: any) => {
      const isStuck = !!s.aiLastTriedAt && s.aiLastTriedAt < stuckBefore;
      return {
        id: s.id,
        channelId: s.channelId,
        channelSlug: s.channel?.slug ?? null,
        title: s.title,
        type: s.type,
        fileHash: s.fileHash ?? null,
        fileUrlTemp: String(s.fileUrlTemp || '').slice(0, 300),
        aiRetryCount: s.aiRetryCount,
        aiLastTriedAt: s.aiLastTriedAt ? s.aiLastTriedAt.toISOString() : null,
        aiNextRetryAt: s.aiNextRetryAt ? s.aiNextRetryAt.toISOString() : null,
        stuck: isStuck,
        aiErrorShort: s.aiError ? String(s.aiError).slice(0, 500) : null,
        createdAt: s.createdAt.toISOString(),
      };
    };

    const processing = processingItems.map(toItem);
    const queueSample = {
      pendingTake,
      failedTake,
      stuckTake,
      pending: pendingItems.map(toItem),
      failedReady: failedItems.map(toItem),
      processingStuck: stuckItems.map(toItem),
    };

    return res.json({
      enabled: scheduler.enabled,
      disabledReason: scheduler.disabledReason,
      openaiApiKeySet,
      intervalMs,
      flags: {
        metaEnabled,
        visionEnabled,
      },
      lastRunStartedAt: scheduler.lastRunStartedAt,
      lastRunCompletedAt: scheduler.lastRunCompletedAt,
      lastRunStats: scheduler.lastRunStats,
      queueCounts: { pending, failedReady, processingStuck },
      queueSample,
      processing: {
        take: processingTake,
        items: processing,
      },
    });
  },
};


