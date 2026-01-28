import { Card } from '@/shared/ui';

import type { QueueState } from '../types';

interface NextListProps {
  items: QueueState['next'];
  totalCount: number;
}

export function NextList({ items, totalCount }: NextListProps) {
  const visible = items.slice(0, 5);
  const extra = Math.max(0, totalCount - visible.length);

  if (visible.length === 0) {
    return (
      <Card className="p-4 text-center text-sm text-slate-300">
        Queue is empty
      </Card>
    );
  }

  return (
    <Card className="p-3">
      <ol className="space-y-2">
        {visible.map((item, index) => (
          <li
            key={item.activationId}
            className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/70 px-3 py-2 text-xs text-slate-200"
          >
            <span className="text-[11px] text-slate-400">{index + 1}.</span>
            <span className="flex-1 truncate text-sm text-slate-100">{item.memeTitle}</span>
            <span className="truncate text-[11px] text-slate-400">
              {item.senderName ? `@${item.senderName}` : 'anonymous'}
            </span>
          </li>
        ))}
      </ol>
      {extra > 0 ? (
        <div className="mt-2 text-right text-[11px] text-slate-400">+{extra} more</div>
      ) : null}
    </Card>
  );
}
