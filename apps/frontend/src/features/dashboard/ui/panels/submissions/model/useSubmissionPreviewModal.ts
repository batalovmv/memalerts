import { useCallback, useState } from 'react';

import type { SubmissionPreviewState } from '@/features/dashboard/ui/panels/submissions/model/types';
import type { Submission } from '@/types';

export function useSubmissionPreviewModal() {
  const [previewModal, setPreviewModal] = useState<SubmissionPreviewState>(() => ({
    open: false,
    src: '',
    title: '',
    submission: null,
  }));

  const openPreview = useCallback((data: { src: string; title: string; submission?: Submission | null }) => {
    setPreviewModal({ open: true, src: data.src, title: data.title, submission: data.submission ?? null });
  }, []);

  const closePreview = useCallback(() => {
    setPreviewModal({ open: false, src: '', title: '', submission: null });
  }, []);

  return { closePreview, openPreview, previewModal };
}
