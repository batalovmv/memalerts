import crypto from 'crypto';
import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { BoostyApiClient } from '../../utils/boostyApi.js';
import { asRecord } from './utils.js';

function decodeJwtPayloadNoVerify(token: string): Record<string, unknown> | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = parts[1]!;
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function linkBoosty(req: AuthRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

  const mode = String(process.env.BOOSTY_REWARDS_MODE || 'boosty_api').trim().toLowerCase();
  if (mode === 'discord_roles') {
    return res.status(410).json({
      error: 'Gone',
      errorCode: 'BOOSTY_LINK_DEPRECATED',
      message: 'Boosty token linking is no longer supported. Please link Discord instead.',
    });
  }

  const body = asRecord(req.body ?? {});
  const accessTokenRaw =
    typeof body.accessToken === 'string' ? body.accessToken : typeof body.token === 'string' ? body.token : '';
  const accessToken = accessTokenRaw ? String(accessTokenRaw).replace(/\s+/g, '') : '';
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
  const blogName = typeof body.blogName === 'string' ? body.blogName.trim() : '';

  if (!accessToken && !(refreshToken && deviceId)) {
    return res.status(400).json({
      error: 'Bad Request',
      errorCode: 'BOOSTY_LINK_MISSING_CREDENTIALS',
      message: 'Provide accessToken OR (refreshToken + deviceId)',
    });
  }

  let stableBoostyUserId: string | null = null;
  if (accessToken) {
    const baseUrl = String(process.env.BOOSTY_API_BASE_URL || 'https://api.boosty.to').trim();
    const client = new BoostyApiClient({ baseUrl, auth: { accessToken } });
    try {
      await client.getUserSubscriptions({ limit: 1, withFollow: false });
      stableBoostyUserId = await client.getMyUserIdBestEffort();
    } catch (error: unknown) {
      const errorRec = asRecord(error);
      const status = Number(errorRec.status || 0);
      if (status === 401 || status === 403) {
        return res.status(401).json({
          error: 'Unauthorized',
          errorCode: 'BOOSTY_INVALID_TOKEN',
          message: 'Boosty token is invalid or expired',
        });
      }
      if (status === 429) {
        return res.status(429).json({
          error: 'Too Many Requests',
          errorCode: 'BOOSTY_RATE_LIMITED',
          message: 'Too many attempts. Please wait and try again',
        });
      }
      return res.status(503).json({
        error: 'Service Unavailable',
        errorCode: 'BOOSTY_UNAVAILABLE',
        message: 'Boosty is unavailable. Please try again later',
      });
    }
  }

  let stableIdFromWhoami: string | null = null;
  if (stableBoostyUserId) stableIdFromWhoami = stableBoostyUserId;

  let stableIdFromJwt: string | null = null;
  if (accessToken) {
    const payload = decodeJwtPayloadNoVerify(accessToken);
    const candidate = String(payload?.user_id ?? payload?.userId ?? payload?.uid ?? payload?.sub ?? payload?.id ?? '').trim();
    if (candidate) stableIdFromJwt = candidate;
  }

  const stableId = stableIdFromWhoami ?? stableIdFromJwt;

  const providerAccountId = stableId
    ? BoostyApiClient.stableProviderAccountId(`boosty:${stableId}`)
    : crypto
        .createHash('sha256')
        .update(refreshToken && deviceId ? `${refreshToken}:${deviceId}` : accessToken)
        .digest('hex')
        .slice(0, 48);

  const existing = await prisma.externalAccount.findFirst({
    where: {
      userId: req.userId,
      provider: 'boosty',
      youTubeBotIntegration: { is: null },
      globalYouTubeBotCredential: { is: null },
      vkVideoBotIntegration: { is: null },
      globalVkVideoBotCredential: { is: null },
      twitchBotIntegration: { is: null },
      globalTwitchBotCredential: { is: null },
      trovoBotIntegration: { is: null },
      globalTrovoBotCredential: { is: null },
      kickBotIntegration: { is: null },
      globalKickBotCredential: { is: null },
    },
    select: { id: true, providerAccountId: true },
  });

  const collision = await prisma.externalAccount.findUnique({
    where: { provider_providerAccountId: { provider: 'boosty', providerAccountId } },
    select: { id: true, userId: true },
  });
  if (collision && collision.userId !== req.userId) {
    return res.status(409).json({
      error: 'Conflict',
      errorCode: 'BOOSTY_ACCOUNT_ALREADY_LINKED',
      message: 'This Boosty credentials are already linked to a different user',
    });
  }

  const targetId = existing?.id || collision?.id || null;
  const account = targetId
    ? await prisma.externalAccount.update({
        where: { id: targetId },
        data: {
          accessToken: accessToken || null,
          refreshToken: refreshToken || null,
          deviceId: deviceId || null,
          login: blogName || undefined,
          profileUrl: blogName ? `https://boosty.to/${encodeURIComponent(blogName)}` : undefined,
        },
        select: {
          id: true,
          provider: true,
          providerAccountId: true,
          displayName: true,
          login: true,
          avatarUrl: true,
          profileUrl: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    : await prisma.externalAccount.create({
        data: {
          userId: req.userId,
          provider: 'boosty',
          providerAccountId,
          accessToken: accessToken || null,
          refreshToken: refreshToken || null,
          deviceId: deviceId || null,
          login: blogName || null,
          profileUrl: blogName ? `https://boosty.to/${encodeURIComponent(blogName)}` : null,
        },
        select: {
          id: true,
          provider: true,
          providerAccountId: true,
          displayName: true,
          login: true,
          avatarUrl: true,
          profileUrl: true,
          createdAt: true,
          updatedAt: true,
        },
      });

  const isStreamer =
    String(req.userRole || '').toLowerCase() === 'streamer' || String(req.userRole || '').toLowerCase() === 'admin';
  if (isStreamer && req.channelId && blogName) {
    try {
      await prisma.channel.update({
        where: { id: req.channelId },
        data: { boostyBlogName: blogName },
        select: { id: true },
      });
    } catch {
      // ignore
    }
  }

  return res.json({ ok: true, account });
}
