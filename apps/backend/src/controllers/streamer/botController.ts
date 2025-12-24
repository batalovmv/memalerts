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

function normalizeMessage(v: any): string {
  return String(v ?? '').replace(/\r\n/g, '\n').trim();
}

const TWITCH_MESSAGE_MAX_LEN = 500;

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

  say: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const message = normalizeMessage((req.body as any)?.message);
    if (!message) return res.status(400).json({ error: 'Bad Request', message: 'Message is required' });
    if (message.length > TWITCH_MESSAGE_MAX_LEN) {
      return res.status(400).json({ error: 'Bad Request', message: `Message is too long (max ${TWITCH_MESSAGE_MAX_LEN})` });
    }

    const sub = await prisma.chatBotSubscription.findUnique({
      where: { channelId },
      select: { enabled: true, twitchLogin: true },
    });
    if (!sub?.enabled || !sub.twitchLogin) {
      return res.status(400).json({ error: 'Bad Request', message: 'Chat bot is not enabled for this channel' });
    }

    const row = await prisma.chatBotOutboxMessage.create({
      data: {
        channelId,
        twitchLogin: sub.twitchLogin,
        message,
        status: 'pending',
      },
      select: { id: true, status: true, createdAt: true },
    });

    return res.json({ ok: true, outbox: row });
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









