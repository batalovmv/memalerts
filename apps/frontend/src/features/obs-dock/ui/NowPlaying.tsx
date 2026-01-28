import { useEffect, useState } from 'react';

import type { QueueState } from '@/features/dock/types';

interface NowPlayingProps {
  queueState: QueueState | null;
  skip: () => void;
}

export function NowPlaying({ queueState, skip }: NowPlayingProps) {
  const current = queueState?.current;

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!current?.startedAt) {
      setElapsed(0);
      return;
    }

    const interval = window.setInterval(() => {
      const ms = Date.now() - new Date(current.startedAt).getTime();
      setElapsed(Math.max(0, ms));
    }, 100);

    return () => window.clearInterval(interval);
  }, [current?.activationId, current?.startedAt]);

  if (!current) {
    return (
      <div className="now-playing empty">
        <div className="label">NOW PLAYING</div>
        <div className="empty-text">
          {queueState?.playbackPaused ? 'Playback paused' : 'Queue empty'}
        </div>
      </div>
    );
  }

  const progress =
    current.durationMs > 0 ? Math.min(100, (elapsed / current.durationMs) * 100) : 0;

  const formatTime = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    return `${min}:${String(sec % 60).padStart(2, '0')}`;
  };

  return (
    <div className="now-playing">
      <div className="label">▶ NOW PLAYING</div>

      <div className="meme-info">
        <div className="title">{current.memeTitle}</div>
        {current.senderName && <div className="sender">от @{current.senderName}</div>}
      </div>

      <div className="progress-container">
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="time">
          {formatTime(elapsed)} / {formatTime(current.durationMs)}
        </div>
      </div>

      <div className="actions">
        <button className="dock-btn ban" title="Ban & Skip" type="button">
          🚫
        </button>
        <button className="dock-btn skip" onClick={skip} type="button">
          ⏭ Skip
        </button>
      </div>
    </div>
  );
}
