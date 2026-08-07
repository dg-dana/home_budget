import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import AuthPage from '../components/AuthPage';

/**
 * Asking for a recovery link. No session, and no household — being locked out
 * is the whole reason for being here.
 *
 * The screen after submitting says the same thing whether or not that address
 * has an account, because the server answers the same way either way: telling
 * somebody "no account here" would turn this page into a way to find out who
 * has one (`ARCHITECTURE.md` §4). The wording is deliberately about the
 * message rather than the account — "if there is an account", never "we have
 * sent you".
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post<{ ok: true }>('/auth/forgot', { email });
      setSent(true);
    } catch (err) {
      // A deployment with no email provider refuses this outright (503) and
      // says to ask an owner, which is the recovery this app has always had.
      setError(err instanceof Error ? err.message : 'Could not send a reset link');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <div>
            <h1>Check your email</h1>
            <p className="muted">
              If there is an account for <strong>{email}</strong>, a link to choose a new password
              is on its way. It works once and expires in 24 hours.
            </p>
          </div>
          <p className="small muted">
            Nothing after a few minutes? Check the spam folder, make sure the address is the one you
            signed up with, or{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setSent(false);
                setError('');
              }}
            >
              try another address
            </button>
            .
          </p>
          <p className="small muted">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>Forgotten your password?</h1>
          <p className="muted">
            Give us the address you signed up with and we will email you a link to choose a new one.
          </p>
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

        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a link'}
        </button>

        <p className="small muted">
          Remembered it? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthPage>
  );
}
