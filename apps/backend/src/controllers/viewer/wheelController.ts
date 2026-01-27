import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { Prisma } from '@prisma/client';

import {
  GetWheelStateParamsSchema,
  SpinWheelBodySchema,
  SpinWheelParamsSchema,
} from '@memalerts/api-contracts';

import { prisma } from '../../lib/prisma.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { WalletService } from '../../services/WalletService.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer, type WalletUpdatedEvent } from '../../realtime/walletBridge.js';
import { withRetry } from '../../utils/retryTransaction.js';
import { ECONOMY_CONSTANTS, normalizeEconomySettings } from '../../services/economy/economyService.js';
import { computeFreeSpinState, computePaidSpinCost, normalizePrizeMultiplier, pickPrize } from '../../services/wheel/wheelService.js';
import { ensureEconomyStateWithStartBonus } from '../../services/economy/economyService.js';

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
      wheelEnabled: true,
      wheelPaidSpinCostCoins: true,
      wheelPrizeMultiplier: true,
    },
  });
}

export const getWheelState = async (req: AuthRequest, res: Response) => {
  const params = GetWheelStateParamsSchema.parse(req.params ?? {});
  const slug = normalizeSlug(params.slug);
  const channel = await getChannelBySlug(slug);
  if (!channel) {
    return res.status(404).json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: 'Channel not found' });
  }

  const settings = normalizeEconomySettings(channel);
  const paidSpinCostCoins = computePaidSpinCost(settings.avgMemePriceCoins, channel.wheelPaidSpinCostCoins);
  const prizeMultiplier = normalizePrizeMultiplier(channel.wheelPrizeMultiplier);

  let freeSpinAvailable = false;
  let nextFreeSpinAt: string | null = null;
  let cooldownSecondsRemaining = 0;

  if (req.userId) {
    const state = await prisma.channelViewerEconomy.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId: req.userId } },
      select: { wheelFreeSpinLastAt: true },
    });
    const free = computeFreeSpinState(state?.wheelFreeSpinLastAt ?? null, new Date());
    freeSpinAvailable = free.freeSpinAvailable;
    nextFreeSpinAt = free.nextFreeSpinAt ? free.nextFreeSpinAt.toISOString() : null;
    cooldownSecondsRemaining = free.cooldownSecondsRemaining;
  }

  return res.json({
    enabled: channel.wheelEnabled ?? true,
    paidSpinCostCoins,
    freeSpinAvailable,
    freeSpinCooldownSeconds: cooldownSecondsRemaining,
    nextFreeSpinAt,
    prizeMultiplier,
  });
};

