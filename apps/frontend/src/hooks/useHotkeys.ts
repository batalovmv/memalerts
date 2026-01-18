import { type DependencyList, useEffect } from 'react';

export function useHotkeys(
  handler: (event: KeyboardEvent) => void,
  deps: DependencyList,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => handler(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, handler, ...deps]);
}
