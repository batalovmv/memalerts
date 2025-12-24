import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTwitchLoginByUserId } from '../../utils/twitchApi.js';
import { fetchMyYouTubeChannelId } from '../../utils/youtubeApi.js';

type BotProvider = 'twitch' | 'vkplaylive' | 'youtube';
type BotProviderV2 = BotProvider | 'vkvideo';
const PROVIDERS: BotProviderV2[] = ['twitch', 'vkplaylive', 'vkvideo', 'youtube'];
const PROVIDERS_SET = new Set<string>(PROVIDERS);

function requireChannelId(req: AuthRequest, res: Response): string | null {
  const channelId = String(req.channelId || '').trim();
  if (!channelId) {
    res.status(400).json({ error: 'Bad Request', message: 'Missing channelId' });
    return null;
  }
  return channelId;
}

function normalizeProvider(raw: any): BotProviderV2 | null {
  const p = String(raw ?? '').trim().toLowerCase();
  if (!p || !PROVIDERS_SET.has(p)) return null;
  return p as BotProviderV2;
}

async function getTwitchEnabledFallback(channelId: string): Promise<boolean> {
  // Back-compat: if BotIntegrationSettings row is missing (older enable endpoint was used),
  // we still want GET /streamer/bots to reflect the actual Twitch bot subscription state.
  const sub = await prisma.chatBotSubscription.findUnique({ where: { channelId }, select: { enabled: true } });
  return Boolean(sub?.enabled);
}

async function getVkVideoEnabledFallback(channelId: string): Promise<boolean> {
  try {
    const sub = await (prisma as any).vkVideoChatBotSubscription.findUnique({ where: { channelId }, select: { enabled: true } });
    return Boolean(sub?.enabled);
  } catch {
    return false;
  }
}

export const botIntegrationsController = {
  // GET /streamer/bots
  get: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    try {
      const rows = await (prisma as any).botIntegrationSettings.findMany({
        where: { channelId },
        select: { provider: true, enabled: true, updatedAt: true },
      });

      const byProvider = new Map<string, { enabled: boolean; updatedAt: string | null }>();
      for (const r of rows) {
        const provider = String((r as any)?.provider || '').toLowerCase();
        if (!provider) continue;
        byProvider.set(provider, {
          enabled: Boolean((r as any)?.enabled),
          updatedAt: (r as any)?.updatedAt ? new Date((r as any).updatedAt).toISOString() : null,
        });
      }

      // Ensure stable shape with defaults for known providers.
      // Twitch falls back to ChatBotSubscription if no row exists yet.
      const twitch = byProvider.get('twitch') ?? { enabled: await getTwitchEnabledFallback(channelId), updatedAt: null };
      const vkplaylive = byProvider.get('vkplaylive') ?? { enabled: false, updatedAt: null };
      const vkvideo = byProvider.get('vkvideo') ?? { enabled: await getVkVideoEnabledFallback(channelId), updatedAt: null };
      const youtube = byProvider.get('youtube') ?? { enabled: false, updatedAt: null };

      return res.json({
        items: [
          { provider: 'twitch', ...twitch },
          { provider: 'vkplaylive', ...vkplaylive },
          { provider: 'vkvideo', ...vkvideo },
          { provider: 'youtube', ...youtube },
        ],
      });
    } catch (e: any) {
      // Prisma "table does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2021') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw e;
    }
  },

  // PATCH /streamer/bots/:provider  body: { enabled: boolean }
  patch: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const provider = normalizeProvider((req.params as any)?.provider);
    if (!provider) return res.status(400).json({ error: 'Bad Request', message: `provider must be one of: ${PROVIDERS.join(', ')}` });

    const enabled = (req.body as any)?.enabled;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Bad Request', message: 'enabled must be boolean' });

    try {
      // Persist toggle (idempotent).
      await (prisma as any).botIntegrationSettings.upsert({
        where: { channelId_provider: { channelId, provider } },
        create: { channelId, provider, enabled },
        update: { enabled },
        select: { id: true },
      });

      // Provider-specific side effects.
      if (provider === 'twitch') {
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          select: { twitchChannelId: true },
        });
        if (!channel) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });
        if (!channel.twitchChannelId) {
          return res.status(400).json({ error: 'Bad Request', message: 'This channel is not linked to Twitch' });
        }

        if (enabled) {
          const login = await getTwitchLoginByUserId(channel.twitchChannelId);
          if (!login) return res.status(400).json({ error: 'Bad Request', message: 'Failed to resolve twitch login' });
          await prisma.chatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, twitchLogin: login, enabled: true },
            update: { twitchLogin: login, enabled: true },
            select: { channelId: true },
          });
        } else {
          // Keep record for future re-enable; create disabled record if missing.
          const login = await getTwitchLoginByUserId(channel.twitchChannelId);
          await prisma.chatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, twitchLogin: login || '', enabled: false },
            update: { enabled: false, ...(login ? { twitchLogin: login } : {}) },
            select: { channelId: true },
          });
        }
      }

      if (provider === 'youtube') {
        // Store subscription for youtubeChatbotRunner (uses the streamer's linked YouTube account).
        if (enabled) {
          if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
          const youtubeChannelId = await fetchMyYouTubeChannelId(req.userId);
          if (!youtubeChannelId) {
            return res.status(400).json({
              error: 'Bad Request',
              message: 'Failed to resolve YouTube channelId. Please link YouTube with required scopes and try again.',
            });
          }
          await (prisma as any).youTubeChatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, userId: req.userId, youtubeChannelId, enabled: true },
            update: { userId: req.userId, youtubeChannelId, enabled: true },
            select: { id: true },
          });
        } else {
          // Best-effort disable: if subscription exists, mark it disabled.
          await (prisma as any).youTubeChatBotSubscription.updateMany({
            where: { channelId },
            data: { enabled: false },
          });
        }
      }

      if (provider === 'vkvideo') {
        if (enabled) {
          const vkvideoChannelId = String((req.body as any)?.vkvideoChannelId || '').trim();
          if (!vkvideoChannelId) {
            return res.status(400).json({
              error: 'Bad Request',
              message: 'vkvideoChannelId is required to enable VKVideo bot',
            });
          }
          await (prisma as any).vkVideoChatBotSubscription.upsert({
            where: { channelId },
            create: { channelId, vkvideoChannelId, enabled: true },
            update: { vkvideoChannelId, enabled: true },
            select: { id: true },
          });
        } else {
          await (prisma as any).vkVideoChatBotSubscription.updateMany({
            where: { channelId },
            data: { enabled: false },
          });
        }
      }

      return res.json({ ok: true });
    } catch (e: any) {
      // Prisma "table does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2021') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw e;
    }
  },
};


