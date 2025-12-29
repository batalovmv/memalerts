import { prisma } from '../lib/prisma.js';

export type ChatIdentityProvider = 'twitch' | 'youtube' | 'vkvideo' | 'trovo' | 'kick';

type CacheEntry = { userId: string | null; ts: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;

function k(provider: ChatIdentityProvider, platformUserId: string) {
  return `${provider}:${platformUserId}`;
}

function isFresh(e: CacheEntry | undefined) {
  if (!e) return false;
  return Date.now() - e.ts < CACHE_TTL_MS;
}

/**
 * Resolves a MemAlerts `User.id` for a chat message author.
 *
 * - **twitch**: tries `User.twitchUserId`, then `ExternalAccount(provider=twitch, providerAccountId)`
 * - **vkvideo**: `ExternalAccount(provider=vkvideo, providerAccountId)`
 * - **youtube**: best-effort: `ExternalAccount(provider=youtube, login=<authorChannelId>)`
 *
 * Returns null if the account is not linked to any MemAlerts user.
 */
export async function resolveMemalertsUserIdFromChatIdentity(params: {
  provider: ChatIdentityProvider;
  platformUserId: string;
}): Promise<string | null> {
  const provider = params.provider;
  const platformUserId = String(params.platformUserId || '').trim();
  if (!platformUserId) return null;

  const key = k(provider, platformUserId);
  const cached = cache.get(key);
  if (isFresh(cached)) return cached!.userId;

  let userId: string | null = null;

  try {
    if (provider === 'twitch') {
      const u = await prisma.user.findUnique({
        where: { twitchUserId: platformUserId },
        select: { id: true },
      });
      if (u?.id) {
        userId = u.id;
      } else {
        const ext = await prisma.externalAccount.findUnique({
          where: { provider_providerAccountId: { provider: 'twitch', providerAccountId: platformUserId } },
          select: { userId: true },
        });
        userId = ext?.userId || null;
      }
    } else if (provider === 'vkvideo') {
      const ext = await prisma.externalAccount.findUnique({
        where: { provider_providerAccountId: { provider: 'vkvideo', providerAccountId: platformUserId } },
        select: { userId: true },
      });
      userId = ext?.userId || null;
    } else if (provider === 'youtube') {
      // OAuth stores Google "sub" as providerAccountId, but chat provides authorChannelId.
      // We store authorChannelId into ExternalAccount.login on link (best-effort).
      const ext = await prisma.externalAccount.findFirst({
        where: { provider: 'youtube', login: platformUserId },
        select: { userId: true },
      });
      userId = ext?.userId || null;
    } else if (provider === 'trovo') {
      const ext = await prisma.externalAccount.findUnique({
        where: { provider_providerAccountId: { provider: 'trovo', providerAccountId: platformUserId } },
        select: { userId: true },
      });
      userId = ext?.userId || null;
    } else if (provider === 'kick') {
      const ext = await prisma.externalAccount.findUnique({
        where: { provider_providerAccountId: { provider: 'kick', providerAccountId: platformUserId } },
        select: { userId: true },
      });
      userId = ext?.userId || null;
    }
  } catch {
    userId = null;
  }

  cache.set(key, { userId, ts: Date.now() });
  return userId;
}


