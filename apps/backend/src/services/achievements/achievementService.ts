import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { WalletService } from '../WalletService.js';

export type AchievementScope = 'global' | 'channel' | 'event';

export type AchievementDefinition = {
  key: string;
  title: string;
  description: string;
  scope: AchievementScope;
  target?: number;
  rewardCoins?: number;
};

export const GLOBAL_ACHIEVEMENTS: AchievementDefinition[] = [
  {
    key: 'first_100',
    title: 'Первопроходец',
    description: 'Один из первых 100 пользователей платформы.',
    scope: 'global',
  },
  {
    key: 'memelord',
    title: 'Мемлорд',
    description: '100 активаций мемов на всех каналах.',
    scope: 'global',
    target: 100,
  },
  {
    key: 'speedster',
    title: 'Скорострел',
    description: '3 активации за минуту.',
    scope: 'global',
    target: 3,
  },
  {
    key: 'night_watch',
    title: 'Ночной дозор',
    description: 'Активация после полуночи.',
    scope: 'global',
    target: 1,
  },
  {
    key: 'early_bird',
    title: 'Ранняя пташка',
    description: 'Активация до 8 утра.',
    scope: 'global',
    target: 1,
  },
  {
    key: 'viral_500',
    title: 'Вирусный',
    description: 'Ваш мем набрал 500 активаций.',
    scope: 'global',
    target: 500,
  },
];

export const CHANNEL_ACHIEVEMENTS: AchievementDefinition[] = [
  {
    key: 'channel_newbie',
    title: 'Новичок',
    description: 'Первый мем на канале.',
    scope: 'channel',
    target: 1,
    rewardCoins: 20,
  },
  {
    key: 'channel_fan',
    title: 'Фанат',
    description: '50 активаций на канале.',
    scope: 'channel',
    target: 50,
    rewardCoins: 50,
  },
  {
    key: 'channel_legend',
    title: 'Легенда',
    description: '100 активаций на канале.',
    scope: 'channel',
    target: 100,
    rewardCoins: 100,
  },
  {
    key: 'channel_contributor',
    title: 'Контрибьютор',
    description: '10 одобренных мемов на канале.',
    scope: 'channel',
    target: 10,
    rewardCoins: 30,
  },
  {
    key: 'quality_wave',
    title: 'На волне',
    description: '10 одобренных мемов подряд на канале.',
    scope: 'channel',
    target: 10,
  },
];

export function getAchievementDefinitions() {
  return {
    global: GLOBAL_ACHIEVEMENTS,
    channel: CHANNEL_ACHIEVEMENTS,
  };
}

function isUniqueError(error: unknown): boolean {
  const err = error as { code?: string };
  return err?.code === 'P2002';
}

async function grantAchievement(params: {
  tx: Prisma.TransactionClient;
  userId: string;
  channelId?: string | null;
  key: string;
  rewardCoins?: number;
}): Promise<{ granted: boolean; balance?: number; rewardCoins?: number }> {
  const { tx, userId, channelId, key, rewardCoins } = params;
  try {
    await tx.userAchievement.create({
      data: {
        userId,
        channelId: channelId ?? null,
        key,
      },
    });
  } catch (error: unknown) {
    if (isUniqueError(error)) return { granted: false };
    throw error;
  }

  if (rewardCoins && channelId) {
    const wallet = await WalletService.incrementBalance(tx, { userId, channelId }, rewardCoins);
    return { granted: true, balance: wallet.balance, rewardCoins };
  }

  return { granted: true };
}

export async function grantGlobalAchievement(params: {
  tx: Prisma.TransactionClient;
  userId: string;
  key: string;
}): Promise<{ granted: boolean }> {
  const result = await grantAchievement({
    tx: params.tx,
    userId: params.userId,
    key: params.key,
  });
  return { granted: result.granted };
}

export type AchievementWalletUpdate = {
  userId: string;
  channelId: string;
  balance: number;
  delta: number;
  reason: string;
};

export type EventAchievementSnapshotItem = {
  key: string;
  title: string;
  description?: string | null;
  scope: 'event';
  target?: number;
  progress?: number;
  rewardCoins?: number;
  achievedAt?: string | null;
  eventKey: string;
  eventTitle: string;
  eventEndsAt: string;
};

type ActiveEventRow = {
  id: string;
  key: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
};

