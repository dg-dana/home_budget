import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import ExpensesPage from './pages/ExpensesPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import HouseholdPage from './pages/HouseholdPage';
import HouseholdsPage from './pages/HouseholdsPage';
import JoinPage from './pages/JoinPage';
import ListDetailPage from './pages/ListDetailPage';
import ListsPage from './pages/ListsPage';
import LoginPage from './pages/LoginPage';
import RecurringPage from './pages/RecurringPage';
import RegisterPage from './pages/RegisterPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SharedListPage from './pages/SharedListPage';
import StatsPage from './pages/StatsPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import { useSession } from './session';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return <div className="empty">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

/**
 * The app's pages are all about one household, and an account may now have
 * none open — brand new, or holding several with no choice made. Sending those
 * people to the picker is the client-side half of `requireHousehold`; without
 * it every page would render and then fill with 403s.
 */
function RequireHousehold({ children }: { children: JSX.Element }) {
  const { household, loading } = useSession();
  if (loading) return <div className="empty">Loading…</div>;
  if (!household) return <Navigate to="/households" replace />;
  return children;
}

function RedirectIfSignedIn({ children }: { children: JSX.Element }) {
  const { user, loading } = useSession();
  if (loading) return <div className="empty">Loading…</div>;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Guest route: reachable with just the link, no account needed. */}
      <Route path="/s/:token" element={<SharedListPage />} />

      <Route
        path="/login"
        element={
          <RedirectIfSignedIn>
            <LoginPage />
          </RedirectIfSignedIn>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectIfSignedIn>
            <RegisterPage />
          </RedirectIfSignedIn>
        }
      />
      {/* Confirming an address needs no session: the link is the proof. */}
      <Route path="/verify/:token" element={<VerifyEmailPage />} />
      <Route path="/reset/:token" element={<ResetPasswordPage />} />
      {/* Asking for a recovery link. Signed out by definition — somebody who
          is signed in changes their password from the Household page. */}
      <Route
        path="/forgot"
        element={
          <RedirectIfSignedIn>
            <ForgotPasswordPage />
          </RedirectIfSignedIn>
        }
      />

      {/* Joining is now something an account does, so this sits behind auth
          rather than being a second way to create one. */}
      <Route
        path="/join/:token"
        element={
          <RequireAuth>
            <JoinPage />
          </RequireAuth>
        }
      />

      {/* Reachable with no household open — it is how you get one. */}
      <Route
        path="/households"
        element={
          <RequireAuth>
            <HouseholdsPage />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <RequireHousehold>
              <Layout />
            </RequireHousehold>
          </RequireAuth>
        }
      >
        <Route path="/" element={<ExpensesPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/recurring" element={<RecurringPage />} />
        <Route path="/lists" element={<ListsPage />} />
        <Route path="/lists/:id" element={<ListDetailPage />} />
        <Route path="/household" element={<HouseholdPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
