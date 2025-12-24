import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { overlayPresetsBodySchema } from '../../shared/index.js';
import { ZodError } from 'zod';

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
  if (!channelId) return res.status(400).json({ error: 'Channel ID required' });

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { overlayPresetsJson: true },
  });
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const parsed = safeParsePresets((channel as any).overlayPresetsJson);
  const presets = Array.isArray(parsed) ? parsed : [];

  return res.json({ presets });
};

export const putOverlayPresets = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) return res.status(400).json({ error: 'Channel ID required' });

  try {
    const body = overlayPresetsBodySchema.parse(req.body ?? {});

    const json = JSON.stringify(body.presets);
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > OVERLAY_PRESETS_JSON_MAX_BYTES) {
      return res.status(413).json({
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
  } catch (e: any) {
    if (e instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: e.errors });
    }
    throw e;
  }
};


