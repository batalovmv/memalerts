import type { Server } from 'socket.io';
import tmi, { type ChatUserstate, type Client } from 'tmi.js';
import { prisma } from '../lib/prisma.js';
import { getValidAccessToken, refreshAccessToken } from '../utils/twitchApi.js';
import { addCreditsChatter } from '../realtime/creditsSessionStore.js';
import { emitCreditsState } from '../realtime/creditsState.js';
import { logger } from '../utils/logger.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { shouldIgnoreCreditsChatter } from '../utils/creditsIgnore.js';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';
import { getStreamSessionSnapshot } from '../realtime/streamDurationStore.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import { createReconnectBackoff } from './reconnectBackoff.js';
import { isTwitchAuthError } from './twitchChatbotShared.js';

type RewardTx = Parameters<typeof recordExternalRewardEventTx>[0]['tx'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type ChannelMapEntry = {
  login: string; // twitch channel login (lowercase)
  slug: string; // memalerts channel.slug
};

function parseBool(v: string | undefined): boolean {
  const s = String(v || '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function normalizeLogin(v: string): string {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
}

function normalizeSlug(v: string): string {
  return String(v || '')
    .trim()
    .toLowerCase();
}

function parseChannelMap(): ChannelMapEntry[] {
  // Simple format to avoid JSON quoting issues in env:
  // CHAT_BOT_CHANNELS=login:slug,login2:slug2
  const simple = String(process.env.CHAT_BOT_CHANNELS || '').trim();
  if (simple) {
    const out: ChannelMapEntry[] = [];
    for (const part of simple.split(',')) {
      const p = String(part || '').trim();
      if (!p) continue;
      const idx = p.indexOf(':');
      if (idx === -1) continue;
      const login = normalizeLogin(p.slice(0, idx));
      const slug = normalizeSlug(p.slice(idx + 1));
      if (!login || !slug) continue;
      out.push({ login, slug });
    }
    if (out.length > 0) return out;
  }

  const raw = String(process.env.CHAT_BOT_CHANNEL_MAP_JSON || '').trim();
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: ChannelMapEntry[] = [];
    for (const it of arr) {
      const rec = asRecord(it);
      const login = normalizeLogin(String(rec.login ?? ''));
      const slug = normalizeSlug(String(rec.slug ?? ''));
      if (!login || !slug) continue;
      out.push({ login, slug });
    }
    return out;
  } catch {
    return [];
  }
}

async function resolveBotUserId(): Promise<string | null> {
  const explicit = String(process.env.CHAT_BOT_USER_ID || '').trim();
  if (explicit) return explicit;

  const twitchUserId = String(process.env.CHAT_BOT_TWITCH_USER_ID || '').trim();
  if (twitchUserId) {
    const u = await prisma.user.findUnique({ where: { twitchUserId }, select: { id: true } });
    return u?.id || null;
  }

  const login = String(process.env.CHAT_BOT_LOGIN || '').trim();
  if (login) {
    const u = await prisma.user.findFirst({
      where: { displayName: { equals: login, mode: 'insensitive' } },
      select: { id: true },
    });
    return u?.id || null;
  }

  return null;
}

const windowMinCache = new Map<string, { v: number; ts: number }>(); // slug -> minutes
const WINDOW_CACHE_MS = 60_000;

const channelIdCache = new Map<string, { v: string; ts: number }>(); // slug -> channelId
const CHANNEL_ID_CACHE_MS = 60_000;

async function getReconnectWindowMinutes(slug: string): Promise<number> {
  const now = Date.now();
  const cached = windowMinCache.get(slug);
  if (cached && now - cached.ts < WINDOW_CACHE_MS) return cached.v;

  try {
    const ch = await prisma.channel.findUnique({
      where: { slug },
      select: { creditsReconnectWindowMinutes: true },
    });
    const v = Number.isFinite(ch?.creditsReconnectWindowMinutes) ? Number(ch?.creditsReconnectWindowMinutes) : 60;
    const clamped = Math.max(1, Math.min(24 * 60, Math.floor(v)));
    windowMinCache.set(slug, { v: clamped, ts: now });
    return clamped;
  } catch {
    return 60;
  }
}

async function getChannelIdBySlug(slug: string): Promise<string | null> {
  const s = normalizeSlug(slug);
  if (!s) return null;
  const now = Date.now();
  const cached = channelIdCache.get(s);
  if (cached && now - cached.ts < CHANNEL_ID_CACHE_MS) return cached.v;
  try {
    const ch = await prisma.channel.findUnique({ where: { slug: s }, select: { id: true } });
    const id = String(ch?.id || '').trim();
    if (!id) return null;
    channelIdCache.set(s, { v: id, ts: now });
    return id;
  } catch {
    return null;
  }
}

const autoRewardsCache = new Map<string, { v: unknown; ts: number }>(); // channelId -> twitchAutoRewardsJson
const AUTO_REWARDS_CACHE_MS = 60_000;

async function getTwitchAutoRewardsConfig(channelId: string): Promise<unknown | null> {
  const id = String(channelId || '').trim();
  if (!id) return null;
  const now = Date.now();
  const cached = autoRewardsCache.get(id);
  if (cached && now - cached.ts < AUTO_REWARDS_CACHE_MS) return cached.v ?? null;
  try {
    const ch = await prisma.channel.findUnique({ where: { id }, select: { twitchAutoRewardsJson: true } });
    const v = (ch as { twitchAutoRewardsJson?: unknown } | null)?.twitchAutoRewardsJson ?? null;
    autoRewardsCache.set(id, { v, ts: now });
    return v;
  } catch {
    autoRewardsCache.set(id, { v: null, ts: now });
    return null;
  }
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function utcDayKeyYesterday(d: Date): string {
  const x = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return utcDayKey(x);
}

export function startTwitchChatBot(io: Server): { stop: () => Promise<void> } | null {
  if (!parseBool(process.env.CHAT_BOT_ENABLED)) return null;

  const botLogin = normalizeLogin(String(process.env.CHAT_BOT_LOGIN || ''));
  const map = parseChannelMap();
  if (!botLogin) {
    logger.warn('chatbot.missing_login', {});
    return null;
  }
  if (map.length === 0) {
    logger.warn('chatbot.missing_channel_map', {});
    return null;
  }

  let stopped = false;
  let client: Client | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  const reconnectBackoff = createReconnectBackoff({ baseMs: 10_000, maxMs: 120_000 });

  const scheduleReconnect = (reason: string, authError: boolean) => {
    if (stopped) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = reconnectBackoff.nextDelayMs();
    logger.warn('chatbot.reconnect_scheduled', { reason, delayMs: delay, authError });
    reconnectTimer = setTimeout(() => void connect(), delay);
  };

  const connect = async () => {
    if (stopped) return;

    const botUserId = await resolveBotUserId();
    if (!botUserId) {
      logger.warn('chatbot.no_bot_user', { botLogin });
      scheduleReconnect('missing_bot_user', false);
      return;
    }

    let accessToken = await getValidAccessToken(botUserId);
    if (!accessToken) {
      accessToken = await refreshAccessToken(botUserId);
    }
    if (!accessToken) {
      logger.warn('chatbot.no_access_token', { botLogin, botUserId });
      scheduleReconnect('missing_access_token', false);
      return;
    }

    const channels = Array.from(new Set(map.map((m) => m.login))).filter(Boolean);
    const activeClient = new tmi.Client({
      options: { debug: false },
      connection: { secure: true, reconnect: true },
      identity: {
        username: botLogin,
        password: `oauth:${accessToken}`,
      },
      channels,
    });
    client = activeClient;

    activeClient.on('connected', () => {
      logger.info('chatbot.connected', { botLogin, channels });
      reconnectBackoff.reset();
    });
    activeClient.on('disconnected', (reason: unknown) => {
      const reasonMsg = String(reason || '');
      const authError = isTwitchAuthError(reason);
      logger.warn('chatbot.disconnected', { botLogin, reason: reasonMsg, authError });
      if (authError && !stopped) {
        scheduleReconnect('auth_error', true);
      }
    });
    activeClient.on('message', async (channel: string, tags: ChatUserstate, _message: string, self: boolean) => {
      if (self) return;
      const login = normalizeLogin(channel);
      const entry = map.find((m) => m.login === login);
      if (!entry) return;

      const twitchUserId = String(tags?.['user-id'] || '').trim();
      const displayName = String(tags?.['display-name'] || tags?.username || '').trim();
      if (!twitchUserId || !displayName) return;

      const slug = entry.slug;
      const windowMin = await getReconnectWindowMinutes(slug);
      const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({
        provider: 'twitch',
        platformUserId: twitchUserId,
      });
      const creditsUserId = memalertsUserId || `twitch:${twitchUserId}`;

      const channelId = await getChannelIdBySlug(slug);
      if (channelId) {
        const ignore = await shouldIgnoreCreditsChatter({ channelId, creditsUserId, displayName });
        if (ignore) return;
      }

      await addCreditsChatter(slug, creditsUserId, displayName, null, windowMin);
      void emitCreditsState(io, slug);

      // Twitch auto rewards: chat activity (first message per stream / message thresholds / daily streak).
      // These are best-effort and rely on Redis for lightweight per-user counters.
      try {
        if (!channelId) return;
        const cfg = await getTwitchAutoRewardsConfig(channelId);
        if (!cfg || typeof cfg !== 'object') return;

        const chatCfgRaw = asRecord(cfg).chat;
        if (!chatCfgRaw || typeof chatCfgRaw !== 'object') return;
        const chatCfg = asRecord(chatCfgRaw);

        const redis = await getRedisClient();
        if (!redis) return;

        const now = new Date();
        const day = utcDayKey(now);
        const yesterday = utcDayKeyYesterday(now);

        const session = await getStreamSessionSnapshot(slug);
        const isOnline = session.status === 'online' && !!session.sessionId;

        const award = async (params: {
          providerEventId: string;
          eventType: 'twitch_chat_first_message' | 'twitch_chat_messages_threshold' | 'twitch_chat_daily_streak';
          amount: number;
          coins: number;
        }) => {
          const coins = Number.isFinite(params.coins) ? Math.floor(params.coins) : 0;
          if (coins <= 0) return;

          const linkedUserId = memalertsUserId || null;
          const claimed = await prisma.$transaction(async (tx: RewardTx) => {
            await recordExternalRewardEventTx({
              tx,
              provider: 'twitch',
              providerEventId: params.providerEventId,
              channelId,
              providerAccountId: twitchUserId,
              eventType: params.eventType,
              currency: 'twitch_units',
              amount: params.amount,
              coinsToGrant: coins,
              status: 'eligible',
              reason: null,
              eventAt: new Date(),
              rawPayloadJson: JSON.stringify({
                kind: params.eventType,
                channelSlug: slug,
                twitchUserId,
                day,
                sessionId: session.sessionId ?? null,
              }),
            });

            if (linkedUserId) {
              return await claimPendingCoinGrantsTx({
                tx,
                userId: linkedUserId,
                provider: 'twitch',
                providerAccountId: twitchUserId,
              });
            }
            return [];
          });

          if (claimed.length) {
            for (const ev of claimed) {
              emitWalletUpdated(io, ev);
              void relayWalletUpdatedToPeer(ev);
            }
          }
        };

        // Daily streak: award once per day on first chat message.
        const streakCfg = asRecord(chatCfg.dailyStreak);
        if (streakCfg.enabled) {
          const k = nsKey('twitch_auto_rewards', `streak:${channelId}:${twitchUserId}`);
          const raw = await redis.get(k);
          let lastDate: string | null = null;
          let streak = 0;
          try {
            if (raw) {
              const parsed = JSON.parse(raw) as unknown;
              const parsedRec = asRecord(parsed);
              lastDate = typeof parsedRec.lastDate === 'string' ? parsedRec.lastDate : null;
              streak = Number.isFinite(Number(parsedRec.streak)) ? Math.floor(Number(parsedRec.streak)) : 0;
            }
          } catch {
            lastDate = null;
            streak = 0;
          }

          if (lastDate !== day) {
            const nextStreak = lastDate === yesterday ? Math.max(1, streak + 1) : 1;
            await redis.set(k, JSON.stringify({ lastDate: day, streak: nextStreak }), { EX: 90 * 24 * 60 * 60 });

            const coinsByStreak = streakCfg.coinsByStreak ?? null;
            const coins =
              coinsByStreak && typeof coinsByStreak === 'object'
                ? Number(asRecord(coinsByStreak)[String(nextStreak)] ?? 0)
                : Number(streakCfg.coinsPerDay ?? 0);

            const providerEventId = stableProviderEventId({
              provider: 'twitch',
              rawPayloadJson: '{}',
              fallbackParts: ['chat_daily_streak', channelId, twitchUserId, day],
            });
            await award({ providerEventId, eventType: 'twitch_chat_daily_streak', amount: nextStreak, coins });
          }
        }

        // First message per stream: award once per user per stream session.
        const firstCfg = asRecord(chatCfg.firstMessage);
        if (firstCfg.enabled) {
          const onlyWhenLive = firstCfg.onlyWhenLive === undefined ? true : Boolean(firstCfg.onlyWhenLive);
          if (!onlyWhenLive || isOnline) {
            const sid = String(session.sessionId || '').trim();
            if (sid) {
              const k = nsKey('twitch_auto_rewards', `first:${channelId}:${sid}:${twitchUserId}`);
              const ok = await redis.set(k, '1', { NX: true, EX: 48 * 60 * 60 });
              if (ok === 'OK') {
                const providerEventId = stableProviderEventId({
                  provider: 'twitch',
                  rawPayloadJson: '{}',
                  fallbackParts: ['chat_first_message', channelId, sid, twitchUserId],
                });
                await award({
                  providerEventId,
                  eventType: 'twitch_chat_first_message',
                  amount: 1,
                  coins: Number(firstCfg.coins ?? 0),
                });
              }
            }
          }
        }

        // Message count thresholds per stream.
        const thrCfg = asRecord(chatCfg.messageThresholds);
        if (thrCfg.enabled) {
          const onlyWhenLive = thrCfg.onlyWhenLive === undefined ? true : Boolean(thrCfg.onlyWhenLive);
          if (!onlyWhenLive || isOnline) {
            const sid = String(session.sessionId || '').trim();
            if (sid) {
              const kCount = nsKey('twitch_auto_rewards', `msgcount:${channelId}:${sid}:${twitchUserId}`);
              const n = await redis.incr(kCount);
              if (n === 1) await redis.expire(kCount, 48 * 60 * 60);

              const thresholds = asArray(thrCfg.thresholds);
              const hit = thresholds.some((t) => Number.isFinite(Number(t)) && Math.floor(Number(t)) === n);
              if (hit) {
                const coinsByThreshold = thrCfg.coinsByThreshold ?? null;
                const coins =
                  coinsByThreshold && typeof coinsByThreshold === 'object'
                    ? Number(asRecord(coinsByThreshold)[String(n)] ?? 0)
                    : 0;
                const providerEventId = stableProviderEventId({
                  provider: 'twitch',
                  rawPayloadJson: '{}',
                  fallbackParts: ['chat_messages_threshold', channelId, sid, twitchUserId, String(n)],
                });
                await award({ providerEventId, eventType: 'twitch_chat_messages_threshold', amount: n, coins });
              }
            }
          }
        }
      } catch (e: unknown) {
        // Never fail credits flow because of chat rewards.
        logger.warn('chatbot.auto_rewards_failed', { errorMessage: getErrorMessage(e) });
      }
    });

    try {
      await activeClient.connect();
    } catch (e: unknown) {
      const authError = isTwitchAuthError(e);
      logger.warn('chatbot.connect_failed', { botLogin, errorMessage: getErrorMessage(e), authError });
      if (authError && botUserId) {
        await refreshAccessToken(botUserId);
      }
      scheduleReconnect('connect_failed', authError);
    }
  };

  void connect();

  return {
    stop: async () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        if (client) await client.disconnect();
      } catch {
        // ignore
      }
    },
  };
}
