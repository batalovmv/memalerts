import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { buildUserAchievementsSnapshot } from '../../services/achievements/achievementService.js';

function normalizeSlug(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

export const getMyChannelAchievements = async (req: AuthRequest, res: Response) => {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) {
    return res.status(400).json({ errorCode: ERROR_CODES.BAD_REQUEST, error: 'Channel slug required' });
  }

  const channel = await prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: { id: true, slug: true },
  });

  if (!channel) {
    return res.status(404).json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: 'Channel not found' });
  }

  const snapshot = await buildUserAchievementsSnapshot({
    userId: req.userId!,
    channelId: channel.id,
  });

  return res.json(snapshot);
};
