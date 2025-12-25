import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTwitchLoginByUserId } from '../../utils/twitchApi.js';
import { fetchMyYouTubeChannelIdDetailed, getYouTubeExternalAccount } from '../../utils/youtubeApi.js';
import { extractVkVideoChannelIdFromUrl, fetchVkVideoCurrentUser, getVkVideoExternalAccount } from '../../utils/vkvideoApi.js';
import { logger } from '../../utils/logger.js';

type BotProvider = 'twitch' | 'vkplaylive' | 'youtube';
type BotProviderV2 = BotProvider | 'vkvideo';
const PROVIDERS: BotProviderV2[] = ['twitch', 'vkplaylive', 'vkvideo', 'youtube'];
const PROVIDERS_SET = new Set<string>(PROVIDERS);

function requireChannelId(req: AuthRequest, res: Response): string | null {
  const channelId = String(req.channelId || '').trim();
  if (!channelId) {
    res.status(400).json({ error: 'Bad Request', message: 'Missing channelId' });
    return null;
  }
  return channelId;
}

function normalizeProvider(raw: any): BotProviderV2 | null {
  const p = String(raw ?? '').trim().toLowerCase();
  if (!p || !PROVIDERS_SET.has(p)) return null;
  return p as BotProviderV2;
}

async function getTwitchEnabledFallback(channelId: string): Promise<boolean> {
  // Back-compat: if BotIntegrationSettings row is missing (older enable endpoint was used),
  // we still want GET /streamer/bots to reflect the actual Twitch bot subscription state.
  const sub = await prisma.chatBotSubscription.findUnique({ where: { channelId }, select: { enabled: true } });
  return Boolean(sub?.enabled);
}

async function getVkVideoEnabledFallback(channelId: string): Promise<boolean> {
  try {
    const sub = await (prisma as any).vkVideoChatBotSubscription.findUnique({ where: { channelId }, select: { enabled: true } });
    return Boolean(sub?.enabled);
  } catch {
    return false;
  }
}

