import { api } from '@/lib/api';

export type CreatePoolSubmissionInput = {
  memeAssetId: string;
  title?: string;
  channelId?: string;
};

export async function createPoolSubmission(input: CreatePoolSubmissionInput): Promise<void> {
  // Protect UX: if backend hangs, don't keep the request pending forever.
  await api.post('/submissions/pool', input, { timeout: 15000 });
}


