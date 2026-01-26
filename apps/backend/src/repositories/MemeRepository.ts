import type { DbClient, MemeRepository } from './types.js';

export function createMemeRepository(client: DbClient): MemeRepository {
  return {
    asset: {
      findUnique: (args) => client.memeAsset.findUnique(args),
      findFirst: (args) => client.memeAsset.findFirst(args),
      create: (args) => client.memeAsset.create(args),
      update: (args) => client.memeAsset.update(args),
      updateMany: (args) => client.memeAsset.updateMany(args),
    },
    channelMeme: {
      findUnique: (args) => client.channelMeme.findUnique(args),
      findFirst: (args) => client.channelMeme.findFirst(args),
      create: (args) => client.channelMeme.create(args),
      update: (args) => client.channelMeme.update(args),
      updateMany: (args) => client.channelMeme.updateMany(args),
      upsert: (args) => client.channelMeme.upsert(args),
    },
  };
}
