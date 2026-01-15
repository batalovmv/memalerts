import { DelayedError, Worker } from 'bullmq';
import { acquireChatOutboxChannelLock, releaseChatOutboxChannelLock } from '../queues/chatOutboxLock.js';
import { getBullmqConnection, getBullmqPrefix } from '../queues/bullmqConnection.js';
import {
  type ChatOutboxJobData,
  computeChatOutboxBackoffMs,
  getChatOutboxQueueName,
} from '../queues/chatOutboxQueue.js';
import { recordChatOutboxQueueLatency } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';
import { asRecord, getErrorMessage, normalizeMessage, prismaAny } from './vkvideoChatbotShared.js';

const MAX_OUTBOX_BATCH = 25;
const MAX_SEND_ATTEMPTS = 3;
const PROCESSING_STALE_MS = 60_000;

type VkvideoChatOutboxConfig = {
  outboxBullmqEnabled: boolean;
  outboxConcurrency: number;
  outboxRateLimitMax: number;
  outboxRateLimitWindowMs: number;
  outboxLockTtlMs: number;
  outboxLockDelayMs: number;
  stoppedRef: { value: boolean };
};

type VkvideoChatOutboxState = {
  vkvideoIdToChannelId: Map<string, string>;
};

export function createVkvideoChatOutbox(
  state: VkvideoChatOutboxState,
  config: VkvideoChatOutboxConfig,
  sendToVkVideoChat: (params: { vkvideoChannelId: string; text: string }) => Promise<void>
) {
  const { vkvideoIdToChannelId } = state;
  const {
    outboxBullmqEnabled,
    outboxConcurrency,
    outboxRateLimitMax,
    outboxRateLimitWindowMs,
    outboxLockTtlMs,
    outboxLockDelayMs,
    stoppedRef,
  } = config;

  let outboxProcessing = false;

  const processOutboxOnce = async () => {
    if (stoppedRef.value) return;
    if (outboxProcessing) return;
    outboxProcessing = true;
    const channelIds = Array.from(new Set(Array.from(vkvideoIdToChannelId.values()).filter(Boolean)));
    if (channelIds.length === 0) {
      outboxProcessing = false;
      return;
    }

    try {
      const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
      const rows = await prismaAny.vkVideoChatBotOutboxMessage.findMany({
        where: {
          channelId: { in: channelIds },
          OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_OUTBOX_BATCH,
        select: { id: true, vkvideoChannelId: true, message: true, status: true, attempts: true },
      });
      if (rows.length === 0) return;

      for (const r of rows) {
        if (stoppedRef.value) return;
        const row = asRecord(r);
        const vkvideoChannelId = String(row.vkvideoChannelId ?? '').trim();
        const msg = normalizeMessage(row.message ?? '');
        if (!vkvideoChannelId || !msg) continue;

        const claim = await prismaAny.vkVideoChatBotOutboxMessage.updateMany({
          where: {
            id: row.id,
            OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
          },
          data: { status: 'processing', processingAt: new Date() },
        });
        if (claim.count === 0) continue;

        let lastError: string | null = null;
        try {
          logger.info('vkvideo_chatbot.outbox_send', {
            vkvideoChannelId,
            outboxId: row.id,
            attempts: Number(row.attempts || 0),
            messageLen: msg.length,
          });
          await sendToVkVideoChat({ vkvideoChannelId, text: msg });
          await prismaAny.vkVideoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: new Date(), lastError: null },
          });
          logger.info('vkvideo_chatbot.outbox_sent', {
            vkvideoChannelId,
            outboxId: row.id,
            attempts: Number(row.attempts || 0),
          });
        } catch (e: unknown) {
          lastError = getErrorMessage(e);
          const nextAttempts = Math.min(999, Math.max(0, Number(row.attempts || 0)) + 1);
          const nextStatus = nextAttempts >= MAX_SEND_ATTEMPTS ? 'failed' : 'pending';
          await prismaAny.vkVideoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: {
              status: nextStatus,
              attempts: nextAttempts,
              lastError,
              failedAt: nextStatus === 'failed' ? new Date() : null,
            },
          });
          logger.warn('vkvideo_chatbot.outbox_send_failed', {
            vkvideoChannelId,
            outboxId: row.id,
            attempts: nextAttempts,
            messageLen: msg.length,
            errorMessage: lastError,
          });
        }
      }
    } catch (e: unknown) {
      logger.warn('vkvideo_chatbot.outbox_processing_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      outboxProcessing = false;
    }
  };

  const startOutboxWorker = (): Worker<ChatOutboxJobData> | null => {
    if (!outboxBullmqEnabled) return null;
    const connection = getBullmqConnection();
    if (!connection) {
      logger.warn('chat.outbox.redis_missing', { platform: 'vkvideo' });
      return null;
    }

    const worker = new Worker<ChatOutboxJobData>(
      getChatOutboxQueueName('vkvideo'),
      async (job) => {
        if (stoppedRef.value) return;

        const outboxId = String(job.data?.outboxId ?? '').trim();
        if (!outboxId) {
          logger.warn('chat.outbox.job_missing_id', { jobId: job.id });
          return;
        }

        const row = await prismaAny.vkVideoChatBotOutboxMessage.findUnique({
          where: { id: outboxId },
          select: {
            id: true,
            channelId: true,
            vkvideoChannelId: true,
            message: true,
            status: true,
            attempts: true,
            processingAt: true,
          },
        });
        if (!row) return;
        if (row.status === 'sent' || row.status === 'failed') return;

        const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
        if (row.status === 'processing' && row.processingAt && row.processingAt > staleBefore) {
          await job.moveToDelayed(Date.now() + outboxLockDelayMs);
          throw new DelayedError();
        }

        const vkvideoChannelId = String(row.vkvideoChannelId ?? '').trim();
        const msg = normalizeMessage(row.message ?? '');
        if (!vkvideoChannelId || !msg) return;

        const mappedChannelId = vkvideoIdToChannelId.get(vkvideoChannelId);
        if (!mappedChannelId || mappedChannelId !== row.channelId) {
          await prismaAny.vkVideoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'pending', processingAt: null, lastError: 'channel_not_ready' },
          });
          await job.moveToDelayed(Date.now() + outboxLockDelayMs);
          throw new DelayedError();
        }

        let lockKey: string | null = null;
        const channelId = String(row.channelId ?? '').trim();
        if (channelId) {
          const lock = await acquireChatOutboxChannelLock({
            platform: 'vkvideo',
            channelId,
            ownerId: row.id,
            ttlMs: outboxLockTtlMs,
          });
          lockKey = lock.key;
          if (!lock.acquired) {
            await job.moveToDelayed(Date.now() + outboxLockDelayMs);
            throw new DelayedError();
          }
        }

        try {
          const claim = await prismaAny.vkVideoChatBotOutboxMessage.updateMany({
            where: {
              id: row.id,
              OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
            },
            data: { status: 'processing', processingAt: new Date() },
          });
          if (claim.count === 0) return;

          const latencyMs = Date.now() - (job.timestamp ?? Date.now());
          recordChatOutboxQueueLatency({ platform: 'vkvideo', latencySeconds: Math.max(0, latencyMs / 1000) });

          logger.info('vkvideo_chatbot.outbox_send', {
            vkvideoChannelId,
            outboxId: row.id,
            attempts: Number(row.attempts || 0),
            messageLen: msg.length,
          });
          await sendToVkVideoChat({ vkvideoChannelId, text: msg });
          await prismaAny.vkVideoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: new Date(), lastError: null },
          });
          logger.info('vkvideo_chatbot.outbox_sent', {
            vkvideoChannelId,
            outboxId: row.id,
            attempts: Number(row.attempts || 0),
          });
        } catch (e: unknown) {
          const lastError = getErrorMessage(e);
          const nextAttempts = Math.min(999, Math.max(0, Number(row.attempts || 0)) + 1);
          const nextStatus = nextAttempts >= MAX_SEND_ATTEMPTS ? 'failed' : 'pending';
          await prismaAny.vkVideoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: {
              status: nextStatus,
              attempts: nextAttempts,
              lastError,
              failedAt: nextStatus === 'failed' ? new Date() : null,
            },
          });
          logger.warn('vkvideo_chatbot.outbox_send_failed', {
            vkvideoChannelId,
            outboxId: row.id,
            attempts: nextAttempts,
            messageLen: msg.length,
            errorMessage: lastError,
          });
          throw e;
        } finally {
          if (lockKey) {
            await releaseChatOutboxChannelLock({ key: lockKey, ownerId: row.id });
          }
        }
      },
      {
        connection,
        prefix: getBullmqPrefix(),
        concurrency: outboxConcurrency,
        limiter: { max: outboxRateLimitMax, duration: outboxRateLimitWindowMs },
        settings: {
          backoffStrategy: (attemptsMade, _type, _err, job) =>
            computeChatOutboxBackoffMs(Math.max(1, attemptsMade), String(job?.data?.outboxId ?? '')),
        },
      }
    );

    worker.on('error', (err) => {
      const error = err as { message?: string };
      logger.error('chat.outbox.worker_error', { errorMessage: error?.message || String(err) });
    });
    worker.on('failed', (job, err) => {
      logger.warn('chat.outbox.job_failed', {
        outboxId: job?.data?.outboxId ?? null,
        attemptsMade: job?.attemptsMade ?? null,
        errorMessage: err?.message || String(err),
      });
    });

    logger.info('chat.outbox.worker_started', {
      platform: 'vkvideo',
      concurrency: outboxConcurrency,
      rateLimitMax: outboxRateLimitMax,
      rateLimitWindowMs: outboxRateLimitWindowMs,
    });

    return worker;
  };

  return { processOutboxOnce, startOutboxWorker };
}
