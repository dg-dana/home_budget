import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type SessionPayload } from '../api';
import { useI18n } from '../i18n';
import { MIN_PASSWORD_LENGTH } from '../passwordRules';
import { useSession } from '../session';
import AuthPage from '../components/AuthPage';

/**
 * Reached through a recovery link. No session is required — holding the link
 * is the proof — and redeeming it signs the person straight in.
 */
export default function ResetPasswordPage() {
  const { token = '' } = useParams();
  const { setSession } = useSession();
  const { t, tx, message } = useI18n();
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
      .catch((err: unknown) => setLoadError(message(err, 'reset.failed')));
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError(t('reset.mismatch'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const restored = await api.post<SessionPayload>('/auth/reset', { token, password });
      setSession(restored);
      navigate(restored.household ? '/' : '/households', { replace: true });
    } catch (err) {
      setError(message(err, 'reset.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <h1>{t('link.notUsable')}</h1>
          <div className="alert">{loadError}</div>
          <p className="small muted">
            {tx('reset.linkHelp', {
              fresh: <Link to="/forgot">{t('reset.askFresh')}</Link>,
              signIn: <Link to="/login">{t('reset.signIn')}</Link>,
            })}
          </p>
        </div>
      </AuthPage>
    );
  }

  if (!account) return <div className="empty">{t('link.checking')}</div>;

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>{t('reset.title')}</h1>
          <p className="muted">{t('reset.for', { email: account.email })}</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <div>
          <label htmlFor="password">{t('reset.newPassword')}</label>
          <input
            id="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
            {t('common.minPassword', { min: MIN_PASSWORD_LENGTH })}
          </p>
        </div>

        <div>
          <label htmlFor="confirmation">{t('reset.repeat')}</label>
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
          {t(busy ? 'common.saving' : 'reset.submit')}
        </button>

        <p className="small muted">{t('reset.evicts')}</p>
      </form>
    </AuthPage>
  );
}
