/**
 * Migration script: Legacy Meme -> ChannelMeme + MemeAsset
 *
 * IMPORTANT: Run with empty database or backup first!
 *
 * Steps:
 * 1. For each legacy Meme:
 *    a. Create MemeAsset from file data
 *    b. Create ChannelMeme linking to MemeAsset
 *    c. Migrate tags to ChannelMemeTag
 * 2. Delete legacy Meme table
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type LegacyMeme = {
  id: string;
  channelId: string;
  title: string;
  type: string;
  fileUrl: string;
  fileHash: string | null;
  durationMs: number;
  priceCoins: number;
  status: string;
  createdAt: Date;
  createdByUserId: string | null;
};

type LegacyMemeTag = {
  memeId: string;
  tagId: string;
};

async function migrate() {
  console.log('Starting migration...');

  const legacyMemes = await prisma.$queryRaw<LegacyMeme[]>`
    SELECT
      "id",
      "channelId",
      "title",
      "type",
      "fileUrl",
      "fileHash",
      "durationMs",
      "priceCoins",
      "status",
      "createdAt",
      "createdByUserId"
    FROM "Meme"
  `;

  const legacyTags = await prisma.$queryRaw<LegacyMemeTag[]>`
    SELECT "memeId", "tagId"
    FROM "MemeTag"
  `;

  console.log(`Found ${legacyMemes.length} legacy memes`);

  const tagsByMemeId = new Map<string, string[]>();
  for (const relation of legacyTags) {
    const existing = tagsByMemeId.get(relation.memeId);
    if (existing) {
      existing.push(relation.tagId);
    } else {
      tagsByMemeId.set(relation.memeId, [relation.tagId]);
    }
  }

  for (const meme of legacyMemes) {
    if (!meme.fileHash) {
      console.warn(`Skipping meme ${meme.id} (missing fileHash)`);
      continue;
    }

    let memeAsset = await prisma.memeAsset.findUnique({
      where: { fileHash: meme.fileHash },
    });

    if (!memeAsset) {
      memeAsset = await prisma.memeAsset.create({
        data: {
          type: meme.type,
          fileUrl: meme.fileUrl,
          fileHash: meme.fileHash,
          durationMs: meme.durationMs,
          aiStatus: 'pending',
          aiAutoTagNames: [],
          createdById: meme.createdByUserId,
          createdAt: meme.createdAt,
        },
      });
    }

    let channelMeme = await prisma.channelMeme.findFirst({
      where: {
        channelId: meme.channelId,
        memeAssetId: memeAsset.id,
      },
    });

    if (!channelMeme) {
      channelMeme = await prisma.channelMeme.create({
        data: {
          channelId: meme.channelId,
          memeAssetId: memeAsset.id,
          title: meme.title,
          priceCoins: meme.priceCoins,
          status: meme.status,
          createdAt: meme.createdAt,
        },
      });
    }

    const tagIds = tagsByMemeId.get(meme.id) ?? [];
    if (tagIds.length > 0) {
      await prisma.channelMemeTag.createMany({
        data: tagIds.map(tagId => ({
          channelMemeId: channelMeme.id,
          tagId,
        })),
        skipDuplicates: true,
      });
    }

    console.log(`Migrated meme ${meme.id} -> ChannelMeme ${channelMeme.id}`);
  }

  console.log('Migration complete!');
}

migrate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
