import dotenv from 'dotenv';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import {
  createKickEventSubscription,
  getKickExternalAccount,
  getValidKickAccessTokenByExternalAccountId,
  getValidKickBotAccessToken,
  listKickEventSubscriptions,
  sendKickChatMessage,
} from '../utils/kickApi.js';

dotenv.config();

function parseIntSafe(v: any, def: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}

function normalizeSlug(v: string): string {
  return String(v || '').trim().toLowerCase();
}

function normalizeMessage(v: any): string {
  return String(v ?? '').replace(/\r\n/g, '\n').trim();
}

function normalizeLogin(v: any): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
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
    logger.warn('kick_chatbot.internal_post_failed', { errorMessage: e?.message || String(e) });
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

type SubRow = {
  channelId: string;
  userId: string;
  kickChannelId: string;
  slug: string;
};

async function fetchEnabledKickSubscriptions(): Promise<SubRow[]> {
  const rows = await (prisma as any).kickChatBotSubscription.findMany({
    where: { enabled: true },
    select: {
      channelId: true,
      userId: true,
      kickChannelId: true,
      channel: { select: { slug: true } },
    },
  });

  // Optional gating by BotIntegrationSettings(provider=kick).
  let gate: Map<string, boolean> | null = null;
  try {
    const channelIds = Array.from(new Set(rows.map((r: any) => String(r?.channelId || '').trim()).filter(Boolean)));
    if (channelIds.length > 0) {
      const gateRows = await (prisma as any).botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'kick' },
        select: { channelId: true, enabled: true },
      });
      gate = new Map<string, boolean>();
      for (const gr of gateRows) {
        const channelId = String((gr as any)?.channelId || '').trim();
        if (!channelId) continue;
        gate.set(channelId, Boolean((gr as any)?.enabled));
      }
    }
  } catch (e: any) {
    if (e?.code !== 'P2021') throw e;
    gate = null;
  }

  const out: SubRow[] = [];
  for (const r of rows) {
    const channelId = String((r as any)?.channelId || '').trim();
    const userId = String((r as any)?.userId || '').trim();
    const kickChannelId = String((r as any)?.kickChannelId || '').trim();
    const slug = normalizeSlug(String((r as any)?.channel?.slug || ''));
    if (!channelId || !userId || !kickChannelId || !slug) continue;

    if (gate) {
      const gated = gate.get(channelId);
      if (gated === false) continue;
    }

    out.push({ channelId, userId, kickChannelId, slug });
  }
  return out;
}

async function fetchKickBotOverrides(channelIds: string[]): Promise<Map<string, string>> {
  // channelId -> externalAccountId
  try {
    const ids = Array.from(new Set(channelIds.map((c) => String(c || '').trim()).filter(Boolean)));
    if (ids.length === 0) return new Map();
    const rows = await (prisma as any).kickBotIntegration.findMany({
      where: { channelId: { in: ids }, enabled: true },
      select: { channelId: true, externalAccountId: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      const channelId = String((r as any)?.channelId || '').trim();
      const externalAccountId = String((r as any)?.externalAccountId || '').trim();
      if (!channelId || !externalAccountId) continue;
      map.set(channelId, externalAccountId);
    }
    return map;
  } catch (e: any) {
    if (e?.code === 'P2021') return new Map();
    logger.warn('kick_chatbot.bot_overrides_fetch_failed', { errorMessage: e?.message || String(e) });
    return new Map();
  }
}

type ChannelState = {
  channelId: string;
  userId: string;
  kickChannelId: string;
  slug: string;
  botExternalAccountId: string | null;
  commandsTs: number;
  commands: Array<{
    triggerNormalized: string;
    response: string;
    onlyWhenLive: boolean;
    allowedUsers: string[];
    allowedRoles: string[];
  }>;
  // Optional: chat ingest cursor/timestamp.
  chatCursor: string | null;
};

function parseKickChatPollUrlTemplate(): string | null {
  const tpl = String(process.env.KICK_CHAT_POLL_URL_TEMPLATE || '').trim();
  return tpl || null;
}

function resolveKickWebhookCallbackUrl(): string | null {
  const envUrl = String(process.env.KICK_WEBHOOK_CALLBACK_URL || '').trim();
  if (envUrl) return envUrl;

  const domain = String(process.env.DOMAIN || '').trim();
  if (!domain) return null;

  const port = String(process.env.PORT || '3001').trim();
  const base = port === '3002' ? `https://beta.${domain}` : `https://${domain}`;
  return `${base}/webhooks/kick/events`;
}

function interpolateTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, encodeURIComponent(v));
  }
  return out;
}

