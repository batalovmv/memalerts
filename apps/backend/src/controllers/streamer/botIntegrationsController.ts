import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTwitchLoginByUserId } from '../../utils/twitchApi.js';
import { fetchMyYouTubeChannelIdDetailed, getValidYouTubeBotAccessToken, getYouTubeExternalAccount } from '../../utils/youtubeApi.js';
import { fetchGoogleTokenInfo } from '../../auth/providers/youtube.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getYouTubeAuthorizeUrl } from '../../auth/providers/youtube.js';
import { extractVkVideoChannelIdFromUrl, fetchVkVideoCurrentUser, getVkVideoExternalAccount } from '../../utils/vkvideoApi.js';
import { logger } from '../../utils/logger.js';

type BotProvider = 'twitch' | 'vkplaylive' | 'youtube';
type BotProviderV2 = BotProvider | 'vkvideo';
const PROVIDERS: BotProviderV2[] = ['twitch', 'vkplaylive', 'vkvideo', 'youtube'];
const PROVIDERS_SET = new Set<string>(PROVIDERS);

const DEFAULT_LINK_REDIRECT = '/settings/accounts';
const REDIRECT_ALLOWLIST = new Set<string>(['/settings/accounts', '/settings/bot', '/settings/bot/youtube', '/dashboard', '/']);
function sanitizeRedirectTo(input: unknown): string {
  const redirectTo = typeof input === 'string' ? input.trim() : '';
  if (!redirectTo) return DEFAULT_LINK_REDIRECT;
  if (!redirectTo.startsWith('/')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.startsWith('//')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.includes('://')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.includes('\\')) return DEFAULT_LINK_REDIRECT;
  if (!REDIRECT_ALLOWLIST.has(redirectTo)) return DEFAULT_LINK_REDIRECT;
  return redirectTo;
}

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
  // GET /streamer/bots/youtube/bot
  // Returns current per-channel bot override status (if configured).
  youtubeBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await (prisma as any).youTubeBotIntegration.findUnique({
        where: { channelId },
        select: { enabled: true, externalAccountId: true, updatedAt: true },
      });
      if (!row) return res.json({ enabled: false, externalAccountId: null, updatedAt: null });
      return res.json({
        enabled: Boolean((row as any)?.enabled),
        externalAccountId: String((row as any)?.externalAccountId || '').trim() || null,
        updatedAt: (row as any)?.updatedAt ? new Date((row as any).updatedAt).toISOString() : null,
      });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // GET /streamer/bots/youtube/bot/link
  // Starts OAuth linking for a per-channel YouTube bot account (force-ssl), stored as mapping to this channel.
  youtubeBotLinkStart: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const callbackUrl = process.env.YOUTUBE_CALLBACK_URL;
    if (!clientId || !callbackUrl || !process.env.YOUTUBE_CLIENT_SECRET) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'YouTube OAuth is not configured' });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const { state } = await createOAuthState({
      provider: 'youtube',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
    });

    const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl'];
    const authUrl = getYouTubeAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
      includeGrantedScopes: true,
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/youtube/bot
  // Removes per-channel bot override (falls back to global bot token).
  youtubeBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await (prisma as any).youTubeBotIntegration.deleteMany({ where: { channelId } });
      return res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },
  // GET /streamer/bots/vkvideo/candidates
  // Returns VKVideo channel URLs for the authenticated user (from VKVideo Live DevAPI current_user),
  // so frontend can auto-fill vkvideoChannelUrl when enabling the bot.
  vkvideoCandidates: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const account = await getVkVideoExternalAccount(req.userId);
    if (!account?.accessToken) {
      return res.status(400).json({
        error: 'Bad Request',
        code: 'VKVIDEO_NOT_LINKED',
        message: 'VKVideo account is not linked',
      });
    }

    const currentUser = await fetchVkVideoCurrentUser({ accessToken: account.accessToken });
    if (!currentUser.ok) {
      return res.status(400).json({
        error: 'Bad Request',
        code: 'VKVIDEO_CURRENT_USER_FAILED',
        message: `Failed to load VKVideo current_user (${currentUser.error || 'unknown'})`,
      });
    }

    const root = (currentUser.data as any)?.data ?? (currentUser.data as any) ?? null;
    const urlPrimary = String(root?.channel?.url || '').trim();
    const urls = Array.isArray(root?.channels) ? root.channels.map((c: any) => String(c?.url || '').trim()).filter(Boolean) : [];

    const candidateUrls = [urlPrimary, ...urls].filter(Boolean);
    const unique = Array.from(new Set(candidateUrls));

    const items = unique
      .map((url) => ({
        url,
        vkvideoChannelId: extractVkVideoChannelIdFromUrl(url),
      }))
      .filter((x) => Boolean(x.url));

    return res.json({ items });
  },

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
          // Best-effort tokeninfo to see actual scopes on the current access token.
          // This helps distinguish "missing scopes" from "token revoked/expired".
          let tokenInfo: any = null;
          if (acc?.accessToken) {
            tokenInfo = await fetchGoogleTokenInfo({ accessToken: acc.accessToken });
          }
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
            tokeninfoScopes: tokenInfo?.scope ?? null,
            tokeninfoHasSub: Boolean(tokenInfo?.sub || tokenInfo?.user_id),
            tokeninfoError: tokenInfo?.error ?? null,
            tokeninfoErrorDescription: tokenInfo?.error_description ?? null,
          });
          // Ensure frontend can show/copy the requestId.
          if (req.requestId) res.setHeader('x-request-id', req.requestId);

          const reason = diag.reason || 'failed_to_resolve_channel_id';
          const msgByReason: Record<string, string> = {
            missing_scopes: 'YouTube is linked without required permissions. Please re-link YouTube and grant the requested access.',
            missing_refresh_token: 'YouTube link is missing refresh token. Please re-link YouTube and confirm the consent screen (offline access).',
            invalid_grant: 'YouTube refresh token was revoked/invalid. Please re-link YouTube.',
            api_insufficient_permissions: 'YouTube API rejected the token due to insufficient permissions. Please re-link YouTube and grant the requested access.',
            api_unauthorized: 'YouTube token is not authorized. Please re-link YouTube.',
          };

          const relinkReasons = new Set([
            'missing_scopes',
            'missing_refresh_token',
            'invalid_grant',
            'api_insufficient_permissions',
            'api_unauthorized',
          ]);

          if (relinkReasons.has(reason)) {
            return res.status(412).json({
              error: 'Precondition Failed',
              code: 'YOUTUBE_RELINK_REQUIRED',
              needsRelink: true,
              requestId: req.requestId,
              reason,
              requiredScopesMissing: diag.requiredScopesMissing,
              message: msgByReason[reason] || 'Failed to resolve YouTube channelId. Please re-link YouTube with required scopes and try again.',
            });
          }

          if (reason === 'api_youtube_signup_required') {
            return res.status(409).json({
              error: 'Conflict',
              code: 'YOUTUBE_CHANNEL_REQUIRED',
              requestId: req.requestId,
              reason,
              message: 'Your Google account has no YouTube channel. Please create/activate a YouTube channel and try again.',
            });
          }

          if (reason === 'api_access_not_configured') {
            return res.status(503).json({
              error: 'Service Unavailable',
              code: 'YOUTUBE_API_NOT_CONFIGURED',
              requestId: req.requestId,
              reason,
              message: 'YouTube Data API is not configured for this application. Please contact support.',
            });
          }

          if (reason === 'api_quota') {
            return res.status(503).json({
              error: 'Service Unavailable',
              code: 'YOUTUBE_API_QUOTA',
              requestId: req.requestId,
              reason,
              message: 'YouTube API quota exceeded. Please try again later.',
            });
          }

          return res.status(400).json({
            error: 'Bad Request',
            code: 'YOUTUBE_ENABLE_FAILED',
            requestId: req.requestId,
            reason,
            message: 'Failed to enable YouTube bot. Please try again or contact support.',
          });
        }

        // Ensure we have SOME sender identity configured for chat writes:
        // - either global shared bot (DB credential or ENV YOUTUBE_BOT_REFRESH_TOKEN)
        // - or per-channel bot override (YouTubeBotIntegration row)
        const botAccessToken = await getValidYouTubeBotAccessToken();
        let hasOverride = false;
        try {
          const override = await (prisma as any).youTubeBotIntegration.findUnique({
            where: { channelId },
            select: { enabled: true },
          });
          hasOverride = Boolean(override?.enabled);
        } catch (e: any) {
          if (e?.code !== 'P2021') throw e;
          hasOverride = false;
        }

        if (!botAccessToken && !hasOverride) {
          if (req.requestId) res.setHeader('x-request-id', req.requestId);
          return res.status(503).json({
            error: 'Service Unavailable',
            code: 'YOUTUBE_BOT_NOT_CONFIGURED',
            requestId: req.requestId,
            message: 'YouTube bot is not configured (missing global bot credential/token and no per-channel bot override).',
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
            if (req.requestId) res.setHeader('x-request-id', req.requestId);
            return res.status(412).json({
              error: 'Precondition Failed',
              code: 'YOUTUBE_RELINK_REQUIRED',
              needsRelink: true,
              requestId: req.requestId,
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
          let vkvideoChannelUrl: string | null = String((req.body as any)?.vkvideoChannelUrl || '').trim() || null;
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
            vkvideoChannelUrl = unique[0];
          } else if (!vkvideoChannelUrl) {
            // If channelId is provided explicitly, try to resolve matching channel URL from current_user (best UX).
            const account = await getVkVideoExternalAccount(req.userId);
            if (account?.accessToken) {
              const currentUser = await fetchVkVideoCurrentUser({ accessToken: account.accessToken });
              if (currentUser.ok) {
                const root = (currentUser.data as any)?.data ?? (currentUser.data as any) ?? null;
                const urlPrimary = String(root?.channel?.url || '').trim();
                const urls = Array.isArray(root?.channels) ? root.channels.map((c: any) => String(c?.url || '').trim()).filter(Boolean) : [];

                const candidateUrls = [urlPrimary, ...urls].filter(Boolean);
                const matched = candidateUrls.filter((u) => extractVkVideoChannelIdFromUrl(u) === vkvideoChannelId);
                const uniqueMatched = Array.from(new Set(matched));
                if (uniqueMatched.length === 1) {
                  vkvideoChannelUrl = uniqueMatched[0];
                }
              }
            }
          }

          if (vkvideoChannelUrl) {
            const parsed = extractVkVideoChannelIdFromUrl(vkvideoChannelUrl);
            if (parsed && parsed !== vkvideoChannelId) {
              return res.status(400).json({
                error: 'Bad Request',
                message: 'vkvideoChannelUrl does not match vkvideoChannelId',
                vkvideoChannelId,
                vkvideoChannelUrl,
              });
            }
          } else {
            // Without channel URL we can't resolve stream_id and websocket channel names via DevAPI.
            return res.status(400).json({
              error: 'Bad Request',
              message: 'Failed to resolve vkvideoChannelUrl. Please pass vkvideoChannelUrl explicitly (or link VKVideo and retry).',
            });
          }

          await (prisma as any).vkVideoChatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, userId: req.userId, vkvideoChannelId, vkvideoChannelUrl, enabled: true },
            update: { userId: req.userId, vkvideoChannelId, vkvideoChannelUrl, enabled: true },
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


