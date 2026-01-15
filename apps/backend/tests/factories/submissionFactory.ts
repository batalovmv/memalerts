import type { MemeSubmission, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { createUser } from './userFactory.js';
import { uniqueId } from './utils.js';

export async function createSubmission(
  overrides: Partial<Prisma.MemeSubmissionUncheckedCreateInput> = {},
): Promise<MemeSubmission> {
  const seed = uniqueId('submission');
  const channelId = overrides.channelId ?? (await createChannel()).id;
  const submitterUserId = overrides.submitterUserId ?? (await createUser()).id;
  const data: Prisma.MemeSubmissionUncheckedCreateInput = {
    channelId,
    submitterUserId,
    title: `Submission ${seed}`,
    type: 'video',
    fileUrlTemp: `/uploads/memes/temp_${seed}.webm`,
    sourceKind: 'upload',
    status: 'pending',
    ...overrides,
  };
  return prisma.memeSubmission.create({ data });
}
