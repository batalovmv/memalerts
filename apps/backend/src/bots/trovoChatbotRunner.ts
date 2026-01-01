import dotenv from 'dotenv';
import WebSocket from 'ws';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { getStreamDurationSnapshot, getStreamSessionSnapshot, handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import { fetchTrovoChatToken, getTrovoExternalAccount, getValidTrovoAccessTokenByExternalAccountId, getValidTrovoBotAccessToken, sendTrovoChatMessage } from '../utils/trovoApi.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';

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

function safeNum(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function readTierCoins(map: any, tier: string): number {
  if (!map || typeof map !== 'object') return 0;
  const key = String(tier || '').trim();
  const v = (map as any)[key];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function utcDayKey(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function utcDayKeyYesterday(d: Date): string {
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 24 * 60 * 60 * 1000);
  return utcDayKey(prev);
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
  wsAuthNonce: string | null;
  wsPingTimer: NodeJS.Timeout | null;
  wsPingGapSeconds: number;
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

function makeTrovoNonce(): string {
  // Must be present in AUTH and PING (Trovo Chat Service echoes it back in RESPONSE/PONG).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function extractIncomingChats(msg: any): Array<{ userId: string; displayName: string; login: string | null; text: string; rawChat: any }> {
  // Trovo official shape:
  // { "type":"CHAT", "channel_info": {...}, "data": { "eid":"...", "chats":[ { content, nick_name, user_name, uid/sender_id, type, ... } ] } }
  const t = String(msg?.type ?? '').trim().toUpperCase();
  if (t !== 'CHAT') return [];

  const chats = Array.isArray(msg?.data?.chats) ? msg.data.chats : [];
  if (chats.length === 0) return [];

  const out: Array<{ userId: string; displayName: string; login: string | null; text: string; rawChat: any }> = [];
  for (const chat of chats) {
    const userId = String(chat?.uid ?? chat?.sender_id ?? '').trim();
    const displayNameRaw = String(chat?.nick_name ?? '').trim();
    const loginRaw = String(chat?.user_name ?? '').trim();
    const text = normalizeMessage(chat?.content ?? '');
    if (!userId || !text) continue;

    const displayName = displayNameRaw || loginRaw || userId;
    const login = loginRaw ? normalizeLogin(loginRaw) : null;
    out.push({ userId, displayName, login, text, rawChat: chat });
  }
  return out;
}

function extractTrovoSpellFromChat(params: {
  envelope: any;
  chat: any;
}): {
  providerAccountId: string | null;
  amount: number;
  currency: 'trovo_mana' | 'trovo_elixir';
  providerEventId: string | null;
  eventAt: Date | null;
} | null {
  const chatType = Number.isFinite(Number(params.chat?.type)) ? Number(params.chat?.type) : null;
  const isSpell = chatType === 5 || chatType === 5009;
  if (!isSpell) return null;

  const providerAccountId = String(params.chat?.uid ?? params.chat?.sender_id ?? '').trim() || null;

  // Trovo spells examples often use JSON-string content like: {"gift":"Winner","num":1}
  let amount = 1;
  try {
    const parsed = JSON.parse(String(params.chat?.content ?? ''));
    const num = (parsed as any)?.num;
    if (Number.isFinite(Number(num))) amount = Math.max(1, Math.floor(Number(num)));
  } catch {
    // keep default=1
  }

  // Currency is not reliably documented in CHAT schema; keep best-effort heuristic for now.
  const contentDataStr = (() => {
    try {
      return JSON.stringify(params.chat?.content_data ?? params.chat?.contentData ?? params.chat?.data ?? null) || '';
    } catch {
      return '';
    }
  })()
    .toLowerCase()
    .trim();
  const currency: 'trovo_mana' | 'trovo_elixir' = contentDataStr.includes('elixir') ? 'trovo_elixir' : 'trovo_mana';

  const providerEventId =
    String(params.chat?.eid ?? params.chat?.id ?? params.chat?.msg_id ?? params.envelope?.data?.eid ?? '').trim() || null;

  const eventAt = (() => {
    const ts = params.chat?.send_time ?? params.chat?.sendTime ?? params.chat?.timestamp ?? null;
    const n = Number(ts);
    if (Number.isFinite(n)) {
      const ms = n < 1e12 ? n * 1000 : n;
      return new Date(ms);
    }
    const parsed = Date.parse(String(ts || ''));
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  })();

  return { providerAccountId, amount, currency, providerEventId, eventAt };
}

function extractGapSeconds(msg: any): number | null {
  const n = Number(msg?.data?.gap ?? msg?.gap ?? null);
  if (!Number.isFinite(n)) return null;
  // guardrails
  if (n < 5) return 5;
  if (n > 120) return 120;
  return Math.floor(n);
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
    const hint =
      resp.status === 401 || resp.status === 403
        ? ' Trovo selected-channel send requires scopes: bot=chat_send_self AND target channel=send_to_my_channel.'
        : '';
    const rawMsg = (() => {
      const msg = resp.raw?.message ?? resp.raw?.error ?? resp.raw?.status_message ?? resp.raw?.data?.message ?? null;
      return msg ? ` raw=${String(msg)}` : '';
    })();
    throw new Error(`Trovo send chat failed (${resp.status}).${hint}${rawMsg}`);
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

  // Auto rewards config (reuses Channel.twitchAutoRewardsJson, like VKVideo).
  const autoRewardsByChannelId = new Map<string, { ts: number; cfg: any | null }>();
  const AUTO_REWARDS_CACHE_MS = 60_000;

  async function getAutoRewardsConfig(channelId: string): Promise<any | null> {
    const id = String(channelId || '').trim();
    if (!id) return null;
    const now = Date.now();
    const cached = autoRewardsByChannelId.get(id);
    if (cached && now - cached.ts < AUTO_REWARDS_CACHE_MS) return cached.cfg ?? null;
    try {
      const ch = await prisma.channel.findUnique({ where: { id }, select: { twitchAutoRewardsJson: true } as any });
      const cfg = (ch as any)?.twitchAutoRewardsJson ?? null;
      autoRewardsByChannelId.set(id, { ts: now, cfg });
      return cfg ?? null;
    } catch {
      autoRewardsByChannelId.set(id, { ts: now, cfg: null });
      return null;
    }
  }

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
        st.wsAuthNonce = null;
        if (st.wsPingTimer) {
          clearInterval(st.wsPingTimer);
          st.wsPingTimer = null;
        }
      }
    };

    ws.on('open', () => {
      try {
        const nonce = makeTrovoNonce();
        st.wsAuthNonce = nonce;
        // Official Trovo Chat Service AUTH requires nonce.
        ws.send(JSON.stringify({ type: 'AUTH', nonce, data: { token: st.wsToken } }));
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

      const t = String(msg?.type ?? '').trim().toUpperCase();

      const ensurePingTimer = (gapSeconds: number | null) => {
        const nextGap = gapSeconds ?? st.wsPingGapSeconds ?? 30;
        st.wsPingGapSeconds = nextGap;
        if (st.wsPingTimer) clearInterval(st.wsPingTimer);
        st.wsPingTimer = setInterval(() => {
          if (stopped) return;
          if (st.ws !== ws) return;
          if (!st.wsConnected) return;
          try {
            ws.send(JSON.stringify({ type: 'PING', nonce: makeTrovoNonce() }));
          } catch {
            // ignore
          }
        }, Math.max(5, nextGap) * 1000);
      };

      // AUTH response (nonce must match)
      if (t === 'RESPONSE') {
        const nonce = String(msg?.nonce ?? '').trim();
        if (nonce && st.wsAuthNonce && nonce === st.wsAuthNonce) {
          const ok = msg?.data?.ok ?? msg?.ok ?? null;
          const err = msg?.data?.error ?? msg?.error ?? msg?.message ?? null;
          if (ok === false || err) {
            logger.warn('trovo_chatbot.ws_auth_rejected', { channelId: st.channelId, error: err || 'auth_failed' });
            try {
              ws.close();
            } catch {
              // ignore
            }
            return;
          }
          st.wsConnected = true;
          ensurePingTimer(extractGapSeconds(msg) ?? 30);
        }
        return;
      }

      // Official heartbeat: client sends PING, server responds with PONG (may include next gap).
      if (t === 'PONG') {
        const gap = extractGapSeconds(msg);
        if (gap) ensurePingTimer(gap);
        return;
      }

      // Backward-compat: if server sends PING, reply PONG (but primary heartbeat is client-initiated).
      if (t === 'PING') {
        try {
          ws.send(JSON.stringify({ type: 'PONG' }));
        } catch {
          // ignore
        }
        return;
      }

      if (t !== 'CHAT') return;
      const chats = Array.isArray(msg?.data?.chats) ? msg.data.chats : [];
      if (chats.length === 0) return;

      for (const chat of chats) {
        const chatType = Number.isFinite(Number(chat?.type)) ? Number(chat?.type) : null;

        // Trovo "stream on/off" (bot-only) can establish stream session boundaries for per-stream chat rewards.
        if (chatType === 5012) {
          try {
            const raw = String(chat?.content ?? chat?.msg ?? chat?.message ?? '').trim().toLowerCase();
            const isOnline = raw.includes('online') || raw.includes('start') || raw.includes('live') || raw === '1';
            const isOffline = raw.includes('offline') || raw.includes('end') || raw.includes('stop') || raw === '0';
            if (isOnline) await handleStreamOnline(st.slug, 60);
            if (isOffline) await handleStreamOffline(st.slug);
          } catch {
            // ignore
          }
          continue;
        }

        // Trovo spells -> coins (parsed from CHAT.data.chats[]; does NOT create Users).
        try {
          const spell = extractTrovoSpellFromChat({ envelope: msg, chat });
          if (spell?.providerAccountId && spell.amount > 0) {
            const rawPayloadJson = JSON.stringify({ envelope: msg ?? {}, chat: chat ?? {} });
            const providerEventId =
              spell.providerEventId ||
              stableProviderEventId({
                provider: 'trovo',
                rawPayloadJson,
                fallbackParts: [st.trovoChannelId, spell.providerAccountId, String(spell.amount), spell.currency],
              });

            const channel = await prisma.channel.findUnique({
              where: { id: st.channelId },
              select: { id: true, slug: true, trovoManaCoinsPerUnit: true, trovoElixirCoinsPerUnit: true } as any,
            });
            if (channel) {
              const perUnit =
                spell.currency === 'trovo_elixir'
                  ? Number((channel as any).trovoElixirCoinsPerUnit ?? 0)
                  : Number((channel as any).trovoManaCoinsPerUnit ?? 0);
              const coinsToGrant = Number.isFinite(perUnit) && perUnit > 0 ? Math.floor(spell.amount * perUnit) : 0;

              await prisma.$transaction(async (tx) => {
                await recordExternalRewardEventTx({
                  tx: tx as any,
                  provider: 'trovo',
                  providerEventId,
                  channelId: String((channel as any).id),
                  providerAccountId: spell.providerAccountId!,
                  eventType: 'trovo_spell',
                  currency: spell.currency,
                  amount: spell.amount,
                  coinsToGrant,
                  status: coinsToGrant > 0 ? 'eligible' : 'ignored',
                  reason: coinsToGrant > 0 ? null : 'trovo_spell_unconfigured',
                  eventAt: spell.eventAt,
                  rawPayloadJson,
                });
              });
            }
            continue; // don't treat spells as normal chat commands
          }
        } catch (e: any) {
          logger.warn('trovo_chatbot.spell_ingest_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
        }

        // Trovo auto rewards from chat event types (follow/sub/gifts/raid) + chat activity.
        try {
          const cfg = await getAutoRewardsConfig(st.channelId);
          if (cfg && typeof cfg === 'object') {
            const channelCfg: any = cfg;
            const eventAt = (() => {
              const ts = chat?.send_time ?? chat?.sendTime ?? chat?.timestamp ?? null;
              const n = Number(ts);
              if (Number.isFinite(n)) return new Date((n < 1e12 ? n * 1000 : n) as any);
              const parsed = Date.parse(String(ts || ''));
              return Number.isFinite(parsed) ? new Date(parsed) : new Date();
            })();

            const providerAccountId = String(chat?.uid ?? chat?.sender_id ?? '').trim() || null;

            const recordAndMaybeClaim = async (params: {
              providerEventId: string;
              providerAccountId: string;
              eventType:
                | 'twitch_follow'
                | 'twitch_subscribe'
                | 'twitch_resub_message'
                | 'twitch_gift_sub'
                | 'twitch_raid'
                | 'twitch_chat_first_message'
                | 'twitch_chat_messages_threshold'
                | 'twitch_chat_daily_streak';
              currency: 'twitch_units';
              amount: number;
              coinsToGrant: number;
              status: 'eligible' | 'ignored';
              reason?: string | null;
              rawMeta: any;
            }) => {
              const coins = Number.isFinite(params.coinsToGrant) ? Math.floor(params.coinsToGrant) : 0;
              await prisma.$transaction(async (tx: any) => {
                await recordExternalRewardEventTx({
                  tx: tx as any,
                  provider: 'trovo',
                  providerEventId: params.providerEventId,
                  channelId: st.channelId,
                  providerAccountId: params.providerAccountId,
                  eventType: params.eventType,
                  currency: params.currency,
                  amount: params.amount,
                  coinsToGrant: coins,
                  status: params.status,
                  reason: params.reason ?? null,
                  eventAt,
                  rawPayloadJson: JSON.stringify(params.rawMeta ?? {}),
                });

                const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'trovo', platformUserId: params.providerAccountId });
                if (linkedUserId && params.status === 'eligible' && coins > 0) {
                  await claimPendingCoinGrantsTx({
                    tx: tx as any,
                    userId: linkedUserId,
                    provider: 'trovo',
                    providerAccountId: params.providerAccountId,
                  });
                }
              });
            };

            // Follow (5003)
            if (chatType === 5003 && providerAccountId) {
              const rule = (channelCfg as any)?.follow ?? null;
              const enabled = Boolean(rule?.enabled);
              const coins = Math.floor(safeNum(rule?.coins ?? 0));
              const onceEver = rule?.onceEver === undefined ? true : Boolean(rule?.onceEver);
              const onlyWhenLive = Boolean(rule?.onlyWhenLive);

              if (!enabled || coins <= 0) {
                await recordAndMaybeClaim({
                  providerEventId: onceEver
                    ? stableProviderEventId({ provider: 'trovo', rawPayloadJson: '{}', fallbackParts: ['follow', st.channelId, providerAccountId] })
                    : `${String(chat?.eid ?? msg?.data?.eid ?? 'evt')}:follow`,
                  providerAccountId,
                  eventType: 'twitch_follow',
                  currency: 'twitch_units',
                  amount: 1,
                  coinsToGrant: 0,
                  status: 'ignored',
                  reason: enabled ? 'zero_coins' : 'auto_rewards_disabled',
                  rawMeta: { kind: 'trovo_follow', channelSlug: st.slug, trovoUserId: providerAccountId },
                });
              } else {
                if (onlyWhenLive) {
                  const snap = await getStreamDurationSnapshot(st.slug);
                  if (snap.status !== 'online') {
                    await recordAndMaybeClaim({
                      providerEventId: onceEver
                        ? stableProviderEventId({ provider: 'trovo', rawPayloadJson: '{}', fallbackParts: ['follow', st.channelId, providerAccountId] })
                        : `${String(chat?.eid ?? msg?.data?.eid ?? 'evt')}:follow`,
                      providerAccountId,
                      eventType: 'twitch_follow',
                      currency: 'twitch_units',
                      amount: 1,
                      coinsToGrant: 0,
                      status: 'ignored',
                      reason: 'offline',
                      rawMeta: { kind: 'trovo_follow', channelSlug: st.slug, trovoUserId: providerAccountId },
                    });
                  } else {
                    await recordAndMaybeClaim({
                      providerEventId: onceEver
                        ? stableProviderEventId({ provider: 'trovo', rawPayloadJson: '{}', fallbackParts: ['follow', st.channelId, providerAccountId] })
                        : `${String(chat?.eid ?? msg?.data?.eid ?? 'evt')}:follow`,
                      providerAccountId,
                      eventType: 'twitch_follow',
                      currency: 'twitch_units',
                      amount: 1,
                      coinsToGrant: coins,
                      status: 'eligible',
                      reason: null,
                      rawMeta: { kind: 'trovo_follow', channelSlug: st.slug, trovoUserId: providerAccountId },
                    });
                  }
                } else {
                  await recordAndMaybeClaim({
                    providerEventId: onceEver
                      ? stableProviderEventId({ provider: 'trovo', rawPayloadJson: '{}', fallbackParts: ['follow', st.channelId, providerAccountId] })
                      : `${String(chat?.eid ?? msg?.data?.eid ?? 'evt')}:follow`,
                    providerAccountId,
                    eventType: 'twitch_follow',
                    currency: 'twitch_units',
                    amount: 1,
                    coinsToGrant: coins,
                    status: 'eligible',
                    reason: null,
                    rawMeta: { kind: 'trovo_follow', channelSlug: st.slug, trovoUserId: providerAccountId },
                  });
                }
              }
              continue;
            }

            // Subscription (5001)
            if (chatType === 5001 && providerAccountId) {
              const rule = (channelCfg as any)?.subscribe ?? null;
              if (rule?.enabled) {
                const onlyWhenLive = Boolean(rule?.onlyWhenLive);
                if (!onlyWhenLive || (await getStreamDurationSnapshot(st.slug)).status === 'online') {
                  const tier = String((chat as any)?.sub_lv ?? (chat as any)?.sub_tier ?? (chat as any)?.tier ?? '1000').trim() || '1000';
                  const coins = readTierCoins((rule as any)?.tierCoins, tier);
                  if (coins > 0) {
                    await recordAndMaybeClaim({
                      providerEventId: `${String(chat?.eid ?? msg?.data?.eid ?? 'evt')}:sub`,
                      providerAccountId,
                      eventType: 'twitch_subscribe',
                      currency: 'twitch_units',
                      amount: 1,
                      coinsToGrant: coins,
                      status: 'eligible',
                      reason: null,
                      rawMeta: { kind: 'trovo_subscribe', channelSlug: st.slug, trovoUserId: providerAccountId, tier },
                    });
                  }
                }
              }
              continue;
            }

            // Gift subs (5005/5006)
            if ((chatType === 5005 || chatType === 5006) && providerAccountId) {
              const rule = (channelCfg as any)?.giftSub ?? null;
              if (rule?.enabled) {
                const onlyWhenLive = Boolean(rule?.onlyWhenLive);
                if (!onlyWhenLive || (await getStreamDurationSnapshot(st.slug)).status === 'online') {
                  let count = 1;
                  try {
                    const parsed = JSON.parse(String(chat?.content ?? ''));
                    const num = (parsed as any)?.num ?? (parsed as any)?.count ?? (parsed as any)?.total ?? null;
                    if (Number.isFinite(Number(num))) count = Math.max(1, Math.floor(Number(num)));
                  } catch {
                    // ignore
                  }

                  const tier = String((chat as any)?.sub_lv ?? (chat as any)?.sub_tier ?? (chat as any)?.tier ?? '1000').trim() || '1000';
                  const giverCoinsPerOne = readTierCoins((rule as any)?.giverTierCoins, tier);
                  const giverCoins = giverCoinsPerOne > 0 ? giverCoinsPerOne * count : 0;
                  const recipientCoins = Math.floor(safeNum((rule as any)?.recipientCoins ?? 0));

                  if (giverCoins > 0) {
                    await recordAndMaybeClaim({
                      providerEventId: `${String(chat?.eid ?? msg?.data?.eid ?? 'evt')}:gift_giver`,
                      providerAccountId,
                      eventType: 'twitch_gift_sub',
                      currency: 'twitch_units',
                      amount: count,
                      coinsToGrant: giverCoins,
                      status: 'eligible',
                      reason: null,
                      rawMeta: { kind: 'trovo_gift_sub_giver', channelSlug: st.slug, trovoUserId: providerAccountId, tier, count },
                    });
                  }

                  // Recipients are not reliably present in Trovo chat schema; ignore unless we can parse explicit uid list.
                  if (recipientCoins > 0) {
                    // best-effort: try content_data.users[].
                    const recRaw = (chat as any)?.content_data?.users ?? (chat as any)?.contentData?.users ?? [];
                    const recArr = Array.isArray(recRaw) ? recRaw : [];
                    for (const u of recArr) {
                      const rid = String((u as any)?.uid ?? (u as any)?.id ?? '').trim();
                      if (!rid) continue;
                      await recordAndMaybeClaim({
                        providerEventId: `${String(chat?.eid ?? msg?.data?.eid ?? 'evt')}:gift_recipient:${rid}`,
                        providerAccountId: rid,
                        eventType: 'twitch_gift_sub',
                        currency: 'twitch_units',
                        amount: 1,
                        coinsToGrant: recipientCoins,
                        status: 'eligible',
                        reason: null,
                        rawMeta: { kind: 'trovo_gift_sub_recipient', channelSlug: st.slug, trovoUserId: rid },
                      });
                    }
                  }
                }
              }
              continue;
            }

            // Raid (5008)
            if (chatType === 5008 && providerAccountId) {
              const rule = (channelCfg as any)?.raid ?? null;
              if (rule?.enabled) {
                const onlyWhenLive = Boolean(rule?.onlyWhenLive);
                if (!onlyWhenLive || (await getStreamDurationSnapshot(st.slug)).status === 'online') {
                  const baseCoins = Math.floor(safeNum((rule as any)?.baseCoins ?? 0));
                  const perViewer = Math.floor(safeNum((rule as any)?.coinsPerViewer ?? 0));
                  const viewers = Math.max(0, Math.floor(safeNum((chat as any)?.viewer_count ?? (chat as any)?.viewers ?? 0)));
                  const minViewers = Math.floor(safeNum((rule as any)?.minViewers ?? 0));
                  if (minViewers <= 0 || viewers >= minViewers) {
                    const coins = baseCoins + Math.max(0, perViewer) * viewers;
                    if (coins > 0) {
                      await recordAndMaybeClaim({
                        providerEventId: `${String(chat?.eid ?? msg?.data?.eid ?? 'evt')}:raid`,
                        providerAccountId,
                        eventType: 'twitch_raid',
                        currency: 'twitch_units',
                        amount: viewers,
                        coinsToGrant: coins,
                        status: 'eligible',
                        reason: null,
                        rawMeta: { kind: 'trovo_raid', channelSlug: st.slug, trovoUserId: providerAccountId, viewers },
                      });
                    }
                  }
                }
              }
              continue;
            }

            // Chat activity rewards (type 0 messages).
            if (chatType === 0 && providerAccountId) {
              const chatCfg = (channelCfg as any)?.chat ?? null;
              if (chatCfg && typeof chatCfg === 'object') {
                const redis = await getRedisClient();
                if (redis) {
                  const now = new Date();
                  const day = utcDayKey(now);
                  const yesterday = utcDayKeyYesterday(now);
                  const session = await getStreamSessionSnapshot(st.slug);
                  const isOnline = session.status === 'online' && !!session.sessionId;

                  const award = async (params: {
                    providerEventId: string;
                    eventType: 'twitch_chat_first_message' | 'twitch_chat_messages_threshold' | 'twitch_chat_daily_streak';
                    amount: number;
                    coins: number;
                    rawMeta: any;
                  }) => {
                    const coins = Number.isFinite(params.coins) ? Math.floor(params.coins) : 0;
                    if (coins <= 0) return;
                    await recordAndMaybeClaim({
                      providerEventId: params.providerEventId,
                      providerAccountId,
                      eventType: params.eventType,
                      currency: 'twitch_units',
                      amount: params.amount,
                      coinsToGrant: coins,
                      status: 'eligible',
                      reason: null,
                      rawMeta: params.rawMeta,
                    });
                  };

                  // Daily streak: award once per day on first chat message.
                  const streakCfg = (chatCfg as any)?.dailyStreak ?? null;
                  if (streakCfg?.enabled) {
                    const k = nsKey('trovo_auto_rewards', `streak:${st.channelId}:${providerAccountId}`);
                    const raw = await redis.get(k);
                    let lastDate: string | null = null;
                    let streak = 0;
                    try {
                      if (raw) {
                        const parsed = JSON.parse(raw);
                        lastDate = typeof (parsed as any)?.lastDate === 'string' ? (parsed as any).lastDate : null;
                        streak = Number.isFinite(Number((parsed as any)?.streak)) ? Math.floor(Number((parsed as any).streak)) : 0;
                      }
                    } catch {
                      lastDate = null;
                      streak = 0;
                    }

                    if (lastDate !== day) {
                      const nextStreak = lastDate === yesterday ? Math.max(1, streak + 1) : 1;
                      await redis.set(k, JSON.stringify({ lastDate: day, streak: nextStreak }), { EX: 90 * 24 * 60 * 60 });

                      const coinsByStreak = (streakCfg as any)?.coinsByStreak ?? null;
                      const coins =
                        coinsByStreak && typeof coinsByStreak === 'object'
                          ? Number((coinsByStreak as any)[String(nextStreak)] ?? 0)
                          : Number((streakCfg as any)?.coinsPerDay ?? 0);

                      const providerEventId = stableProviderEventId({
                        provider: 'trovo',
                        rawPayloadJson: '{}',
                        fallbackParts: ['chat_daily_streak', st.channelId, providerAccountId, day],
                      });
                      await award({
                        providerEventId,
                        eventType: 'twitch_chat_daily_streak',
                        amount: nextStreak,
                        coins,
                        rawMeta: { kind: 'trovo_chat_daily_streak', channelSlug: st.slug, trovoUserId: providerAccountId, day, streak: nextStreak },
                      });
                    }
                  }

                  // First message per stream: award once per user per stream session.
                  const firstCfg = (chatCfg as any)?.firstMessage ?? null;
                  if (firstCfg?.enabled) {
                    const onlyWhenLive = (firstCfg as any)?.onlyWhenLive === undefined ? true : Boolean((firstCfg as any).onlyWhenLive);
                    if (!onlyWhenLive || isOnline) {
                      const sid = String(session.sessionId || '').trim();
                      if (sid) {
                        const k = nsKey('trovo_auto_rewards', `first:${st.channelId}:${sid}:${providerAccountId}`);
                        const ok = await redis.set(k, '1', { NX: true, EX: 48 * 60 * 60 });
                        if (ok === 'OK') {
                          const providerEventId = stableProviderEventId({
                            provider: 'trovo',
                            rawPayloadJson: '{}',
                            fallbackParts: ['chat_first_message', st.channelId, sid, providerAccountId],
                          });
                          await award({
                            providerEventId,
                            eventType: 'twitch_chat_first_message',
                            amount: 1,
                            coins: Number((firstCfg as any)?.coins ?? 0),
                            rawMeta: { kind: 'trovo_chat_first_message', channelSlug: st.slug, trovoUserId: providerAccountId, sessionId: sid },
                          });
                        }
                      }
                    }
                  }

                  // Message count thresholds per stream.
                  const thrCfg = (chatCfg as any)?.messageThresholds ?? null;
                  if (thrCfg?.enabled) {
                    const onlyWhenLive = (thrCfg as any)?.onlyWhenLive === undefined ? true : Boolean((thrCfg as any).onlyWhenLive);
                    if (!onlyWhenLive || isOnline) {
                      const sid = String(session.sessionId || '').trim();
                      if (sid) {
                        const kCount = nsKey('trovo_auto_rewards', `msgcount:${st.channelId}:${sid}:${providerAccountId}`);
                        const n = await redis.incr(kCount);
                        if (n === 1) await redis.expire(kCount, 48 * 60 * 60);

                        const thresholds = Array.isArray((thrCfg as any)?.thresholds) ? (thrCfg as any).thresholds : [];
                        const hit = thresholds.some((t: any) => Number.isFinite(Number(t)) && Math.floor(Number(t)) === n);
                        if (hit) {
                          const coinsByThreshold = (thrCfg as any)?.coinsByThreshold ?? null;
                          const coins =
                            coinsByThreshold && typeof coinsByThreshold === 'object' ? Number((coinsByThreshold as any)[String(n)] ?? 0) : 0;
                          const providerEventId = stableProviderEventId({
                            provider: 'trovo',
                            rawPayloadJson: '{}',
                            fallbackParts: ['chat_messages_threshold', st.channelId, sid, providerAccountId, String(n)],
                          });
                          await award({
                            providerEventId,
                            eventType: 'twitch_chat_messages_threshold',
                            amount: n,
                            coins,
                            rawMeta: { kind: 'trovo_chat_messages_threshold', channelSlug: st.slug, trovoUserId: providerAccountId, sessionId: sid, count: n },
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (e: any) {
          logger.warn('trovo_chatbot.auto_rewards_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
        }

        // Normal chat message
        const incomingList = extractIncomingChats({ type: 'CHAT', data: { chats: [chat] } });
        for (const incoming of incomingList) {
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
        }
      }
    });

    ws.on('close', () => cleanup());
    ws.on('error', () => cleanup());
  };

  const disconnectWs = async (st: ChannelState) => {
    const ws = st.ws;
    st.ws = null;
    st.wsConnected = false;
    st.wsAuthNonce = null;
    if (st.wsPingTimer) {
      clearInterval(st.wsPingTimer);
      st.wsPingTimer = null;
    }
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
            wsAuthNonce: null,
            wsPingTimer: null,
            wsPingGapSeconds: 30,
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


