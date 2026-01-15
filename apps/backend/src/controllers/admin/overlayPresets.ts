import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { overlayPresetsBodySchema } from '../../shared/schemas.js';
import { ZodError } from 'zod';
import { ERROR_CODES, ERROR_MESSAGES } from '../../shared/errors.js';

const OVERLAY_PRESETS_JSON_MAX_BYTES = 75_000;

function safeParsePresets(raw: string | null | undefined): unknown {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export const getOverlayPresets = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId)
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { overlayPresetsJson: true },
  });
  if (!channel)
    return res.status(404).json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: ERROR_MESSAGES.CHANNEL_NOT_FOUND });

  const parsed = safeParsePresets(channel.overlayPresetsJson);
  const presets = Array.isArray(parsed) ? parsed : [];

  return res.json({ presets });
};

export const putOverlayPresets = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId)
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });

  try {
    const body = overlayPresetsBodySchema.parse(req.body ?? {});

    const json = JSON.stringify(body.presets);
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > OVERLAY_PRESETS_JSON_MAX_BYTES) {
      return res.status(413).json({
        errorCode: ERROR_CODES.FILE_TOO_LARGE,
        error: 'Payload Too Large',
        message: `presets JSON is too large (max ${OVERLAY_PRESETS_JSON_MAX_BYTES} bytes)`,
      });
    }

    await prisma.channel.update({
      where: { id: channelId },
      data: {
        overlayPresetsJson: body.presets.length ? json : null,
      },
      select: { id: true },
    });

    return res.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof ZodError) {
      return res
        .status(400)
        .json({ errorCode: ERROR_CODES.VALIDATION_ERROR, error: ERROR_MESSAGES.VALIDATION_ERROR, details: e.errors });
    }
    throw e;
  }
};
