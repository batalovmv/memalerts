import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { debugLog, debugError } from '../../utils/debug.js';

export const getMe = async (req: AuthRequest, res: Response) => {
  debugLog('[DEBUG] getMe started', { userId: req.userId });
  try {
    const startTime = Date.now();
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: {
        wallets: true,
        channel: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    });
    const dbDuration = Date.now() - startTime;
    debugLog('[DEBUG] getMe db query completed', { userId: req.userId, found: !!user, dbDuration });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const response = {
      id: user.id,
      displayName: user.displayName,
      profileImageUrl: user.profileImageUrl || null,
      role: user.role,
      channelId: user.channelId,
      channel: user.channel,
      wallets: user.wallets,
    };
    debugLog('[DEBUG] getMe sending response', { userId: user.id, hasChannel: !!user.channelId });
    res.json(response);
  } catch (error: any) {
    debugError('[DEBUG] getMe error', error);
    throw error;
  }
};


