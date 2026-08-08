import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type Notice, type SessionPayload } from '../api';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
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
  const { t, tx, language, message } = useI18n();
  const [theme] = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  // Someone who followed an invite link lands here via the sign-in page; keep
  // hold of where they were trying to go.
  const from = (location.state as { from?: string } | null)?.from;

  const [form, setForm] = useState({ email: '', password: '' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * Mints a fresh confirmation link and shows the new notice. Works from here
   * because registration already set the session cookie — the app has simply
   * not adopted it yet (see below).
   */
  const resendVerification = async () => {
    const { verification } = await api.post<{ verification: Notice }>('/auth/verify/resend');
    setNotice(verification);
  };

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Both go with the sign-up: the confirmation email — the very first
      // thing this account receives — is already in the right language, and
      // the next device they sign in on looks like the one they signed up on.
      const created = await api.post<SessionPayload & { verification: Notice }>(
        '/auth/register',
        { ...form, language, theme },
      );
      // Deliberately *not* setSession yet. The cookie is already set server
      // side, but telling the app it is signed in would let RedirectIfSignedIn
      // fire and carry the confirmation link off the screen before it has been
      // read. The session is adopted on Continue instead.
      setNotice(created.verification);
    } catch (err) {
      setError(message(err, 'register.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (notice) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <div>
            <h1>{t('register.confirmTitle')}</h1>
            <p className="muted">{t('register.confirmSubtitle')}</p>
          </div>

          <NoticeCard notice={notice} onResend={resendVerification} />

          <button
            type="button"
            className="button"
            onClick={async () => {
              await refresh();
              navigate(from ?? '/households', { replace: true });
            }}
          >
            {t('register.continue')}
          </button>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>{t('register.title')}</h1>
          <p className="muted">{t('register.subtitle')}</p>
        </div>

        {error && <div className="alert">{error}</div>}

        <div>
          <label htmlFor="email">{t('common.email')}</label>
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
          <label htmlFor="password">{t('common.password')}</label>
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
            {t('common.minPassword')}
          </p>
        </div>

        <button type="submit" className="button" disabled={busy}>
          {t(busy ? 'register.submitting' : 'register.submit')}
        </button>

        <p className="small muted">
          {tx('register.haveAccount', {
            link: <Link to="/login">{t('register.signIn')}</Link>,
          })}
        </p>
      </form>
    </AuthPage>
  );
}
