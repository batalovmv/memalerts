import { PrismaClient } from '@prisma/client';
import { seedTagCatalog } from './seed-tags.js';

const prisma = new PrismaClient();

const demoHash = '0000000000000000000000000000000000000000000000000000000000000000';

async function main() {
  console.log('Seeding database...');

  await seedTagCatalog(prisma);

  const channel = await prisma.channel.upsert({
    where: { slug: 'demo' },
    update: {
      name: 'Demo Channel',
      submissionsEnabled: true,
      submissionsOnlyWhenLive: false,
    },
    create: {
      twitchChannelId: 'demo-channel-id',
      slug: 'demo',
      name: 'Demo Channel',
      coinPerPointRatio: 1.0,
      submissionsEnabled: true,
      submissionsOnlyWhenLive: false,
    },
    select: { id: true, slug: true, name: true },
  });

  const streamer = await prisma.user.upsert({
    where: { twitchUserId: 'demo_streamer' },
    update: {
      displayName: 'Demo Streamer',
      role: 'streamer',
      channelId: channel.id,
      hasBetaAccess: true,
    },
    create: {
      twitchUserId: 'demo_streamer',
      displayName: 'Demo Streamer',
      role: 'streamer',
      channelId: channel.id,
      hasBetaAccess: true,
    },
    select: { id: true, role: true },
  });

  const admin = await prisma.user.upsert({
    where: { twitchUserId: 'demo_admin' },
    update: {
      displayName: 'Demo Admin',
      role: 'admin',
      hasBetaAccess: true,
    },
    create: {
      twitchUserId: 'demo_admin',
      displayName: 'Demo Admin',
      role: 'admin',
      hasBetaAccess: true,
    },
    select: { id: true, role: true },
  });

  const viewer = await prisma.user.upsert({
    where: { twitchUserId: 'demo_viewer' },
    update: {
      displayName: 'Demo Viewer',
      role: 'viewer',
      hasBetaAccess: true,
    },
    create: {
      twitchUserId: 'demo_viewer',
      displayName: 'Demo Viewer',
      role: 'viewer',
      hasBetaAccess: true,
    },
    select: { id: true, role: true },
  });

  await prisma.wallet.upsert({
    where: { userId_channelId: { userId: viewer.id, channelId: channel.id } },
    update: { balance: 1000 },
    create: { userId: viewer.id, channelId: channel.id, balance: 1000 },
  });

  const tags = await Promise.all(
    ['demo', 'funny'].map((name) =>
      prisma.tag.upsert({
        where: { name },
        update: {},
        create: { name },
        select: { id: true, name: true },
      })
    )
  );

  const demoFileUrl = 'http://localhost:3001/uploads/demo.mp4';

  let memeAsset = await prisma.memeAsset.findFirst({
    where: { fileUrl: demoFileUrl },
    select: { id: true },
  });
  if (!memeAsset) {
    memeAsset = await prisma.memeAsset.create({
      data: {
        type: 'video',
        fileUrl: demoFileUrl,
        fileHash: demoHash,
        durationMs: 15000,
        aiStatus: 'done',
        aiAutoTitle: 'Demo Meme',
      },
      select: { id: true },
    });
  }

  let meme = await prisma.meme.findFirst({
    where: { channelId: channel.id, title: 'Demo Meme' },
    select: { id: true },
  });
  if (!meme) {
    meme = await prisma.meme.create({
      data: {
        channelId: channel.id,
        title: 'Demo Meme',
        type: 'video',
        fileUrl: demoFileUrl,
        fileHash: demoHash,
        durationMs: 15000,
        priceCoins: 100,
        status: 'approved',
        createdByUserId: streamer.id,
        approvedByUserId: admin.id,
      },
      select: { id: true },
    });
  }

  const channelMeme = await prisma.channelMeme.upsert({
    where: { channelId_memeAssetId: { channelId: channel.id, memeAssetId: memeAsset.id } },
    update: {
      title: 'Demo Meme',
      priceCoins: 100,
      legacyMemeId: meme.id,
      status: 'approved',
    },
    create: {
      channelId: channel.id,
      memeAssetId: memeAsset.id,
      legacyMemeId: meme.id,
      title: 'Demo Meme',
      priceCoins: 100,
      status: 'approved',
      addedByUserId: streamer.id,
      approvedByUserId: admin.id,
    },
    select: { id: true },
  });

  for (const tag of tags) {
    await prisma.memeTag.upsert({
      where: { memeId_tagId: { memeId: meme.id, tagId: tag.id } },
      update: {},
      create: { memeId: meme.id, tagId: tag.id },
    });
  }

  let submission = await prisma.memeSubmission.findFirst({
    where: {
      channelId: channel.id,
      submitterUserId: viewer.id,
      title: 'Demo Submission',
    },
    select: { id: true },
  });
  if (!submission) {
    submission = await prisma.memeSubmission.create({
      data: {
        channelId: channel.id,
        submitterUserId: viewer.id,
        title: 'Demo Submission',
        type: 'video',
        fileUrlTemp: '/uploads/tmp/demo.mp4',
        status: 'pending',
        sourceKind: 'upload',
        notes: 'Seeded submission for local dev.',
        fileHash: demoHash,
        durationMs: 15000,
        mimeType: 'video/mp4',
        fileSizeBytes: 1048576,
      },
      select: { id: true },
    });
  }

  for (const tag of tags) {
    await prisma.memeSubmissionTag.upsert({
      where: { submissionId_tagId: { submissionId: submission.id, tagId: tag.id } },
      update: {},
      create: { submissionId: submission.id, tagId: tag.id },
    });
  }

  console.log('Seed data ready:', {
    channel: channel.slug,
    streamerUserId: streamer.id,
    viewerUserId: viewer.id,
    memeAssetId: memeAsset.id,
    channelMemeId: channelMeme.id,
    submissionId: submission.id,
  });
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


