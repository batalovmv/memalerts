import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { prisma } from '../../lib/prisma.js';
import { activateMemeSchema } from '../../shared/index.js';
import { getActivePromotion, calculatePriceWithDiscount } from '../../utils/promotions.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../../realtime/walletBridge.js';

export const activateMeme = async (req: AuthRequest, res: Response) => {
  const { id: memeId } = req.params;
  const io: Server = req.app.get('io');

  try {
    const parsed = activateMemeSchema.parse({ memeId });
    const channelIdFromQuery = req.query?.channelId ? String(req.query.channelId).trim() : '';
    const channelSlugFromQuery = req.query?.channelSlug ? String(req.query.channelSlug).trim() : '';

    // Back-compat + migration:
    // - Prefer ChannelMeme.id (new world)
    // - Fallback to legacy Meme.id (old world)
    const channelMeme = await prisma.channelMeme.findUnique({
      where: { id: parsed.memeId },
      include: {
        channel: true,
        memeAsset: true,
      },
    });

    const legacyMeme =
      !channelMeme
        ? await prisma.meme.findUnique({
            where: { id: parsed.memeId },
            include: { channel: true },
          })
        : null;

    // Pool mode (MemeAsset.id + channelSlug/channelId): resolve context and materialize ChannelMeme+legacy Meme on demand.
    const poolChannel =
      !channelMeme && !legacyMeme && (channelIdFromQuery || channelSlugFromQuery)
        ? await prisma.channel.findFirst({
            where: channelIdFromQuery
              ? { id: channelIdFromQuery }
              : { slug: { equals: channelSlugFromQuery, mode: 'insensitive' } },
            select: { id: true, slug: true, memeCatalogMode: true, defaultPriceCoins: true },
          })
        : null;

    const poolAsset =
      !channelMeme && !legacyMeme && poolChannel
        ? await prisma.memeAsset.findFirst({
            where: { id: parsed.memeId, poolVisibility: 'visible', purgedAt: null },
            select: { id: true, type: true, fileUrl: true, fileHash: true, durationMs: true, aiAutoTitle: true },
          })
        : null;

    const poolExistingChannelMeme =
      !channelMeme && !legacyMeme && poolChannel && poolAsset
        ? await prisma.channelMeme.findUnique({
            where: { channelId_memeAssetId: { channelId: poolChannel.id, memeAssetId: poolAsset.id } },
            select: { id: true, status: true, deletedAt: true, priceCoins: true, title: true },
          })
        : null;

    if (!channelMeme && !legacyMeme && poolChannel && poolAsset) {
      const mode = String((poolChannel as any).memeCatalogMode || 'channel');
      if (mode !== 'pool_all') throw new Error('Meme is not available');
    }

    if (!channelMeme && !legacyMeme && !(poolChannel && poolAsset)) throw new Error('Meme not found');

    // Normalize into a single activation context
    const channelId = channelMeme?.channelId ?? legacyMeme?.channelId ?? poolChannel!.id;
    const channel = channelMeme?.channel ?? legacyMeme?.channel ?? (poolChannel as any);
    const effectiveLegacyMemeId = channelMeme?.legacyMemeId ?? legacyMeme?.id ?? null;

    if (channelMeme) {
      if (channelMeme.status !== 'approved' || channelMeme.deletedAt) throw new Error('Meme is not approved');
      if (!effectiveLegacyMemeId) {
        // During migration, activations still require legacy Meme.id for rollups and existing overlay behavior.
        throw new Error('Meme is not available');
      }
    } else {
      if (legacyMeme) {
        if (legacyMeme.status !== 'approved' || legacyMeme.deletedAt) throw new Error('Meme is not approved');
      }
    }

    // Promotion lookup (outside transaction): best-effort cache exists in utils/promotions.ts.
    const promotion = await getActivePromotion(channelId);
    const originalPrice = (() => {
      if (channelMeme) return channelMeme.priceCoins;
      if (legacyMeme) return legacyMeme.priceCoins;
      if (poolExistingChannelMeme && poolExistingChannelMeme.status === 'approved' && !poolExistingChannelMeme.deletedAt) return poolExistingChannelMeme.priceCoins;
      const v = Number.isFinite((poolChannel as any)?.defaultPriceCoins) ? (poolChannel as any).defaultPriceCoins : 100;
      return v;
    })();
    const finalPrice = promotion ? calculatePriceWithDiscount(originalPrice, promotion.discountPercent) : originalPrice;

    // Get user wallet + create activation in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Pool mode materialization (best-effort): ensure ChannelMeme + legacy Meme exist for this channel+asset.
      let resolvedChannelMeme: any | null = channelMeme;
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

        // If missing, create legacy Meme and/or ChannelMeme
        if (!resolvedChannelMeme || !resolvedLegacyMemeId) {
          const hasHash =
            poolAsset.fileHash
              ? await tx.fileHash.findUnique({ where: { hash: poolAsset.fileHash }, select: { hash: true } })
              : null;

          const title = String(poolAsset.aiAutoTitle || 'Meme').slice(0, 80);
          const priceCoins = Number.isFinite((poolChannel as any).defaultPriceCoins) ? (poolChannel as any).defaultPriceCoins : 100;

          const legacy = await tx.meme.create({
            data: {
              channelId: poolChannel.id,
              title,
              type: poolAsset.type,
              fileUrl: String(poolAsset.fileUrl || ''),
              fileHash: hasHash ? poolAsset.fileHash : null,
              durationMs: poolAsset.durationMs,
              priceCoins,
              status: 'approved',
              createdByUserId: null,
              approvedByUserId: null,
            } as any,
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
            } as any,
            update: {
              legacyMemeId: legacy.id,
              status: 'approved',
              deletedAt: null,
            } as any,
            select: { id: true, legacyMemeId: true },
          });

          resolvedChannelMeme = { id: cm.id };
          resolvedLegacyMemeId = cm.legacyMemeId ?? legacy.id;
        }
      }

      if (!resolvedLegacyMemeId) throw new Error('Meme is not available');

      // Find or create wallet for this user and channel
      let wallet = await tx.wallet.findUnique({
        where: {
          userId_channelId: {
            userId: req.userId!,
            channelId,
          },
        },
      });

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId: req.userId!,
            channelId,
            balance: 0,
          },
        });
      }

      // Channel owner gets free activation.
      const isChannelOwner = req.channelId === channelId;

      let updatedWallet = wallet;
      let coinsSpent = 0;

      if (!isChannelOwner) {
        if (wallet.balance < finalPrice) {
          throw new Error('Insufficient balance');
        }

        updatedWallet = await tx.wallet.update({
          where: {
            userId_channelId: {
              userId: req.userId!,
              channelId,
            },
          },
          data: {
            balance: {
              decrement: finalPrice,
            },
          },
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

      return { activation, wallet: updatedWallet, senderDisplayName: sender?.displayName ?? null, resolvedChannelMemeId: resolvedChannelMeme?.id ?? null };
    });

    // Emit to overlay.
    // IMPORTANT: Always emit to a normalized room name to avoid case mismatches
    // between stored slugs, older clients, and token-based overlay joins.
    const channelSlug = String(channel.slug || '').toLowerCase();
    const overlayType = channelMeme ? channelMeme.memeAsset.type : legacyMeme ? legacyMeme.type : poolAsset!.type;
    const overlayFileUrl = channelMeme ? channelMeme.memeAsset.fileUrl : legacyMeme ? legacyMeme.fileUrl : poolAsset!.fileUrl;
    const overlayDurationMs = channelMeme ? channelMeme.memeAsset.durationMs : legacyMeme ? legacyMeme.durationMs : poolAsset!.durationMs;
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

    // Publish wallet update so other instances (beta/prod) can emit it to connected clients.
    // Also emit locally for immediate feedback to current instance.
    if (result.activation.coinsSpent && result.activation.coinsSpent > 0) {
      const walletUpdateData = {
        userId: result.activation.userId,
        channelId: result.activation.channelId,
        balance: result.wallet.balance,
        delta: -result.activation.coinsSpent,
        reason: 'meme_activation',
        channelSlug: channel.slug,
      };
      emitWalletUpdated(io, walletUpdateData as any);
      void relayWalletUpdatedToPeer(walletUpdateData as any);
    }

    res.json({
      activation: result.activation,
      wallet: result.wallet,
      originalPrice,
      finalPrice,
      discountApplied: promotion ? promotion.discountPercent : 0,
      isFree: req.channelId === channelId, // Indicate if activation was free for channel owner
    });
  } catch (error: any) {
    if (error.message === 'Wallet not found' || error.message === 'Meme not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Insufficient balance' || error.message === 'Meme is not approved' || error.message === 'Meme is not available') {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
};


