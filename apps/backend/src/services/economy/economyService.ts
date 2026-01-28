import type { Prisma, PrismaClient, StreamProvider } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { WalletService } from '../WalletService.js';
import { getStreamStatusSnapshot } from '../../realtime/streamStatusStore.js';
import { getActiveStreamSession, startStreamSession } from './streamSessions.js';

export const ECONOMY_DEFAULTS = {
  memesPerHour: 2,
  avgMemePriceCoins: 100,
  rewardMultiplier: 1,
  approvalBonusCoins: 0,
};

export const ECONOMY_LIMITS = {
  memesPerHour: { min: 1, max: 10 },
  rewardMultiplier: { min: 0.5, max: 2 },
  approvalBonusCoins: { min: 0, max: 100 },
};

export const ECONOMY_CONSTANTS = {
  dailyShare: 0.6,
  watchShare: 0.4,
  dailyCooldownMs: 24 * 60 * 60 * 1000,
  watchCooldownMs: 30 * 60 * 1000,
  maxWatchClaimsPerStream: 5,
  startBonusCoins: 100,
  accountLinkBonusCoins: 100,
  approvalBaseCoins: 20,
  authorActivationShare: 0.1,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function getLoginStreakMultiplier(streakCount: number): number {
  if (streakCount >= 7) return 2.0;
  if (streakCount >= 5) return 1.5;
  if (streakCount >= 3) return 1.25;
  return 1.0;
}

export function computeLoginStreakCount(lastClaimAt: Date | null, previousCount: number, now: Date): number {
  if (!lastClaimAt) return 1;
  const lastDay = Math.floor(lastClaimAt.getTime() / DAY_MS);
  const today = Math.floor(now.getTime() / DAY_MS);
  if (today === lastDay) return Math.max(1, previousCount);
  if (today === lastDay + 1) return Math.max(1, previousCount + 1);
  return 1;
}

export type EconomySettings = {
  memesPerHour: number;
  avgMemePriceCoins: number;
  rewardMultiplier: number;
  approvalBonusCoins: number;
};

export type EconomyComputed = {
  streamHoursLastWeek: number;
  dailyBonusCoins: number;
  watchBonusCoins: number;
};

export type EconomyViewerDaily = {
  lastClaimAt: string | null;
  nextClaimAt: string | null;
  canClaim: boolean;
  cooldownSecondsRemaining: number;
  streakCount?: number;
  streakMultiplier?: number;
};

export type EconomyViewerWatch = {
  lastClaimAt: string | null;
  nextClaimAt: string | null;
  canClaim: boolean;
  cooldownSecondsRemaining: number;
  claimsThisStream: number;
  maxClaimsPerStream: number;
};

export type EconomyViewerSnapshot = {
  daily: EconomyViewerDaily;
  watch: EconomyViewerWatch;
};

export type EconomySnapshot = {
  settings: EconomySettings;
  computed: EconomyComputed;
  stream: { status: 'online' | 'offline' };
  serverNow: string;
  viewer?: EconomyViewerSnapshot;
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function normalizeEconomySettings(channel: {
  defaultPriceCoins?: number | null;
  economyMemesPerHour?: number | null;
  economyRewardMultiplier?: number | null;
  economyApprovalBonusCoins?: number | null;
  submissionRewardCoinsUpload?: number | null;
  submissionRewardCoins?: number | null;
}): EconomySettings {
  const avgPriceRaw = Number.isFinite(channel.defaultPriceCoins ?? NaN)
    ? (channel.defaultPriceCoins as number)
    : ECONOMY_DEFAULTS.avgMemePriceCoins;
  const memesPerHourRaw = Number.isFinite(channel.economyMemesPerHour ?? NaN)
    ? (channel.economyMemesPerHour as number)
    : ECONOMY_DEFAULTS.memesPerHour;
  const multiplierRaw = Number.isFinite(channel.economyRewardMultiplier ?? NaN)
    ? (channel.economyRewardMultiplier as number)
    : ECONOMY_DEFAULTS.rewardMultiplier;
  const approvalBonusRaw = Number.isFinite(channel.economyApprovalBonusCoins ?? NaN)
    ? (channel.economyApprovalBonusCoins as number)
    : Number.isFinite(channel.submissionRewardCoinsUpload ?? NaN)
      ? (channel.submissionRewardCoinsUpload as number)
      : Number.isFinite(channel.submissionRewardCoins ?? NaN)
        ? (channel.submissionRewardCoins as number)
        : ECONOMY_DEFAULTS.approvalBonusCoins;

  return {
    memesPerHour: Math.round(
      clampNumber(memesPerHourRaw, ECONOMY_LIMITS.memesPerHour.min, ECONOMY_LIMITS.memesPerHour.max)
    ),
    avgMemePriceCoins: Math.max(0, Math.round(avgPriceRaw)),
    rewardMultiplier: clampNumber(
      multiplierRaw,
      ECONOMY_LIMITS.rewardMultiplier.min,
      ECONOMY_LIMITS.rewardMultiplier.max
    ),
    approvalBonusCoins: Math.round(
      clampNumber(
        approvalBonusRaw,
        ECONOMY_LIMITS.approvalBonusCoins.min,
        ECONOMY_LIMITS.approvalBonusCoins.max
      )
    ),
  };
}

export async function getStreamHoursLastWeek(client: PrismaClient, channelId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sessions = await client.streamSession.findMany({
    where: {
      channelId,
      startedAt: { lt: now },
      OR: [{ endedAt: null }, { endedAt: { gt: since } }],
    },
    select: { startedAt: true, endedAt: true },
  });

  let totalMs = 0;
  for (const session of sessions) {
    const startedAt = session.startedAt > since ? session.startedAt : since;
    const endedAt = session.endedAt && session.endedAt < now ? session.endedAt : now;
    if (endedAt <= since) continue;
    if (endedAt <= startedAt) continue;
    totalMs += endedAt.getTime() - startedAt.getTime();
  }

  const hours = totalMs / (60 * 60 * 1000);
  return Math.round(hours * 100) / 100;
}

export function calculateDailyBonusCoins(settings: EconomySettings, streamHoursLastWeek: number): number {
  const memesPerWeek = settings.memesPerHour * Math.max(0, streamHoursLastWeek);
  const coinsNeededPerWeek = memesPerWeek * settings.avgMemePriceCoins;
  const dailyBase = (coinsNeededPerWeek * ECONOMY_CONSTANTS.dailyShare) / 7;
  const daily = dailyBase * settings.rewardMultiplier;
  return Math.max(0, Math.round(daily));
}

export function calculateWatchBonusCoins(settings: EconomySettings): number {
  const watchBase = settings.avgMemePriceCoins * ECONOMY_CONSTANTS.watchShare;
  const watch = watchBase * settings.rewardMultiplier;
  return Math.max(0, Math.round(watch));
}

function computeDailySnapshot(
  state: {
    dailyBonusLastClaimAt?: Date | null;
    loginStreakLastClaimAt?: Date | null;
    loginStreakCount?: number | null;
  },
  now: Date,
  dailyBonusCoins: number
): EconomyViewerDaily {
  const last = state.dailyBonusLastClaimAt ?? null;
  const next = last ? new Date(last.getTime() + ECONOMY_CONSTANTS.dailyCooldownMs) : null;
  const cooldownSecondsRemaining = next ? Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000)) : 0;
  const canClaim = dailyBonusCoins > 0 && (!next || now >= next);
  const streakCount = Math.max(0, Math.floor(state.loginStreakCount ?? 0));
  const streakMultiplier = getLoginStreakMultiplier(streakCount);
  return {
    lastClaimAt: last ? last.toISOString() : null,
    nextClaimAt: next ? next.toISOString() : null,
    canClaim,
    cooldownSecondsRemaining,
    streakCount,
    streakMultiplier,
  };
}

