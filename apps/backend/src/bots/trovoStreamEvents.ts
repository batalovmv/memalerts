import WebSocket from 'ws';
import { handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import {
  fetchTrovoChatToken,
  getTrovoExternalAccount,
  getValidTrovoAccessTokenByExternalAccountId,
} from '../utils/trovoApi.js';
import { logger } from '../utils/logger.js';
import {
  asArray,
  asRecord,
  getErrorCode,
  getErrorMessage,
  normalizeLogin,
  normalizeMessage,
  normalizeSlug,
  prismaAny,
  type TrovoChannelState,
} from './trovoChatbotShared.js';

type SubRow = {
  channelId: string;
  userId: string;
  trovoChannelId: string;
  slug: string;
};

type IncomingChat = {
  userId: string;
  displayName: string;
  login: string | null;
  text: string;
};

type TrovoStreamEventsConfig = {
  wsUrl: string;
  stoppedRef: { value: boolean };
};

type TrovoStreamEventHandlers = {
  handleIncomingChat: (st: TrovoChannelState, incoming: IncomingChat) => Promise<void>;
  handleChatRewards: (params: {
    st: TrovoChannelState;
    envelope: unknown;
    chat: unknown;
  }) => Promise<{ skipCommands: boolean }>;
};

function makeTrovoNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function extractGapSeconds(msg: unknown): number | null {
  const msgRec = asRecord(msg);
  const msgData = asRecord(msgRec.data);
  const n = Number(msgData.gap ?? msgRec.gap ?? null);
  if (!Number.isFinite(n)) return null;
  if (n < 5) return 5;
  if (n > 120) return 120;
  return Math.floor(n);
}

function extractIncomingChat(chat: unknown): IncomingChat | null {
  const chatRec = asRecord(chat);
  const userId = String(chatRec.uid ?? chatRec.sender_id ?? '').trim();
  const displayNameRaw = String(chatRec.nick_name ?? '').trim();
  const loginRaw = String(chatRec.user_name ?? '').trim();
  const text = normalizeMessage(chatRec.content ?? '');
  if (!userId || !text) return null;
  const displayName = displayNameRaw || loginRaw || userId;
  const login = loginRaw ? normalizeLogin(loginRaw) : null;
  return { userId, displayName, login, text };
}

async function fetchEnabledTrovoSubscriptions(): Promise<SubRow[]> {
  const rows = await prismaAny.trovoChatBotSubscription.findMany({
    where: { enabled: true },
    select: {
      channelId: true,
      userId: true,
      trovoChannelId: true,
      channel: { select: { slug: true } },
    },
  });

  let gate: Map<string, boolean> | null = null;
  try {
    const channelIds = Array.from(
      new Set(rows.map((r) => String(asRecord(r).channelId ?? '').trim()).filter(Boolean))
    );
    if (channelIds.length > 0) {
      const gateRows = await prismaAny.botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'trovo' },
        select: { channelId: true, enabled: true },
      });
      gate = new Map<string, boolean>();
      for (const gr of gateRows) {
        const channelId = String(asRecord(gr).channelId ?? '').trim();
        if (!channelId) continue;
        gate.set(channelId, Boolean(asRecord(gr).enabled));
      }
    }
  } catch (e: unknown) {
    if (getErrorCode(e) !== 'P2021') throw e;
    gate = null;
  }

  const out: SubRow[] = [];
  for (const r of rows) {
    const row = asRecord(r);
    const channelId = String(row.channelId ?? '').trim();
    const userId = String(row.userId ?? '').trim();
    const trovoChannelId = String(row.trovoChannelId ?? '').trim();
    const channel = asRecord(row.channel);
    const slug = normalizeSlug(String(channel.slug ?? ''));
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
  try {
    const ids = Array.from(new Set(channelIds.map((c) => String(c || '').trim()).filter(Boolean)));
    if (ids.length === 0) return new Map();
    const rows = await prismaAny.trovoBotIntegration.findMany({
      where: { channelId: { in: ids }, enabled: true },
      select: { channelId: true, externalAccountId: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      const row = asRecord(r);
      const channelId = String(row.channelId ?? '').trim();
      const externalAccountId = String(row.externalAccountId ?? '').trim();
      if (!channelId || !externalAccountId) continue;
      map.set(channelId, externalAccountId);
    }
    return map;
  } catch (e: unknown) {
    if (getErrorCode(e) === 'P2021') return new Map();
    logger.warn('trovo_chatbot.bot_overrides_fetch_failed', { errorMessage: getErrorMessage(e) });
    return new Map();
  }
}

export function createTrovoStreamEvents(
  states: Map<string, TrovoChannelState>,
  config: TrovoStreamEventsConfig,
  handlers: TrovoStreamEventHandlers
) {
  const { wsUrl, stoppedRef } = config;
  const { handleIncomingChat, handleChatRewards } = handlers;
  let syncInFlight = false;

  const connectWs = async (st: TrovoChannelState) => {
    if (stoppedRef.value) return;
    if (st.wsConnected || st.ws) return;

    const clientId = String(process.env.TROVO_CLIENT_ID || '').trim();
    if (!clientId) {
      logger.warn('trovo_chatbot.missing_env', { key: 'TROVO_CLIENT_ID', channelId: st.channelId });
      return;
    }

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
        ws.send(JSON.stringify({ type: 'AUTH', nonce, data: { token: st.wsToken } }));
      } catch (e: unknown) {
        logger.warn('trovo_chatbot.ws_auth_failed', { channelId: st.channelId, errorMessage: getErrorMessage(e) });
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    });

    ws.on('message', async (buf) => {
      if (stoppedRef.value) return;
      let msg: unknown = null;
      try {
        msg = JSON.parse(String(buf || ''));
      } catch {
        msg = null;
      }
      if (!msg) return;

      const msgRec = asRecord(msg);
      const msgData = asRecord(msgRec.data);
      const t = String(msgRec.type ?? '')
        .trim()
        .toUpperCase();

      const ensurePingTimer = (gapSeconds: number | null) => {
        const nextGap = gapSeconds ?? st.wsPingGapSeconds ?? 30;
        st.wsPingGapSeconds = nextGap;
        if (st.wsPingTimer) clearInterval(st.wsPingTimer);
        st.wsPingTimer = setInterval(
          () => {
            if (stoppedRef.value) return;
            if (st.ws !== ws) return;
            if (!st.wsConnected) return;
            try {
              ws.send(JSON.stringify({ type: 'PING', nonce: makeTrovoNonce() }));
            } catch {
              // ignore
            }
          },
          Math.max(5, nextGap) * 1000
        );
      };

      if (t === 'RESPONSE') {
        const nonce = String(msgRec.nonce ?? '').trim();
        if (nonce && st.wsAuthNonce && nonce === st.wsAuthNonce) {
          const ok = msgData.ok ?? msgRec.ok ?? null;
          const err = msgData.error ?? msgRec.error ?? msgRec.message ?? null;
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

      if (t === 'PONG') {
        const gap = extractGapSeconds(msg);
        if (gap) ensurePingTimer(gap);
        return;
      }

      if (t === 'PING') {
        try {
          ws.send(JSON.stringify({ type: 'PONG' }));
        } catch {
          // ignore
        }
        return;
      }

      if (t !== 'CHAT') return;
      const chats = asArray(msgData.chats);
      if (chats.length === 0) return;

      for (const chat of chats) {
        const chatRec = asRecord(chat);
        const chatType = Number.isFinite(Number(chatRec.type)) ? Number(chatRec.type) : null;

        if (chatType === 5012) {
          try {
            const raw = String(chatRec.content ?? chatRec.msg ?? chatRec.message ?? '')
              .trim()
              .toLowerCase();
            const isOnline = raw.includes('online') || raw.includes('start') || raw.includes('live') || raw === '1';
            const isOffline = raw.includes('offline') || raw.includes('end') || raw.includes('stop') || raw === '0';
            if (isOnline) await handleStreamOnline(st.slug, 60);
            if (isOffline) await handleStreamOffline(st.slug);
          } catch {
            // ignore
          }
          continue;
        }

        let skipCommands = false;
        try {
          const result = await handleChatRewards({ st, envelope: msg, chat });
          skipCommands = Boolean(result?.skipCommands);
        } catch (e: unknown) {
          logger.warn('trovo_chatbot.chat_rewards_failed', {
            channelId: st.channelId,
            errorMessage: getErrorMessage(e),
          });
          skipCommands = true;
        }

        if (skipCommands) continue;
        const incoming = extractIncomingChat(chat);
        if (!incoming) continue;
        await handleIncomingChat(st, incoming);
      }
    });

    ws.on('close', () => cleanup());
    ws.on('error', () => cleanup());
  };

  const disconnectWs = async (st: TrovoChannelState) => {
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
    if (stoppedRef.value) return;
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const subs = await fetchEnabledTrovoSubscriptions();
      const nextChannelIds = new Set(subs.map((s) => s.channelId));

      for (const [channelId, st] of Array.from(states.entries())) {
        if (!nextChannelIds.has(channelId)) {
          await disconnectWs(st);
          states.delete(channelId);
        }
      }

      const overrides = await fetchTrovoBotOverrides(subs.map((s) => s.channelId));
      for (const s of subs) {
        const prev = states.get(s.channelId);
        if (prev) {
          const oldTrovoChannelId = prev.trovoChannelId;
          prev.userId = s.userId;
          prev.trovoChannelId = s.trovoChannelId;
          prev.slug = s.slug;
          prev.botExternalAccountId = overrides.get(s.channelId) || null;
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

      for (const st of states.values()) {
        void connectWs(st);
      }
    } catch (e: unknown) {
      logger.warn('trovo_chatbot.sync_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      syncInFlight = false;
    }
  };

  const disconnectAll = async () => {
    for (const st of states.values()) {
      await disconnectWs(st);
    }
  };

  return { syncSubscriptions, disconnectAll };
}
