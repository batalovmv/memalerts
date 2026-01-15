import { DelayedError, Worker } from 'bullmq';
import { getBullmqConnection, getBullmqPrefix } from '../queues/bullmqConnection.js';
import { acquireChatOutboxChannelLock, releaseChatOutboxChannelLock } from '../queues/chatOutboxLock.js';
import {
  type ChatOutboxJobData,
  computeChatOutboxBackoffMs,
  getChatOutboxQueueName,
} from '../queues/chatOutboxQueue.js';
import { recordChatOutboxQueueLatency } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';
import { asRecord, getErrorMessage, prismaAny, type TrovoChannelState } from './trovoChatbotShared.js';
import { sendToTrovoChat } from './trovoChatCommands.js';

const MAX_OUTBOX_BATCH = 25;
const MAX_SEND_ATTEMPTS = 3;
const PROCESSING_STALE_MS = 60_000;

type TrovoChatOutboxConfig = {
  outboxBullmqEnabled: boolean;
  outboxConcurrency: number;
  outboxRateLimitMax: number;
  outboxRateLimitWindowMs: number;
  outboxLockTtlMs: number;
  outboxLockDelayMs: number;
  stoppedRef: { value: boolean };
};

export function createTrovoChatOutbox(
  states: Map<string, TrovoChannelState>,
  config: TrovoChatOutboxConfig
) {
  const {
    outboxBullmqEnabled,
    outboxConcurrency,
    outboxRateLimitMax,
    outboxRateLimitWindowMs,
    outboxLockTtlMs,
    outboxLockDelayMs,
    stoppedRef,
  } = config;
  let outboxInFlight = false;

  const processOutboxOnce = async () => {
    if (stoppedRef.value) return;
    if (outboxInFlight) return;
    outboxInFlight = true;
    try {
      if (states.size === 0) return;
      const channelIds = Array.from(states.keys());
      if (channelIds.length === 0) return;
      const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);

      const rows = await prismaAny.trovoChatBotOutboxMessage.findMany({
        where: {
          channelId: { in: channelIds },
          OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_OUTBOX_BATCH,
        select: { id: true, channelId: true, trovoChannelId: true, message: true, status: true, attempts: true },
      });
      if (!rows.length) return;

      for (const r of rows) {
        if (stoppedRef.value) return;
        const row = asRecord(r);
        const channelId = String(row.channelId ?? '').trim();
        const st = states.get(channelId);
        if (!st) continue;

        // Claim
        const claim = await prismaAny.trovoChatBotOutboxMessage.updateMany({
          where: { id: row.id, status: row.status },
          data: { status: 'processing', processingAt: new Date(), lastError: null },
        });
        if (claim.count !== 1) continue;

        try {
          const attempts = Number(row.attempts ?? 0) || 0;
          await sendToTrovoChat({ st, text: String(row.message ?? '') });
          await prismaAny.trovoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: new Date(), attempts: attempts + 1 },
          });
        } catch (e: unknown) {
          const attempts = Number(row.attempts ?? 0) || 0;
          const nextAttempts = attempts + 1;
          const lastError = getErrorMessage(e);
          const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
          await prismaAny.trovoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: shouldFail
              ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError }
              : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError },
          });
          logger.warn('trovo_chatbot.outbox_send_failed', {
            channelId: st.channelId,
            outboxId: row.id,
            attempts: nextAttempts,
            errorMessage: lastError,
          });
        }
      }
    } finally {
      outboxInFlight = false;
    }
  };

  const startOutboxWorker = (): Worker<ChatOutboxJobData> | null => {
    if (!outboxBullmqEnabled) return null;
    const connection = getBullmqConnection();
    if (!connection) {
      logger.warn('chat.outbox.redis_missing', { platform: 'trovo' });
      return null;
    }

    const worker = new Worker<ChatOutboxJobData>(
      getChatOutboxQueueName('trovo'),
      async (job) => {
        if (stoppedRef.value) return;

        const outboxId = String(job.data?.outboxId ?? '').trim();
        if (!outboxId) {
          logger.warn('chat.outbox.job_missing_id', { jobId: job.id });
          return;
        }

        const row = await prismaAny.trovoChatBotOutboxMessage.findUnique({
          where: { id: outboxId },
          select: {
            id: true,
            channelId: true,
            trovoChannelId: true,
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

        const channelId = String(row.channelId ?? '').trim();
        const st = channelId ? states.get(channelId) : undefined;
        if (!st) {
          await prismaAny.trovoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'pending', processingAt: null, lastError: 'channel_not_ready' },
          });
          await job.moveToDelayed(Date.now() + outboxLockDelayMs);
          throw new DelayedError();
        }

        let lockKey: string | null = null;
        if (channelId) {
          const lock = await acquireChatOutboxChannelLock({
            platform: 'trovo',
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
          const claim = await prismaAny.trovoChatBotOutboxMessage.updateMany({
            where: { id: row.id, status: row.status },
            data: { status: 'processing', processingAt: new Date(), lastError: null },
          });
          if (claim.count !== 1) return;

          const latencyMs = Date.now() - (job.timestamp ?? Date.now());
          recordChatOutboxQueueLatency({ platform: 'trovo', latencySeconds: Math.max(0, latencyMs / 1000) });

          const attempts = Number(row.attempts ?? 0) || 0;
          await sendToTrovoChat({ st, text: String(row.message ?? '') });
          await prismaAny.trovoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: new Date(), attempts: attempts + 1 },
          });
        } catch (e: unknown) {
          const attempts = Number(row.attempts ?? 0) || 0;
          const nextAttempts = attempts + 1;
          const lastError = getErrorMessage(e);
          const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
          await prismaAny.trovoChatBotOutboxMessage.update({
            where: { id: row.id },
            data: shouldFail
              ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError }
              : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError },
          });
          logger.warn('trovo_chatbot.outbox_send_failed', {
            channelId: st.channelId,
            outboxId: row.id,
            attempts: nextAttempts,
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
      platform: 'trovo',
      concurrency: outboxConcurrency,
      rateLimitMax: outboxRateLimitMax,
      rateLimitWindowMs: outboxRateLimitWindowMs,
    });

    return worker;
  };

  return { processOutboxOnce, startOutboxWorker };
}
