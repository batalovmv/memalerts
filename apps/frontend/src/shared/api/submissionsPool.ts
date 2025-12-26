import { api } from '@/lib/api';

export type CreatePoolSubmissionInput = {
  memeAssetId: string;
  title?: string;
};

export async function createPoolSubmission(input: CreatePoolSubmissionInput): Promise<void> {
  await api.post('/submissions/pool', input);
}


