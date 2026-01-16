import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { WalletService } from '../../services/WalletService.js';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Admin wallet management
export const getWalletOptions = async (req: AuthRequest, res: Response) => {
  // Only admins can access this
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Lightweight endpoint used by UI to build dropdowns without downloading every wallet row.
  const userRows = await prisma.wallet.findMany({
    distinct: ['userId'],
    select: { userId: true },
  });
  const channelRows = await prisma.wallet.findMany({
    distinct: ['channelId'],
    select: { channelId: true },
  });

  const userIds = userRows.map((r) => r.userId).filter(Boolean);
  const channelIds = channelRows.map((r) => r.channelId).filter(Boolean);

  const [users, channels] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true, twitchUserId: true },
          orderBy: { displayName: 'asc' },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string | null; twitchUserId: string | null }>),
    channelIds.length
      ? prisma.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, name: true, slug: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([] as Array<{ id: string; name: string | null; slug: string | null }>),
  ]);

  return res.json({ users, channels });
};

export const getAllWallets = async (req: AuthRequest, res: Response) => {
  // Only admins can access this
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const channelId = typeof req.query.channelId === 'string' ? req.query.channelId.trim() : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const includeTotalRaw = typeof req.query.includeTotal === 'string' ? req.query.includeTotal : undefined;
  const includeTotal =
    includeTotalRaw !== undefined &&
    (includeTotalRaw === '1' || includeTotalRaw.toLowerCase() === 'true' || includeTotalRaw.toLowerCase() === 'yes');

  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
  const offsetRaw = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : undefined;
  const maxFromEnv = parseInt(String(process.env.ADMIN_WALLETS_PAGE_MAX || ''), 10);
  const MAX_PAGE = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 200;
  const limit =
    Number.isFinite(limitRaw as number) && (limitRaw as number) > 0
      ? Math.min(limitRaw as number, MAX_PAGE)
      : undefined;
  const offset = Number.isFinite(offsetRaw as number) && (offsetRaw as number) >= 0 ? (offsetRaw as number) : undefined;

  const where: Record<string, unknown> = {};
  if (userId) where.userId = userId;
  if (channelId) where.channelId = channelId;
  if (q) {
    where.OR = [
      { user: { displayName: { contains: q, mode: 'insensitive' } } },
      { user: { twitchUserId: { contains: q } } },
      { channel: { name: { contains: q, mode: 'insensitive' } } },
      { channel: { slug: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const wantsPaging = limit !== undefined || offset !== undefined || !!userId || !!channelId || !!q;

  const query = prisma.wallet.findMany({
    where: Object.keys(where).length ? where : undefined,
    select: {
      id: true,
      userId: true,
      channelId: true,
      balance: true,
      updatedAt: true,
      user: { select: { id: true, displayName: true, twitchUserId: true } },
      channel: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { updatedAt: 'desc' },
    ...(limit !== undefined ? { take: limit } : {}),
    ...(offset !== undefined ? { skip: offset } : {}),
  });

  // Back-compat: if no filters/paging were requested, return legacy array.
  if (!wantsPaging) {
    const wallets = await query;
    return res.json(wallets);
  }

  const [items, total] = await Promise.all([
    query,
    includeTotal
      ? prisma.wallet.count({ where: Object.keys(where).length ? where : undefined })
      : Promise.resolve(null),
  ]);

  return res.json({ items, total });
};

export const adjustWallet = async (req: AuthRequest, res: Response) => {
  // Only admins can access this
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { userId, channelId } = req.params;
  const { amount } = req.body;

  if (!userId || !channelId || typeof amount !== 'number') {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Get current wallet
      const wallet = await WalletService.getWalletForUpdate(tx, {
        userId,
        channelId,
      });

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // Calculate new balance
      const newBalance = wallet.balance + amount;

      // Validate balance doesn't go negative
      if (newBalance < 0) {
        throw new Error('Balance cannot be negative');
      }

      // Update wallet
      const updatedWallet = await tx.wallet.update({
        where: { userId_channelId: { userId, channelId } },
        data: { balance: newBalance },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
          channel: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Log action in audit log
      await tx.auditLog.create({
        data: {
          actorId: req.userId!,
          channelId,
          action: 'wallet_adjust',
          payloadJson: JSON.stringify({
            userId,
            channelId,
            amount,
            previousBalance: wallet.balance,
            newBalance,
          }),
        },
      });

      return updatedWallet;
    });

    res.json(result);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    if (errorMessage === 'Wallet not found' || errorMessage === 'Balance cannot be negative') {
      return res.status(400).json({ error: errorMessage });
    }
    throw error;
  }
};
