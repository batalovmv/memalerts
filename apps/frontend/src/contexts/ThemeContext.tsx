import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';

import { getUserPreferences, patchUserPreferences, type ThemePreference } from '@/shared/lib/userPreferences';
import { useAppSelector } from '@/store/hooks';

type Theme = ThemePreference;

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAppSelector((s) => s.auth);
  const userId = user?.id;
  const hydratedFromBackendRef = useRef(false);

  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('theme');
      return (saved as Theme) || 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    // Persist theme locally only for guests (logged-in users are persisted in backend).
    if (!user) {
      try {
        localStorage.setItem('theme', theme);
      } catch {
        // ignore
      }
    }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme, user]);

  // Backend-first hydration (when logged in). Keeps localStorage as a safe fallback until backend is deployed.
  useEffect(() => {
    if (!userId) {
      hydratedFromBackendRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      const prefs = await getUserPreferences();
      if (cancelled) return;
      if (prefs?.theme === 'light' || prefs?.theme === 'dark') {
        hydratedFromBackendRef.current = true;
        setTheme(prefs.theme);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      // Best-effort persist to backend (if available).
      if (user) void patchUserPreferences({ theme: next });
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

