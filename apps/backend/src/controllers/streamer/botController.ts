import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTwitchLoginByUserId } from '../../utils/twitchApi.js';
import { createEventSubSubscriptionOfType, getEventSubSubscriptions } from '../../utils/twitchApi.js';

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

function normalizeTrigger(v: any): { trigger: string; triggerNormalized: string } {
  const trigger = String(v ?? '').trim();
  const triggerNormalized = trigger.toLowerCase();
  return { trigger, triggerNormalized };
}

const TWITCH_MESSAGE_MAX_LEN = 500;
const BOT_TRIGGER_MAX_LEN = 50;
const BOT_RESPONSE_MAX_LEN = 450;
const FOLLOW_GREETING_TEMPLATE_MAX_LEN = 450;
const DEFAULT_FOLLOW_GREETING_TEMPLATE = 'Спасибо за фоллоу, {user}!';
const STREAM_DURATION_TRIGGER_MAX_LEN = 50;
const STREAM_DURATION_TEMPLATE_MAX_LEN = 450;
const DEFAULT_STREAM_DURATION_TRIGGER = '!time';
const DEFAULT_STREAM_DURATION_TEMPLATE = 'Время стрима: {hours}ч {minutes}м ({totalMinutes}м)';
const DEFAULT_BREAK_CREDIT_MINUTES = 60;

