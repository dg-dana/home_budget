import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Household, type Invitation, type Notice } from '../api';
import { useSession } from '../session';
import AuthPage from '../components/AuthPage';
import NoticeCard from '../components/NoticeCard';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'SEK', 'PLN', 'INR'];

/**
 * Where an account picks which household to open, or creates another.
 *
 * Sits outside `Layout` because it has to work with *no* household open — it
 * is the screen a brand new account lands on, and the one you are sent to if
 * the household you were in is deleted or you are removed from it.
 */
export default function HouseholdsPage() {
  const { user, households, switchHousehold, refresh, signOut } = useSession();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', currency: 'USD', displayName: '' });
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resent, setResent] = useState<Notice | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [password, setPassword] = useState('');
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [joining, setJoining] = useState<{ token: string; displayName: string } | null>(null);

  const verified = user?.emailVerified ?? false;

  // Invites pinned to this address. Somebody who registered *from* an invite
  // and never opened the link again would otherwise see no sign it existed.
  const loadInvitations = useCallback(async () => {
    setInvitations(await api.get<Invitation[]>('/households/invitations'));
  }, []);

  useEffect(() => {
    loadInvitations().catch(() => {
      /* Nothing to show is the same as none waiting; the page still works. */
    });
  }, [loadInvitations]);

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!joining) return;
    setBusy(true);
    setError('');
    try {
      await api.post<{ household: Household }>('/households/join', joining);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the household');
      await loadInvitations().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const open = async (id: string) => {
    setError('');
    try {
      await switchHousehold(id);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that household');
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api.post<{ household: Household; notice: Notice }>('/households', form);
      await refresh();
      setNotice(created.notice);
      setForm({ name: '', currency: 'USD', displayName: '' });
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the household');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Closing the account from here, where an account with no household has to
   * be able to do it.
   *
   * The Household page carries the same action, but that page needs a
   * household open — so before this, an account that had left or never joined
   * one had no way to delete itself at all.
   */
  const handleDeleteAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const warning =
      households.length === 0
        ? 'Delete your account? This cannot be undone.'
        : 'Delete your account? You lose your place in every household listed here, and any household where you are the only person goes with you. What you spent stays in each history, listed without a payer. This cannot be undone.';
    if (!window.confirm(warning)) return;

    setBusy(true);
    try {
      await api.delete('/auth/account', { password });
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      // The server refuses while you are the only owner of a household with
      // other people in it, and names which — that message is the useful one.
      setError(err instanceof Error ? err.message : 'Could not delete your account');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Throws rather than swallowing, because `NoticeCard` uses the same function
   * for its own "send it again" and has to know whether it worked — reporting
   * "sent again" for a request that failed would be worse than saying nothing.
   */
  const handleResend = async () => {
    setError('');
    const { verification } = await api.post<{ verification: Notice }>('/auth/verify/resend');
    setResent(verification);
  };

  return (
    <AuthPage>
      <div className="card auth-card stack">
        <div>
          <h1>Your households</h1>
          <p className="muted">
            {households.length === 0
              ? 'You are not in a household yet.'
              : 'Pick the one to open, or add another.'}
          </p>
        </div>

        {error && <div className="alert">{error}</div>}

        {!verified && (
          <div className="stack" style={{ gap: '0.6rem' }}>
            <div className="alert info">
              Confirm <strong>{user?.email}</strong> before creating or joining a household.
            </div>
            {resent ? (
              <NoticeCard notice={resent} onResend={handleResend} />
            ) : (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  handleResend().catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : 'Could not send a new link'),
                  );
                }}
              >
                Send a new confirmation link
              </button>
            )}
          </div>
        )}

        {notice && <NoticeCard notice={notice} />}

        {invitations.length > 0 && (
          <div className="stack" style={{ gap: '0.5rem' }}>
            <h2 className="small muted" style={{ margin: 0 }}>
              {invitations.length === 1 ? 'You have an invitation' : 'You have invitations'}
            </h2>
            <ul className="item-list">
              {invitations.map((invitation) => (
                <li className="item" key={invitation.token}>
                  <div className="item-main">
                    <div className="item-name">{invitation.householdName}</div>
                    <div className="item-meta">
                      <span>invited as</span>
                      <span className="tag">{invitation.role}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="button small"
                    disabled={!verified || joining?.token === invitation.token}
                    onClick={() => setJoining({ token: invitation.token, displayName: '' })}
                  >
                    Join
                  </button>
                </li>
              ))}
            </ul>

            {joining && (
              <form className="stack" style={{ gap: '0.5rem' }} onSubmit={handleJoin}>
                <div>
                  <label htmlFor="joinDisplayName">Your name in that household</label>
                  <input
                    id="joinDisplayName"
                    required
                    autoFocus
                    placeholder="Dana"
                    value={joining.displayName}
                    onChange={(event) =>
                      setJoining({ ...joining, displayName: event.target.value })
                    }
                  />
                </div>
                <div className="row">
                  <button type="submit" className="button" disabled={busy}>
                    {busy ? 'Joining…' : 'Join household'}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setJoining(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {households.length > 0 && (
          <ul className="item-list">
            {households.map((household) => (
              <li className="item" key={household.id}>
                <div className="item-main">
                  <div className="item-name">{household.name}</div>
                  <div className="item-meta">
                    <span>as {household.displayName}</span>
                    <span className="tag">{household.role}</span>
                  </div>
                </div>
                <button type="button" className="button small" onClick={() => open(household.id)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}

        {creating ? (
          <form className="stack" onSubmit={handleCreate}>
            <div>
              <label htmlFor="householdName">Household name</label>
              <input
                id="householdName"
                required
                placeholder="The Levy family"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="field-row">
              <div>
                <label htmlFor="displayName">Your name in it</label>
                <input
                  id="displayName"
                  required
                  placeholder="Dana"
                  value={form.displayName}
                  onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="currency">Currency</label>
                <select
                  id="currency"
                  value={form.currency}
                  onChange={(event) => setForm({ ...form, currency: event.target.value })}
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              This is the name the rest of the household sees on expenses and shopping lists. You can
              go by something different in each one.
            </p>
            <div className="row">
              <button type="submit" className="button" disabled={busy}>
                {busy ? 'Creating…' : 'Create household'}
              </button>
              <button type="button" className="button secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="button"
            disabled={!verified}
            onClick={() => setCreating(true)}
          >
            Create a household
          </button>
        )}

        <p className="small muted" style={{ margin: 0 }}>
          Joining someone else's? Open the invite link they sent you.
        </p>

        <p className="small muted" style={{ margin: 0 }}>
          Signed in as {user?.email}.{' '}
          <button
            type="button"
            className="link-button"
            onClick={async () => {
              await signOut();
              navigate('/login', { replace: true });
            }}
          >
            Sign out
          </button>
          {!closing && (
            <>
              {' · '}
              <button type="button" className="link-button" onClick={() => setClosing(true)}>
                Delete account
              </button>
            </>
          )}
        </p>

        {closing && (
          <form className="card danger-zone stack" style={{ gap: '0.6rem' }} onSubmit={handleDeleteAccount}>
            <div>
              <h3 style={{ margin: 0 }}>Delete your account</h3>
              <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
                {households.length === 0
                  ? 'You are not in any household, so this removes the account and nothing else.'
                  : 'You lose your place in every household above, and any where you are the only person goes with you. What you spent stays in each history, listed without a payer.'}
              </p>
            </div>
            <div>
              <label htmlFor="closeAccountPassword">Confirm with your password</label>
              <input
                id="closeAccountPassword"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="row">
              <button type="submit" className="button danger-solid" disabled={busy}>
                {busy ? 'Deleting…' : 'Delete my account'}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setClosing(false);
                  setPassword('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </AuthPage>
  );
}
