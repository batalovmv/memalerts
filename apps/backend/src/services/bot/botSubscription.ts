import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { getTwitchLoginByUserId } from '../../utils/twitchApi.js';
import { requireChannelId } from './botShared.js';

export const botSubscriptionHandlers = {
  enable: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, twitchChannelId: true },
    });
    if (!channel) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });
    if (!channel.twitchChannelId) {
      return res.status(400).json({ error: 'Bad Request', message: 'This channel is not linked to Twitch' });
    }

    const login = await getTwitchLoginByUserId(channel.twitchChannelId);
    if (!login) return res.status(400).json({ error: 'Bad Request', message: 'Failed to resolve twitch login' });

    const sub = await prisma.chatBotSubscription.upsert({
      where: { channelId },
      create: { channelId, twitchLogin: login, enabled: true },
      update: { twitchLogin: login, enabled: true },
      select: { channelId: true, twitchLogin: true, enabled: true, createdAt: true },
    });

    void sub;
    return res.json({ ok: true });
  },

  disable: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { twitchChannelId: true },
    });
    if (!channel) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });
    if (!channel.twitchChannelId) {
      return res.status(400).json({ error: 'Bad Request', message: 'This channel is not linked to Twitch' });
    }

    const login = await getTwitchLoginByUserId(channel.twitchChannelId);

    const sub = await prisma.chatBotSubscription.upsert({
      where: { channelId },
      create: { channelId, twitchLogin: login || '', enabled: false },
      update: { enabled: false, ...(login ? { twitchLogin: login } : {}) },
      select: { channelId: true, twitchLogin: true, enabled: true, createdAt: true },
    });

    void sub;
    return res.json({ ok: true });
  },

  subscription: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const sub = await prisma.chatBotSubscription.findUnique({ where: { channelId }, select: { enabled: true } });

    return res.json({
      enabled: Boolean(sub?.enabled),
    });
  },
};
