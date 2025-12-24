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

async function fetchEnabledSubscriptions(): Promise<Array<{ channelId: string; login: string; slug: string }>> {
  const rows = await prisma.chatBotSubscription.findMany({
    where: { enabled: true },
    select: { channelId: true, twitchLogin: true, channel: { select: { slug: true } } },
  });
  const out: Array<{ channelId: string; login: string; slug: string }> = [];
  for (const r of rows) {
    const login = normalizeLogin(r.twitchLogin);
    const slug = String(r.channel?.slug || '').trim().toLowerCase();
    const channelId = String((r as any)?.channelId || '').trim();
    if (!channelId || !login || !slug) continue;
    out.push({ channelId, login, slug });
  }
  return out;
}

async function start() {
  const botLogin = normalizeLogin(String(process.env.CHAT_BOT_LOGIN || ''));
  const syncSeconds = Math.max(5, parseIntSafe(process.env.CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.CHATBOT_OUTBOX_POLL_MS, 1_000));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  const backendBaseUrls = parseBaseUrls();

  // Hard requirements: avoid silently connecting to the wrong instance (prod vs beta)
  // and make misconfig obvious in deploy logs.
  if (!botLogin) {
    logger.error('chatbot.missing_env', { key: 'CHAT_BOT_LOGIN' });
    process.exit(1);
  }
  if (backendBaseUrls.length === 0) {
    logger.error('chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  let stopped = false;
  let client: any = null;
  let subscriptionsTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;
  let commandsTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const joined = new Set<string>(); // login
  const loginToSlug = new Map<string, string>();
  const loginToChannelId = new Map<string, string>();
  const commandsByChannelId = new Map<
    string,
    { ts: number; items: Array<{ triggerNormalized: string; response: string }> }
  >();
  let commandsRefreshing = false;

  const refreshCommands = async () => {
    if (stopped || commandsRefreshing) return;
    const channelIds = Array.from(new Set(Array.from(loginToChannelId.values()).filter(Boolean)));
    if (channelIds.length === 0) return;

    commandsRefreshing = true;
    try {
      const rows = await (prisma as any).chatBotCommand.findMany({
        where: { channelId: { in: channelIds }, enabled: true },
        select: { channelId: true, triggerNormalized: true, response: true },
      });
      const grouped = new Map<string, Array<{ triggerNormalized: string; response: string }>>();
      for (const r of rows) {
        const channelId = String((r as any)?.channelId || '').trim();
        const triggerNormalized = String((r as any)?.triggerNormalized || '').trim().toLowerCase();
        const response = String((r as any)?.response || '').trim();
        if (!channelId || !triggerNormalized || !response) continue;
        const arr = grouped.get(channelId) || [];
        arr.push({ triggerNormalized, response });
        grouped.set(channelId, arr);
      }

      const now = Date.now();
      for (const id of channelIds) {
        commandsByChannelId.set(id, { ts: now, items: grouped.get(id) || [] });
      }
    } catch (e: any) {
      logger.warn('chatbot.commands_refresh_failed', { errorMessage: e?.message || String(e) });
    } finally {
      commandsRefreshing = false;
    }
  };

  const MAX_OUTBOX_BATCH = 25;
  const MAX_SEND_ATTEMPTS = 3;
  const PROCESSING_STALE_MS = 60_000;

  const processOutboxOnce = async () => {
    if (stopped || !client) return;
    if (joined.size === 0) return;

    // Only dispatch messages for currently-enabled subscriptions (avoid sending after disable).
    const channelIds = Array.from(loginToChannelId.values()).filter(Boolean);
    if (channelIds.length === 0) return;

    const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);

    const rows = await (prisma as any).chatBotOutboxMessage.findMany({
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
      if (stopped || !client) return;

      const login = normalizeLogin(r.twitchLogin);
      if (!login) continue;
      if (!joined.has(login)) continue; // wait until join completes

      // Claim (best-effort safe if multiple runner processes ever happen).
      const claim = await (prisma as any).chatBotOutboxMessage.updateMany({
        where: { id: r.id, status: r.status },
        data: { status: 'processing', processingAt: new Date(), lastError: null },
      });
      if (claim.count !== 1) continue;

      try {
        await client.say(login, r.message);
        await (prisma as any).chatBotOutboxMessage.update({
          where: { id: r.id },
          data: { status: 'sent', sentAt: new Date(), attempts: (r.attempts || 0) + 1 },
        });
      } catch (e: any) {
        const nextAttempts = (r.attempts || 0) + 1;
        const lastError = e?.message || String(e);
        const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
        await (prisma as any).chatBotOutboxMessage.update({
          where: { id: r.id },
          data: shouldFail
            ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError }
            : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError },
        });
        logger.warn('chatbot.outbox_send_failed', { login, outboxId: r.id, attempts: nextAttempts, errorMessage: lastError });
      }
    }
  };

  const syncSubscriptions = async () => {
    if (stopped || !client) return;
    try {
      const subs = await fetchEnabledSubscriptions();
      const desired = new Set<string>();
      loginToSlug.clear();
      loginToChannelId.clear();
      for (const s of subs) {
        desired.add(s.login);
        loginToSlug.set(s.login, s.slug);
        loginToChannelId.set(s.login, s.channelId);
      }
      // Keep commands cache in sync with current subscriptions (no DB writes here).
      void refreshCommands();

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

      // Bot commands (trigger -> response) are per-channel.
      const channelId = loginToChannelId.get(login);
      if (channelId) {
        const cached = commandsByChannelId.get(channelId);
        const now = Date.now();
        if (!cached || now - cached.ts > commandsRefreshSeconds * 1000) {
          void refreshCommands();
        }

        const msgNorm = String(_message || '').trim().toLowerCase();
        if (msgNorm) {
          const items = commandsByChannelId.get(channelId)?.items || [];
          const match = items.find((c) => c.triggerNormalized === msgNorm);
          if (match?.response) {
            try {
              await client.say(login, match.response);
            } catch (e: any) {
              logger.warn('chatbot.command_reply_failed', { login, errorMessage: e?.message || String(e) });
            }
          }
        }
      }

      const userId = String(tags?.['user-id'] || '').trim();
      const displayName = String(tags?.['display-name'] || tags?.username || '').trim();
      if (!userId || !displayName) return;

      for (const baseUrl of backendBaseUrls) {
        void postInternalCreditsChatter(baseUrl, { channelSlug: slug, userId, displayName });
      }
    });

    try {
      await client.connect();
      // Initial sync + periodic sync
      await syncSubscriptions();
      subscriptionsTimer = setInterval(syncSubscriptions, syncSeconds * 1000);
      outboxTimer = setInterval(() => void processOutboxOnce(), outboxPollMs);
      // Commands refresh loop (read-only, safe)
      if (commandsTimer) clearInterval(commandsTimer);
      commandsTimer = setInterval(() => void refreshCommands(), commandsRefreshSeconds * 1000);
    } catch (e: any) {
      logger.warn('chatbot.connect_failed', { botLogin, errorMessage: e?.message || String(e) });
      reconnectTimer = setTimeout(connect, 30_000);
    }
  };

  const shutdown = async () => {
    stopped = true;
    if (subscriptionsTimer) clearInterval(subscriptionsTimer);
    if (outboxTimer) clearInterval(outboxTimer);
    if (commandsTimer) clearInterval(commandsTimer);
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









