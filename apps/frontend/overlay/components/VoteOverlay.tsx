import { useMemo } from 'react';

import type { VoteSession } from '@memalerts/api-contracts';

const formatTimeLeft = (endsAt?: string | null): string => {
  if (!endsAt) return '';
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return '';
  const diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
  if (diff <= 0) return '0s';
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

type VoteOverlayProps = {
  session: VoteSession | null;
  visible: boolean;
};

export function VoteOverlay({ session, visible }: VoteOverlayProps) {
  const timeLeft = useMemo(() => formatTimeLeft(session?.endsAt ?? null), [session?.endsAt]);

  if (!session || !visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '6%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        width: 'min(920px, 92vw)',
        background: 'rgba(15, 23, 42, 0.78)',
        borderRadius: 24,
        padding: 16,
        color: 'white',
        boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
        pointerEvents: 'none',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.3 }}>Vote for best meme</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
            {session.status === 'active' ? 'Vote is live' : 'Vote ended'}
            {timeLeft && session.status === 'active' ? ` · Ends in ${timeLeft}` : ''}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Total votes: {session.totalVotes}</div>
      </div>
      <div
        style={{
          marginTop: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        {session.options.map((option) => (
          <div
            key={option.index}
            style={{
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 16,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: 'rgba(0,0,0,0.4)' }}>
              {option.previewUrl ? (
                <img
                  src={option.previewUrl}
                  alt={option.title}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : null}
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(0,0,0,0.6)',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {option.index}
              </div>
            </div>
            <div style={{ padding: '8px 10px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {option.title}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{option.totalVotes} votes</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
