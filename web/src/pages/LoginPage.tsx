import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type SessionPayload } from '../api';
import { useSession } from '../session';
import AuthPage from '../components/AuthPage';

export default function LoginPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  // Someone sent here from an invite link should land back on it once in.
  const from = (location.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const signedIn = await api.post<SessionPayload>('/auth/login', { email, password });
      setSession(signedIn);
      // With no household open — none yet, or several and no choice made — the
      // picker is the only page that can render.
      navigate(from ?? (signedIn.household ? '/' : '/households'), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your households.</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="small muted">
          Starting fresh? <Link to="/register" state={{ from }}>Create an account</Link>
        </p>
        <p className="small muted" style={{ marginTop: '-0.5rem' }}>
          <Link to="/forgot">Forgotten your password?</Link>
        </p>
      </form>
    </AuthPage>
  );
}
