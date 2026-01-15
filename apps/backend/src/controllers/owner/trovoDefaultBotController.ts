import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { getTrovoAuthorizeUrl } from '../../auth/providers/trovo.js';
import { ERROR_CODES } from '../../shared/errors.js';

const DEFAULT_LINK_REDIRECT = '/settings/accounts';
const REDIRECT_ALLOWLIST = new Set<string>([
  '/settings/accounts',
  '/settings/bot',
  '/settings/bot/trovo',
  '/dashboard',
  '/',
]);

const GLOBAL_TROVO_BOT_CHANNEL_ID = '__global_trovo_bot__';

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

export const trovoDefaultBotController = {
  // GET /owner/bots/trovo/default/status
  status: async (_req: AuthRequest, res: Response) => {
    try {
      const row = await prisma.globalTrovoBotCredential.findFirst({
        where: { enabled: true },
        orderBy: { updatedAt: 'desc' },
        select: { enabled: true, externalAccountId: true, updatedAt: true },
      });
      if (!row) return res.json({ enabled: false, externalAccountId: null, updatedAt: null });
      return res.json({
        enabled: Boolean(row.enabled),
        externalAccountId: String(row.externalAccountId || '').trim() || null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      });
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw error;
    }
  },

  // GET /owner/bots/trovo/default/link
  // Starts OAuth linking for the global shared Trovo bot account (chat scopes).
  linkStart: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

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
      channelId: GLOBAL_TROVO_BOT_CHANNEL_ID,
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

  // DELETE /owner/bots/trovo/default
  unlink: async (_req: AuthRequest, res: Response) => {
    try {
      await prisma.globalTrovoBotCredential.deleteMany({});
      return res.json({ ok: true });
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw error;
    }
  },
};
