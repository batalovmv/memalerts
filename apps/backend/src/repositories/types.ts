import type { Prisma, PrismaClient } from '@prisma/client';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type ChannelRepository = {
  findUnique: (args: Prisma.ChannelFindUniqueArgs) => ReturnType<PrismaClient['channel']['findUnique']>;
  findMany: (args: Prisma.ChannelFindManyArgs) => ReturnType<PrismaClient['channel']['findMany']>;
  update: (args: Prisma.ChannelUpdateArgs) => ReturnType<PrismaClient['channel']['update']>;
  upsert: (args: Prisma.ChannelUpsertArgs) => ReturnType<PrismaClient['channel']['upsert']>;
};

export type SubmissionRepository = {
  findUnique: (args: Prisma.MemeSubmissionFindUniqueArgs) => ReturnType<PrismaClient['memeSubmission']['findUnique']>;
  findMany: (args: Prisma.MemeSubmissionFindManyArgs) => ReturnType<PrismaClient['memeSubmission']['findMany']>;
  count: (args: Prisma.MemeSubmissionCountArgs) => ReturnType<PrismaClient['memeSubmission']['count']>;
  create: (args: Prisma.MemeSubmissionCreateArgs) => ReturnType<PrismaClient['memeSubmission']['create']>;
  update: (args: Prisma.MemeSubmissionUpdateArgs) => ReturnType<PrismaClient['memeSubmission']['update']>;
  upsert: (args: Prisma.MemeSubmissionUpsertArgs) => ReturnType<PrismaClient['memeSubmission']['upsert']>;
  findTags: (args: Prisma.MemeSubmissionTagFindManyArgs) => ReturnType<PrismaClient['memeSubmissionTag']['findMany']>;
};

export type MemeRepository = {
  asset: {
    findUnique: (args: Prisma.MemeAssetFindUniqueArgs) => ReturnType<PrismaClient['memeAsset']['findUnique']>;
    findFirst: (args: Prisma.MemeAssetFindFirstArgs) => ReturnType<PrismaClient['memeAsset']['findFirst']>;
    create: (args: Prisma.MemeAssetCreateArgs) => ReturnType<PrismaClient['memeAsset']['create']>;
    update: (args: Prisma.MemeAssetUpdateArgs) => ReturnType<PrismaClient['memeAsset']['update']>;
    updateMany: (args: Prisma.MemeAssetUpdateManyArgs) => ReturnType<PrismaClient['memeAsset']['updateMany']>;
  };
  channelMeme: {
    findUnique: (args: Prisma.ChannelMemeFindUniqueArgs) => ReturnType<PrismaClient['channelMeme']['findUnique']>;
    findFirst: (args: Prisma.ChannelMemeFindFirstArgs) => ReturnType<PrismaClient['channelMeme']['findFirst']>;
    create: (args: Prisma.ChannelMemeCreateArgs) => ReturnType<PrismaClient['channelMeme']['create']>;
    update: (args: Prisma.ChannelMemeUpdateArgs) => ReturnType<PrismaClient['channelMeme']['update']>;
    updateMany: (args: Prisma.ChannelMemeUpdateManyArgs) => ReturnType<PrismaClient['channelMeme']['updateMany']>;
    upsert: (args: Prisma.ChannelMemeUpsertArgs) => ReturnType<PrismaClient['channelMeme']['upsert']>;
  };
};

export type UserRepository = {
  findUnique: (args: Prisma.UserFindUniqueArgs) => ReturnType<PrismaClient['user']['findUnique']>;
  findMany: (args: Prisma.UserFindManyArgs) => ReturnType<PrismaClient['user']['findMany']>;
  create: (args: Prisma.UserCreateArgs) => ReturnType<PrismaClient['user']['create']>;
  update: (args: Prisma.UserUpdateArgs) => ReturnType<PrismaClient['user']['update']>;
  upsert: (args: Prisma.UserUpsertArgs) => ReturnType<PrismaClient['user']['upsert']>;
};

export type RepositoryContextBase = {
  channels: ChannelRepository;
  submissions: SubmissionRepository;
  memes: MemeRepository;
  users: UserRepository;
};

export type RepositoryTransaction = <T>(
  fn: (repos: RepositoryContextBase, tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }
) => Promise<T>;

export type RepositoryContext = RepositoryContextBase & {
  transaction: RepositoryTransaction;
};

export type { WalletKey, WalletRepositoryClient } from './WalletRepository.js';
