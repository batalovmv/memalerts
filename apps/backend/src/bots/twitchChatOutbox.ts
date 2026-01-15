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
import { asRecord, getErrorMessage, normalizeLogin, prismaAny, type BotClient } from './twitchChatbotShared.js';

const MAX_OUTBOX_BATCH = 25;
const MAX_SEND_ATTEMPTS = 3;
const PROCESSING_STALE_MS = 60_000;

type TwitchChatOutboxConfig = {
  outboxBullmqEnabled: boolean;
  outboxConcurrency: number;
  outboxRateLimitMax: number;
  outboxRateLimitWindowMs: number;
  outboxLockTtlMs: number;
  outboxLockDelayMs: number;
  stoppedRef: { value: boolean };
};

export function createTwitchChatOutbox(params: {
  loginToChannelId: Map<string, string>;
  joinedDefault: Set<string>;
  defaultClientRef: { value: BotClient | null };
  sayForChannel: (args: { channelId: string | null; twitchLogin: string; message: string }) => Promise<void>;
  config: TwitchChatOutboxConfig;
}) {
  const { loginToChannelId, joinedDefault, defaultClientRef, sayForChannel, config } = params;
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
    if (stoppedRef.value || !defaultClientRef.value) return;
    if (outboxProcessing) return;
    if (joinedDefault.size === 0) return;

    const channelIds = Array.from(loginToChannelId.values()).filter(Boolean);
    if (channelIds.length === 0) return;

    outboxProcessing = true;
    try {
      const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);

      const rows = await prismaAny.chatBotOutboxMessage.findMany({
        where: {
          channelId: { in: channelIds },
          OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_OUTBOX_BATCH,
        select: { id: true, twitchLogin: true, message: true, status: true, attempts: true },
      });
      if (rows.length === 0) return;

      for (const r of rows) {
        if (stoppedRef.value || !defaultClientRef.value) return;

        const row = asRecord(r);
        const login = normalizeLogin(String(row.twitchLogin ?? ''));
        if (!login) continue;
        if (!joinedDefault.has(login)) continue;

        const claim = await prismaAny.chatBotOutboxMessage.updateMany({
          where: { id: row.id, status: row.status },
          data: { status: 'processing', processingAt: new Date(), lastError: null },
        });
        if (claim.count !== 1) continue;

        try {
          const channelId = loginToChannelId.get(login) || null;
          const message = String(row.message ?? '');
          const attempts = Number(row.attempts ?? 0) || 0;
          await sayForChannel({ channelId, twitchLogin: login, message });
          await prismaAny.chatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: new Date(), attempts: attempts + 1 },
          });
        } catch (e: unknown) {
          const attempts = Number(row.attempts ?? 0) || 0;
          const nextAttempts = attempts + 1;
          const lastError = getErrorMessage(e);
          const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
          await prismaAny.chatBotOutboxMessage.update({
            where: { id: row.id },
            data: shouldFail
              ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError }
              : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError },
          });
          logger.warn('chatbot.outbox_send_failed', {
            login,
            outboxId: row.id,
            attempts: nextAttempts,
            errorMessage: lastError,
          });
        }
      }
    } finally {
      outboxProcessing = false;
    }
  };

  const startOutboxWorker = (): Worker<ChatOutboxJobData> | null => {
    if (!outboxBullmqEnabled) return null;
    const connection = getBullmqConnection();
    if (!connection) {
      logger.warn('chat.outbox.redis_missing', { platform: 'twitch' });
      return null;
    }

    const worker = new Worker<ChatOutboxJobData>(
      getChatOutboxQueueName('twitch'),
      async (job) => {
        if (stoppedRef.value || !defaultClientRef.value) return;

        const outboxId = String(job.data?.outboxId ?? '').trim();
        if (!outboxId) {
          logger.warn('chat.outbox.job_missing_id', { jobId: job.id });
          return;
        }

        const row = await prismaAny.chatBotOutboxMessage.findUnique({
          where: { id: outboxId },
          select: {
            id: true,
            channelId: true,
            twitchLogin: true,
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

        const login = normalizeLogin(String(row.twitchLogin ?? ''));
        if (!login) {
          await prismaAny.chatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'failed', failedAt: new Date(), lastError: 'invalid_login' },
          });
          return;
        }

        const channelId = String(row.channelId ?? '').trim();
        let lockKey: string | null = null;
        if (channelId) {
          const lock = await acquireChatOutboxChannelLock({
            platform: 'twitch',
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
          const claim = await prismaAny.chatBotOutboxMessage.updateMany({
            where: { id: row.id, status: row.status },
            data: { status: 'processing', processingAt: new Date(), lastError: null },
          });
          if (claim.count !== 1) return;

          const latencyMs = Date.now() - (job.timestamp ?? Date.now());
          recordChatOutboxQueueLatency({ platform: 'twitch', latencySeconds: Math.max(0, latencyMs / 1000) });

          if (!joinedDefault.has(login)) {
            try {
              await defaultClientRef.value.client.join(login);
              joinedDefault.add(login);
            } catch {
              await prismaAny.chatBotOutboxMessage.update({
                where: { id: row.id },
                data: { status: 'pending', processingAt: null, lastError: 'join_pending' },
              });
              await job.moveToDelayed(Date.now() + outboxLockDelayMs);
              throw new DelayedError();
            }
          }

          const attempts = Number(row.attempts ?? 0) || 0;
          await sayForChannel({ channelId: channelId || null, twitchLogin: login, message: String(row.message ?? '') });
          await prismaAny.chatBotOutboxMessage.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: new Date(), attempts: attempts + 1 },
          });
        } catch (e: unknown) {
          const attempts = Number(row.attempts ?? 0) || 0;
          const nextAttempts = attempts + 1;
          const lastError = getErrorMessage(e);
          const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
          await prismaAny.chatBotOutboxMessage.update({
            where: { id: row.id },
            data: shouldFail
              ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError }
              : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError },
          });
          logger.warn('chatbot.outbox_send_failed', {
            login,
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
      concurrency: outboxConcurrency,
      rateLimitMax: outboxRateLimitMax,
      rateLimitWindowMs: outboxRateLimitWindowMs,
    });

    return worker;
  };

  return { processOutboxOnce, startOutboxWorker };
}
