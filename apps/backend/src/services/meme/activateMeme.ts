import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { activateMemeSchema } from '../../shared/schemas.js';
import { getActivePromotion, calculatePriceWithDiscount } from '../../utils/promotions.js';
import { WalletService } from '../WalletService.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer, type WalletUpdatedEvent } from '../../realtime/walletBridge.js';

type PoolChannelRow = {
  id: string;
  slug: string;
  memeCatalogMode: string | null;
  defaultPriceCoins: number | null;
};

type PoolAssetRow = {
  id: string;
  type: string;
  fileUrl: string | null;
  fileHash: string | null;
  durationMs: number | null;
  aiAutoTitle: string | null;
};

type PoolExistingChannelMemeRow = {
  id: string;
  status: string;
  deletedAt: Date | null;
  priceCoins: number | null;
  title: string | null;
  legacyMemeId: string | null;
};

type ChannelSlugContext = {
  id: string;
  slug: string;
};

type ResolvedChannelMemePointer = {
  id: string;
  legacyMemeId: string | null;
};

const DEFAULT_POOL_PRICE = 100;

const normalizeDefaultPrice = (value: number | null | undefined): number =>
  Number.isFinite(value ?? NaN) ? (value as number) : DEFAULT_POOL_PRICE;

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

    const legacyMeme = !channelMeme
      ? await prisma.meme.findUnique({
          where: { id: parsed.memeId },
          include: { channel: true },
        })
      : null;

    const poolChannel: PoolChannelRow | null =
      !channelMeme && !legacyMeme && (channelIdFromQuery || channelSlugFromQuery)
        ? await prisma.channel.findFirst({
            where: channelIdFromQuery
              ? { id: channelIdFromQuery }
              : { slug: { equals: channelSlugFromQuery, mode: 'insensitive' } },
            select: { id: true, slug: true, memeCatalogMode: true, defaultPriceCoins: true },
          })
        : null;

    const poolAsset: PoolAssetRow | null =
      !channelMeme && !legacyMeme && poolChannel
        ? await prisma.memeAsset.findFirst({
            where: { id: parsed.memeId, poolVisibility: 'visible', purgedAt: null },
            select: { id: true, type: true, fileUrl: true, fileHash: true, durationMs: true, aiAutoTitle: true },
          })
        : null;

    const poolExistingChannelMeme: PoolExistingChannelMemeRow | null =
      !channelMeme && !legacyMeme && poolChannel && poolAsset
        ? await prisma.channelMeme.findUnique({
            where: { channelId_memeAssetId: { channelId: poolChannel.id, memeAssetId: poolAsset.id } },
            select: { id: true, status: true, deletedAt: true, priceCoins: true, title: true, legacyMemeId: true },
          })
        : null;

    if (!channelMeme && !legacyMeme && poolChannel && poolAsset) {
      const mode = String(poolChannel.memeCatalogMode ?? 'channel');
      if (mode !== 'pool_all') throw new Error('Meme is not available');
    }

    if (!channelMeme && !legacyMeme && !(poolChannel && poolAsset)) throw new Error('Meme not found');

    const channelId = channelMeme?.channelId ?? legacyMeme?.channelId ?? poolChannel?.id;
    const channel = (channelMeme?.channel ?? legacyMeme?.channel ?? poolChannel) as ChannelSlugContext | null;
    if (!channelId || !channel?.slug) {
      throw new Error('Meme is not available');
    }
    const effectiveLegacyMemeId = channelMeme?.legacyMemeId ?? legacyMeme?.id ?? null;

    if (channelMeme) {
      if (channelMeme.status !== 'approved' || channelMeme.deletedAt) throw new Error('Meme is not approved');
      if (!effectiveLegacyMemeId) {
        throw new Error('Meme is not available');
      }
    } else {
      if (legacyMeme) {
        if (legacyMeme.status !== 'approved' || legacyMeme.deletedAt) throw new Error('Meme is not approved');
      }
    }

    const promotion = await getActivePromotion(channelId);
    const originalPrice = (() => {
      if (channelMeme) return channelMeme.priceCoins;
      if (legacyMeme) return legacyMeme.priceCoins;
      if (
        poolExistingChannelMeme &&
        poolExistingChannelMeme.status === 'approved' &&
        !poolExistingChannelMeme.deletedAt
      )
        return Number.isFinite(poolExistingChannelMeme.priceCoins)
          ? (poolExistingChannelMeme.priceCoins as number)
          : normalizeDefaultPrice(poolChannel?.defaultPriceCoins);
      return normalizeDefaultPrice(poolChannel?.defaultPriceCoins);
    })();
    const finalPrice = promotion ? calculatePriceWithDiscount(originalPrice, promotion.discountPercent) : originalPrice;

    const result = await prisma.$transaction(
      async (tx) => {
        let resolvedChannelMeme: ResolvedChannelMemePointer | null = channelMeme
          ? { id: channelMeme.id, legacyMemeId: channelMeme.legacyMemeId ?? null }
          : null;
        let resolvedLegacyMemeId: string | null = effectiveLegacyMemeId;

        if (!resolvedChannelMeme && !legacyMeme && poolChannel && poolAsset) {
          const existing = await tx.channelMeme.findUnique({
            where: { channelId_memeAssetId: { channelId: poolChannel.id, memeAssetId: poolAsset.id } },
            select: { id: true, status: true, deletedAt: true, legacyMemeId: true, title: true, priceCoins: true },
          });

          if (existing) {
            if (existing.status !== 'approved' || existing.deletedAt) throw new Error('Meme is not available');
            resolvedChannelMeme = existing;
            resolvedLegacyMemeId = existing.legacyMemeId ?? null;
          }

          if (!resolvedChannelMeme || !resolvedLegacyMemeId) {
            const hasHash = poolAsset.fileHash
              ? await tx.fileHash.findUnique({ where: { hash: poolAsset.fileHash }, select: { hash: true } })
              : null;

            const title = String(poolAsset.aiAutoTitle || 'Meme').slice(0, 80);
            const priceCoins = normalizeDefaultPrice(poolChannel?.defaultPriceCoins);

            const poolAssetDurationMs = Number.isFinite(poolAsset.durationMs ?? NaN)
              ? (poolAsset.durationMs as number)
              : 0;
            const legacy = await tx.meme.create({
              data: {
                channelId: poolChannel.id,
                title,
                type: poolAsset.type,
                fileUrl: String(poolAsset.fileUrl || ''),
                fileHash: hasHash ? poolAsset.fileHash : null,
                durationMs: poolAssetDurationMs,
                priceCoins,
                status: 'approved',
                createdByUserId: null,
                approvedByUserId: null,
              },
              select: { id: true },
            });

            const cm = await tx.channelMeme.upsert({
              where: { channelId_memeAssetId: { channelId: poolChannel.id, memeAssetId: poolAsset.id } },
              create: {
                channelId: poolChannel.id,
                memeAssetId: poolAsset.id,
                legacyMemeId: legacy.id,
                status: 'approved',
                title,
                priceCoins,
                addedByUserId: null,
                approvedByUserId: null,
                approvedAt: new Date(),
              },
              update: {
                legacyMemeId: legacy.id,
                status: 'approved',
                deletedAt: null,
              },
              select: { id: true, legacyMemeId: true },
            });

            resolvedChannelMeme = { id: cm.id, legacyMemeId: cm.legacyMemeId ?? legacy.id };
            resolvedLegacyMemeId = cm.legacyMemeId ?? legacy.id;
          }
        }

        if (!resolvedLegacyMemeId) throw new Error('Meme is not available');

        const wallet = await WalletService.getWalletForUpdate(tx, {
          userId: req.userId!,
          channelId,
        });

        const isChannelOwner = req.channelId === channelId;

        let updatedWallet = wallet;
        let coinsSpent = 0;

        if (!isChannelOwner) {
          if (wallet.balance < finalPrice) {
            throw new Error('Insufficient balance');
          }

          updatedWallet = await WalletService.decrementBalance(tx, { userId: req.userId!, channelId }, finalPrice, {
            lockedWallet: wallet,
          });
          coinsSpent = finalPrice;
        }

        const activation = await tx.memeActivation.create({
          data: {
            channelId,
            userId: req.userId!,
            memeId: resolvedLegacyMemeId!,
            ...(resolvedChannelMeme ? { channelMemeId: resolvedChannelMeme.id } : {}),
            coinsSpent,
            status: 'queued',
          },
        });

        const sender = await tx.user.findUnique({
          where: { id: req.userId! },
          select: { displayName: true },
        });

        return {
          activation,
          wallet: updatedWallet,
          senderDisplayName: sender?.displayName ?? null,
          resolvedChannelMemeId: resolvedChannelMeme?.id ?? null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    const channelSlug = String(channel.slug || '').toLowerCase();
    const overlayType = channelMeme ? channelMeme.memeAsset.type : legacyMeme ? legacyMeme.type : poolAsset!.type;
    const overlayFileUrl = channelMeme
      ? channelMeme.memeAsset.fileUrl
      : legacyMeme
        ? legacyMeme.fileUrl
        : String(poolAsset!.fileUrl || '');
    const overlayDurationMs = channelMeme
      ? channelMeme.memeAsset.durationMs
      : legacyMeme
        ? legacyMeme.durationMs
        : (poolAsset!.durationMs ?? 0);
    const overlayTitle = channelMeme
      ? channelMeme.title
      : legacyMeme
        ? legacyMeme.title
        : String(poolExistingChannelMeme?.title || poolAsset!.aiAutoTitle || 'Meme').slice(0, 80);
    io.to(`channel:${channelSlug}`).emit('activation:new', {
      id: result.activation.id,
      memeId: result.activation.memeId,
      type: overlayType,
      fileUrl: overlayFileUrl,
      durationMs: overlayDurationMs,
      title: overlayTitle,
      senderDisplayName: result.senderDisplayName,
    });

    if (result.activation.coinsSpent && result.activation.coinsSpent > 0) {
      const walletUpdateData: WalletUpdatedEvent = {
        userId: result.activation.userId,
        channelId: result.activation.channelId,
        balance: result.wallet.balance,
        delta: -result.activation.coinsSpent,
        reason: 'meme_activation',
        channelSlug: channel.slug,
      };
      emitWalletUpdated(io, walletUpdateData);
      void relayWalletUpdatedToPeer(walletUpdateData);
    }

    res.json({
      activation: result.activation,
      wallet: result.wallet,
      originalPrice,
      finalPrice,
      discountApplied: promotion ? promotion.discountPercent : 0,
      isFree: req.channelId === channelId,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage === 'Wallet not found' || errorMessage === 'Meme not found') {
      return res.status(404).json({ error: errorMessage });
    }
    if (
      errorMessage === 'Insufficient balance' ||
      errorMessage === 'Meme is not approved' ||
      errorMessage === 'Meme is not available'
    ) {
      return res.status(400).json({ error: errorMessage });
    }
    throw error;
  }
};
