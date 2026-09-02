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
import TodosPage from './pages/TodosPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import { useI18n } from './i18n';
import { useAccountPreferences, useSession } from './session';

/** The one-line placeholder all three guards show while `/auth/me` is in flight. */
function Loading() {
  const { t } = useI18n();
  return <div className="empty">{t('common.loading')}</div>;
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return <Loading />;
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
  if (loading) return <Loading />;
  if (!household) return <Navigate to="/households" replace />;
  return children;
}

function RedirectIfSignedIn({ children }: { children: JSX.Element }) {
  const { user, loading } = useSession();
  if (loading) return <Loading />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  // Language and theme belong to the account once somebody is signed in: its
  // saved pair is adopted here, and every change is written back. Called from
  // here rather than inside `SessionProvider` so the dependency on
  // `I18nProvider` and `ThemeProvider` sitting outside it stays visible.
  useAccountPreferences();

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
        <Route path="/todo" element={<TodosPage />} />
        <Route path="/household" element={<HouseholdPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
