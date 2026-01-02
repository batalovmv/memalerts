import dotenv from 'dotenv';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { VkVideoPubSubClient } from './vkvideoPubsubClient.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import { hasChannelEntitlement } from '../utils/entitlements.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';
import {
  fetchVkVideoChannel,
  fetchVkVideoCurrentUser,
  fetchVkVideoUserRolesOnChannel,
  fetchVkVideoWebsocketSubscriptionTokens,
  fetchVkVideoWebsocketToken,
  extractVkVideoChannelIdFromUrl,
  getVkVideoExternalAccount,
  getValidVkVideoAccessTokenByExternalAccountId,
  sendVkVideoChatMessage,
} from '../utils/vkvideoApi.js';

dotenv.config();

function parseIntSafe(v: any, def: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function utcDayKeyYesterday(d: Date): string {
  const x = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return utcDayKey(x);
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

function parseVkVideoRoleStubs(): Map<string, string[]> {
  // Optional dev/beta helper for role-gating until we know real VKVideo role IDs and/or have a stable roles endpoint.
  // Format (JSON):
  // {
  //   "<vkvideoChannelId>": {
  //     "login:<senderLogin>": ["role:moderator"],
  //     "user:<vkvideoUserId>": ["role:vip","role:moderator"]
  //   }
  // }
  //
  // Notes:
  // - keys are case-insensitive for logins; user ids are used as-is
  // - values are arrays of arbitrary strings (your "fake role ids" for now)
  const raw = String(process.env.VKVIDEO_ROLE_STUBS_JSON || '').trim();
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw);
    const out = new Map<string, string[]>();
    if (!parsed || typeof parsed !== 'object') return out;

    for (const [vkvideoChannelIdRaw, mapping] of Object.entries(parsed as Record<string, any>)) {
      const vkvideoChannelId = String(vkvideoChannelIdRaw || '').trim();
      if (!vkvideoChannelId || !mapping || typeof mapping !== 'object') continue;

      for (const [kRaw, vRaw] of Object.entries(mapping as Record<string, any>)) {
        const k = String(kRaw || '').trim();
        if (!k) continue;

        const list = Array.isArray(vRaw) ? vRaw.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
        if (list.length === 0) continue;

        out.set(`${vkvideoChannelId}:${k.toLowerCase()}`, list);
      }
    }

    return out;
  } catch {
    return new Map();
  }
}

type ChatCommandRole = 'vip' | 'moderator' | 'subscriber' | 'follower';

function normalizeAllowedUsersList(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const login = normalizeLogin(v);
    if (!login) continue;
    if (!out.includes(login)) out.push(login);
  }
  return out;
}

function normalizeAllowedRolesList(raw: any): ChatCommandRole[] {
  // VKVideo chat roles mapping is not implemented yet (platform-specific).
  // We still accept the schema and store it, but will ignore roles for now.
  if (!Array.isArray(raw)) return [];
  const out: ChatCommandRole[] = [];
  for (const v of raw) {
    const role = String(v ?? '').trim().toLowerCase() as ChatCommandRole;
    if (!role) continue;
    if (role !== 'vip' && role !== 'moderator' && role !== 'subscriber' && role !== 'follower') continue;
    if (!out.includes(role)) out.push(role);
  }
  return out;
}

