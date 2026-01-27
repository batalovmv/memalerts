import { useMemo } from 'react';

type EventConfettiProps = {
  accent: string;
  burstKey: number;
};

export function EventConfetti({ accent, burstKey }: EventConfettiProps) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }).map((_, index) => ({
        id: `${burstKey}-${index}`,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        size: 6 + Math.random() * 8,
        rotate: Math.random() * 360,
      })),
    [burstKey],
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 30,
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes memalertsConfettiFall {
          0% { transform: translateY(-20vh) rotate(0deg); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(120vh) rotate(360deg); opacity: 0; }
        }
      `}</style>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          style={{
            position: 'absolute',
            top: '-20vh',
            left: `${piece.left}%`,
            width: piece.size,
            height: piece.size * 0.6,
            background: accent,
            borderRadius: 2,
            opacity: 0.9,
            transform: `rotate(${piece.rotate}deg)`,
            animation: `memalertsConfettiFall 2.8s ease-in ${piece.delay}s forwards`,
            boxShadow: '0 6px 12px rgba(0,0,0,0.25)',
          }}
        />
      ))}
    </div>
  );
}
