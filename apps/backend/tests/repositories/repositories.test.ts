import type { WalletRepositoryClient } from '../../src/repositories/WalletRepository.js';

import { prisma } from '../../src/lib/prisma.js';
import { createRepositoryContext } from '../../src/repositories/index.js';
import { WalletRepository } from '../../src/repositories/WalletRepository.js';
import { createChannel, createUser, createWallet } from '../factories/index.js';

describe('repositories', () => {
  it('ChannelRepository findUnique/update by slug', async () => {
    const repos = createRepositoryContext(prisma);
    const channel = await createChannel({ slug: 'repo-channel', name: 'Repo Channel' });

    const found = await repos.channels.findUnique({ where: { slug: channel.slug } });
    expect(found?.id).toBe(channel.id);
    const foundById = await repos.channels.findUnique({ where: { id: channel.id } });
    expect(foundById?.slug).toBe(channel.slug);

    const updated = await repos.channels.update({ where: { id: channel.id }, data: { name: 'Repo Updated' } });
    expect(updated.name).toBe('Repo Updated');
  });

  it('MemeRepository handles assets, channel memes, and legacy memes', async () => {
    const repos = createRepositoryContext(prisma);
    const channel = await createChannel({ slug: 'repo-meme', name: 'Repo Meme' });

    const asset = await repos.memes.asset.create({
      data: {
        type: 'video',
        fileUrl: '/uploads/repo-asset.mp4',
        durationMs: 1200,
      },
    });
    const foundAsset = await repos.memes.asset.findUnique({ where: { id: asset.id } });
    expect(foundAsset?.id).toBe(asset.id);

    const channelMeme = await repos.memes.channelMeme.create({
      data: {
        channelId: channel.id,
        memeAssetId: asset.id,
        title: 'Repo Channel Meme',
        priceCoins: 123,
        status: 'approved',
      },
    });
    const foundChannelMeme = await repos.memes.channelMeme.findUnique({ where: { id: channelMeme.id } });
    expect(foundChannelMeme?.id).toBe(channelMeme.id);

    const legacy = await repos.memes.meme.create({
      data: {
        channelId: channel.id,
        title: 'Repo Legacy Meme',
        type: 'video',
        fileUrl: '/uploads/repo-legacy.mp4',
        durationMs: 900,
        priceCoins: 50,
        status: 'approved',
      },
    });
    const updatedLegacy = await repos.memes.meme.update({
      where: { id: legacy.id },
      data: { title: 'Repo Legacy Updated' },
    });
    expect(updatedLegacy.title).toBe('Repo Legacy Updated');
  });

  it('SubmissionRepository creates, updates, and paginates submissions', async () => {
    const repos = createRepositoryContext(prisma);
    const channel = await createChannel({ slug: 'repo-sub', name: 'Repo Submissions' });
    const user = await createUser({ displayName: 'Repo Submitter' });

    const submission = await repos.submissions.create({
      data: {
        channelId: channel.id,
        submitterUserId: user.id,
        title: 'Repo Submission',
        type: 'video',
        fileUrlTemp: '/uploads/repo-sub.mp4',
        sourceKind: 'upload',
        status: 'pending',
      },
    });

    const found = await repos.submissions.findUnique({ where: { id: submission.id } });
    expect(found?.id).toBe(submission.id);

    const updated = await repos.submissions.update({ where: { id: submission.id }, data: { status: 'approved' } });
    expect(updated.status).toBe('approved');

    const items = await repos.submissions.findMany({ where: { channelId: channel.id }, take: 10 });
    expect(items.some((s) => s.id === submission.id)).toBe(true);

    const total = await repos.submissions.count({ where: { channelId: channel.id } });
    expect(total).toBeGreaterThan(0);
  });

  it('UserRepository creates, finds, and updates users', async () => {
    const repos = createRepositoryContext(prisma);
    const created = await repos.users.create({
      data: {
        displayName: 'Repo User',
        role: 'viewer',
        channelId: null,
      },
    });

    const found = await repos.users.findUnique({ where: { id: created.id } });
    expect(found?.displayName).toBe('Repo User');

    const updated = await repos.users.update({ where: { id: created.id }, data: { displayName: 'Repo User Updated' } });
    expect(updated.displayName).toBe('Repo User Updated');
  });

  it('WalletRepository lockForUpdate returns wallet rows', async () => {
    const channel = await createChannel({ slug: 'repo-wallet', name: 'Repo Wallet' });
    const user = await createUser({ displayName: 'Repo Wallet User' });
    const wallet = await createWallet({ userId: user.id, channelId: channel.id, balance: 50 });

    const locked = await prisma.$transaction(async (tx) =>
      WalletRepository.lockForUpdate(tx as unknown as WalletRepositoryClient, {
        userId: user.id,
        channelId: channel.id,
      })
    );

    expect(locked?.id).toBe(wallet.id);
  });
});
