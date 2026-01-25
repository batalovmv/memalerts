import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

const BAN_PROGRESSION_MS = [
  30 * 60 * 1000,
  60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
];
const BAN_DECAY_DAYS = 30;
const LOOKBACK_HOURS = 24;
const REJECTED_THRESHOLD = 5;
const HIGH_RISK_THRESHOLD = 0.7;
const HIGH_RISK_COUNT = 3;
const DUPLICATE_THRESHOLD = 10;

type SpamBanSnapshot = {
  isBanned: boolean;
  banUntil: Date | null;
  banCount: number;
  reason: string | null;
  retryAfterSeconds: number | null;
};

function isMissingTableError(error: unknown): boolean {
  const err = error as { code?: string; meta?: { table?: string } };
  const table = typeof err?.meta?.table === 'string' ? err.meta.table : '';
  return err?.code === 'P2021' && table.toLowerCase().includes('userbanstate');
}

function secondsUntil(date: Date | null): number | null {
  if (!date) return null;
  const diff = date.getTime() - Date.now();
  if (!Number.isFinite(diff)) return null;
  return Math.max(1, Math.ceil(diff / 1000));
}

export async function getActiveSpamBan(userId: string): Promise<SpamBanSnapshot> {
  let state: { banCount: number; currentBanUntil: Date | null; reason: string | null } | null = null;
  try {
    state = await prisma.userBanState.findUnique({
      where: { userId },
      select: { banCount: true, currentBanUntil: true, reason: true },
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      logger.warn('spam_ban.table_missing');
      return { isBanned: false, banUntil: null, banCount: 0, reason: null, retryAfterSeconds: null };
    }
    throw error;
  }
  const banUntil = state?.currentBanUntil ?? null;
  const isBanned = !!banUntil && banUntil.getTime() > Date.now();
  return {
    isBanned,
    banUntil,
    banCount: state?.banCount ?? 0,
    reason: state?.reason ?? null,
    retryAfterSeconds: isBanned ? secondsUntil(banUntil) : null,
  };
}

function computeBanDurationMs(banCount: number): number {
  const idx = Math.min(Math.max(0, banCount), BAN_PROGRESSION_MS.length - 1);
  return BAN_PROGRESSION_MS[idx];
}

async function applySpamBan(userId: string, reason: string): Promise<SpamBanSnapshot> {
  const now = new Date();
  let state: { banCount: number; currentBanUntil: Date | null; banDecayAt: Date | null } | null = null;
  try {
    state = await prisma.userBanState.findUnique({
      where: { userId },
      select: { banCount: true, currentBanUntil: true, banDecayAt: true },
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      logger.warn('spam_ban.table_missing');
      return { isBanned: false, banUntil: null, banCount: 0, reason: null, retryAfterSeconds: null };
    }
    throw error;
  }

  if (state?.currentBanUntil && state.currentBanUntil > now) {
    return {
      isBanned: true,
      banUntil: state.currentBanUntil,
      banCount: state.banCount ?? 0,
      reason,
      retryAfterSeconds: secondsUntil(state.currentBanUntil),
    };
  }

  const shouldDecay = !!state?.banDecayAt && state.banDecayAt < now;
  const baseCount = shouldDecay ? 0 : state?.banCount ?? 0;
  const durationMs = computeBanDurationMs(baseCount);
  const banUntil = new Date(now.getTime() + durationMs);
  const banDecayAt = new Date(now.getTime() + BAN_DECAY_DAYS * 24 * 60 * 60 * 1000);

  try {
    if (!state) {
      await prisma.userBanState.create({
        data: {
          userId,
          banCount: 1,
          currentBanUntil: banUntil,
          lastBanAt: now,
          banDecayAt,
          reason,
        },
      });
    } else if (shouldDecay) {
      await prisma.userBanState.update({
        where: { userId },
        data: {
          banCount: 1,
          currentBanUntil: banUntil,
          lastBanAt: now,
          banDecayAt,
          reason,
        },
      });
    } else {
      await prisma.userBanState.update({
        where: { userId },
        data: {
          banCount: { increment: 1 },
          currentBanUntil: banUntil,
          lastBanAt: now,
          banDecayAt,
          reason,
        },
      });
    }
  } catch (error) {
    if (isMissingTableError(error)) {
      logger.warn('spam_ban.table_missing');
      return { isBanned: false, banUntil: null, banCount: 0, reason: null, retryAfterSeconds: null };
    }
    throw error;
  }

  logger.warn('user.spam_banned', {
    userId,
    banUntil,
    banCount: baseCount + 1,
    reason,
  });

  return {
    isBanned: true,
    banUntil,
    banCount: baseCount + 1,
    reason,
    retryAfterSeconds: secondsUntil(banUntil),
  };
}

function countDuplicateSubmissions(rows: Array<{ fileHash: string | null; memeAssetId: string | null }>): number {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key =
      row.fileHash && row.fileHash.trim().length > 0
        ? `file:${row.fileHash}`
        : row.memeAssetId && row.memeAssetId.trim().length > 0
          ? `asset:${row.memeAssetId}`
          : null;
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let duplicates = 0;
  for (const count of counts.values()) {
    if (count > 1) duplicates += count - 1;
  }
  return duplicates;
}

export async function evaluateAndApplySpamBan(userId: string): Promise<{ applied: boolean; reason?: string }> {
  const active = await getActiveSpamBan(userId);
  if (active.isBanned) return { applied: false, reason: active.reason ?? undefined };

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const rows = await prisma.memeSubmission.findMany({
    where: { submitterUserId: userId, createdAt: { gte: since } },
    select: {
      status: true,
      aiRiskScore: true,
      fileHash: true,
      memeAssetId: true,
    },
  });

  const rejected = rows.filter((row) => row.status === 'rejected').length;
  if (rejected >= REJECTED_THRESHOLD) {
    await applySpamBan(userId, `${REJECTED_THRESHOLD}+ rejected submissions in ${LOOKBACK_HOURS}h`);
    return { applied: true, reason: 'rejected_threshold' };
  }

  const highRisk = rows.filter((row) => typeof row.aiRiskScore === 'number' && row.aiRiskScore >= HIGH_RISK_THRESHOLD)
    .length;
  if (highRisk >= HIGH_RISK_COUNT) {
    await applySpamBan(userId, `${HIGH_RISK_COUNT}+ high-risk submissions in ${LOOKBACK_HOURS}h`);
    return { applied: true, reason: 'high_risk_threshold' };
  }

  const duplicateCount = countDuplicateSubmissions(rows);
  if (duplicateCount >= DUPLICATE_THRESHOLD) {
    await applySpamBan(userId, `${DUPLICATE_THRESHOLD}+ duplicate submissions in ${LOOKBACK_HOURS}h`);
    return { applied: true, reason: 'duplicate_threshold' };
  }

  return { applied: false };
}
