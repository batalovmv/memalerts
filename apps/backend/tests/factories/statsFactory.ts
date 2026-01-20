import type { ChannelDailyStats, ChannelMemeStats30d, ChannelUserStats30d, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { createMeme } from './memeFactory.js';
import { createUser } from './userFactory.js';

export async function createChannelDailyStats(
  overrides: Partial<Prisma.ChannelDailyStatsUncheckedCreateInput> = {}
): Promise<ChannelDailyStats> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const data: Prisma.ChannelDailyStatsUncheckedCreateInput = {
    channelId,
    day: new Date(),
    totalActivationsCount: 0,
    totalCoinsSpentSum: BigInt(0),
    completedActivationsCount: 0,
    completedCoinsSpentSum: BigInt(0),
    uniqueUsersCountAll: 0,
    uniqueUsersCountCompleted: 0,
    ...overrides,
  };
  return prisma.channelDailyStats.create({ data });
}

export async function createChannelUserStats30d(
  overrides: Partial<Prisma.ChannelUserStats30dUncheckedCreateInput> = {}
): Promise<ChannelUserStats30d> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const userId = overrides.userId ?? (await createUser()).id;
  const now = new Date();
  const data: Prisma.ChannelUserStats30dUncheckedCreateInput = {
    channelId,
    userId,
    windowStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    windowEnd: now,
    totalActivationsCount: 0,
    totalCoinsSpentSum: BigInt(0),
    completedActivationsCount: 0,
    completedCoinsSpentSum: BigInt(0),
    ...overrides,
  };
  return prisma.channelUserStats30d.create({ data });
}

export async function createChannelMemeStats30d(
  overrides: Partial<Prisma.ChannelMemeStats30dUncheckedCreateInput> = {}
): Promise<ChannelMemeStats30d> {
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const memeId = overrides.memeId ?? (await createMeme({ channelId })).id;
  const now = new Date();
  const data: Prisma.ChannelMemeStats30dUncheckedCreateInput = {
    channelId,
    memeId,
    windowStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    windowEnd: now,
    totalActivationsCount: 0,
    totalCoinsSpentSum: BigInt(0),
    completedActivationsCount: 0,
    completedCoinsSpentSum: BigInt(0),
    ...overrides,
  };
  return prisma.channelMemeStats30d.create({ data });
}
