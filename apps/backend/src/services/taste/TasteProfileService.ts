import { prisma } from '../../lib/prisma.js';
import { mapTagsToCanonical } from '../../utils/ai/tagMapping.js';
import { logger } from '../../utils/logger.js';

type WeightMap = Record<string, number>;

const DECAY_HALF_LIFE_DAYS = 30;

export type TopTag = {
  name: string;
  weight: number;
};

export type TasteProfileSnapshot = {
  userId: string;
  totalActivations: number;
  lastActivationAt: Date | null;
  tagWeights: WeightMap;
  categoryWeights: WeightMap;
  topTags: TopTag[];
};

function toWeightMap(value: unknown): WeightMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: WeightMap = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const num =
      typeof val === 'number'
        ? val
        : typeof val === 'string'
          ? Number.parseFloat(val)
          : Number.NaN;
    if (Number.isFinite(num)) out[key] = num;
  }
  return out;
}

function incrementWeights(map: WeightMap, keys: string[], delta = 1): WeightMap {
  for (const key of keys) {
    if (!key) continue;
    map[key] = (map[key] || 0) + delta;
  }
  return map;
}

function computeTopTags(map: WeightMap, limit = 20): TopTag[] {
  return Object.entries(map)
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([name, weight]) => ({ name, weight }));
}

function calculateDecayFactor(lastActivationAt: Date | null): number {
  if (!lastActivationAt) return 1;
  const daysSince = (Date.now() - lastActivationAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, daysSince / DECAY_HALF_LIFE_DAYS);
}

async function resolveTagsForActivation(opts: {
  channelMemeId?: string | null;
}): Promise<Array<{ tagId: string; name: string; categorySlug: string | null }>> {
  const { channelMemeId } = opts;

  if (!channelMemeId) return [];

  const channelMeme = await prisma.channelMeme.findUnique({
    where: { id: channelMemeId },
    select: {
      memeAsset: { select: { aiAutoTagNames: true } },
    },
  });

  const aiTagsRaw = Array.isArray(channelMeme?.memeAsset?.aiAutoTagNames)
    ? channelMeme.memeAsset.aiAutoTagNames.map((t) => String(t ?? '')).filter(Boolean)
    : [];

  if (aiTagsRaw.length === 0) return [];

  const { mapped } = await mapTagsToCanonical(aiTagsRaw);
  const canonicalNames = Array.from(new Set(mapped.map((tag) => tag.canonicalName))).filter(Boolean);
  if (canonicalNames.length === 0) return [];

  const tags = await prisma.tag.findMany({
    where: { name: { in: canonicalNames } },
    select: { id: true, name: true, category: { select: { slug: true } } },
  });

  return tags.map((tag) => ({ tagId: tag.id, name: tag.name, categorySlug: tag.category?.slug ?? null }));
}

async function resolveTagsForAsset(opts: {
  memeAssetId?: string | null;
}): Promise<Array<{ tagId: string; name: string; categorySlug: string | null }>> {
  const { memeAssetId } = opts;

  if (!memeAssetId) return [];

  const asset = await prisma.memeAsset.findUnique({
    where: { id: memeAssetId },
    select: { aiAutoTagNames: true },
  });

  const aiTagsRaw = Array.isArray(asset?.aiAutoTagNames)
    ? asset.aiAutoTagNames.map((t) => String(t ?? '')).filter(Boolean)
    : [];

  if (aiTagsRaw.length === 0) return [];

  const { mapped } = await mapTagsToCanonical(aiTagsRaw);
  const canonicalNames = Array.from(new Set(mapped.map((tag) => tag.canonicalName))).filter(Boolean);
  if (canonicalNames.length === 0) return [];

  const tags = await prisma.tag.findMany({
    where: { name: { in: canonicalNames } },
    select: { id: true, name: true, category: { select: { slug: true } } },
  });

  return tags.map((tag) => ({ tagId: tag.id, name: tag.name, categorySlug: tag.category?.slug ?? null }));
}

