import { useEffect, useMemo, useState } from 'react';

import type { WheelPrize } from '@memalerts/api-contracts';

type WheelSpinOverlayProps = {
  spin: {
    id: string;
    displayName: string | null;
    prize: WheelPrize;
  } | null;
};

const TIERS: WheelPrize['tier'][] = ['small', 'medium', 'good', 'big', 'jackpot', 'super'];
const COLORS: Record<WheelPrize['tier'], string> = {
  small: '#7dd3fc',
  medium: '#fcd34d',
  good: '#34d399',
  big: '#fb7185',
  jackpot: '#a78bfa',
  super: '#f97316',
};

function buildConicGradient(): string {
  const slice = 360 / TIERS.length;
  const stops = TIERS.map((tier, idx) => {
    const start = Math.round(idx * slice);
    const end = Math.round((idx + 1) * slice);
    return `${COLORS[tier]} ${start}deg ${end}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export function WheelSpinOverlay({ spin }: WheelSpinOverlayProps) {
  const [rotation, setRotation] = useState(0);

  const gradient = useMemo(() => buildConicGradient(), []);
  const tierIndex = useMemo(() => {
    if (!spin) return 0;
    const idx = TIERS.indexOf(spin.prize.tier);
    return idx >= 0 ? idx : 0;
  }, [spin]);

  useEffect(() => {
    if (!spin) return;
    const slice = 360 / TIERS.length;
    const targetCenter = tierIndex * slice + slice / 2;
    const baseTurns = 4 + Math.floor(Math.random() * 2);
    const offset = 360 - targetCenter;
    const nextRotation = baseTurns * 360 + offset;
    requestAnimationFrame(() => setRotation(nextRotation));
  }, [spin, tierIndex]);

  if (!spin) return null;

  const winnerLabel = spin.displayName ? `${spin.displayName}` : 'Viewer';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '6%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <style>{`
        @keyframes memalertsWheelPop {
          from { opacity: 0; transform: translateY(12px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes memalertsWheelGlow {
          0% { box-shadow: 0 0 0 rgba(0,0,0,0); }
          60% { box-shadow: 0 0 30px rgba(255,255,255,0.22); }
          100% { box-shadow: 0 0 10px rgba(0,0,0,0.2); }
        }
      `}</style>
      <div
        style={{
          position: 'relative',
          width: 280,
          height: 280,
          animation: 'memalertsWheelPop 320ms ease-out both',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: gradient,
            border: '6px solid rgba(255,255,255,0.7)',
            boxShadow: '0 18px 45px rgba(0,0,0,0.35)',
            transform: `rotate(${rotation}deg)`,
            transition: 'transform 4.6s cubic-bezier(0.12, 0.8, 0.2, 1)',
            animation: 'memalertsWheelGlow 4.6s ease-out',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: -16,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '14px solid transparent',
            borderRight: '14px solid transparent',
            borderBottom: '22px solid #111827',
            filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 16,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.45), rgba(0,0,0,0.65))',
          }}
        />
      </div>
      <div
        style={{
          padding: '8px 14px',
          borderRadius: 999,
          background: 'rgba(15,23,42,0.88)',
          color: 'white',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.2,
          textAlign: 'center',
        }}
      >
        {winnerLabel} · {spin.prize.label} (+{spin.prize.coins})
      </div>
    </div>
  );
}
