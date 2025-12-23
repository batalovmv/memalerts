import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTwitchLoginByUserId } from '../../utils/twitchApi.js';

function requireChannelId(req: AuthRequest, res: Response): string | null {
  const channelId = String(req.channelId || '').trim();
  if (!channelId) {
    res.status(400).json({ error: 'Bad Request', message: 'Missing channelId' });
    return null;
  }
  return channelId;
}

export const streamerBotController = {
  enable: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, twitchChannelId: true },
    });
    if (!channel) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });

    const login = await getTwitchLoginByUserId(channel.twitchChannelId);
    if (!login) return res.status(400).json({ error: 'Bad Request', message: 'Failed to resolve twitch login' });

    const sub = await prisma.chatBotSubscription.upsert({
      where: { channelId },
      create: { channelId, twitchLogin: login, enabled: true },
      update: { twitchLogin: login, enabled: true },
      select: { channelId: true, twitchLogin: true, enabled: true, createdAt: true },
    });

    return res.json({ ok: true, subscription: sub });
  },

  disable: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    // Keep record for future re-enable; create disabled record if missing.
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { twitchChannelId: true },
    });
    if (!channel) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });

    const login = await getTwitchLoginByUserId(channel.twitchChannelId);

    const sub = await prisma.chatBotSubscription.upsert({
      where: { channelId },
      create: { channelId, twitchLogin: login || '', enabled: false },
      update: { enabled: false, ...(login ? { twitchLogin: login } : {}) },
      select: { channelId: true, twitchLogin: true, enabled: true, createdAt: true },
    });

    return res.json({ ok: true, subscription: sub });
  },
};









