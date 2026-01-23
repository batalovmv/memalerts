import type { Submission } from '@/types';

import { api } from '@/lib/api';

export type ImportSubmissionInput = {
  url: string;
  title?: string;
  notes?: string;
  tags?: string[];
};

export type PoolSubmissionInput = {
  memeAssetId: string;
  title?: string;
  notes?: string;
  tags?: string[];
  channelId?: string;
};

export type ResubmitInput = {
  title?: string;
  notes?: string;
  tags?: string[];
};

export type BulkSubmissionAction = {
  submissionIds: string[];
  action: 'approve' | 'reject' | 'needs_changes';
  moderatorNotes?: string;
  priceCoins?: number;
  durationMs?: number;
};

export async function importSubmission(input: ImportSubmissionInput): Promise<Submission> {
  return api.post<Submission>('/submissions/import', input);
}

export async function createPoolSubmission(input: PoolSubmissionInput): Promise<Submission> {
  const payload: Record<string, unknown> = {
    memeAssetId: input.memeAssetId,
  };
  if (typeof input.title === 'string' && input.title.trim()) payload.title = input.title.trim();
  if (typeof input.notes === 'string' && input.notes.trim()) payload.notes = input.notes.trim();
  if (Array.isArray(input.tags)) {
    const tags = input.tags.map((tag) => String(tag || '').trim()).filter(Boolean);
    if (tags.length > 0) payload.tags = tags;
  }
  if (typeof input.channelId === 'string' && input.channelId.trim()) payload.channelId = input.channelId.trim();
  return api.post<Submission>('/submissions/pool', payload, { timeout: 15000 });
}

export async function resubmitSubmission(submissionId: string, input: ResubmitInput): Promise<Submission> {
  return api.post<Submission>(`/submissions/${encodeURIComponent(submissionId)}/resubmit`, input);
}

export async function bulkSubmissionAction(
  input: BulkSubmissionAction,
): Promise<{ success: string[]; failed: Array<{ id: string; error: string }> }> {
  return api.post<{ success: string[]; failed: Array<{ id: string; error: string }> }>('/streamer/submissions/bulk', input);
}