async function fetchActiveEvents(client: PrismaClient | Prisma.TransactionClient, now: Date): Promise<ActiveEventRow[]> {
  return client.seasonalEvent.findMany({
    where: {
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    select: {
      id: true,
      key: true,
      title: true,
      startsAt: true,
      endsAt: true,
    },
    orderBy: { startsAt: 'desc' },
  });
}

export async function processActivationAchievements(params: {
  tx: Prisma.TransactionClient;
  userId: string;
  channelId: string;
  occurredAt: Date;
}): Promise<{ walletUpdates: AchievementWalletUpdate[]; grants: string[] }> {
  const { tx, userId, channelId, occurredAt } = params;

  const existing = await tx.userAchievement.findMany({
    where: {
      userId,
      OR: [{ channelId: null }, { channelId }],
    },
    select: { key: true, channelId: true },
  });

  const globalAchieved = new Set(existing.filter((e) => !e.channelId).map((e) => e.key));
  const channelAchieved = new Set(existing.filter((e) => e.channelId === channelId).map((e) => e.key));

  const since = new Date(occurredAt.getTime() - 60_000);
  const [channelActivations, globalActivations, recentActivations] = await Promise.all([
    tx.memeActivation.count({ where: { userId, channelId } }),
    tx.memeActivation.count({ where: { userId } }),
    tx.memeActivation.count({ where: { userId, createdAt: { gte: since } } }),
  ]);

  const walletUpdates: AchievementWalletUpdate[] = [];
  const grants: string[] = [];

  const channelCandidates: Array<{ key: string; target: number; rewardCoins: number }> = [
    { key: 'channel_newbie', target: 1, rewardCoins: 20 },
    { key: 'channel_fan', target: 50, rewardCoins: 50 },
    { key: 'channel_legend', target: 100, rewardCoins: 100 },
  ];

  for (const def of channelCandidates) {
    if (channelAchieved.has(def.key)) continue;
    if (channelActivations < def.target) continue;
    const grant = await grantAchievement({
      tx,
      userId,
      channelId,
      key: def.key,
      rewardCoins: def.rewardCoins,
    });
    if (grant.granted) {
      grants.push(def.key);
      if (grant.balance !== undefined) {
        walletUpdates.push({
          userId,
          channelId,
          balance: grant.balance,
          delta: def.rewardCoins,
          reason: `achievement:${def.key}`,
        });
      }
    }
  }

  if (!globalAchieved.has('memelord') && globalActivations >= 100) {
    const grant = await grantAchievement({ tx, userId, key: 'memelord' });
    if (grant.granted) grants.push('memelord');
  }

  if (!globalAchieved.has('speedster') && recentActivations >= 3) {
    const grant = await grantAchievement({ tx, userId, key: 'speedster' });
    if (grant.granted) grants.push('speedster');
  }

  const hour = occurredAt.getHours();
  if (!globalAchieved.has('night_watch') && hour >= 0 && hour < 5) {
    const grant = await grantAchievement({ tx, userId, key: 'night_watch' });
    if (grant.granted) grants.push('night_watch');
  }
  if (!globalAchieved.has('early_bird') && hour >= 0 && hour < 8) {
    const grant = await grantAchievement({ tx, userId, key: 'early_bird' });
    if (grant.granted) grants.push('early_bird');
  }

  return { walletUpdates, grants };
}

export async function processEventAchievements(params: {
  tx: Prisma.TransactionClient;
  userId: string;
  channelId: string;
  occurredAt: Date;
}): Promise<{ walletUpdates: AchievementWalletUpdate[]; grants: Array<{ key: string; eventKey: string }> }> {
  const { tx, userId, channelId, occurredAt } = params;

  const events = await fetchActiveEvents(tx, occurredAt);
  if (events.length === 0) return { walletUpdates: [], grants: [] };

  const eventIds = events.map((event) => event.id);
  const definitions = await tx.eventAchievement.findMany({
    where: { eventId: { in: eventIds } },
    orderBy: { createdAt: 'asc' },
  });
  if (definitions.length === 0) return { walletUpdates: [], grants: [] };

  const existing = await tx.userEventAchievement.findMany({
    where: {
      userId,
      eventAchievement: { eventId: { in: eventIds } },
    },
    select: { eventAchievementId: true },
  });
  const achieved = new Set(existing.map((row) => row.eventAchievementId));

  const activationCounts = new Map<string, number>();
  for (const event of events) {
    const count = await tx.memeActivation.count({
      where: {
        userId,
        createdAt: { gte: event.startsAt, lte: event.endsAt },
      },
    });
    activationCounts.set(event.id, count);
  }

  const eventById = new Map(events.map((event) => [event.id, event]));
  const walletUpdates: AchievementWalletUpdate[] = [];
  const grants: Array<{ key: string; eventKey: string }> = [];

  for (const def of definitions) {
    if (achieved.has(def.id)) continue;
    const event = eventById.get(def.eventId);
    if (!event) continue;

    const target =
      typeof def.targetActivations === 'number' && Number.isFinite(def.targetActivations)
        ? Math.max(1, Math.floor(def.targetActivations))
        : 1;
    const progress = activationCounts.get(def.eventId) ?? 0;
    if (progress < target) continue;

    try {
      await tx.userEventAchievement.create({
        data: {
          eventAchievementId: def.id,
          userId,
          channelId,
        },
      });
    } catch (error: unknown) {
      if (isUniqueError(error)) continue;
      throw error;
    }

    if (def.rewardCoins && def.rewardCoins > 0) {
      const updated = await WalletService.incrementBalance(tx, { userId, channelId }, def.rewardCoins);
      walletUpdates.push({
        userId,
        channelId,
        balance: updated.balance,
        delta: def.rewardCoins,
        reason: `event:${event.key}:${def.key}`,
      });
    }

    grants.push({
      key: `${event.key}:${def.key}`,
      eventKey: event.key,
    });
  }

  return { walletUpdates, grants };
}

export async function processSubmissionApprovalAchievements(params: {
  tx: Prisma.TransactionClient;
  userId: string;
  channelId: string;
  streakCount?: number | null;
}): Promise<{ walletUpdates: AchievementWalletUpdate[]; grants: string[] }> {
  const { tx, userId, channelId } = params;

  const existing = await tx.userAchievement.findMany({
    where: { userId, channelId },
    select: { key: true },
  });
  const achieved = new Set(existing.map((e) => e.key));

  const grants: string[] = [];

  const approvedCount = await tx.memeSubmission.count({
    where: { submitterUserId: userId, channelId, status: 'approved' },
  });

  const walletUpdates: AchievementWalletUpdate[] = [];

  if (!achieved.has('channel_contributor') && approvedCount >= 10) {
    const grant = await grantAchievement({
      tx,
      userId,
      channelId,
      key: 'channel_contributor',
      rewardCoins: 30,
    });
    if (grant.granted && grant.balance !== undefined) {
      walletUpdates.push({
        userId,
        channelId,
        balance: grant.balance,
        delta: 30,
        reason: 'achievement:channel_contributor',
      });
      grants.push('channel_contributor');
    }
  }

  if (!achieved.has('quality_wave')) {
    let streakCount = Math.max(0, Math.floor(params.streakCount ?? 0));
    if (!streakCount) {
      const streak = await tx.channelSubmissionStreak.findUnique({
        where: { channelId_userId: { channelId, userId } },
        select: { streakCount: true },
      });
      streakCount = Math.max(0, Math.floor(streak?.streakCount ?? 0));
    }
    if (streakCount >= 10) {
      const grant = await grantAchievement({ tx, userId, channelId, key: 'quality_wave' });
      if (grant.granted) grants.push('quality_wave');
    }
  }

  return { walletUpdates, grants };
}

export async function buildUserAchievementsSnapshot(params: {
  client?: PrismaClient;
  userId: string;
  channelId: string;
  now?: Date;
}): Promise<{ global: Array<Record<string, unknown>>; channel: Array<Record<string, unknown>>; events?: EventAchievementSnapshotItem[] }> {
  const client = params.client ?? prisma;
  const { userId, channelId } = params;
  const now = params.now ?? new Date();

  const existing = await client.userAchievement.findMany({
    where: { userId, OR: [{ channelId: null }, { channelId }] },
    select: { key: true, channelId: true, achievedAt: true },
  });

  const achievedGlobal = new Map<string, Date>();
  const achievedChannel = new Map<string, Date>();
  for (const row of existing) {
    if (row.channelId) {
      achievedChannel.set(row.key, row.achievedAt);
    } else {
      achievedGlobal.set(row.key, row.achievedAt);
    }
  }

  const since = new Date(Date.now() - 60_000);
  const [globalActivations, channelActivations, recentActivations, approvedCount, streakRow, viralActivations] = await Promise.all([
    client.memeActivation.count({ where: { userId } }),
    client.memeActivation.count({ where: { userId, channelId } }),
    client.memeActivation.count({ where: { userId, createdAt: { gte: since } } }),
    client.memeSubmission.count({ where: { submitterUserId: userId, channelId, status: 'approved' } }),
    client.channelSubmissionStreak.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { streakCount: true },
    }),
    client.memeActivation.count({
      where: { channelMeme: { memeAsset: { createdById: userId } } },
    }),
  ]);
  const streakCount = Math.max(0, Math.floor(streakRow?.streakCount ?? 0));

  const global = GLOBAL_ACHIEVEMENTS.map((def) => {
    let progress: number | undefined;
    if (def.key === 'memelord') progress = globalActivations;
    if (def.key === 'speedster') progress = recentActivations;
    if (def.key === 'viral_500') progress = viralActivations;
    if (def.key === 'night_watch' || def.key === 'early_bird' || def.key === 'first_100') {
      progress = achievedGlobal.has(def.key) ? 1 : 0;
    }
    const achievedAt = achievedGlobal.get(def.key);
    return {
      key: def.key,
      title: def.title,
      description: def.description,
      scope: def.scope,
      target: def.target,
      progress,
      rewardCoins: def.rewardCoins,
      achievedAt: achievedAt ? achievedAt.toISOString() : null,
    };
  });

  const channel = CHANNEL_ACHIEVEMENTS.map((def) => {
    let progress: number | undefined;
    if (def.key === 'channel_contributor') progress = approvedCount;
    if (def.key === 'channel_newbie' || def.key === 'channel_fan' || def.key === 'channel_legend') {
      progress = channelActivations;
    }
    if (def.key === 'quality_wave') progress = streakCount;
    const achievedAt = achievedChannel.get(def.key);
    return {
      key: def.key,
      title: def.title,
      description: def.description,
      scope: def.scope,
      target: def.target,
      progress,
      rewardCoins: def.rewardCoins,
      achievedAt: achievedAt ? achievedAt.toISOString() : null,
    };
  });

  const events = await buildActiveEventAchievementsSnapshot({ client, userId, now });
  return { global, channel, events: events.length ? events : undefined };
}

