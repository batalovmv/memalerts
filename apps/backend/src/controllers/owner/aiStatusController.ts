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

    const [pending, failedReady, processingStuck] = await Promise.all([
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
    ]);

    const scheduler = getAiModerationSchedulerStatus();

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
    });
  },
};


