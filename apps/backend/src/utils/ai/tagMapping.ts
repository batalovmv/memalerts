import { prisma } from '../../lib/prisma.js';

export type TagMappingResult = {
  canonicalTagId: string;
  canonicalName: string;
};

let aliasCache: Map<string, TagMappingResult> | null = null;
let cacheUpdatedAt = 0;
const CACHE_TTL_MS = 60_000;

export function normalizeTagName(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_');
}

async function loadAliasCache(): Promise<Map<string, TagMappingResult>> {
  const now = Date.now();
  if (aliasCache && now - cacheUpdatedAt < CACHE_TTL_MS) return aliasCache;

  const [tags, aliases] = await Promise.all([
    prisma.tag.findMany({
      where: { status: 'active' },
      select: { id: true, name: true },
    }),
    prisma.tagAlias.findMany({
      where: { tag: { status: 'active' } },
      include: { tag: { select: { id: true, name: true } } },
    }),
  ]);

  const cache = new Map<string, TagMappingResult>();

  for (const tag of tags) {
    const key = normalizeTagName(tag.name);
    if (!key) continue;
    cache.set(key, { canonicalTagId: tag.id, canonicalName: tag.name });
  }

  for (const alias of aliases) {
    const key = normalizeTagName(alias.alias);
    if (!key) continue;
    cache.set(key, { canonicalTagId: alias.tag.id, canonicalName: alias.tag.name });
  }

  aliasCache = cache;
  cacheUpdatedAt = now;
  return cache;
}

export async function mapTagToCanonical(rawTag: string): Promise<TagMappingResult | null> {
  const normalized = normalizeTagName(rawTag);
  if (!normalized) return null;
  const cache = await loadAliasCache();
  return cache.get(normalized) || null;
}

export async function mapTagsToCanonical(rawTags: string[]): Promise<{
  mapped: TagMappingResult[];
  unmapped: string[];
}> {
  const mapped: TagMappingResult[] = [];
  const unmapped: string[] = [];

  const seenTagIds = new Set<string>();
  for (const raw of rawTags) {
    const result = await mapTagToCanonical(raw);
    if (result) {
      if (!seenTagIds.has(result.canonicalTagId)) {
        mapped.push(result);
        seenTagIds.add(result.canonicalTagId);
      }
    } else {
      const normalized = normalizeTagName(raw);
      if (normalized) unmapped.push(raw);
    }
  }

  return { mapped, unmapped };
}

export async function recordUnmappedTag(rawTag: string, memeAssetId?: string | null): Promise<void> {
  const normalized = normalizeTagName(rawTag);
  if (normalized.length < 2 || normalized.length > 50) return;

  await prisma.tagSuggestion.upsert({
    where: { normalizedTag: normalized },
    create: {
      rawTag,
      normalizedTag: normalized,
      memeAssetId: memeAssetId || undefined,
      count: 1,
    },
    update: {
      count: { increment: 1 },
    },
  });
}

export function invalidateTagCache(): void {
  aliasCache = null;
  cacheUpdatedAt = 0;
}
