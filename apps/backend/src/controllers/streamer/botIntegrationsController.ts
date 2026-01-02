import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTwitchLoginByUserId } from '../../utils/twitchApi.js';
import { fetchMyYouTubeChannelIdDetailed, getValidYouTubeBotAccessToken, getYouTubeExternalAccount } from '../../utils/youtubeApi.js';
import { fetchGoogleTokenInfo } from '../../auth/providers/youtube.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getYouTubeAuthorizeUrl } from '../../auth/providers/youtube.js';
import { getTwitchAuthorizeUrl } from '../../auth/providers/twitch.js';
import { generatePkceVerifier, getVkVideoAuthorizeUrl, pkceChallengeS256 } from '../../auth/providers/vkvideo.js';
import { getTrovoAuthorizeUrl, fetchTrovoUserInfo } from '../../auth/providers/trovo.js';
import { getKickAuthorizeUrl, fetchKickUser } from '../../auth/providers/kick.js';
import { extractVkVideoChannelIdFromUrl, fetchVkVideoCurrentUser, getVkVideoExternalAccount, getValidVkVideoBotAccessToken } from '../../utils/vkvideoApi.js';
import { getTrovoExternalAccount, getValidTrovoBotAccessToken } from '../../utils/trovoApi.js';
import { createKickEventSubscription, getKickExternalAccount, getValidKickAccessTokenByExternalAccountId, getValidKickBotAccessToken, listKickEventSubscriptions } from '../../utils/kickApi.js';
import { logger } from '../../utils/logger.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';
import { ERROR_CODES } from '../../shared/errors.js';

type BotProvider = 'twitch' | 'vkplaylive' | 'youtube';
type BotProviderV2 = BotProvider | 'vkvideo' | 'trovo' | 'kick';
// NOTE: vkplaylive is deprecated (we use vkvideo instead) but may still exist in DB for legacy installs.
// Do not expose it to the frontend and do not allow enabling it via API.
type BotProviderDeprecated = 'vkplaylive';
type BotProviderActive = Exclude<BotProviderV2, BotProviderDeprecated>;
const PROVIDERS: BotProviderActive[] = ['twitch', 'vkvideo', 'youtube', 'trovo', 'kick'];
const PROVIDERS_SET = new Set<string>(PROVIDERS);

const DEFAULT_LINK_REDIRECT = '/settings/accounts';
const REDIRECT_ALLOWLIST = new Set<string>([
  '/settings/accounts',
  '/settings/bot',
  '/settings/bot/twitch',
  '/settings/bot/youtube',
  '/settings/bot/vk',
  '/settings/bot/vkvideo',
  '/settings/bot/trovo',
  '/settings/bot/kick',
  '/dashboard',
  '/',
]);
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
    res.status(400).json({
      errorCode: 'MISSING_CHANNEL_ID',
      error: 'Missing channelId',
      details: {
        hint: 'Your auth token has no channelId. Re-login as streamer (or select channel) and retry.',
      },
    });
    return null;
  }
  return channelId;
}

