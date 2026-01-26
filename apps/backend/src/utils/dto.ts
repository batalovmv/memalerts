import type { Channel } from '@prisma/client';

type ChannelStats = { memesCount: number; usersCount: number };

export type PublicChannelDto = {
  slug: string;
  name: string;
  coinPerPointRatio: number;
  submissionRewardCoins: number;
  overlayMode: string;
  overlayShowSender: boolean;
  overlayMaxConcurrent: number;
  coinIconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  stats: ChannelStats;
};

export type PublicMemeDto = {
  id: string;
  title: string;
  type: string;
  fileUrl: string;
  durationMs: number;
  priceCoins: number;
  createdAt: Date;
  createdBy?: { displayName: string } | null;
};

type PublicMemeInput = {
  id: string;
  title: string;
  type: string;
  fileUrl: string;
  durationMs: number;
  priceCoins: number;
  createdAt: Date;
  createdBy?: { displayName: string } | null;
};


export function toPublicChannelDto(channel: Channel, stats: ChannelStats): PublicChannelDto {
  return {
    slug: channel.slug,
    name: channel.name,
    coinPerPointRatio: channel.coinPerPointRatio,
    submissionRewardCoins: channel.submissionRewardCoins,
    overlayMode: channel.overlayMode,
    overlayShowSender: channel.overlayShowSender,
    overlayMaxConcurrent: channel.overlayMaxConcurrent,
    coinIconUrl: channel.coinIconUrl ?? null,
    primaryColor: channel.primaryColor ?? null,
    secondaryColor: channel.secondaryColor ?? null,
    accentColor: channel.accentColor ?? null,
    stats,
  };
}

export function toPublicMemeDto(meme: PublicMemeInput): PublicMemeDto {
  return {
    id: meme.id,
    title: meme.title,
    type: meme.type,
    fileUrl: meme.fileUrl,
    durationMs: meme.durationMs,
    priceCoins: meme.priceCoins,
    createdAt: meme.createdAt,
    createdBy: meme.createdBy ? { displayName: meme.createdBy.displayName } : null,
  };
}
