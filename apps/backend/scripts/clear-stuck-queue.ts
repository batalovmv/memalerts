/**
 * Script to clear stuck queue activations for a specific channel.
 * Usage: npx tsx scripts/clear-stuck-queue.ts <channelId>
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const channelId = process.argv[2];
  
  if (!channelId) {
    console.error('Usage: npx tsx scripts/clear-stuck-queue.ts <channelId>');
    process.exit(1);
  }

  console.log(`Clearing stuck queue for channel: ${channelId}`);

  // Get current state
  const before = await prisma.memeActivation.count({
    where: { channelId, status: { in: ['queued', 'playing'] } },
  });
  console.log(`Found ${before} stuck activations`);

  if (before === 0) {
    console.log('No stuck activations found. Exiting.');
    return;
  }

  // Clear stuck activations
  const result = await prisma.memeActivation.updateMany({
    where: { 
      channelId, 
      status: { in: ['queued', 'playing'] } 
    },
    data: { 
      status: 'cancelled', 
      endedAt: new Date(), 
      endedReason: 'cleared_manual' 
    },
  });

  // Reset channel current activation
  await prisma.channel.update({
    where: { id: channelId },
    data: { 
      currentActivationId: null, 
      queueRevision: { increment: 1 } 
    },
  });

  console.log(`Cleared ${result.count} activations`);
  console.log('Channel currentActivationId reset to null');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
