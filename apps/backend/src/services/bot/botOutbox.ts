import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { enqueueChatOutboxJob } from '../../queues/chatOutboxQueue.js';
import {
  type BotControllerParams,
  type BotSayBody,
  type ChatBotOutboxRow,
  formatIsoDate,
  isPrismaErrorCode,
  normalizeMessage,
  requireChannelId,
  TWITCH_MESSAGE_MAX_LEN,
} from './botShared.js';

export const botOutboxHandlers = {
  outboxStatus: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const params = req.params as BotControllerParams;
    const provider = String(params.provider ?? '')
      .trim()
      .toLowerCase();
    const id = String(params.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'Bad Request', message: 'Missing id' });
    if (provider !== 'twitch' && provider !== 'youtube' && provider !== 'vkvideo') {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: 'provider must be one of: twitch, youtube, vkvideo' });
    }

    try {
      let row: ChatBotOutboxRow | null = null;
      const select = {
        id: true,
        status: true,
        attempts: true,
        lastError: true,
        processingAt: true,
        sentAt: true,
        failedAt: true,
        createdAt: true,
        updatedAt: true,
      } as const;

      if (provider === 'twitch') {
        row = await prisma.chatBotOutboxMessage.findFirst({
          where: { id, channelId },
          select,
        });
      } else if (provider === 'youtube') {
        row = await prisma.youTubeChatBotOutboxMessage.findFirst({
          where: { id, channelId },
          select,
        });
      } else if (provider === 'vkvideo') {
        row = await prisma.vkVideoChatBotOutboxMessage.findFirst({
          where: { id, channelId },
          select,
        });
      }

      if (!row) return res.status(404).json({ error: 'Not Found', message: 'Outbox message not found' });

      return res.json({
        provider,
        id: String(row.id),
        status: String(row.status),
        attempts: Number(row.attempts ?? 0),
        lastError: row.lastError ? String(row.lastError) : null,
        processingAt: formatIsoDate(row.processingAt),
        sentAt: formatIsoDate(row.sentAt),
        failedAt: formatIsoDate(row.failedAt),
        createdAt: formatIsoDate(row.createdAt),
        updatedAt: formatIsoDate(row.updatedAt),
      });
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2021')) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },

  say: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const body = req.body as BotSayBody;
    const providerRaw = body.provider;
    let provider = String(providerRaw ?? '')
      .trim()
      .toLowerCase();

    const message = normalizeMessage(body.message);
    if (!message) return res.status(400).json({ error: 'Bad Request', message: 'Message is required' });
    if (message.length > TWITCH_MESSAGE_MAX_LEN) {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: `Message is too long (max ${TWITCH_MESSAGE_MAX_LEN})` });
    }

    if (!provider) {
      const enabled: string[] = [];

      const twitchSub = await prisma.chatBotSubscription.findUnique({
        where: { channelId },
        select: { enabled: true, twitchLogin: true },
      });
      const twitchEnabled = Boolean(twitchSub?.enabled && twitchSub?.twitchLogin);
      if (twitchEnabled) enabled.push('twitch');

      try {
        const ytSub = await prisma.youTubeChatBotSubscription.findUnique({
          where: { channelId },
          select: { enabled: true, youtubeChannelId: true },
        });
        const ytEnabled = Boolean(ytSub?.enabled && ytSub?.youtubeChannelId);
        if (ytEnabled) enabled.push('youtube');
      } catch (error) {
        if (!isPrismaErrorCode(error, 'P2021')) throw error;
      }

      try {
        try {
          const gate = await prisma.botIntegrationSettings.findUnique({
            where: { channelId_provider: { channelId, provider: 'vkvideo' } },
            select: { enabled: true },
          });
          if (gate && gate.enabled === false) {
            // explicitly disabled by gate => treat as disabled
          } else {
            const vvSub = await prisma.vkVideoChatBotSubscription.findUnique({
              where: { channelId },
              select: { enabled: true, vkvideoChannelId: true },
            });
            const vvEnabled = Boolean(vvSub?.enabled && vvSub?.vkvideoChannelId);
            if (vvEnabled) enabled.push('vkvideo');
          }
        } catch (error) {
          if (isPrismaErrorCode(error, 'P2021')) {
            const vvSub = await prisma.vkVideoChatBotSubscription.findUnique({
              where: { channelId },
              select: { enabled: true, vkvideoChannelId: true },
            });
            const vvEnabled = Boolean(vvSub?.enabled && vvSub?.vkvideoChannelId);
            if (vvEnabled) enabled.push('vkvideo');
          } else {
            throw error;
          }
        }
      } catch (error) {
        if (!isPrismaErrorCode(error, 'P2021')) throw error;
      }

      if (enabled.length === 0) {
        return res.status(400).json({ error: 'Bad Request', message: 'No chat bot is enabled for this channel' });
      }
      if (enabled.length > 1) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Multiple chat bots are enabled. Please specify provider explicitly.',
          enabledProviders: enabled,
        });
      }

      provider = enabled[0];
    }

    if (provider === 'youtube') {
      try {
        const sub = await prisma.youTubeChatBotSubscription.findUnique({
          where: { channelId },
          select: { enabled: true, youtubeChannelId: true },
        });
        if (!sub?.enabled || !sub.youtubeChannelId) {
          return res
            .status(400)
            .json({ error: 'Bad Request', message: 'YouTube chat bot is not enabled for this channel' });
        }

        const row = await prisma.youTubeChatBotOutboxMessage.create({
          data: {
            channelId,
            youtubeChannelId: String(sub.youtubeChannelId),
            message,
            status: 'pending',
          },
          select: { id: true, status: true, createdAt: true },
        });
        void enqueueChatOutboxJob({ platform: 'youtube', outboxId: row.id, channelId });
        return res.json({ ok: true, provider: 'youtube', outbox: row });
      } catch (error) {
        if (isPrismaErrorCode(error, 'P2021')) {
          return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
        }
        throw error;
      }
    }

    if (provider === 'vkvideo') {
      try {
        try {
          const gate = await prisma.botIntegrationSettings.findUnique({
            where: { channelId_provider: { channelId, provider: 'vkvideo' } },
            select: { enabled: true },
          });
          if (gate && !gate.enabled) {
            return res
              .status(400)
              .json({ error: 'Bad Request', message: 'VKVideo chat bot is not enabled for this channel' });
          }
        } catch (error) {
          if (!isPrismaErrorCode(error, 'P2021')) throw error;
        }

        const sub = await prisma.vkVideoChatBotSubscription.findUnique({
          where: { channelId },
          select: { enabled: true, vkvideoChannelId: true },
        });
        if (!sub?.enabled || !sub.vkvideoChannelId) {
          return res
            .status(400)
            .json({ error: 'Bad Request', message: 'VKVideo chat bot is not enabled for this channel' });
        }

        const row = await prisma.vkVideoChatBotOutboxMessage.create({
          data: {
            channelId,
            vkvideoChannelId: String(sub.vkvideoChannelId),
            message,
            status: 'pending',
          },
          select: { id: true, status: true, createdAt: true },
        });
        void enqueueChatOutboxJob({ platform: 'vkvideo', outboxId: row.id, channelId });
        return res.json({ ok: true, provider: 'vkvideo', outbox: row });
      } catch (error) {
        if (isPrismaErrorCode(error, 'P2021')) {
          return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
        }
        throw error;
      }
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
    void enqueueChatOutboxJob({ platform: 'twitch', outboxId: row.id, channelId });

    return res.json({ ok: true, provider: 'twitch', outbox: row });
  },
};
