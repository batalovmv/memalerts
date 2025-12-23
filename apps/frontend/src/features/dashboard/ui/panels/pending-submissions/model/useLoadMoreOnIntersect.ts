import { useEffect, useRef } from 'react';

export function useLoadMoreOnIntersect(params: {
  enabled: boolean;
  hasMore: boolean;
  isLoading: boolean;
  rootMargin?: string;
  onLoadMore: () => void;
}) {
  const { enabled, hasMore, isLoading, onLoadMore, rootMargin = '400px 0px' } = params;
  const ref = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!hasMore) return;
    if (isLoading) return;
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            onLoadMore();
            return;
          }
        }
      },
      { root: null, rootMargin, threshold: 0.01 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled, hasMore, isLoading, onLoadMore, rootMargin]);

  return ref;
}


