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

const CHAT_COMMAND_ALLOWED_ROLES = ['vip', 'moderator', 'subscriber', 'follower'] as const;
type ChatCommandAllowedRole = (typeof CHAT_COMMAND_ALLOWED_ROLES)[number];
const CHAT_COMMAND_ALLOWED_ROLES_SET = new Set<string>(CHAT_COMMAND_ALLOWED_ROLES);

const ALLOWED_USERS_MAX_COUNT = 100;
const TWITCH_LOGIN_MAX_LEN = 25; // Twitch login max length
const TWITCH_LOGIN_RE = /^[a-z0-9_]{1,25}$/;

function normalizeAllowedRoles(raw: any): ChatCommandAllowedRole[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  const out: ChatCommandAllowedRole[] = [];
  for (const v of raw) {
    const role = String(v ?? '').trim().toLowerCase();
    if (!role) continue;
    if (!CHAT_COMMAND_ALLOWED_ROLES_SET.has(role)) return null;
    if (!out.includes(role as ChatCommandAllowedRole)) out.push(role as ChatCommandAllowedRole);
  }
  return out;
}

function normalizeAllowedUsers(raw: any): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  if (raw.length > ALLOWED_USERS_MAX_COUNT) return null;
  const out: string[] = [];
  for (const v of raw) {
    // Accept "@Login" and normalize to "login" (lowercase, without '@')
    const login = String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/^@+/, '');
    if (!login) continue;
    if (login.length > TWITCH_LOGIN_MAX_LEN) return null;
    if (!TWITCH_LOGIN_RE.test(login)) return null;
    if (!out.includes(login)) out.push(login);
  }
  return out;
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

    // Contract: 200 OK with minimal payload for idempotent enable.
    // (We still keep the upsert for idempotency and for bot runner to pick up.)
    void sub;
    return res.json({ ok: true });
  },

  say: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const providerRaw = (req.body as any)?.provider;
    const provider = String(providerRaw ?? 'twitch').trim().toLowerCase();

    const message = normalizeMessage((req.body as any)?.message);
    if (!message) return res.status(400).json({ error: 'Bad Request', message: 'Message is required' });
    if (message.length > TWITCH_MESSAGE_MAX_LEN) {
      return res.status(400).json({ error: 'Bad Request', message: `Message is too long (max ${TWITCH_MESSAGE_MAX_LEN})` });
    }

    if (provider === 'youtube') {
      try {
        const sub = await (prisma as any).youTubeChatBotSubscription.findUnique({
          where: { channelId },
          select: { enabled: true, youtubeChannelId: true },
        });
        if (!sub?.enabled || !sub.youtubeChannelId) {
          return res.status(400).json({ error: 'Bad Request', message: 'YouTube chat bot is not enabled for this channel' });
        }

        const row = await (prisma as any).youTubeChatBotOutboxMessage.create({
          data: {
            channelId,
            youtubeChannelId: String(sub.youtubeChannelId),
            message,
            status: 'pending',
          },
          select: { id: true, status: true, createdAt: true },
        });
        return res.json({ ok: true, outbox: row });
      } catch (e: any) {
        // Feature not deployed / migrations not applied
        if (e?.code === 'P2021') {
          return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
        }
        throw e;
      }
    }

    if (provider === 'vkvideo') {
      try {
        // Optional gating by BotIntegrationSettings(provider=vkvideo).
        try {
          const gate = await (prisma as any).botIntegrationSettings.findUnique({
            where: { channelId_provider: { channelId, provider: 'vkvideo' } },
            select: { enabled: true },
          });
          if (gate && !gate.enabled) {
            return res.status(400).json({ error: 'Bad Request', message: 'VKVideo chat bot is not enabled for this channel' });
          }
        } catch (e: any) {
          // Feature not deployed / migrations not applied (older instances): ignore gate.
          if (e?.code !== 'P2021') throw e;
        }

        const sub = await (prisma as any).vkVideoChatBotSubscription.findUnique({
          where: { channelId },
          select: { enabled: true, vkvideoChannelId: true },
        });
        if (!sub?.enabled || !sub.vkvideoChannelId) {
          return res.status(400).json({ error: 'Bad Request', message: 'VKVideo chat bot is not enabled for this channel' });
        }

        const row = await (prisma as any).vkVideoChatBotOutboxMessage.create({
          data: {
            channelId,
            vkvideoChannelId: String(sub.vkvideoChannelId),
            message,
            status: 'pending',
          },
          select: { id: true, status: true, createdAt: true },
        });
        return res.json({ ok: true, outbox: row });
      } catch (e: any) {
        // Feature not deployed / migrations not applied
        if (e?.code === 'P2021') {
          return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
        }
        throw e;
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

  getCommands: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    try {
      const items = await prisma.chatBotCommand.findMany({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          trigger: true,
          response: true,
          enabled: true,
          onlyWhenLive: true,
          allowedRoles: true,
          allowedUsers: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Frontend accepts both array and {items}.
      return res.json({ items });
    } catch (e: any) {
      // Prisma "column does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2022') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw e;
    }
  },

  createCommand: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const { trigger, triggerNormalized } = normalizeTrigger((req.body as any)?.trigger);
    const responseText = normalizeMessage((req.body as any)?.response);
    const onlyWhenLiveRaw = (req.body as any)?.onlyWhenLive;
    const onlyWhenLive = onlyWhenLiveRaw === undefined ? false : onlyWhenLiveRaw;
    const allowedRolesParsed = normalizeAllowedRoles((req.body as any)?.allowedRoles);
    const allowedUsersParsed = normalizeAllowedUsers((req.body as any)?.allowedUsers);

    if (!trigger) return res.status(400).json({ error: 'Bad Request', message: 'Trigger is required' });
    if (!responseText) return res.status(400).json({ error: 'Bad Request', message: 'Response is required' });
    if (typeof onlyWhenLive !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'onlyWhenLive must be boolean' });
    }
    if (allowedRolesParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `allowedRoles must be an array of roles (${CHAT_COMMAND_ALLOWED_ROLES.join(', ')})`,
      });
    }
    if (allowedUsersParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `allowedUsers must be an array of lowercase twitch logins (max ${ALLOWED_USERS_MAX_COUNT})`,
      });
    }
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
          onlyWhenLive,
          allowedRoles: allowedRolesParsed ?? [],
          allowedUsers: allowedUsersParsed ?? [],
        },
        select: {
          id: true,
          trigger: true,
          response: true,
          enabled: true,
          onlyWhenLive: true,
          allowedRoles: true,
          allowedUsers: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return res.status(201).json(row);
    } catch (e: any) {
      // Prisma "column does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2022') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
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
    const onlyWhenLive = (req.body as any)?.onlyWhenLive;
    const allowedRolesParsed = normalizeAllowedRoles((req.body as any)?.allowedRoles);
    const allowedUsersParsed = normalizeAllowedUsers((req.body as any)?.allowedUsers);
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'enabled must be boolean' });
    }
    if (onlyWhenLive !== undefined && typeof onlyWhenLive !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'onlyWhenLive must be boolean' });
    }
    if (allowedRolesParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `allowedRoles must be an array of roles (${CHAT_COMMAND_ALLOWED_ROLES.join(', ')})`,
      });
    }
    if (allowedUsersParsed === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `allowedUsers must be an array of lowercase twitch logins (max ${ALLOWED_USERS_MAX_COUNT})`,
      });
    }

    if (enabled === undefined && onlyWhenLive === undefined && allowedRolesParsed === undefined && allowedUsersParsed === undefined) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'At least one field is required (enabled, onlyWhenLive, allowedRoles, allowedUsers)',
      });
    }

    const data: any = {};
    if (enabled !== undefined) data.enabled = enabled;
    if (onlyWhenLive !== undefined) data.onlyWhenLive = onlyWhenLive;
    if (allowedRolesParsed !== undefined) data.allowedRoles = allowedRolesParsed;
    if (allowedUsersParsed !== undefined) data.allowedUsers = allowedUsersParsed;

    try {
      const updated = await prisma.chatBotCommand.updateMany({
        where: { id, channelId },
        data,
      });
      if (updated.count === 0) return res.status(404).json({ error: 'Not Found', message: 'Command not found' });

      const row = await prisma.chatBotCommand.findUnique({
        where: { id },
        select: {
          id: true,
          trigger: true,
          response: true,
          enabled: true,
          onlyWhenLive: true,
          allowedRoles: true,
          allowedUsers: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Shouldn't happen, but keep 404 contract for "feature not deployed / missing".
      if (!row) return res.status(404).json({ error: 'Not Found', message: 'Command not found' });
      return res.json(row);
    } catch (e: any) {
      // Prisma "table does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2021') {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      // Prisma "column does not exist" (feature not deployed / migrations not applied)
      if (e?.code === 'P2022') {
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
    if (!channel.twitchChannelId) {
      return res.status(400).json({ error: 'Bad Request', message: 'This channel is not linked to Twitch' });
    }

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









