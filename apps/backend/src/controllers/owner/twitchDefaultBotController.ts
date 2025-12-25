import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getTwitchAuthorizeUrl } from '../../auth/providers/twitch.js';

const DEFAULT_LINK_REDIRECT = '/settings/accounts';
const REDIRECT_ALLOWLIST = new Set<string>(['/settings/accounts', '/settings/bot', '/settings/bot/twitch', '/dashboard', '/']);

const GLOBAL_TWITCH_BOT_CHANNEL_ID = '__global_twitch_bot__';

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

export const twitchDefaultBotController = {
  // GET /owner/bots/twitch/default/status
  status: async (_req: AuthRequest, res: Response) => {
    try {
      const row = await (prisma as any).globalTwitchBotCredential.findFirst({
        where: { enabled: true },
        orderBy: { updatedAt: 'desc' },
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

  // GET /owner/bots/twitch/default/link
  // Starts OAuth linking for the global shared Twitch bot account (chat scopes).
  linkStart: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

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
      channelId: GLOBAL_TWITCH_BOT_CHANNEL_ID,
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

  // DELETE /owner/bots/twitch/default
  unlink: async (_req: AuthRequest, res: Response) => {
    try {
      await (prisma as any).globalTwitchBotCredential.deleteMany({});
      return res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },
};


