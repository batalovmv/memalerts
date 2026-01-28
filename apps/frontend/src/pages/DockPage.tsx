import { useSearchParams } from 'react-router-dom';

import { useDockSocket } from '@/features/dock/api/useDockSocket';
import { useDockHotkeys } from '@/features/dock/hooks/useDockHotkeys';
import { DockLayout } from '@/features/dock/ui/DockLayout';
import { Card } from '@/shared/ui';

export function DockPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const { connected, error, queueState, skip, clear, pauseIntake, resumeIntake, pausePlayback, resumePlayback } =
    useDockSocket(token);

  useDockHotkeys({
    skip: () => skip(),
    clear: () => clear(),
    toggleIntake: () => (queueState?.intakePaused ? resumeIntake() : pauseIntake()),
    togglePlayback: () => (queueState?.playbackPaused ? resumePlayback() : pausePlayback()),
  });

  if (!token) {
    return (
      <div className="dark">
        <div className="min-h-screen w-full bg-slate-950 text-slate-100 px-4 py-6">
          <Card className="mx-auto w-full max-w-[420px] p-4 text-center text-sm text-slate-200">
            Missing dock token
          </Card>
        </div>
      </div>
    );
  }

  return (
    <DockLayout
      connected={connected}
      queueState={queueState}
      error={error}
      onSkip={skip}
      onClear={clear}
      onPauseIntake={pauseIntake}
      onResumeIntake={resumeIntake}
      onPausePlayback={pausePlayback}
      onResumePlayback={resumePlayback}
    />
  );
}

export default DockPage;