export const botIntegrationsController = {
  // GET /streamer/bots
  get: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    try {
      const rows = await (prisma as any).botIntegrationSettings.findMany({
        where: { channelId },
        select: { provider: true, enabled: true, updatedAt: true },
      });

      const byProvider = new Map<string, { enabled: boolean; updatedAt: string | null }>();
      for (const r of rows) {
        const provider = String((r as any)?.provider || '').toLowerCase();
        if (!provider) continue;
        byProvider.set(provider, {
          enabled: Boolean((r as any)?.enabled),
          updatedAt: (r as any)?.updatedAt ? new Date((r as any).updatedAt).toISOString() : null,
        });
      }

      // Ensure stable shape with defaults for known providers.
      // Twitch falls back to ChatBotSubscription if no row exists yet.
      const twitch = byProvider.get('twitch') ?? { enabled: await getTwitchEnabledFallback(channelId), updatedAt: null };
      const vkplaylive = byProvider.get('vkplaylive') ?? { enabled: false, updatedAt: null };
      const vkvideo = byProvider.get('vkvideo') ?? { enabled: await getVkVideoEnabledFallback(channelId), updatedAt: null };
      const youtube = byProvider.get('youtube') ?? { enabled: false, updatedAt: null };

      return res.json({
        items: [
          { provider: 'twitch', ...twitch },
          { provider: 'vkplaylive', ...vkplaylive },
          { provider: 'vkvideo', ...vkvideo },
          { provider: 'youtube', ...youtube },
        ],
      });
    } catch (e: any) {
      // Prisma "table does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2021') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw e;
    }
  },

  // PATCH /streamer/bots/:provider  body: { enabled: boolean }
  patch: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const provider = normalizeProvider((req.params as any)?.provider);
    if (!provider) return res.status(400).json({ error: 'Bad Request', message: `provider must be one of: ${PROVIDERS.join(', ')}` });

    const enabled = (req.body as any)?.enabled;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Bad Request', message: 'enabled must be boolean' });

    try {
      // Provider-specific preconditions MUST be checked before we persist enabled=true.
      // Otherwise we can end up with enabled=true in DB and still return an error to client (broken contract).
      let twitchLogin: string | null = null;
      let twitchChannelId: string | null = null;
      let youtubeChannelId: string | null = null;

      if (provider === 'twitch' && enabled) {
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { twitchChannelId: true },
        });
        if (!channel) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });
        if (!channel.twitchChannelId) {
          return res.status(400).json({ error: 'Bad Request', message: 'This channel is not linked to Twitch' });
        }

        twitchChannelId = channel.twitchChannelId;
        twitchLogin = await getTwitchLoginByUserId(twitchChannelId);
        if (!twitchLogin) return res.status(400).json({ error: 'Bad Request', message: 'Failed to resolve twitch login' });
      }

      if (provider === 'youtube' && enabled) {
        if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

        // Diagnostics to quickly detect "needs relink" cases (missing refresh token / missing scopes).
        const acc = await getYouTubeExternalAccount(req.userId);
        logger.info('streamer.bots.youtube.enable_attempt', {
          requestId: req.requestId,
          channelId,
          userId: req.userId,
          hasExternalAccount: !!acc,
          hasRefreshToken: Boolean(acc?.refreshToken),
          hasAccessToken: Boolean(acc?.accessToken),
          tokenExpiresAt: acc?.tokenExpiresAt ? new Date(acc.tokenExpiresAt).toISOString() : null,
          scopes: acc?.scopes || null,
        });

        const diag = await fetchMyYouTubeChannelIdDetailed(req.userId);
        youtubeChannelId = diag.channelId;
        if (!youtubeChannelId) {
          logger.warn('streamer.bots.youtube.enable_failed', {
            requestId: req.requestId,
            channelId,
            userId: req.userId,
            reason: diag.reason || 'failed_to_resolve_channel_id',
            httpStatus: diag.httpStatus,
            googleError: diag.googleError,
            googleErrorDescription: diag.googleErrorDescription,
            youtubeErrorReason: diag.youtubeErrorReason,
            youtubeErrorMessage: diag.youtubeErrorMessage,
            requiredScopesMissing: diag.requiredScopesMissing,
            accountScopes: diag.accountScopes,
          });
          return res.status(412).json({
            error: 'Precondition Failed',
            code: 'YOUTUBE_RELINK_REQUIRED',
            needsRelink: true,
            message: 'Failed to resolve YouTube channelId. Please re-link YouTube with required scopes and try again.',
          });
        }
      }

      // Persist toggle (idempotent).
      await (prisma as any).botIntegrationSettings.upsert({
        where: { channelId_provider: { channelId, provider } },
        create: { channelId, provider, enabled },
        update: { enabled },
        select: { id: true },
      });

      // Provider-specific side effects.
      if (provider === 'twitch') {
        if (enabled) {
          const login = twitchLogin;
          if (!login) return res.status(400).json({ error: 'Bad Request', message: 'Failed to resolve twitch login' });
          await prisma.chatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, twitchLogin: login, enabled: true },
            update: { twitchLogin: login, enabled: true },
            select: { channelId: true },
          });
        } else {
          // Keep record for future re-enable; create disabled record if missing.
          const effectiveTwitchChannelId =
            twitchChannelId ||
            (
              await prisma.channel.findUnique({
                where: { id: channelId },
                select: { twitchChannelId: true },
              })
            )?.twitchChannelId ||
            null;
          const login = effectiveTwitchChannelId ? await getTwitchLoginByUserId(effectiveTwitchChannelId) : null;
          await prisma.chatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, twitchLogin: login || '', enabled: false },
            update: { enabled: false, ...(login ? { twitchLogin: login } : {}) },
            select: { channelId: true },
          });
        }
      }

      if (provider === 'youtube') {
        // Store subscription for youtubeChatbotRunner (uses the streamer's linked YouTube account).
        if (enabled) {
          // NOTE: youtubeChannelId is resolved above as a precondition to keep this endpoint atomic.
          if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
          if (!youtubeChannelId) {
            // Defensive: should not happen because precondition handles it.
            return res.status(412).json({
              error: 'Precondition Failed',
              code: 'YOUTUBE_RELINK_REQUIRED',
              needsRelink: true,
              message: 'Failed to resolve YouTube channelId. Please re-link YouTube and try again.',
            });
          }
          await (prisma as any).youTubeChatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, userId: req.userId, youtubeChannelId, enabled: true },
            update: { userId: req.userId, youtubeChannelId, enabled: true },
            select: { id: true },
          });
        } else {
          // Best-effort disable: if subscription exists, mark it disabled.
          await (prisma as any).youTubeChatBotSubscription.updateMany({
            where: { channelId },
            data: { enabled: false },
          });
        }
      }

      if (provider === 'vkvideo') {
        if (enabled) {
          let vkvideoChannelId = String((req.body as any)?.vkvideoChannelId || '').trim();
          if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

          // UX: if channelId is not provided, try to resolve it from VKVideo API using streamer's linked VKVideo account.
          if (!vkvideoChannelId) {
            const account = await getVkVideoExternalAccount(req.userId);
            if (!account?.accessToken) {
              return res.status(400).json({
                error: 'Bad Request',
                message: 'vkvideoChannelId is required (or link VKVideo account and retry)',
              });
            }

            const currentUser = await fetchVkVideoCurrentUser({ accessToken: account.accessToken });
            if (!currentUser.ok) {
              return res.status(400).json({
                error: 'Bad Request',
                message: `Failed to resolve VKVideo channel from current_user (${currentUser.error || 'unknown'})`,
              });
            }

            const root = (currentUser.data as any)?.data ?? (currentUser.data as any) ?? null;
            const urlPrimary = String(root?.channel?.url || '').trim();
            const urls = Array.isArray(root?.channels) ? root.channels.map((c: any) => String(c?.url || '').trim()).filter(Boolean) : [];

            const candidateUrls = [urlPrimary, ...urls].filter(Boolean);
            const unique = Array.from(new Set(candidateUrls));
            if (unique.length === 0) {
              return res.status(400).json({
                error: 'Bad Request',
                message: 'Failed to resolve VKVideo channel: no channel.url in current_user response',
              });
            }
            if (unique.length > 1) {
              return res.status(400).json({
                error: 'Bad Request',
                message: 'Multiple VKVideo channels found. Please pass vkvideoChannelId explicitly.',
                channels: unique,
              });
            }

            const parsed = extractVkVideoChannelIdFromUrl(unique[0]);
            if (!parsed) {
              return res.status(400).json({
                error: 'Bad Request',
                message: 'Failed to extract vkvideoChannelId from VKVideo channel.url. Please pass vkvideoChannelId explicitly.',
                channelUrl: unique[0],
              });
            }
            vkvideoChannelId = parsed;
          }

          await (prisma as any).vkVideoChatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, userId: req.userId, vkvideoChannelId, enabled: true },
            update: { userId: req.userId, vkvideoChannelId, enabled: true },
            select: { id: true },
          });
        } else {
          await (prisma as any).vkVideoChatBotSubscription.updateMany({
            where: { channelId },
            data: { enabled: false },
          });
        }
      }

      return res.json({ ok: true });
    } catch (e: any) {
      // Prisma "table does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2021') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw e;
    }
  },
};


