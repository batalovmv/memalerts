import '../config/loadEnv.js';
import '../tracing/init.js';
import type { Worker } from 'bullmq';
import { startServiceHeartbeat } from '../utils/serviceHeartbeat.js';
import { validateVkvideoChatbotEnv } from './env.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../lib/prisma.js';
import { type ChatOutboxJobData } from '../queues/chatOutboxQueue.js';
import type { VkVideoPubSubClient } from './vkvideoPubsubClient.js';
import { clampInt, parseBool, parseIntSafe } from './vkvideoChatbotShared.js';
import {
  createVkvideoChatCommands,
  type StreamDurationCfg,
  type VkvideoChatCommandState,
  type VkvideoCommandItem,
} from './vkvideoChatCommands.js';
import { createVkvideoStreamEvents } from './vkvideoStreamEvents.js';
import { createVkvideoChatOutbox } from './vkvideoChatOutbox.js';

validateVkvideoChatbotEnv();

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
  const enabled = String(process.env.VKVIDEO_CHAT_BOT_ENABLED || '')
    .trim()
    .toLowerCase();
  if (!(enabled === '1' || enabled === 'true' || enabled === 'yes' || enabled === 'on')) {
    logger.info('vkvideo_chatbot.disabled', {});
    return;
  }

  const backendBaseUrls = parseBaseUrls();
  const syncSeconds = Math.max(5, parseIntSafe(process.env.VKVIDEO_CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.VKVIDEO_CHATBOT_OUTBOX_POLL_MS, 1_000));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.VKVIDEO_CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  const outboxBullmqEnabled = parseBool(process.env.CHAT_OUTBOX_BULLMQ_ENABLED);
  const outboxConcurrency = clampInt(parseInt(String(process.env.VKVIDEO_CHAT_OUTBOX_CONCURRENCY || ''), 10), 1, 10, 2);
  const outboxRateLimitMax = clampInt(
    parseInt(String(process.env.VKVIDEO_CHAT_OUTBOX_RATE_LIMIT_MAX || ''), 10),
    1,
    60,
    20
  );
  const outboxRateLimitWindowMs = clampInt(
    parseInt(String(process.env.VKVIDEO_CHAT_OUTBOX_RATE_LIMIT_WINDOW_MS || ''), 10),
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
  const userRolesCacheTtlMs = Math.max(5_000, parseIntSafe(process.env.VKVIDEO_USER_ROLES_CACHE_TTL_MS, 30_000));

  // Avoid pubsub reconnect churn: refresh connect/subscription tokens at most once per N seconds per channel.
  const pubsubRefreshSeconds = Math.max(30, parseIntSafe(process.env.VKVIDEO_PUBSUB_REFRESH_SECONDS, 600));
  const pubsubWsUrl =
    String(process.env.VKVIDEO_PUBSUB_WS_URL || '').trim() ||
    'wss://pubsub-dev.live.vkvideo.ru/connection/websocket?format=json&cf_protocol_version=v2';

  if (backendBaseUrls.length === 0) {
    logger.error('vkvideo_chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  const heartbeat = startServiceHeartbeat({ service: 'chatbot-vkvideo' });
  const stoppedRef = { value: false };

  let subscriptionsTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;
  let commandsTimer: NodeJS.Timeout | null = null;
  let outboxWorker: Worker<ChatOutboxJobData> | null = null;

  const vkvideoIdToSlug = new Map<string, string>();
  const vkvideoIdToChannelId = new Map<string, string>();
  const vkvideoIdToOwnerUserId = new Map<string, string>();
  const vkvideoIdToChannelUrl = new Map<string, string>();
  const vkvideoIdToLastLiveStreamId = new Map<string, string | null>();
  const streamDurationCfgByChannelId = new Map<string, { ts: number; cfg: StreamDurationCfg | null }>();
  const commandsByChannelId = new Map<string, { ts: number; items: VkvideoCommandItem[] }>();
  const autoRewardsByChannelId = new Map<string, { ts: number; cfg: unknown | null }>();
  const userRolesCache = new Map<string, { ts: number; roleIds: string[] }>();

  const chatState: VkvideoChatCommandState = {
    vkvideoIdToSlug,
    vkvideoIdToChannelId,
    vkvideoIdToOwnerUserId,
    vkvideoIdToChannelUrl,
    vkvideoIdToLastLiveStreamId,
    streamDurationCfgByChannelId,
    commandsByChannelId,
    autoRewardsByChannelId,
    userRolesCache,
  };

  const pubsubByChannelId = new Map<string, VkVideoPubSubClient>();
  const pubsubCtxByChannelId = new Map<string, { tokenFetchedAt: number; wsChannelsKey: string }>();
  const wsChannelToVkvideoId = new Map<string, string>();

  const chatCommands = createVkvideoChatCommands(chatState, {
    backendBaseUrls,
    commandsRefreshSeconds,
    userRolesCacheTtlMs,
    stoppedRef,
  });

  const chatOutbox = createVkvideoChatOutbox(
    { vkvideoIdToChannelId },
    {
      outboxBullmqEnabled,
      outboxConcurrency,
      outboxRateLimitMax,
      outboxRateLimitWindowMs,
      outboxLockTtlMs,
      outboxLockDelayMs,
      stoppedRef,
    },
    chatCommands.sendToVkVideoChat
  );

  const streamEvents = createVkvideoStreamEvents(
    chatState,
    { pubsubByChannelId, pubsubCtxByChannelId, wsChannelToVkvideoId },
    { pubsubWsUrl, pubsubRefreshSeconds, stoppedRef },
    { handleIncoming: chatCommands.handleIncoming }
  );

  const shutdown = async () => {
    stoppedRef.value = true;
    if (subscriptionsTimer) clearInterval(subscriptionsTimer);
    if (outboxTimer) clearInterval(outboxTimer);
    if (commandsTimer) clearInterval(commandsTimer);
    heartbeat.stop();
    if (outboxWorker) {
      try {
        await outboxWorker.close();
      } catch {
        // ignore
      } finally {
        outboxWorker = null;
      }
    }
    for (const c of Array.from(pubsubByChannelId.values())) {
      try {
        c.stop();
      } catch {
        // ignore
      }
    }
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  await prisma.$connect();
  await streamEvents.syncSubscriptions();
  void chatCommands.refreshCommands();
  subscriptionsTimer = setInterval(() => void streamEvents.syncSubscriptions(), syncSeconds * 1000);
  if (outboxBullmqEnabled) {
    outboxWorker = chatOutbox.startOutboxWorker();
  } else {
    outboxTimer = setInterval(() => void chatOutbox.processOutboxOnce(), outboxPollMs);
  }
  commandsTimer = setInterval(() => void chatCommands.refreshCommands(), commandsRefreshSeconds * 1000);

  logger.info('vkvideo_chatbot.started', { syncSeconds, outboxPollMs, commandsRefreshSeconds });
}

void start().catch((e: unknown) => {
  logger.error('vkvideo_chatbot.fatal', { errorMessage: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
