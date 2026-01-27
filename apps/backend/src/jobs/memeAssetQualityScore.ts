import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function clampNumber(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function isSchedulerEnabled(): boolean {
  const raw = String(process.env.QUALITY_SCORE_ENABLED || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

type QualityScoreConfig = {
  windowDays: number;
  baseScore: number;
  maxScore: number;
  recencyDays: number;
  recencyMaxBonus: number;
  engagementMultiplier: number;
  maxEngagementScore: number;
};

function getQualityScoreConfig(): QualityScoreConfig {
  const windowDaysRaw = parseInt(String(process.env.QUALITY_SCORE_WINDOW_DAYS || ''), 10);
  const recencyDaysRaw = parseInt(String(process.env.QUALITY_SCORE_RECENCY_DAYS || ''), 10);
  const engagementMultiplierRaw = Number.parseFloat(String(process.env.QUALITY_SCORE_ENGAGEMENT_MULTIPLIER || ''));
  const maxScoreRaw = Number.parseFloat(String(process.env.QUALITY_SCORE_MAX_SCORE || ''));

  return {
    windowDays: clampInt(windowDaysRaw, 1, 180, 30),
    baseScore: 50,
    maxScore: clampNumber(maxScoreRaw, 60, 120, 100),
    recencyDays: clampInt(recencyDaysRaw, 1, 60, 20),
    recencyMaxBonus: 20,
    engagementMultiplier: clampNumber(engagementMultiplierRaw, 0.1, 10, 2),
    maxEngagementScore: 30,
  };
}

function computeQualityScore(params: { createdAt: Date; activations: number; now: Date; config: QualityScoreConfig }): number {
  const { createdAt, activations, now, config } = params;
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));

  const recencyBonus = (() => {
    if (config.recencyDays <= 0) return 0;
    const remaining = Math.max(0, config.recencyDays - ageDays);
    const normalized = remaining / config.recencyDays;
    return config.recencyMaxBonus * normalized;
  })();

  const engagementScore = Math.min(config.maxEngagementScore, Math.max(0, activations) * config.engagementMultiplier);
  const rawScore = config.baseScore + recencyBonus + engagementScore;
  const score = Math.max(0, Math.min(config.maxScore, rawScore));
  return Math.round(score * 10) / 10;
}

type ActivationRow = { memeAssetId: string; activations: number };

async function loadActivationCounts(since: Date): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<ActivationRow[]>`
    SELECT
      cm."memeAssetId" as "memeAssetId",
      COUNT(*)::int as "activations"
    FROM "MemeActivation" a
    JOIN "ChannelMeme" cm ON cm.id = a."channelMemeId"
    WHERE a."createdAt" >= ${since}
      AND a.status IN ('done','completed')
      AND cm."memeAssetId" IS NOT NULL
    GROUP BY cm."memeAssetId"
  `;

  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.memeAssetId) continue;
    map.set(String(row.memeAssetId), Number(row.activations) || 0);
  }
  return map;
}

export async function recomputeMemeAssetQualityScores(): Promise<{ scanned: number; updated: number }> {
  const config = getQualityScoreConfig();
  const now = new Date();
  const since = new Date(now.getTime() - config.windowDays * 24 * 60 * 60 * 1000);

  const activationCounts = await loadActivationCounts(since);
  const assets = await prisma.memeAsset.findMany({
    where: { deletedAt: null },
    select: { id: true, createdAt: true, qualityScore: true },
  });

  let updated = 0;
  for (const asset of assets) {
    const activations = activationCounts.get(asset.id) ?? 0;
    const nextScore = computeQualityScore({ createdAt: asset.createdAt, activations, now, config });
    const currentScore = typeof asset.qualityScore === 'number' && Number.isFinite(asset.qualityScore) ? asset.qualityScore : null;
    if (currentScore === null || Math.abs(currentScore - nextScore) >= 0.5) {
      await prisma.memeAsset.update({
        where: { id: asset.id },
        data: { qualityScore: nextScore },
      });
      updated += 1;
    }
  }

  return { scanned: assets.length, updated };
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startMemeAssetQualityScoreScheduler(): void {
  if (!isSchedulerEnabled()) {
    logger.info('quality_score.scheduler_disabled');
    return;
  }

  const intervalRaw = parseInt(String(process.env.QUALITY_SCORE_INTERVAL_MS || ''), 10);
  const initialDelayRaw = parseInt(String(process.env.QUALITY_SCORE_INITIAL_DELAY_MS || ''), 10);
  const intervalMs = clampInt(intervalRaw, 60_000, 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000);
  const initialDelayMs = clampInt(initialDelayRaw, 0, 60 * 60 * 1000, 60_000);

  let running = false;
  const lockId = 903211n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    try {
      const locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;
      const res = await recomputeMemeAssetQualityScores();
      logger.info('quality_score.recompute.completed', {
        scanned: res.scanned,
        updated: res.updated,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error ?? 'unknown');
      logger.error('quality_score.recompute.failed', { errorMessage: err, durationMs: Date.now() - startedAt });
    } finally {
      await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelayMs);
  schedulerTimer = setInterval(() => void runOnce(), intervalMs);

  logger.info('quality_score.scheduler_started', { intervalMs, initialDelayMs });
}

export function stopMemeAssetQualityScoreScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
