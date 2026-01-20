import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../src/lib/prisma.js';

type Issue = {
  key: string;
  count: number;
  sample?: unknown[];
};

async function countWithSample<T>(
  countQuery: Promise<{ count: bigint }[]>,
  sampleQuery: Promise<T[]>
): Promise<{ count: number; sample: T[] }> {
  const [countRows, sampleRows] = await Promise.all([countQuery, sampleQuery]);
  const count = countRows?.[0]?.count ? Number(countRows[0].count) : 0;
  return { count, sample: sampleRows };
}

export async function auditConsistency(): Promise<{ ok: boolean; issues: Issue[] }> {
  const issues: Issue[] = [];

  const orphanChannelMemes = await countWithSample(
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "ChannelMeme" cm
      LEFT JOIN "MemeAsset" ma ON ma.id = cm."memeAssetId"
      WHERE ma.id IS NULL
    `,
    prisma.$queryRaw<{ channelMemeId: string; memeAssetId: string | null }[]>`
      SELECT cm.id AS "channelMemeId", cm."memeAssetId" AS "memeAssetId"
      FROM "ChannelMeme" cm
      LEFT JOIN "MemeAsset" ma ON ma.id = cm."memeAssetId"
      WHERE ma.id IS NULL
      LIMIT 20
    `
  );
  if (orphanChannelMemes.count > 0) {
    issues.push({
      key: 'channelMeme_missing_memeAsset',
      count: orphanChannelMemes.count,
      sample: orphanChannelMemes.sample,
    });
  }

  const channelMemesMissingLegacy = await countWithSample(
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "ChannelMeme" cm
      WHERE cm."legacyMemeId" IS NULL AND cm.status = 'approved' AND cm."deletedAt" IS NULL
    `,
    prisma.$queryRaw<{ channelMemeId: string }[]>`
      SELECT cm.id AS "channelMemeId"
      FROM "ChannelMeme" cm
      WHERE cm."legacyMemeId" IS NULL AND cm.status = 'approved' AND cm."deletedAt" IS NULL
      LIMIT 20
    `
  );
  if (channelMemesMissingLegacy.count > 0) {
    issues.push({
      key: 'channelMeme_missing_legacyMemeId',
      count: channelMemesMissingLegacy.count,
      sample: channelMemesMissingLegacy.sample,
    });
  }

  const orphanLegacyMemes = await countWithSample(
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Meme" m
      LEFT JOIN "ChannelMeme" cm ON cm."legacyMemeId" = m.id
      WHERE cm.id IS NULL
    `,
    prisma.$queryRaw<{ legacyMemeId: string; status: string }[]>`
      SELECT m.id AS "legacyMemeId", m.status AS status
      FROM "Meme" m
      LEFT JOIN "ChannelMeme" cm ON cm."legacyMemeId" = m.id
      WHERE cm.id IS NULL
      LIMIT 20
    `
  );
  if (orphanLegacyMemes.count > 0) {
    issues.push({
      key: 'legacyMeme_missing_channelMeme',
      count: orphanLegacyMemes.count,
      sample: orphanLegacyMemes.sample,
    });
  }

  const statusMismatches = await countWithSample(
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "ChannelMeme" cm
      JOIN "Meme" m ON m.id = cm."legacyMemeId"
      WHERE (
        (cm.status = 'disabled' OR cm."deletedAt" IS NOT NULL) AND (m.status <> 'deleted' OR m."deletedAt" IS NULL)
      ) OR (
        (cm.status <> 'disabled' AND cm."deletedAt" IS NULL) AND (m.status = 'deleted' OR m."deletedAt" IS NOT NULL)
      ) OR (
        cm.status <> 'disabled' AND cm."deletedAt" IS NULL AND m.status <> cm.status
      )
    `,
    prisma.$queryRaw<{ channelMemeId: string; channelStatus: string; memeStatus: string | null }[]>`
      SELECT cm.id AS "channelMemeId", cm.status AS "channelStatus", m.status AS "memeStatus"
      FROM "ChannelMeme" cm
      JOIN "Meme" m ON m.id = cm."legacyMemeId"
      WHERE (
        (cm.status = 'disabled' OR cm."deletedAt" IS NOT NULL) AND (m.status <> 'deleted' OR m."deletedAt" IS NULL)
      ) OR (
        (cm.status <> 'disabled' AND cm."deletedAt" IS NULL) AND (m.status = 'deleted' OR m."deletedAt" IS NOT NULL)
      ) OR (
        cm.status <> 'disabled' AND cm."deletedAt" IS NULL AND m.status <> cm.status
      )
      LIMIT 20
    `
  );
  if (statusMismatches.count > 0) {
    issues.push({ key: 'legacy_status_mismatch', count: statusMismatches.count, sample: statusMismatches.sample });
  }

  const assetDuplicates = await countWithSample(
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT "fileHash"
        FROM "MemeAsset"
        WHERE "fileHash" IS NOT NULL
        GROUP BY "fileHash"
        HAVING COUNT(*) > 1
      ) dup
    `,
    prisma.$queryRaw<{ fileHash: string; count: number }[]>`
      SELECT "fileHash", COUNT(*)::int AS count
      FROM "MemeAsset"
      WHERE "fileHash" IS NOT NULL
      GROUP BY "fileHash"
      HAVING COUNT(*) > 1
      LIMIT 20
    `
  );
  if (assetDuplicates.count > 0) {
    issues.push({ key: 'memeAsset_duplicate_fileHash', count: assetDuplicates.count, sample: assetDuplicates.sample });
  }

  const assetMissingFileHash = await countWithSample(
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "MemeAsset" ma
      LEFT JOIN "FileHash" fh ON fh.hash = ma."fileHash"
      WHERE ma."fileHash" IS NOT NULL AND fh.hash IS NULL
    `,
    prisma.$queryRaw<{ memeAssetId: string; fileHash: string }[]>`
      SELECT ma.id AS "memeAssetId", ma."fileHash" AS "fileHash"
      FROM "MemeAsset" ma
      LEFT JOIN "FileHash" fh ON fh.hash = ma."fileHash"
      WHERE ma."fileHash" IS NOT NULL AND fh.hash IS NULL
      LIMIT 20
    `
  );
  if (assetMissingFileHash.count > 0) {
    issues.push({
      key: 'memeAsset_missing_fileHash_ref',
      count: assetMissingFileHash.count,
      sample: assetMissingFileHash.sample,
    });
  }

  return { ok: issues.length === 0, issues };
}

async function main(): Promise<void> {
  const { ok, issues } = await auditConsistency();

  if (ok) {
    console.log('[consistency] OK');
    return;
  }

  console.error('[consistency] FAIL');
  for (const issue of issues) {
    console.error(`- ${issue.key}: ${issue.count}`);
    if (issue.sample && issue.sample.length > 0) {
      console.error(`  sample: ${JSON.stringify(issue.sample)}`);
    }
  }

  process.exitCode = 1;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isDirectRun = entryPath && fileURLToPath(import.meta.url) === entryPath;
if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('[consistency] ERROR', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => {});
    });
}
