import { Pill } from '@/shared/ui';

interface StatusBarProps {
  connected: boolean;
  overlayConnected: boolean;
  overlayCount: number;
  intakePaused: boolean;
  playbackPaused: boolean;
}

export function StatusBar({
  connected,
  overlayConnected,
  overlayCount,
  intakePaused,
  playbackPaused,
}: StatusBarProps) {
  const statusIcon = overlayConnected ? '🟢' : '🔴';
  const statusLabel = overlayConnected ? 'Overlay connected' : 'Overlay disconnected';

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/70 px-3 py-2 text-xs ring-1 ring-white/10">
      <div className="flex min-w-0 items-center gap-2 font-semibold text-slate-100">
        <span aria-hidden="true">{statusIcon}</span>
        <span className="truncate">{statusLabel}</span>
        {overlayCount > 1 ? (
          <Pill variant="neutral" size="sm" className="text-[10px] px-2 py-0.5">
            {overlayCount} overlays
          </Pill>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {!connected ? (
          <Pill variant="warning" size="sm" className="text-[10px] px-2 py-0.5">
            Reconnecting
          </Pill>
        ) : null}
        {intakePaused ? (
          <Pill variant="warning" size="sm" className="text-[10px] px-2 py-0.5">
            Intake paused
          </Pill>
        ) : null}
        {playbackPaused ? (
          <Pill variant="warning" size="sm" className="text-[10px] px-2 py-0.5">
            Playback paused
          </Pill>
        ) : null}
      </div>
    </div>
  );
}
