import { useHotkeys } from '../hooks/useHotkeys';
import type { QueueState } from '@/features/dock/types';

import './dock.css';
import { DockHeader } from './DockHeader';
import { HotkeyHint } from './HotkeyHint';
import { NextQueue } from './NextQueue';
import { NowPlaying } from './NowPlaying';
import { PendingMini } from './PendingMini';
import { QueueControls } from './QueueControls';

interface DockLayoutProps {
  connected: boolean;
  queueState: QueueState | null;
  skip: () => void;
  clear: () => void;
  pauseIntake: () => void;
  resumeIntake: () => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
}

export function DockLayout({
  connected,
  queueState,
  skip,
  clear,
  pauseIntake,
  resumeIntake,
  pausePlayback,
  resumePlayback,
}: DockLayoutProps) {
  useHotkeys(queueState, {
    skip,
    clear,
    pauseIntake,
    resumeIntake,
    pausePlayback,
    resumePlayback,
  });

  return (
    <div className="dock-container">
      <DockHeader connected={connected} queueState={queueState} />
      <NowPlaying queueState={queueState} skip={skip} />
      <NextQueue queueState={queueState} />
      <PendingMini queueState={queueState} />
      <QueueControls
        queueState={queueState}
        clear={clear}
        pauseIntake={pauseIntake}
        resumeIntake={resumeIntake}
        pausePlayback={pausePlayback}
        resumePlayback={resumePlayback}
      />
      <HotkeyHint />
    </div>
  );
}
