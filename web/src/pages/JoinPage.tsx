import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Household } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import AuthPage from '../components/AuthPage';

interface InvitePreview {
  householdName: string;
  email: string | null;
  role: 'owner' | 'member';
  /** Whether whoever is signed in is already a member of this household. */
  alreadyIn: boolean;
  /** The household's id — present only when `alreadyIn`, to switch into it. */
  householdId: string | null;
}

/**
 * Redeeming an invite, for someone who already has an account.
 *
 * Joining used to be a second way to *create* an account, which is why one
 * address could only ever be in one household. Now the invited person registers
 * like everybody else and arrives here signed in, so all this asks for is what
 * they want to be called in this particular household.
 */
export default function JoinPage() {
  const { token = '' } = useParams();
  const { user, refresh, switchHousehold } = useSession();
  const { t, tx } = useI18n();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<InvitePreview>(`/auth/invite/${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post<{ household: Household }>('/households/join', { token, displayName });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('join.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <h1>{t('join.notUsable')}</h1>
          <div className="alert">{loadError}</div>
          <p className="small muted">
            {tx('join.notUsableHelp', {
              households: <Link to="/households">{t('join.yourHouseholds')}</Link>,
            })}
          </p>
        </div>
      </AuthPage>
    );
  }

  if (!preview) return <div className="empty">{t('join.checking')}</div>;

  /**
   * Already a member — the commonest way to see this is inviting yourself, or
   * opening the same link twice. Nothing to do here, and asking what they want
   * to be called before saying so would be a form that could only ever be
   * refused. The invite is left alone: it is single-use, and this is not a use.
   */
  if (preview.alreadyIn) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <div>
            <h1>{t('join.alreadyIn', { household: preview.householdName })}</h1>
            <p className="muted">{t('join.alreadyInBody')}</p>
          </div>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              // Switching, not just navigating: the household this invite is
              // for may not be the one the session currently has open.
              setBusy(true);
              void (async () => {
                try {
                  if (preview.householdId) await switchHousehold(preview.householdId);
                  navigate('/', { replace: true });
                } catch (err) {
                  setError(err instanceof Error ? err.message : t('join.openFailed'));
                  setBusy(false);
                }
              })();
            }}
          >
            {busy
              ? t('join.opening')
              : t('join.open', { household: preview.householdName })}
          </button>
          {error && <div className="alert">{error}</div>}
          <p className="small muted">
            {tx('join.wrongPerson', {
              page: <Link to="/household">{t('join.householdPage')}</Link>,
            })}
          </p>
        </div>
      </AuthPage>
    );
  }

  // An invite addressed to one person is not transferable to another account.
  const wrongAccount = preview.email !== null && user !== null && preview.email !== user.email;

  return (
    <AuthPage>
      <form className="card auth-card stack" onSubmit={handleSubmit}>
        <div>
          <h1>{t('join.title', { household: preview.householdName })}</h1>
          <p className="muted">{t('join.signedInAs', { email: user?.email ?? '' })}</p>
        </div>

        {error && <div className="alert">{error}</div>}

        {wrongAccount && (
          <div className="alert">
            {t('join.wrongAccount', { email: preview.email ?? '' })}
          </div>
        )}

        {!user?.emailVerified && (
          <div className="alert info">
            {tx('join.confirmFirst', {
              link: <Link to="/households">{t('join.getNewLink')}</Link>,
            })}
          </div>
        )}

        <div>
          <label htmlFor="displayName">{t('join.nameLabel')}</label>
          <input
            id="displayName"
            required
            placeholder={t('common.examplePerson')}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
            {t('join.nameHelp', { household: preview.householdName })}
          </p>
        </div>

        <button
          type="submit"
          className="button"
          disabled={busy || wrongAccount || !user?.emailVerified}
        >
          {t(busy ? 'join.submitting' : 'join.submit')}
        </button>
      </form>
    </AuthPage>
  );
}