function normalizeProvider(raw: any): BotProviderV2 | null {
  const p = String(raw ?? '').trim().toLowerCase();
  if (!p || !PROVIDERS_SET.has(p)) return null;
  return p as BotProviderActive;
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
      if (!row) return res.json({ enabled: false, externalAccountId: null, updatedAt: null, lockedBySubscription: false });
      const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({
        enabled: Boolean((row as any)?.enabled),
        externalAccountId: String((row as any)?.externalAccountId || '').trim() || null,
        updatedAt: (row as any)?.updatedAt ? new Date((row as any).updatedAt).toISOString() : null,
        lockedBySubscription: !entitled,
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

    const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
    if (!entitled) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Custom bot sender is available only with subscription.',
      });
    }

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

    // For bot sender linking we need a stable Google account id (sub).
    // Google tokeninfo may omit sub/user_id unless OIDC scopes are requested, so include openid scopes too.
    const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl', 'openid', 'email', 'profile'];
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

  // GET /streamer/bots/trovo/bot
  // Returns current per-channel Trovo bot override status (if configured).
  trovoBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await (prisma as any).trovoBotIntegration.findUnique({
        where: { channelId },
        select: { enabled: true, externalAccountId: true, updatedAt: true },
      });
      if (!row) return res.json({ enabled: false, externalAccountId: null, updatedAt: null, lockedBySubscription: false });
      const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({
        enabled: Boolean((row as any)?.enabled),
        externalAccountId: String((row as any)?.externalAccountId || '').trim() || null,
        updatedAt: (row as any)?.updatedAt ? new Date((row as any).updatedAt).toISOString() : null,
        lockedBySubscription: !entitled,
      });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // GET /streamer/bots/trovo/bot/link
  // Starts OAuth linking for a per-channel Trovo bot account (chat scopes), stored as mapping to this channel.
  trovoBotLinkStart: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
    if (!entitled) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Custom bot sender is available only with subscription.',
      });
    }

    const clientId = process.env.TROVO_CLIENT_ID;
    const callbackUrl = process.env.TROVO_CALLBACK_URL;
    const clientSecret = process.env.TROVO_CLIENT_SECRET;
    if (!clientId || !callbackUrl || !clientSecret) {
      return res.status(503).json({
        errorCode: ERROR_CODES.BOT_NOT_CONFIGURED,
        error: 'Trovo OAuth is not configured',
        requestId: req.requestId,
        details: {
          provider: 'trovo',
          missing: [
            !clientId ? 'TROVO_CLIENT_ID' : null,
            !clientSecret ? 'TROVO_CLIENT_SECRET' : null,
            !callbackUrl ? 'TROVO_CALLBACK_URL' : null,
          ].filter(Boolean),
        },
      });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const { state } = await createOAuthState({
      provider: 'trovo',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
    });

    const scopes = String(process.env.TROVO_BOT_SCOPES || process.env.TROVO_SCOPES || '')
      .split(/[ ,+]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const authUrl = getTrovoAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/trovo/bot
  // Removes per-channel Trovo bot override (falls back to global Trovo bot credential).
  trovoBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await (prisma as any).trovoBotIntegration.deleteMany({ where: { channelId } });
      return res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // GET /streamer/bots/kick/bot
  // Returns current per-channel Kick bot override status (if configured).
  kickBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await (prisma as any).kickBotIntegration.findUnique({
        where: { channelId },
        select: { enabled: true, externalAccountId: true, updatedAt: true },
      });
      if (!row) return res.json({ enabled: false, externalAccountId: null, updatedAt: null, lockedBySubscription: false });
      const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({
        enabled: Boolean((row as any)?.enabled),
        externalAccountId: String((row as any)?.externalAccountId || '').trim() || null,
        updatedAt: (row as any)?.updatedAt ? new Date((row as any).updatedAt).toISOString() : null,
        lockedBySubscription: !entitled,
      });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // GET /streamer/bots/kick/bot/link
  // Starts OAuth linking for a per-channel Kick bot account (chat scopes), stored as mapping to this channel.
  kickBotLinkStart: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
    if (!entitled) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Custom bot sender is available only with subscription.',
      });
    }

    const clientId = process.env.KICK_CLIENT_ID;
    const callbackUrl = process.env.KICK_CALLBACK_URL;
    const authorizeUrl = process.env.KICK_AUTHORIZE_URL;
    const tokenUrl = process.env.KICK_TOKEN_URL;
    const refreshUrl = process.env.KICK_REFRESH_URL;
    const userInfoUrl = process.env.KICK_USERINFO_URL;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    if (!clientId || !callbackUrl || !authorizeUrl || !tokenUrl || !refreshUrl || !userInfoUrl || !clientSecret) {
      return res.status(503).json({
        errorCode: ERROR_CODES.BOT_NOT_CONFIGURED,
        error: 'Kick OAuth is not configured',
        requestId: req.requestId,
        details: {
          provider: 'kick',
          missing: [
            !clientId ? 'KICK_CLIENT_ID' : null,
            !clientSecret ? 'KICK_CLIENT_SECRET' : null,
            !callbackUrl ? 'KICK_CALLBACK_URL' : null,
            !authorizeUrl ? 'KICK_AUTHORIZE_URL' : null,
            !tokenUrl ? 'KICK_TOKEN_URL' : null,
            !refreshUrl ? 'KICK_REFRESH_URL' : null,
            !userInfoUrl ? 'KICK_USERINFO_URL' : null,
          ].filter(Boolean),
        },
      });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const { state } = await createOAuthState({
      provider: 'kick',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
    });

    const scopes = String(process.env.KICK_BOT_SCOPES || process.env.KICK_SCOPES || '')
      .split(/[ ,+]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const authUrl = getKickAuthorizeUrl({
      authorizeUrl,
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/kick/bot
  // Removes per-channel Kick bot override (falls back to global Kick bot credential).
  kickBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await (prisma as any).kickBotIntegration.deleteMany({ where: { channelId } });
      return res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // GET /streamer/bots/vkvideo/bot
  // Returns current per-channel VKVideo bot override status (if configured).
  vkvideoBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await (prisma as any).vkVideoBotIntegration.findUnique({
        where: { channelId },
        select: { enabled: true, externalAccountId: true, updatedAt: true },
      });
      if (!row) return res.json({ enabled: false, externalAccountId: null, updatedAt: null, lockedBySubscription: false });
      const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({
        enabled: Boolean((row as any)?.enabled),
        externalAccountId: String((row as any)?.externalAccountId || '').trim() || null,
        updatedAt: (row as any)?.updatedAt ? new Date((row as any).updatedAt).toISOString() : null,
        lockedBySubscription: !entitled,
      });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // GET /streamer/bots/vkvideo/bot/link
  // Starts OAuth linking for a per-channel VKVideo bot account (write scopes), stored as mapping to this channel.
  vkvideoBotLinkStart: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
    if (!entitled) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Custom bot sender is available only with subscription.',
      });
    }

    const clientId = process.env.VKVIDEO_CLIENT_ID;
    const callbackUrl = process.env.VKVIDEO_CALLBACK_URL;
    const authorizeUrl = process.env.VKVIDEO_AUTHORIZE_URL;
    const tokenUrl = process.env.VKVIDEO_TOKEN_URL;
    if (!clientId || !callbackUrl || !authorizeUrl || !tokenUrl || !process.env.VKVIDEO_CLIENT_SECRET) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'VKVideo OAuth is not configured' });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const codeVerifier = generatePkceVerifier();
    const codeChallenge = pkceChallengeS256(codeVerifier);

    const { state } = await createOAuthState({
      provider: 'vkvideo',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
      codeVerifier,
    });

    const scopes = String(process.env.VKVIDEO_BOT_SCOPES || process.env.VKVIDEO_SCOPES || '')
      .split(/[ ,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const authUrl = getVkVideoAuthorizeUrl({
      authorizeUrl,
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
      codeChallenge,
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/vkvideo/bot
  // Removes per-channel VKVideo bot override (falls back to global VKVideo bot credential).
  vkvideoBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await (prisma as any).vkVideoBotIntegration.deleteMany({ where: { channelId } });
      return res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // GET /streamer/bots/twitch/bot
  // Returns current per-channel Twitch bot override status (if configured).
  twitchBotStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      const row = await (prisma as any).twitchBotIntegration.findUnique({
        where: { channelId },
        select: { enabled: true, externalAccountId: true, updatedAt: true },
      });
      if (!row) return res.json({ enabled: false, externalAccountId: null, updatedAt: null, lockedBySubscription: false });
      const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({
        enabled: Boolean((row as any)?.enabled),
        externalAccountId: String((row as any)?.externalAccountId || '').trim() || null,
        updatedAt: (row as any)?.updatedAt ? new Date((row as any).updatedAt).toISOString() : null,
        lockedBySubscription: !entitled,
      });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // GET /streamer/bots/twitch/bot/link
  // Starts OAuth linking for a per-channel Twitch bot account (chat scopes), stored as mapping to this channel.
  twitchBotLinkStart: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const entitled = await hasChannelEntitlement(channelId, 'custom_bot');
    if (!entitled) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Custom bot sender is available only with subscription.',
      });
    }

    const clientId = process.env.TWITCH_CLIENT_ID;
    const callbackUrl = process.env.TWITCH_CALLBACK_URL;
    if (!clientId || !callbackUrl || !process.env.TWITCH_CLIENT_SECRET) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'Twitch OAuth is not configured' });
    }

    const redirectTo = sanitizeRedirectTo(req.query.redirect_to);
    const origin = (req.query.origin as string) || null;

    const { state } = await createOAuthState({
      provider: 'twitch',
      kind: 'bot_link',
      userId: req.userId,
      channelId,
      redirectTo,
      origin,
    });

    const scopes = ['chat:read', 'chat:edit'];
    const authUrl = getTwitchAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
    });

    return res.redirect(authUrl);
  },

  // DELETE /streamer/bots/twitch/bot
  // Removes per-channel Twitch bot override (falls back to global Twitch bot credential).
  twitchBotUnlink: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;
    try {
      await (prisma as any).twitchBotIntegration.deleteMany({ where: { channelId } });
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
      const vkvideo = byProvider.get('vkvideo') ?? { enabled: await getVkVideoEnabledFallback(channelId), updatedAt: null };
      const youtube = byProvider.get('youtube') ?? { enabled: false, updatedAt: null };
      const trovo = byProvider.get('trovo') ?? { enabled: false, updatedAt: null };
      const kick = byProvider.get('kick') ?? { enabled: false, updatedAt: null };

      return res.json({
        items: [
          { provider: 'twitch', ...twitch },
          { provider: 'vkvideo', ...vkvideo },
          { provider: 'youtube', ...youtube },
          { provider: 'trovo', ...trovo },
          { provider: 'kick', ...kick },
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

    const rawProvider = String((req.params as any)?.provider || '').trim().toLowerCase();
    if (rawProvider === 'vkplaylive') {
      // Deprecated integration: we use vkvideo instead.
      return res.status(410).json({
        error: 'Gone',
        code: 'PROVIDER_DEPRECATED',
        message: 'vkplaylive integration is deprecated. Use vkvideo instead.',
      });
    }
    const provider = normalizeProvider(rawProvider);
    if (!provider) {
      return res.status(400).json({
        errorCode: 'VALIDATION_ERROR',
        error: `provider must be one of: ${PROVIDERS.join(', ')}`,
        details: { provider: rawProvider, allowed: PROVIDERS },
      });
    }

    const enabled = (req.body as any)?.enabled;
    if (typeof enabled !== 'boolean') {
      const contentType = String(req.get('content-type') || '');
      const hint = contentType.toLowerCase().includes('application/json')
        ? null
        : 'Check request headers: Content-Type must be application/json';
      return res.status(400).json({
        errorCode: 'VALIDATION_ERROR',
        error: 'enabled must be boolean',
        details: {
          field: 'enabled',
          receivedType: typeof enabled,
          hint,
        },
      });
    }

    try {
      const customBotEntitled = await hasChannelEntitlement(channelId, 'custom_bot');

      // Provider-specific preconditions MUST be checked before we persist enabled=true.
      // Otherwise we can end up with enabled=true in DB and still return an error to client (broken contract).
      let twitchLogin: string | null = null;
      let twitchChannelId: string | null = null;
      let youtubeChannelId: string | null = null;
      let trovoChannelId: string | null = null;
      let kickChannelId: string | null = null;

      if (provider === 'twitch' && enabled) {
        // Ensure we have SOME sender identity configured for chat writes/replies:
        // - either global shared bot credential (admin-linked)
        // - or per-channel bot override (TwitchBotIntegration row)
        // NOTE: legacy env-based bot may still exist, but we enforce the new contract for "bots" feature.
        let hasGlobal = false;
        let hasOverride = false;
        try {
          const global = await (prisma as any).globalTwitchBotCredential.findFirst({
            where: { enabled: true },
            select: { id: true },
          });
          hasGlobal = Boolean(global?.id);
        } catch (e: any) {
          if (e?.code !== 'P2021') throw e;
          hasGlobal = false;
        }
        try {
          const override = await (prisma as any).twitchBotIntegration.findUnique({
            where: { channelId },
            select: { enabled: true },
          });
          hasOverride = Boolean(override?.enabled);
        } catch (e: any) {
          if (e?.code !== 'P2021') throw e;
          hasOverride = false;
        }
        // Without entitlement, per-channel override MUST NOT be considered a valid sender.
        if (hasOverride && !customBotEntitled) hasOverride = false;
        if (!hasGlobal && !hasOverride) {
          return res.status(503).json({
            errorCode: 'TWITCH_BOT_NOT_CONFIGURED',
            error: 'Twitch bot is not configured (missing global bot credential and no per-channel bot override).',
          });
        }

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
              errorCode: 'YOUTUBE_RELINK_REQUIRED',
              error: msgByReason[reason] || 'Failed to resolve YouTube channelId. Please re-link YouTube with required scopes and try again.',
              details: {
                needsRelink: true,
                reason,
                requiredScopesMissing: diag.requiredScopesMissing,
              },
            });
          }

          if (reason === 'api_youtube_signup_required') {
            return res.status(409).json({
              errorCode: 'YOUTUBE_CHANNEL_REQUIRED',
              error: 'Your Google account has no YouTube channel. Please create/activate a YouTube channel and try again.',
              details: {
                reason,
                // Helps support/debugging when multiple YouTube accounts are linked.
                externalAccountId: acc?.id ?? null,
              },
            });
          }

          if (reason === 'api_access_not_configured') {
            return res.status(503).json({
              errorCode: 'YOUTUBE_API_NOT_CONFIGURED',
              error: 'YouTube Data API is not configured for this application. Please contact support.',
              details: { reason },
            });
          }

          if (reason === 'api_quota') {
            return res.status(503).json({
              errorCode: 'YOUTUBE_API_QUOTA',
              error: 'YouTube API quota exceeded. Please try again later.',
              details: { reason },
            });
          }

          return res.status(400).json({
            errorCode: 'YOUTUBE_ENABLE_FAILED',
            error: 'Failed to enable YouTube bot. Please try again or contact support.',
            details: {
              reason,
              httpStatus: diag.httpStatus,
              youtubeErrorReason: diag.youtubeErrorReason,
              youtubeErrorMessage: diag.youtubeErrorMessage,
              googleError: diag.googleError,
              googleErrorDescription: diag.googleErrorDescription,
              requiredScopesMissing: diag.requiredScopesMissing,
            },
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
        if (hasOverride && !customBotEntitled) hasOverride = false;

        if (!botAccessToken && !hasOverride) {
          return res.status(503).json({
            errorCode: 'YOUTUBE_BOT_NOT_CONFIGURED',
            error: 'YouTube bot is not configured (missing global bot credential/token and no per-channel bot override).',
          });
        }
      }

      if (provider === 'trovo' && enabled) {
        if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

        const clientId = String(process.env.TROVO_CLIENT_ID || '').trim();
        if (!clientId) {
          return res.status(503).json({
            errorCode: 'TROVO_BOT_NOT_CONFIGURED',
            error: 'Trovo bot is not configured (missing TROVO_CLIENT_ID).',
          });
        }

        const acc = await getTrovoExternalAccount(req.userId);
        if (!acc?.accessToken) {
          return res.status(400).json({
            error: 'Bad Request',
            code: 'TROVO_NOT_LINKED',
            message: 'Trovo account is not linked',
          });
        }

        const bodyChannelId = String((req.body as any)?.trovoChannelId || '').trim();
        if (bodyChannelId) {
          trovoChannelId = bodyChannelId;
        } else {
          const u = await fetchTrovoUserInfo({
            clientId,
            accessToken: acc.accessToken,
            userInfoUrl: process.env.TROVO_USERINFO_URL || undefined,
          });
          const chId = String(u.user?.channel_id || '').trim();
          trovoChannelId = chId || null;
        }

        if (!trovoChannelId) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Failed to resolve trovoChannelId. Please pass trovoChannelId explicitly (or re-link Trovo and retry).',
          });
        }

        // Ensure we have SOME sender identity configured for chat writes:
        // - either global shared bot credential
        // - or per-channel bot override (TrovoBotIntegration row)
        const botAccessToken = await getValidTrovoBotAccessToken();
        let hasOverride = false;
        try {
          const override = await (prisma as any).trovoBotIntegration.findUnique({
            where: { channelId },
            select: { enabled: true },
          });
          hasOverride = Boolean(override?.enabled);
        } catch (e: any) {
          if (e?.code !== 'P2021') throw e;
          hasOverride = false;
        }
        if (hasOverride && !customBotEntitled) hasOverride = false;

        if (!botAccessToken && !hasOverride) {
          return res.status(503).json({
            errorCode: 'TROVO_BOT_NOT_CONFIGURED',
            error: 'Trovo bot is not configured (missing global bot credential and no per-channel bot override).',
          });
        }
      }

      if (provider === 'kick' && enabled) {
        if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

        const clientId = String(process.env.KICK_CLIENT_ID || '').trim();
        const userInfoUrl = String(process.env.KICK_USERINFO_URL || '').trim();
        if (!clientId || !userInfoUrl) {
          return res.status(503).json({
            errorCode: 'KICK_BOT_NOT_CONFIGURED',
            error: 'Kick bot is not configured (missing KICK_CLIENT_ID/KICK_USERINFO_URL).',
          });
        }

        const acc = await getKickExternalAccount(req.userId);
        if (!acc?.accessToken) {
          return res.status(400).json({
            error: 'Bad Request',
            code: 'KICK_NOT_LINKED',
            message: 'Kick account is not linked',
          });
        }

        const bodyChannelId = String((req.body as any)?.kickChannelId || '').trim();
        if (bodyChannelId) {
          kickChannelId = bodyChannelId;
        } else {
          const u = await fetchKickUser({ userInfoUrl, accessToken: acc.accessToken });
          const id = String(u.user?.id ?? u.user?.user_id ?? '').trim();
          kickChannelId = id || null;
        }

        if (!kickChannelId) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Failed to resolve kickChannelId. Please pass kickChannelId explicitly (or re-link Kick and retry).',
          });
        }

        const botAccessToken = await getValidKickBotAccessToken();
        let hasOverride = false;
        try {
          const override = await (prisma as any).kickBotIntegration.findUnique({
            where: { channelId },
            select: { enabled: true },
          });
          hasOverride = Boolean(override?.enabled);
        } catch (e: any) {
          if (e?.code !== 'P2021') throw e;
          hasOverride = false;
        }
        if (hasOverride && !customBotEntitled) hasOverride = false;

        if (!botAccessToken && !hasOverride) {
          return res.status(503).json({
            errorCode: 'KICK_BOT_NOT_CONFIGURED',
            error: 'Kick bot is not configured (missing global bot credential and no per-channel bot override).',
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
              errorCode: 'YOUTUBE_RELINK_REQUIRED',
              error: 'Failed to resolve YouTube channelId. Please re-link YouTube and try again.',
              details: { needsRelink: true },
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
          // Ensure we have SOME sender identity configured for chat writes:
          // - either global shared bot credential (admin-linked)
          // - or per-channel bot override (VkVideoBotIntegration row)
          // We keep this as a precondition to avoid enabling a "broken" integration where commands/outbox can't talk.
          const botAccessToken = await getValidVkVideoBotAccessToken();
          let hasOverride = false;
          try {
            const override = await (prisma as any).vkVideoBotIntegration.findUnique({
              where: { channelId },
              select: { enabled: true },
            });
            hasOverride = Boolean(override?.enabled);
          } catch (e: any) {
            if (e?.code !== 'P2021') throw e;
            hasOverride = false;
          }
          if (hasOverride && !customBotEntitled) hasOverride = false;
          if (!botAccessToken && !hasOverride) {
            return res.status(503).json({
              errorCode: 'VKVIDEO_BOT_NOT_CONFIGURED',
              error: 'VKVideo bot is not configured (missing global bot credential and no per-channel bot override).',
            });
          }

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

      if (provider === 'trovo') {
        if (enabled) {
          if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
          if (!trovoChannelId) {
            return res.status(400).json({ error: 'Bad Request', message: 'Missing trovoChannelId' });
          }
          await (prisma as any).trovoChatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, userId: req.userId, trovoChannelId, enabled: true },
            update: { userId: req.userId, trovoChannelId, enabled: true },
            select: { id: true },
          });
        } else {
          await (prisma as any).trovoChatBotSubscription.updateMany({
            where: { channelId },
            data: { enabled: false },
          });
        }
      }

      if (provider === 'kick') {
        if (enabled) {
          if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
          if (!kickChannelId) return res.status(400).json({ error: 'Bad Request', message: 'Missing kickChannelId' });

          // Ensure Kick Events subscription exists for chat.message.sent (event-driven chat ingest).
          const acc = await getKickExternalAccount(req.userId);
          if (!acc?.id) {
            return res.status(400).json({
              error: 'Kick account is not linked. Please link Kick in integrations first.',
              errorCode: 'KICK_NOT_LINKED',
            });
          }
          const scopes = String((acc as any).scopes || '')
            .split(/\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (!scopes.includes('events:subscribe')) {
            return res.status(400).json({
              error: 'Kick scope missing: events:subscribe. Please re-link Kick with the required permissions.',
              errorCode: 'KICK_SCOPE_MISSING_EVENTS_SUBSCRIBE',
            });
          }
          const accessToken = await getValidKickAccessTokenByExternalAccountId(acc.id);
          if (!accessToken) {
            return res.status(401).json({
              error: 'Kick access token not found/expired. Please log out and log in again to refresh your authorization.',
              requiresReauth: true,
              errorCode: 'KICK_ACCESS_TOKEN_MISSING',
            });
          }

          const callbackUrl = (() => {
            const envUrl = String(process.env.KICK_WEBHOOK_CALLBACK_URL || '').trim();
            if (envUrl) return envUrl;
            const domain = process.env.DOMAIN || 'twitchmemes.ru';
            const reqHost = req.get('host') || '';
            const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
            const apiBaseUrl = allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
            return `${apiBaseUrl}/webhooks/kick/events`;
          })();

          const eventName = 'chat.message.sent';
          let hasSub = false;
          const listed = await listKickEventSubscriptions({ accessToken });
          if (listed.ok) {
            hasSub =
              (listed.subscriptions || []).find((s: any) => {
                const e = String(s?.event ?? s?.type ?? s?.name ?? '').trim().toLowerCase();
                const cb = String(s?.callback_url ?? s?.callback ?? s?.transport?.callback ?? '').trim();
                return e === eventName && cb === callbackUrl;
              }) != null;
          }
          if (!hasSub) {
            const created = await createKickEventSubscription({ accessToken, callbackUrl, event: eventName, version: 'v1' });
            if (!created.ok) {
              logger.warn('kick.bot_subscription_create_failed', { status: created.status, channelId });
              return res.status(502).json({
                error: 'Failed to create Kick event subscription. Please try again.',
                errorCode: 'KICK_SUBSCRIPTION_CREATE_FAILED',
              });
            }
          }

          await (prisma as any).kickChatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, userId: req.userId, kickChannelId, enabled: true },
            update: { userId: req.userId, kickChannelId, enabled: true },
            select: { id: true },
          });
        } else {
          await (prisma as any).kickChatBotSubscription.updateMany({
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


