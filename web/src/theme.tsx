import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

/**
 * Where the theme is kept **on this device**.
 *
 * `localStorage` is still the only place a guest or a signed-out visitor has,
 * so it stays the store of record for them and for the pre-paint script. For
 * somebody signed in it is a cache of what their **account** says: the account
 * is adopted on sign-in and written back on every change (`session.tsx`,
 * `ARCHITECTURE.md` §9.1b). That is what makes the choice survive a browser
 * losing its storage, which is the way it was actually being lost.
 */
export const THEME_KEY = 'home-budget:theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    // Private-mode Safari throws on localStorage. Fall back to the OS.
    return 'system';
  }
}

/**
 * `data-theme` on `<html>` is the only thing the stylesheet keys off, and its
 * absence means "follow the OS". The inline script in `index.html` makes the
 * same assignment before first paint — keep the two in step, or a dark-mode
 * device gets a white flash on every load.
 */
export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/**
 * One theme for the whole app, in a context rather than a hook holding its own
 * state.
 *
 * It was a plain hook while `ThemeToggle` was the only thing that read it, and
 * that was fine right up until it was not: a second `useTheme()` caller gets a
 * *second copy* of the state, so the toggle and whatever else is setting the
 * theme would each move their own and neither would see the other. Adopting an
 * account's saved theme on sign-in (`session.tsx`) is exactly that second
 * caller.
 */
const ThemeContext = createContext<[Theme, (next: Theme) => void] | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not persisting is survivable; the choice still applies to this page.
    }
    setThemeState(next);
  }, []);

  const value = useMemo<[Theme, (next: Theme) => void]>(
    () => [theme, setTheme],
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
