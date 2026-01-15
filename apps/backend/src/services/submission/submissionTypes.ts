import type { RepositoryContext } from '../../repositories/types.js';

export type SubmissionDeps = Pick<RepositoryContext, 'channels' | 'submissions' | 'memes' | 'transaction'>;
export type AdminSubmissionDeps = Pick<RepositoryContext, 'channels' | 'submissions' | 'memes' | 'transaction'>;
