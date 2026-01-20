import type { DbClient, SubmissionRepository } from './types.js';

export function createSubmissionRepository(client: DbClient): SubmissionRepository {
  return {
    findUnique: (args) => client.memeSubmission.findUnique(args),
    findMany: (args) => client.memeSubmission.findMany(args),
    count: (args) => client.memeSubmission.count(args),
    create: (args) => client.memeSubmission.create(args),
    update: (args) => client.memeSubmission.update(args),
    upsert: (args) => client.memeSubmission.upsert(args),
    findTags: (args) => client.memeSubmissionTag.findMany(args),
  };
}
