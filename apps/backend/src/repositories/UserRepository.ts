import type { DbClient, UserRepository } from './types.js';

export function createUserRepository(client: DbClient): UserRepository {
  return {
    findUnique: (args) => client.user.findUnique(args),
    findMany: (args) => client.user.findMany(args),
    create: (args) => client.user.create(args),
    update: (args) => client.user.update(args),
    upsert: (args) => client.user.upsert(args),
  };
}
