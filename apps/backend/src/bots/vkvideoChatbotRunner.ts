import dotenv from 'dotenv';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { VkVideoChatBot } from './vkvideoChatBot.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';

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

function canTriggerCommand(opts: { senderLogin: string; allowedUsers: string[]; allowedRoles: ChatCommandRole[] }): boolean {
  // VKVideo: until role mapping exists, we gate only by allowedUsers.
  const users = opts.allowedUsers || [];
  const roles = opts.allowedRoles || [];
  if (users.length === 0 && roles.length === 0) return true;
  if (opts.senderLogin && users.includes(opts.senderLogin)) return true;
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
  vkvideoChannelId: string;
  slug: string;
  creditsReconnectWindowMinutes: number;
  streamDurationCommandJson: string | null;
};

async function fetchEnabledVkVideoSubscriptions(): Promise<SubRow[]> {
  const rows = await (prisma as any).vkVideoChatBotSubscription.findMany({
    where: { enabled: true },
    select: {
      channelId: true,
      vkvideoChannelId: true,
      channel: { select: { slug: true, creditsReconnectWindowMinutes: true, streamDurationCommandJson: true } },
    },
  });

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
    const vkvideoChannelId = String((r as any)?.vkvideoChannelId || '').trim();
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

    out.push({ channelId, vkvideoChannelId, slug, creditsReconnectWindowMinutes, streamDurationCommandJson });
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

  const backendBaseUrls = parseBaseUrls();
  const syncSeconds = Math.max(5, parseIntSafe(process.env.VKVIDEO_CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.VKVIDEO_CHATBOT_OUTBOX_POLL_MS, 1_000));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.VKVIDEO_CHATBOT_COMMANDS_REFRESH_SECONDS, 30));

  const wsUrlTemplate = String(process.env.VKVIDEO_CHAT_WS_URL_TEMPLATE || '').trim();
  const accessToken = String(process.env.VKVIDEO_CHAT_BOT_ACCESS_TOKEN || '').trim();
  const authHeaderName = String(process.env.VKVIDEO_CHAT_BOT_AUTH_HEADER || 'Authorization').trim();
  const sendMessageFormat = (String(process.env.VKVIDEO_CHAT_SEND_FORMAT || 'json').trim().toLowerCase() as 'plain' | 'json') || 'json';

  if (!wsUrlTemplate) {
    logger.error('vkvideo_chatbot.missing_env', { key: 'VKVIDEO_CHAT_WS_URL_TEMPLATE' });
    process.exit(1);
  }
  if (backendBaseUrls.length === 0) {
    logger.error('vkvideo_chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }
  if (!accessToken) {
    logger.error('vkvideo_chatbot.missing_env', { key: 'VKVIDEO_CHAT_BOT_ACCESS_TOKEN' });
    process.exit(1);
  }

  let stopped = false;
  let subscriptionsTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;
  let commandsTimer: NodeJS.Timeout | null = null;

  // Live state per VKVideo channel
  const vkvideoIdToSlug = new Map<string, string>();
  const vkvideoIdToChannelId = new Map<string, string>();
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
      }>;
    }
  >();

  const bot = new VkVideoChatBot(
    {
      wsUrlTemplate,
      authHeaderName,
      authHeaderValue: authHeaderName ? `Bearer ${accessToken}` : null,
      sendMessageFormat,
    },
    async (msg) => {
      if (stopped) return;
      const slug = vkvideoIdToSlug.get(msg.vkvideoChannelId);
      const channelId = vkvideoIdToChannelId.get(msg.vkvideoChannelId);
      if (!slug || !channelId) return;

      const msgNorm = normalizeMessage(msg.text).toLowerCase();
      const senderLogin = normalizeLogin(msg.senderLogin || msg.displayName);

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
                await bot.say(msg.vkvideoChannelId, reply);
                return;
              }
            }
          } catch (e: any) {
            logger.warn('vkvideo_chatbot.stream_duration_reply_failed', { vkvideoChannelId: msg.vkvideoChannelId, errorMessage: e?.message || String(e) });
          }
        }
      }

      // Static commands
      if (msgNorm) {
        const items = commandsByChannelId.get(channelId)?.items || [];
        const match = items.find((c) => c.triggerNormalized === msgNorm);
        if (match?.response) {
          try {
            if (
              !canTriggerCommand({
                senderLogin,
                allowedUsers: match.allowedUsers || [],
                allowedRoles: match.allowedRoles || [],
              })
            ) {
              return;
            }
            if (match.onlyWhenLive) {
              const snap = await getStreamDurationSnapshot(slug);
              if (snap.status !== 'online') return;
            }
            await bot.say(msg.vkvideoChannelId, match.response);
          } catch (e: any) {
            logger.warn('vkvideo_chatbot.command_reply_failed', { vkvideoChannelId: msg.vkvideoChannelId, errorMessage: e?.message || String(e) });
          }
        }
      }

      // Credits: chatter event
      for (const baseUrl of backendBaseUrls) {
        void postInternalCreditsChatter(baseUrl, { channelSlug: slug, userId: msg.userId, displayName: msg.displayName });
      }
    },
  );

  const refreshCommands = async () => {
    if (stopped) return;
    const channelIds = Array.from(new Set(Array.from(vkvideoIdToChannelId.values()).filter(Boolean)));
    if (channelIds.length === 0) return;

    try {
      let rows: any[] = [];
      try {
        rows = await (prisma as any).chatBotCommand.findMany({
          where: { channelId: { in: channelIds }, enabled: true },
          select: { channelId: true, triggerNormalized: true, response: true, onlyWhenLive: true, allowedRoles: true, allowedUsers: true },
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
        if (!channelId || !triggerNormalized || !response) continue;
        const arr = grouped.get(channelId) || [];
        arr.push({ triggerNormalized, response, onlyWhenLive, allowedRoles, allowedUsers });
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
    const wanted = new Set(subs.map((s) => s.vkvideoChannelId));

    // Part removed
    for (const existing of Array.from(vkvideoIdToSlug.keys())) {
      if (!wanted.has(existing)) {
        vkvideoIdToSlug.delete(existing);
        vkvideoIdToChannelId.delete(existing);
        await bot.part(existing);
      }
    }

    // Join new
    for (const s of subs) {
      vkvideoIdToSlug.set(s.vkvideoChannelId, s.slug);
      vkvideoIdToChannelId.set(s.vkvideoChannelId, s.channelId);
      if (!bot.isJoined(s.vkvideoChannelId)) {
        try {
          await bot.join(s.vkvideoChannelId);
        } catch (e: any) {
          logger.warn('vkvideo_chatbot.join_failed', { vkvideoChannelId: s.vkvideoChannelId, errorMessage: e?.message || String(e) });
        }
      }
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
      if (!bot.isJoined(vkvideoChannelId)) continue;

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
        await bot.say(vkvideoChannelId, msg);
        await (prisma as any).vkVideoChatBotOutboxMessage.update({
          where: { id: r.id },
          data: { status: 'sent', sentAt: new Date(), lastError: null },
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
        logger.warn('vkvideo_chatbot.outbox_send_failed', { vkvideoChannelId, outboxId: r.id, attempts: nextAttempts, errorMessage: lastError });
      }
    }
  };

  const shutdown = async () => {
    stopped = true;
    if (subscriptionsTimer) clearInterval(subscriptionsTimer);
    if (outboxTimer) clearInterval(outboxTimer);
    if (commandsTimer) clearInterval(commandsTimer);
    try {
      await bot.stop();
    } catch {
      // ignore
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


