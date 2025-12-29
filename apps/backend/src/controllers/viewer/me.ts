import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { debugLog, debugError } from '../../utils/debug.js';
import { fetchMyYouTubeChannelProfileByAccessToken, getValidYouTubeAccessTokenByExternalAccountId } from '../../utils/youtubeApi.js';
import { fetchVkVideoCurrentUser, getValidVkVideoAccessTokenByExternalAccountId } from '../../utils/vkvideoApi.js';

async function bestEffortBackfillExternalAccounts(externalAccounts: any[], requestId: string | null): Promise<any[]> {
  // Avoid turning /me into a heavy endpoint: at most 1 YouTube + 1 VKVideo fetch per request, only if fields are missing.
  let didYouTube = false;
  let didVkVideo = false;

  const updated = [...externalAccounts];

  for (let i = 0; i < updated.length; i++) {
    const a = updated[i];
    const provider = String(a?.provider || '').toLowerCase();

    if (provider === 'youtube' && !didYouTube) {
      const needs = !a?.displayName || !a?.avatarUrl || !a?.profileUrl || !a?.login;
      if (!needs) continue;

      try {
        const token = await getValidYouTubeAccessTokenByExternalAccountId(String(a.id || ''));
        if (!token) continue;

        const profile = await fetchMyYouTubeChannelProfileByAccessToken(token);
        const channelId = profile?.channelId || null;
        if (!channelId) continue;

        const data: any = {};
        if (!a.displayName && profile?.title) data.displayName = profile.title;
        if (!a.avatarUrl && profile?.avatarUrl) data.avatarUrl = profile.avatarUrl;
        if (!a.login) data.login = channelId;
        if (!a.profileUrl) data.profileUrl = `https://www.youtube.com/channel/${channelId}`;

        if (Object.keys(data).length) {
          const row = await prisma.externalAccount.update({
            where: { id: a.id },
            data,
            select: { displayName: true, login: true, avatarUrl: true, profileUrl: true, updatedAt: true },
          });
          updated[i] = { ...a, ...row };
          debugLog('[DEBUG] getMe externalAccount backfilled (youtube)', { requestId, externalAccountId: a.id });
        }
      } catch (e: any) {
        debugLog('[DEBUG] getMe externalAccount backfill failed (youtube)', { requestId, errorMessage: e?.message || String(e) });
      } finally {
        didYouTube = true;
      }
    }

    if (provider === 'vkvideo' && !didVkVideo) {
      const needs = !a?.displayName || !a?.login || !a?.profileUrl;
      if (!needs) continue;

      try {
        const token = await getValidVkVideoAccessTokenByExternalAccountId(String(a.id || ''));
        if (!token) continue;

        const currentUser = await fetchVkVideoCurrentUser({ accessToken: token });
        if (!currentUser.ok) continue;

        const root = (currentUser.data as any)?.data ?? (currentUser.data as any) ?? null;
        const user = (root as any)?.user ?? (root as any)?.profile ?? root ?? null;
        const channelUrl = String((root as any)?.channel?.url || (user as any)?.url || '').trim() || null;
        const nameFromParts = String([user?.first_name, user?.last_name].filter(Boolean).join(' ')).trim() || null;
        const name =
          String(user?.display_name ?? user?.displayName ?? user?.name ?? user?.full_name ?? user?.nickname ?? user?.username ?? '').trim() ||
          nameFromParts ||
          null;
        const login = String(user?.login ?? user?.screen_name ?? user?.screenName ?? user?.username ?? user?.nickname ?? '').trim() || null;

        const data: any = {};
        if (!a.displayName && name) data.displayName = name;
        if (!a.login && login) data.login = login;
        if (!a.profileUrl && channelUrl) data.profileUrl = channelUrl;

        if (Object.keys(data).length) {
          const row = await prisma.externalAccount.update({
            where: { id: a.id },
            data,
            select: { displayName: true, login: true, avatarUrl: true, profileUrl: true, updatedAt: true },
          });
          updated[i] = { ...a, ...row };
          debugLog('[DEBUG] getMe externalAccount backfilled (vkvideo)', { requestId, externalAccountId: a.id });
        }
      } catch (e: any) {
        debugLog('[DEBUG] getMe externalAccount backfill failed (vkvideo)', { requestId, errorMessage: e?.message || String(e) });
      } finally {
        didVkVideo = true;
      }
    }

    if (didYouTube && didVkVideo) break;
  }

  // If we can derive YouTube profileUrl from stored channelId, do it without API calls.
  for (let i = 0; i < updated.length; i++) {
    const a = updated[i];
    if (String(a?.provider || '').toLowerCase() !== 'youtube') continue;
    const channelId = String(a?.login || '').trim();
    if (!a?.profileUrl && channelId) {
      updated[i] = { ...a, profileUrl: `https://www.youtube.com/channel/${channelId}` };
    }
  }

  return updated;
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
    const isGlobalModerator = user.role === 'admin' || (Boolean(user.globalModerator) && !user.globalModerator?.revokedAt);

    const externalAccounts = await bestEffortBackfillExternalAccounts(user.externalAccounts as any[], (req as any)?.requestId ?? null);

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


