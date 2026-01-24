import type { Server } from 'socket.io';
import tmi, { type ChatUserstate, type Client } from 'tmi.js';
import { prisma } from '../lib/prisma.js';
import { getValidAccessToken, refreshAccessToken } from '../utils/twitchApi.js';
import { addCreditsChatter } from '../realtime/creditsSessionStore.js';
import { emitCreditsState } from '../realtime/creditsState.js';
import { logger } from '../utils/logger.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { shouldIgnoreCreditsChatter } from '../utils/creditsIgnore.js';
import { createReconnectBackoff } from './reconnectBackoff.js';
import { asRecord, getErrorMessage, normalizeLogin, normalizeSlug, parseBool } from './chatbotSharedUtils.js';
import { isTwitchAuthError } from './twitchChatbotShared.js';
import { handleUnifiedChatReward } from './unifiedChatRewards.js';
import { handleTwitchChatAutoRewards } from './twitchChatAutoRewards.js';

type ChannelMapEntry = {
  login: string; // twitch channel login (lowercase)
  slug: string; // memalerts channel.slug
};

function normalizeTwitchLogin(v: string): string {
  return normalizeLogin(v).replace(/^#/, '');
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
      const login = normalizeTwitchLogin(p.slice(0, idx));
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
      const login = normalizeTwitchLogin(String(rec.login ?? ''));
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

export function startTwitchChatBot(io: Server): { stop: () => Promise<void> } | null {
  if (!parseBool(process.env.CHAT_BOT_ENABLED)) return null;

  const botLogin = normalizeTwitchLogin(String(process.env.CHAT_BOT_LOGIN || ''));
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
      const login = normalizeTwitchLogin(channel);
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

      // Unified chat rewards (all platforms, only logged-in users)
      void handleUnifiedChatReward(io, {
        platform: 'twitch',
        channelSlug: slug,
        platformUserId: twitchUserId,
        displayName,
      });

      if (channelId) {
        await handleTwitchChatAutoRewards({
          io,
          channelId,
          channelSlug: slug,
          twitchUserId,
          memalertsUserId,
        });
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
