import type { ReactNode } from 'react';
import ThemeToggle from './ThemeToggle';

/**
 * The signed-out shell: a centred card with the theme toggle in the corner.
 *
 * The toggle lives here because these pages have no header to put it in, and
 * without it the only route to dark mode was to sign in first — which is no
 * use to whoever is looking at the sign-in page.
 */
export default function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-page-corner">
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