function normalizeVkVideoAllowedRoleIdsList(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const id = String(v ?? '').trim();
    if (!id) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function canTriggerCommand(opts: {
  senderLogin: string;
  allowedUsers: string[];
  allowedRoles: ChatCommandRole[];
  vkvideoAllowedRoleIds: string[];
  senderVkVideoRoleIds: string[];
}): boolean {
  const users = opts.allowedUsers || [];
  const roles = opts.allowedRoles || [];
  const vkRoles = opts.vkvideoAllowedRoleIds || [];
  if (users.length === 0 && roles.length === 0 && vkRoles.length === 0) return true;
  if (opts.senderLogin && users.includes(opts.senderLogin)) return true;

  // Legacy Twitch roles are ignored here; VKVideo uses role ids.
  if (vkRoles.length) {
    const senderRoleIds = new Set((opts.senderVkVideoRoleIds || []).filter(Boolean));
    for (const roleId of vkRoles) {
      if (senderRoleIds.has(roleId)) return true;
    }
  }
  return false;
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
    logger.warn('vkvideo_chatbot.internal_post_failed', { errorMessage: e?.message || String(e) });
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
  userId: string | null;
  vkvideoChannelId: string;
  vkvideoChannelUrl: string | null;
  slug: string;
  creditsReconnectWindowMinutes: number;
  streamDurationCommandJson: string | null;
};

async function fetchEnabledVkVideoSubscriptions(): Promise<SubRow[]> {
  let rows: any[] = [];
  try {
    rows = await (prisma as any).vkVideoChatBotSubscription.findMany({
      where: { enabled: true },
      select: {
        channelId: true,
        userId: true,
        vkvideoChannelId: true,
        vkvideoChannelUrl: true,
        channel: { select: { slug: true, creditsReconnectWindowMinutes: true, streamDurationCommandJson: true } },
      },
    });
  } catch (e: any) {
    // Older DB without vkvideoChannelUrl column.
    if (e?.code === 'P2022') {
      rows = await (prisma as any).vkVideoChatBotSubscription.findMany({
        where: { enabled: true },
        select: {
          channelId: true,
          userId: true,
          vkvideoChannelId: true,
          channel: { select: { slug: true, creditsReconnectWindowMinutes: true, streamDurationCommandJson: true } },
        },
      });
    } else {
      throw e;
    }
  }

  // Optional gating by BotIntegrationSettings(provider=vkvideo).
  let gate: Map<string, boolean> | null = null; // channelId -> enabled
  try {
    const channelIds = Array.from(new Set(rows.map((r: any) => String(r?.channelId || '').trim()).filter(Boolean)));
    if (channelIds.length > 0) {
      const gateRows = await (prisma as any).botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'vkvideo' },
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
    const userId = String((r as any)?.userId || '').trim() || null;
    const vkvideoChannelId = String((r as any)?.vkvideoChannelId || '').trim();
    const vkvideoChannelUrl = String((r as any)?.vkvideoChannelUrl || '').trim() || null;
    const slug = normalizeSlug(String(r?.channel?.slug || ''));
    const creditsReconnectWindowMinutes = Number.isFinite(Number((r as any)?.channel?.creditsReconnectWindowMinutes))
      ? Number((r as any)?.channel?.creditsReconnectWindowMinutes)
      : 60;
    const streamDurationCommandJson = ((r as any)?.channel?.streamDurationCommandJson ?? null) as string | null;
    if (!channelId || !vkvideoChannelId || !slug) continue;

    if (gate) {
      const gated = gate.get(channelId);
      if (gated === false) continue;
    }

    out.push({ channelId, userId, vkvideoChannelId, vkvideoChannelUrl, slug, creditsReconnectWindowMinutes, streamDurationCommandJson });
  }
  return out;
}

const MAX_OUTBOX_BATCH = 25;
const MAX_SEND_ATTEMPTS = 3;
const PROCESSING_STALE_MS = 60_000;

type StreamDurationCfg = {
  enabled: boolean;
  triggerNormalized: string;
  responseTemplate: string | null;
  breakCreditMinutes: number;
  onlyWhenLive: boolean;
};

function parseStreamDurationCfg(raw: string | null | undefined): StreamDurationCfg | null {
  try {
    const s = String(raw || '').trim();
    if (!s) return null;
    const parsed = JSON.parse(s);
    const triggerNormalized = String((parsed as any)?.triggerNormalized || (parsed as any)?.trigger || '')
      .trim()
      .toLowerCase();
    if (!triggerNormalized) return null;
    const enabled = Boolean((parsed as any)?.enabled);
    const onlyWhenLive = Boolean((parsed as any)?.onlyWhenLive);
    const breakCreditMinutesRaw = Number((parsed as any)?.breakCreditMinutes);
    const breakCreditMinutes = Number.isFinite(breakCreditMinutesRaw) ? Math.max(0, Math.min(24 * 60, Math.floor(breakCreditMinutesRaw))) : 60;
    const responseTemplate =
      (parsed as any)?.responseTemplate === null ? null : String((parsed as any)?.responseTemplate || '').trim() || null;
    return { enabled, triggerNormalized, responseTemplate, breakCreditMinutes, onlyWhenLive };
  } catch {
    return null;
  }
}

async function start() {
  const enabled = String(process.env.VKVIDEO_CHAT_BOT_ENABLED || '').trim().toLowerCase();
  if (!(enabled === '1' || enabled === 'true' || enabled === 'yes' || enabled === 'on')) {
    logger.info('vkvideo_chatbot.disabled', {});
    return;
  }

  const roleStubs = parseVkVideoRoleStubs();

  const backendBaseUrls = parseBaseUrls();
  const syncSeconds = Math.max(5, parseIntSafe(process.env.VKVIDEO_CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.VKVIDEO_CHATBOT_OUTBOX_POLL_MS, 1_000));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.VKVIDEO_CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  // Avoid pubsub reconnect churn: refresh connect/subscription tokens at most once per N seconds per channel.
  const pubsubRefreshSeconds = Math.max(30, parseIntSafe(process.env.VKVIDEO_PUBSUB_REFRESH_SECONDS, 600));

  // Pubsub endpoint (Centrifugo V4, protocol v2).
  // Default points to dev pubsub, as documented in VK Video Live DevAPI pubsub docs.
  const pubsubWsUrl =
    String(process.env.VKVIDEO_PUBSUB_WS_URL || '').trim() ||
    'wss://pubsub-dev.live.vkvideo.ru/connection/websocket?format=json&cf_protocol_version=v2';
  if (backendBaseUrls.length === 0) {
    logger.error('vkvideo_chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  let stopped = false;
  let subscriptionsTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;
  let commandsTimer: NodeJS.Timeout | null = null;

  let subscriptionsSyncing = false;
  let outboxProcessing = false;
  let commandsRefreshing = false;

  // Live state per VKVideo channel
  const vkvideoIdToSlug = new Map<string, string>();
  const vkvideoIdToChannelId = new Map<string, string>();
  const vkvideoIdToOwnerUserId = new Map<string, string>();
  const streamDurationCfgByChannelId = new Map<string, { ts: number; cfg: StreamDurationCfg | null }>();
  const commandsByChannelId = new Map<
    string,
    {
      ts: number;
      items: Array<{
        triggerNormalized: string;
        response: string;
        onlyWhenLive: boolean;
        allowedRoles: ChatCommandRole[];
        allowedUsers: string[];
        vkvideoAllowedRoleIds: string[];
      }>;
    }
  >();

  // Cache VKVideo roles of a user on a channel to avoid spamming API (key: `${vkvideoChannelId}:${vkvideoUserId}`).
  const userRolesCache = new Map<string, { ts: number; roleIds: string[] }>();
  const USER_ROLES_CACHE_TTL_MS = Math.max(5_000, parseIntSafe(process.env.VKVIDEO_USER_ROLES_CACHE_TTL_MS, 30_000));

  // Subscription context per VKVideo channel
  const vkvideoIdToChannelUrl = new Map<string, string>();
  const vkvideoIdToLastLiveStreamId = new Map<string, string | null>();

  // Auto rewards config (reuses Channel.twitchAutoRewardsJson; see twitchChatBot.ts).
  const autoRewardsByChannelId = new Map<string, { ts: number; cfg: any | null }>();
  const AUTO_REWARDS_CACHE_MS = 30_000;

  // Pubsub connection per MemAlerts channelId (uses streamer's VKVideo OAuth token).
  const pubsubByChannelId = new Map<string, VkVideoPubSubClient>();
  const pubsubCtxByChannelId = new Map<
    string,
    {
      tokenFetchedAt: number;
      wsChannelsKey: string;
    }
  >();
  const wsChannelToVkvideoId = new Map<string, string>(); // pubsub channel name -> vkvideoChannelId

  function extractTextFromParts(parts: any): string {
    if (!Array.isArray(parts)) return '';
    const chunks: string[] = [];
    for (const p of parts) {
      const t = String(p?.text?.content || '').trim();
      if (t) chunks.push(t);
    }
    return chunks.join(' ').trim();
  }

  function extractFirstMentionIdFromParts(parts: any): string | null {
    if (!Array.isArray(parts)) return null;
    for (const p of parts) {
      const id = p?.mention?.id ?? null;
      const s = String(id ?? '').trim();
      if (s) return s;
    }
    return null;
  }

  function extractIncomingMessage(pubData: any): { text: string; userId: string; displayName: string; senderLogin: string | null } | null {
    // pubData may be either {type,data} or directly some message-like object.
    const root = pubData?.data ?? pubData ?? null;
    const maybe = root?.message ?? root?.chat_message ?? root ?? null;

    const author = maybe?.author ?? maybe?.user ?? root?.user ?? null;
    const userId = String(author?.id ?? maybe?.user_id ?? root?.user_id ?? '').trim();
    const displayName = String(author?.nick ?? author?.name ?? maybe?.display_name ?? root?.display_name ?? '').trim();

    const parts = maybe?.parts ?? root?.parts ?? maybe?.data?.parts ?? null;
    const text = extractTextFromParts(parts) || String(maybe?.text ?? root?.text ?? '').trim();

    if (!userId || !displayName || !text) return null;

    const senderLogin = author?.nick ? normalizeLogin(author.nick) : null;
    return { text, userId, displayName, senderLogin: senderLogin || null };
  }

  function extractVkVideoFollowOrSubscriptionAlert(pubData: any): {
    kind: 'follow' | 'subscribe';
    providerAccountId: string;
    providerEventId: string | null;
    eventAt: Date | null;
  } | null {
    const type = String(pubData?.type ?? pubData?.event ?? pubData?.name ?? '').trim().toLowerCase();
    if (!type) return null;

    const isFollow = type.includes('follow');
    const isSub = type.includes('subscription') || type.includes('subscribe') || type.includes('sub');
    if (!isFollow && !isSub) return null;

    const root = pubData?.data ?? pubData ?? null;
    const ev = root?.event ?? root?.data ?? root ?? null;

    const maybeMsg = ev?.message ?? ev?.chat_message ?? ev ?? null;
    const parts = maybeMsg?.parts ?? ev?.parts ?? root?.parts ?? root?.message?.parts ?? null;

    const providerAccountId = String(
      ev?.user?.id ?? ev?.viewer?.id ?? ev?.from?.id ?? ev?.user_id ?? extractFirstMentionIdFromParts(parts) ?? ''
    ).trim();
    if (!providerAccountId) return null;

    const providerEventId = String(ev?.id ?? ev?.event_id ?? ev?.message_id ?? root?.id ?? '').trim() || null;

    const eventAt = (() => {
      const ts = ev?.created_at ?? ev?.createdAt ?? ev?.timestamp ?? root?.timestamp ?? null;
      const ms = typeof ts === 'number' ? ts : Date.parse(String(ts || ''));
      return Number.isFinite(ms) ? new Date(ms) : null;
    })();

    return { kind: isFollow ? 'follow' : 'subscribe', providerAccountId, providerEventId, eventAt };
  }

  function extractVkVideoChannelPointsRedemption(pubData: any): { providerAccountId: string; amount: number; rewardId: string | null; providerEventId: string | null; eventAt: Date | null } | null {
    const type = String(pubData?.type ?? pubData?.event ?? pubData?.name ?? '').trim().toLowerCase();
    if (type && !type.includes('channel_points') && !type.includes('channelpoints') && !type.includes('points')) return null;

    const root = pubData?.data ?? pubData ?? null;
    const ev = root?.event ?? root?.redemption ?? root ?? null;

    const providerAccountId = String(ev?.user?.id ?? ev?.viewer?.id ?? ev?.from?.id ?? ev?.user_id ?? '').trim();
    if (!providerAccountId) return null;

    const amountRaw = ev?.cost ?? ev?.amount ?? ev?.points ?? ev?.value ?? ev?.reward?.cost ?? null;
    const amount = Number.isFinite(Number(amountRaw)) ? Math.floor(Number(amountRaw)) : 0;
    if (amount <= 0) return null;

    const rewardId = String(ev?.reward?.id ?? ev?.reward_id ?? ev?.reward?.uuid ?? '').trim() || null;
    const providerEventId = String(ev?.id ?? ev?.redemption_id ?? ev?.event_id ?? '').trim() || null;

    const eventAt = (() => {
      const ts = ev?.created_at ?? ev?.createdAt ?? ev?.timestamp ?? root?.timestamp ?? null;
      const ms = typeof ts === 'number' ? ts : Date.parse(String(ts || ''));
      return Number.isFinite(ms) ? new Date(ms) : null;
    })();

    return { providerAccountId, amount, rewardId, providerEventId, eventAt };
  }

  async function sendToVkVideoChat(params: { vkvideoChannelId: string; text: string }): Promise<void> {
    const vkvideoChannelId = params.vkvideoChannelId;
    const channelUrl = vkvideoIdToChannelUrl.get(vkvideoChannelId) || null;
    const ownerUserId = vkvideoIdToOwnerUserId.get(vkvideoChannelId) || null;
    const channelId = vkvideoIdToChannelId.get(vkvideoChannelId) || null;
    if (!channelUrl || !ownerUserId) throw new Error('missing_channel_context');

    // Prefer sender identity:
    // 1) per-channel override bot (VkVideoBotIntegration)
    // 2) global default bot (GlobalVkVideoBotCredential)
    // 3) fallback to owner's linked VKVideo token (back-compat; will be removed later)
    let accessToken: string | null = null;

    if (channelId) {
      const canUseOverride = await hasChannelEntitlement(channelId, 'custom_bot');
      if (canUseOverride) {
        try {
          const override = await (prisma as any).vkVideoBotIntegration.findUnique({
            where: { channelId },
            select: { enabled: true, externalAccountId: true },
          });
          const extId = override?.enabled ? String(override.externalAccountId || '').trim() : '';
          if (extId) accessToken = await getValidVkVideoAccessTokenByExternalAccountId(extId);
        } catch (e: any) {
          if (e?.code !== 'P2021') throw e;
        }
      }

      if (!accessToken) {
        try {
          const global = await (prisma as any).globalVkVideoBotCredential.findFirst({
            where: { enabled: true },
            orderBy: { updatedAt: 'desc' },
            select: { externalAccountId: true },
          });
          const extId = String(global?.externalAccountId || '').trim();
          if (extId) accessToken = await getValidVkVideoAccessTokenByExternalAccountId(extId);
        } catch (e: any) {
          if (e?.code !== 'P2021') throw e;
        }
      }
    }

    if (!accessToken) {
      const account = await getVkVideoExternalAccount(ownerUserId);
      accessToken = account?.accessToken || null;
    }

    if (!accessToken) throw new Error('missing_sender_access_token');

    const ch = await fetchVkVideoChannel({ accessToken, channelUrl });
    if (!ch.ok) throw new Error(ch.error || 'channel_fetch_failed');
    if (!ch.streamId) throw new Error('no_active_stream');

    const resp = await sendVkVideoChatMessage({ accessToken, channelUrl, streamId: ch.streamId, text: params.text });
    if (!resp.ok) throw new Error(resp.error || 'send_failed');
  }

  const handleIncoming = async (vkvideoChannelId: string, incoming: { text: string; userId: string; displayName: string; senderLogin: string | null }) => {
    if (stopped) return;
    const slug = vkvideoIdToSlug.get(vkvideoChannelId);
    const channelId = vkvideoIdToChannelId.get(vkvideoChannelId);
    const ownerUserId = vkvideoIdToOwnerUserId.get(vkvideoChannelId) || null;
    if (!slug || !channelId) return;

    const msgNorm = normalizeMessage(incoming.text).toLowerCase();
    const senderLogin = normalizeLogin(incoming.senderLogin || incoming.displayName);

    // Refresh commands if cache is stale
    const now = Date.now();
    const cached = commandsByChannelId.get(channelId);
    if (!cached || now - cached.ts > commandsRefreshSeconds * 1000) {
      void refreshCommands();
    }

    // Smart command: stream duration
    const smart = streamDurationCfgByChannelId.get(channelId);
    if (msgNorm && smart) {
      if (now - smart.ts > commandsRefreshSeconds * 1000) {
        void refreshCommands();
      } else if (smart.cfg?.enabled && smart.cfg.triggerNormalized === msgNorm) {
        try {
          const snap = await getStreamDurationSnapshot(slug);
          if (!(smart.cfg.onlyWhenLive && snap.status !== 'online')) {
            const totalMinutes = snap.totalMinutes;
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            const template = smart.cfg.responseTemplate ?? 'Время стрима: {hours}ч {minutes}м ({totalMinutes}м)';
            const reply = template
              .replace(/\{hours\}/g, String(hours))
              .replace(/\{minutes\}/g, String(minutes))
              .replace(/\{totalMinutes\}/g, String(totalMinutes))
              .trim();
            if (reply) {
              await sendToVkVideoChat({ vkvideoChannelId, text: reply });
              return;
            }
          }
        } catch (e: any) {
          logger.warn('vkvideo_chatbot.stream_duration_reply_failed', { vkvideoChannelId, errorMessage: e?.message || String(e) });
        }
      }
    }

    // Static commands
    if (msgNorm) {
      const items = commandsByChannelId.get(channelId)?.items || [];
      const match = items.find((c) => c.triggerNormalized === msgNorm);
      if (match?.response) {
        try {
          let senderRoleIds: string[] = [];
          if (match.vkvideoAllowedRoleIds?.length) {
            // Try role stubs first (dev/beta), then fallback to API role lookup (if configured).
            const stubKeyByUser = `user:${String(incoming.userId || '').trim()}`.toLowerCase();
            const stubKeyByLogin = `login:${String(senderLogin || '').trim().toLowerCase()}`.toLowerCase();
            const stubUser = roleStubs.get(`${vkvideoChannelId}:${stubKeyByUser}`);
            const stubLogin = senderLogin ? roleStubs.get(`${vkvideoChannelId}:${stubKeyByLogin}`) : undefined;
            if (stubUser?.length) {
              senderRoleIds = stubUser;
            } else if (stubLogin?.length) {
              senderRoleIds = stubLogin;
            } else if (ownerUserId) {
              const cacheKey = `${vkvideoChannelId}:${incoming.userId}`;
              const cachedRoles = userRolesCache.get(cacheKey);
              const now = Date.now();
              if (cachedRoles && now - cachedRoles.ts <= USER_ROLES_CACHE_TTL_MS) {
                senderRoleIds = cachedRoles.roleIds;
              } else {
                // Prefer querying roles with the same sender token used for writes; fallback to owner's token.
                let tokenForRoles: string | null = null;
                const channelId = vkvideoIdToChannelId.get(vkvideoChannelId) || null;

                if (channelId) {
                  const canUseOverride = await hasChannelEntitlement(channelId, 'custom_bot');
                  if (canUseOverride) {
                    try {
                      const override = await (prisma as any).vkVideoBotIntegration.findUnique({
                        where: { channelId },
                        select: { enabled: true, externalAccountId: true },
                      });
                      const extId = override?.enabled ? String(override.externalAccountId || '').trim() : '';
                      if (extId) tokenForRoles = await getValidVkVideoAccessTokenByExternalAccountId(extId);
                    } catch (e: any) {
                      if (e?.code !== 'P2021') throw e;
                    }
                  }

                  if (!tokenForRoles) {
                    try {
                      const global = await (prisma as any).globalVkVideoBotCredential.findFirst({
                        where: { enabled: true },
                        orderBy: { updatedAt: 'desc' },
                        select: { externalAccountId: true },
                      });
                      const extId = String(global?.externalAccountId || '').trim();
                      if (extId) tokenForRoles = await getValidVkVideoAccessTokenByExternalAccountId(extId);
                    } catch (e: any) {
                      if (e?.code !== 'P2021') throw e;
                    }
                  }
                }

                if (!tokenForRoles) {
                  const account = await getVkVideoExternalAccount(ownerUserId);
                  tokenForRoles = account?.accessToken || null;
                }

                if (tokenForRoles) {
                  const rolesResp = await fetchVkVideoUserRolesOnChannel({
                    accessToken: tokenForRoles,
                    vkvideoChannelId,
                    vkvideoUserId: incoming.userId,
                  });
                  if (rolesResp.ok) {
                    senderRoleIds = rolesResp.roleIds;
                    userRolesCache.set(cacheKey, { ts: now, roleIds: senderRoleIds });
                  } else {
                    // If we can't resolve roles, be conservative: do not allow role-gated commands.
                    senderRoleIds = [];
                  }
                }
              }
            }
          }

          if (
            !canTriggerCommand({
              senderLogin,
              allowedUsers: match.allowedUsers || [],
              allowedRoles: match.allowedRoles || [],
              vkvideoAllowedRoleIds: match.vkvideoAllowedRoleIds || [],
              senderVkVideoRoleIds: senderRoleIds,
            })
          ) {
            return;
          }
          if (match.onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(slug);
            if (snap.status !== 'online') return;
          }
          await sendToVkVideoChat({ vkvideoChannelId, text: match.response });
        } catch (e: any) {
          logger.warn('vkvideo_chatbot.command_reply_failed', { vkvideoChannelId, errorMessage: e?.message || String(e) });
        }
      }
    }

    // Credits: chatter event
    const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'vkvideo', platformUserId: incoming.userId });
    const creditsUserId = memalertsUserId || `vkvideo:${incoming.userId}`;
    for (const baseUrl of backendBaseUrls) {
      void postInternalCreditsChatter(baseUrl, { channelSlug: slug, userId: creditsUserId, displayName: incoming.displayName });
    }

    // Auto rewards: chat activity (reuses Channel.twitchAutoRewardsJson.chat config).
    try {
      const cached = autoRewardsByChannelId.get(channelId) || null;
      const cfg = cached?.cfg ?? null;
      const chatCfg = (cfg as any)?.chat ?? null;
      if (!chatCfg) return;

      const redis = await getRedisClient();
      const now = new Date();
      const day = utcDayKey(now);
      const yesterday = utcDayKeyYesterday(now);

      const streamId = vkvideoIdToLastLiveStreamId.get(vkvideoChannelId) || null;
      const isOnline = Boolean(streamId);

      const award = async (params: {
        providerEventId: string;
        eventType: 'twitch_chat_first_message' | 'twitch_chat_messages_threshold' | 'twitch_chat_daily_streak';
        amount: number;
        coins: number;
        rawMeta: any;
      }) => {
        const coins = Number.isFinite(params.coins) ? Math.floor(params.coins) : 0;
        if (coins <= 0) return;

        const linkedUserId = memalertsUserId || null;
        await prisma.$transaction(async (tx: any) => {
          await recordExternalRewardEventTx({
            tx: tx as any,
            provider: 'vkvideo',
            providerEventId: params.providerEventId,
            channelId,
            providerAccountId: incoming.userId,
            eventType: params.eventType,
            currency: 'twitch_units',
            amount: params.amount,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
            eventAt: now,
            rawPayloadJson: JSON.stringify(params.rawMeta ?? {}),
          });

          // If user already linked, claim immediately (no realtime emit here; runner is out-of-process).
          if (linkedUserId) {
            await claimPendingCoinGrantsTx({
              tx: tx as any,
              userId: linkedUserId,
              provider: 'vkvideo',
              providerAccountId: incoming.userId,
            });
          }
        });
      };

      // Daily streak: award once per day on first chat message.
      const streakCfg = (chatCfg as any)?.dailyStreak ?? null;
      if (streakCfg?.enabled) {
        // Prefer Redis for cross-restart stability; fallback to DB-only dedupe with "best-effort streak=1".
        let nextStreak = 1;
        if (redis) {
          const k = nsKey('vkvideo_auto_rewards', `streak:${channelId}:${incoming.userId}`);
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
            nextStreak = lastDate === yesterday ? Math.max(1, streak + 1) : 1;
            await redis.set(k, JSON.stringify({ lastDate: day, streak: nextStreak }), { EX: 90 * 24 * 60 * 60 });
          } else {
            nextStreak = 0; // already handled today
          }
        } else {
          // No redis: we can still award once per day using providerEventId dedupe, but streak can't be tracked reliably.
          nextStreak = 1;
        }

        if (nextStreak > 0) {
          const coinsByStreak = (streakCfg as any)?.coinsByStreak ?? null;
          const coins =
            coinsByStreak && typeof coinsByStreak === 'object'
              ? Number((coinsByStreak as any)[String(nextStreak)] ?? 0)
              : Number((streakCfg as any)?.coinsPerDay ?? 0);

          const providerEventId = stableProviderEventId({
            provider: 'vkvideo',
            rawPayloadJson: '{}',
            fallbackParts: ['chat_daily_streak', channelId, incoming.userId, day],
          });
          await award({
            providerEventId,
            eventType: 'twitch_chat_daily_streak',
            amount: nextStreak,
            coins,
            rawMeta: { kind: 'vkvideo_chat_daily_streak', channelSlug: slug, vkvideoUserId: incoming.userId, day, streak: nextStreak },
          });
        }
      }

      // First message per stream: award once per user per stream session.
      const firstCfg = (chatCfg as any)?.firstMessage ?? null;
      if (firstCfg?.enabled) {
        const onlyWhenLive = (firstCfg as any)?.onlyWhenLive === undefined ? true : Boolean((firstCfg as any).onlyWhenLive);
        if (!onlyWhenLive || isOnline) {
          const sid = String(streamId || '').trim();
          if (sid) {
            if (redis) {
              const k = nsKey('vkvideo_auto_rewards', `first:${channelId}:${sid}:${incoming.userId}`);
              const ok = await redis.set(k, '1', { NX: true, EX: 48 * 60 * 60 });
              if (ok === 'OK') {
                const providerEventId = stableProviderEventId({
                  provider: 'vkvideo',
                  rawPayloadJson: '{}',
                  fallbackParts: ['chat_first_message', channelId, sid, incoming.userId],
                });
                await award({
                  providerEventId,
                  eventType: 'twitch_chat_first_message',
                  amount: 1,
                  coins: Number((firstCfg as any)?.coins ?? 0),
                  rawMeta: { kind: 'vkvideo_chat_first_message', channelSlug: slug, vkvideoUserId: incoming.userId, streamId: sid },
                });
              }
            } else {
              // Without Redis we skip (too spammy without dedupe across restarts).
            }
          }
        }
      }

      // Message count thresholds per stream.
      const thrCfg = (chatCfg as any)?.messageThresholds ?? null;
      if (thrCfg?.enabled) {
        const onlyWhenLive = (thrCfg as any)?.onlyWhenLive === undefined ? true : Boolean((thrCfg as any).onlyWhenLive);
        if (!onlyWhenLive || isOnline) {
          const sid = String(streamId || '').trim();
          if (sid && redis) {
            const kCount = nsKey('vkvideo_auto_rewards', `msgcount:${channelId}:${sid}:${incoming.userId}`);
            const n = await redis.incr(kCount);
            if (n === 1) await redis.expire(kCount, 48 * 60 * 60);

            const thresholds = Array.isArray((thrCfg as any)?.thresholds) ? (thrCfg as any).thresholds : [];
            const hit = thresholds.some((t: any) => Number.isFinite(Number(t)) && Math.floor(Number(t)) === n);
            if (hit) {
              const coinsByThreshold = (thrCfg as any)?.coinsByThreshold ?? null;
              const coins = coinsByThreshold && typeof coinsByThreshold === 'object' ? Number((coinsByThreshold as any)[String(n)] ?? 0) : 0;
              const providerEventId = stableProviderEventId({
                provider: 'vkvideo',
                rawPayloadJson: '{}',
                fallbackParts: ['chat_messages_threshold', channelId, sid, incoming.userId, String(n)],
              });
              await award({
                providerEventId,
                eventType: 'twitch_chat_messages_threshold',
                amount: n,
                coins,
                rawMeta: { kind: 'vkvideo_chat_messages_threshold', channelSlug: slug, vkvideoUserId: incoming.userId, streamId: sid, count: n },
              });
            }
          }
        }
      }
    } catch (e: any) {
      // Never fail credits/commands flow because of auto rewards.
      logger.warn('vkvideo_chatbot.auto_rewards_failed', { errorMessage: e?.message || String(e) });
    }
  };

  const refreshCommands = async () => {
    if (stopped) return;
    if (commandsRefreshing) return;
    const channelIds = Array.from(new Set(Array.from(vkvideoIdToChannelId.values()).filter(Boolean)));
    if (channelIds.length === 0) return;

    commandsRefreshing = true;
    try {
      let rows: any[] = [];
      try {
        rows = await (prisma as any).chatBotCommand.findMany({
          where: { channelId: { in: channelIds }, enabled: true },
          select: {
            channelId: true,
            triggerNormalized: true,
            response: true,
            onlyWhenLive: true,
            allowedRoles: true,
            allowedUsers: true,
            vkvideoAllowedRoleIds: true,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2022') {
          rows = await (prisma as any).chatBotCommand.findMany({
            where: { channelId: { in: channelIds }, enabled: true },
            select: { channelId: true, triggerNormalized: true, response: true },
          });
        } else {
          throw e;
        }
      }

      const grouped = new Map<string, any[]>();
      for (const r of rows) {
        const channelId = String((r as any)?.channelId || '').trim();
        const triggerNormalized = String((r as any)?.triggerNormalized || '').trim().toLowerCase();
        const response = String((r as any)?.response || '').trim();
        const onlyWhenLive = Boolean((r as any)?.onlyWhenLive);
        const allowedRoles = normalizeAllowedRolesList((r as any)?.allowedRoles);
        const allowedUsers = normalizeAllowedUsersList((r as any)?.allowedUsers);
        const vkvideoAllowedRoleIds = normalizeVkVideoAllowedRoleIdsList((r as any)?.vkvideoAllowedRoleIds);
        if (!channelId || !triggerNormalized || !response) continue;
        const arr = grouped.get(channelId) || [];
        arr.push({ triggerNormalized, response, onlyWhenLive, allowedRoles, allowedUsers, vkvideoAllowedRoleIds });
        grouped.set(channelId, arr);
      }

      const now = Date.now();
      for (const id of channelIds) {
        commandsByChannelId.set(id, { ts: now, items: grouped.get(id) || [] });
      }

      // Stream duration JSON config is stored on Channel
      try {
        const chRows = await (prisma as any).channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, streamDurationCommandJson: true, twitchAutoRewardsJson: true },
        });
        const byId = new Map<string, any>();
        for (const r of chRows) {
          const id = String((r as any)?.id || '').trim();
          if (!id) continue;
          byId.set(id, r);
        }
        for (const id of channelIds) {
          const raw = String(byId.get(id)?.streamDurationCommandJson || '').trim();
          streamDurationCfgByChannelId.set(id, { ts: now, cfg: raw ? parseStreamDurationCfg(raw) : null });
          autoRewardsByChannelId.set(id, { ts: now, cfg: byId.get(id)?.twitchAutoRewardsJson ?? null });
        }
      } catch (e: any) {
        if (e?.code !== 'P2022') logger.warn('vkvideo_chatbot.stream_duration_cfg_refresh_failed', { errorMessage: e?.message || String(e) });
      }
    } catch (e: any) {
      logger.warn('vkvideo_chatbot.commands_refresh_failed', { errorMessage: e?.message || String(e) });
    } finally {
      commandsRefreshing = false;
    }
  };

  const syncSubscriptions = async () => {
    if (stopped) return;
    if (subscriptionsSyncing) return;
    subscriptionsSyncing = true;
    try {
      const subs = await fetchEnabledVkVideoSubscriptions();

      const wantedChannelIds = new Set(subs.map((s) => s.channelId));

      // Stop clients for removed channels
      for (const existingChannelId of Array.from(pubsubByChannelId.keys())) {
        if (!wantedChannelIds.has(existingChannelId)) {
          pubsubByChannelId.get(existingChannelId)?.stop();
          pubsubByChannelId.delete(existingChannelId);
          pubsubCtxByChannelId.delete(existingChannelId);
        }
      }

      // Rebuild mapping from pubsub channel -> vkvideoChannelId
      wsChannelToVkvideoId.clear();

      // Start/restart pubsub clients for current subscriptions.
      for (const s of subs) {
      vkvideoIdToSlug.set(s.vkvideoChannelId, s.slug);
      vkvideoIdToChannelId.set(s.vkvideoChannelId, s.channelId);
      if (s.userId) vkvideoIdToOwnerUserId.set(s.vkvideoChannelId, s.userId);
      if (s.vkvideoChannelUrl) vkvideoIdToChannelUrl.set(s.vkvideoChannelId, String(s.vkvideoChannelUrl));

      // Require owner userId + channelUrl to access DevAPI and send messages.
      if (!s.userId) {
        logger.warn('vkvideo_chatbot.subscription_missing_user', { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId });
        continue;
      }
      const account = await getVkVideoExternalAccount(s.userId);
      if (!account?.accessToken) {
        logger.warn('vkvideo_chatbot.subscription_missing_access_token', { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId });
        continue;
      }

      // Back-compat: older subscriptions may not have vkvideoChannelUrl persisted yet.
      // Try to auto-resolve it from VKVideo current_user, so outbox/commands can work without requiring a manual "disable -> enable".
      let channelUrl = String(s.vkvideoChannelUrl || '').trim();
      if (!channelUrl) {
        try {
          const currentUser = await fetchVkVideoCurrentUser({ accessToken: account.accessToken });
          if (currentUser.ok) {
            const root = (currentUser.data as any)?.data ?? (currentUser.data as any) ?? null;
            const urlPrimary = String(root?.channel?.url || '').trim();
            const urls = Array.isArray(root?.channels)
              ? root.channels.map((c: any) => String(c?.url || '').trim()).filter(Boolean)
              : [];
            const unique = Array.from(new Set([urlPrimary, ...urls].filter(Boolean)));

            const matched = unique.filter((u) => extractVkVideoChannelIdFromUrl(u) === s.vkvideoChannelId);
            const resolved = matched[0] || (unique.length === 1 ? unique[0] : null);
            if (resolved) {
              channelUrl = resolved;
              vkvideoIdToChannelUrl.set(s.vkvideoChannelId, channelUrl);
              try {
                await (prisma as any).vkVideoChatBotSubscription.update({
                  where: { channelId: s.channelId },
                  data: { vkvideoChannelUrl: channelUrl },
                });
              } catch (e: any) {
                // Ignore if DB schema is older (no column yet) or update fails transiently.
                if (e?.code !== 'P2022') {
                  logger.warn('vkvideo_chatbot.subscription_autofill_persist_failed', {
                    channelId: s.channelId,
                    vkvideoChannelId: s.vkvideoChannelId,
                    errorMessage: e?.message || String(e),
                  });
                }
              }
              logger.info('vkvideo_chatbot.subscription_autofilled_channel_url', {
                channelId: s.channelId,
                vkvideoChannelId: s.vkvideoChannelId,
              });
            }
          } else {
            logger.warn('vkvideo_chatbot.current_user_failed', {
              channelId: s.channelId,
              vkvideoChannelId: s.vkvideoChannelId,
              errorMessage: currentUser.error,
            });
          }
        } catch (e: any) {
          logger.warn('vkvideo_chatbot.subscription_autofill_failed', {
            channelId: s.channelId,
            vkvideoChannelId: s.vkvideoChannelId,
            errorMessage: e?.message || String(e),
          });
        }
      }

      if (!channelUrl) {
        logger.warn('vkvideo_chatbot.subscription_missing_channel_url', { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId });
        continue;
      }

      const chInfo = await fetchVkVideoChannel({ accessToken: account.accessToken, channelUrl });
      if (!chInfo.ok) {
        logger.warn('vkvideo_chatbot.channel_info_failed', { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId, error: chInfo.error });
        continue;
      }

      // Track VKVideo live status into streamDurationStore, so the "stream duration" smart command works for VKVideo too.
      // We treat presence of streamId as "online".
      try {
        const prevStreamId = vkvideoIdToLastLiveStreamId.get(s.vkvideoChannelId) ?? null;
        const nextStreamId = chInfo.streamId ?? null;
        vkvideoIdToLastLiveStreamId.set(s.vkvideoChannelId, nextStreamId);

        const wasOnline = Boolean(prevStreamId);
        const isOnline = Boolean(nextStreamId);

        if (!wasOnline && isOnline) {
          const cfg = streamDurationCfgByChannelId.get(s.channelId)?.cfg;
          const breakCreditMinutes = cfg?.breakCreditMinutes ?? 60;
          await handleStreamOnline(s.slug, breakCreditMinutes);
        } else if (wasOnline && !isOnline) {
          await handleStreamOffline(s.slug);
        }
      } catch (e: any) {
        logger.warn('vkvideo_chatbot.stream_duration_update_failed', {
          channelId: s.channelId,
          vkvideoChannelId: s.vkvideoChannelId,
          errorMessage: e?.message || String(e),
        });
      }

      const wsChannels: string[] = [];
      const chatCh = String(chInfo.webSocketChannels?.chat || '').trim();
      const limitedChatCh = String(chInfo.webSocketChannels?.limited_chat || '').trim();
      const infoCh = String(chInfo.webSocketChannels?.info || '').trim();
      const pointsCh = String(chInfo.webSocketChannels?.channel_points || '').trim();
      if (chatCh) wsChannels.push(chatCh);
      if (limitedChatCh && limitedChatCh !== chatCh) wsChannels.push(limitedChatCh);
      if (infoCh && infoCh !== chatCh && infoCh !== limitedChatCh) wsChannels.push(infoCh);
      if (pointsCh && pointsCh !== chatCh && pointsCh !== limitedChatCh && pointsCh !== infoCh) wsChannels.push(pointsCh);

      if (wsChannels.length === 0) {
        logger.warn('vkvideo_chatbot.no_chat_ws_channels', { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId });
        continue;
      }

      for (const ch of wsChannels) wsChannelToVkvideoId.set(ch, s.vkvideoChannelId);

      const wsChannelsKey = wsChannels.slice().sort().join('|');
      const existingClient = pubsubByChannelId.get(s.channelId) || null;
      const existingCtx = pubsubCtxByChannelId.get(s.channelId) || null;
      const now = Date.now();
      const shouldRefreshTokens =
        !existingClient ||
        !existingCtx ||
        !existingClient.isOpen() ||
        now - existingCtx.tokenFetchedAt >= pubsubRefreshSeconds * 1000 ||
        existingCtx.wsChannelsKey !== wsChannelsKey;

      if (!shouldRefreshTokens) continue;

      const wsTokenResp = await fetchVkVideoWebsocketToken({ accessToken: account.accessToken });
      if (!wsTokenResp.ok || !wsTokenResp.token) {
        logger.warn('vkvideo_chatbot.websocket_token_failed', { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId, error: wsTokenResp.error });
        continue;
      }

      const subTokens = await fetchVkVideoWebsocketSubscriptionTokens({ accessToken: account.accessToken, channels: wsChannels });
      const specs = wsChannels.map((ch) => ({ channel: ch, token: subTokens.tokensByChannel.get(ch) || null }));

      // (Re)start client on demand (periodic resync handles reconnection).
      existingClient?.stop();
      const client = new VkVideoPubSubClient({
        url: pubsubWsUrl,
        token: wsTokenResp.token,
        subscriptions: specs,
        logContext: { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId },
        onPush: (push) => {
          const vkId = wsChannelToVkvideoId.get(push.channel) || null;
          if (!vkId) return;

          // VKVideo follow/subscription alerts (best-effort parsing; does NOT create Users).
          try {
            const alert = extractVkVideoFollowOrSubscriptionAlert(push.data);
            if (alert) {
              const channelId = vkvideoIdToChannelId.get(vkId) || null;
              if (!channelId) return;
              const slug = vkvideoIdToSlug.get(vkId) || '';

              void (async () => {
                const rawPayloadJson = JSON.stringify(push.data ?? {});
                const cfg = autoRewardsByChannelId.get(channelId)?.cfg ?? null;
                const rule = alert.kind === 'follow' ? (cfg as any)?.follow ?? null : (cfg as any)?.subscribe ?? null;
                const enabled = Boolean(rule?.enabled);
                const coins =
                  alert.kind === 'follow'
                    ? Math.floor(Number(rule?.coins ?? 0))
                    : Math.floor(Number(rule?.primeCoins ?? 0)); // VKVideo has no tier info; use primeCoins as a single-value knob.
                const onlyWhenLive = Boolean(rule?.onlyWhenLive);
                const onceEver = alert.kind === 'follow' ? (rule?.onceEver === undefined ? true : Boolean(rule?.onceEver)) : true;

                const providerEventId =
                  alert.providerEventId ||
                  (onceEver
                    ? stableProviderEventId({ provider: 'vkvideo', rawPayloadJson: '{}', fallbackParts: [alert.kind, channelId, alert.providerAccountId] })
                    : stableProviderEventId({
                        provider: 'vkvideo',
                        rawPayloadJson,
                        fallbackParts: [alert.kind, vkId, alert.providerAccountId, String(alert.eventAt?.getTime?.() || '')],
                      }));

                if (!enabled || coins <= 0) {
                  await prisma.$transaction(async (tx) => {
                    await recordExternalRewardEventTx({
                      tx: tx as any,
                      provider: 'vkvideo',
                      providerEventId,
                      channelId,
                      providerAccountId: alert.providerAccountId,
                      eventType: alert.kind === 'follow' ? 'twitch_follow' : 'twitch_subscribe',
                      currency: 'twitch_units',
                      amount: 1,
                      coinsToGrant: 0,
                      status: 'ignored',
                      reason: enabled ? 'zero_coins' : 'auto_rewards_disabled',
                      eventAt: alert.eventAt,
                      rawPayloadJson,
                    });
                  });
                  return;
                }

                if (onlyWhenLive) {
                  const snap = await getStreamDurationSnapshot(String(slug || '').toLowerCase());
                  if (snap.status !== 'online') {
                    await prisma.$transaction(async (tx) => {
                      await recordExternalRewardEventTx({
                        tx: tx as any,
                        provider: 'vkvideo',
                        providerEventId,
                        channelId,
                        providerAccountId: alert.providerAccountId,
                        eventType: alert.kind === 'follow' ? 'twitch_follow' : 'twitch_subscribe',
                        currency: 'twitch_units',
                        amount: 1,
                        coinsToGrant: 0,
                        status: 'ignored',
                        reason: 'offline',
                        eventAt: alert.eventAt,
                        rawPayloadJson,
                      });
                    });
                    return;
                  }
                }

                const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'vkvideo', platformUserId: alert.providerAccountId });
                await prisma.$transaction(async (tx) => {
                  await recordExternalRewardEventTx({
                    tx: tx as any,
                    provider: 'vkvideo',
                    providerEventId,
                    channelId,
                    providerAccountId: alert.providerAccountId,
                    eventType: alert.kind === 'follow' ? 'twitch_follow' : 'twitch_subscribe',
                    currency: 'twitch_units',
                    amount: 1,
                    coinsToGrant: coins,
                    status: 'eligible',
                    reason: null,
                    eventAt: alert.eventAt,
                    rawPayloadJson,
                  });

                  if (linkedUserId) {
                    await claimPendingCoinGrantsTx({
                      tx: tx as any,
                      userId: linkedUserId,
                      provider: 'vkvideo',
                      providerAccountId: alert.providerAccountId,
                    });
                  }
                });
              })();
              return;
            }
          } catch (e: any) {
            logger.warn('vkvideo_chatbot.follow_sub_ingest_failed', { errorMessage: e?.message || String(e) });
          }

          // Channel points redemption (best-effort parsing; does NOT create Users).
          try {
            const redemption = extractVkVideoChannelPointsRedemption(push.data);
            if (redemption) {
              const channelId = vkvideoIdToChannelId.get(vkId) || null;
              if (!channelId) return;
              const slug = vkvideoIdToSlug.get(vkId) || '';

              void (async () => {
                const rawPayloadJson = JSON.stringify(push.data ?? {});
                const providerEventId =
                  redemption.providerEventId ||
                  stableProviderEventId({
                    provider: 'vkvideo',
                    rawPayloadJson,
                    fallbackParts: [vkId, redemption.providerAccountId, String(redemption.amount), redemption.rewardId || ''],
                  });

                const channel = await prisma.channel.findUnique({
                  where: { id: channelId },
                  select: {
                    id: true,
                    slug: true,
                    vkvideoRewardEnabled: true,
                    vkvideoRewardIdForCoins: true,
                    vkvideoCoinPerPointRatio: true,
                    vkvideoRewardCoins: true,
                    vkvideoRewardOnlyWhenLive: true,
                  } as any,
                });
                if (!channel) return;

                const enabled = Boolean((channel as any).vkvideoRewardEnabled);
                const configuredRewardId = String((channel as any).vkvideoRewardIdForCoins || '').trim();
                const rewardIdOk = !configuredRewardId || !redemption.rewardId || configuredRewardId === redemption.rewardId;

                // Optional restriction: only when live (best-effort, keyed by MemAlerts slug).
                if (enabled && (channel as any).vkvideoRewardOnlyWhenLive) {
                  const snap = await getStreamDurationSnapshot(String((channel as any).slug || slug || '').toLowerCase());
                  if (snap.status !== 'online') {
                    await prisma.$transaction(async (tx) => {
                      await recordExternalRewardEventTx({
                        tx: tx as any,
                        provider: 'vkvideo',
                        providerEventId,
                        channelId: String((channel as any).id),
                        providerAccountId: redemption.providerAccountId,
                        eventType: 'vkvideo_channel_points_redemption',
                        currency: 'vkvideo_channel_points',
                        amount: redemption.amount,
                        coinsToGrant: 0,
                        status: 'ignored',
                        reason: 'offline',
                        eventAt: redemption.eventAt,
                        rawPayloadJson,
                      });
                    });
                    return;
                  }
                }

                if (!enabled) {
                  await prisma.$transaction(async (tx) => {
                    await recordExternalRewardEventTx({
                      tx: tx as any,
                      provider: 'vkvideo',
                      providerEventId,
                      channelId: String((channel as any).id),
                      providerAccountId: redemption.providerAccountId,
                      eventType: 'vkvideo_channel_points_redemption',
                      currency: 'vkvideo_channel_points',
                      amount: redemption.amount,
                      coinsToGrant: 0,
                      status: 'ignored',
                      reason: 'vkvideo_reward_disabled',
                      eventAt: redemption.eventAt,
                      rawPayloadJson,
                    });
                  });
                  return;
                }

                if (!rewardIdOk) {
                  await prisma.$transaction(async (tx) => {
                    await recordExternalRewardEventTx({
                      tx: tx as any,
                      provider: 'vkvideo',
                      providerEventId,
                      channelId: String((channel as any).id),
                      providerAccountId: redemption.providerAccountId,
                      eventType: 'vkvideo_channel_points_redemption',
                      currency: 'vkvideo_channel_points',
                      amount: redemption.amount,
                      coinsToGrant: 0,
                      status: 'ignored',
                      reason: 'reward_id_mismatch',
                      eventAt: redemption.eventAt,
                      rawPayloadJson,
                    });
                  });
                  return;
                }

                const fixedCoins = (channel as any).vkvideoRewardCoins ?? null;
                const ratio = Number((channel as any).vkvideoCoinPerPointRatio ?? 1.0);
                const coinsToGrant = fixedCoins ? Number(fixedCoins) : Math.floor(redemption.amount * (Number.isFinite(ratio) ? ratio : 1.0));

                const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'vkvideo', platformUserId: redemption.providerAccountId });

                await prisma.$transaction(async (tx) => {
                  await recordExternalRewardEventTx({
                    tx: tx as any,
                    provider: 'vkvideo',
                    providerEventId,
                    channelId: String((channel as any).id),
                    providerAccountId: redemption.providerAccountId,
                    eventType: 'vkvideo_channel_points_redemption',
                    currency: 'vkvideo_channel_points',
                    amount: redemption.amount,
                    coinsToGrant,
                    status: coinsToGrant > 0 ? 'eligible' : 'ignored',
                    reason: coinsToGrant > 0 ? null : 'zero_coins',
                    eventAt: redemption.eventAt,
                    rawPayloadJson,
                  });

                  // If viewer already linked, claim immediately (no realtime emit here; runner is out-of-process).
                  if (linkedUserId && coinsToGrant > 0) {
                    await claimPendingCoinGrantsTx({
                      tx: tx as any,
                      userId: linkedUserId,
                      provider: 'vkvideo',
                      providerAccountId: redemption.providerAccountId,
                    });
                  }
                });
              })();
              return;
            }
          } catch (e: any) {
            logger.warn('vkvideo_chatbot.channel_points_ingest_failed', { errorMessage: e?.message || String(e) });
          }

          const incoming = extractIncomingMessage(push.data);
          if (!incoming) return;
          void handleIncoming(vkId, incoming);
        },
      });
      pubsubByChannelId.set(s.channelId, client);
      pubsubCtxByChannelId.set(s.channelId, { tokenFetchedAt: now, wsChannelsKey });
      client.start();
    }
    } finally {
      subscriptionsSyncing = false;
    }
  };

  const processOutboxOnce = async () => {
    if (stopped) return;
    if (outboxProcessing) return;
    outboxProcessing = true;
    const channelIds = Array.from(new Set(Array.from(vkvideoIdToChannelId.values()).filter(Boolean)));
    if (channelIds.length === 0) {
      outboxProcessing = false;
      return;
    }

    try {
      const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
      const rows = await (prisma as any).vkVideoChatBotOutboxMessage.findMany({
        where: {
          channelId: { in: channelIds },
          OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_OUTBOX_BATCH,
        select: { id: true, vkvideoChannelId: true, message: true, status: true, attempts: true },
      });
      if (rows.length === 0) return;

      for (const r of rows) {
        if (stopped) return;
        const vkvideoChannelId = String((r as any)?.vkvideoChannelId || '').trim();
        const msg = normalizeMessage((r as any)?.message || '');
        if (!vkvideoChannelId || !msg) continue;

        const claim = await (prisma as any).vkVideoChatBotOutboxMessage.updateMany({
          where: {
            id: r.id,
            OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
          },
          data: { status: 'processing', processingAt: new Date() },
        });
        if (claim.count === 0) continue;

        let lastError: string | null = null;
        try {
          logger.info('vkvideo_chatbot.outbox_send', {
            vkvideoChannelId,
            outboxId: r.id,
            attempts: Number(r.attempts || 0),
            messageLen: msg.length,
          });
          await sendToVkVideoChat({ vkvideoChannelId, text: msg });
          await (prisma as any).vkVideoChatBotOutboxMessage.update({
            where: { id: r.id },
            data: { status: 'sent', sentAt: new Date(), lastError: null },
          });
          logger.info('vkvideo_chatbot.outbox_sent', {
            vkvideoChannelId,
            outboxId: r.id,
            attempts: Number(r.attempts || 0),
          });
        } catch (e: any) {
          lastError = e?.message || String(e);
          const nextAttempts = Math.min(999, Math.max(0, Number(r.attempts || 0)) + 1);
          const nextStatus = nextAttempts >= MAX_SEND_ATTEMPTS ? 'failed' : 'pending';
          await (prisma as any).vkVideoChatBotOutboxMessage.update({
            where: { id: r.id },
            data: {
              status: nextStatus,
              attempts: nextAttempts,
              lastError,
              failedAt: nextStatus === 'failed' ? new Date() : null,
            },
          });
          logger.warn('vkvideo_chatbot.outbox_send_failed', {
            vkvideoChannelId,
            outboxId: r.id,
            attempts: nextAttempts,
            messageLen: msg.length,
            errorMessage: lastError,
          });
        }
      }
    } finally {
      outboxProcessing = false;
    }
  };

  const shutdown = async () => {
    stopped = true;
    if (subscriptionsTimer) clearInterval(subscriptionsTimer);
    if (outboxTimer) clearInterval(outboxTimer);
    if (commandsTimer) clearInterval(commandsTimer);
    for (const c of Array.from(pubsubByChannelId.values())) {
      try {
        c.stop();
      } catch {
        // ignore
      }
    }
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  await prisma.$connect();
  await syncSubscriptions();
  void refreshCommands();
  subscriptionsTimer = setInterval(() => void syncSubscriptions(), syncSeconds * 1000);
  outboxTimer = setInterval(() => void processOutboxOnce(), outboxPollMs);
  commandsTimer = setInterval(() => void refreshCommands(), commandsRefreshSeconds * 1000);

  logger.info('vkvideo_chatbot.started', { syncSeconds, outboxPollMs, commandsRefreshSeconds });
}

void start().catch((e: any) => {
  logger.error('vkvideo_chatbot.fatal', { errorMessage: e?.message || String(e) });
  process.exit(1);
});


