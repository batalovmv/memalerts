import type { QueueState } from '@/features/dock/types';

interface DockHeaderProps {
  connected: boolean;
  queueState: QueueState | null;
}

export function DockHeader({ connected, queueState }: DockHeaderProps) {
  const isReconnecting = !connected && !!queueState;
  const statusText = connected ? 'Connected' : isReconnecting ? 'Reconnecting...' : 'Disconnected';
  const statusClass = connected ? 'connected' : isReconnecting ? 'reconnecting' : 'disconnected';

  return (
    <div className="dock-header">
      <div className="status">
        <span className={`status-dot ${statusClass}`} />
        {statusText}
      </div>

      <div className="counters">
        <span className={`badge ${queueState?.intakePaused ? 'paused' : 'active'}`}>
          Intake: {queueState?.intakePaused ? '🔴' : '🟢'}
        </span>
        <span className={`badge ${queueState?.playbackPaused ? 'paused' : 'active'}`}>
          Play: {queueState?.playbackPaused ? '🔴' : '🟢'}
        </span>
      </div>

      <div className="stats">
        <span>Queue: {queueState?.queueLength ?? 0}</span>
        <span>Overlays: {queueState?.overlayCount ?? 0}</span>
        <span>Pending: {queueState?.pendingSubmissions ?? 0}</span>
      </div>
    </div>
  );
}
