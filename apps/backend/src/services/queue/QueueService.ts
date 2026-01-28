import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retryTransaction.js';
import { WalletService } from '../WalletService.js';

type FinishReason = 'natural' | 'skipped_by_streamer' | 'skipped_by_mod' | 'error' | 'timeout';
type Initiator = { userId: string; role: string };

type FinishResult =
  | {
      ok: true;
      finishedId: string;
      finishedReason: FinishReason;
      refunded: boolean;
      refundAmount: number;
      next: NextActivation | null;
      playbackPaused?: boolean;
    }
  | { ok: false; code: 'NO_CURRENT' | 'NOT_PLAYING' | 'CONCURRENT_MODIFICATION' };

interface NextActivation {
  activationId: string;
  memeTitle: string;
  memeAssetId: string;
  fileUrl: string | null;
  durationMs: number | null;
  senderName: string | null;
}

type ClearResult = {
  ok: true;
  clearedCount: number;
  refundTotal: number;
  refundedCount: number;
};

type ResumeResult = {
  ok: true;
  playbackPaused: boolean;
  alreadyCurrent: boolean;
  currentActivationId: string | null;
  next: NextActivation | null;
};

type NextActivationRow = {
  id: string;
  channelMeme: {
    title: string;
    memeAssetId: string;
    memeAsset: { fileUrl: string; durationMs: number | null } | null;
  } | null;
  user: { displayName: string | null } | null;
};

const REFUND_WINDOW_MS = 3000;

