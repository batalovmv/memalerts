import type { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/prisma.js';

interface FindByChannelParams {
  channelId: string;
  limit: number;
  offset: number;
  sortBy: 'createdAt' | 'priceCoins' | 'activationsCount';
  sortOrder: 'asc' | 'desc';
  tags?: string[];
  search?: string;
}

const memeSelect = {
  id: true,
  title: true,
  priceCoins: true,
  cooldownMinutes: true,
  lastActivatedAt: true,
  status: true,
  createdAt: true,
  memeAsset: {
    select: {
      id: true,
      type: true,
      fileUrl: true,
      durationMs: true,
      qualityScore: true,
      aiAutoDescription: true,
      aiAutoTagNames: true,
      variants: {
        select: {
          format: true,
          fileUrl: true,
          status: true,
          priority: true,
          fileSizeBytes: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  },
  tags: {
    select: {
      tag: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  _count: {
    select: {
      activations: {
        where: { status: 'done' },
      },
    },
  },
} as const;

export class MemeRepository {
  async findByChannel(params: FindByChannelParams) {
    const { channelId, limit, offset, sortBy, sortOrder, tags, search } = params;

    const where: Prisma.ChannelMemeWhereInput = {
      channelId,
      status: 'approved',
      deletedAt: null,
    };

    if (tags && tags.length > 0) {
      where.tags = {
        some: {
          tag: {
            name: { in: tags },
          },
        },
      };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { memeAsset: { aiSearchText: { contains: search, mode: 'insensitive' } } },
      ];
    }

    let orderBy: Prisma.ChannelMemeOrderByWithRelationInput;
    switch (sortBy) {
      case 'priceCoins':
        orderBy = { priceCoins: sortOrder };
        break;
      case 'activationsCount':
        orderBy = { activations: { _count: sortOrder } };
        break;
      case 'createdAt':
      default:
        orderBy = { createdAt: sortOrder };
        break;
    }

    const [items, total] = await Promise.all([
      prisma.channelMeme.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: memeSelect,
      }),
      prisma.channelMeme.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.channelMeme.findFirst({
      where: {
        id,
        status: 'approved',
        deletedAt: null,
      },
      select: memeSelect,
    });
  }

  async createActivation(data: {
    channelMemeId: string;
    userId: string;
    channelId: string;
    priceCoins: number;
    volume: number;
  }) {
    return prisma.memeActivation.create({
      data: {
        channelMemeId: data.channelMemeId,
        userId: data.userId,
        channelId: data.channelId,
        priceCoins: data.priceCoins,
        volume: data.volume,
        status: 'queued',
      },
    });
  }

  async updateLastActivated(channelMemeId: string) {
    return prisma.channelMeme.update({
      where: { id: channelMemeId },
      data: { lastActivatedAt: new Date() },
    });
  }
}
