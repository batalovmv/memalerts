import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { getAiModerationDlqCounts, getAiModerationQueueCounts } from '../../queues/aiModerationQueue.js';

type MemeSubmissionSample = {
  id: string;
  channelId: string;
  title: string | null;
  type: string;
  fileUrlTemp: string | null;
  fileHash: string | null;
  aiRetryCount: number | null;
  aiLastTriedAt: Date | null;
  aiLockExpiresAt: Date | null;
  aiNextRetryAt: Date | null;
  aiError: string | null;
  createdAt: Date;
  channel: { slug: string | null } | null;
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function resolveBullmqStatus(): { enabled: boolean; disabledReason: string | null } {
  const enabledByEnv = parseBool(process.env.AI_BULLMQ_ENABLED);
  if (!enabledByEnv) return { enabled: false, disabledReason: 'bullmq_disabled' };
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  if (!redisUrl) return { enabled: false, disabledReason: 'redis_missing' };
  return { enabled: true, disabledReason: null };
}

export const aiStatusController = {
  status: async (req: AuthRequest, res: Response) => {
    const openaiApiKeySet = !!String(process.env.OPENAI_API_KEY || '').trim();
    const metaEnabled = String(process.env.AI_METADATA_ENABLED ?? '1').toLowerCase() !== '0';
    const visionEnabled = String(process.env.AI_VISION_ENABLED ?? '1').toLowerCase() !== '0';

    const stuckMs = clampInt(
      parseInt(String(process.env.AI_MODERATION_STUCK_MS || ''), 10),
      5_000,
      7 * 24 * 60 * 60_000,
      10 * 60_000
    );
    const now = new Date();
    const stuckBefore = new Date(Date.now() - stuckMs);

    const query = req.query as Record<string, unknown>;
    const processingTake = clampInt(parseInt(String(req.query.take || ''), 10), 1, 100, 20);
    const pendingTake = clampInt(parseInt(String(query.pendingTake || ''), 10), 0, 100, 20);
    const failedTake = clampInt(parseInt(String(query.failedTake || ''), 10), 0, 100, 20);
    const stuckTake = clampInt(parseInt(String(query.stuckTake || ''), 10), 0, 100, 20);
    const emptyItems: MemeSubmissionSample[] = [];

    const [pending, failedFinal, processingStuck, processingItems, pendingItems, failedItems, stuckItems] =
      await Promise.all([
        prisma.memeSubmission.count({
          where: {
            status: { in: ['pending', 'approved'] },
            sourceKind: { in: ['upload', 'url'] },
            aiStatus: 'pending',
            OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }],
          },
        }),
        prisma.memeSubmission.count({
          where: {
            status: { in: ['pending', 'approved'] },
            sourceKind: { in: ['upload', 'url'] },
            aiStatus: 'failed',
          },
        }),
        prisma.memeSubmission.count({
          where: {
            status: { in: ['pending', 'approved'] },
            sourceKind: { in: ['upload', 'url'] },
            aiStatus: 'processing',
            OR: [{ aiLockExpiresAt: { lte: now } }, { aiLockExpiresAt: null }, { aiLastTriedAt: { lt: stuckBefore } }],
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
            aiLockExpiresAt: true,
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
                OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }],
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
                aiLockExpiresAt: true,
                aiNextRetryAt: true,
                aiError: true,
                createdAt: true,
                channel: { select: { slug: true } },
              },
            })
          : Promise.resolve(emptyItems),
        failedTake > 0
          ? prisma.memeSubmission.findMany({
              where: {
                status: { in: ['pending', 'approved'] },
                sourceKind: { in: ['upload', 'url'] },
                aiStatus: 'failed',
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
                aiLockExpiresAt: true,
                aiNextRetryAt: true,
                aiError: true,
                createdAt: true,
                channel: { select: { slug: true } },
              },
            })
          : Promise.resolve(emptyItems),
        stuckTake > 0
          ? prisma.memeSubmission.findMany({
              where: {
                status: { in: ['pending', 'approved'] },
                sourceKind: { in: ['upload', 'url'] },
                aiStatus: 'processing',
                OR: [
                  { aiLockExpiresAt: { lte: now } },
                  { aiLockExpiresAt: null },
                  { aiLastTriedAt: { lt: stuckBefore } },
                ],
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
                aiLockExpiresAt: true,
                aiNextRetryAt: true,
                aiError: true,
                createdAt: true,
                channel: { select: { slug: true } },
              },
            })
          : Promise.resolve(emptyItems),
      ]);

    const bullmqStatus = resolveBullmqStatus();
    const [bullmqQueue, bullmqDlq] = await Promise.all([getAiModerationQueueCounts(), getAiModerationDlqCounts()]);

    const toItem = (s: MemeSubmissionSample) => {
      const lockExpired = !!s.aiLockExpiresAt && s.aiLockExpiresAt < now;
      const lastTriedStuck = !!s.aiLastTriedAt && s.aiLastTriedAt < stuckBefore;
      const isStuck = lockExpired || lastTriedStuck;
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
        aiLockExpiresAt: s.aiLockExpiresAt ? s.aiLockExpiresAt.toISOString() : null,
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
      failed: failedItems.map(toItem),
      processingStuck: stuckItems.map(toItem),
    };

    return res.json({
      enabled: bullmqStatus.enabled,
      disabledReason: bullmqStatus.disabledReason,
      openaiApiKeySet,
      flags: {
        metaEnabled,
        visionEnabled,
      },
      lastRunStartedAt: null,
      lastRunCompletedAt: null,
      lastRunStats: null,
      bullmq: {
        queue: bullmqQueue,
        dlq: bullmqDlq,
      },
      queueCounts: { pending, failedReady: failedFinal, failed: failedFinal, processingStuck },
      queueSample,
      processing: {
        take: processingTake,
        items: processing,
      },
    });
  },
};