function extractKickChatItems(raw: any): Array<{ userId: string; displayName: string; login: string | null; text: string; cursor: string | null }> {
  // Best-effort: depends on the exact Kick chat API response schema.
  const data = raw?.data ?? raw?.messages ?? raw?.items ?? raw ?? null;
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.items) ? data.items : [];
  const cursor = String(raw?.cursor ?? raw?.next_cursor ?? raw?.nextCursor ?? data?.cursor ?? data?.next_cursor ?? '').trim() || null;

  const out: Array<{ userId: string; displayName: string; login: string | null; text: string; cursor: string | null }> = [];
  for (const m of list) {
    const sender = m?.sender ?? m?.user ?? m?.author ?? m?.identity ?? m?.from ?? null;
    const userId = String(sender?.id ?? sender?.user_id ?? sender?.userId ?? m?.user_id ?? m?.userId ?? '').trim();
    const displayName =
      String(sender?.display_name ?? sender?.displayName ?? sender?.name ?? sender?.username ?? sender?.user_name ?? m?.display_name ?? '').trim() ||
      null;
    const loginRaw = String(sender?.username ?? sender?.user_name ?? sender?.login ?? '').trim() || null;
    const text = normalizeMessage(m?.content ?? m?.message ?? m?.text ?? m?.body ?? '');
    if (!userId || !text) continue;
    out.push({ userId, displayName: displayName || loginRaw || userId, login: loginRaw ? normalizeLogin(loginRaw) : null, text, cursor });
  }
  return out;
}

async function sendToKickChat(params: { st: ChannelState; text: string }) {
  const messageText = normalizeMessage(params.text);
  if (!messageText) return;

  const sendUrl = String(process.env.KICK_SEND_CHAT_URL || '').trim();
  if (!sendUrl) throw new Error('KICK_SEND_CHAT_URL is not configured');

  const token = params.st.botExternalAccountId
    ? await getValidKickAccessTokenByExternalAccountId(params.st.botExternalAccountId)
    : await getValidKickBotAccessToken();
  if (!token) throw new Error('Kick bot token is not configured');

  const resp = await sendKickChatMessage({
    accessToken: token,
    // NOTE: Kick Dev API expects numeric broadcaster_user_id when sending type="user".
    // In our DB we store this as kickChannelId (string) for historical reasons.
    kickChannelId: params.st.kickChannelId,
    content: messageText,
    sendChatUrl: sendUrl,
  });
  if (!resp.ok) {
    const err: any = new Error(`Kick send chat failed (${resp.status})`);
    err.kickStatus = resp.status;
    err.retryAfterSeconds = resp.retryAfterSeconds;
    err.raw = resp.raw;
    throw err;
  }
}

