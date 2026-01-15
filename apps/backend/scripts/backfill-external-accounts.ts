import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';

/**
 * Backfill ExternalAccount rows for legacy Twitch users.
 *
 * Safe to run multiple times:
 * - Uses upsert on (provider, providerAccountId).
 *
 * Usage:
 *   pnpm tsx scripts/backfill-external-accounts.ts
 */
async function main() {
  const provider = 'twitch' as const;

  // Only users with legacy twitchUserId can be backfilled.
  const users = await prisma.user.findMany({
    where: { twitchUserId: { not: null } },
    select: {
      id: true,
      twitchUserId: true,
      displayName: true,
      profileImageUrl: true,
      twitchAccessToken: true,
      twitchRefreshToken: true,
    },
  });

  logger.info('backfill.external_accounts.start', { count: users.length });

  let created = 0;
  let updated = 0;

  for (const u of users) {
    const providerAccountId = u.twitchUserId!;
    const existing = await prisma.externalAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      select: { id: true },
    });

    await prisma.externalAccount.upsert({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      create: {
        userId: u.id,
        provider,
        providerAccountId,
        displayName: u.displayName || null,
        avatarUrl: u.profileImageUrl || null,
        accessToken: u.twitchAccessToken || null,
        refreshToken: u.twitchRefreshToken || null,
      },
      update: {
        // Do not overwrite linkage if it already exists; but do refresh profile/token fields.
        userId: u.id,
        displayName: u.displayName || null,
        avatarUrl: u.profileImageUrl || null,
        accessToken: u.twitchAccessToken || null,
        refreshToken: u.twitchRefreshToken || null,
      },
    });

    if (existing) updated++;
    else created++;
  }

  logger.info('backfill.external_accounts.done', { created, updated });
}

main()
  .catch((e) => {
    logger.error('backfill.external_accounts.failed', { err: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