function computeApiBaseUrl(req: Request): string {
  // Keep beta/prod separated by using the request host when it matches allowed hosts.
  const domain = process.env.DOMAIN || 'twitchmemes.ru';
  const reqHost = req.get('host') || '';
  const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
  return allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
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

    // Contract: 200 OK with minimal payload for idempotent enable.
    // (We still keep the upsert for idempotency and for bot runner to pick up.)
    void sub;
    return res.json({ ok: true });
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

    void sub;
    return res.json({ ok: true });
  },

  getCommands: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const items = await prisma.chatBotCommand.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, trigger: true, response: true, enabled: true, createdAt: true, updatedAt: true },
    });

    // Frontend accepts both array and {items}.
    return res.json({ items });
  },

  createCommand: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const { trigger, triggerNormalized } = normalizeTrigger((req.body as any)?.trigger);
    const responseText = normalizeMessage((req.body as any)?.response);

    if (!trigger) return res.status(400).json({ error: 'Bad Request', message: 'Trigger is required' });
    if (!responseText) return res.status(400).json({ error: 'Bad Request', message: 'Response is required' });
    if (trigger.length > BOT_TRIGGER_MAX_LEN) {
      return res.status(400).json({ error: 'Bad Request', message: `Trigger is too long (max ${BOT_TRIGGER_MAX_LEN})` });
    }
    if (responseText.length > BOT_RESPONSE_MAX_LEN) {
      return res.status(400).json({ error: 'Bad Request', message: `Response is too long (max ${BOT_RESPONSE_MAX_LEN})` });
    }

    try {
      const row = await prisma.chatBotCommand.create({
        data: {
          channelId,
          trigger,
          triggerNormalized,
          response: responseText,
          enabled: true,
        },
        select: { id: true, trigger: true, response: true, enabled: true, createdAt: true },
      });
      return res.status(201).json(row);
    } catch (e: any) {
      // Prisma unique violation (channelId + triggerNormalized)
      if (e?.code === 'P2002') {
        return res.status(409).json({ error: 'Conflict', message: 'Command trigger already exists' });
      }
      throw e;
    }
  },

  patchCommand: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const id = String((req.params as any)?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Bad Request', message: 'Missing id' });

    const enabled = (req.body as any)?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'enabled must be boolean' });
    }

    try {
      const updated = await prisma.chatBotCommand.updateMany({
        where: { id, channelId },
        data: { enabled },
      });
      if (updated.count === 0) return res.status(404).json({ error: 'Not Found', message: 'Command not found' });

      const row = await prisma.chatBotCommand.findUnique({
        where: { id },
        select: { id: true, trigger: true, response: true, enabled: true, createdAt: true, updatedAt: true },
      });

      // Shouldn't happen, but keep 404 contract for "feature not deployed / missing".
      if (!row) return res.status(404).json({ error: 'Not Found', message: 'Command not found' });
      return res.json(row);
    } catch (e: any) {
      // Prisma "table does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2021') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw e;
    }
  },

  deleteCommand: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const id = String((req.params as any)?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Bad Request', message: 'Missing id' });

    const deleted = await prisma.chatBotCommand.deleteMany({
      where: { id, channelId },
    });
    if (deleted.count === 0) return res.status(404).json({ error: 'Not Found', message: 'Command not found' });
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

    const maybeTemplateRaw = (req.body as any)?.followGreetingTemplate;
    let templateUpdate: string | null | undefined = undefined;
    if (maybeTemplateRaw !== undefined) {
      const t = normalizeMessage(maybeTemplateRaw);
      if (!t) return res.status(400).json({ error: 'Bad Request', message: 'followGreetingTemplate must be non-empty' });
      if (t.length > FOLLOW_GREETING_TEMPLATE_MAX_LEN) {
        return res.status(400).json({ error: 'Bad Request', message: `followGreetingTemplate is too long (max ${FOLLOW_GREETING_TEMPLATE_MAX_LEN})` });
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

    // Best-effort: ensure EventSub subscription exists for channel.follow.
    try {
      const apiBaseUrl = computeApiBaseUrl(req);
      const webhookUrl = `${apiBaseUrl}/webhooks/twitch/eventsub`;
      const existingSubs = await getEventSubSubscriptions(channel.twitchChannelId);
      const relevant = (existingSubs?.data || []).filter(
        (s: any) => s.type === 'channel.follow' && (s.status === 'enabled' || s.status === 'webhook_callback_verification_pending')
      );
      const hasActive = relevant.some((s: any) => s.transport?.callback === webhookUrl);
      if (!hasActive) {
        await createEventSubSubscriptionOfType({
          type: 'channel.follow',
          version: '2',
          broadcasterId: channel.twitchChannelId,
          webhookUrl,
          secret: process.env.TWITCH_EVENTSUB_SECRET!,
        });
      }
    } catch {
      // ignore (subscription might already exist or creation might be restricted)
    }

    return res.json({ ok: true, followGreetingsEnabled: channel.followGreetingsEnabled, followGreetingTemplate: channel.followGreetingTemplate ?? null });
  },

  disableFollowGreetings: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: { followGreetingsEnabled: false },
      select: { followGreetingsEnabled: true, followGreetingTemplate: true },
    });

    return res.json({ ok: true, followGreetingsEnabled: channel.followGreetingsEnabled, followGreetingTemplate: channel.followGreetingTemplate ?? null });
  },

  patchFollowGreetings: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const template = normalizeMessage((req.body as any)?.followGreetingTemplate);
    if (!template) return res.status(400).json({ error: 'Bad Request', message: 'followGreetingTemplate is required' });
    if (template.length > FOLLOW_GREETING_TEMPLATE_MAX_LEN) {
      return res.status(400).json({ error: 'Bad Request', message: `followGreetingTemplate is too long (max ${FOLLOW_GREETING_TEMPLATE_MAX_LEN})` });
    }

    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: { followGreetingTemplate: template },
      select: { followGreetingsEnabled: true, followGreetingTemplate: true },
    });

    return res.json({ ok: true, followGreetingsEnabled: channel.followGreetingsEnabled, followGreetingTemplate: channel.followGreetingTemplate ?? null });
  },

  getStreamDuration: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    try {
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { streamDurationCommandJson: true },
      });
      if (!channel) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });

      const raw = String((channel as any)?.streamDurationCommandJson || '').trim();
      if (!raw) {
        return res.json({
          enabled: false,
          trigger: DEFAULT_STREAM_DURATION_TRIGGER,
          responseTemplate: DEFAULT_STREAM_DURATION_TEMPLATE,
          breakCreditMinutes: DEFAULT_BREAK_CREDIT_MINUTES,
          onlyWhenLive: false,
        });
      }

      try {
        const parsed = JSON.parse(raw);
        return res.json({
          enabled: Boolean((parsed as any)?.enabled),
          trigger: String((parsed as any)?.trigger || DEFAULT_STREAM_DURATION_TRIGGER),
          responseTemplate:
            (parsed as any)?.responseTemplate === null
              ? null
              : String((parsed as any)?.responseTemplate || DEFAULT_STREAM_DURATION_TEMPLATE),
          breakCreditMinutes: Number.isFinite(Number((parsed as any)?.breakCreditMinutes))
            ? Math.max(0, Math.min(24 * 60, Math.floor(Number((parsed as any)?.breakCreditMinutes))))
            : DEFAULT_BREAK_CREDIT_MINUTES,
          onlyWhenLive: Boolean((parsed as any)?.onlyWhenLive),
        });
      } catch {
        // Invalid JSON in DB: fall back to defaults instead of crashing.
        return res.json({
          enabled: false,
          trigger: DEFAULT_STREAM_DURATION_TRIGGER,
          responseTemplate: DEFAULT_STREAM_DURATION_TEMPLATE,
          breakCreditMinutes: DEFAULT_BREAK_CREDIT_MINUTES,
          onlyWhenLive: false,
        });
      }
    } catch (e: any) {
      // Prisma "column does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2022') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw e;
    }
  },

  patchStreamDuration: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const body = (req.body ?? {}) as any;

    const enabled = body.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'enabled must be boolean' });
    }

    const trigger = String(body.trigger ?? '').trim();
    if (!trigger) return res.status(400).json({ error: 'Bad Request', message: 'trigger is required' });
    if (trigger.length > STREAM_DURATION_TRIGGER_MAX_LEN) {
      return res.status(400).json({ error: 'Bad Request', message: `trigger is too long (max ${STREAM_DURATION_TRIGGER_MAX_LEN})` });
    }

    const responseTemplateRaw = body.responseTemplate;
    let responseTemplate: string | null;
    if (responseTemplateRaw === null) {
      responseTemplate = null;
    } else {
      const t = normalizeMessage(responseTemplateRaw ?? DEFAULT_STREAM_DURATION_TEMPLATE);
      if (!t) return res.status(400).json({ error: 'Bad Request', message: 'responseTemplate must be non-empty or null' });
      if (t.length > STREAM_DURATION_TEMPLATE_MAX_LEN) {
        return res.status(400).json({ error: 'Bad Request', message: `responseTemplate is too long (max ${STREAM_DURATION_TEMPLATE_MAX_LEN})` });
      }
      responseTemplate = t;
    }

    const breakCreditMinutesRaw = body.breakCreditMinutes;
    if (!Number.isFinite(Number(breakCreditMinutesRaw))) {
      return res.status(400).json({ error: 'Bad Request', message: 'breakCreditMinutes must be a number' });
    }
    const breakCreditMinutes = Math.max(0, Math.min(24 * 60, Math.floor(Number(breakCreditMinutesRaw))));

    const onlyWhenLive = body.onlyWhenLive;
    if (typeof onlyWhenLive !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'onlyWhenLive must be boolean' });
    }

    const payload = {
      enabled,
      trigger,
      triggerNormalized: trigger.toLowerCase(),
      responseTemplate,
      breakCreditMinutes,
      onlyWhenLive,
      updatedAt: new Date().toISOString(),
    };

    try {
      const updated = await prisma.channel.update({
        where: { id: channelId },
        data: { streamDurationCommandJson: JSON.stringify(payload) },
        select: { streamDurationCommandJson: true },
      });
      void updated;
      return res.json({
        enabled,
        trigger,
        responseTemplate,
        breakCreditMinutes,
        onlyWhenLive,
      });
    } catch (e: any) {
      // Prisma "column does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2022') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw e;
    }
  },
};