export const TasteProfileService = {
  async recordActivation(opts: { userId: string; channelMemeId?: string | null }): Promise<void> {
    const { userId, channelMemeId } = opts;
    if (!userId || !channelMemeId) return;

    const tags = await resolveTagsForActivation({ channelMemeId });
    if (tags.length === 0) return;

    const uniqueTags = Array.from(
      new Map(tags.map((tag) => [tag.tagId, tag])).values()
    );
    const tagNames = uniqueTags.map((tag) => tag.name);
    const categorySlugs = uniqueTags.map((tag) => tag.categorySlug).filter(Boolean) as string[];

    await prisma.$transaction(async (tx) => {
      const existing = await tx.userTasteProfile.findUnique({
        where: { userId },
        select: {
          userId: true,
          tagWeightsJson: true,
          categoryWeightsJson: true,
          totalActivations: true,
          lastActivationAt: true,
        },
      });

      const tagWeights = toWeightMap(existing?.tagWeightsJson);
      const categoryWeights = toWeightMap(existing?.categoryWeightsJson);

      incrementWeights(tagWeights, tagNames, 1);
      incrementWeights(categoryWeights, categorySlugs, 1);

      const totalActivations = (existing?.totalActivations ?? 0) + 1;
      const topTags = computeTopTags(tagWeights, 20);

      if (existing) {
        await tx.userTasteProfile.update({
          where: { userId },
          data: {
            tagWeightsJson: tagWeights,
            categoryWeightsJson: categoryWeights,
            topTagsJson: topTags,
            totalActivations,
            lastActivationAt: new Date(),
          },
        });
      } else {
        await tx.userTasteProfile.create({
          data: {
            userId,
            tagWeightsJson: tagWeights,
            categoryWeightsJson: categoryWeights,
            topTagsJson: topTags,
            totalActivations,
            lastActivationAt: new Date(),
          },
        });
      }

      if (uniqueTags.length > 0) {
        await tx.userTagActivity.createMany({
          data: uniqueTags.map((tag) => ({
            userId,
            tagId: tag.tagId,
            weight: 1,
            source: 'activation',
          })),
        });
      }
    });
  },

  async recordFavorite(opts: { userId: string; memeAssetId: string }): Promise<void> {
    const { userId, memeAssetId } = opts;
    if (!userId || !memeAssetId) return;

    const tags = await resolveTagsForAsset({ memeAssetId });
    if (tags.length === 0) return;

    const uniqueTags = Array.from(
      new Map(tags.map((tag) => [tag.tagId, tag])).values()
    );
    const tagNames = uniqueTags.map((tag) => tag.name);
    const categorySlugs = uniqueTags.map((tag) => tag.categorySlug).filter(Boolean) as string[];

    await prisma.$transaction(async (tx) => {
      const existing = await tx.userTasteProfile.findUnique({
        where: { userId },
        select: {
          userId: true,
          tagWeightsJson: true,
          categoryWeightsJson: true,
          totalActivations: true,
          lastActivationAt: true,
        },
      });

      const tagWeights = toWeightMap(existing?.tagWeightsJson);
      const categoryWeights = toWeightMap(existing?.categoryWeightsJson);

      incrementWeights(tagWeights, tagNames, 0.5);
      incrementWeights(categoryWeights, categorySlugs, 0.5);

      const topTags = computeTopTags(tagWeights, 20);

      if (existing) {
        await tx.userTasteProfile.update({
          where: { userId },
          data: {
            tagWeightsJson: tagWeights,
            categoryWeightsJson: categoryWeights,
            topTagsJson: topTags,
          },
        });
      } else {
        await tx.userTasteProfile.create({
          data: {
            userId,
            tagWeightsJson: tagWeights,
            categoryWeightsJson: categoryWeights,
            topTagsJson: topTags,
          },
        });
      }

      if (uniqueTags.length > 0) {
        await tx.userTagActivity.createMany({
          data: uniqueTags.map((tag) => ({
            userId,
            tagId: tag.tagId,
            weight: 0.5,
            source: 'favorite',
          })),
        });
      }
    });
  },

  async recordHidden(opts: { userId: string; memeAssetId: string }): Promise<void> {
    const { userId, memeAssetId } = opts;
    if (!userId || !memeAssetId) return;

    const memeAsset = await prisma.memeAsset.findUnique({
      where: { id: memeAssetId },
      select: { aiAutoTagNames: true },
    });

    const aiTagsRaw = Array.isArray(memeAsset?.aiAutoTagNames)
      ? memeAsset.aiAutoTagNames.map((t) => String(t ?? '')).filter(Boolean)
      : [];

    if (aiTagsRaw.length === 0) return;

    const { mapped } = await mapTagsToCanonical(aiTagsRaw);
    if (mapped.length === 0) return;

    const canonicalNames = mapped.map((tag) => tag.canonicalName).filter(Boolean);
    if (canonicalNames.length === 0) return;

    const existing = await prisma.userTasteProfile.findUnique({
      where: { userId },
      select: { userId: true, tagWeightsJson: true },
    });

    if (!existing) return;

    const tagWeights = toWeightMap(existing.tagWeightsJson);
    const HIDDEN_PENALTY = 0.3;

    for (const canonicalName of canonicalNames) {
      const current = tagWeights[canonicalName];
      if (typeof current === 'number' && current > 0) {
        tagWeights[canonicalName] = Math.max(0, current - HIDDEN_PENALTY);
      }
    }

    const topTags = computeTopTags(tagWeights, 20);

    await prisma.userTasteProfile.update({
      where: { userId },
      data: {
        tagWeightsJson: tagWeights,
        topTagsJson: topTags,
      },
    });

    logger.info('taste_profile.hidden_recorded', { userId, memeAssetId, tagsAffected: canonicalNames.length });
  },

  async getProfile(userId: string): Promise<TasteProfileSnapshot | null> {
    if (!userId) return null;

    const profile = await prisma.userTasteProfile.findUnique({
      where: { userId },
      select: {
        userId: true,
        tagWeightsJson: true,
        categoryWeightsJson: true,
        topTagsJson: true,
        totalActivations: true,
        lastActivationAt: true,
      },
    });

    if (!profile) return null;

    const tagWeights = toWeightMap(profile.tagWeightsJson);
    const categoryWeights = toWeightMap(profile.categoryWeightsJson);
    const topTags = Array.isArray(profile.topTagsJson)
      ? (profile.topTagsJson as unknown[])
          .map((t) => {
            const obj = t && typeof t === 'object' ? (t as { name?: unknown; weight?: unknown }) : null;
            const name = obj?.name ? String(obj.name) : '';
            const weight = typeof obj?.weight === 'number' ? obj.weight : Number.parseFloat(String(obj?.weight ?? ''));
            if (!name || !Number.isFinite(weight)) return null;
            return { name, weight };
          })
          .filter((t): t is TopTag => Boolean(t))
      : computeTopTags(tagWeights, 20);

    return {
      userId: profile.userId,
      totalActivations: profile.totalActivations ?? 0,
      lastActivationAt: profile.lastActivationAt ?? null,
      tagWeights,
      categoryWeights,
      topTags,
    };
  },

  scoreMemeForUser(profile: TasteProfileSnapshot | null, args: { tagNames: string[]; categorySlugs?: string[] }): number {
    if (!profile) return 0;
    const tags = Array.isArray(args.tagNames) ? args.tagNames : [];
    const categories = Array.isArray(args.categorySlugs) ? args.categorySlugs : [];
    if (tags.length === 0 && categories.length === 0) return 0;

    const decayFactor = calculateDecayFactor(profile.lastActivationAt);
    let score = 0;
    for (const tag of tags) {
      score += (profile.tagWeights[tag] ?? 0) * decayFactor;
    }
    for (const cat of categories) {
      score += (profile.categoryWeights[cat] ?? 0) * 0.5 * decayFactor;
    }
    return score;
  },
};
