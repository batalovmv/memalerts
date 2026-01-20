import { useCallback, useEffect, useState } from 'react';

import { getUserPreferences, patchUserPreferences } from '@/shared/lib/userPreferences';
import { useAppSelector } from '@/store/hooks';

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
  const userId = user?.id;
  const [enabled, setEnabled] = useState<boolean>(() => readInitial());

  // Backend-first hydration (when logged in).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const prefs = await getUserPreferences();
      if (cancelled) return;
      if (typeof prefs?.autoplayMemesEnabled === 'boolean') setEnabled(prefs.autoplayMemesEnabled);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setAutoplayMemes = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(KEY, next ? 'true' : 'false');
    } catch {
      // ignore
    }
    if (user) {
      void patchUserPreferences({ autoplayMemesEnabled: next });
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



