export type MySubmission = {
  id: string;
  title: string;
  status: string; // 'pending' | 'approved' | 'rejected' | 'needs_changes' | ...
  createdAt: string;
  notes?: string | null;
  moderatorNotes?: string | null;
  revision?: number;
  tags?: string[];
};


