import type { ReactNode } from 'react';
import LanguageToggle from './LanguageToggle';
import ThemeToggle from './ThemeToggle';

/**
 * The signed-out shell: a centred card with the theme and language pickers in
 * the corner.
 *
 * Both live here because these pages have no header to put them in, and
 * without that the only route to either was to sign in first — which is no use
 * to whoever is looking at the sign-in page, and no use at all to a guest.
 */
export default function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-page-corner">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
