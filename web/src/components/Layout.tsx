import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import HouseholdSwitcher from './HouseholdSwitcher';
import LanguageToggle from './LanguageToggle';
import ThemeToggle from './ThemeToggle';

export default function Layout() {
  const { user, household, signOut } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-inner">
          <div className="brand">
            <NavLink to="/" className="brand-link">
              <span className="brand-mark" aria-hidden="true">
                🏠
              </span>
            </NavLink>
            <HouseholdSwitcher />
          </div>

          <nav className="nav">
            <NavLink to="/" end>
              {t('nav.expenses')}
            </NavLink>
            <NavLink to="/stats">{t('nav.statistics')}</NavLink>
            <NavLink to="/recurring">{t('nav.recurring')}</NavLink>
            <NavLink to="/lists">{t('nav.shopping')}</NavLink>
            <NavLink to="/household">{t('nav.household')}</NavLink>
          </nav>

          <div className="row">
            <span className="muted small">{user?.name}</span>
            <LanguageToggle />
            <ThemeToggle />
            <button type="button" className="button secondary small" onClick={handleSignOut}>
              {t('nav.signOut')}
            </button>
          </div>
        </div>
      </header>

      {/*
        Keyed by household, so switching remounts whichever page is on screen.
        Every page loads its data once on mount; without this, switching while
        already on a page leaves the previous household's money under the new
        household's name — the routing does not change, so nothing refetches.
        One key here beats a household-changed effect in each of six pages.
      */}
      <main className="page" key={household?.id ?? 'none'}>
        <Outlet />
      </main>
    </div>
  );
}
