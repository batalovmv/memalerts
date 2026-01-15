import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { debugLog, debugError } from '../../utils/debug.js';

function normalizeVkVideoProfileUrl(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const slug = s.replace(/^\/+/, '').replace(/^@/, '').trim();
  if (!slug) return null;
  return `https://live.vkvideo.ru/${slug}`;
}

export const getMe = async (req: AuthRequest, res: Response) => {
  debugLog('[DEBUG] getMe started', { userId: req.userId });
  try {
    const startTime = Date.now();
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: {
        wallets: true,
        globalModerator: { select: { revokedAt: true } },
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

    // Used by frontend to enable /moderation UX without extra round-trips.
    // Admin is always allowed; otherwise this reflects an active GlobalModerator grant (revokedAt IS NULL).
    const isGlobalModerator =
      user.role === 'admin' || (Boolean(user.globalModerator) && !user.globalModerator?.revokedAt);

    const externalAccounts = user.externalAccounts.map((a) => {
      const provider = String(a.provider || '').toLowerCase();
      if (provider === 'youtube') {
        const channelId = String(a.login || '').trim();
        const profileUrl = a.profileUrl ?? null;
        if (!profileUrl && channelId) {
          return { ...a, profileUrl: `https://www.youtube.com/channel/${channelId}` };
        }
      }
      if (provider === 'vkvideo') {
        const profileUrl = normalizeVkVideoProfileUrl(a.profileUrl ?? null) ?? a.profileUrl ?? null;
        const displayName = a.displayName ?? null;
        const login = a.login ?? null;
        return { ...a, profileUrl, displayName: displayName ?? (login ? String(login) : null) };
      }
      return a;
    });

    const response = {
      id: user.id,
      displayName: user.displayName,
      profileImageUrl: user.profileImageUrl || null,
      role: user.role,
      isGlobalModerator,
      channelId: user.channelId,
      channel: user.channel,
      wallets: user.wallets,
      // Backward compatibility: legacy enum value "vkplay" should be presented as "vk" to the frontend.
      externalAccounts: externalAccounts.map((a) => ({
        ...a,
        provider: a.provider === 'vkplay' ? 'vk' : a.provider,
      })),
    };
    debugLog('[DEBUG] getMe sending response', { userId: user.id, hasChannel: !!user.channelId });
    res.json(response);
  } catch (error) {
    debugError('[DEBUG] getMe error', error as Error);
    throw error;
  }
};
