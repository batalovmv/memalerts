import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type HelpModeContextValue = {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  toggle: () => void;
};

const HelpModeContext = createContext<HelpModeContextValue | null>(null);

const STORAGE_KEY = 'memalerts.dashboard.helpMode';

function readStored(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return false;
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

function writeStored(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // ignore
  }
}

export function HelpModeProvider(props: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(() => readStored());

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    writeStored(next);
  }, []);

  const toggle = useCallback(() => {
    setEnabledState((prev) => {
      const next = !prev;
      writeStored(next);
      return next;
    });
  }, []);

  // Sync across tabs/windows.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setEnabledState(readStored());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled, toggle }), [enabled, setEnabled, toggle]);
  return <HelpModeContext.Provider value={value}>{props.children}</HelpModeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useHelpMode(): HelpModeContextValue {
  const ctx = useContext(HelpModeContext);
  if (!ctx) {
    // In practice should never happen because we wrap <App /> in provider.
    return { enabled: false, setEnabled: () => {}, toggle: () => {} };
  }
  return ctx;
}


