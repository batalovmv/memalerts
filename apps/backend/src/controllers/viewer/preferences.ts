import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { patchUserPreferencesSchema, userPreferencesSchema } from '../../shared/schemas.js';
import { ZodError } from 'zod';

const DEFAULTS = userPreferencesSchema.parse({});

type PreferenceRow = {
  theme: string | null;
  autoplayMemesEnabled: boolean | null;
  memeModalMuted: boolean | null;
  coinsInfoSeen: boolean | null;
} | null;

function toResponse(row: PreferenceRow) {
  return {
    theme: row?.theme ?? DEFAULTS.theme,
    autoplayMemesEnabled: row?.autoplayMemesEnabled ?? DEFAULTS.autoplayMemesEnabled,
    memeModalMuted: row?.memeModalMuted ?? DEFAULTS.memeModalMuted,
    coinsInfoSeen: row?.coinsInfoSeen ?? DEFAULTS.coinsInfoSeen,
  };
}

export const getMePreferences = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const row = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      theme: true,
      autoplayMemesEnabled: true,
      memeModalMuted: true,
      coinsInfoSeen: true,
    },
  });

  return res.json(toResponse(row));
};

export const patchMePreferences = async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const patch = patchUserPreferencesSchema.parse(req.body ?? {});

    const existing = await prisma.userPreference.findUnique({
      where: { userId },
      select: {
        theme: true,
        autoplayMemesEnabled: true,
        memeModalMuted: true,
        coinsInfoSeen: true,
      },
    });

    // Contract: response should return full, merged, current object (with defaults).
    const merged = {
      ...toResponse(existing),
      ...patch,
    };

    // Keep DB writes minimal: update with patch, create with merged.
    await prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        theme: merged.theme,
        autoplayMemesEnabled: merged.autoplayMemesEnabled,
        memeModalMuted: merged.memeModalMuted,
        coinsInfoSeen: merged.coinsInfoSeen,
      },
      update: patch,
      select: { userId: true },
    });

    return res.json(merged);
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    throw error;
  }
};