function computeWatchSnapshot(
  state: { watchBonusLastClaimAt?: Date | null; watchBonusClaimCount?: number | null; watchBonusSessionId?: string | null },
  now: Date,
  watchBonusCoins: number,
  activeSessionId: string | null,
  isLive: boolean
): EconomyViewerWatch {
  const last = state.watchBonusLastClaimAt ?? null;
  const next = last ? new Date(last.getTime() + ECONOMY_CONSTANTS.watchCooldownMs) : null;
  const cooldownSecondsRemaining = next ? Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000)) : 0;
  const claimsThisStream = activeSessionId && state.watchBonusSessionId === activeSessionId
    ? Math.max(0, Math.floor(state.watchBonusClaimCount ?? 0))
    : 0;
  const canClaim =
    isLive &&
    watchBonusCoins > 0 &&
    claimsThisStream < ECONOMY_CONSTANTS.maxWatchClaimsPerStream &&
    (!next || now >= next);

  return {
    lastClaimAt: last ? last.toISOString() : null,
    nextClaimAt: next ? next.toISOString() : null,
    canClaim,
    cooldownSecondsRemaining,
    claimsThisStream,
    maxClaimsPerStream: ECONOMY_CONSTANTS.maxWatchClaimsPerStream,
  };
}

export async function buildEconomySnapshot(params: {
  client?: PrismaClient;
  channel: {
    id: string;
    slug: string;
    defaultPriceCoins?: number | null;
    economyMemesPerHour?: number | null;
    economyRewardMultiplier?: number | null;
    economyApprovalBonusCoins?: number | null;
    submissionRewardCoinsUpload?: number | null;
    submissionRewardCoins?: number | null;
  };
  userId?: string | null;
  now?: Date;
}): Promise<EconomySnapshot> {
  const client = params.client ?? prisma;
  const now = params.now ?? new Date();
  const channel = params.channel;

  const settings = normalizeEconomySettings(channel);
  const streamStatus = await getStreamStatusSnapshot(channel.slug);
  const streamHoursLastWeek = await getStreamHoursLastWeek(client, channel.id, now);
  const computed: EconomyComputed = {
    streamHoursLastWeek,
    dailyBonusCoins: calculateDailyBonusCoins(settings, streamHoursLastWeek),
    watchBonusCoins: calculateWatchBonusCoins(settings),
  };

  const snapshot: EconomySnapshot = {
    settings,
    computed,
    stream: { status: streamStatus.status },
    serverNow: now.toISOString(),
  };

  const userId = params.userId ?? null;
  if (userId) {
    const state = await client.channelViewerEconomy.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId } },
      select: {
        dailyBonusLastClaimAt: true,
        loginStreakLastClaimAt: true,
        loginStreakCount: true,
        watchBonusLastClaimAt: true,
        watchBonusClaimCount: true,
        watchBonusSessionId: true,
      },
    });

    const activeSession = streamStatus.status === 'online' ? await getActiveStreamSession(channel.id) : null;
    snapshot.viewer = {
      daily: computeDailySnapshot(state ?? {}, now, computed.dailyBonusCoins),
      watch: computeWatchSnapshot(state ?? {}, now, computed.watchBonusCoins, activeSession?.id ?? null, streamStatus.status === 'online'),
    };
  }

  return snapshot;
}

