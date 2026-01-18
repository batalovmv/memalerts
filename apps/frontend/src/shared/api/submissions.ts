import { api } from '@/lib/api';
import type { Submission } from '@/types';

export type ImportSubmissionInput = {
  url: string;
  title?: string;
  notes?: string;
  tags?: string[];
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

export async function resubmitSubmission(submissionId: string, input: ResubmitInput): Promise<Submission> {
  return api.post<Submission>(`/submissions/${encodeURIComponent(submissionId)}/resubmit`, input);
}

export async function bulkSubmissionAction(
  input: BulkSubmissionAction,
): Promise<{ success: string[]; failed: Array<{ id: string; error: string }> }> {
  return api.post<{ success: string[]; failed: Array<{ id: string; error: string }> }>('/streamer/submissions/bulk', input);
}
