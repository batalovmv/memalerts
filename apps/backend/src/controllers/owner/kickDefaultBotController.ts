import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getKickAuthorizeUrl } from '../../auth/providers/kick.js';
import { ERROR_CODES } from '../../shared/errors.js';

const DEFAULT_LINK_REDIRECT = '/settings/accounts';
const REDIRECT_ALLOWLIST = new Set<string>(['/settings/accounts', '/settings/bot', '/settings/bot/kick', '/dashboard', '/']);

const GLOBAL_KICK_BOT_CHANNEL_ID = '__global_kick_bot__';

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

export const kickDefaultBotController = {
  // GET /owner/bots/kick/default/status
  status: async (_req: AuthRequest, res: Response) => {
    try {
      const row = await (prisma as any).globalKickBotCredential.findFirst({
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

  // GET /owner/bots/kick/default/link
  // Starts OAuth linking for the global shared Kick bot account (chat scopes).
  linkStart: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

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
      channelId: GLOBAL_KICK_BOT_CHANNEL_ID,
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

  // DELETE /owner/bots/kick/default
  unlink: async (_req: AuthRequest, res: Response) => {
    try {
      await (prisma as any).globalKickBotCredential.deleteMany({});
      return res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },
};


