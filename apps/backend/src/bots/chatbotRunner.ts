import '../config/loadEnv.js';
import '../tracing/init.js';
import tmi from 'tmi.js';
import type { Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import {
  getValidAccessToken,
  getValidTwitchBotAccessToken,
  refreshAccessToken,
  refreshTwitchBotAccessToken,
} from '../utils/twitchApi.js';
import { logger } from '../utils/logger.js';
import { startServiceHeartbeat } from '../utils/serviceHeartbeat.js';
import { validateChatbotEnv } from './env.js';
import {
  clampInt,
  isTwitchAuthError,
  normalizeLogin,
  parseBool,
  parseIntSafe,
  type BotClient,
} from './twitchChatbotShared.js';
import { createReconnectBackoff } from './reconnectBackoff.js';
import { createTwitchChatOutbox } from './twitchChatOutbox.js';
import { createTwitchChatSubscriptions } from './twitchChatSubscriptions.js';
import { resolveBotUserId, sayForChannel } from './twitchChatClients.js';
import { registerVoteChatListener } from './voteChatListener.js';
import { type ChatOutboxJobData } from '../queues/chatOutboxQueue.js';

validateChatbotEnv();

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
  let defaultBotLogin = normalizeLogin(String(process.env.CHAT_BOT_LOGIN || ''));
  let defaultBotUserId: string | null = null;
  const dbDefault = await getValidTwitchBotAccessToken();
  if (dbDefault?.login && dbDefault.accessToken) {
    defaultBotLogin = normalizeLogin(dbDefault.login);
  } else {
    defaultBotUserId = await resolveBotUserId();
  }

  const syncSeconds = Math.max(5, parseIntSafe(process.env.CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.CHATBOT_OUTBOX_POLL_MS, 1_000));
  const outboxBullmqEnabled = parseBool(process.env.CHAT_OUTBOX_BULLMQ_ENABLED);
  const outboxConcurrency = clampInt(parseInt(String(process.env.TWITCH_CHAT_OUTBOX_CONCURRENCY || ''), 10), 1, 10, 2);
  const outboxRateLimitMax = clampInt(
    parseInt(String(process.env.TWITCH_CHAT_OUTBOX_RATE_LIMIT_MAX || ''), 10),
    1,
    100,
    20
  );
  const outboxRateLimitWindowMs = clampInt(
    parseInt(String(process.env.TWITCH_CHAT_OUTBOX_RATE_LIMIT_WINDOW_MS || ''), 10),
    1_000,
    60_000,
    30_000
  );
  const outboxChannelRateLimitMax = clampInt(
    parseInt(String(process.env.TWITCH_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_MAX || ''), 10),
    1,
    100,
    10
  );
  const outboxChannelRateLimitWindowMs = clampInt(
    parseInt(String(process.env.TWITCH_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_WINDOW_MS || ''), 10),
    1_000,
    60_000,
    20_000
  );
  const outboxDedupWindowMs = clampInt(
    parseInt(String(process.env.TWITCH_CHAT_OUTBOX_DEDUP_WINDOW_MS || ''), 10),
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
  const backendBaseUrls = parseBaseUrls();

  if (!defaultBotLogin) {
    logger.error('chatbot.missing_env', { key: 'CHAT_BOT_LOGIN' });
    process.exit(1);
  }
  if (backendBaseUrls.length === 0) {
    logger.error('chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  const heartbeat = startServiceHeartbeat({ service: 'chatbot-twitch' });
  const stoppedRef = { value: false };

  let subscriptionsTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let outboxWorker: Worker<ChatOutboxJobData> | null = null;
  let detachVoteListener: (() => void) | null = null;
  const reconnectBackoff = createReconnectBackoff({ baseMs: 10_000, maxMs: 120_000 });

  const defaultClientRef: { value: BotClient | null } = { value: null };
  const overrideClients = new Map<string, BotClient>();

  const joinedDefault = new Set<string>();
  const loginToSlug = new Map<string, string>();
  const loginToChannelId = new Map<string, string>();
  const channelIdToOverrideExtId = new Map<string, string>();

  const sayForChannelFn = (params: { channelId: string | null; twitchLogin: string; message: string }) =>
    sayForChannel({
      defaultClientRef,
      overrideClients,
      channelIdToOverrideExtId,
      channelId: params.channelId,
      twitchLogin: params.twitchLogin,
      message: params.message,
    });

  const subscriptions = createTwitchChatSubscriptions({
    defaultClientRef,
    joinedDefault,
    loginToSlug,
    loginToChannelId,
    channelIdToOverrideExtId,
    stoppedRef,
  });

  const chatOutbox = createTwitchChatOutbox({
    loginToChannelId,
    joinedDefault,
    defaultClientRef,
    sayForChannel: sayForChannelFn,
    config: {
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
    },
  });

  const scheduleReconnect = (reason: string, authError: boolean) => {
    if (stoppedRef.value) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = reconnectBackoff.nextDelayMs();
    logger.warn('chatbot.reconnect_scheduled', { reason, delayMs: delay, authError });
    reconnectTimer = setTimeout(() => void connect(), delay);
  };

  const connect = async () => {
    if (stoppedRef.value) return;

    let accessToken: string | null = null;
    let botLogin = defaultBotLogin;
    let authSource: 'global' | 'user' | null = null;
    let botUserId: string | null = null;

    const dbBot = await getValidTwitchBotAccessToken();
    if (dbBot?.accessToken && dbBot.login) {
      accessToken = dbBot.accessToken;
      botLogin = normalizeLogin(dbBot.login);
      authSource = 'global';
    } else {
      botUserId = defaultBotUserId || (await resolveBotUserId());
      if (!botUserId) {
        logger.warn('chatbot.no_bot_user', { botLogin });
        scheduleReconnect('missing_bot_user', false);
        return;
      }

      accessToken = await getValidAccessToken(botUserId);
      if (!accessToken) {
        accessToken = await refreshAccessToken(botUserId);
      }
      if (!accessToken) {
        logger.warn('chatbot.no_access_token', { botLogin, botUserId });
        scheduleReconnect('missing_access_token', false);
        return;
      }
      authSource = 'user';
    }

    const client = new tmi.Client({
      options: { debug: false },
      connection: { secure: true, reconnect: true },
      identity: { username: botLogin, password: `oauth:${accessToken}` },
      channels: [],
    });
    defaultClientRef.value = { kind: 'default', login: botLogin, client, joined: joinedDefault };
    detachVoteListener?.();
    detachVoteListener = registerVoteChatListener({
      client,
      backendBaseUrls,
      loginToChannelId,
      loginToSlug,
      stoppedRef,
    });

    client.on('connected', () => {
      logger.info('chatbot.connected', { botLogin });
      reconnectBackoff.reset();
    });
    client.on('disconnected', (reason: unknown) => {
      const reasonMsg = String(reason || '');
      const authError = isTwitchAuthError(reason);
      logger.warn('chatbot.disconnected', { botLogin, reason: reasonMsg, authError });
      if (authError && !stoppedRef.value) {
        scheduleReconnect('auth_error', true);
      }
    });

    try {
      await client.connect();
      await subscriptions.syncSubscriptions();
      subscriptionsTimer = setInterval(() => void subscriptions.syncSubscriptions(), syncSeconds * 1000);
      if (outboxBullmqEnabled) {
        outboxWorker = chatOutbox.startOutboxWorker();
      } else {
        outboxTimer = setInterval(() => void chatOutbox.processOutboxOnce(), outboxPollMs);
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const authError = isTwitchAuthError(e);
      logger.warn('chatbot.connect_failed', { botLogin, errorMessage, authError });
      if (authError) {
        if (authSource === 'global') {
          const refreshed = await refreshTwitchBotAccessToken();
          if (refreshed?.accessToken) {
            botLogin = normalizeLogin(refreshed.login);
          }
        } else if (authSource === 'user' && botUserId) {
          await refreshAccessToken(botUserId);
        }
      }
      scheduleReconnect('connect_failed', authError);
    }
  };

  const shutdown = async () => {
    stoppedRef.value = true;
    if (subscriptionsTimer) clearInterval(subscriptionsTimer);
    if (outboxTimer) clearInterval(outboxTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    heartbeat.stop();
    if (detachVoteListener) {
      detachVoteListener();
      detachVoteListener = null;
    }
    if (outboxWorker) {
      try {
        await outboxWorker.close();
      } catch {
        // ignore
      } finally {
        outboxWorker = null;
      }
    }
    try {
      if (defaultClientRef.value?.client) await defaultClientRef.value.client.disconnect();
    } catch {
      // ignore
    }
    for (const oc of Array.from(overrideClients.values())) {
      try {
        await oc.client.disconnect();
      } catch {
        // ignore
      }
    }
    overrideClients.clear();
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  await prisma.$connect();
  await connect();
}

void start().catch((e: unknown) => {
  logger.error('chatbot.fatal', { errorMessage: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
