import dotenv from 'dotenv';
import WebSocket from 'ws';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { fetchTrovoChatToken, getTrovoExternalAccount, getValidTrovoAccessTokenByExternalAccountId, getValidTrovoBotAccessToken, sendTrovoChatMessage } from '../utils/trovoApi.js';

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
    logger.warn('trovo_chatbot.internal_post_failed', { errorMessage: e?.message || String(e) });
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
  trovoChannelId: string;
  slug: string;
};

async function fetchEnabledTrovoSubscriptions(): Promise<SubRow[]> {
  const rows = await (prisma as any).trovoChatBotSubscription.findMany({
    where: { enabled: true },
    select: {
      channelId: true,
      userId: true,
      trovoChannelId: true,
      channel: { select: { slug: true } },
    },
  });

  // Optional gating by BotIntegrationSettings(provider=trovo).
  let gate: Map<string, boolean> | null = null;
  try {
    const channelIds = Array.from(new Set(rows.map((r: any) => String(r?.channelId || '').trim()).filter(Boolean)));
    if (channelIds.length > 0) {
      const gateRows = await (prisma as any).botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'trovo' },
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
    const trovoChannelId = String((r as any)?.trovoChannelId || '').trim();
    const slug = normalizeSlug(String((r as any)?.channel?.slug || ''));
    if (!channelId || !userId || !trovoChannelId || !slug) continue;

    if (gate) {
      const gated = gate.get(channelId);
      if (gated === false) continue;
    }

    out.push({ channelId, userId, trovoChannelId, slug });
  }
  return out;
}

