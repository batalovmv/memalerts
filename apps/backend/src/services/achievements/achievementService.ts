import { Prisma, type PrismaClient } from '@prisma/client';

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

export const GLOBAL_ACHIEVEMENTS: AchievementDefinition[] = [];

export const CHANNEL_ACHIEVEMENTS: AchievementDefinition[] = [
  {
    key: 'channel_newbie',
    title: 'Новичок',
    description: 'Первая активация мема на канале.',
    scope: 'channel',
    target: 1,
    rewardCoins: 20,
  },
  {
    key: 'channel_regular_7d',
    title: 'Завсегдатай',
    description: 'Активации в 7 разных дней на канале.',
    scope: 'channel',
    target: 7,
  },
  {
    key: 'channel_explorer_10',
    title: 'Исследователь',
    description: 'Активировал 10 разных мемов на канале.',
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
  const { tx, userId, channelId } = params;

  const existing = await tx.userAchievement.findMany({
    where: { userId, channelId },
    select: { key: true },
  });
  const channelAchieved = new Set(existing.map((e) => e.key));

  const walletUpdates: AchievementWalletUpdate[] = [];
  const grants: string[] = [];

  const channelActivations = await tx.memeActivation.count({ where: { userId, channelId } });

  if (!channelAchieved.has('channel_newbie') && channelActivations >= 1) {
    const rewardCoins = 20;
    const grant = await grantAchievement({ tx, userId, channelId, key: 'channel_newbie', rewardCoins });
    if (grant.granted) {
      grants.push('channel_newbie');
      if (grant.balance !== undefined) {
        walletUpdates.push({
          userId,
          channelId,
          balance: grant.balance,
          delta: rewardCoins,
          reason: 'achievement:channel_newbie',
        });
      }
    }
  }

  if (!channelAchieved.has('channel_explorer_10')) {
    const uniqueRows = await tx.memeActivation.groupBy({
      by: ['channelMemeId'],
      where: { userId, channelId },
      _count: { _all: true },
    });
    const uniqueMemesCount = uniqueRows.length;
    if (uniqueMemesCount >= 10) {
      const grant = await grantAchievement({ tx, userId, channelId, key: 'channel_explorer_10' });
      if (grant.granted) grants.push('channel_explorer_10');
    }
  }

  if (!channelAchieved.has('channel_regular_7d')) {
    const rows = await tx.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`
        SELECT COUNT(DISTINCT DATE("createdAt"))::int AS "count"
        FROM "MemeActivation"
        WHERE "userId" = ${userId} AND "channelId" = ${channelId}
      `,
    );
    const distinctDaysCount = rows[0]?.count ?? 0;
    if (distinctDaysCount >= 7) {
      const grant = await grantAchievement({ tx, userId, channelId, key: 'channel_regular_7d' });
      if (grant.granted) grants.push('channel_regular_7d');
    }
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
  void params;
  return { walletUpdates: [], grants: [] };
}

export async function buildUserAchievementsSnapshot(params: {
  client?: PrismaClient | Prisma.TransactionClient;
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

  const achievedChannel = new Map<string, Date>();
  for (const row of existing) {
    if (row.channelId) {
      achievedChannel.set(row.key, row.achievedAt);
    }
  }

  const [channelActivations, uniqueRows, distinctDayRows] = await Promise.all([
    client.memeActivation.count({ where: { userId, channelId } }),
    client.memeActivation.groupBy({
      by: ['channelMemeId'],
      where: { userId, channelId },
      _count: { _all: true },
    }),
    client.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`
        SELECT COUNT(DISTINCT DATE("createdAt"))::int AS "count"
        FROM "MemeActivation"
        WHERE "userId" = ${userId} AND "channelId" = ${channelId}
      `,
    ),
  ]);

  const uniqueMemesCount = uniqueRows.length;
  const distinctDaysCount = distinctDayRows[0]?.count ?? 0;

  const global: Array<Record<string, unknown>> = [];

  const channel = CHANNEL_ACHIEVEMENTS.map((def) => {
    let progress: number | undefined;
    if (def.key === 'channel_newbie') progress = channelActivations;
    if (def.key === 'channel_regular_7d') progress = distinctDaysCount;
    if (def.key === 'channel_explorer_10') progress = uniqueMemesCount;
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

export type StreamerChannelAchievementItem = {
  key: string;
  title: string;
  description?: string;
  scope: 'channel';
  target?: number;
  progress?: number;
  achievedAt?: string | null;
};

export async function buildChannelStreamerAchievementsSnapshot(params: {
  client?: PrismaClient | Prisma.TransactionClient;
  channelId: string;
}): Promise<StreamerChannelAchievementItem[]> {
  const client = params.client ?? prisma;
  const { channelId } = params;

  const [channel, activationsCount, firstActivation] = await Promise.all([
    client.channel.findUnique({
      where: { id: channelId },
      select: { submissionsEnabled: true },
    }),
    client.memeActivation.count({ where: { channelId } }),
    client.memeActivation.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const submissionsEnabled = channel?.submissionsEnabled !== false;

  const uniqueActivatorsRows = await client.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`
      SELECT COUNT(DISTINCT "userId")::int AS "count"
      FROM "MemeActivation"
      WHERE "channelId" = ${channelId}
    `,
  );
  const uniqueActivatorsCount = uniqueActivatorsRows[0]?.count ?? 0;

  const tenthUniqueRows = await client.$queryRaw<Array<{ firstAt: Date }>>(
    Prisma.sql`
      SELECT MIN("createdAt") AS "firstAt"
      FROM "MemeActivation"
      WHERE "channelId" = ${channelId}
      GROUP BY "userId"
      ORDER BY "firstAt" ASC
      OFFSET 9 LIMIT 1
    `,
  );
  const tenthUniqueAt = tenthUniqueRows[0]?.firstAt ?? null;

  const approvedCount = await client.memeSubmission.count({
    where: { channelId, status: 'approved' },
  });

  const tenthApproved = await client.memeSubmission.findMany({
    where: { channelId, status: 'approved' },
    orderBy: { createdAt: 'asc' },
    skip: 9,
    take: 1,
    select: { createdAt: true },
  });
  const tenthApprovedAt = tenthApproved[0]?.createdAt ?? null;

  const fifthAuthorRows = await client.$queryRaw<Array<{ firstAt: Date }>>(
    Prisma.sql`
      SELECT MIN("createdAt") AS "firstAt"
      FROM "MemeSubmission"
      WHERE "channelId" = ${channelId} AND "status" = 'approved'
      GROUP BY "submitterUserId"
      ORDER BY "firstAt" ASC
      OFFSET 4 LIMIT 1
    `,
  );
  const fifthAuthorAt = fifthAuthorRows[0]?.firstAt ?? null;

  const openUnlocked = submissionsEnabled && approvedCount >= 10 && fifthAuthorAt !== null;
  const openAchievedAt =
    openUnlocked && tenthApprovedAt && fifthAuthorAt ? new Date(Math.max(tenthApprovedAt.getTime(), fifthAuthorAt.getTime())) : null;

  return [
    {
      key: 'streamer_channel_launched',
      title: 'Канал запущен',
      description: 'На канале была хотя бы одна активация мема.',
      scope: 'channel',
      target: 1,
      progress: activationsCount,
      achievedAt: firstActivation ? firstActivation.createdAt.toISOString() : null,
    },
    {
      key: 'streamer_open_channel',
      title: 'Открытый канал',
      description: 'Сабмишены включены, одобрено 10 мемов от 5 авторов.',
      scope: 'channel',
      target: 10,
      progress: approvedCount,
      achievedAt: openAchievedAt ? openAchievedAt.toISOString() : null,
    },
    {
      key: 'streamer_live_channel_10',
      title: 'Живой канал',
      description: '10 уникальных активаторов.',
      scope: 'channel',
      target: 10,
      progress: uniqueActivatorsCount,
      achievedAt: tenthUniqueAt ? tenthUniqueAt.toISOString() : null,
    },
  ];
}

export async function buildActiveEventAchievementsSnapshot(params: {
  client?: PrismaClient | Prisma.TransactionClient;
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
