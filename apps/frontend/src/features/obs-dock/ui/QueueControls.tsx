import { useState } from 'react';

import type { QueueState } from '@/features/dock/types';

interface QueueControlsProps {
  queueState: QueueState | null;
  clear: () => void;
  pauseIntake: () => void;
  resumeIntake: () => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
}

export function QueueControls({
  queueState,
  clear,
  pauseIntake,
  resumeIntake,
  pausePlayback,
  resumePlayback,
}: QueueControlsProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClear = () => {
    if (confirmClear) {
      clear();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 3000);
    }
  };

  return (
    <div className="queue-controls">
      <button
        className={`dock-btn pause ${queueState?.intakePaused ? 'active' : ''}`}
        onClick={queueState?.intakePaused ? resumeIntake : pauseIntake}
        type="button"
      >
        {queueState?.intakePaused ? '▶ Resume Intake' : '⏸ Pause Intake'}
      </button>

      <button
        className={`dock-btn pause ${queueState?.playbackPaused ? 'active' : ''}`}
        onClick={queueState?.playbackPaused ? resumePlayback : pausePlayback}
        type="button"
      >
        {queueState?.playbackPaused ? '▶ Resume Play' : '⏸ Pause Play'}
      </button>

      <button className={`dock-btn clear ${confirmClear ? 'confirm' : ''}`} onClick={handleClear} type="button">
        {confirmClear ? '⚠️ Confirm Clear?' : '🗑 Clear Queue'}
      </button>
    </div>
  );
}