async function start() {
  const backendBaseUrls = parseBaseUrls();
  if (backendBaseUrls.length === 0) {
    logger.error('kick_chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  const enabled = String(process.env.KICK_CHAT_BOT_ENABLED || '').trim().toLowerCase();
  if (enabled === '0' || enabled === 'false' || enabled === 'off') {
    logger.info('kick_chatbot.disabled_by_env');
    process.exit(0);
  }

  const syncSeconds = Math.max(5, parseIntSafe(process.env.KICK_CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.KICK_CHATBOT_OUTBOX_POLL_MS, 1_000));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.KICK_CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  const ingestPollMs = Math.max(250, parseIntSafe(process.env.KICK_CHATBOT_INGEST_POLL_MS, 1_000));

  const chatPollUrlTemplate = parseKickChatPollUrlTemplate();

  const states = new Map<string, ChannelState>(); // channelId -> state

  let stopped = false;
  let syncInFlight = false;
  let outboxInFlight = false;
  let commandsRefreshing = false;
  let ingestInFlight = false;

  const syncSubscriptions = async () => {
    if (stopped) return;
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const subs = await fetchEnabledKickSubscriptions();
      const nextChannelIds = new Set(subs.map((s) => s.channelId));

      for (const channelId of Array.from(states.keys())) {
        if (!nextChannelIds.has(channelId)) {
          states.delete(channelId);
        }
      }

      const overrides = await fetchKickBotOverrides(subs.map((s) => s.channelId));
      for (const s of subs) {
        const prev = states.get(s.channelId);
        if (prev) {
          prev.userId = s.userId;
          prev.kickChannelId = s.kickChannelId;
          prev.slug = s.slug;
          prev.botExternalAccountId = overrides.get(s.channelId) || null;
        } else {
          states.set(s.channelId, {
            channelId: s.channelId,
            userId: s.userId,
            kickChannelId: s.kickChannelId,
            slug: s.slug,
            botExternalAccountId: overrides.get(s.channelId) || null,
            commandsTs: 0,
            commands: [],
            chatCursor: null,
          });
        }
      }
    } catch (e: any) {
      logger.warn('kick_chatbot.sync_failed', { errorMessage: e?.message || String(e) });
    } finally {
      syncInFlight = false;
    }
  };

  const ensureKickEventSubscriptions = async () => {
    if (stopped) return;
    if (states.size === 0) return;

    const callbackUrl = resolveKickWebhookCallbackUrl();
    if (!callbackUrl) return;

    // Keep this list conservative: events we can ingest for credits/commands and auto rewards.
    // Subscriptions are created per streamer Kick OAuth token.
    const EVENT_NAMES = [
      'chat.message.sent',
      'channel.followed',
      'channel.subscription.new',
      'channel.subscription.renewal',
      'channel.subscription.gifts',
      'kicks.gifted',
      'livestream.status.updated',
      // Channel rewards -> coins (handled by kickWebhookController; may still be gated by channel settings).
      'channel.reward.redemption.updated',
    ];

    const byUserId = new Map<string, { accessToken: string; subs: any[] } | null>();
    for (const st of states.values()) {
      const userId = String(st.userId || '').trim();
      if (!userId || byUserId.has(userId)) continue;

      const acc = await getKickExternalAccount(userId);
      if (!acc?.id) {
        byUserId.set(userId, null);
        continue;
      }
      const token = await getValidKickAccessTokenByExternalAccountId(acc.id);
      if (!token) {
        byUserId.set(userId, null);
        continue;
      }

      const listed = await listKickEventSubscriptions({ accessToken: token });
      if (!listed.ok) {
        byUserId.set(userId, { accessToken: token, subs: [] });
        continue;
      }
      byUserId.set(userId, { accessToken: token, subs: listed.subscriptions || [] });
    }

    for (const st of states.values()) {
      const userId = String(st.userId || '').trim();
      if (!userId) continue;
      const ctx = byUserId.get(userId) || null;
      if (!ctx) continue;

      for (const eventName of EVENT_NAMES) {
        const want = String(eventName || '').trim().toLowerCase();
        if (!want) continue;

        const hasSub =
          (ctx.subs || []).find((s: any) => {
            const e = String(s?.event ?? s?.type ?? s?.name ?? '').trim().toLowerCase();
            const cb = String(s?.callback_url ?? s?.callback ?? s?.transport?.callback ?? '').trim();
            return e === want && cb === callbackUrl;
          }) != null;

        if (hasSub) continue;

        const created = await createKickEventSubscription({ accessToken: ctx.accessToken, callbackUrl, event: want, version: 'v1' });
        if (!created.ok) {
          logger.warn('kick_chatbot.events_subscription_create_failed', { channelId: st.channelId, event: want, status: created.status });
        } else {
          logger.info('kick_chatbot.events_subscription_created', { channelId: st.channelId, event: want, subscriptionId: created.subscriptionId });
        }
      }
    }
  };

  const refreshCommands = async () => {
    if (stopped) return;
    if (commandsRefreshing) return;
    const channelIds = Array.from(states.keys());
    if (channelIds.length === 0) return;

    commandsRefreshing = true;
    try {
      const rows = await (prisma as any).chatBotCommand.findMany({
        where: { channelId: { in: channelIds }, enabled: true },
        select: { channelId: true, triggerNormalized: true, response: true, onlyWhenLive: true, allowedUsers: true, allowedRoles: true },
      });

      const byChannel = new Map<string, ChannelState['commands']>();
      for (const r of rows) {
        const channelId = String((r as any)?.channelId || '').trim();
        const triggerNormalized = String((r as any)?.triggerNormalized || '').trim().toLowerCase();
        const response = String((r as any)?.response || '').trim();
        const onlyWhenLive = Boolean((r as any)?.onlyWhenLive);
        if (!channelId || !triggerNormalized || !response) continue;

        const allowedUsers = Array.isArray((r as any)?.allowedUsers) ? (r as any).allowedUsers.map(normalizeLogin).filter(Boolean) : [];
        const allowedRoles = Array.isArray((r as any)?.allowedRoles) ? (r as any).allowedRoles.map((x: any) => String(x ?? '').trim()) : [];

        const list = byChannel.get(channelId) || [];
        list.push({ triggerNormalized, response, onlyWhenLive, allowedUsers, allowedRoles });
        byChannel.set(channelId, list);
      }

      for (const [channelId, st] of states.entries()) {
        st.commands = byChannel.get(channelId) || [];
        st.commandsTs = Date.now();
      }
    } catch (e: any) {
      logger.warn('kick_chatbot.commands_refresh_failed', { errorMessage: e?.message || String(e) });
    } finally {
      commandsRefreshing = false;
    }
  };

  const MAX_OUTBOX_BATCH = 25;
  const MAX_SEND_ATTEMPTS = 3;
  const PROCESSING_STALE_MS = 60_000;
  const BASE_BACKOFF_MS = 1_000;
  const MAX_BACKOFF_MS = 60_000;

  const processOutboxOnce = async () => {
    if (stopped) return;
    if (outboxInFlight) return;
    outboxInFlight = true;
    try {
      if (states.size === 0) return;
      const channelIds = Array.from(states.keys());
      const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);

      const now = new Date();
      const rows = await (prisma as any).kickChatBotOutboxMessage.findMany({
        where: {
          channelId: { in: channelIds },
          OR: [{ status: 'pending', nextAttemptAt: { lte: now } }, { status: 'processing', processingAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_OUTBOX_BATCH,
        select: { id: true, channelId: true, kickChannelId: true, message: true, status: true, attempts: true, nextAttemptAt: true },
      });
      if (!rows.length) return;

      for (const r of rows) {
        if (stopped) return;
        const channelId = String((r as any)?.channelId || '').trim();
        const st = states.get(channelId);
        if (!st) continue;

        const claim = await (prisma as any).kickChatBotOutboxMessage.updateMany({
          where: { id: r.id, status: r.status },
          data: { status: 'processing', processingAt: new Date(), lastError: null },
        });
        if (claim.count !== 1) continue;

        try {
          await sendToKickChat({ st, text: String(r.message || '') });
          await (prisma as any).kickChatBotOutboxMessage.update({
            where: { id: r.id },
            data: { status: 'sent', sentAt: new Date(), attempts: (r.attempts || 0) + 1, nextAttemptAt: new Date() },
          });
        } catch (e: any) {
          const nextAttempts = (r.attempts || 0) + 1;
          const lastError = e?.message || String(e);
          const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
          const status = Number(e?.kickStatus ?? e?.status ?? 0) || 0;
          const retryAfterSeconds = Number(e?.retryAfterSeconds ?? 0) || 0;
          const expBackoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.min(10, Math.max(0, nextAttempts - 1))));
          const backoffMs = retryAfterSeconds > 0 ? Math.min(MAX_BACKOFF_MS, retryAfterSeconds * 1000) : expBackoff;
          const nextAttemptAt = new Date(Date.now() + backoffMs);
          await (prisma as any).kickChatBotOutboxMessage.update({
            where: { id: r.id },
            data: shouldFail
              ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError, nextAttemptAt: new Date() }
              : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError, nextAttemptAt },
          });
          logger.warn('kick_chatbot.outbox_send_failed', {
            channelId: st.channelId,
            outboxId: r.id,
            attempts: nextAttempts,
            errorMessage: lastError,
            status,
            retryAfterSeconds: retryAfterSeconds > 0 ? retryAfterSeconds : null,
            backoffMs,
          });
        }
      }
    } finally {
      outboxInFlight = false;
    }
  };

  const ingestChatOnce = async () => {
    if (stopped) return;
    if (ingestInFlight) return;
    if (!chatPollUrlTemplate) return; // optional feature
    ingestInFlight = true;
    try {
      for (const st of states.values()) {
        const acc = await getKickExternalAccount(st.userId);
        if (!acc?.id) continue;
        const token = await getValidKickAccessTokenByExternalAccountId(acc.id);
        if (!token) continue;

        const url = interpolateTemplate(chatPollUrlTemplate, {
          channelId: st.kickChannelId,
          cursor: st.chatCursor || '',
        });

        const resp = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
        const raw = await resp.json().catch(() => null);
        if (!resp.ok) continue;

        const items = extractKickChatItems(raw);
        if (items.length === 0) {
          // still update cursor if present
          const cursor = String(raw?.cursor ?? raw?.next_cursor ?? raw?.nextCursor ?? '').trim() || null;
          if (cursor) st.chatCursor = cursor;
          continue;
        }

        // Update cursor from response
        const cursor = items[0]?.cursor || null;
        if (cursor) st.chatCursor = cursor;

        for (const incoming of items) {
          // Commands
          const msgNorm = normalizeMessage(incoming.text).toLowerCase();
          if (msgNorm) {
            const match = st.commands.find((c) => c.triggerNormalized === msgNorm);
            if (match?.response) {
              const allowedUsers = match.allowedUsers || [];
              const senderLogin = incoming.login || '';
              if (allowedUsers.length && (!senderLogin || !allowedUsers.includes(senderLogin))) {
                // not allowed
              } else {
                if (match.onlyWhenLive) {
                  const snap = await getStreamDurationSnapshot(st.slug);
                  if (snap.status !== 'online') {
                    // ignore
                  } else {
                    try {
                      await sendToKickChat({ st, text: match.response });
                    } catch (e: any) {
                      logger.warn('kick_chatbot.command_reply_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
                    }
                  }
                } else {
                  try {
                    await sendToKickChat({ st, text: match.response });
                  } catch (e: any) {
                    logger.warn('kick_chatbot.command_reply_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
                  }
                }
              }
            }
          }

          // Credits: chatter event
          const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'kick', platformUserId: incoming.userId });
          const creditsUserId = memalertsUserId || `kick:${incoming.userId}`;
          for (const baseUrl of backendBaseUrls) {
            void postInternalCreditsChatter(baseUrl, { channelSlug: st.slug, userId: creditsUserId, displayName: incoming.displayName });
          }
        }
      }
    } catch (e: any) {
      logger.warn('kick_chatbot.ingest_failed', { errorMessage: e?.message || String(e) });
    } finally {
      ingestInFlight = false;
    }
  };

  const shutdown = async () => {
    stopped = true;
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  await prisma.$connect();
  await syncSubscriptions();
  await refreshCommands();
  await ensureKickEventSubscriptions();
  setInterval(() => void syncSubscriptions(), syncSeconds * 1000);
  setInterval(() => void ensureKickEventSubscriptions(), syncSeconds * 1000);
  setInterval(() => void refreshCommands(), commandsRefreshSeconds * 1000);
  setInterval(() => void processOutboxOnce(), outboxPollMs);
  setInterval(() => void ingestChatOnce(), ingestPollMs);

  logger.info('kick_chatbot.started', { syncSeconds, commandsRefreshSeconds, outboxPollMs, ingestPollMs, hasChatIngest: Boolean(chatPollUrlTemplate) });
}

void start().catch((e: any) => {
  logger.error('kick_chatbot.fatal', { errorMessage: e?.message || String(e) });
  process.exit(1);
});





