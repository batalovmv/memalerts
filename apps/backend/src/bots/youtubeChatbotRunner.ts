import dotenv from 'dotenv';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { getEntitledChannelIds } from '../utils/entitlements.js';
import {
  fetchActiveLiveChatIdByVideoId,
  fetchLiveVideoIdByChannelId,
  getValidYouTubeBotAccessToken,
  getValidYouTubeAccessToken,
  getValidYouTubeAccessTokenByExternalAccountId,
  listLiveChatMessages,
  sendLiveChatMessage,
} from '../utils/youtubeApi.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { getStreamDurationSnapshot, handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import { markCreditsSessionOffline } from '../realtime/creditsSessionStore.js';

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
    logger.warn('youtube_chatbot.internal_post_failed', { errorMessage: e?.message || String(e) });
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

function parseStreamDurationCfg(raw: string | null | undefined): {
  enabled: boolean;
  triggerNormalized: string;
  responseTemplate: string | null;
  breakCreditMinutes: number;
  onlyWhenLive: boolean;
} | null {
  // Shared channel JSON format, see streamer bot controller.
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

type SubRow = {
  channelId: string;
  userId: string;
  youtubeChannelId: string;
  slug: string;
  creditsReconnectWindowMinutes: number;
  streamDurationCommandJson: string | null;
};

async function fetchEnabledYouTubeSubscriptions(): Promise<SubRow[]> {
  const rows = await (prisma as any).youTubeChatBotSubscription.findMany({
    where: { enabled: true },
    select: {
      channelId: true,
      userId: true,
      youtubeChannelId: true,
      channel: { select: { slug: true, creditsReconnectWindowMinutes: true, streamDurationCommandJson: true } },
    },
  });

  // Optional gating by BotIntegrationSettings(provider=youtube).
  // Back-compat rules:
  // - If the table doesn't exist yet (partial deploy), ignore gating.
  // - If a channel has no settings row yet, treat it as enabled.
  let gate: Map<string, boolean> | null = null; // channelId -> enabled
  try {
    const channelIds = Array.from(new Set(rows.map((r: any) => String(r?.channelId || '').trim()).filter(Boolean)));
    if (channelIds.length > 0) {
      const gateRows = await (prisma as any).botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'youtube' },
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
    const youtubeChannelId = String((r as any)?.youtubeChannelId || '').trim();
    const slug = normalizeSlug(String((r as any)?.channel?.slug || ''));
    const windowMinRaw = Number((r as any)?.channel?.creditsReconnectWindowMinutes);
    const creditsReconnectWindowMinutes = Number.isFinite(windowMinRaw) ? Math.max(1, Math.min(24 * 60, Math.floor(windowMinRaw))) : 60;
    const streamDurationCommandJson = (r as any)?.channel?.streamDurationCommandJson ?? null;
    if (!channelId || !userId || !youtubeChannelId || !slug) continue;

    if (gate) {
      const gated = gate.get(channelId);
      if (gated === false) continue;
    }

    out.push({ channelId, userId, youtubeChannelId, slug, creditsReconnectWindowMinutes, streamDurationCommandJson });
  }
  return out;
}

async function fetchYouTubeBotOverrides(channelIds: string[]): Promise<Map<string, string>> {
  // channelId -> externalAccountId
  try {
    const ids = Array.from(new Set(channelIds.map((c) => String(c || '').trim()).filter(Boolean)));
    if (ids.length === 0) return new Map();
    const rows = await (prisma as any).youTubeBotIntegration.findMany({
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
    // Feature not deployed / migrations not applied
    if (e?.code === 'P2021') return new Map();
    logger.warn('youtube_chatbot.bot_overrides_fetch_failed', { errorMessage: e?.message || String(e) });
    return new Map();
  }
}

type ChannelState = {
  channelId: string;
  userId: string;
  youtubeChannelId: string;
  slug: string;
  creditsReconnectWindowMinutes: number;
  streamDurationCfg: {
    enabled: boolean;
    triggerNormalized: string;
    responseTemplate: string | null;
    breakCreditMinutes: number;
    onlyWhenLive: boolean;
  } | null;
  // Live tracking
  liveChatId: string | null;
  isLive: boolean;
  firstPollAfterLive: boolean;
  pageToken: string | null;
  lastLiveCheckAt: number;
  lastPollAt: number;
  pollInFlight: boolean;
  // Command cache
  commandsTs: number;
  commands: Array<{ triggerNormalized: string; response: string; onlyWhenLive: boolean }>;
  // Optional per-channel bot account override (ExternalAccount.id)
  botExternalAccountId: string | null;
};

async function refreshCommandsForChannel(channelId: string): Promise<Array<{ triggerNormalized: string; response: string; onlyWhenLive: boolean }>> {
  try {
    let rows: any[] = [];
    try {
      rows = await (prisma as any).chatBotCommand.findMany({
        where: { channelId, enabled: true },
        select: { triggerNormalized: true, response: true, onlyWhenLive: true },
      });
    } catch (e: any) {
      // Back-compat for partial deploys: column might not exist yet.
      if (e?.code === 'P2022') {
        rows = await (prisma as any).chatBotCommand.findMany({
          where: { channelId, enabled: true },
          select: { triggerNormalized: true, response: true },
        });
      } else {
        throw e;
      }
    }

    const out: Array<{ triggerNormalized: string; response: string; onlyWhenLive: boolean }> = [];
    for (const r of rows) {
      const triggerNormalized = String((r as any)?.triggerNormalized || '').trim().toLowerCase();
      const response = String((r as any)?.response || '').trim();
      const onlyWhenLive = Boolean((r as any)?.onlyWhenLive);
      if (!triggerNormalized || !response) continue;
      out.push({ triggerNormalized, response, onlyWhenLive });
    }
    return out;
  } catch (e: any) {
    logger.warn('youtube_chatbot.commands_refresh_failed', { channelId, errorMessage: e?.message || String(e) });
    return [];
  }
}

async function start() {
  const backendBaseUrls = parseBaseUrls();
  const syncSeconds = Math.max(5, parseIntSafe(process.env.YOUTUBE_CHATBOT_SYNC_SECONDS, 20));
  const liveCheckSeconds = Math.max(5, parseIntSafe(process.env.YOUTUBE_CHATBOT_LIVE_CHECK_SECONDS, 20));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.YOUTUBE_CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  const outboxPollMs = Math.max(500, parseIntSafe(process.env.YOUTUBE_CHATBOT_OUTBOX_POLL_MS, 1_000));

  if (backendBaseUrls.length === 0) {
    logger.error('youtube_chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  let stopped = false;
  let syncTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;

  const states = new Map<string, ChannelState>(); // channelId -> state

  const syncSubscriptions = async () => {
    if (stopped) return;
    try {
      const subs = await fetchEnabledYouTubeSubscriptions();
      const overrides = await fetchYouTubeBotOverrides(subs.map((s) => s.channelId));
      const entitled = await getEntitledChannelIds(
        subs.map((s) => s.channelId),
        'custom_bot'
      );
      const desired = new Set<string>(subs.map((s) => s.channelId));

      // Upsert/update states
      for (const s of subs) {
        const existing = states.get(s.channelId);
        const streamDurationCfg = parseStreamDurationCfg(s.streamDurationCommandJson);
        if (!existing) {
          states.set(s.channelId, {
            channelId: s.channelId,
            userId: s.userId,
            youtubeChannelId: s.youtubeChannelId,
            slug: s.slug,
            creditsReconnectWindowMinutes: s.creditsReconnectWindowMinutes,
            streamDurationCfg,
            liveChatId: null,
            isLive: false,
            firstPollAfterLive: true,
            pageToken: null,
            lastLiveCheckAt: 0,
            lastPollAt: 0,
            pollInFlight: false,
            commandsTs: 0,
            commands: [],
            botExternalAccountId: null,
          });
          states.get(s.channelId)!.botExternalAccountId = entitled.has(s.channelId) ? overrides.get(s.channelId) ?? null : null;
          logger.info('youtube_chatbot.sub.add', { channelId: s.channelId, youtubeChannelId: s.youtubeChannelId, slug: s.slug });
        } else {
          existing.userId = s.userId;
          existing.youtubeChannelId = s.youtubeChannelId;
          existing.slug = s.slug;
          existing.creditsReconnectWindowMinutes = s.creditsReconnectWindowMinutes;
          existing.streamDurationCfg = streamDurationCfg;
          existing.botExternalAccountId = entitled.has(s.channelId) ? overrides.get(s.channelId) ?? null : null;
        }
      }

      // Remove missing
      for (const channelId of Array.from(states.keys())) {
        if (!desired.has(channelId)) {
          states.delete(channelId);
          logger.info('youtube_chatbot.sub.remove', { channelId });
        }
      }
    } catch (e: any) {
      logger.warn('youtube_chatbot.sync_failed', { errorMessage: e?.message || String(e) });
    }
  };

  const ensureLiveChatId = async (st: ChannelState) => {
    const now = Date.now();
    if (now - st.lastLiveCheckAt < liveCheckSeconds * 1000) return;
    st.lastLiveCheckAt = now;

    const accessToken = await getValidYouTubeAccessToken(st.userId);
    if (!accessToken) return;

    let nextLiveChatId: string | null = null;
    try {
      const videoId = await fetchLiveVideoIdByChannelId({ accessToken, youtubeChannelId: st.youtubeChannelId });
      if (videoId) {
        nextLiveChatId = await fetchActiveLiveChatIdByVideoId({ accessToken, videoId });
      }
    } catch (e: any) {
      logger.warn('youtube_chatbot.live_check_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
      return;
    }

    const wasLive = st.isLive;
    const nowLive = Boolean(nextLiveChatId);

    if (nowLive && (!wasLive || st.liveChatId !== nextLiveChatId)) {
      st.liveChatId = nextLiveChatId;
      st.isLive = true;
      st.firstPollAfterLive = true;
      st.pageToken = null;
      try {
        await handleStreamOnline(st.slug, st.streamDurationCfg?.breakCreditMinutes ?? 60);
      } catch (e: any) {
        logger.warn('youtube_chatbot.stream_online_store_failed', { slug: st.slug, errorMessage: e?.message || String(e) });
      }
      logger.info('youtube_chatbot.live', { channelId: st.channelId, liveChatId: st.liveChatId });
    }

    if (!nowLive && wasLive) {
      st.liveChatId = null;
      st.isLive = false;
      st.firstPollAfterLive = true;
      st.pageToken = null;
      try {
        await handleStreamOffline(st.slug);
        await markCreditsSessionOffline(st.slug, st.creditsReconnectWindowMinutes);
      } catch (e: any) {
        logger.warn('youtube_chatbot.stream_offline_store_failed', { slug: st.slug, errorMessage: e?.message || String(e) });
      }
      logger.info('youtube_chatbot.offline', { channelId: st.channelId });
    }
  };

  const pollChatsOnce = async () => {
    if (stopped) return;
    const now = Date.now();

    for (const st of states.values()) {
      if (stopped) return;
      if (st.pollInFlight) continue;

      // Keep live status fresh
      await ensureLiveChatId(st);

      if (!st.liveChatId) continue;

      // Poll at most once per second per channel (liveChatMessages returns preferred interval).
      if (now - st.lastPollAt < 1_000) continue;
      st.lastPollAt = now;

      st.pollInFlight = true;
      try {
        const accessToken = await getValidYouTubeAccessToken(st.userId);
        if (!accessToken) continue;

        const resp = await listLiveChatMessages({
          accessToken,
          liveChatId: st.liveChatId,
          pageToken: st.pageToken,
          maxResults: 200,
        });

        // First poll after (re)connect: advance token without processing backlog.
        if (st.firstPollAfterLive) {
          st.firstPollAfterLive = false;
          st.pageToken = resp.nextPageToken;
          continue;
        }

        st.pageToken = resp.nextPageToken;

        const items = resp.items || [];
        if (items.length === 0) continue;

        // Refresh command cache if needed.
        if (!st.commandsTs || now - st.commandsTs > commandsRefreshSeconds * 1000) {
          st.commands = await refreshCommandsForChannel(st.channelId);
          st.commandsTs = Date.now();
        }

        for (const m of items) {
          const authorName = String(m?.authorDetails?.displayName || '').trim();
          const authorChannelId = String(m?.authorDetails?.channelId || '').trim();
          if (!authorName || !authorChannelId) continue;

          // Credits chatter (best-effort).
          const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'youtube', platformUserId: authorChannelId });
          const creditsUserId = memalertsUserId || `youtube:${authorChannelId}`;
          for (const baseUrl of backendBaseUrls) {
            void postInternalCreditsChatter(baseUrl, { channelSlug: st.slug, userId: creditsUserId, displayName: authorName });
          }

          // Commands: match on displayMessage (lowercased).
          const msg = normalizeMessage(m?.snippet?.displayMessage || '');
          const msgNorm = msg.toLowerCase();
          if (!msgNorm) continue;

          // Smart command: stream duration (same semantics as Twitch runner).
          const cfg = st.streamDurationCfg;
          if (cfg?.enabled && cfg.triggerNormalized === msgNorm) {
            try {
              const snap = await getStreamDurationSnapshot(st.slug);
              if (cfg.onlyWhenLive && snap.status !== 'online') {
                // ignore
              } else {
                const totalMinutes = snap.totalMinutes;
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                const template = cfg.responseTemplate ?? 'Время стрима: {hours}ч {minutes}м ({totalMinutes}м)';
                const reply = template
                  .replace(/\{hours\}/g, String(hours))
                  .replace(/\{minutes\}/g, String(minutes))
                  .replace(/\{totalMinutes\}/g, String(totalMinutes))
                  .trim();
                if (reply) {
                  const token = st.botExternalAccountId
                    ? await getValidYouTubeAccessTokenByExternalAccountId(st.botExternalAccountId)
                    : await getValidYouTubeBotAccessToken();
                  if (!token) throw new Error('YouTube bot token is not configured');
                  await sendLiveChatMessage({ accessToken: token, liveChatId: st.liveChatId, messageText: reply });
                  continue;
                }
              }
            } catch (e: any) {
              logger.warn('youtube_chatbot.stream_duration_reply_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
            }
          }

          const match = st.commands.find((c) => c.triggerNormalized === msgNorm);
          if (!match?.response) continue;
          if (match.onlyWhenLive && !st.isLive) continue;

          try {
            const token = st.botExternalAccountId
              ? await getValidYouTubeAccessTokenByExternalAccountId(st.botExternalAccountId)
              : await getValidYouTubeBotAccessToken();
            if (!token) throw new Error('YouTube bot token is not configured');
            await sendLiveChatMessage({ accessToken: token, liveChatId: st.liveChatId, messageText: match.response });
          } catch (e: any) {
            logger.warn('youtube_chatbot.command_reply_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
          }
        }
      } catch (e: any) {
        logger.warn('youtube_chatbot.poll_failed', { channelId: st.channelId, errorMessage: e?.message || String(e) });
      } finally {
        st.pollInFlight = false;
      }
    }
  };

  const MAX_OUTBOX_BATCH = 25;
  const MAX_SEND_ATTEMPTS = 3;
  const PROCESSING_STALE_MS = 60_000;

  const processOutboxOnce = async () => {
    if (stopped) return;
    if (states.size === 0) return;

    const channelIds = Array.from(states.keys());
    if (channelIds.length === 0) return;
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);

    const rows = await (prisma as any).youTubeChatBotOutboxMessage.findMany({
      where: {
        channelId: { in: channelIds },
        OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_OUTBOX_BATCH,
      select: { id: true, channelId: true, youtubeChannelId: true, message: true, status: true, attempts: true },
    });
    if (!rows.length) return;

    for (const r of rows) {
      if (stopped) return;

      const st = states.get(String((r as any)?.channelId || '').trim());
      if (!st) continue;

      // YouTube can only send when live chat exists.
      if (!st.liveChatId) {
        // keep pending, but bump attempts so it won't hang forever
        const nextAttempts = (r.attempts || 0) + 1;
        const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
        await (prisma as any).youTubeChatBotOutboxMessage.update({
          where: { id: r.id },
          data: shouldFail
            ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError: 'No active live chat' }
            : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError: 'No active live chat' },
        });
        continue;
      }

      // Claim
      const claim = await (prisma as any).youTubeChatBotOutboxMessage.updateMany({
        where: { id: r.id, status: r.status },
        data: { status: 'processing', processingAt: new Date(), lastError: null },
      });
      if (claim.count !== 1) continue;

      try {
        const token = st.botExternalAccountId
          ? await getValidYouTubeAccessTokenByExternalAccountId(st.botExternalAccountId)
          : await getValidYouTubeBotAccessToken();
        if (!token) throw new Error('YouTube bot token is not configured');

        await sendLiveChatMessage({ accessToken: token, liveChatId: st.liveChatId, messageText: String(r.message || '') });
        await (prisma as any).youTubeChatBotOutboxMessage.update({
          where: { id: r.id },
          data: { status: 'sent', sentAt: new Date(), attempts: (r.attempts || 0) + 1 },
        });
      } catch (e: any) {
        const nextAttempts = (r.attempts || 0) + 1;
        const lastError = e?.message || String(e);
        const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
        await (prisma as any).youTubeChatBotOutboxMessage.update({
          where: { id: r.id },
          data: shouldFail
            ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError }
            : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError },
        });
        logger.warn('youtube_chatbot.outbox_send_failed', { channelId: st.channelId, outboxId: r.id, attempts: nextAttempts, errorMessage: lastError });
      }
    }
  };

  const shutdown = async () => {
    stopped = true;
    if (syncTimer) clearInterval(syncTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (outboxTimer) clearInterval(outboxTimer);
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
  syncTimer = setInterval(() => void syncSubscriptions(), syncSeconds * 1000);
  pollTimer = setInterval(() => void pollChatsOnce(), 1_000);
  outboxTimer = setInterval(() => void processOutboxOnce(), outboxPollMs);

  logger.info('youtube_chatbot.started', { syncSeconds, liveCheckSeconds, commandsRefreshSeconds, outboxPollMs });
}

void start().catch((e: any) => {
  logger.error('youtube_chatbot.fatal', { errorMessage: e?.message || String(e) });
  process.exit(1);
});


