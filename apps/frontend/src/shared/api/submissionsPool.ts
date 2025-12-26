import { api } from '@/lib/api';

export type CreatePoolSubmissionInput = {
  memeAssetId: string;
  title: string;
  channelId: string;
  notes?: string;
  tags?: string[];
};

export async function createPoolSubmission(input: CreatePoolSubmissionInput): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  params.set('channelId', input.channelId);
  params.set('memeAssetId', input.memeAssetId);
  params.set('title', input.title);
  if (typeof input.notes === 'string' && input.notes.trim()) params.set('notes', input.notes.trim());
  if (Array.isArray(input.tags)) {
    for (const tag of input.tags) {
      if (typeof tag === 'string' && tag.trim()) params.append('tags[]', tag.trim());
    }
  }

  // Protect UX: if backend hangs, don't keep the request pending forever.
  return await api.post<Record<string, unknown>>('/submissions/pool', params, {
    timeout: 15000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}


