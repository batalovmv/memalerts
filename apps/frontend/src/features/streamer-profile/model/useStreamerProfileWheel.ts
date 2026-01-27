import {
  GetWheelStateResponseSchema,
  SpinWheelResponseSchema,
  type WheelPrize,
  type WheelSpin,
  type WheelState,
} from '@memalerts/api-contracts';
import { useCallback, useEffect, useState } from 'react';

import { useSocket } from '@/contexts/SocketContext';
import { api } from '@/lib/api';

type UseStreamerProfileWheelParams = {
  slug: string | undefined;
};

type WheelSpinEvent = {
  displayName: string | null;
  prize: WheelPrize;
};

export function useStreamerProfileWheel({ slug }: UseStreamerProfileWheelParams) {
  const { socket, isConnected } = useSocket();
  const [state, setState] = useState<WheelState | null>(null);
  const [lastSpin, setLastSpin] = useState<WheelSpin | null>(null);
  const [lastSpinEvent, setLastSpinEvent] = useState<WheelSpinEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);

  const loadState = useCallback(async () => {
    if (!slug) return;
    try {
      setLoading(true);
      const raw = await api.get<unknown>(`/channels/${slug}/wheel`, { timeout: 12000 });
      const parsed = GetWheelStateResponseSchema.parse(raw);
      setState(parsed);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const spinWheel = useCallback(
    async (mode: 'free' | 'paid') => {
      if (!slug || spinning) return;
      try {
        setSpinning(true);
        const raw = await api.post<unknown>(`/channels/${slug}/wheel/spin`, { mode });
        const parsed = SpinWheelResponseSchema.parse(raw);
        setLastSpin(parsed.spin ?? null);
        if (parsed.state) setState(parsed.state);
        return parsed;
      } finally {
        setSpinning(false);
      }
    },
    [slug, spinning],
  );

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    if (!socket || !isConnected) return;
    const onSpin = (payload: { displayName?: string | null; prize?: WheelPrize }) => {
      if (!payload?.prize) return;
      setLastSpinEvent({
        displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
        prize: payload.prize,
      });
    };
    socket.on('wheel:spin', onSpin);
    return () => {
      socket.off('wheel:spin', onSpin);
    };
  }, [isConnected, socket]);

  return {
    state,
    lastSpin,
    lastSpinEvent,
    loading,
    spinning,
    reload: loadState,
    spinWheel,
  };
}
