import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

/**
 * The theme is a **per-device** preference, deliberately not a household or
 * user setting: the same person may want dark on a phone at night and light on
 * a laptop, and a guest with no account has to be able to set it too. So it
 * lives in `localStorage` alongside the guest's name and never touches the API.
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

export function useTheme(): [Theme, (next: Theme) => void] {
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

  return [theme, setTheme];
}
