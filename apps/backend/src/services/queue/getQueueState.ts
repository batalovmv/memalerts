import { prisma } from '../../lib/prisma.js';
import { getOverlayStatus } from '../../socket/overlayPresence.js';

export interface QueueState {
  revision: number;
  intakePaused: boolean;
  playbackPaused: boolean;
  overlayConnected: boolean;
  overlayCount: number;
  current: {
    activationId: string;
    memeTitle: string;
    memeAssetId: string;
    senderName: string | null;
    priceCoins: number;
    startedAt: Date | null; // может быть null для legacy данных
    durationMs: number;
  } | null;
  next: Array<{
    activationId: string;
    memeTitle: string;
    senderName: string | null;
    priceCoins: number;
  }>;
  queueLength: number;
  pendingSubmissions: number;
}

export async function getQueueState(channelId: string): Promise<QueueState> {
  const [channel, nextRows, queuedCount, pendingSubmissions] = await Promise.all([
    prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        currentActivationId: true,
        activationsEnabled: true,
        overlayPlaybackPaused: true,
        queueRevision: true,
      },
    }),
    prisma.memeActivation.findMany({
      where: { channelId, status: 'queued' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
      select: {
        id: true,
        priceCoins: true,
        channelMeme: {
          select: {
            title: true,
          },
        },
        user: { select: { displayName: true } },
      },
    }),
    prisma.memeActivation.count({
      where: { channelId, status: 'queued' },
    }),
    prisma.memeSubmission.count({
      where: { channelId, status: 'pending' },
    }),
  ]);

  let current: QueueState['current'] = null;
  if (channel?.currentActivationId) {
    const currentRow = await prisma.memeActivation.findFirst({
      where: { id: channel.currentActivationId, channelId },
      select: {
        id: true,
        priceCoins: true,
        playedAt: true,
        channelMeme: {
          select: {
            title: true,
            memeAssetId: true,
            memeAsset: { select: { durationMs: true } },
          },
        },
        user: { select: { displayName: true } },
      },
    });

    if (currentRow) {
      current = {
        activationId: currentRow.id,
        memeTitle: String(currentRow.channelMeme?.title ?? ''),
        memeAssetId: String(currentRow.channelMeme?.memeAssetId ?? ''),
        senderName: currentRow.user?.displayName ?? null,
        priceCoins: currentRow.priceCoins,
        startedAt: currentRow.playedAt ?? null,
        durationMs: currentRow.channelMeme?.memeAsset?.durationMs ?? 0,
      };
    }
  }

  const overlayStatus = getOverlayStatus(channelId);
  const overlayConnected = overlayStatus?.connected ?? false;
  const overlayCount = overlayStatus?.count ?? 0;

  return {
    revision: channel?.queueRevision ?? 0,
    intakePaused: channel ? !channel.activationsEnabled : true,
    playbackPaused: channel?.overlayPlaybackPaused ?? false,
    overlayConnected,
    overlayCount,
    current,
    next: nextRows.map((row) => ({
      activationId: row.id,
      memeTitle: String(row.channelMeme?.title ?? ''),
      senderName: row.user?.displayName ?? null,
      priceCoins: row.priceCoins,
    })),
    queueLength: queuedCount,
    pendingSubmissions,
  };
}