export async function ensureEconomyStateWithStartBonus(params: {
  tx: Prisma.TransactionClient;
  userId: string;
  channelId: string;
  lockedWallet: { userId: string; channelId: string; balance: number };
  now?: Date;
}): Promise<{ startBonusGranted: boolean; wallet: { balance: number } } > {
  const { tx, userId, channelId, lockedWallet } = params;
  const now = params.now ?? new Date();

  const created = await tx.channelViewerEconomy.createMany({
    data: [
      {
        channelId,
        userId,
        startBonusGrantedAt: now,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count > 0) {
    const wallet = await WalletService.incrementBalance(tx, { userId, channelId }, ECONOMY_CONSTANTS.startBonusCoins, {
      lockedWallet,
    });
    return { startBonusGranted: true, wallet };
  }

  const existing = await tx.channelViewerEconomy.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { startBonusGrantedAt: true },
  });

  if (!existing?.startBonusGrantedAt) {
    const updated = await tx.channelViewerEconomy.update({
      where: { channelId_userId: { channelId, userId } },
      data: { startBonusGrantedAt: now },
      select: { id: true },
    });
    if (updated?.id) {
      const wallet = await WalletService.incrementBalance(tx, { userId, channelId }, ECONOMY_CONSTANTS.startBonusCoins, {
        lockedWallet,
      });
      return { startBonusGranted: true, wallet };
    }
  }

  return { startBonusGranted: false, wallet: lockedWallet };
}

export async function ensureActiveStreamSession(channelId: string, provider: StreamProvider = 'unknown') {
  const active = await getActiveStreamSession(channelId);
  if (active) return active;
  return startStreamSession(channelId, provider);
}

export async function grantAccountLinkBonusTx(params: {
  tx: Prisma.TransactionClient;
  userId: string;
  channelId: string;
  provider: 'youtube' | 'vkvideo';
  bonusCoins?: number;
}): Promise<{ granted: boolean; balance?: number }> {
  const userId = String(params.userId || '').trim();
  const channelId = String(params.channelId || '').trim();
  if (!userId || !channelId) return { granted: false };

  const provider = params.provider;
  const bonusCoins =
    typeof params.bonusCoins === 'number' && Number.isFinite(params.bonusCoins)
      ? Math.max(0, Math.floor(params.bonusCoins))
      : ECONOMY_CONSTANTS.accountLinkBonusCoins;

  const state = await params.tx.channelViewerEconomy.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { linkedProviders: true },
  });

  const linked = Array.isArray(state?.linkedProviders) ? state!.linkedProviders : [];
  if (linked.includes(provider)) return { granted: false };

  const nextProviders = [...linked, provider];
  if (!state) {
    await params.tx.channelViewerEconomy.create({
      data: {
        channelId,
        userId,
        linkedProviders: nextProviders,
      },
    });
  } else {
    await params.tx.channelViewerEconomy.update({
      where: { channelId_userId: { channelId, userId } },
      data: { linkedProviders: nextProviders },
    });
  }

  if (bonusCoins <= 0) return { granted: true };
  const wallet = await WalletService.incrementBalance(params.tx, { userId, channelId }, bonusCoins);
  return { granted: true, balance: wallet.balance };
}
