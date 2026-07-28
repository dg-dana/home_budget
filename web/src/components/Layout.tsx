import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../session';

export default function Layout() {
  const { user, household, signOut } = useSession();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              🏠
            </span>
            <span>{household?.name ?? 'Home Budget'}</span>
          </NavLink>

          <nav className="nav">
            <NavLink to="/" end>
              Expenses
            </NavLink>
            <NavLink to="/recurring">Recurring</NavLink>
            <NavLink to="/lists">Shopping</NavLink>
            <NavLink to="/household">Household</NavLink>
          </nav>

          <div className="row">
            <span className="muted small">{user?.name}</span>
            <button type="button" className="button secondary small" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
