import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { activateMemeSchema } from '../../shared/schemas.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { getActivePromotion, calculatePriceWithDiscount } from '../../utils/promotions.js';
import { WalletService } from '../WalletService.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer, type WalletUpdatedEvent } from '../../realtime/walletBridge.js';
import { logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retryTransaction.js';
import { TasteProfileService } from '../taste/TasteProfileService.js';
import { computeDynamicPricing, loadDynamicPricingSnapshot, normalizeDynamicPricingSettings } from './dynamicPricing.js';

type PoolChannelRow = {
  id: string;
  slug: string;
  memeCatalogMode: string | null;
  defaultPriceCoins: number | null;
  dynamicPricingEnabled?: boolean | null;
  dynamicPricingMinMult?: number | null;
  dynamicPricingMaxMult?: number | null;
};

type PoolAssetRow = {
  id: string;
  type: string;
  fileUrl: string | null;
  durationMs: number | null;
  aiAutoTitle: string | null;
};

type ChannelMemeRow = {
  id: string;
  title: string;
  priceCoins: number;
  status: string;
  deletedAt: Date | null;
  cooldownMinutes: number | null;
  lastActivatedAt: Date | null;
};

type ChannelSlugContext = {
  id: string;
  slug: string;
};

const DEFAULT_POOL_PRICE = 100;

const normalizeDefaultPrice = (value: number | null | undefined): number =>
  Number.isFinite(value ?? NaN) ? (value as number) : DEFAULT_POOL_PRICE;

const getCooldownState = (
  cooldownMinutes?: number | null,
  lastActivatedAt?: Date | null,
  now: Date = new Date()
): { cooldownMinutes: number; cooldownSecondsRemaining: number; cooldownUntil: Date } | null => {
  const minutes =
    typeof cooldownMinutes === 'number' && Number.isFinite(cooldownMinutes)
      ? Math.max(0, Math.floor(cooldownMinutes))
      : 0;
  if (!minutes || !lastActivatedAt) return null;
  const cooldownUntil = new Date(lastActivatedAt.getTime() + minutes * 60_000);
  if (cooldownUntil <= now) return null;
  const cooldownSecondsRemaining = Math.max(0, Math.ceil((cooldownUntil.getTime() - now.getTime()) / 1000));
  return { cooldownMinutes: minutes, cooldownSecondsRemaining, cooldownUntil };
};

export const activateMeme = async (req: AuthRequest, res: Response) => {
  const { id: memeId } = req.params;
  const io: Server = req.app.get('io');

  try {
    const parsed = activateMemeSchema.parse({ memeId });
    const channelIdFromQuery = req.query?.channelId ? String(req.query.channelId).trim() : '';
    const channelSlugFromQuery = req.query?.channelSlug ? String(req.query.channelSlug).trim() : '';

    const channelMeme = await prisma.channelMeme.findUnique({
      where: { id: parsed.memeId },
      include: {
        channel: true,
        memeAsset: true,
      },
    });

    let poolChannel: PoolChannelRow | null = null;
    let poolAsset: PoolAssetRow | null = null;

    if (!channelMeme && (channelIdFromQuery || channelSlugFromQuery)) {
      poolChannel = await prisma.channel.findFirst({
        where: channelIdFromQuery
          ? { id: channelIdFromQuery }
          : { slug: { equals: channelSlugFromQuery, mode: 'insensitive' } },
        select: {
          id: true,
          slug: true,
          memeCatalogMode: true,
          defaultPriceCoins: true,
          dynamicPricingEnabled: true,
          dynamicPricingMinMult: true,
          dynamicPricingMaxMult: true,
        },
      });
      if (poolChannel && String(poolChannel.memeCatalogMode ?? 'channel') === 'pool_all') {
        poolAsset = await prisma.memeAsset.findFirst({
          where: { id: parsed.memeId, status: 'active', deletedAt: null, fileUrl: { not: '' } },
          select: { id: true, type: true, fileUrl: true, durationMs: true, aiAutoTitle: true },
        });
      }
    }

    if (!channelMeme && poolChannel && String(poolChannel.memeCatalogMode ?? 'channel') !== 'pool_all') {
      throw new Error('Meme is not available');
    }

    if (!channelMeme && !(poolChannel && poolAsset)) throw new Error('Meme not found');

    const channelId = channelMeme?.channelId ?? poolChannel?.id;
    const channel = (channelMeme?.channel ?? poolChannel) as ChannelSlugContext | null;
    if (!channelId || !channel?.slug) {
      throw new Error('Meme is not available');
    }

    if (channelMeme) {
      if (channelMeme.status !== 'approved' || channelMeme.deletedAt) throw new Error('Meme is not approved');
    }

    const promotion = await getActivePromotion(channelId);

    const result = await withRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
        let resolvedChannelMeme: ChannelMemeRow | null = channelMeme
          ? {
              id: channelMeme.id,
              title: channelMeme.title,
              priceCoins: channelMeme.priceCoins,
              status: channelMeme.status,
              deletedAt: channelMeme.deletedAt,
              cooldownMinutes: channelMeme.cooldownMinutes ?? null,
              lastActivatedAt: channelMeme.lastActivatedAt ?? null,
            }
          : null;

        if (!resolvedChannelMeme && poolChannel && poolAsset) {
          const existing = await tx.channelMeme.findUnique({
            where: { channelId_memeAssetId: { channelId: poolChannel.id, memeAssetId: poolAsset.id } },
            select: {
              id: true,
              title: true,
              priceCoins: true,
              status: true,
              deletedAt: true,
              cooldownMinutes: true,
              lastActivatedAt: true,
            },
          });

          if (existing) {
            if (existing.status !== 'approved' || existing.deletedAt) throw new Error('Meme is not available');
            resolvedChannelMeme = existing;
          } else {
            const title = String(poolAsset.aiAutoTitle || 'Meme').slice(0, 80);
            const priceCoins = normalizeDefaultPrice(poolChannel.defaultPriceCoins);
            resolvedChannelMeme = await tx.channelMeme.create({
              data: {
                channelId: poolChannel.id,
                memeAssetId: poolAsset.id,
                status: 'approved',
                title,
                priceCoins,
              },
              select: {
                id: true,
                title: true,
                priceCoins: true,
                status: true,
                deletedAt: true,
                cooldownMinutes: true,
                lastActivatedAt: true,
              },
            });
          }
        }

        if (!resolvedChannelMeme) throw new Error('Meme is not available');

        const now = new Date();
        const cooldownState = getCooldownState(
          resolvedChannelMeme.cooldownMinutes ?? null,
          resolvedChannelMeme.lastActivatedAt ?? null,
          now
        );
        if (cooldownState) {
          const err = new Error('Cooldown active');
          (err as { errorCode?: string }).errorCode = ERROR_CODES.MEME_COOLDOWN_ACTIVE;
          (err as { details?: unknown }).details = {
            cooldownMinutes: cooldownState.cooldownMinutes,
            cooldownSecondsRemaining: cooldownState.cooldownSecondsRemaining,
            cooldownUntil: cooldownState.cooldownUntil.toISOString(),
          };
          throw err;
        }

        const basePrice = resolvedChannelMeme.priceCoins;
        const pricingSettings = normalizeDynamicPricingSettings(channelMeme?.channel ?? poolChannel ?? null);
        let priceBeforeDiscount = basePrice;
        if (pricingSettings.enabled) {
          const snapshot = await loadDynamicPricingSnapshot({
            channelId,
            channelMemeIds: [resolvedChannelMeme.id],
            settings: pricingSettings,
            now,
            db: tx,
          });
          if (snapshot) {
            const recent = snapshot.counts.get(resolvedChannelMeme.id) ?? 0;
            const dynamic = computeDynamicPricing({
              basePriceCoins: basePrice,
              recent,
              avgRecent: snapshot.avgRecent,
              settings: pricingSettings,
            });
            priceBeforeDiscount = dynamic.dynamicPriceCoins;
          }
        }

        const finalPrice = promotion
          ? calculatePriceWithDiscount(priceBeforeDiscount, promotion.discountPercent)
          : priceBeforeDiscount;

        const wallet = await WalletService.getWalletForUpdate(tx, {
          userId: req.userId!,
          channelId,
        });

        const isChannelOwner = req.channelId === channelId;
        const coinsSpent = isChannelOwner ? 0 : finalPrice;

        let updatedWallet = wallet;
        if (!isChannelOwner) {
          if (wallet.balance < finalPrice) {
            throw new Error('Insufficient balance');
          }

          updatedWallet = await WalletService.decrementBalance(tx, { userId: req.userId!, channelId }, finalPrice, {
            lockedWallet: wallet,
          });
        }

        const activation = await tx.memeActivation.create({
          data: {
            channelId,
            channelMemeId: resolvedChannelMeme.id,
            userId: req.userId!,
            priceCoins: coinsSpent,
            volume: 1,
            status: 'queued',
          },
        });

        await tx.channelMeme.update({
          where: { id: resolvedChannelMeme.id },
          data: { lastActivatedAt: now },
        });

        const sender = await tx.user.findUnique({
          where: { id: req.userId! },
          select: { displayName: true },
        });

        return {
          activation,
          wallet: updatedWallet,
          senderDisplayName: sender?.displayName ?? null,
          originalPrice: priceBeforeDiscount,
          finalPrice,
          coinsSpent,
        };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        ),
      { maxRetries: 5, baseDelayMs: 50 }
    );

    const channelSlug = String(channel.slug || '').toLowerCase();
    const overlayRow = await prisma.channelMeme.findUnique({
      where: { id: result.activation.channelMemeId },
      select: {
        id: true,
        title: true,
        memeAsset: {
          select: {
            type: true,
            fileUrl: true,
            durationMs: true,
          },
        },
      },
    });

    const overlayType = overlayRow?.memeAsset?.type ?? channelMeme?.memeAsset.type ?? poolAsset?.type ?? 'video';
    const overlayFileUrl =
      overlayRow?.memeAsset?.fileUrl ?? channelMeme?.memeAsset.fileUrl ?? String(poolAsset?.fileUrl || '');
    const overlayDurationMs =
      overlayRow?.memeAsset?.durationMs ?? channelMeme?.memeAsset.durationMs ?? (poolAsset?.durationMs ?? 0);
    const overlayTitle = overlayRow?.title ?? channelMeme?.title ?? String(poolAsset?.aiAutoTitle || 'Meme').slice(0, 80);

    io.to(`channel:${channelSlug}`).emit('activation:new', {
      id: result.activation.id,
      memeId: result.activation.channelMemeId,
      type: overlayType,
      fileUrl: overlayFileUrl,
      durationMs: overlayDurationMs,
      title: overlayTitle,
      senderDisplayName: result.senderDisplayName,
    });

    if (result.coinsSpent && result.coinsSpent > 0) {
      const walletUpdateData: WalletUpdatedEvent = {
        userId: result.activation.userId,
        channelId: result.activation.channelId,
        balance: result.wallet.balance,
        delta: -result.coinsSpent,
        reason: 'meme_activation',
        channelSlug: channel.slug,
      };
      emitWalletUpdated(io, walletUpdateData);
      void relayWalletUpdatedToPeer(walletUpdateData);
    }

    void TasteProfileService.recordActivation({
      userId: req.userId!,
      channelMemeId: result.activation.channelMemeId,
    }).catch((error) => {
      const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown');
      logger.warn('taste_profile.record_failed', {
        userId: req.userId,
        channelMemeId: result.activation.channelMemeId,
        error: errMsg,
      });
    });

    res.json({
      activation: result.activation,
      wallet: result.wallet,
      originalPrice: result.originalPrice,
      finalPrice: result.finalPrice,
      discountApplied: promotion ? promotion.discountPercent : 0,
      isFree: req.channelId === channelId,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode =
      typeof (error as { errorCode?: unknown })?.errorCode === 'string'
        ? String((error as { errorCode?: unknown }).errorCode)
        : null;
    const details = (error as { details?: unknown })?.details;
    if (errorCode === ERROR_CODES.MEME_COOLDOWN_ACTIVE) {
      return res.status(400).json({
        errorCode,
        error: 'Meme cooldown active',
        details,
      });
    }
    if (errorMessage === 'Wallet not found' || errorMessage === 'Meme not found') {
      return res.status(404).json({ error: errorMessage });
    }
    if (errorMessage === 'Insufficient balance' || errorMessage === 'Meme is not approved' || errorMessage === 'Meme is not available') {
      return res.status(400).json({ error: errorMessage });
    }
    throw error;
  }
};

