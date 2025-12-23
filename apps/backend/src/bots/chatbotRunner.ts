import dotenv from 'dotenv';
import tmi from 'tmi.js';
import { prisma } from '../lib/prisma.js';
import { getValidAccessToken, refreshAccessToken } from '../utils/twitchApi.js';
import { logger } from '../utils/logger.js';

dotenv.config();

function parseIntSafe(v: any, def: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}

function normalizeLogin(v: string): string {
  return String(v || '').trim().toLowerCase().replace(/^#/, '');
}

async function resolveBotUserId(): Promise<string | null> {
  const explicit = String(process.env.CHAT_BOT_USER_ID || '').trim();
  if (explicit) return explicit;

  const twitchUserId = String(process.env.CHAT_BOT_TWITCH_USER_ID || '').trim();
  if (twitchUserId) {
    const u = await prisma.user.findUnique({ where: { twitchUserId }, select: { id: true } });
    return u?.id || null;
  }

  const login = String(process.env.CHAT_BOT_LOGIN || 'lotas_bot').trim();
  if (login) {
    const u = await prisma.user.findFirst({
      where: { displayName: { equals: login, mode: 'insensitive' } },
      select: { id: true },
    });
    return u?.id || null;
  }

  return null;
}

async function postInternalCreditsChatter(baseUrl: string, payload: { channelSlug: string; userId: string; displayName: string }) {
  const url = new URL('/internal/credits/chatter', baseUrl);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2_000);
  try {
    await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-memalerts-internal': 'credits-event',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    logger.warn('chatbot.internal_post_failed', { errorMessage: e?.message || String(e) });
  } finally {
    clearTimeout(t);
  }
}

async function fetchEnabledSubscriptions(): Promise<Array<{ login: string; slug: string }>> {
  const rows = await prisma.chatBotSubscription.findMany({
    where: { enabled: true },
    select: { twitchLogin: true, channel: { select: { slug: true } } },
  });
  const out: Array<{ login: string; slug: string }> = [];
  for (const r of rows) {
    const login = normalizeLogin(r.twitchLogin);
    const slug = String(r.channel?.slug || '').trim().toLowerCase();
    if (!login || !slug) continue;
    out.push({ login, slug });
  }
  return out;
}

async function start() {
  const botLogin = normalizeLogin(String(process.env.CHAT_BOT_LOGIN || 'lotas_bot'));
  const syncSeconds = Math.max(5, parseIntSafe(process.env.CHATBOT_SYNC_SECONDS, 30));
  const backendBaseUrl = String(process.env.CHATBOT_BACKEND_BASE_URL || 'http://127.0.0.1:3001').trim();

  let stopped = false;
  let client: any = null;
  let subscriptionsTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const joined = new Set<string>(); // login
  const loginToSlug = new Map<string, string>();

  const syncSubscriptions = async () => {
    if (stopped || !client) return;
    try {
      const subs = await fetchEnabledSubscriptions();
      const desired = new Set<string>();
      loginToSlug.clear();
      for (const s of subs) {
        desired.add(s.login);
        loginToSlug.set(s.login, s.slug);
      }

      const toJoin = Array.from(desired).filter((l) => !joined.has(l));
      const toPart = Array.from(joined).filter((l) => !desired.has(l));

      for (const l of toJoin) {
        try {
          await client.join(l);
          joined.add(l);
          logger.info('chatbot.join', { login: l });
        } catch (e: any) {
          logger.warn('chatbot.join_failed', { login: l, errorMessage: e?.message || String(e) });
        }
      }

      for (const l of toPart) {
        try {
          await client.part(l);
          joined.delete(l);
          logger.info('chatbot.part', { login: l });
        } catch (e: any) {
          logger.warn('chatbot.part_failed', { login: l, errorMessage: e?.message || String(e) });
        }
      }
    } catch (e: any) {
      logger.warn('chatbot.sync_failed', { errorMessage: e?.message || String(e) });
    }
  };

  const connect = async () => {
    if (stopped) return;

    const botUserId = await resolveBotUserId();
    if (!botUserId) {
      logger.warn('chatbot.no_bot_user', { botLogin });
      reconnectTimer = setTimeout(connect, 30_000);
      return;
    }

    let accessToken = await getValidAccessToken(botUserId);
    if (!accessToken) {
      accessToken = await refreshAccessToken(botUserId);
    }
    if (!accessToken) {
      logger.warn('chatbot.no_access_token', { botLogin, botUserId });
      reconnectTimer = setTimeout(connect, 30_000);
      return;
    }

    client = new (tmi as any).Client({
      options: { debug: false },
      connection: { secure: true, reconnect: true },
      identity: { username: botLogin, password: `oauth:${accessToken}` },
      channels: [],
    });

    client.on('connected', () => {
      logger.info('chatbot.connected', { botLogin });
    });
    client.on('disconnected', (reason: any) => {
      logger.warn('chatbot.disconnected', { botLogin, reason: String(reason || '') });
    });
    client.on('message', async (channel: string, tags: any, _message: string, self: boolean) => {
      if (self) return;
      const login = normalizeLogin(channel);
      const slug = loginToSlug.get(login);
      if (!slug) return;

      const userId = String(tags?.['user-id'] || '').trim();
      const displayName = String(tags?.['display-name'] || tags?.username || '').trim();
      if (!userId || !displayName) return;

      void postInternalCreditsChatter(backendBaseUrl, { channelSlug: slug, userId, displayName });
    });

    try {
      await client.connect();
      // Initial sync + periodic sync
      await syncSubscriptions();
      subscriptionsTimer = setInterval(syncSubscriptions, syncSeconds * 1000);
    } catch (e: any) {
      logger.warn('chatbot.connect_failed', { botLogin, errorMessage: e?.message || String(e) });
      reconnectTimer = setTimeout(connect, 30_000);
    }
  };

  const shutdown = async () => {
    stopped = true;
    if (subscriptionsTimer) clearInterval(subscriptionsTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      if (client) await client.disconnect();
    } catch {
      // ignore
    }
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  await prisma.$connect();
  await connect();
}

void start().catch((e: any) => {
  logger.error('chatbot.fatal', { errorMessage: e?.message || String(e) });
  process.exit(1);
});



