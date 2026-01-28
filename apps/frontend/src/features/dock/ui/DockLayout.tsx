import { Button, Card, Spinner } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';

import type { QueueState } from '../types';
import { ControlPanel } from './ControlPanel';
import { CurrentCard } from './CurrentCard';
import { NextList } from './NextList';
import { StatusBar } from './StatusBar';

interface DockLayoutProps {
  queueState: QueueState | null;
  connected: boolean;
  error: string | null;
  onSkip: () => void;
  onClear: () => void;
  onPauseIntake: () => void;
  onResumeIntake: () => void;
  onPausePlayback: () => void;
  onResumePlayback: () => void;
}

export function DockLayout({
  queueState,
  connected,
  error,
  onSkip,
  onClear,
  onPauseIntake,
  onResumeIntake,
  onPausePlayback,
  onResumePlayback,
}: DockLayoutProps) {
  const isLoading = queueState === null && !error;
  const showReconnectOverlay = !connected && !isLoading && !error;

  const overlayConnected = queueState?.overlayConnected ?? false;
  const overlayCount = queueState?.overlayCount ?? 0;
  const intakePaused = queueState?.intakePaused ?? false;
  const playbackPaused = queueState?.playbackPaused ?? false;
  const queueLength = queueState?.queueLength ?? 0;
  const pendingSubmissions = queueState?.pendingSubmissions ?? 0;

  if (error) {
    return (
      <div className="dark">
        <div className="min-h-screen w-full bg-slate-950 text-slate-100 px-4 py-6">
          <Card className="mx-auto flex w-full max-w-[420px] flex-col gap-4 p-5 text-center">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-300">Dock error</div>
            <div className="text-sm text-slate-200">{error}</div>
            <Button type="button" variant="primary" size="sm" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="dark">
      <div className="min-h-screen w-full bg-slate-950 text-slate-100">
        <div className="relative mx-auto flex min-h-screen w-full max-w-[460px] flex-col gap-3 px-3 py-4">
          <StatusBar
            connected={connected}
            overlayConnected={overlayConnected}
            overlayCount={overlayCount}
            intakePaused={intakePaused}
            playbackPaused={playbackPaused}
          />

          {isLoading ? (
            <Card className="flex flex-1 items-center justify-center gap-3 p-6 text-sm text-slate-300">
              <Spinner className="h-5 w-5" />
              <span>Waiting for queue data...</span>
            </Card>
          ) : (
            <>
              <section className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  <span>▶ Now playing</span>
                  {playbackPaused ? (
                    <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-200">
                      Paused
                    </span>
                  ) : null}
                </div>
                <CurrentCard current={queueState?.current ?? null} playbackPaused={playbackPaused} />
              </section>

              <ControlPanel
                intakePaused={intakePaused}
                playbackPaused={playbackPaused}
                hasCurrentMeme={Boolean(queueState?.current)}
                queueLength={queueLength}
                onSkip={onSkip}
                onClear={onClear}
                onPauseIntake={onPauseIntake}
                onResumeIntake={onResumeIntake}
                onPausePlayback={onPausePlayback}
                onResumePlayback={onResumePlayback}
              />

              <section className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  <span>Next up</span>
                  <span className="text-slate-500">{queueLength} in queue</span>
                </div>
                <NextList items={queueState?.next ?? []} totalCount={queueLength} />
              </section>

              <div
                className={cn(
                  'mt-auto rounded-xl px-3 py-2 text-xs',
                  'bg-slate-900/60 text-slate-300 ring-1 ring-white/10',
                )}
              >
                <div className="flex items-center justify-between">
                  <span>📥 {pendingSubmissions} pending submissions</span>
                  <span className="text-slate-400">{intakePaused ? 'Intake paused' : 'Intake live'}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Shortcuts: S=Skip, C=Clear, I=Intake, P=Playback
                </div>
              </div>
            </>
          )}

          {showReconnectOverlay ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-950/80 backdrop-blur-sm">
              <div className="flex items-center gap-3 rounded-xl bg-slate-900/80 px-4 py-3 text-sm text-slate-200 ring-1 ring-white/10">
                <Spinner className="h-5 w-5" />
                Reconnecting...
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
