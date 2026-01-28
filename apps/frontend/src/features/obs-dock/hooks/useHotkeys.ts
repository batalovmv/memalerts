import { useEffect } from 'react';

import type { QueueState } from '@/features/dock/types';

interface DockHotkeyActions {
  skip: () => void;
  clear: () => void;
  pauseIntake: () => void;
  resumeIntake: () => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
}

export function useHotkeys(queueState: QueueState | null, actions: DockHotkeyActions) {
  const { skip, clear, pauseIntake, resumeIntake, pausePlayback, resumePlayback } = actions;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.repeat) return;

      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return;

      switch (event.key.toLowerCase()) {
        case 's':
          skip();
          break;
        case 'p':
          if (queueState?.playbackPaused) {
            resumePlayback();
          } else {
            pausePlayback();
          }
          break;
        case 'i':
          if (queueState?.intakePaused) {
            resumeIntake();
          } else {
            pauseIntake();
          }
          break;
        case 'c':
          if (window.confirm('Clear entire queue?')) clear();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clear, pauseIntake, pausePlayback, queueState?.intakePaused, queueState?.playbackPaused, resumeIntake, resumePlayback, skip]);
}