export async function buildActiveEventAchievementsSnapshot(params: {
  client?: PrismaClient;
  userId: string;
  now?: Date;
}): Promise<EventAchievementSnapshotItem[]> {
  const client = params.client ?? prisma;
  const now = params.now ?? new Date();

  const events = await fetchActiveEvents(client, now);
  if (events.length === 0) return [];

  const eventIds = events.map((event) => event.id);
  const definitions = await client.eventAchievement.findMany({
    where: { eventId: { in: eventIds } },
    orderBy: { createdAt: 'asc' },
  });
  if (definitions.length === 0) return [];

  const grants = await client.userEventAchievement.findMany({
    where: {
      userId: params.userId,
      eventAchievement: { eventId: { in: eventIds } },
    },
    select: { eventAchievementId: true, achievedAt: true },
  });
  const grantMap = new Map(grants.map((row) => [row.eventAchievementId, row.achievedAt]));

  const activationCounts = new Map<string, number>();
  for (const event of events) {
    const count = await client.memeActivation.count({
      where: {
        userId: params.userId,
        createdAt: { gte: event.startsAt, lte: event.endsAt },
      },
    });
    activationCounts.set(event.id, count);
  }

  const eventById = new Map(events.map((event) => [event.id, event]));
  const items: EventAchievementSnapshotItem[] = [];

  for (const def of definitions) {
    const event = eventById.get(def.eventId);
    if (!event) continue;
    const achievedAt = grantMap.get(def.id);
    const progress = activationCounts.get(def.eventId) ?? 0;
    const target =
      typeof def.targetActivations === 'number' && Number.isFinite(def.targetActivations)
        ? Math.max(1, Math.floor(def.targetActivations))
        : undefined;

    items.push({
      key: `${event.key}:${def.key}`,
      title: def.title,
      description: def.description ?? undefined,
      scope: 'event',
      target,
      progress: target ? progress : undefined,
      rewardCoins: typeof def.rewardCoins === 'number' ? def.rewardCoins : undefined,
      achievedAt: achievedAt ? achievedAt.toISOString() : null,
      eventKey: event.key,
      eventTitle: event.title,
      eventEndsAt: event.endsAt.toISOString(),
    });
  }

  return items;
}

export async function maybeGrantFirstUserAchievement(userId: string): Promise<void> {
  const totalUsers = await prisma.user.count();
  if (totalUsers > 100) return;

  try {
    await prisma.userAchievement.create({
      data: {
        userId,
        channelId: null,
        key: 'first_100',
      },
    });
  } catch (error: unknown) {
    if (isUniqueError(error)) return;
    throw error;
  }
}
