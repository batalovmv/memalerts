import type { DbClient, RepositoryContext, RepositoryContextBase } from './types.js';
import { prisma } from '../lib/prisma.js';
import { createChannelRepository } from './ChannelRepository.js';
import { createSubmissionRepository } from './SubmissionRepository.js';
import { createMemeRepository } from './MemeRepository.js';
import { createUserRepository } from './UserRepository.js';

export function createRepositoryContext(client: DbClient): RepositoryContextBase {
  return {
    channels: createChannelRepository(client),
    submissions: createSubmissionRepository(client),
    memes: createMemeRepository(client),
    users: createUserRepository(client),
  };
}

export const repositories: RepositoryContext = {
  ...createRepositoryContext(prisma),
  transaction: async (fn, options) =>
    prisma.$transaction(async (tx) => {
      const txRepos = createRepositoryContext(tx);
      return fn(txRepos, tx);
    }, options),
};
