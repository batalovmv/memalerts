import type { Prisma } from '@prisma/client';
import type { CursorFieldSchema } from '../../../utils/pagination.js';
import type { EconomySnapshot } from '../../../services/economy/economyService.js';

export const makeCreatedCursorSchema = (direction: 'asc' | 'desc'): CursorFieldSchema[] => [
  { key: 'createdAt', direction, type: 'date' },
  { key: 'id', direction: 'desc', type: 'string' },
];

export const makePriceCursorSchema = (direction: 'asc' | 'desc'): CursorFieldSchema[] => [
  { key: 'priceCoins', direction, type: 'number' },
  { key: 'createdAt', direction: 'desc', type: 'date' },
  { key: 'id', direction: 'desc', type: 'string' },
];

export type ChannelWithOwner = Prisma.ChannelGetPayload<{
  include: {
    users: {
      take: 5;
      orderBy: { createdAt: 'asc' };
      select: { id: true; displayName: true; profileImageUrl: true; role: true };
    };
    _count: {
      select: {
        channelMemes: { where: { status: 'approved'; deletedAt: null } };
        users: true;
      };
    };
  };
}>;

export type ChannelResponse = {
  id: string;
  slug: string;
  name: string;
  memeCatalogMode: string;
  coinPerPointRatio: number | null;
  overlayMode: string;
  overlayShowSender: boolean;
  overlayMaxConcurrent: number;
  rewardIdForCoins: string | null;
  rewardEnabled: boolean;
  rewardTitle: string | null;
  rewardCost: number | null;
  rewardCoins: number | null;
  rewardOnlyWhenLive: boolean;
  vkvideoRewardEnabled: boolean;
  vkvideoRewardIdForCoins: string | null;
  vkvideoCoinPerPointRatio: number;
  vkvideoRewardCoins: number | null;
  vkvideoRewardOnlyWhenLive: boolean;
  submissionRewardCoins: number;
  submissionRewardOnlyWhenLive: boolean;
  submissionsEnabled: boolean;
  submissionsOnlyWhenLive: boolean;
  autoApproveEnabled: boolean;
  wheelEnabled: boolean;
  wheelPaidSpinCostCoins: number | null;
  wheelPrizeMultiplier: number | null;
  coinIconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  dashboardCardOrder: unknown | null;
  createdAt: Date;
  owner: { id: string; displayName: string | null; profileImageUrl: string | null } | null;
  stats: { memesCount: number; usersCount: number };
  economy?: EconomySnapshot;
  memes?: Array<Record<string, unknown>>;
  memesPage?: { limit: number; offset: number; returned: number; total: number };
};

export type PoolAssetRow = Prisma.MemeAssetGetPayload<{
  select: {
    id: true;
    type: true;
    fileUrl: true;
    fileHash: true;
    durationMs: true;
    qualityScore: true;
    variants: {
      select: {
        format: true;
        fileUrl: true;
        status: true;
        priority: true;
        fileSizeBytes: true;
      };
    };
    createdAt: true;
    aiAutoTitle: true;
    createdBy: { select: { id: true; displayName: true } };
    channelMemes: { select: { id: true; title: true; priceCoins: true; cooldownMinutes: true; lastActivatedAt: true } };
  };
}>;

export type ChannelMemeRow = Prisma.ChannelMemeGetPayload<{
  select: {
    id: true;
    memeAssetId: true;
    title: true;
    priceCoins: true;
    cooldownMinutes: true;
    lastActivatedAt: true;
    status: true;
    createdAt: true;
    memeAsset: {
      select: {
        type: true;
        fileUrl: true;
        fileHash: true;
        durationMs: true;
        qualityScore: true;
        variants: {
          select: {
            format: true;
            fileUrl: true;
            status: true;
            priority: true;
            fileSizeBytes: true;
          };
        };
        aiStatus: true;
        aiAutoTitle: true;
        aiAutoDescription: true;
        aiAutoTagNames: true;
        createdBy: { select: { id: true; displayName: true } };
      };
    };
  };
}>;
