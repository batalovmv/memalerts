import { useCallback, useEffect, useState } from 'react';

const KEY = 'autoplayMemes';

function readInitial(): boolean {
  // Default: enabled (matches current public profile behavior).
  try {
    const v = localStorage.getItem(KEY);
    if (v === null) return true;
    return v !== 'false';
  } catch {
    return true;
  }
}

export function useAutoplayMemes() {
  const [enabled, setEnabled] = useState<boolean>(() => readInitial());

  const setAutoplayMemes = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(KEY, next ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      setEnabled(readInitial());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { autoplayMemesEnabled: enabled, setAutoplayMemesEnabled: setAutoplayMemes };
}


