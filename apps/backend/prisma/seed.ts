import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create a default channel (you'll need to replace with actual Twitch channel ID)
  const channel = await prisma.channel.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      twitchChannelId: '123456789', // Replace with actual Twitch channel ID
      slug: 'default',
      name: 'Default Channel',
      coinPerPointRatio: 1.0,
    },
  });

  console.log('Created channel:', channel);

  // You can add more seed data here
  // For example, create a test streamer user:
  // const streamer = await prisma.user.upsert({
  //   where: { twitchUserId: 'test_streamer_123' },
  //   update: {},
  //   create: {
  //     twitchUserId: 'test_streamer_123',
  //     displayName: 'Test Streamer',
  //     role: 'streamer',
  //     channelId: channel.id,
  //   },
  // });

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


