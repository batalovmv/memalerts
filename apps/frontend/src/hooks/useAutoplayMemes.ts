import { useCallback, useEffect, useState } from 'react';
import { useAppSelector } from '@/store/hooks';
import { getUserPreferences, patchUserPreferences } from '@/shared/lib/userPreferences';

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
  const { user } = useAppSelector((s) => s.auth);
  const [enabled, setEnabled] = useState<boolean>(() => readInitial());

  // Backend-first hydration (when logged in).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const prefs = await getUserPreferences();
      if (cancelled) return;
      if (typeof prefs?.autoplayMemesEnabled === 'boolean') setEnabled(prefs.autoplayMemesEnabled);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const setAutoplayMemes = useCallback((next: boolean) => {
    setEnabled(next);
    if (user) {
      void patchUserPreferences({ autoplayMemesEnabled: next });
      return;
    }
    try {
      localStorage.setItem(KEY, next ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [user]);

  // Keep cross-tab sync only for anonymous/localStorage mode.
  useEffect(() => {
    if (user) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      setEnabled(readInitial());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user]);

  return { autoplayMemesEnabled: enabled, setAutoplayMemesEnabled: setAutoplayMemes };
}



