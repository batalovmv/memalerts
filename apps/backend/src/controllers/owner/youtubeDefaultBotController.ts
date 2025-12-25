import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getYouTubeAuthorizeUrl } from '../../auth/providers/youtube.js';

const DEFAULT_LINK_REDIRECT = '/settings/accounts';
const REDIRECT_ALLOWLIST = new Set<string>(['/settings/accounts', '/settings/bot', '/settings/bot/youtube', '/dashboard', '/']);

const GLOBAL_YOUTUBE_BOT_CHANNEL_ID = '__global_youtube_bot__';

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

export const youtubeDefaultBotController = {
  // GET /owner/bots/youtube/default/status
  status: async (req: AuthRequest, res: Response) => {
    try {
      const row = await (prisma as any).globalYouTubeBotCredential.findFirst({
        where: { enabled: true },
        orderBy: { updatedAt: 'desc' },
        select: { enabled: true, externalAccountId: true, updatedAt: true },
      });

      if (!row) {
        return res.json({ enabled: false, externalAccountId: null, updatedAt: null });
      }

      return res.json({
        enabled: Boolean((row as any)?.enabled),
        externalAccountId: String((row as any)?.externalAccountId || '').trim() || null,
        updatedAt: (row as any)?.updatedAt ? new Date((row as any).updatedAt).toISOString() : null,
      });
    } catch (e: any) {
      // Prisma "table does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // GET /owner/bots/youtube/default/link
  // Starts OAuth linking for the global shared YouTube bot account (force-ssl).
  linkStart: async (req: AuthRequest, res: Response) => {
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
      channelId: GLOBAL_YOUTUBE_BOT_CHANNEL_ID,
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

  // DELETE /owner/bots/youtube/default
  // Removes the global shared bot credential (falls back to ENV YOUTUBE_BOT_REFRESH_TOKEN if set).
  unlink: async (_req: AuthRequest, res: Response) => {
    try {
      await (prisma as any).globalYouTubeBotCredential.deleteMany({});
      return res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },
};


