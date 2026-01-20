import '../config/loadEnv.js';
import '../tracing/init.js';
import type { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { startServiceHeartbeat } from '../utils/serviceHeartbeat.js';
import { type ChatOutboxJobData } from '../queues/chatOutboxQueue.js';
import { validateKickChatbotEnv } from './env.js';
import { clampInt, parseBool, parseIntSafe, type KickChannelState } from './kickChatbotShared.js';
import { createKickChatCommands } from './kickChatCommands.js';
import { createKickChatSubscriptions } from './kickChatSubscriptions.js';
import { createKickChatOutbox } from './kickChatOutbox.js';
import { createKickChatIngest } from './kickChatIngest.js';
import { createKickEventSubscriptions } from './kickEventSubscriptions.js';

validateKickChatbotEnv();

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

function parseKickChatPollUrlTemplate(): string | null {
  const tpl = String(process.env.KICK_CHAT_POLL_URL_TEMPLATE || '').trim();
  return tpl || null;
}

async function start() {
  const backendBaseUrls = parseBaseUrls();
  if (backendBaseUrls.length === 0) {
    logger.error('kick_chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  const enabled = String(process.env.KICK_CHAT_BOT_ENABLED || '')
    .trim()
    .toLowerCase();
  if (enabled === '0' || enabled === 'false' || enabled === 'off') {
    logger.info('kick_chatbot.disabled_by_env');
    process.exit(0);
  }

  const syncSeconds = Math.max(5, parseIntSafe(process.env.KICK_CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.KICK_CHATBOT_OUTBOX_POLL_MS, 1_000));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.KICK_CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  const ingestPollMs = Math.max(250, parseIntSafe(process.env.KICK_CHATBOT_INGEST_POLL_MS, 1_000));
  const outboxBullmqEnabled = parseBool(process.env.CHAT_OUTBOX_BULLMQ_ENABLED);
  const outboxConcurrency = clampInt(parseInt(String(process.env.KICK_CHAT_OUTBOX_CONCURRENCY || ''), 10), 1, 10, 2);
  const outboxRateLimitMax = clampInt(
    parseInt(String(process.env.KICK_CHAT_OUTBOX_RATE_LIMIT_MAX || ''), 10),
    1,
    60,
    20
  );
  const outboxRateLimitWindowMs = clampInt(
    parseInt(String(process.env.KICK_CHAT_OUTBOX_RATE_LIMIT_WINDOW_MS || ''), 10),
    1_000,
    60_000,
    30_000
  );
  const outboxChannelRateLimitMax = clampInt(
    parseInt(String(process.env.KICK_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_MAX || ''), 10),
    1,
    60,
    10
  );
  const outboxChannelRateLimitWindowMs = clampInt(
    parseInt(String(process.env.KICK_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_WINDOW_MS || ''), 10),
    1_000,
    60_000,
    20_000
  );
  const outboxDedupWindowMs = clampInt(
    parseInt(String(process.env.KICK_CHAT_OUTBOX_DEDUP_WINDOW_MS || ''), 10),
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

  const chatPollUrlTemplate = parseKickChatPollUrlTemplate();
  const heartbeat = startServiceHeartbeat({ service: 'chatbot-kick' });
  const stoppedRef = { value: false };

  const states = new Map<string, KickChannelState>();

  let syncTimer: NodeJS.Timeout | null = null;
  let eventSubTimer: NodeJS.Timeout | null = null;
  let commandsTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;
  let ingestTimer: NodeJS.Timeout | null = null;
  let outboxWorker: Worker<ChatOutboxJobData> | null = null;

  const subscriptions = createKickChatSubscriptions({ states, stoppedRef });
  const chatCommands = createKickChatCommands(states, { backendBaseUrls, commandsRefreshSeconds, stoppedRef });
  const chatOutbox = createKickChatOutbox(states, {
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
  const chatIngest = createKickChatIngest(states, chatCommands, { chatPollUrlTemplate, stoppedRef });
  const eventSubs = createKickEventSubscriptions({ states, stoppedRef });

  const shutdown = async () => {
    stoppedRef.value = true;
    if (syncTimer) clearInterval(syncTimer);
    if (eventSubTimer) clearInterval(eventSubTimer);
    if (commandsTimer) clearInterval(commandsTimer);
    if (outboxTimer) clearInterval(outboxTimer);
    if (ingestTimer) clearInterval(ingestTimer);
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
  await chatCommands.refreshCommands();
  await eventSubs.ensureKickEventSubscriptions();
  syncTimer = setInterval(() => void subscriptions.syncSubscriptions(), syncSeconds * 1000);
  eventSubTimer = setInterval(() => void eventSubs.ensureKickEventSubscriptions(), syncSeconds * 1000);
  commandsTimer = setInterval(() => void chatCommands.refreshCommands(), commandsRefreshSeconds * 1000);
  if (outboxBullmqEnabled) {
    outboxWorker = chatOutbox.startOutboxWorker();
  } else {
    outboxTimer = setInterval(() => void chatOutbox.processOutboxOnce(), outboxPollMs);
  }
  ingestTimer = setInterval(() => void chatIngest.ingestChatOnce(), ingestPollMs);

  logger.info('kick_chatbot.started', {
    syncSeconds,
    commandsRefreshSeconds,
    outboxPollMs,
    ingestPollMs,
    hasChatIngest: Boolean(chatPollUrlTemplate),
  });
}

void start().catch((e: unknown) => {
  logger.error('kick_chatbot.fatal', { errorMessage: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
