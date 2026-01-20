import { PrismaClient, type Channel, type User } from '@prisma/client';

const prisma = new PrismaClient();

const PERF_PREFIX = 'perf_test_';
const PERF_CHANNEL_SLUG = `${PERF_PREFIX}channel`;
const PERF_CHANNEL_NAME = 'Perf Test Channel';
const PERF_ASSET_BASE_URL = 'https://cdn.memalerts.test/perf_test_assets';
const PERF_UPLOAD_BASE_URL = 'https://uploads.memalerts.test/perf_test_submissions';

const PERF_USERS = 200;
const PERF_SUBMISSIONS = 20_000;
const PERF_FILE_HASHES = 5_000;
const PERF_ASSETS = 10_000; // 5k unique hashes reused twice to stress dedupe.
const PERF_CHANNEL_MEMES = 10_000;

const USER_BATCH = 50;
const CREATE_MANY_BATCH = 500;

async function cleanupPerfData() {
  console.log('⚙️  Cleaning previous perf_test_* data');
  await prisma.channel.deleteMany({ where: { slug: PERF_CHANNEL_SLUG } });
  await prisma.channel.deleteMany({ where: { slug: { startsWith: PERF_PREFIX }, NOT: { slug: PERF_CHANNEL_SLUG } } });
  await prisma.user.deleteMany({ where: { displayName: { startsWith: PERF_PREFIX } } });
  await prisma.memeAsset.deleteMany({ where: { fileUrl: { startsWith: PERF_ASSET_BASE_URL } } });
  await prisma.fileHash.deleteMany({ where: { hash: { startsWith: PERF_PREFIX } } });
}

async function createPerfChannel(): Promise<Channel> {
  console.log('🏗️  Creating perf channel');
  return prisma.channel.create({
    data: {
      slug: PERF_CHANNEL_SLUG,
      name: PERF_CHANNEL_NAME,
      coinPerPointRatio: 1,
      defaultPriceCoins: 150,
      rewardTitle: 'Perf Reward',
      rewardEnabled: true,
      submissionsEnabled: true,
    },
  });
}

async function createPerfUsers(count: number): Promise<User[]> {
  console.log(`👥 Creating ${count} perf users (batch ${USER_BATCH})`);
  const created: User[] = [];
  for (let i = 0; i < count; i += USER_BATCH) {
    const batch = [];
    for (let j = 0; j < USER_BATCH && i + j < count; j += 1) {
      const idx = i + j;
      batch.push(
        prisma.user.create({
          data: {
            displayName: `${PERF_PREFIX}user_${idx}`,
            role: 'viewer',
            hasBetaAccess: false,
          },
        })
      );
    }
    const chunk = await Promise.all(batch);
    created.push(...chunk);
  }
  return created;
}

async function ensurePerfFileHashes(): Promise<string[]> {
  console.log(`📦 Creating ${PERF_FILE_HASHES} file hashes`);
  const data = Array.from({ length: PERF_FILE_HASHES }, (_v, idx) => ({
    hash: `${PERF_PREFIX}hash_${idx}`,
    filePath: `/uploads/perf/${idx}.mp4`,
    referenceCount: 1,
    fileSize: BigInt(5_000_000),
    mimeType: 'video/mp4',
  }));
  for (let i = 0; i < data.length; i += CREATE_MANY_BATCH) {
    const chunk = data.slice(i, i + CREATE_MANY_BATCH);
    await prisma.fileHash.createMany({ data: chunk, skipDuplicates: true });
  }
  return data.map((d) => d.hash);
}

async function createPerfAssets(count: number, hashes: string[], users: User[]) {
  console.log(`🗄️  Creating ${count} meme assets`);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const hash = hashes[i % hashes.length];
    const creator = users[i % users.length];
    rows.push({
      type: 'video',
      fileUrl: `${PERF_ASSET_BASE_URL}/${i}.mp4`,
      durationMs: 5_000,
      fileHash: hash,
      createdByUserId: creator?.id,
      aiAutoTitle: `perf asset ${i}`,
      aiSearchText: `perf asset ${i}`,
    });
  }
  for (let i = 0; i < rows.length; i += CREATE_MANY_BATCH) {
    const chunk = rows.slice(i, i + CREATE_MANY_BATCH);
    await prisma.memeAsset.createMany({ data: chunk });
  }
  const assets = await prisma.memeAsset.findMany({
    where: { fileUrl: { startsWith: PERF_ASSET_BASE_URL } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (assets.length < count) {
    throw new Error(`Expected ${count} assets, found ${assets.length}`);
  }
  return assets.map((a) => a.id);
}

async function createPerfChannelMemes(channel: Channel, assetIds: string[]) {
  if (assetIds.length < PERF_CHANNEL_MEMES) {
    throw new Error(`Need ${PERF_CHANNEL_MEMES} asset ids, received ${assetIds.length}`);
  }
  console.log(`🎞️  Creating ${PERF_CHANNEL_MEMES} channel memes`);
  const data = [];
  for (let i = 0; i < PERF_CHANNEL_MEMES; i += 1) {
    data.push({
      channelId: channel.id,
      memeAssetId: assetIds[i],
      title: `perf meme ${i}`,
      priceCoins: 100 + (i % 25) * 5,
      searchText: `perf meme ${i}`,
      createdAt: new Date(Date.now() - i * 1_000),
    });
  }
  for (let i = 0; i < data.length; i += CREATE_MANY_BATCH) {
    const chunk = data.slice(i, i + CREATE_MANY_BATCH);
    await prisma.channelMeme.createMany({ data: chunk });
  }
}

function pickStatus(index: number): string {
  const pendingLimit = Math.floor(PERF_SUBMISSIONS * 0.6);
  const approvedLimit = Math.floor(PERF_SUBMISSIONS * 0.9);
  if (index < pendingLimit) return 'pending';
  if (index < approvedLimit) return 'approved';
  return 'rejected';
}

async function createPerfSubmissions(channel: Channel, users: User[], hashes: string[]) {
  console.log(`📬 Creating ${PERF_SUBMISSIONS} submissions`);
  const rows = [];
  for (let i = 0; i < PERF_SUBMISSIONS; i += 1) {
    const submitter = users[i % users.length];
    rows.push({
      channelId: channel.id,
      submitterUserId: submitter.id,
      title: `perf submission ${i}`,
      type: 'video',
      fileUrlTemp: `${PERF_UPLOAD_BASE_URL}/${i}.mp4`,
      sourceKind: 'upload',
      status: pickStatus(i),
      fileHash: hashes[i % hashes.length],
      createdAt: new Date(Date.now() - i * 500),
    });
  }
  for (let i = 0; i < rows.length; i += CREATE_MANY_BATCH) {
    const chunk = rows.slice(i, i + CREATE_MANY_BATCH);
    await prisma.memeSubmission.createMany({ data: chunk });
  }
}

async function main() {
  await cleanupPerfData();
  const channel = await createPerfChannel();
  const streamer = await prisma.user.create({
    data: {
      displayName: `${PERF_PREFIX}owner`,
      role: 'streamer',
      channelId: channel.id,
    },
  });
  console.log('🎙️  Streamer user:', streamer.displayName);
  const users = await createPerfUsers(PERF_USERS);
  const hashes = await ensurePerfFileHashes();
  const assetIds = await createPerfAssets(PERF_ASSETS, hashes, users);
  await createPerfChannelMemes(channel, assetIds.slice(0, PERF_CHANNEL_MEMES));
  await createPerfSubmissions(channel, users, hashes);
  console.log('✅ Perf seed complete');
}

main()
  .catch((error) => {
    console.error('Perf seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
