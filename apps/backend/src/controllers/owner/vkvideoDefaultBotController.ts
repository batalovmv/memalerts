import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { createOAuthState } from '../../auth/oauthState.js';
import { generatePkceVerifier, getVkVideoAuthorizeUrl, pkceChallengeS256 } from '../../auth/providers/vkvideo.js';

const DEFAULT_LINK_REDIRECT = '/settings/accounts';
const REDIRECT_ALLOWLIST = new Set<string>([
  '/settings/accounts',
  '/settings/bot',
  '/settings/bot/vk',
  '/settings/bot/vkvideo',
  '/dashboard',
  '/',
]);

const GLOBAL_VKVIDEO_BOT_CHANNEL_ID = '__global_vkvideo_bot__';

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

function parseScopesForBotLink(): string[] {
  const raw = String(process.env.VKVIDEO_BOT_SCOPES || process.env.VKVIDEO_SCOPES || '').trim();
  return raw
    .split(/[ ,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const vkvideoDefaultBotController = {
  // GET /owner/bots/vkvideo/default/status
  status: async (_req: AuthRequest, res: Response) => {
    try {
      const row = await prisma.globalVkVideoBotCredential.findFirst({
        where: { enabled: true },
        orderBy: { updatedAt: 'desc' },
        select: { enabled: true, externalAccountId: true, updatedAt: true },
      });

      if (!row) {
        return res.json({ enabled: false, externalAccountId: null, updatedAt: null });
      }

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

  // GET /owner/bots/vkvideo/default/link
  // Starts OAuth linking for the global shared VKVideo bot account.
  linkStart: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

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
      channelId: GLOBAL_VKVIDEO_BOT_CHANNEL_ID,
      redirectTo,
      origin,
      codeVerifier,
    });

    const scopes = parseScopesForBotLink();
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

  // DELETE /owner/bots/vkvideo/default
  unlink: async (_req: AuthRequest, res: Response) => {
    try {
      await prisma.globalVkVideoBotCredential.deleteMany({});
      return res.json({ ok: true });
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === 'P2021') return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw error;
    }
  },
};
