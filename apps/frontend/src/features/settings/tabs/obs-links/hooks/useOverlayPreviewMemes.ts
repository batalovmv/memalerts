import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PreviewMeme } from '../types';

type UseOverlayPreviewMemesOptions = {
  channelSlug: string;
  overlayMode: 'queue' | 'simultaneous';
  overlayMaxConcurrent: number;
};

export type OverlayPreviewMemesState = ReturnType<typeof useOverlayPreviewMemes>;

export function useOverlayPreviewMemes({ channelSlug, overlayMode, overlayMaxConcurrent }: UseOverlayPreviewMemesOptions) {
  const [previewMemes, setPreviewMemes] = useState<PreviewMeme[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewInitialized, setPreviewInitialized] = useState(false);
  const [previewSeed, setPreviewSeed] = useState(1);
  const previewSeedRef = useRef(1);
  const previewCacheRef = useRef(new Map<string, { at: number; memes: PreviewMeme[] }>());
  const previewInFlightRef = useRef(new Map<string, Promise<PreviewMeme[]>>());

  const previewCount = useMemo(
    () => (overlayMode === 'queue' ? 1 : Math.min(5, Math.max(1, overlayMaxConcurrent))),
    [overlayMaxConcurrent, overlayMode]
  );

  useEffect(() => {
    previewSeedRef.current = previewSeed;
  }, [previewSeed]);

  const fetchPreviewMemes = useCallback(
    async (count?: number, seed?: number, opts?: { commitSeed?: boolean }) => {
      const n = Math.min(5, Math.max(1, Number.isFinite(count) ? Number(count) : previewCount));
      const PREVIEW_TTL_MS = 5_000;
      try {
        const { api } = await import('@/lib/api');
        const effectiveSeed = Number.isFinite(seed) ? String(seed) : String(previewSeedRef.current || 1);
        const cacheKey = `${n}:${effectiveSeed}`;

        const now = Date.now();
        const mem = previewCacheRef.current.get(cacheKey);
        if (mem && now - mem.at < PREVIEW_TTL_MS) {
          setPreviewMemes(mem.memes);
          if (opts?.commitSeed && Number.isFinite(seed)) {
            previewSeedRef.current = seed!;
            setPreviewSeed(seed!);
          }
          return;
        }
        try {
          const raw = sessionStorage.getItem(`memalerts:obsLinks:previewMemes:${cacheKey}`);
          if (raw) {
            const parsed = JSON.parse(raw) as { at?: unknown; memes?: unknown };
            const at = typeof parsed?.at === 'number' ? parsed.at : 0;
            const cached = Array.isArray(parsed?.memes)
              ? (parsed.memes as Array<{ fileUrl: string; type: string; title?: string }>)
              : null;
            if (at > 0 && cached && now - at < PREVIEW_TTL_MS) {
              previewCacheRef.current.set(cacheKey, { at, memes: cached });
              setPreviewMemes(cached);
              if (opts?.commitSeed && Number.isFinite(seed)) {
                previewSeedRef.current = seed!;
                setPreviewSeed(seed!);
              }
              return;
            }
          }
        } catch {
          // ignore cache
        }

        setLoadingPreview(true);

        const existing = previewInFlightRef.current.get(cacheKey);
        if (existing) {
          const memes = await existing;
          setPreviewMemes(memes);
          if (opts?.commitSeed && Number.isFinite(seed)) {
            previewSeedRef.current = seed!;
            setPreviewSeed(seed!);
          }
          return;
        }

        const req = (async () => {
          const resp = await api.get<{ memes: Array<null | { fileUrl: string; type: string; title?: string }> }>(
            '/streamer/overlay/preview-memes',
            {
              params: { count: n, seed: effectiveSeed, _ts: Date.now() },
              headers: { 'Cache-Control': 'no-store' },
            }
          );

          const list = Array.isArray(resp?.memes) ? resp.memes : [];
          const cleaned: Array<{ fileUrl: string; type: string; title?: string }> = [];
          const seen = new Set<string>();
          for (const m of list) {
            if (!m?.fileUrl) continue;
            if (seen.has(m.fileUrl)) continue;
            seen.add(m.fileUrl);
            cleaned.push({ fileUrl: m.fileUrl, type: m.type, title: m.title });
          }
          return cleaned;
        })();

        previewInFlightRef.current.set(cacheKey, req);
        const cleaned = await req;
        previewInFlightRef.current.delete(cacheKey);

        previewCacheRef.current.set(cacheKey, { at: now, memes: cleaned });
        try {
          sessionStorage.setItem(
            `memalerts:obsLinks:previewMemes:${cacheKey}`,
            JSON.stringify({ at: now, memes: cleaned })
          );
        } catch {
          // ignore cache
        }

        setPreviewMemes(cleaned);
        if (opts?.commitSeed && Number.isFinite(seed)) {
          previewSeedRef.current = seed!;
          setPreviewSeed(seed!);
        }
      } catch {
        previewInFlightRef.current.clear();
        setPreviewMemes([]);
      } finally {
        setLoadingPreview(false);
      }
    },
    [previewCount]
  );

  useEffect(() => {
    if (!channelSlug) return;
    void fetchPreviewMemes(previewCount, previewSeedRef.current).finally(() => setPreviewInitialized(true));
  }, [channelSlug, fetchPreviewMemes, previewCount]);

  return {
    previewMemes,
    loadingPreview,
    previewInitialized,
    previewSeed,
    setPreviewSeed,
    previewCount,
    fetchPreviewMemes,
  };
}
