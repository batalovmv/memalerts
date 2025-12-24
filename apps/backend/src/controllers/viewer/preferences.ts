import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { patchUserPreferencesSchema, userPreferencesSchema } from '../../shared/index.js';
import { ZodError } from 'zod';

const DEFAULTS = userPreferencesSchema.parse({});

function toResponse(row: any | null) {
  return {
    theme: (row?.theme as string | undefined) ?? DEFAULTS.theme,
    autoplayMemesEnabled: (row?.autoplayMemesEnabled as boolean | undefined) ?? DEFAULTS.autoplayMemesEnabled,
    memeModalMuted: (row?.memeModalMuted as boolean | undefined) ?? DEFAULTS.memeModalMuted,
    coinsInfoSeen: (row?.coinsInfoSeen as boolean | undefined) ?? DEFAULTS.coinsInfoSeen,
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
  } catch (e: any) {
    if (e instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: e.errors });
    }
    throw e;
  }
};


