import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type SessionPayload } from '../api';
import { useI18n } from '../i18n';
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
  const { t, tx } = useI18n();
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
      setError(err instanceof Error ? err.message : t('verify.failed'));
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
            {tx('verify.linkHelp', {
              signIn: <Link to="/login">{t('verify.signIn')}</Link>,
            })}
          </p>
        </div>
      </AuthPage>
    );
  }

  if (!account) return <div className="empty">{t('link.checking')}</div>;

  return (
    <AuthPage>
      <div className="card auth-card stack">
        <div>
          <h1>{t('verify.title')}</h1>
          <p className="muted">{account.email}</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <button type="button" className="button" onClick={handleConfirm} disabled={busy}>
          {t(busy ? 'verify.submitting' : 'verify.submit')}
        </button>

        <p className="small muted">{t('verify.after')}</p>
      </div>
    </AuthPage>
  );
}
