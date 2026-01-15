import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import {
  type StreamDurationBody,
  type StreamDurationConfig,
  DEFAULT_BREAK_CREDIT_MINUTES,
  DEFAULT_STREAM_DURATION_TEMPLATE,
  DEFAULT_STREAM_DURATION_TRIGGER,
  STREAM_DURATION_TEMPLATE_MAX_LEN,
  STREAM_DURATION_TRIGGER_MAX_LEN,
  isPrismaErrorCode,
  normalizeMessage,
  requireChannelId,
} from './botShared.js';

export const botStreamDurationHandlers = {
  getStreamDuration: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    try {
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { streamDurationCommandJson: true },
      });
      if (!channel) return res.status(404).json({ error: 'Not Found', message: 'Channel not found' });

      const raw = String(channel.streamDurationCommandJson || '').trim();
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
        const config = parsed && typeof parsed === 'object' ? (parsed as StreamDurationConfig) : null;
        const enabled = Boolean(config?.enabled);
        const trigger = String(config?.trigger ?? DEFAULT_STREAM_DURATION_TRIGGER);
        const rawResponse = config?.responseTemplate;
        const responseTemplate = rawResponse === null ? null : String(rawResponse ?? DEFAULT_STREAM_DURATION_TEMPLATE);
        const breakMinutesValue = config?.breakCreditMinutes;
        const breakCreditMinutes = Number.isFinite(Number(breakMinutesValue))
          ? Math.max(0, Math.min(24 * 60, Math.floor(Number(breakMinutesValue))))
          : DEFAULT_BREAK_CREDIT_MINUTES;
        const onlyWhenLive = Boolean(config?.onlyWhenLive);
        return res.json({
          enabled,
          trigger,
          responseTemplate,
          breakCreditMinutes,
          onlyWhenLive,
        });
      } catch {
        return res.json({
          enabled: false,
          trigger: DEFAULT_STREAM_DURATION_TRIGGER,
          responseTemplate: DEFAULT_STREAM_DURATION_TEMPLATE,
          breakCreditMinutes: DEFAULT_BREAK_CREDIT_MINUTES,
          onlyWhenLive: false,
        });
      }
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2022')) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },

  patchStreamDuration: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const body = (req.body ?? {}) as StreamDurationBody;

    const enabled = body.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request', message: 'enabled must be boolean' });
    }

    const trigger = String(body.trigger ?? '').trim();
    if (!trigger) return res.status(400).json({ error: 'Bad Request', message: 'trigger is required' });
    if (trigger.length > STREAM_DURATION_TRIGGER_MAX_LEN) {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: `trigger is too long (max ${STREAM_DURATION_TRIGGER_MAX_LEN})` });
    }

    const responseTemplateRaw = body.responseTemplate;
    let responseTemplate: string | null;
    if (responseTemplateRaw === null) {
      responseTemplate = null;
    } else {
      const t = normalizeMessage(responseTemplateRaw ?? DEFAULT_STREAM_DURATION_TEMPLATE);
      if (!t)
        return res.status(400).json({ error: 'Bad Request', message: 'responseTemplate must be non-empty or null' });
      if (t.length > STREAM_DURATION_TEMPLATE_MAX_LEN) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `responseTemplate is too long (max ${STREAM_DURATION_TEMPLATE_MAX_LEN})`,
        });
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
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2022')) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },
};
