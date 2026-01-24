import type { Submission } from '@/types';

export type SubmissionsPanelTab = 'pending' | 'mine';

export type PendingFilters = {
  status: 'all' | 'pending' | 'approved' | 'rejected';
  aiStatus: 'all' | 'pending' | 'processing' | 'done' | 'failed';
  q: string;
  sort: 'newest-first' | 'oldest-first';
};

export type SubmissionPreviewState = {
  open: boolean;
  src: string;
  title: string;
  submission?: Submission | null;
};
