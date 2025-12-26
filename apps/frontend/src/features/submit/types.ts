export type MySubmission = {
  id: string;
  title: string;
  status: string; // 'pending' | 'approved' | 'rejected' | 'needs_changes' | ...
  sourceKind?: 'upload' | 'url' | 'pool';
  memeAssetId?: string | null;
  createdAt: string;
  notes?: string | null;
  moderatorNotes?: string | null;
  revision?: number;
  tags?: string[];
  // Optional: backend may include submitter in `/submissions` response; used to guarantee "only mine" in UI.
  submitterId?: string | null;
  submitterDisplayName?: string | null;
};


