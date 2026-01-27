import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retryTransaction.js';
import { WalletService } from '../../services/WalletService.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer, type WalletUpdatedEvent } from '../../realtime/walletBridge.js';
import {
  buildEconomySnapshot,
  calculateDailyBonusCoins,
  calculateWatchBonusCoins,
  computeLoginStreakCount,
  ECONOMY_CONSTANTS,
  ensureActiveStreamSession,
  ensureEconomyStateWithStartBonus,
  getLoginStreakMultiplier,
  getStreamHoursLastWeek,
  normalizeEconomySettings,
} from '../../services/economy/economyService.js';
import { getStreamStatusSnapshot } from '../../realtime/streamStatusStore.js';

function normalizeSlug(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

async function getChannelBySlug(slug: string) {
  return prisma.channel.findFirst({
    where: { slug: { equals: slug, mode: 'insensitive' } },
    select: {
      id: true,
      slug: true,
      defaultPriceCoins: true,
      economyMemesPerHour: true,
      economyRewardMultiplier: true,
      economyApprovalBonusCoins: true,
      submissionRewardCoinsUpload: true,
      submissionRewardCoins: true,
    },
  });
}

function buildBonusCooldownError(bonus: 'daily' | 'watch', nextClaimAt: Date) {
  return {
    status: 409,
    errorCode: ERROR_CODES.BONUS_COOLDOWN,
    error: 'Bonus cooldown active',
    details: {
      bonus,
      nextClaimAt: nextClaimAt.toISOString(),
      cooldownSecondsRemaining: Math.max(0, Math.ceil((nextClaimAt.getTime() - Date.now()) / 1000)),
    },
  };
}

function buildUnavailableError(bonus: 'daily' | 'watch', details?: Record<string, unknown>) {
  return {
    status: 409,
    errorCode: ERROR_CODES.BONUS_UNAVAILABLE,
    error: 'Bonus unavailable',
    details: { bonus, ...details },
  };
}

export const claimDailyBonus = async (req: AuthRequest, res: Response) => {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) {
    return res.status(400).json({ errorCode: ERROR_CODES.BAD_REQUEST, error: 'Channel slug required' });
  }

  try {
    const channel = await getChannelBySlug(slug);
    if (!channel) {
      return res.status(404).json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: 'Channel not found' });
    }

    const settings = normalizeEconomySettings(channel);
    const streamHoursLastWeek = await getStreamHoursLastWeek(prisma, channel.id);
    const baseDailyBonusCoins = calculateDailyBonusCoins(settings, streamHoursLastWeek);
    if (baseDailyBonusCoins <= 0) {
      const err = buildUnavailableError('daily', { streamHoursLastWeek });
      return res.status(err.status).json({ errorCode: err.errorCode, error: err.error, details: err.details });
    }

    const now = new Date();

    const result = await withRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            const lockedWallet = await WalletService.getWalletForUpdate(tx, {
              userId: req.userId!,
              channelId: channel.id,
            });

            const startBonus = await ensureEconomyStateWithStartBonus({
              tx,
              userId: req.userId!,
              channelId: channel.id,
              lockedWallet,
              now,
            });

            const state = await tx.channelViewerEconomy.findUnique({
              where: { channelId_userId: { channelId: channel.id, userId: req.userId! } },
              select: { dailyBonusLastClaimAt: true, loginStreakLastClaimAt: true, loginStreakCount: true },
            });

            const last = state?.dailyBonusLastClaimAt ?? null;
            if (last) {
              const next = new Date(last.getTime() + ECONOMY_CONSTANTS.dailyCooldownMs);
              if (now < next) {
                throw buildBonusCooldownError('daily', next);
              }
            }

            const nextStreakCount = computeLoginStreakCount(state?.loginStreakLastClaimAt ?? null, state?.loginStreakCount ?? 0, now);
            const streakMultiplier = getLoginStreakMultiplier(nextStreakCount);
            const dailyBonusCoins = Math.max(0, Math.round(baseDailyBonusCoins * streakMultiplier));

            await tx.channelViewerEconomy.update({
              where: { channelId_userId: { channelId: channel.id, userId: req.userId! } },
              data: {
                dailyBonusLastClaimAt: now,
                loginStreakLastClaimAt: now,
                loginStreakCount: nextStreakCount,
              },
            });

            const updatedWallet = await WalletService.incrementBalance(
              tx,
              { userId: req.userId!, channelId: channel.id },
              dailyBonusCoins,
              { lockedWallet: startBonus.wallet }
            );

            return {
              wallet: updatedWallet,
              startBonusGranted: startBonus.startBonusGranted,
              startBonusCoins: startBonus.startBonusGranted ? ECONOMY_CONSTANTS.startBonusCoins : 0,
              dailyBonusCoins,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        ),
      { maxRetries: 4, baseDelayMs: 50 }
    );

    const totalDelta = result.dailyBonusCoins + result.startBonusCoins;
    if (totalDelta > 0) {
      const io = req.app.get('io');
      const walletUpdate: WalletUpdatedEvent = {
        userId: req.userId!,
        channelId: channel.id,
        balance: result.wallet.balance,
        delta: totalDelta,
        reason: 'daily_bonus',
        channelSlug: channel.slug,
      };
      emitWalletUpdated(io, walletUpdate);
      void relayWalletUpdatedToPeer(walletUpdate);
    }

    const economy = await buildEconomySnapshot({
      channel,
      userId: req.userId,
      now,
    });

    return res.json({
      wallet: result.wallet,
      economy,
      bonusCoins: result.dailyBonusCoins,
      startBonusCoins: result.startBonusCoins,
    });
  } catch (error: unknown) {
    const err = error as { status?: number; errorCode?: string; error?: string; details?: unknown };
    if (err?.status && err.errorCode) {
      return res.status(err.status).json({ errorCode: err.errorCode, error: err.error, details: err.details });
    }
    logger.error('viewer.daily_bonus.failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
      channelSlug: slug,
      userId: req.userId,
    });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: 'Failed to claim daily bonus' });
  }
};