export const spinWheel = async (req: AuthRequest, res: Response) => {
  const params = SpinWheelParamsSchema.parse(req.params ?? {});
  const body = SpinWheelBodySchema.parse(req.body ?? {});

  const slug = normalizeSlug(params.slug);
  const channel = await getChannelBySlug(slug);
  if (!channel) {
    return res.status(404).json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: 'Channel not found' });
  }
  if (!req.userId) {
    return res.status(401).json({ errorCode: ERROR_CODES.UNAUTHORIZED, error: 'Authentication required' });
  }
  if (channel.wheelEnabled === false) {
    return res.status(409).json({ errorCode: ERROR_CODES.CONFLICT, error: 'Wheel is disabled' });
  }

  const mode = body.mode === 'free' ? 'free' : 'paid';
  const settings = normalizeEconomySettings(channel);
  const paidSpinCostCoins = computePaidSpinCost(settings.avgMemePriceCoins, channel.wheelPaidSpinCostCoins);
  const prizeMultiplier = normalizePrizeMultiplier(channel.wheelPrizeMultiplier);
  const now = new Date();

  try {
    const result = await withRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            let lockedWallet = await WalletService.getWalletForUpdate(tx, {
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
            lockedWallet = { ...lockedWallet, balance: startBonus.wallet.balance };

            const state = await tx.channelViewerEconomy.findUnique({
              where: { channelId_userId: { channelId: channel.id, userId: req.userId! } },
              select: { wheelFreeSpinLastAt: true },
            });

            const free = computeFreeSpinState(state?.wheelFreeSpinLastAt ?? null, now);
            if (mode === 'free' && !free.freeSpinAvailable) {
              throw {
                status: 409,
                errorCode: ERROR_CODES.CONFLICT,
                error: 'Free spin unavailable',
                details: {
                  nextFreeSpinAt: free.nextFreeSpinAt?.toISOString() ?? null,
                },
              };
            }

            let costCoins = 0;
            if (mode === 'paid') {
              costCoins = paidSpinCostCoins;
              if (lockedWallet.balance < costCoins) {
                throw {
                  status: 409,
                  errorCode: ERROR_CODES.INSUFFICIENT_BALANCE,
                  error: 'Insufficient balance',
                };
              }
              lockedWallet = await WalletService.decrementBalance(
                tx,
                { userId: req.userId!, channelId: channel.id },
                costCoins,
                { lockedWallet }
              );
            }

            const prize = pickPrize(settings.avgMemePriceCoins, prizeMultiplier);
            lockedWallet = await WalletService.incrementBalance(
              tx,
              { userId: req.userId!, channelId: channel.id },
              prize.coins,
              { lockedWallet }
            );

            if (mode === 'free') {
              await tx.channelViewerEconomy.update({
                where: { channelId_userId: { channelId: channel.id, userId: req.userId! } },
                data: { wheelFreeSpinLastAt: now },
              });
            }

            const spin = await tx.wheelSpin.create({
              data: {
                channelId: channel.id,
                userId: req.userId!,
                isFree: mode === 'free',
                costCoins,
                prizeTier: prize.tier,
                prizeCoins: prize.coins,
                prizeLabel: prize.label,
              },
            });

            return {
              spin,
              wallet: lockedWallet,
              costCoins,
              prize,
              startBonusCoins: startBonus.startBonusGranted ? ECONOMY_CONSTANTS.startBonusCoins : 0,
              freeSpinLastAt: mode === 'free' ? now : state?.wheelFreeSpinLastAt ?? null,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        ),
      { maxRetries: 4, baseDelayMs: 50 }
    );

    const io = req.app.get('io');
    if (result.startBonusCoins > 0) {
      const startBonusEvent: WalletUpdatedEvent = {
        userId: req.userId!,
        channelId: channel.id,
        balance: result.wallet.balance,
        delta: result.startBonusCoins,
        reason: 'start_bonus',
        channelSlug: channel.slug,
      };
      emitWalletUpdated(io, startBonusEvent);
      void relayWalletUpdatedToPeer(startBonusEvent);
    }

    const delta = result.prize.coins - result.costCoins;
    if (delta !== 0) {
      const wheelEvent: WalletUpdatedEvent = {
        userId: req.userId!,
        channelId: channel.id,
        balance: result.wallet.balance,
        delta,
        reason: 'wheel_spin',
        channelSlug: channel.slug,
      };
      emitWalletUpdated(io, wheelEvent);
      void relayWalletUpdatedToPeer(wheelEvent);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { displayName: true },
    });
    io.to(`channel:${channel.slug.toLowerCase()}`).emit('wheel:spin', {
      userId: req.userId,
      displayName: user?.displayName ?? null,
      prize: result.prize,
    });

    const freeState = computeFreeSpinState(result.freeSpinLastAt ?? null, new Date());

    return res.json({
      spin: {
        id: result.spin.id,
        channelId: channel.id,
        userId: req.userId!,
        isFree: result.spin.isFree,
        costCoins: result.costCoins,
        prize: result.prize,
        createdAt: result.spin.createdAt.toISOString(),
      },
      wallet: result.wallet,
      state: {
        enabled: channel.wheelEnabled ?? true,
        paidSpinCostCoins,
        freeSpinAvailable: freeState.freeSpinAvailable,
        freeSpinCooldownSeconds: freeState.cooldownSecondsRemaining,
        nextFreeSpinAt: freeState.nextFreeSpinAt ? freeState.nextFreeSpinAt.toISOString() : null,
        prizeMultiplier,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; errorCode?: string; error?: string; details?: unknown };
    if (err.status && err.errorCode) {
      return res.status(err.status).json({ errorCode: err.errorCode, error: err.error, details: err.details });
    }
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: 'Failed to spin wheel' });
  }
};
