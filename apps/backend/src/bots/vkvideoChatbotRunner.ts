import dotenv from 'dotenv';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { VkVideoPubSubClient } from './vkvideoPubsubClient.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import { hasChannelEntitlement } from '../utils/entitlements.js';
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

  // Pubsub connection per MemAlerts channelId (uses streamer's VKVideo OAuth token).
  const pubsubByChannelId = new Map<string, VkVideoPubSubClient>();
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
    for (const baseUrl of backendBaseUrls) {
      void postInternalCreditsChatter(baseUrl, { channelSlug: slug, userId: incoming.userId, displayName: incoming.displayName });
    }
  };

  const refreshCommands = async () => {
    if (stopped) return;
    const channelIds = Array.from(new Set(Array.from(vkvideoIdToChannelId.values()).filter(Boolean)));
    if (channelIds.length === 0) return;

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
          select: { id: true, streamDurationCommandJson: true },
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
        }
      } catch (e: any) {
        if (e?.code !== 'P2022') logger.warn('vkvideo_chatbot.stream_duration_cfg_refresh_failed', { errorMessage: e?.message || String(e) });
      }
    } catch (e: any) {
      logger.warn('vkvideo_chatbot.commands_refresh_failed', { errorMessage: e?.message || String(e) });
    }
  };

  const syncSubscriptions = async () => {
    if (stopped) return;
    const subs = await fetchEnabledVkVideoSubscriptions();

    const wantedChannelIds = new Set(subs.map((s) => s.channelId));

    // Stop clients for removed channels
    for (const existingChannelId of Array.from(pubsubByChannelId.keys())) {
      if (!wantedChannelIds.has(existingChannelId)) {
        pubsubByChannelId.get(existingChannelId)?.stop();
        pubsubByChannelId.delete(existingChannelId);
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

      const wsTokenResp = await fetchVkVideoWebsocketToken({ accessToken: account.accessToken });
      if (!wsTokenResp.ok || !wsTokenResp.token) {
        logger.warn('vkvideo_chatbot.websocket_token_failed', { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId, error: wsTokenResp.error });
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
      if (chatCh) wsChannels.push(chatCh);
      if (limitedChatCh && limitedChatCh !== chatCh) wsChannels.push(limitedChatCh);

      if (wsChannels.length === 0) {
        logger.warn('vkvideo_chatbot.no_chat_ws_channels', { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId });
        continue;
      }

      const subTokens = await fetchVkVideoWebsocketSubscriptionTokens({ accessToken: account.accessToken, channels: wsChannels });
      const specs = wsChannels.map((ch) => ({ channel: ch, token: subTokens.tokensByChannel.get(ch) || null }));

      for (const ch of wsChannels) wsChannelToVkvideoId.set(ch, s.vkvideoChannelId);

      // Restart client (token can rotate; simplest robust behavior).
      pubsubByChannelId.get(s.channelId)?.stop();
      const client = new VkVideoPubSubClient({
        url: pubsubWsUrl,
        token: wsTokenResp.token,
        subscriptions: specs,
        logContext: { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId },
        onPush: (push) => {
          const vkId = wsChannelToVkvideoId.get(push.channel) || null;
          if (!vkId) return;
          const incoming = extractIncomingMessage(push.data);
          if (!incoming) return;
          void handleIncoming(vkId, incoming);
        },
      });
      pubsubByChannelId.set(s.channelId, client);
      client.start();
    }
  };

  const processOutboxOnce = async () => {
    if (stopped) return;
    const channelIds = Array.from(new Set(Array.from(vkvideoIdToChannelId.values()).filter(Boolean)));
    if (channelIds.length === 0) return;

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


