import type { PrismaClient } from '@prisma/client';
import { setFileHashHooksForTest } from '../src/lib/prisma.js';
import { decrementFileHashReferenceInTx } from '../src/utils/fileHash.js';
import { createChannel, createFileHash, createSubmission, createUser } from './factories/index.js';

let prisma: PrismaClient;

function rand(): string {
  return Math.random().toString(16).slice(2);
}

beforeAll(async () => {
  ({ prisma } = await import('../src/lib/prisma.js'));
});

afterEach(() => {
  setFileHashHooksForTest({ decrementFileHashReferenceInTx });
});

describe('FileHash ref count middleware', () => {
  it('deletes submission and decrements file hash atomically', async () => {
    const channel = await createChannel({ slug: `ch_${rand()}`, name: `Channel ${rand()}` });
    const viewer = await createUser({ displayName: `Viewer ${rand()}`, role: 'viewer', hasBetaAccess: false });

    const hash = `del_${rand()}`;
    const filePath = `/uploads/memes/${hash}.mp4`;
    await createFileHash({
      hash,
      filePath,
      referenceCount: 1,
      fileSize: BigInt(1),
      mimeType: 'video/mp4',
    });

    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: viewer.id,
      title: 'Reject me',
      type: 'video',
      fileUrlTemp: filePath,
      status: 'rejected',
      sourceKind: 'upload',
      fileHash: hash,
    });

    await prisma.memeSubmission.delete({ where: { id: submission.id } });

    const fh = await prisma.fileHash.findUnique({ where: { hash } });
    expect(fh).toBeNull();

    const deleted = await prisma.memeSubmission.findUnique({ where: { id: submission.id } });
    expect(deleted).toBeNull();
  });

  it('rolls back submission delete when ref decrement fails', async () => {
    const channel = await createChannel({ slug: `ch_${rand()}`, name: `Channel ${rand()}` });
    const viewer = await createUser({ displayName: `Viewer ${rand()}`, role: 'viewer', hasBetaAccess: false });

    const hash = `boom_${rand()}`;
    const filePath = `/uploads/memes/${hash}.mp4`;
    await createFileHash({
      hash,
      filePath,
      referenceCount: 1,
      fileSize: BigInt(1),
      mimeType: 'video/mp4',
    });

    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: viewer.id,
      title: 'Reject me too',
      type: 'video',
      fileUrlTemp: filePath,
      status: 'rejected',
      sourceKind: 'upload',
      fileHash: hash,
    });

    setFileHashHooksForTest({
      decrementFileHashReferenceInTx: async () => {
        throw new Error('forced_refcount_failure');
      },
    });

    await expect(prisma.memeSubmission.delete({ where: { id: submission.id } })).rejects.toThrow();

    const fh = await prisma.fileHash.findUnique({ where: { hash } });
    expect(fh?.referenceCount).toBe(1);

    const stillThere = await prisma.memeSubmission.findUnique({ where: { id: submission.id } });
    expect(stillThere).not.toBeNull();
  });
});
