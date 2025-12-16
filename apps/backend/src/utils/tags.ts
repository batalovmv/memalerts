import { prisma } from '../lib/prisma.js';

/**
 * Create or find tags by name
 * Returns array of tag IDs
 */
export async function getOrCreateTags(tagNames: string[]): Promise<string[]> {
  if (!tagNames || tagNames.length === 0) {
    return [];
  }

  // Normalize tag names (lowercase, trim)
  const normalizedTags = tagNames
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0)
    .filter((name, index, self) => self.indexOf(name) === index); // Remove duplicates

  if (normalizedTags.length === 0) {
    return [];
  }

  // Find existing tags
  const existingTags = await prisma.tag.findMany({
    where: {
      name: {
        in: normalizedTags,
      },
    },
  });

  const existingTagNames = new Set(existingTags.map((t) => t.name));
  const newTagNames = normalizedTags.filter((name) => !existingTagNames.has(name));

  // Create new tags
  if (newTagNames.length > 0) {
    await prisma.tag.createMany({
      data: newTagNames.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }

  // Get all tags (existing + newly created)
  const allTags = await prisma.tag.findMany({
    where: {
      name: {
        in: normalizedTags,
      },
    },
  });

  return allTags.map((t) => t.id);
}