export const claimWatchBonus = async (req: AuthRequest, res: Response) => {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) {
    return res.status(400).json({ errorCode: ERROR_CODES.BAD_REQUEST, error: 'Channel slug required' });
  }

  try {
    const channel = await getChannelBySlug(slug);
    if (!channel) {
      return res.status(404).json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: 'Channel not found' });
    }

    const streamStatus = await getStreamStatusSnapshot(channel.slug);
    if (streamStatus.status !== 'online') {
      return res.status(409).json({
        errorCode: ERROR_CODES.BONUS_OFFLINE,
        error: 'Stream is offline',
        details: { bonus: 'watch' },
      });
    }

    const settings = normalizeEconomySettings(channel);
    const watchBonusCoins = calculateWatchBonusCoins(settings);
    if (watchBonusCoins <= 0) {
      const err = buildUnavailableError('watch');
      return res.status(err.status).json({ errorCode: err.errorCode, error: err.error, details: err.details });
    }

    const activeSession = await ensureActiveStreamSession(channel.id, 'unknown');
    if (!activeSession?.id) {
      return res.status(409).json({
        errorCode: ERROR_CODES.BONUS_UNAVAILABLE,
        error: 'Stream session unavailable',
        details: { bonus: 'watch' },
      });
    }

    const now = new Date();

    const result = await withRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            const lockedWallet = await WalletService.getWalletForUpdate(tx, {
              userId: req.userId!,
              channelId: channel.id,
            });

            const startBonus = await ensureEconomyStateWithStartBonus({
              tx,
              userId: req.userId!,
              channelId: channel.id,
              lockedWallet,
              now,
            });

            const state = await tx.channelViewerEconomy.findUnique({
              where: { channelId_userId: { channelId: channel.id, userId: req.userId! } },
              select: {
                watchBonusLastClaimAt: true,
                watchBonusClaimCount: true,
                watchBonusSessionId: true,
              },
            });

            const last = state?.watchBonusLastClaimAt ?? null;
            if (last) {
              const next = new Date(last.getTime() + ECONOMY_CONSTANTS.watchCooldownMs);
              if (now < next) {
                throw buildBonusCooldownError('watch', next);
              }
            }

            const claimsThisStream =
              state?.watchBonusSessionId === activeSession.id ? Math.max(0, state.watchBonusClaimCount ?? 0) : 0;

            if (claimsThisStream >= ECONOMY_CONSTANTS.maxWatchClaimsPerStream) {
              throw {
                status: 409,
                errorCode: ERROR_CODES.BONUS_LIMIT_REACHED,
                error: 'Watch bonus limit reached',
                details: {
                  bonus: 'watch',
                  claimsThisStream,
                  maxClaimsPerStream: ECONOMY_CONSTANTS.maxWatchClaimsPerStream,
                },
              };
            }

            await tx.channelViewerEconomy.update({
              where: { channelId_userId: { channelId: channel.id, userId: req.userId! } },
              data: {
                watchBonusLastClaimAt: now,
                watchBonusSessionId: activeSession.id,
                watchBonusClaimCount: claimsThisStream + 1,
              },
            });

            const updatedWallet = await WalletService.incrementBalance(
              tx,
              { userId: req.userId!, channelId: channel.id },
              watchBonusCoins,
              { lockedWallet: startBonus.wallet }
            );

            return {
              wallet: updatedWallet,
              startBonusGranted: startBonus.startBonusGranted,
              startBonusCoins: startBonus.startBonusGranted ? ECONOMY_CONSTANTS.startBonusCoins : 0,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        ),
      { maxRetries: 4, baseDelayMs: 50 }
    );

    const totalDelta = watchBonusCoins + result.startBonusCoins;
    if (totalDelta > 0) {
      const io = req.app.get('io');
      const walletUpdate: WalletUpdatedEvent = {
        userId: req.userId!,
        channelId: channel.id,
        balance: result.wallet.balance,
        delta: totalDelta,
        reason: 'watch_bonus',
        channelSlug: channel.slug,
      };
      emitWalletUpdated(io, walletUpdate);
      void relayWalletUpdatedToPeer(walletUpdate);
    }

    const economy = await buildEconomySnapshot({
      channel,
      userId: req.userId,
      now,
    });

    return res.json({
      wallet: result.wallet,
      economy,
      bonusCoins: watchBonusCoins,
      startBonusCoins: result.startBonusCoins,
    });
  } catch (error: unknown) {
    const err = error as { status?: number; errorCode?: string; error?: string; details?: unknown };
    if (err?.status && err.errorCode) {
      return res.status(err.status).json({ errorCode: err.errorCode, error: err.error, details: err.details });
    }
    logger.error('viewer.watch_bonus.failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
      channelSlug: slug,
      userId: req.userId,
    });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: 'Failed to claim watch bonus' });
  }
};
