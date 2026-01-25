import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

export type ViewerMemeState = {
  favoriteIds: Set<string>;
  hiddenIds: Set<string>;
};

export async function loadViewerMemeState(args: {
  userId?: string | null;
  channelId?: string | null;
  memeAssetIds: string[];
}): Promise<ViewerMemeState | null> {
  const userId = args.userId ?? null;
  const channelId = args.channelId ?? null;
  const memeAssetIds = Array.isArray(args.memeAssetIds) ? args.memeAssetIds.filter(Boolean) : [];

  if (!userId || !channelId || memeAssetIds.length === 0) return null;

  const [favorites, hidden] = await Promise.all([
    prisma.userMemeFavorite.findMany({
      where: { userId, channelId, memeAssetId: { in: memeAssetIds } },
      select: { memeAssetId: true },
    }),
    prisma.userMemeBlocklist.findMany({
      where: { userId, channelId, memeAssetId: { in: memeAssetIds } },
      select: { memeAssetId: true },
    }),
  ]);

  return {
    favoriteIds: new Set(favorites.map((f) => f.memeAssetId)),
    hiddenIds: new Set(hidden.map((h) => h.memeAssetId)),
  };
}

export function applyViewerMemeState<T extends { memeAssetId?: string | null; id?: string }>(
  items: T[],
  state: ViewerMemeState | null
): Array<T & { isFavorite?: boolean; isHidden?: boolean }> {
  if (!state || !Array.isArray(items) || items.length === 0) return items as Array<T & { isFavorite?: boolean; isHidden?: boolean }>;

  return items.map((item) => {
    const key = String(item.memeAssetId || item.id || '');
    if (!key) return item as T & { isFavorite?: boolean; isHidden?: boolean };
    return {
      ...(item as T),
      isFavorite: state.favoriteIds.has(key),
      isHidden: state.hiddenIds.has(key),
    };
  });
}

export function buildMemeAssetVisibilityFilter(args: {
  channelId?: string | null;
  userId?: string | null;
  includeUserHidden?: boolean;
}): Prisma.MemeAssetWhereInput | null {
  const channelId = args.channelId ?? null;
  const userId = args.userId ?? null;
  const includeUserHidden = args.includeUserHidden !== false;

  const where: Prisma.MemeAssetWhereInput = {};
  if (channelId) {
    where.blockedByChannels = { none: { channelId } };
    if (userId && includeUserHidden) {
      where.blockedByUsers = { none: { userId, channelId } };
    }
  }

  return Object.keys(where).length > 0 ? where : null;
}

export function buildChannelMemeVisibilityFilter(args: {
  channelId?: string | null;
  userId?: string | null;
  includeUserHidden?: boolean;
}): Prisma.ChannelMemeWhereInput | null {
  const assetFilter = buildMemeAssetVisibilityFilter(args);
  if (!assetFilter) return null;
  return { memeAsset: assetFilter };
}
