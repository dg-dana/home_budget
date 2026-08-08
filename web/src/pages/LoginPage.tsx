import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type SessionPayload } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import AuthPage from '../components/AuthPage';

export default function LoginPage() {
  const { setSession } = useSession();
  const { t, tx, message } = useI18n();
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
      setError(message(err, 'login.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>{t('login.title')}</h1>
          <p className="muted">{t('login.subtitle')}</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <div>
          <label htmlFor="email">{t('common.email')}</label>
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
          <label htmlFor="password">{t('common.password')}</label>
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
          {t(busy ? 'login.submitting' : 'login.submit')}
        </button>

        <p className="small muted">
          {tx('login.newHere', {
            link: (
              <Link to="/register" state={{ from }}>
                {t('login.createAccount')}
              </Link>
            ),
          })}
        </p>
        <p className="small muted" style={{ marginTop: '-0.5rem' }}>
          <Link to="/forgot">{t('login.forgot')}</Link>
        </p>
      </form>
    </AuthPage>
  );
}
