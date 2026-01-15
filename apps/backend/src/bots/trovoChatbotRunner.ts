import '../config/loadEnv.js';
import '../tracing/init.js';
import type { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { startServiceHeartbeat } from '../utils/serviceHeartbeat.js';
import { type ChatOutboxJobData } from '../queues/chatOutboxQueue.js';
import { validateTrovoChatbotEnv } from './env.js';
import { clampInt, parseBool, parseIntSafe, type TrovoChannelState } from './trovoChatbotShared.js';
import { createTrovoChatCommands } from './trovoChatCommands.js';
import { createTrovoChatOutbox } from './trovoChatOutbox.js';
import { createTrovoRewardProcessor } from './trovoRewardProcessor.js';
import { createTrovoStreamEvents } from './trovoStreamEvents.js';

validateTrovoChatbotEnv();

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

function parseTrovoChatWsUrl(): string {
  return String(process.env.TROVO_CHAT_WS_URL || '').trim() || 'wss://open-chat.trovo.live/chat';
}

async function start() {
  const backendBaseUrls = parseBaseUrls();
  if (backendBaseUrls.length === 0) {
    logger.error('trovo_chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  const enabled = String(process.env.TROVO_CHAT_BOT_ENABLED || '')
    .trim()
    .toLowerCase();
  if (enabled === '0' || enabled === 'false' || enabled === 'off') {
    logger.info('trovo_chatbot.disabled_by_env');
    process.exit(0);
  }

  const syncSeconds = Math.max(5, parseIntSafe(process.env.TROVO_CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.TROVO_CHATBOT_OUTBOX_POLL_MS, 1_000));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.TROVO_CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  const outboxBullmqEnabled = parseBool(process.env.CHAT_OUTBOX_BULLMQ_ENABLED);
  const outboxConcurrency = clampInt(
    parseInt(String(process.env.TROVO_CHAT_OUTBOX_CONCURRENCY || ''), 10),
    1,
    10,
    2
  );
  const outboxRateLimitMax = clampInt(
    parseInt(String(process.env.TROVO_CHAT_OUTBOX_RATE_LIMIT_MAX || ''), 10),
    1,
    60,
    20
  );
  const outboxRateLimitWindowMs = clampInt(
    parseInt(String(process.env.TROVO_CHAT_OUTBOX_RATE_LIMIT_WINDOW_MS || ''), 10),
    1_000,
    60_000,
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
  const wsUrl = parseTrovoChatWsUrl();

  const heartbeat = startServiceHeartbeat({ service: 'chatbot-trovo' });
  const stoppedRef = { value: false };

  let syncTimer: NodeJS.Timeout | null = null;
  let commandsTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;
  let outboxWorker: Worker<ChatOutboxJobData> | null = null;

  const states = new Map<string, TrovoChannelState>();

  const chatCommands = createTrovoChatCommands(states, {
    backendBaseUrls,
    commandsRefreshSeconds,
    stoppedRef,
  });

  const rewardProcessor = createTrovoRewardProcessor();

  const streamEvents = createTrovoStreamEvents(
    states,
    { wsUrl, stoppedRef },
    { handleIncomingChat: chatCommands.handleIncomingChat, handleChatRewards: rewardProcessor.handleChatRewards }
  );

  const chatOutbox = createTrovoChatOutbox(states, {
    outboxBullmqEnabled,
    outboxConcurrency,
    outboxRateLimitMax,
    outboxRateLimitWindowMs,
    outboxLockTtlMs,
    outboxLockDelayMs,
    stoppedRef,
  });

  const shutdown = async () => {
    stoppedRef.value = true;
    if (syncTimer) clearInterval(syncTimer);
    if (commandsTimer) clearInterval(commandsTimer);
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
    await streamEvents.disconnectAll();
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
  await streamEvents.syncSubscriptions();
  await chatCommands.refreshCommands();
  syncTimer = setInterval(() => void streamEvents.syncSubscriptions(), syncSeconds * 1000);
  commandsTimer = setInterval(() => void chatCommands.refreshCommands(), commandsRefreshSeconds * 1000);
  if (outboxBullmqEnabled) {
    outboxWorker = chatOutbox.startOutboxWorker();
  } else {
    outboxTimer = setInterval(() => void chatOutbox.processOutboxOnce(), outboxPollMs);
  }

  logger.info('trovo_chatbot.started', { syncSeconds, commandsRefreshSeconds, outboxPollMs, wsUrl });
}

void start().catch((e: unknown) => {
  logger.error('trovo_chatbot.fatal', { errorMessage: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
