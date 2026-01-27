import { prisma } from '../../lib/prisma.js';
import { WalletService } from '../WalletService.js';
import { getActiveStreamSession } from '../economy/streamSessions.js';
import { resolveMemalertsUserIdFromChatIdentity, type ChatIdentityProvider } from '../../utils/chatIdentity.js';

const DEFAULT_DURATION_SECONDS = 45;
const MIN_DURATION_SECONDS = 15;
const MAX_DURATION_SECONDS = 600;
const AUTO_LOOKBACK_HOURS = 6;
const WINNER_BONUS_COINS = 50;

function clampDuration(seconds?: number | null): number {
  if (!Number.isFinite(seconds ?? NaN)) return DEFAULT_DURATION_SECONDS;
  const value = Math.floor(seconds as number);
  if (value < MIN_DURATION_SECONDS) return MIN_DURATION_SECONDS;
  if (value > MAX_DURATION_SECONDS) return MAX_DURATION_SECONDS;
  return value;
}

function toIso(value?: Date | null): string | null {
  return value ? value.toISOString() : null;
}

async function resolveActiveSession(channelId: string, now: Date) {
  const session = await prisma.memeVoteSession.findFirst({
    where: {
      channelId,
      status: 'active',
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: { startedAt: 'desc' },
  });
  return session;
}

async function buildVoteOptions(sessionId: string) {
  const options = await prisma.memeVoteOption.findMany({
    where: { sessionId },
    orderBy: { optionIndex: 'asc' },
    include: {
      channelMeme: {
        select: {
          id: true,
          title: true,
          memeAsset: {
            select: {
              fileUrl: true,
              type: true,
            },
          },
        },
      },
    },
  });

  const counts = await prisma.memeVoteBallot.groupBy({
    by: ['channelMemeId'],
    where: { sessionId },
    _count: { _all: true },
  });
  const countsByMeme = new Map<string, number>();
  counts.forEach((row) => countsByMeme.set(row.channelMemeId, row._count._all));

  const mapped = options.map((option) => ({
    index: option.optionIndex,
    channelMemeId: option.channelMemeId,
    title: option.channelMeme.title,
    previewUrl: option.channelMeme.memeAsset?.fileUrl ?? null,
    memeType: option.channelMeme.memeAsset?.type ?? undefined,
    totalVotes: countsByMeme.get(option.channelMemeId) ?? 0,
  }));

  return mapped;
}

function resolveWinnerIndex(options: Array<{ index: number; totalVotes: number }>): number | null {
  if (options.length === 0) return null;
  const sorted = [...options].sort((a, b) => {
    if (b.totalVotes !== a.totalVotes) return b.totalVotes - a.totalVotes;
    return a.index - b.index;
  });
  return sorted[0]?.index ?? null;
}

export async function buildVoteSessionDto(sessionId: string) {
  const session = await prisma.memeVoteSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return null;

  const options = await buildVoteOptions(sessionId);
  const totalVotes = options.reduce((acc, opt) => acc + opt.totalVotes, 0);
  const winnerIndex = session.status === 'ended' ? resolveWinnerIndex(options) : null;

  return {
    id: session.id,
    channelId: session.channelId,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    endsAt: toIso(session.endsAt),
    endedAt: toIso(session.endedAt),
    options,
    totalVotes,
    winnerIndex,
  };
}

export async function getActiveVoteSession(channelId: string) {
  const now = new Date();
  const session = await resolveActiveSession(channelId, now);
  if (!session) return null;

  if (session.endsAt && session.endsAt <= now) {
    await prisma.memeVoteSession.update({
      where: { id: session.id },
      data: { status: 'ended', endedAt: now },
    });
    return null;
  }

  return buildVoteSessionDto(session.id);
}

async function pickAutoOptions(channelId: string): Promise<string[]> {
  const now = new Date();
  const activeSession = await getActiveStreamSession(channelId);
  const since = activeSession?.startedAt ?? new Date(now.getTime() - AUTO_LOOKBACK_HOURS * 60 * 60 * 1000);

  const top = await prisma.memeActivation.groupBy({
    by: ['channelMemeId'],
    where: {
      channelId,
      createdAt: { gte: since, lte: now },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 6,
  });

  const ids = top.map((row) => row.channelMemeId);
  const channelMemes = await prisma.channelMeme.findMany({
    where: {
      channelId,
      status: 'approved',
      deletedAt: null,
      id: { in: ids.length ? ids : undefined },
    },
    select: { id: true },
  });

  const picked = channelMemes.map((row) => row.id);

  if (picked.length >= 3) return picked.slice(0, 3);

  const fallback = await prisma.channelMeme.findMany({
    where: {
      channelId,
      status: 'approved',
      deletedAt: null,
      id: picked.length ? { notIn: picked } : undefined,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
    take: 3 - picked.length,
  });

  return [...picked, ...fallback.map((row) => row.id)].slice(0, 3);
}

async function validateOptionIds(channelId: string, ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
  if (unique.length === 0) return [];
  const rows = await prisma.channelMeme.findMany({
    where: { channelId, id: { in: unique }, status: 'approved', deletedAt: null },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function createVoteSession(params: {
  channelId: string;
  createdByUserId?: string | null;
  channelMemeIds?: string[] | null;
  durationSeconds?: number | null;
}) {
  const now = new Date();
  const existing = await resolveActiveSession(params.channelId, now);
  if (existing && (!existing.endsAt || existing.endsAt > now)) {
    return buildVoteSessionDto(existing.id);
  }

  const durationSeconds = clampDuration(params.durationSeconds ?? null);
  const endsAt = new Date(now.getTime() + durationSeconds * 1000);

  let optionIds: string[] = [];
  if (Array.isArray(params.channelMemeIds) && params.channelMemeIds.length > 0) {
    optionIds = await validateOptionIds(params.channelId, params.channelMemeIds);
  }
  if (optionIds.length < 3) {
    optionIds = await pickAutoOptions(params.channelId);
  }
  if (optionIds.length < 3) return null;

  const session = await prisma.memeVoteSession.create({
    data: {
      channelId: params.channelId,
      status: 'active',
      startedAt: now,
      endsAt,
      createdByUserId: params.createdByUserId ?? null,
      options: {
        create: optionIds.slice(0, 3).map((id, index) => ({
          channelMemeId: id,
          optionIndex: index + 1,
        })),
      },
    },
  });

  return buildVoteSessionDto(session.id);
}

export async function castVote(params: {
  channelId: string;
  sessionId: string;
  userId: string;
  optionIndex: number;
}) {
  const now = new Date();
  const session = await prisma.memeVoteSession.findUnique({ where: { id: params.sessionId } });
  if (!session || session.channelId !== params.channelId) return null;
  if (session.status !== 'active') return null;
  if (session.endsAt && session.endsAt <= now) {
    await prisma.memeVoteSession.update({
      where: { id: session.id },
      data: { status: 'ended', endedAt: now },
    });
    return null;
  }

  const option = await prisma.memeVoteOption.findFirst({
    where: { sessionId: params.sessionId, optionIndex: params.optionIndex },
    select: { id: true, channelMemeId: true, optionIndex: true },
  });
  if (!option) return null;

  await prisma.memeVoteBallot.upsert({
    where: { sessionId_userId: { sessionId: params.sessionId, userId: params.userId } },
    create: {
      sessionId: params.sessionId,
      userId: params.userId,
      channelMemeId: option.channelMemeId,
    },
    update: {
      channelMemeId: option.channelMemeId,
    },
  });

  const sessionDto = await buildVoteSessionDto(params.sessionId);
  if (!sessionDto) return null;
  return { session: sessionDto, myVoteIndex: option.optionIndex };
}

export async function closeVoteSession(params: {
  channelId: string;
  sessionId: string;
}): Promise<{
  session: Awaited<ReturnType<typeof buildVoteSessionDto>> | null;
  winnerChannelMemeId: string | null;
  reward: { userId: string; balance: number; delta: number } | null;
}> {
  const now = new Date();
  const session = await prisma.memeVoteSession.findUnique({
    where: { id: params.sessionId },
  });
  if (!session || session.channelId !== params.channelId) {
    return { session: null, winnerChannelMemeId: null, reward: null };
  }

  if (session.status !== 'ended') {
    await prisma.memeVoteSession.update({
      where: { id: session.id },
      data: { status: 'ended', endedAt: now },
    });
  }

  const options = await buildVoteOptions(session.id);
  const winnerIndex = resolveWinnerIndex(options);
  const winnerOption = options.find((opt) => opt.index === winnerIndex);
  let winnerChannelMemeId = winnerOption?.channelMemeId ?? null;

  if (winnerChannelMemeId && session.winnerChannelMemeId !== winnerChannelMemeId) {
    await prisma.memeVoteSession.update({
      where: { id: session.id },
      data: { winnerChannelMemeId },
    });
  }

  let reward: { userId: string; balance: number; delta: number } | null = null;
  if (winnerChannelMemeId) {
    const winner = await prisma.channelMeme.findUnique({
      where: { id: winnerChannelMemeId },
      select: { memeAsset: { select: { createdById: true } } },
    });
    const authorId = winner?.memeAsset?.createdById ?? null;
    if (authorId) {
      const updatedWallet = await WalletService.incrementBalance(
        prisma,
        { userId: authorId, channelId: params.channelId },
        WINNER_BONUS_COINS
      );
      reward = {
        userId: authorId,
        balance: updatedWallet.balance,
        delta: WINNER_BONUS_COINS,
      };
    }
  }

  const sessionDto = await buildVoteSessionDto(session.id);
  return { session: sessionDto, winnerChannelMemeId, reward };
}

export async function castVoteFromChat(params: {
  channelId: string;
  provider: ChatIdentityProvider;
  platformUserId: string;
  optionIndex: number;
}) {
  const channelId = String(params.channelId || '').trim();
  const platformUserId = String(params.platformUserId || '').trim();
  const optionIndex = Math.floor(Number(params.optionIndex ?? 0));
  if (!channelId || !platformUserId || !Number.isFinite(optionIndex)) return null;
  if (optionIndex < 1 || optionIndex > 3) return null;

  const userId = await resolveMemalertsUserIdFromChatIdentity({
    provider: params.provider,
    platformUserId,
  });
  if (!userId) return null;

  const now = new Date();
  const session = await prisma.memeVoteSession.findFirst({
    where: {
      channelId,
      status: 'active',
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: { startedAt: 'desc' },
  });
  if (!session) return null;

  return castVote({
    channelId,
    sessionId: session.id,
    userId,
    optionIndex,
  });
}
