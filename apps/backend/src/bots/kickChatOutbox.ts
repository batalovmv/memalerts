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
import { asRecord, getErrorMessage, prismaAny, type KickChannelState } from './kickChatbotShared.js';
import { sendToKickChat } from './kickChatSender.js';

const MAX_OUTBOX_BATCH = 25;
const MAX_SEND_ATTEMPTS = 3;
const PROCESSING_STALE_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

type KickChatOutboxConfig = {
  outboxBullmqEnabled: boolean;
  outboxConcurrency: number;
  outboxRateLimitMax: number;
  outboxRateLimitWindowMs: number;
  outboxLockTtlMs: number;
  outboxLockDelayMs: number;
  stoppedRef: { value: boolean };
};

export function createKickChatOutbox(
  states: Map<string, KickChannelState>,
  config: KickChatOutboxConfig
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
      const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);

      const now = new Date();
      const rows = await prismaAny.kickChatBotOutboxMessage.findMany({
        where: {
          channelId: { in: channelIds },
          OR: [
            { status: 'pending', nextAttemptAt: { lte: now } },
            { status: 'processing', processingAt: { lt: staleBefore } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_OUTBOX_BATCH,
        select: {
          id: true,
          channelId: true,
          kickChannelId: true,
          message: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
        },
      });
      if (!rows.length) return;

      for (const r of rows) {
        if (stoppedRef.value) return;
        const row = asRecord(r);
        const channelId = String(row.channelId ?? '').trim();
        const st = states.get(channelId);
        if (!st) continue;

        const claim = await prismaAny.kickChatBotOutboxMessage.updateMany({
          where: { id: row.id, status: row.status },
          data: { status: 'processing', processingAt: new Date(), lastError: null },
        });
        if (claim.count !== 1) continue;

        try {
          const attempts = Number(row.attempts ?? 0) || 0;
          await sendToKickChat({ st, text: String(row.message ?? '') });
          await prismaAny.kickChatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: new Date(), attempts: attempts + 1, nextAttemptAt: new Date() },
          });
        } catch (e: unknown) {
          const attempts = Number(row.attempts ?? 0) || 0;
          const nextAttempts = attempts + 1;
          const lastError = getErrorMessage(e);
          const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
          const errRec = asRecord(e);
          const status = Number(errRec.kickStatus ?? errRec.status ?? 0) || 0;
          const retryAfterSeconds = Number(errRec.retryAfterSeconds ?? 0) || 0;
          const expBackoff = Math.min(
            MAX_BACKOFF_MS,
            BASE_BACKOFF_MS * Math.pow(2, Math.min(10, Math.max(0, nextAttempts - 1)))
          );
          const backoffMs = retryAfterSeconds > 0 ? Math.min(MAX_BACKOFF_MS, retryAfterSeconds * 1000) : expBackoff;
          const nextAttemptAt = new Date(Date.now() + backoffMs);
          await prismaAny.kickChatBotOutboxMessage.update({
            where: { id: row.id },
            data: shouldFail
              ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError, nextAttemptAt: new Date() }
              : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError, nextAttemptAt },
          });
          logger.warn('kick_chatbot.outbox_send_failed', {
            channelId: st.channelId,
            outboxId: row.id,
            attempts: nextAttempts,
            errorMessage: lastError,
            status,
            retryAfterSeconds: retryAfterSeconds > 0 ? retryAfterSeconds : null,
            backoffMs,
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
      logger.warn('chat.outbox.redis_missing', { platform: 'kick' });
      return null;
    }

    const worker = new Worker<ChatOutboxJobData>(
      getChatOutboxQueueName('kick'),
      async (job) => {
        if (stoppedRef.value) return;

        const outboxId = String(job.data?.outboxId ?? '').trim();
        if (!outboxId) {
          logger.warn('chat.outbox.job_missing_id', { jobId: job.id });
          return;
        }

        const row = await prismaAny.kickChatBotOutboxMessage.findUnique({
          where: { id: outboxId },
          select: {
            id: true,
            channelId: true,
            kickChannelId: true,
            message: true,
            status: true,
            attempts: true,
            processingAt: true,
            nextAttemptAt: true,
          },
        });
        if (!row) return;
        if (row.status === 'sent' || row.status === 'failed') return;

        if (row.status === 'pending' && row.nextAttemptAt && row.nextAttemptAt.getTime() > Date.now()) {
          await job.moveToDelayed(row.nextAttemptAt.getTime());
          throw new DelayedError();
        }

        const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
        if (row.status === 'processing' && row.processingAt && row.processingAt > staleBefore) {
          await job.moveToDelayed(Date.now() + outboxLockDelayMs);
          throw new DelayedError();
        }

        const channelId = String(row.channelId ?? '').trim();
        const st = channelId ? states.get(channelId) : undefined;
        if (!st) {
          await prismaAny.kickChatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'pending', processingAt: null, lastError: 'channel_not_ready' },
          });
          await job.moveToDelayed(Date.now() + outboxLockDelayMs);
          throw new DelayedError();
        }

        let lockKey: string | null = null;
        if (channelId) {
          const lock = await acquireChatOutboxChannelLock({
            platform: 'kick',
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
          const claim = await prismaAny.kickChatBotOutboxMessage.updateMany({
            where: { id: row.id, status: row.status },
            data: { status: 'processing', processingAt: new Date(), lastError: null },
          });
          if (claim.count !== 1) return;

          const latencyMs = Date.now() - (job.timestamp ?? Date.now());
          recordChatOutboxQueueLatency({ platform: 'kick', latencySeconds: Math.max(0, latencyMs / 1000) });

          const attempts = Number(row.attempts ?? 0) || 0;
          await sendToKickChat({ st, text: String(row.message ?? '') });
          await prismaAny.kickChatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: new Date(), attempts: attempts + 1, nextAttemptAt: new Date() },
          });
        } catch (e: unknown) {
          const attempts = Number(row.attempts ?? 0) || 0;
          const nextAttempts = attempts + 1;
          const lastError = getErrorMessage(e);
          const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
          const errRec = asRecord(e);
          const status = Number(errRec.kickStatus ?? errRec.status ?? 0) || 0;
          const retryAfterSeconds = Number(errRec.retryAfterSeconds ?? 0) || 0;
          const expBackoff = computeChatOutboxBackoffMs(nextAttempts, row.id);
          const backoffMs = retryAfterSeconds > 0 ? Math.min(MAX_BACKOFF_MS, retryAfterSeconds * 1000) : expBackoff;
          const nextAttemptAt = new Date(Date.now() + backoffMs);
          await prismaAny.kickChatBotOutboxMessage.update({
            where: { id: row.id },
            data: shouldFail
              ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError, nextAttemptAt: new Date() }
              : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError, nextAttemptAt },
          });
          logger.warn('kick_chatbot.outbox_send_failed', {
            channelId: st.channelId,
            outboxId: row.id,
            attempts: nextAttempts,
            errorMessage: lastError,
            status,
            retryAfterSeconds: retryAfterSeconds > 0 ? retryAfterSeconds : null,
            backoffMs,
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
      platform: 'kick',
      concurrency: outboxConcurrency,
      rateLimitMax: outboxRateLimitMax,
      rateLimitWindowMs: outboxRateLimitWindowMs,
    });

    return worker;
  };

  return { processOutboxOnce, startOutboxWorker };
}
