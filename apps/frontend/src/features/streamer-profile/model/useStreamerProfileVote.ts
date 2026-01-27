import {
  CastVoteResponseSchema,
  CreateVoteResponseSchema,
  GetActiveVoteResponseSchema,
  type VoteSession,
} from '@memalerts/api-contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSocket } from '@/contexts/SocketContext';
import { api } from '@/lib/api';

type UseStreamerProfileVoteParams = {
  slug: string | undefined;
};

export function useStreamerProfileVote({ slug }: UseStreamerProfileVoteParams) {
  const { socket, isConnected } = useSocket();
  const [session, setSession] = useState<VoteSession | null>(null);
  const [myVoteIndex, setMyVoteIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [voting, setVoting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const lastSessionIdRef = useRef<string | null>(null);

  const loadActive = useCallback(async () => {
    if (!slug) return;
    try {
      setLoading(true);
      const raw = await api.get<unknown>(`/channels/${slug}/votes/active`, { timeout: 12000 });
      const parsed = GetActiveVoteResponseSchema.parse(raw);
      setSession(parsed.session ?? null);
      if (!parsed.session || parsed.session.id !== lastSessionIdRef.current) {
        setMyVoteIndex(null);
        lastSessionIdRef.current = parsed.session?.id ?? null;
      }
    } catch {
      // ignore - vote is optional UI
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const castVote = useCallback(
    async (optionIndex: number) => {
      if (!slug || !session?.id || voting) return;
      try {
        setVoting(true);
        const raw = await api.post<unknown>(`/channels/${slug}/votes/${session.id}`, { optionIndex });
        const parsed = CastVoteResponseSchema.parse(raw);
        setSession(parsed.session ?? null);
        if (parsed.myVoteIndex) setMyVoteIndex(parsed.myVoteIndex);
        if (parsed.session?.id) lastSessionIdRef.current = parsed.session.id;
      } finally {
        setVoting(false);
      }
    },
    [session?.id, slug, voting],
  );

  const createVote = useCallback(async () => {
    if (creating) return;
    try {
      setCreating(true);
      const raw = await api.post<unknown>('/streamer/votes', {});
      const parsed = CreateVoteResponseSchema.parse(raw);
      setSession(parsed.session ?? null);
      setMyVoteIndex(null);
      lastSessionIdRef.current = parsed.session?.id ?? null;
    } finally {
      setCreating(false);
    }
  }, [creating]);

  const closeVote = useCallback(async () => {
    if (!session?.id || closing) return;
    try {
      setClosing(true);
      await api.post(`/streamer/votes/${session.id}/close`);
    } finally {
      setClosing(false);
    }
  }, [closing, session?.id]);

  useEffect(() => {
    void loadActive();
  }, [loadActive]);

  useEffect(() => {
    if (!socket || !isConnected) return;
    const onVoteUpdated = (payload: { session?: VoteSession | null }) => {
      const next = payload?.session ?? null;
      setSession(next);
      if (!next || next.id !== lastSessionIdRef.current) {
        setMyVoteIndex(null);
        lastSessionIdRef.current = next?.id ?? null;
      }
    };
    socket.on('vote:updated', onVoteUpdated);
    return () => {
      socket.off('vote:updated', onVoteUpdated);
    };
  }, [isConnected, socket]);

  return {
    session,
    myVoteIndex,
    loading,
    voting,
    creating,
    closing,
    reload: loadActive,
    castVote,
    createVote,
    closeVote,
  };
}
