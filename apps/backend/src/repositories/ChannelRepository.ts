import type { DbClient, ChannelRepository } from './types.js';

export function createChannelRepository(client: DbClient): ChannelRepository {
  return {
    findUnique: (args) => client.channel.findUnique(args),
    findMany: (args) => client.channel.findMany(args),
    update: (args) => client.channel.update(args),
    upsert: (args) => client.channel.upsert(args),
  };
}
