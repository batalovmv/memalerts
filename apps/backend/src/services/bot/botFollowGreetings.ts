import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { createEventSubSubscriptionOfType, getEventSubSubscriptions } from '../../utils/twitchApi.js';
import {
  type FollowGreetingBody,
  type TwitchEventSubSubscription,
  computeApiBaseUrl,
  DEFAULT_FOLLOW_GREETING_TEMPLATE,
  FOLLOW_GREETING_TEMPLATE_MAX_LEN,
  normalizeMessage,
  requireChannelId,
} from './botShared.js';

export const botFollowGreetingsHandlers = {
  getFollowGreetings: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { followGreetingsEnabled: true, followGreetingTemplate: true },
    });
    if (!channel) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });

    return res.json({
      followGreetingsEnabled: Boolean(channel.followGreetingsEnabled),
      followGreetingTemplate: channel.followGreetingTemplate ?? DEFAULT_FOLLOW_GREETING_TEMPLATE,
    });
  },

  enableFollowGreetings: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const followGreetingBody = req.body as FollowGreetingBody;
    const maybeTemplateRaw = followGreetingBody.followGreetingTemplate;
    let templateUpdate: string | null | undefined = undefined;
    if (maybeTemplateRaw !== undefined) {
      const t = normalizeMessage(maybeTemplateRaw);
      if (!t)
        return res.status(400).json({ error: 'Bad Request', message: 'followGreetingTemplate must be non-empty' });
      if (t.length > FOLLOW_GREETING_TEMPLATE_MAX_LEN) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `followGreetingTemplate is too long (max ${FOLLOW_GREETING_TEMPLATE_MAX_LEN})`,
        });
      }
      templateUpdate = t;
    }

    const current = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { twitchChannelId: true, followGreetingTemplate: true },
    });
    if (!current) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });

    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: {
        followGreetingsEnabled: true,
        ...(templateUpdate !== undefined
          ? { followGreetingTemplate: templateUpdate }
          : current.followGreetingTemplate
            ? {}
            : { followGreetingTemplate: DEFAULT_FOLLOW_GREETING_TEMPLATE }),
      },
      select: { twitchChannelId: true, followGreetingsEnabled: true, followGreetingTemplate: true },
    });
    if (!channel.twitchChannelId) {
      return res.status(400).json({ error: 'Bad Request', message: 'This channel is not linked to Twitch' });
    }

    try {
      const apiBaseUrl = computeApiBaseUrl(req);
      const webhookUrl = `${apiBaseUrl}/webhooks/twitch/eventsub`;
      const existingSubs = await getEventSubSubscriptions(channel.twitchChannelId);
      const subs = Array.isArray(existingSubs?.data) ? (existingSubs.data as TwitchEventSubSubscription[]) : [];
      const relevant = subs.filter(
        (s) =>
          s.type === 'channel.follow' &&
          (s.status === 'enabled' || s.status === 'webhook_callback_verification_pending')
      ) as TwitchEventSubSubscription[];
      const hasActive = relevant.some((s) => s.transport?.callback === webhookUrl);
      if (!hasActive) {
        await createEventSubSubscriptionOfType({
          type: 'channel.follow',
          version: '2',
          broadcasterId: channel.twitchChannelId,
          webhookUrl,
          secret: process.env.TWITCH_EVENTSUB_SECRET!,
          condition: { broadcaster_user_id: channel.twitchChannelId, moderator_user_id: channel.twitchChannelId },
        });
      }
    } catch {
      // ignore
    }

    return res.json({
      ok: true,
      followGreetingsEnabled: channel.followGreetingsEnabled,
      followGreetingTemplate: channel.followGreetingTemplate ?? null,
    });
  },

  disableFollowGreetings: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: { followGreetingsEnabled: false },
      select: { followGreetingsEnabled: true, followGreetingTemplate: true },
    });

    return res.json({
      ok: true,
      followGreetingsEnabled: channel.followGreetingsEnabled,
      followGreetingTemplate: channel.followGreetingTemplate ?? null,
    });
  },

  patchFollowGreetings: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const followGreetingBody = req.body as FollowGreetingBody;
    const template = normalizeMessage(followGreetingBody.followGreetingTemplate);
    if (!template) return res.status(400).json({ error: 'Bad Request', message: 'followGreetingTemplate is required' });
    if (template.length > FOLLOW_GREETING_TEMPLATE_MAX_LEN) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `followGreetingTemplate is too long (max ${FOLLOW_GREETING_TEMPLATE_MAX_LEN})`,
      });
    }

    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: { followGreetingTemplate: template },
      select: { followGreetingsEnabled: true, followGreetingTemplate: true },
    });

    return res.json({
      ok: true,
      followGreetingsEnabled: channel.followGreetingsEnabled,
      followGreetingTemplate: channel.followGreetingTemplate ?? null,
    });
  },
};
