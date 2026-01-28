import { useCallback } from 'react';

import { Button, Card } from '@/shared/ui';

interface ControlPanelProps {
  intakePaused: boolean;
  playbackPaused: boolean;
  hasCurrentMeme: boolean;
  queueLength: number;
  onSkip: () => void;
  onClear: () => void;
  onPauseIntake: () => void;
  onResumeIntake: () => void;
  onPausePlayback: () => void;
  onResumePlayback: () => void;
}

export function ControlPanel({
  intakePaused,
  playbackPaused,
  hasCurrentMeme,
  queueLength,
  onSkip,
  onClear,
  onPauseIntake,
  onResumeIntake,
  onPausePlayback,
  onResumePlayback,
}: ControlPanelProps) {
  const handleClear = useCallback(() => {
    if (queueLength <= 0) return;
    const confirmed = window.confirm('Clear the queue? This cannot be undone.');
    if (confirmed) onClear();
  }, [onClear, queueLength]);

  const handleIntakeToggle = useCallback(() => {
    if (intakePaused) {
      onResumeIntake();
    } else {
      onPauseIntake();
    }
  }, [intakePaused, onPauseIntake, onResumeIntake]);

  const handlePlaybackToggle = useCallback(() => {
    if (playbackPaused) {
      onResumePlayback();
    } else {
      onPausePlayback();
    }
  }, [playbackPaused, onPausePlayback, onResumePlayback]);

  return (
    <Card className="p-3">
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" variant="warning" onClick={onSkip} disabled={!hasCurrentMeme}>
          ⏭ Skip
        </Button>
        <Button type="button" size="sm" variant="danger" onClick={handleClear} disabled={queueLength <= 0}>
          🗑 Clear queue
        </Button>
        <Button
          type="button"
          size="sm"
          variant={intakePaused ? 'success' : 'secondary'}
          onClick={handleIntakeToggle}
          aria-pressed={intakePaused}
        >
          {intakePaused ? '▶ Resume intake' : '⏸ Pause intake'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={playbackPaused ? 'success' : 'secondary'}
          onClick={handlePlaybackToggle}
          aria-pressed={playbackPaused}
        >
          {playbackPaused ? '▶ Resume playback' : '⏸ Pause'}
        </Button>
      </div>
    </Card>
  );
}
