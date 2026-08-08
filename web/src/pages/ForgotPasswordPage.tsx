import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import AuthPage from '../components/AuthPage';
import { useI18n } from '../i18n';

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
  const { t, tx, message } = useI18n();
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
      setError(message(err, 'forgot.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <div>
            <h1>{t('forgot.sentTitle')}</h1>
            <p className="muted">
              {tx('forgot.sentBody', { email: <strong>{email}</strong> })}
            </p>
          </div>
          <p className="small muted">
            {tx('forgot.nothingYet', {
              retry: (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setSent(false);
                    setError('');
                  }}
                >
                  {t('forgot.tryAnother')}
                </button>
              ),
            })}
          </p>
          <p className="small muted">
            <Link to="/login">{t('forgot.backToSignIn')}</Link>
          </p>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>{t('forgot.title')}</h1>
          <p className="muted">{t('forgot.subtitle')}</p>
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

        <button type="submit" className="button" disabled={busy}>
          {t(busy ? 'forgot.submitting' : 'forgot.submit')}
        </button>

        <p className="small muted">
          {tx('forgot.remembered', { link: <Link to="/login">{t('register.signIn')}</Link> })}
        </p>
      </form>
    </AuthPage>
  );
}
