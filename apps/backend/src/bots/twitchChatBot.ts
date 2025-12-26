import type { Server } from 'socket.io';
import tmi from 'tmi.js';
import { prisma } from '../lib/prisma.js';
import { getValidAccessToken } from '../utils/twitchApi.js';
import { addCreditsChatter } from '../realtime/creditsSessionStore.js';
import { emitCreditsState } from '../realtime/creditsState.js';
import { logger } from '../utils/logger.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { shouldIgnoreCreditsChatter } from '../utils/creditsIgnore.js';

type ChannelMapEntry = {
  login: string; // twitch channel login (lowercase)
  slug: string; // memalerts channel.slug
};

function parseBool(v: string | undefined): boolean {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function normalizeLogin(v: string): string {
  return String(v || '').trim().toLowerCase().replace(/^#/, '');
}

function normalizeSlug(v: string): string {
  return String(v || '').trim().toLowerCase();
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
      const login = normalizeLogin(String((it as any)?.login || ''));
      const slug = normalizeSlug(String((it as any)?.slug || ''));
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
    const v = Number.isFinite((ch as any)?.creditsReconnectWindowMinutes) ? Number((ch as any).creditsReconnectWindowMinutes) : 60;
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
    const id = String((ch as any)?.id || '').trim();
    if (!id) return null;
    channelIdCache.set(s, { v: id, ts: now });
    return id;
  } catch {
    return null;
  }
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
  let client: any = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const connect = async () => {
    if (stopped) return;

    const botUserId = await resolveBotUserId();
    if (!botUserId) {
      logger.warn('chatbot.no_bot_user', { botLogin });
      reconnectTimer = setTimeout(connect, 30_000);
      return;
    }

    const accessToken = await getValidAccessToken(botUserId);
    if (!accessToken) {
      logger.warn('chatbot.no_access_token', { botLogin, botUserId });
      reconnectTimer = setTimeout(connect, 30_000);
      return;
    }

    const channels = Array.from(new Set(map.map((m) => m.login))).filter(Boolean);
    client = new (tmi as any).Client({
      options: { debug: false },
      connection: { secure: true, reconnect: true },
      identity: {
        username: botLogin,
        password: `oauth:${accessToken}`,
      },
      channels,
    });

    client.on('connected', () => {
      logger.info('chatbot.connected', { botLogin, channels });
    });
    client.on('disconnected', (reason: any) => {
      logger.warn('chatbot.disconnected', { botLogin, reason: String(reason || '') });
    });
    client.on('message', async (channel: string, tags: any, _message: string, self: boolean) => {
      if (self) return;
      const login = normalizeLogin(channel);
      const entry = map.find((m) => m.login === login);
      if (!entry) return;

      const twitchUserId = String(tags?.['user-id'] || '').trim();
      const displayName = String(tags?.['display-name'] || tags?.username || '').trim();
      if (!twitchUserId || !displayName) return;

      const slug = entry.slug;
      const windowMin = await getReconnectWindowMinutes(slug);
      const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: twitchUserId });
      const creditsUserId = memalertsUserId || `twitch:${twitchUserId}`;

      const channelId = await getChannelIdBySlug(slug);
      if (channelId) {
        const ignore = await shouldIgnoreCreditsChatter({ channelId, creditsUserId, displayName });
        if (ignore) return;
      }

      await addCreditsChatter(slug, creditsUserId, displayName, windowMin);
      void emitCreditsState(io, slug);
    });

    try {
      await client.connect();
    } catch (e: any) {
      logger.warn('chatbot.connect_failed', { botLogin, errorMessage: e?.message || String(e) });
      reconnectTimer = setTimeout(connect, 30_000);
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


