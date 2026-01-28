import { useEffect, useRef, useState } from 'react';

import { Card } from '@/shared/ui';
import type { QueueState } from '../types';

interface CurrentCardProps {
  current: QueueState['current'];
  playbackPaused?: boolean;
}

const formatTime = (ms: number) => {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export function CurrentCard({ current, playbackPaused = false }: CurrentCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const pausedAtRef = useRef<number | null>(null);
  const totalPausedRef = useRef<number>(0);
  const lastActivationIdRef = useRef<string | null>(null);

  // Reset total paused time when activation changes
  useEffect(() => {
    if (current?.activationId !== lastActivationIdRef.current) {
      lastActivationIdRef.current = current?.activationId ?? null;
      totalPausedRef.current = 0;
      pausedAtRef.current = null;
    }
  }, [current?.activationId]);

  // Track pause state and accumulate total pause duration
  useEffect(() => {
    if (playbackPaused && pausedAtRef.current === null) {
      pausedAtRef.current = Date.now();
    } else if (!playbackPaused && pausedAtRef.current !== null) {
      totalPausedRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
  }, [playbackPaused]);

  useEffect(() => {
    if (!current?.startedAt) {
      setNow(Date.now());
      return;
    }

    // Don't update timer when paused
    if (playbackPaused) {
      return;
    }

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [current?.activationId, current?.startedAt, current?.durationMs, playbackPaused]);

  if (!current) {
    return (
      <Card className="flex items-center justify-center p-4 text-sm text-slate-300">
        No meme playing
      </Card>
    );
  }

  const durationMs = Math.max(0, current.durationMs);
  const startedAt = current.startedAt ? new Date(current.startedAt).getTime() : null;
  // When paused, use pausedAt as "now" to freeze the display
  const effectiveNow = pausedAtRef.current ?? now;
  const elapsedMs = startedAt ? Math.max(0, effectiveNow - startedAt - totalPausedRef.current) : 0;
  const clampedMs = durationMs > 0 ? Math.min(elapsedMs, durationMs) : 0;
  const progress = durationMs > 0 ? (clampedMs / durationMs) * 100 : 0;

  const senderLabel = current.senderName ? `@${current.senderName}` : 'anonymous';
  const priceLabel = `${current.priceCoins}🪙`;

  return (
    <Card className="p-4">
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="truncate text-sm font-semibold text-slate-100">{current.memeTitle}</div>
          <div className="text-xs text-slate-400">
            from: {senderLabel} • {priceLabel}
          </div>
        </div>

        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400 transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-end text-[11px] text-slate-400">
            {formatTime(clampedMs)} / {formatTime(durationMs)}
          </div>
        </div>
      </div>
    </Card>
  );
}
