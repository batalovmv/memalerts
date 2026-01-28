import type { QueueState } from '@/features/dock/types';

interface PendingMiniProps {
  queueState: QueueState | null;
}

export function PendingMini({ queueState }: PendingMiniProps) {
  const pending = queueState?.pendingSubmissions ?? 0;

  return (
    <div className={`dock-panel pending-mini ${pending > 0 ? 'has-pending' : ''}`}>
      <div className="dock-panel-title">Pending Moderation</div>
      <div className="pending-mini-body">
        <div className="pending-count">{pending}</div>
        <div className="pending-text">
          {pending > 0 ? 'Needs review' : 'All clear'}
        </div>
      </div>
    </div>
  );
}
