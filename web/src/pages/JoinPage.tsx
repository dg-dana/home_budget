import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Household } from '../api';
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
      setError(err instanceof Error ? err.message : 'Could not join the household');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AuthPage>
        <div className="card auth-card stack">
          <h1>Invite not usable</h1>
          <div className="alert">{loadError}</div>
          <p className="small muted">
            Ask whoever invited you to send a fresh link, or{' '}
            <Link to="/households">go to your households</Link>.
          </p>
        </div>
      </AuthPage>
    );
  }

  if (!preview) return <div className="empty">Checking invite…</div>;

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
            <h1>You are already in {preview.householdName}</h1>
            <p className="muted">Nothing to accept — this invite is not needed for you.</p>
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
                  setError(err instanceof Error ? err.message : 'Could not open it');
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? 'Opening…' : `Open ${preview.householdName}`}
          </button>
          {error && <div className="alert">{error}</div>}
          <p className="small muted">
            Meant to invite somebody else? Send them their own link from the{' '}
            <Link to="/household">Household page</Link> — this one still works for whoever it was
            for.
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
          <h1>Join {preview.householdName}</h1>
          <p className="muted">Signed in as {user?.email}.</p>
        </div>

        {error && <div className="alert">{error}</div>}

        {wrongAccount && (
          <div className="alert">
            This invite was issued for {preview.email}. Sign in with that account to use it.
          </div>
        )}

        {!user?.emailVerified && (
          <div className="alert info">
            Confirm your email address before joining. <Link to="/households">Get a new link</Link>.
          </div>
        )}

        <div>
          <label htmlFor="displayName">Your name in this household</label>
          <input
            id="displayName"
            required
            placeholder="Dana"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
            What the rest of {preview.householdName} will see on expenses and shopping lists.
          </p>
        </div>

        <button
          type="submit"
          className="button"
          disabled={busy || wrongAccount || !user?.emailVerified}
        >
          {busy ? 'Joining…' : 'Join household'}
        </button>
      </form>
    </AuthPage>
  );
}
