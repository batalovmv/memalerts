import type { Express } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getChatOutboxQueueCounts } from '../../queues/chatOutboxQueue.js';
import { metricsRegistry, setAiJobMetrics, setBotOutboxMetrics, setChatOutboxQueueDepth } from '../../utils/metrics.js';
import { logger } from '../../utils/logger.js';

export function registerMetricsRoutes(app: Express) {
  app.get('/metrics', async (_req, res) => {
    try {
      const aiWhere: Prisma.MemeSubmissionWhereInput = {
        status: { in: ['pending', 'approved'] },
        sourceKind: { in: ['upload', 'url'] },
      };
      const pendingPromise = prisma.memeSubmission.count({ where: { ...aiWhere, aiStatus: 'pending' } });
      const processingPromise = prisma.memeSubmission.count({ where: { ...aiWhere, aiStatus: 'processing' } });
      const failedPromise = prisma.memeSubmission.count({ where: { ...aiWhere, aiStatus: 'failed' } });

      const outboxPendingWhere = { status: { in: ['pending', 'processing'] } };
      const outboxFailedWhere = { status: 'failed' as const };

      const [
        aiPending,
        aiProcessing,
        aiFailed,
        twitchPending,
        twitchFailed,
        youtubePending,
        youtubeFailed,
        vkvideoPending,
        vkvideoFailed,
        trovoPending,
        trovoFailed,
        kickPending,
        kickFailed,
        twitchQueueCounts,
        youtubeQueueCounts,
        vkvideoQueueCounts,
        trovoQueueCounts,
        kickQueueCounts,
      ] = await Promise.all([
        pendingPromise,
        processingPromise,
        failedPromise,
        prisma.chatBotOutboxMessage.count({ where: outboxPendingWhere }),
        prisma.chatBotOutboxMessage.count({ where: outboxFailedWhere }),
        prisma.youTubeChatBotOutboxMessage.count({ where: outboxPendingWhere }),
        prisma.youTubeChatBotOutboxMessage.count({ where: outboxFailedWhere }),
        prisma.vkVideoChatBotOutboxMessage.count({ where: outboxPendingWhere }),
        prisma.vkVideoChatBotOutboxMessage.count({ where: outboxFailedWhere }),
        prisma.trovoChatBotOutboxMessage.count({ where: outboxPendingWhere }),
        prisma.trovoChatBotOutboxMessage.count({ where: outboxFailedWhere }),
        prisma.kickChatBotOutboxMessage.count({ where: outboxPendingWhere }),
        prisma.kickChatBotOutboxMessage.count({ where: outboxFailedWhere }),
        getChatOutboxQueueCounts('twitch'),
        getChatOutboxQueueCounts('youtube'),
        getChatOutboxQueueCounts('vkvideo'),
        getChatOutboxQueueCounts('trovo'),
        getChatOutboxQueueCounts('kick'),
      ]);

      setAiJobMetrics({ pending: aiPending, processing: aiProcessing, failedTotal: aiFailed });
      setBotOutboxMetrics({ platform: 'twitch', pending: twitchPending, failedTotal: twitchFailed });
      setBotOutboxMetrics({ platform: 'youtube', pending: youtubePending, failedTotal: youtubeFailed });
      setBotOutboxMetrics({ platform: 'vkvideo', pending: vkvideoPending, failedTotal: vkvideoFailed });
      setBotOutboxMetrics({ platform: 'trovo', pending: trovoPending, failedTotal: trovoFailed });
      setBotOutboxMetrics({ platform: 'kick', pending: kickPending, failedTotal: kickFailed });

      const queueDepths: Array<[string, typeof twitchQueueCounts]> = [
        ['twitch', twitchQueueCounts],
        ['youtube', youtubeQueueCounts],
        ['vkvideo', vkvideoQueueCounts],
        ['trovo', trovoQueueCounts],
        ['kick', kickQueueCounts],
      ];

      for (const [platform, counts] of queueDepths) {
        if (!counts) continue;
        setChatOutboxQueueDepth({ platform, state: 'waiting', depth: counts.waiting });
        setChatOutboxQueueDepth({ platform, state: 'active', depth: counts.active });
        setChatOutboxQueueDepth({ platform, state: 'delayed', depth: counts.delayed });
        setChatOutboxQueueDepth({ platform, state: 'failed', depth: counts.failed });
        setChatOutboxQueueDepth({ platform, state: 'completed', depth: counts.completed });
      }

      res.setHeader('Content-Type', metricsRegistry().contentType);
      return res.status(200).send(await metricsRegistry().metrics());
    } catch (error) {
      const err = error as Error;
      logger.error('metrics.refresh_failed', { errorMessage: err.message });
      res.setHeader('Content-Type', metricsRegistry().contentType);
      return res.status(503).send(await metricsRegistry().metrics());
    }
  });
}