async function fetchTrovoBotOverrides(channelIds: string[]): Promise<Map<string, string>> {
  // channelId -> externalAccountId
  try {
    const ids = Array.from(new Set(channelIds.map((c) => String(c || '').trim()).filter(Boolean)));
    if (ids.length === 0) return new Map();
    const rows = await (prisma as any).trovoBotIntegration.findMany({
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
    logger.warn('trovo_chatbot.bot_overrides_fetch_failed', { errorMessage: e?.message || String(e) });
    return new Map();
  }
}

type ChannelState = {
  channelId: string;
  userId: string;
  trovoChannelId: string;
  slug: string;
  ws: WebSocket | null;
  wsToken: string | null;
  wsConnected: boolean;
  lastConnectAt: number;
  // Optional per-channel bot account override (ExternalAccount.id)
  botExternalAccountId: string | null;
  // Commands cache
  commandsTs: number;
  commands: Array<{
    triggerNormalized: string;
    response: string;
    onlyWhenLive: boolean;
    allowedUsers: string[];
    allowedRoles: string[]; // stored but ignored for trovo for now
  }>;
};

function parseTrovoChatWsUrl(): string {
  return String(process.env.TROVO_CHAT_WS_URL || '').trim() || 'wss://open-chat.trovo.live/chat';
}

function extractIncomingChat(msg: any): { userId: string; displayName: string; login: string | null; text: string } | null {
  // Best-effort parsing: Trovo chat service JSON schemas may vary between versions.
  const type = String(msg?.type ?? msg?.event ?? msg?.cmd ?? '').trim().toUpperCase();
  const data = msg?.data ?? msg?.payload ?? msg?.body ?? msg;

  // Prefer explicit chat-like types
  const isChatLike = type.includes('CHAT') || type.includes('MESSAGE') || type.includes('MSG');
  if (!isChatLike && type) {
    // ignore other types (PING, ACK, etc.)
    return null;
  }

  const root = data?.chat ?? data?.message ?? data ?? null;
  const sender = root?.sender ?? root?.user ?? root?.from ?? root?.author ?? root?.senderInfo ?? root;

  const userId = String(sender?.user_id ?? sender?.userId ?? sender?.uid ?? sender?.id ?? root?.user_id ?? root?.userId ?? '').trim();
  const displayNameRaw = String(sender?.nick_name ?? sender?.nickname ?? sender?.display_name ?? sender?.displayName ?? sender?.name ?? '').trim();
  const loginRaw = String(sender?.user_name ?? sender?.username ?? sender?.login ?? '').trim();

  const text = normalizeMessage(root?.content ?? root?.text ?? root?.message ?? root?.msg ?? '');
  if (!userId || !text) return null;

  const displayName = displayNameRaw || loginRaw || userId;
  const login = loginRaw ? normalizeLogin(loginRaw) : null;
  return { userId, displayName, login, text };
}

async function sendToTrovoChat(params: { st: ChannelState; text: string }): Promise<void> {
  const messageText = normalizeMessage(params.text);
  if (!messageText) return;

  const clientId = String(process.env.TROVO_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('TROVO_CLIENT_ID is not configured');

  const token = params.st.botExternalAccountId
    ? await getValidTrovoAccessTokenByExternalAccountId(params.st.botExternalAccountId)
    : await getValidTrovoBotAccessToken();
  if (!token) throw new Error('Trovo bot token is not configured');

  const resp = await sendTrovoChatMessage({
    accessToken: token,
    clientId,
    trovoChannelId: params.st.trovoChannelId,
    content: messageText,
    sendChatUrl: process.env.TROVO_SEND_CHAT_URL || undefined,
  });
  if (!resp.ok) {
    throw new Error(`Trovo send chat failed (${resp.status})`);
  }
}

async function start() {
  const backendBaseUrls = parseBaseUrls();
  if (backendBaseUrls.length === 0) {
    logger.error('trovo_chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  const enabled = String(process.env.TROVO_CHAT_BOT_ENABLED || '').trim().toLowerCase();
  if (enabled === '0' || enabled === 'false' || enabled === 'off') {
    logger.info('trovo_chatbot.disabled_by_env');
    process.exit(0);
  }

  const syncSeconds = Math.max(5, parseIntSafe(process.env.TROVO_CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.TROVO_CHATBOT_OUTBOX_POLL_MS, 1_000));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.TROVO_CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  const wsUrl = parseTrovoChatWsUrl();

  const states = new Map<string, ChannelState>(); // channelId -> state

  let stopped = false;
  let syncInFlight = false;
  let outboxInFlight = false;
  let commandsRefreshing = false;

  const connectWs = async (st: ChannelState) => {
    if (stopped) return;
    if (st.wsConnected || st.ws) return;

    const clientId = String(process.env.TROVO_CLIENT_ID || '').trim();
    if (!clientId) {
      logger.warn('trovo_chatbot.missing_env', { key: 'TROVO_CLIENT_ID', channelId: st.channelId });
      return;
    }

    // Use the streamer's linked Trovo account to read chat.
    const acc = await getTrovoExternalAccount(st.userId);
    if (!acc?.id) return;

    const accessToken = await getValidTrovoAccessTokenByExternalAccountId(acc.id);
    if (!accessToken) return;

    const tokenResp = await fetchTrovoChatToken({
      accessToken,
      clientId,
      chatTokenUrl: process.env.TROVO_CHAT_TOKEN_URL || undefined,
    });
    if (!tokenResp.ok || !tokenResp.token) {
      logger.warn('trovo_chatbot.chat_token_failed', { channelId: st.channelId, status: tokenResp.status });
      return;
    }

    st.wsToken = tokenResp.token;
    st.lastConnectAt = Date.now();

    const ws = new WebSocket(wsUrl);
    st.ws = ws;

    const cleanup = () => {
      if (st.ws === ws) {
        st.ws = null;
        st.wsConnected = false;
      }
    };

    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({ type: 'AUTH', data: { token: st.wsToken } }));
        // Best-effort subscribe/join the channel chat (protocol differences across versions).
        ws.send(JSON.stringify({ type: 'JOIN', data: { channel_id: st.trovoChannelId } }));
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', data: { channel_id: st.trovoChannelId } }));
        st.wsConnected = true;
      } catch (e: any) {
        logger.warn('trovo_chatbot.ws_auth_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    });

    ws.on('message', async (buf) => {
      if (stopped) return;
      let msg: any = null;
      try {
        msg = JSON.parse(String(buf || ''));
      } catch {
        msg = null;
      }
      if (!msg) return;

      // Best-effort ping handling
      const t = String(msg?.type ?? msg?.event ?? '').trim().toUpperCase();
      if (t === 'PING') {
        try {
          ws.send(JSON.stringify({ type: 'PONG' }));
        } catch {
          // ignore
        }
        return;
      }

      const incoming = extractIncomingChat(msg);
      if (!incoming) return;

      // Commands
      const msgNorm = normalizeMessage(incoming.text).toLowerCase();
      if (msgNorm) {
        const match = st.commands.find((c) => c.triggerNormalized === msgNorm);
        if (match?.response) {
          const allowedUsers = match.allowedUsers || [];
          if (allowedUsers.length > 0) {
            const senderLogin = incoming.login || '';
            if (!senderLogin || !allowedUsers.includes(senderLogin)) {
              // Not allowed
            } else {
              if (match.onlyWhenLive) {
                const snap = await getStreamDurationSnapshot(st.slug);
                if (snap.status !== 'online') {
                  // ignore
                } else {
                  try {
                    await sendToTrovoChat({ st, text: match.response });
                  } catch (e: any) {
                    logger.warn('trovo_chatbot.command_reply_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
                  }
                }
              } else {
                try {
                  await sendToTrovoChat({ st, text: match.response });
                } catch (e: any) {
                  logger.warn('trovo_chatbot.command_reply_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
                }
              }
            }
          } else {
            if (match.onlyWhenLive) {
              const snap = await getStreamDurationSnapshot(st.slug);
              if (snap.status !== 'online') {
                // ignore
              } else {
                try {
                  await sendToTrovoChat({ st, text: match.response });
                } catch (e: any) {
                  logger.warn('trovo_chatbot.command_reply_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
                }
              }
            } else {
              try {
                await sendToTrovoChat({ st, text: match.response });
              } catch (e: any) {
                logger.warn('trovo_chatbot.command_reply_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
              }
            }
          }
        }
      }

      // Credits: chatter event
      const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'trovo', platformUserId: incoming.userId });
      const creditsUserId = memalertsUserId || `trovo:${incoming.userId}`;
      for (const baseUrl of backendBaseUrls) {
        void postInternalCreditsChatter(baseUrl, { channelSlug: st.slug, userId: creditsUserId, displayName: incoming.displayName });
      }
    });

    ws.on('close', () => cleanup());
    ws.on('error', () => cleanup());
  };

  const disconnectWs = async (st: ChannelState) => {
    const ws = st.ws;
    st.ws = null;
    st.wsConnected = false;
    if (!ws) return;
    try {
      ws.close();
    } catch {
      // ignore
    }
  };

  const syncSubscriptions = async () => {
    if (stopped) return;
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const subs = await fetchEnabledTrovoSubscriptions();
      const nextChannelIds = new Set(subs.map((s) => s.channelId));

      // Remove stale states
      for (const [channelId, st] of Array.from(states.entries())) {
        if (!nextChannelIds.has(channelId)) {
          await disconnectWs(st);
          states.delete(channelId);
        }
      }

      // Add/update states
      const overrides = await fetchTrovoBotOverrides(subs.map((s) => s.channelId));
      for (const s of subs) {
        const prev = states.get(s.channelId);
        if (prev) {
          const oldTrovoChannelId = prev.trovoChannelId;
          prev.userId = s.userId;
          prev.trovoChannelId = s.trovoChannelId;
          prev.slug = s.slug;
          prev.botExternalAccountId = overrides.get(s.channelId) || null;
          // If channel id changed, reconnect
          if (prev.wsConnected && oldTrovoChannelId !== s.trovoChannelId) {
            await disconnectWs(prev);
          }
        } else {
          states.set(s.channelId, {
            channelId: s.channelId,
            userId: s.userId,
            trovoChannelId: s.trovoChannelId,
            slug: s.slug,
            ws: null,
            wsToken: null,
            wsConnected: false,
            lastConnectAt: 0,
            botExternalAccountId: overrides.get(s.channelId) || null,
            commandsTs: 0,
            commands: [],
          });
        }
      }

      // Ensure connections exist
      for (const st of states.values()) {
        void connectWs(st);
      }
    } catch (e: any) {
      logger.warn('trovo_chatbot.sync_failed', { errorMessage: e?.message || String(e) });
    } finally {
      syncInFlight = false;
    }
  };

  const refreshCommands = async () => {
    if (stopped) return;
    if (commandsRefreshing) return;
    const channelIds = Array.from(states.keys());
    if (channelIds.length === 0) return;

    commandsRefreshing = true;
    try {
      let rows: any[] = [];
      try {
        rows = await (prisma as any).chatBotCommand.findMany({
          where: { channelId: { in: channelIds }, enabled: true },
          select: { channelId: true, triggerNormalized: true, response: true, onlyWhenLive: true, allowedUsers: true, allowedRoles: true },
        });
      } catch (e: any) {
        if (e?.code === 'P2022') {
          rows = await (prisma as any).chatBotCommand.findMany({
            where: { channelId: { in: channelIds }, enabled: true },
            select: { channelId: true, triggerNormalized: true, response: true, onlyWhenLive: true, allowedUsers: true, allowedRoles: true },
          });
        } else {
          throw e;
        }
      }

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
      logger.warn('trovo_chatbot.commands_refresh_failed', { errorMessage: e?.message || String(e) });
    } finally {
      commandsRefreshing = false;
    }
  };

  const MAX_OUTBOX_BATCH = 25;
  const MAX_SEND_ATTEMPTS = 3;
  const PROCESSING_STALE_MS = 60_000;

  const processOutboxOnce = async () => {
    if (stopped) return;
    if (outboxInFlight) return;
    outboxInFlight = true;
    try {
      if (states.size === 0) return;
      const channelIds = Array.from(states.keys());
      if (channelIds.length === 0) return;
      const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);

      const rows = await (prisma as any).trovoChatBotOutboxMessage.findMany({
        where: {
          channelId: { in: channelIds },
          OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_OUTBOX_BATCH,
        select: { id: true, channelId: true, trovoChannelId: true, message: true, status: true, attempts: true },
      });
      if (!rows.length) return;

      for (const r of rows) {
        if (stopped) return;
        const channelId = String((r as any)?.channelId || '').trim();
        const st = states.get(channelId);
        if (!st) continue;

        // Claim
        const claim = await (prisma as any).trovoChatBotOutboxMessage.updateMany({
          where: { id: r.id, status: r.status },
          data: { status: 'processing', processingAt: new Date(), lastError: null },
        });
        if (claim.count !== 1) continue;

        try {
          // Use same path as command replies (global sender or per-channel override)
          await sendToTrovoChat({ st, text: String(r.message || '') });
          await (prisma as any).trovoChatBotOutboxMessage.update({
            where: { id: r.id },
            data: { status: 'sent', sentAt: new Date(), attempts: (r.attempts || 0) + 1 },
          });
        } catch (e: any) {
          const nextAttempts = (r.attempts || 0) + 1;
          const lastError = e?.message || String(e);
          const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
          await (prisma as any).trovoChatBotOutboxMessage.update({
            where: { id: r.id },
            data: shouldFail
              ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError }
              : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError },
          });
          logger.warn('trovo_chatbot.outbox_send_failed', { channelId: st.channelId, outboxId: r.id, attempts: nextAttempts, errorMessage: lastError });
        }
      }
    } finally {
      outboxInFlight = false;
    }
  };

  const shutdown = async () => {
    stopped = true;
    for (const st of states.values()) {
      await disconnectWs(st);
    }
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
  setInterval(() => void syncSubscriptions(), syncSeconds * 1000);
  setInterval(() => void refreshCommands(), commandsRefreshSeconds * 1000);
  setInterval(() => void processOutboxOnce(), outboxPollMs);

  logger.info('trovo_chatbot.started', { syncSeconds, commandsRefreshSeconds, outboxPollMs, wsUrl });
}

void start().catch((e: any) => {
  logger.error('trovo_chatbot.fatal', { errorMessage: e?.message || String(e) });
  process.exit(1);
});


