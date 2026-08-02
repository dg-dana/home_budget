import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Household, type Notice } from '../api';
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

  const verified = user?.emailVerified ?? false;

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

  const handleResend = async () => {
    setError('');
    try {
      const { verification } = await api.post<{ verification: Notice }>('/auth/verify/resend');
      setResent(verification);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a new link');
    }
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
              <NoticeCard notice={resent} />
            ) : (
              <button type="button" className="button secondary" onClick={handleResend}>
                Send a new confirmation link
              </button>
            )}
          </div>
        )}

        {notice && <NoticeCard notice={notice} />}

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
        </p>
      </div>
    </AuthPage>
  );
}
