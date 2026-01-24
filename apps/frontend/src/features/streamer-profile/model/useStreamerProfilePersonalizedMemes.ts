import { useEffect, useState } from 'react';

import type { ChannelInfo } from '@/features/streamer-profile/model/types';
import type { Meme } from '@/types';

import { getPersonalizedMemes, getTasteProfile, type TasteProfileTopTag } from '@/shared/api';

type UseStreamerProfilePersonalizedMemesParams = {
  channelInfo: ChannelInfo | null;
  normalizedSlug: string;
  isAuthed: boolean;
  reloadNonce: number;
};

type UseStreamerProfilePersonalizedMemesState = {
  memes: Meme[];
  loading: boolean;
  profileReady: boolean;
  totalActivations: number;
  topTags: TasteProfileTopTag[];
  mode: 'personalized' | 'fallback';
};

export function useStreamerProfilePersonalizedMemes({
  channelInfo,
  normalizedSlug,
  isAuthed,
  reloadNonce,
}: UseStreamerProfilePersonalizedMemesParams): UseStreamerProfilePersonalizedMemesState {
  const [memes, setMemes] = useState<Meme[]>([]);
  const [loading, setLoading] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [totalActivations, setTotalActivations] = useState(0);
  const [topTags, setTopTags] = useState<TasteProfileTopTag[]>([]);
  const [mode, setMode] = useState<'personalized' | 'fallback'>('fallback');

  useEffect(() => {
    if (!channelInfo?.id || !normalizedSlug) return;
    if (!isAuthed) {
      setMemes([]);
      setProfileReady(false);
      setTotalActivations(0);
      setTopTags([]);
      setMode('fallback');
      return;
    }

    let cancelled = false;
    setLoading(true);

    const run = async () => {
      try {
        const [profileResult, personalizedResult] = await Promise.allSettled([
          getTasteProfile(),
          getPersonalizedMemes(normalizedSlug, { limit: 12 }),
        ]);
        if (cancelled) return;
        const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
        const personalized = personalizedResult.status === 'fulfilled' ? personalizedResult.value : null;

        setTopTags(Array.isArray(profile?.topTags) ? profile?.topTags : []);
        setProfileReady(Boolean(profile?.profileReady || personalized?.profileReady));
        setTotalActivations(
          typeof profile?.totalActivations === 'number' && Number.isFinite(profile?.totalActivations)
            ? profile.totalActivations
            : personalized?.totalActivations ?? 0,
        );
        setMode(personalized?.mode || 'fallback');
        setMemes(Array.isArray(personalized?.items) ? personalized.items : []);
      } catch {
        if (cancelled) return;
        setTopTags([]);
        setProfileReady(false);
        setTotalActivations(0);
        setMode('fallback');
        setMemes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [channelInfo?.id, isAuthed, normalizedSlug, reloadNonce]);

  return { memes, loading, profileReady, totalActivations, topTags, mode };
}
