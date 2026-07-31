import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import ExpensesPage from './pages/ExpensesPage';
import HouseholdPage from './pages/HouseholdPage';
import JoinPage from './pages/JoinPage';
import ListDetailPage from './pages/ListDetailPage';
import ListsPage from './pages/ListsPage';
import LoginPage from './pages/LoginPage';
import RecurringPage from './pages/RecurringPage';
import RegisterPage from './pages/RegisterPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SharedListPage from './pages/SharedListPage';
import StatsPage from './pages/StatsPage';
import { useSession } from './session';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return <div className="empty">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
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
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="/reset/:token" element={<ResetPasswordPage />} />

      <Route
        element={
          <RequireAuth>
            <Layout />
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
