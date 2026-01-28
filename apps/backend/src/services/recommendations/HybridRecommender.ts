import { TasteProfileService } from '../taste/TasteProfileService.js';
import { CooccurrenceService } from './CooccurrenceService.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

interface HybridConfig {
  contentWeight: number;
  collaborativeWeight: number;
  freshnessWeight: number;
  diversityEnabled: boolean;
  explorationRatio: number;
}

const DEFAULT_CONFIG: HybridConfig = {
  contentWeight: 0.5,
  collaborativeWeight: 0.3,
  freshnessWeight: 0.2,
  diversityEnabled: true,
  explorationRatio: 0.1,
};

const COMPLETED_STATUSES = ['done', 'completed'] as const;

export class HybridRecommender {
  static async getRecommendations(args: {
    userId: string;
    channelId: string;
    limit: number;
    config?: Partial<HybridConfig>;
  }): Promise<string[]> {
    const { userId, channelId, limit } = args;
    const config = { ...DEFAULT_CONFIG, ...args.config };

    logger.info('hybrid_recommender.start', { userId, channelId, limit, config });

    const [tasteProfile, recentActivations] = await Promise.all([
      TasteProfileService.getProfile(userId),
      prisma.memeActivation.findMany({
        where: { userId, status: { in: [...COMPLETED_STATUSES] } },
        select: { channelMeme: { select: { memeAssetId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const activatedMemeIds = recentActivations
      .map((activation) => activation.channelMeme?.memeAssetId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const candidates = await prisma.channelMeme.findMany({
      where: {
        channelId,
        status: 'approved',
        deletedAt: null,
        ...(activatedMemeIds.length > 0 ? { memeAssetId: { notIn: activatedMemeIds } } : {}),
      },
      include: {
        memeAsset: {
          select: {
            id: true,
            aiAutoTagNames: true,
            createdAt: true,
          },
        },
        tags: {
          include: { tag: { include: { category: true } } },
        },
      },
      take: 200,
    });

    const collaborativeScores = await CooccurrenceService.getRecommendations(
      activatedMemeIds,
      [],
      limit * 2
    );
    const collabMap = new Map(collaborativeScores.map((c) => [c.memeAssetId, c.score]));
    const maxCollabScore = Math.max(...collaborativeScores.map((c) => c.score), 1);

    const scored = candidates.map((candidate) => {
      const memeAssetId = candidate.memeAsset.id;

      const tagNames = Array.isArray(candidate.memeAsset.aiAutoTagNames)
        ? candidate.memeAsset.aiAutoTagNames.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
        : [];
      const categorySlugs = candidate.tags
        .map((t) => t.tag.category?.slug)
        .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0);

      const contentScore = tasteProfile
        ? TasteProfileService.scoreMemeForUser(tasteProfile, { tagNames, categorySlugs })
        : 0;

      const collabScore = (collabMap.get(memeAssetId) || 0) / maxCollabScore;

      const createdAtMs = candidate.memeAsset.createdAt?.getTime?.();
      const daysSinceCreation = Number.isFinite(createdAtMs)
        ? (Date.now() - (createdAtMs as number)) / (1000 * 60 * 60 * 24)
        : 0;
      const freshnessScore = Math.max(0, 1 - daysSinceCreation / 30);

      const hybridScore =
        contentScore * config.contentWeight +
        collabScore * config.collaborativeWeight +
        freshnessScore * config.freshnessWeight;

      return {
        memeAssetId,
        channelMemeId: candidate.id,
        score: hybridScore,
        tagNames,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    let result = scored;
    if (config.diversityEnabled) {
      result = this.diversify(scored, limit);
    }

    if (config.explorationRatio > 0) {
      result = this.addExploration(result, scored, limit, config.explorationRatio);
    }

    logger.info('hybrid_recommender.done', {
      userId,
      candidates: candidates.length,
      results: result.length,
    });

    return result.slice(0, limit).map((r) => r.channelMemeId);
  }

  private static diversify<T extends { tagNames: string[] }>(items: T[], limit: number): T[] {
    const MAX_SAME_TAG = 2;
    const result: T[] = [];
    const tagCounts: Record<string, number> = {};

    for (const item of items) {
      if (result.length >= limit * 1.5) break;

      const topTag = item.tagNames[0];
      if (topTag && (tagCounts[topTag] || 0) >= MAX_SAME_TAG) continue;

      result.push(item);
      if (topTag) tagCounts[topTag] = (tagCounts[topTag] || 0) + 1;
    }

    return result;
  }

  private static addExploration<T extends { memeAssetId: string }>(
    selected: T[],
    all: T[],
    limit: number,
    ratio: number
  ): T[] {
    const explorationCount = Math.max(1, Math.floor(limit * ratio));
    const exploitationCount = limit - explorationCount;

    const exploitation = selected.slice(0, exploitationCount);
    const selectedIds = new Set(exploitation.map((s) => s.memeAssetId));

    const unseen = all.filter((item) => !selectedIds.has(item.memeAssetId));
    const shuffled = unseen.sort(() => Math.random() - 0.5);
    const exploration = shuffled.slice(0, explorationCount);

    return [...exploitation, ...exploration];
  }
}
