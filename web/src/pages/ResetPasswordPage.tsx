import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type SessionPayload } from '../api';
import { useSession } from '../session';
import AuthPage from '../components/AuthPage';

/**
 * Reached through a recovery link. No session is required — holding the link
 * is the proof — and redeeming it signs the person straight in.
 */
export default function ResetPasswordPage() {
  const { token = '' } = useParams();
  const { setSession } = useSession();
  const navigate = useNavigate();

  const [account, setAccount] = useState<{ email: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ email: string }>(`/auth/reset/${encodeURIComponent(token)}`)
      .then(setAccount)
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError('The two passwords do not match');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const restored = await api.post<SessionPayload>('/auth/reset', { token, password });
      setSession(restored);
      navigate(restored.household ? '/' : '/households', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the new password');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <h1>Link not usable</h1>
          <div className="alert">{loadError}</div>
          <p className="small muted">
            Ask the household owner for a fresh link, or <Link to="/login">sign in</Link>.
          </p>
        </div>
      </AuthPage>
    );
  }

  if (!account) return <div className="empty">Checking link…</div>;

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>Choose a new password</h1>
          <p className="muted">For {account.email}.</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <div>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
            At least 8 characters.
          </p>
        </div>

        <div>
          <label htmlFor="confirmation">Repeat it</label>
          <input
            id="confirmation"
            type="password"
            required
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>

        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Saving…' : 'Set password and sign in'}
        </button>

        <p className="small muted">
          This will sign out any device already using this account.
        </p>
      </form>
    </AuthPage>
  );
}
