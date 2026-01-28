/**
 * Script to clear stuck MemeActivation records with status 'queued'.
 * These are "ghost" queue items that were never properly played/completed.
 *
 * Usage: npx tsx scripts/clear-stuck-queue.ts [--dry-run] [--channel=slug]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const channelArg = args.find((a) => a.startsWith('--channel='));
  const channelSlug = channelArg?.split('=')[1];

  console.log('=== Clear Stuck Queue ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (channelSlug) console.log(`Filtering by channel: ${channelSlug}`);
  console.log('');

  // Build where clause
  const where: Parameters<typeof prisma.memeActivation.findMany>[0]['where'] = {
    status: 'queued',
  };

  if (channelSlug) {
    const channel = await prisma.channel.findFirst({
      where: { slug: { equals: channelSlug, mode: 'insensitive' } },
      select: { id: true, slug: true },
    });
    if (!channel) {
      console.error(`Channel not found: ${channelSlug}`);
      process.exit(1);
    }
    console.log(`Found channel: ${channel.slug} (${channel.id})`);
    where.channelId = channel.id;
  }

  // Find stuck activations
  const stuckActivations = await prisma.memeActivation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      channelMeme: { select: { title: true } },
      user: { select: { displayName: true } },
      channel: { select: { slug: true } },
    },
  });

  console.log(`Found ${stuckActivations.length} stuck activations with status 'queued':\n`);

  for (const act of stuckActivations) {
    const age = Math.round((Date.now() - act.createdAt.getTime()) / 1000 / 60);
    console.log(
      `  - [${act.channel.slug}] "${act.channelMeme?.title || '???'}" by ${act.user?.displayName || '???'} (${age} min ago, ID: ${act.id.slice(0, 8)}...)`
    );
  }

  if (stuckActivations.length === 0) {
    console.log('\nNo stuck activations found. Queue is clean!');
    return;
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Would mark these as cancelled. Run without --dry-run to apply.');
    return;
  }

  // Mark as cancelled with reason
  console.log('\nMarking as cancelled...');

  const result = await prisma.memeActivation.updateMany({
    where: {
      id: { in: stuckActivations.map((a) => a.id) },
      status: 'queued',
    },
    data: {
      status: 'cancelled',
      endedAt: new Date(),
      endedReason: 'cleared',
      endedByRole: 'system',
    },
  });

  console.log(`✓ Updated ${result.count} activations to 'cancelled'`);

  // Also clear currentActivationId if it points to a now-cancelled activation
  const cancelledIds = new Set(stuckActivations.map((a) => a.id));
  const affectedChannelIds = [...new Set(stuckActivations.map((a) => a.channelId))];

  for (const channelId of affectedChannelIds) {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { currentActivationId: true, slug: true },
    });
    if (channel?.currentActivationId && cancelledIds.has(channel.currentActivationId)) {
      console.log(`  Clearing currentActivationId for channel: ${channel.slug}`);
      await prisma.channel.update({
        where: { id: channelId },
        data: {
          currentActivationId: null,
          queueRevision: { increment: 1 },
        },
      });
    }
  }

  console.log('\nDone! Queue cleared.');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

