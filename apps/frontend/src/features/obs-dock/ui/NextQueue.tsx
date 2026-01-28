import type { QueueState } from '@/features/dock/types';

interface NextQueueProps {
  queueState: QueueState | null;
}

export function NextQueue({ queueState }: NextQueueProps) {
  const next = queueState?.next ?? [];

  if (next.length === 0) {
    return null;
  }

  return (
    <div className="next-queue">
      <div className="label">NEXT UP</div>
      <ul className="queue-list">
        {next.map((item, i) => (
          <li key={item.activationId} className="queue-item">
            <span className="position">{i + 1}.</span>
            <span className="title">{item.memeTitle}</span>
            {item.senderName && <span className="sender">@{item.senderName}</span>}
          </li>
        ))}
      </ul>
      {queueState && queueState.queueLength > next.length && (
        <div className="more">+{queueState.queueLength - next.length} more</div>
      )}
    </div>
  );
}
