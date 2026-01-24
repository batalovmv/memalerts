import type { AllMemesPanelProps } from '@/features/dashboard/ui/panels/all-memes/AllMemesPanel';
import type { DashboardSubmissionsPanelProps } from '@/features/dashboard/ui/panels/submissions/DashboardSubmissionsPanel';
import type { RefObject } from 'react';

import { AllMemesPanel } from '@/features/dashboard/ui/panels/all-memes/AllMemesPanel';
import { DashboardSubmissionsPanel } from '@/features/dashboard/ui/panels/submissions/DashboardSubmissionsPanel';

type DashboardPanelsProps = {
  panel: 'submissions' | 'memes' | null;
  isPanelOpen: boolean;
  submissionsPanelRef: RefObject<HTMLDivElement>;
  memesPanelRef: RefObject<HTMLDivElement>;
  submissionsPanelProps: Omit<DashboardSubmissionsPanelProps, 'isOpen'>;
  memesPanelProps: Omit<AllMemesPanelProps, 'isOpen'>;
};

export function DashboardPanels({
  panel,
  isPanelOpen,
  submissionsPanelRef,
  memesPanelRef,
  submissionsPanelProps,
  memesPanelProps,
}: DashboardPanelsProps) {
  return (
    <div className={`transition-all duration-300 ${isPanelOpen ? 'mb-8' : 'mb-2'}`}>
      <div
        className={`overflow-hidden transition-all duration-300 ${
          panel === 'submissions' || panel === 'memes' ? 'max-h-[4000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div ref={submissionsPanelRef}>
          <DashboardSubmissionsPanel isOpen={panel === 'submissions'} {...submissionsPanelProps} />
        </div>

        <div ref={memesPanelRef}>
          <AllMemesPanel isOpen={panel === 'memes'} {...memesPanelProps} />
        </div>
      </div>
    </div>
  );
}
