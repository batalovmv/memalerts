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
        externalAccounts: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            provider: true,
            providerAccountId: true,
            displayName: true,
            login: true,
            avatarUrl: true,
            profileUrl: true,
            createdAt: true,
            updatedAt: true,
          },
        },
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
      // Backward compatibility: legacy enum value "vkplay" should be presented as "vk" to the frontend.
      externalAccounts: user.externalAccounts.map((a) => ({
        ...a,
        provider: a.provider === ('vkplay' as any) ? ('vk' as any) : a.provider,
      })),
    };
    debugLog('[DEBUG] getMe sending response', { userId: user.id, hasChannel: !!user.channelId });
    res.json(response);
  } catch (error: any) {
    debugError('[DEBUG] getMe error', error);
    throw error;
  }
};


