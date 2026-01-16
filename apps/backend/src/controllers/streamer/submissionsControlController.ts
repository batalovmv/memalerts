import type { Response, Request } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import crypto from 'crypto';

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function newToken(): string {
  // 32 bytes => 256-bit token; base64url makes it URL-safe without encoding.
  return crypto.randomBytes(32).toString('base64url');
}

function getBaseUrl(req: Request): string {
  const forwardedProto = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    ?.trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '')
    .split(',')[0]
    ?.trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.get('host') || process.env.DOMAIN || 'localhost';
  return `${proto}://${host}`;
}

function buildLinks(baseUrl: string, token: string) {
  const qs = `token=${encodeURIComponent(token)}`;
  return {
    enable: `${baseUrl}/public/submissions/enable?${qs}`,
    disable: `${baseUrl}/public/submissions/disable?${qs}`,
    toggle: `${baseUrl}/public/submissions/toggle?${qs}`,
  };
}

export const submissionsControlController = {
  // GET /streamer/submissions-control/link
  getLink: async (req: AuthRequest, res: Response) => {
    if (!req.channelId) return res.status(400).json({ error: 'Channel ID required' });

    const channel = await prisma.channel.findUnique({
      where: { id: req.channelId },
      select: { id: true, submissionsControlTokenHash: true },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    // If token does not exist, generate one once and persist the hash.
    let rawToken: string | null = null;
    if (!channel.submissionsControlTokenHash) {
      rawToken = newToken();
      await prisma.channel.update({
        where: { id: req.channelId },
        data: { submissionsControlTokenHash: sha256Hex(rawToken) },
        select: { id: true },
      });
    }

    // For security, we can only return the raw token at creation time.
    // If it already existed, require rotate to reveal a new one.
    const baseUrl = getBaseUrl(req);
    if (!rawToken) {
      return res.json({
        hasToken: true,
        revealable: false,
        message: 'Token already exists. Rotate to generate a new link/token.',
      });
    }

    return res.json({
      hasToken: true,
      revealable: true,
      token: rawToken,
      links: buildLinks(baseUrl, rawToken),
    });
  },

  // POST /streamer/submissions-control/link/rotate
  rotate: async (req: AuthRequest, res: Response) => {
    if (!req.channelId) return res.status(400).json({ error: 'Channel ID required' });

    const channel = await prisma.channel.findUnique({
      where: { id: req.channelId },
      select: { id: true },
    });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const rawToken = newToken();
    await prisma.channel.update({
      where: { id: req.channelId },
      data: { submissionsControlTokenHash: sha256Hex(rawToken) },
      select: { id: true },
    });

    const baseUrl = getBaseUrl(req);
    return res.json({
      ok: true,
      token: rawToken,
      links: buildLinks(baseUrl, rawToken),
    });
  },
};
