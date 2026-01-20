import { vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type {
  ChannelRepository,
  MemeRepository,
  RepositoryContext,
  RepositoryContextBase,
  SubmissionRepository,
  UserRepository,
} from '../../src/repositories/types.js';

const mockFn = <T extends (...args: unknown[]) => unknown>(): T => vi.fn() as unknown as T;

export const createChannelRepositoryMock = (overrides: Partial<ChannelRepository> = {}): ChannelRepository => ({
  findUnique: mockFn(),
  findMany: mockFn(),
  update: mockFn(),
  upsert: mockFn(),
  ...overrides,
});

export const createSubmissionRepositoryMock = (
  overrides: Partial<SubmissionRepository> = {}
): SubmissionRepository => ({
  findUnique: mockFn(),
  findMany: mockFn(),
  count: mockFn(),
  create: mockFn(),
  update: mockFn(),
  upsert: mockFn(),
  findTags: mockFn(),
  ...overrides,
});

export const createMemeRepositoryMock = (overrides: Partial<MemeRepository> = {}): MemeRepository => ({
  asset: {
    findUnique: mockFn(),
    findFirst: mockFn(),
    create: mockFn(),
    update: mockFn(),
    updateMany: mockFn(),
    ...(overrides.asset ?? {}),
  },
  channelMeme: {
    findUnique: mockFn(),
    findFirst: mockFn(),
    create: mockFn(),
    update: mockFn(),
    updateMany: mockFn(),
    upsert: mockFn(),
    ...(overrides.channelMeme ?? {}),
  },
  meme: {
    findUnique: mockFn(),
    findFirst: mockFn(),
    create: mockFn(),
    update: mockFn(),
    ...(overrides.meme ?? {}),
  },
});

export const createUserRepositoryMock = (overrides: Partial<UserRepository> = {}): UserRepository => ({
  findUnique: mockFn(),
  findMany: mockFn(),
  create: mockFn(),
  update: mockFn(),
  upsert: mockFn(),
  ...overrides,
});

export const createRepositoryContextBaseMock = (
  overrides: Partial<RepositoryContextBase> = {}
): RepositoryContextBase => ({
  channels: createChannelRepositoryMock(overrides.channels ?? {}),
  submissions: createSubmissionRepositoryMock(overrides.submissions ?? {}),
  memes: createMemeRepositoryMock(overrides.memes ?? {}),
  users: createUserRepositoryMock(overrides.users ?? {}),
});

export const createRepositoryContextMock = (overrides: Partial<RepositoryContext> = {}): RepositoryContext => {
  const base = createRepositoryContextBaseMock(overrides);
  const transaction =
    overrides.transaction ??
    (async <T>(fn: (repos: RepositoryContextBase, tx: Prisma.TransactionClient) => Promise<T>) =>
      fn(base, {} as Prisma.TransactionClient));

  return {
    ...base,
    transaction,
  };
};
