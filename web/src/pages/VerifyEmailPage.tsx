import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type SessionPayload } from '../api';
import { useSession } from '../session';
import AuthPage from '../components/AuthPage';

/**
 * Reached through a confirmation link. No session is required — holding the
 * link is the proof — and redeeming it signs the person in, exactly as a
 * password recovery link does.
 */
export default function VerifyEmailPage() {
  const { token = '' } = useParams();
  const { setSession } = useSession();
  const navigate = useNavigate();

  const [account, setAccount] = useState<{ email: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ email: string }>(`/auth/verify/${encodeURIComponent(token)}`)
      .then(setAccount)
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  const handleConfirm = async () => {
    setBusy(true);
    setError('');
    try {
      setSession(await api.post<SessionPayload>('/auth/verify', { token }));
      navigate('/households', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm the address');
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
            Confirmation links work once and expire after 24 hours.{' '}
            <Link to="/login">Sign in</Link> to get a fresh one.
          </p>
        </div>
      </AuthPage>
    );
  }

  if (!account) return <div className="empty">Checking link…</div>;

  return (
    <AuthPage>
      <div className="card auth-card stack">
        <div>
          <h1>Confirm your address</h1>
          <p className="muted">{account.email}</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <button type="button" className="button" onClick={handleConfirm} disabled={busy}>
          {busy ? 'Confirming…' : 'Confirm this address'}
        </button>

        <p className="small muted">
          Confirming signs you in on this device, so you can set up a household straight away.
        </p>
      </div>
    </AuthPage>
  );
}
