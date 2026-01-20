import '../config/loadEnv.js';
import '../tracing/init.js';
import type { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { startServiceHeartbeat } from '../utils/serviceHeartbeat.js';
import { type ChatOutboxJobData } from '../queues/chatOutboxQueue.js';
import { validateYoutubeChatbotEnv } from './env.js';
import { clampInt, parseBool, parseIntSafe, type YouTubeChannelState } from './youtubeChatbotShared.js';
import { createYouTubeChatSubscriptions } from './youtubeChatSubscriptions.js';
import { createYouTubeChatCommands } from './youtubeChatCommands.js';
import { createYouTubeChatPolling } from './youtubeChatPolling.js';
import { createYouTubeChatOutbox } from './youtubeChatOutbox.js';

validateYoutubeChatbotEnv();

function parseBaseUrls(): string[] {
  const raw = String(process.env.CHATBOT_BACKEND_BASE_URLS || '').trim();
  if (raw) {
    const urls = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(urls));
  }
  const single = String(process.env.CHATBOT_BACKEND_BASE_URL || '').trim();
  return single ? [single] : [];
}

async function start() {
  const backendBaseUrls = parseBaseUrls();
  const syncSeconds = Math.max(5, parseIntSafe(process.env.YOUTUBE_CHATBOT_SYNC_SECONDS, 20));
  const liveCheckSeconds = Math.max(5, parseIntSafe(process.env.YOUTUBE_CHATBOT_LIVE_CHECK_SECONDS, 20));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.YOUTUBE_CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  const outboxPollMs = Math.max(500, parseIntSafe(process.env.YOUTUBE_CHATBOT_OUTBOX_POLL_MS, 1_000));
  const outboxBullmqEnabled = parseBool(process.env.CHAT_OUTBOX_BULLMQ_ENABLED);
  const outboxConcurrency = clampInt(parseInt(String(process.env.YOUTUBE_CHAT_OUTBOX_CONCURRENCY || ''), 10), 1, 10, 2);
  const outboxRateLimitMax = clampInt(
    parseInt(String(process.env.YOUTUBE_CHAT_OUTBOX_RATE_LIMIT_MAX || ''), 10),
    1,
    60,
    20
  );
  const outboxRateLimitWindowMs = clampInt(
    parseInt(String(process.env.YOUTUBE_CHAT_OUTBOX_RATE_LIMIT_WINDOW_MS || ''), 10),
    1_000,
    60_000,
    30_000
  );
  const outboxChannelRateLimitMax = clampInt(
    parseInt(String(process.env.YOUTUBE_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_MAX || ''), 10),
    1,
    60,
    10
  );
  const outboxChannelRateLimitWindowMs = clampInt(
    parseInt(String(process.env.YOUTUBE_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_WINDOW_MS || ''), 10),
    1_000,
    60_000,
    20_000
  );
  const outboxDedupWindowMs = clampInt(
    parseInt(String(process.env.YOUTUBE_CHAT_OUTBOX_DEDUP_WINDOW_MS || ''), 10),
    1_000,
    5 * 60_000,
    30_000
  );
  const outboxLockTtlMs = clampInt(
    parseInt(String(process.env.CHAT_OUTBOX_CHANNEL_LOCK_TTL_MS || ''), 10),
    5_000,
    5 * 60_000,
    30_000
  );
  const outboxLockDelayMs = clampInt(
    parseInt(String(process.env.CHAT_OUTBOX_LOCK_DELAY_MS || ''), 10),
    250,
    60_000,
    1_000
  );

  if (backendBaseUrls.length === 0) {
    logger.error('youtube_chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  const heartbeat = startServiceHeartbeat({ service: 'chatbot-youtube' });
  const stoppedRef = { value: false };

  let syncTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;
  let outboxWorker: Worker<ChatOutboxJobData> | null = null;

  const states = new Map<string, YouTubeChannelState>();

  const subscriptions = createYouTubeChatSubscriptions({ states, stoppedRef });
  const chatCommands = createYouTubeChatCommands(states, { backendBaseUrls, commandsRefreshSeconds, stoppedRef });
  const chatPolling = createYouTubeChatPolling(states, chatCommands, { liveCheckSeconds, stoppedRef });
  const chatOutbox = createYouTubeChatOutbox(states, {
    outboxBullmqEnabled,
    outboxConcurrency,
    outboxRateLimitMax,
    outboxRateLimitWindowMs,
    outboxChannelRateLimitMax,
    outboxChannelRateLimitWindowMs,
    outboxDedupWindowMs,
    outboxLockTtlMs,
    outboxLockDelayMs,
    stoppedRef,
  });

  const shutdown = async () => {
    stoppedRef.value = true;
    if (syncTimer) clearInterval(syncTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (outboxTimer) clearInterval(outboxTimer);
    if (outboxWorker) {
      try {
        await outboxWorker.close();
      } catch {
        // ignore
      } finally {
        outboxWorker = null;
      }
    }
    heartbeat.stop();
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  await prisma.$connect();
  await subscriptions.syncSubscriptions();
  syncTimer = setInterval(() => void subscriptions.syncSubscriptions(), syncSeconds * 1000);
  pollTimer = setInterval(() => void chatPolling.pollChatsOnce(), 1_000);
  if (outboxBullmqEnabled) {
    outboxWorker = chatOutbox.startOutboxWorker();
  } else {
    outboxTimer = setInterval(() => void chatOutbox.processOutboxOnce(), outboxPollMs);
  }

  logger.info('youtube_chatbot.started', { syncSeconds, liveCheckSeconds, commandsRefreshSeconds, outboxPollMs });
}

void start().catch((e: unknown) => {
  logger.error('youtube_chatbot.fatal', { errorMessage: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
