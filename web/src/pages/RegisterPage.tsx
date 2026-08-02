import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type Notice, type SessionPayload } from '../api';
import { useSession } from '../session';
import AuthPage from '../components/AuthPage';
import NoticeCard from '../components/NoticeCard';

/**
 * Step one of two: an account, and nothing else.
 *
 * A household needs a name, a currency and a name for *you* inside it — none of
 * which this person can sensibly answer yet, and all of which they may end up
 * answering several times over. So registration asks for an address and a
 * password, and the household comes after the address is confirmed.
 */
export default function RegisterPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  // Someone who followed an invite link lands here via the sign-in page; keep
  // hold of where they were trying to go.
  const from = (location.state as { from?: string } | null)?.from;

  const [form, setForm] = useState({ email: '', password: '' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api.post<SessionPayload & { verification: Notice }>(
        '/auth/register',
        form,
      );
      // Deliberately *not* setSession yet. The cookie is already set server
      // side, but telling the app it is signed in would let RedirectIfSignedIn
      // fire and carry the confirmation link off the screen before it has been
      // read. The session is adopted on Continue instead.
      setNotice(created.verification);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  };

  if (notice) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <div>
            <h1>Confirm your address</h1>
            <p className="muted">One step left before you can create or join a household.</p>
          </div>

          <NoticeCard notice={notice} />

          <button
            type="button"
            className="button"
            onClick={async () => {
              await refresh();
              navigate(from ?? '/households', { replace: true });
            }}
          >
            Continue
          </button>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>Create your account</h1>
          <p className="muted">You will set up a household — or join one — next.</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={update('email')}
          />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={update('password')}
          />
          <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
            At least 8 characters.
          </p>
        </div>

        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <p className="small muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthPage>
  );
}