const toNextActivation = (row: NextActivationRow): NextActivation => ({
  activationId: row.id,
  memeTitle: String(row.channelMeme?.title || ''),
  memeAssetId: String(row.channelMeme?.memeAssetId || ''),
  fileUrl: row.channelMeme?.memeAsset?.fileUrl ?? null,
  durationMs: row.channelMeme?.memeAsset?.durationMs ?? null,
  senderName: row.user?.displayName ?? null,
});

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class QueueService {
  /**
   * Центральный метод завершения текущей активации.
   * Используется при: done, skip, error, timeout
   *
   * ИНВАРИАНТЫ:
   * - currentActivationId всегда указывает на playing или null
   * - Только один playing на канал
   * - Refund только один раз (проверка refundedAt)
   * - При playbackPaused — не назначаем следующий
   */
  static async finishCurrent(channelId: string, reason: FinishReason, initiator?: Initiator): Promise<FinishResult> {
    logger.info('queue.finish.start', {
      channelId,
      reason,
      initiatorId: initiator?.userId ?? null,
      initiatorRole: initiator?.role ?? null,
    });

    try {
      const result = await withRetry<FinishResult>(
        () =>
          prisma.$transaction(
            async (tx) => {
              const channel = await tx.channel.findUnique({
                where: { id: channelId },
                select: { currentActivationId: true, overlayPlaybackPaused: true },
              });

              const currentActivationId = channel?.currentActivationId ?? null;
              if (!currentActivationId) {
                return { ok: false, code: 'NO_CURRENT' } as FinishResult;
              }

              const activation = await tx.memeActivation.findUnique({
                where: { id: currentActivationId },
                select: {
                  id: true,
                  channelId: true,
                  status: true,
                  userId: true,
                  priceCoins: true,
                  playedAt: true,
                  refundedAt: true,
                },
              });

              if (!activation || activation.channelId !== channelId || activation.status !== 'playing') {
                return { ok: false, code: 'NOT_PLAYING' } as FinishResult;
              }

              const now = new Date();
              const isSkip = reason === 'skipped_by_streamer' || reason === 'skipped_by_mod';
              const playedAt = activation.playedAt;
              const refundEligible =
                isSkip && !!playedAt && activation.refundedAt === null && now.getTime() - playedAt.getTime() < REFUND_WINDOW_MS;
              const refundAmount = refundEligible ? Math.max(0, activation.priceCoins) : 0;
              const refundedAt = refundAmount > 0 ? now : activation.refundedAt ?? null;
              const finishStatus = isSkip ? 'skipped' : reason === 'natural' ? 'done' : 'cancelled';

              const updated = await tx.memeActivation.updateMany({
                where: { id: activation.id, status: 'playing' },
                data: {
                  status: finishStatus,
                  endedAt: now,
                  endedReason: reason,
                  endedById: initiator?.userId ?? null,
                  endedByRole: initiator?.role ?? null,
                  refundedAt,
                },
              });
              if (!updated?.count) {
                return { ok: false, code: 'NOT_PLAYING' } as FinishResult;
              }

              if (refundAmount > 0) {
                await WalletService.incrementBalance(tx, { userId: activation.userId, channelId }, refundAmount);
              }

              const channelUpdate = await tx.channel.updateMany({
                where: { id: channelId, currentActivationId },
                data: { currentActivationId: null, queueRevision: { increment: 1 } },
              });
              if (!channelUpdate?.count) {
                throw new Error('CONCURRENT_MODIFICATION');
              }

              if (channel?.overlayPlaybackPaused) {
                return {
                  ok: true,
                  finishedId: activation.id,
                  finishedReason: reason,
                  refunded: refundAmount > 0,
                  refundAmount,
                  next: null,
                  playbackPaused: true,
                };
              }

              const nextRow = await tx.memeActivation.findFirst({
                where: { channelId, status: 'queued' },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                select: {
                  id: true,
                  channelMeme: {
                    select: {
                      title: true,
                      memeAssetId: true,
                      memeAsset: { select: { fileUrl: true, durationMs: true } },
                    },
                  },
                  user: { select: { displayName: true } },
                },
              });

              let next: NextActivation | null = null;
              if (nextRow) {
                await tx.memeActivation.update({
                  where: { id: nextRow.id },
                  data: { status: 'playing', playedAt: now },
                });
                await tx.channel.update({
                  where: { id: channelId },
                  data: { currentActivationId: nextRow.id, queueRevision: { increment: 1 } },
                });
                next = toNextActivation(nextRow);
              }

              return {
                ok: true,
                finishedId: activation.id,
                finishedReason: reason,
                refunded: refundAmount > 0,
                refundAmount,
                next,
              };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
          ),
        { maxRetries: 3 }
      );

      const finishLog = result.ok
        ? {
            channelId,
            reason,
            ok: true,
            code: null,
            finishedId: result.finishedId,
            nextId: result.next?.activationId ?? null,
            refundAmount: result.refundAmount,
            playbackPaused: result.playbackPaused ?? false,
          }
        : {
            channelId,
            reason,
            ok: false,
            code: result.code,
            finishedId: null,
            nextId: null,
            refundAmount: null,
            playbackPaused: null,
          };

      logger.info('queue.finish.result', finishLog);

      return result;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'CONCURRENT_MODIFICATION') {
        logger.warn('queue.finish.concurrent', { channelId, reason });
        return { ok: false, code: 'CONCURRENT_MODIFICATION' };
      }
      logger.error('queue.finish.failed', { channelId, reason, errorMessage: getErrorMessage(error) });
      throw error;
    }
  }

  static async skip(channelId: string, initiator: Initiator) {
    const reason = `skipped_by_${initiator.role}` as FinishReason;
    return this.finishCurrent(channelId, reason, initiator);
  }

  /**
   * Очистить очередь (только queued, не текущий playing)
   * Refund всем в очереди
   */
  static async clear(channelId: string, initiator: Initiator): Promise<ClearResult> {
    logger.info('queue.clear.start', {
      channelId,
      initiatorId: initiator?.userId ?? null,
      initiatorRole: initiator?.role ?? null,
    });

    const result = await withRetry<ClearResult>(
      () =>
        prisma.$transaction(
          async (tx) => {
            const queued = await tx.memeActivation.findMany({
              where: { channelId, status: 'queued' },
              select: {
                id: true,
                userId: true,
                priceCoins: true,
                refundedAt: true,
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            });

            if (!queued.length) {
              return { ok: true, clearedCount: 0, refundTotal: 0, refundedCount: 0 };
            }

            const now = new Date();
            let refundTotal = 0;
            let refundedCount = 0;
            let clearedCount = 0;

            for (const activation of queued) {
              const updated = await tx.memeActivation.updateMany({
                where: { id: activation.id, status: 'queued' },
                data: {
                  status: 'cancelled',
                  endedAt: now,
                  endedReason: 'cleared',
                  refundedAt: activation.refundedAt ?? now,
                },
              });
              if (!updated?.count) continue;
              clearedCount += updated.count;

              const amount = Math.max(0, activation.priceCoins);
              if (activation.refundedAt === null && amount > 0) {
                await WalletService.incrementBalance(tx, { userId: activation.userId, channelId }, amount);
                refundTotal += amount;
                refundedCount += 1;
              }
            }

            if (clearedCount > 0) {
              await tx.channel.update({
                where: { id: channelId },
                data: { queueRevision: { increment: 1 } },
              });
            }

            return { ok: true, clearedCount, refundTotal, refundedCount };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        ),
      { maxRetries: 3 }
    );

    logger.info('queue.clear.result', {
      channelId,
      clearedCount: result.clearedCount,
      refundTotal: result.refundTotal,
      refundedCount: result.refundedCount,
    });

    return result;
  }

  static async setIntakePaused(channelId: string, paused: boolean) {
    const desiredEnabled = !paused;
    const current = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { activationsEnabled: true },
    });
    if (current && current.activationsEnabled === desiredEnabled) {
      logger.info('queue.intake_pause.result', {
        channelId,
        intakePaused: !current.activationsEnabled,
        changed: false,
      });
      return { ok: true, intakePaused: !current.activationsEnabled };
    }

    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: {
        activationsEnabled: desiredEnabled,
        queueRevision: { increment: 1 },
      },
    });

    logger.info('queue.intake_pause.result', {
      channelId,
      intakePaused: !channel.activationsEnabled,
      changed: true,
    });

    return { ok: true, intakePaused: !channel.activationsEnabled };
  }

  static async setPlaybackPaused(channelId: string, paused: boolean) {
    const current = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { overlayPlaybackPaused: true },
    });
    if (current && current.overlayPlaybackPaused === paused) {
      logger.info('queue.playback_pause.result', {
        channelId,
        playbackPaused: current.overlayPlaybackPaused,
        changed: false,
      });
      return { ok: true, playbackPaused: current.overlayPlaybackPaused };
    }

    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: {
        overlayPlaybackPaused: paused,
        queueRevision: { increment: 1 },
      },
    });

    logger.info('queue.playback_pause.result', {
      channelId,
      playbackPaused: channel.overlayPlaybackPaused,
      changed: true,
    });

    return { ok: true, playbackPaused: channel.overlayPlaybackPaused };
  }

  /**
   * Возобновить воспроизведение после паузы
   * Если есть queued — назначить следующий playing
   */
  static async resumePlayback(channelId: string): Promise<ResumeResult> {
    logger.info('queue.resume.start', { channelId });

    const result = await withRetry<ResumeResult>(
      () =>
        prisma.$transaction(
          async (tx) => {
            const channel = await tx.channel.findUnique({
              where: { id: channelId },
              select: { currentActivationId: true, overlayPlaybackPaused: true },
            });

            let playbackPaused = channel?.overlayPlaybackPaused ?? false;
            if (playbackPaused) {
              await tx.channel.update({
                where: { id: channelId },
                data: { overlayPlaybackPaused: false, queueRevision: { increment: 1 } },
              });
              playbackPaused = false;
            }

            const currentActivationId = channel?.currentActivationId ?? null;
            if (currentActivationId) {
              return {
                ok: true,
                playbackPaused,
                alreadyCurrent: true,
                currentActivationId,
                next: null,
              };
            }

            const nextRow = await tx.memeActivation.findFirst({
              where: { channelId, status: 'queued' },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                channelMeme: {
                  select: {
                    title: true,
                    memeAssetId: true,
                    memeAsset: { select: { fileUrl: true, durationMs: true } },
                  },
                },
                user: { select: { displayName: true } },
              },
            });

            if (!nextRow) {
              return {
                ok: true,
                playbackPaused,
                alreadyCurrent: false,
                currentActivationId: null,
                next: null,
              };
            }

            const channelUpdate = await tx.channel.updateMany({
              where: { id: channelId, currentActivationId: null },
              data: { currentActivationId: nextRow.id, queueRevision: { increment: 1 } },
            });
            if (!channelUpdate?.count) {
              return {
                ok: true,
                playbackPaused,
                alreadyCurrent: true,
                currentActivationId: null,
                next: null,
              };
            }

            const activationUpdate = await tx.memeActivation.updateMany({
              where: { id: nextRow.id, status: 'queued' },
              data: { status: 'playing', playedAt: new Date() },
            });
            if (!activationUpdate?.count) {
              await tx.channel.update({
                where: { id: channelId },
                data: { currentActivationId: null },
              });
              return {
                ok: true,
                playbackPaused,
                alreadyCurrent: false,
                currentActivationId: null,
                next: null,
              };
            }

            return {
              ok: true,
              playbackPaused,
              alreadyCurrent: false,
              currentActivationId: nextRow.id,
              next: toNextActivation(nextRow),
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        ),
      { maxRetries: 3 }
    );

    logger.info('queue.resume.result', {
      channelId,
      playbackPaused: result.playbackPaused,
      alreadyCurrent: result.alreadyCurrent,
      currentActivationId: result.currentActivationId,
      nextId: result.next?.activationId ?? null,
    });

    return result;
  }
}
