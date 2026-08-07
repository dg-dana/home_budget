import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Household, type Invitation, type Notice } from '../api';
import { useI18n } from '../i18n';
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
  const { t, tx, plural } = useI18n();
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
      setError(err instanceof Error ? err.message : t('join.failed'));
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
      setError(err instanceof Error ? err.message : t('households.openFailed'));
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
      setError(err instanceof Error ? err.message : t('households.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Closing the account lives here and nowhere else: it ends the account and
   * every membership it holds, so it is not scoped to whichever household
   * happens to be open — and this is the one screen an account with no
   * household can still reach.
   */
  const handleDeleteAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const warning = t(
      households.length === 0
        ? 'households.confirmDeleteNone'
        : 'households.confirmDeleteSome',
    );
    if (!window.confirm(warning)) return;

    setBusy(true);
    try {
      await api.delete('/auth/account', { password });
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      // The server refuses while you are the only owner of a household with
      // other people in it, and names which — that message is the useful one.
      setError(err instanceof Error ? err.message : t('households.deleteFailed'));
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
          <h1>{t('households.title')}</h1>
          <p className="muted">
            {t(households.length === 0 ? 'households.none' : 'households.pick')}
          </p>
        </div>

        {error && <div className="alert">{error}</div>}

        {!verified && (
          <div className="stack" style={{ gap: '0.6rem' }}>
            <div className="alert info">
              {tx('households.confirmFirst', { email: <strong>{user?.email}</strong> })}
            </div>
            {resent ? (
              <NoticeCard notice={resent} onResend={handleResend} />
            ) : (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  handleResend().catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : t('households.sendLinkFailed')),
                  );
                }}
              >
                {t('households.sendNewLink')}
              </button>
            )}
          </div>
        )}

        {notice && <NoticeCard notice={notice} />}

        {invitations.length > 0 && (
          <div className="stack" style={{ gap: '0.5rem' }}>
            <h2 className="small muted" style={{ margin: 0 }}>
              {plural(invitations.length, 'households.invitations')}
            </h2>
            <ul className="item-list">
              {invitations.map((invitation) => (
                <li className="item" key={invitation.token}>
                  <div className="item-main">
                    <div className="item-name">{invitation.householdName}</div>
                    <div className="item-meta">
                      <span>{t('households.invitedAs')}</span>
                      <span className="tag">{t(`common.role.${invitation.role}`)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="button small"
                    disabled={!verified || joining?.token === invitation.token}
                    onClick={() => setJoining({ token: invitation.token, displayName: '' })}
                  >
                    {t('households.join')}
                  </button>
                </li>
              ))}
            </ul>

            {joining && (
              <form className="stack" style={{ gap: '0.5rem' }} onSubmit={handleJoin}>
                <div>
                  <label htmlFor="joinDisplayName">{t('households.joinNameLabel')}</label>
                  <input
                    id="joinDisplayName"
                    required
                    autoFocus
                    placeholder={t('common.examplePerson')}
                    value={joining.displayName}
                    onChange={(event) =>
                      setJoining({ ...joining, displayName: event.target.value })
                    }
                  />
                </div>
                <div className="row">
                  <button type="submit" className="button" disabled={busy}>
                    {t(busy ? 'join.submitting' : 'join.submit')}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setJoining(null)}
                  >
                    {t('common.cancel')}
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
                    <span>{t('households.as', { name: household.displayName })}</span>
                    <span className="tag">{t(`common.role.${household.role}`)}</span>
                  </div>
                </div>
                <button type="button" className="button small" onClick={() => open(household.id)}>
                  {t('households.open')}
                </button>
              </li>
            ))}
          </ul>
        )}

        {creating ? (
          <form className="stack" onSubmit={handleCreate}>
            <div>
              <label htmlFor="householdName">{t('households.nameLabel')}</label>
              <input
                id="householdName"
                required
                placeholder={t('households.namePlaceholder')}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="field-row">
              <div>
                <label htmlFor="displayName">{t('households.yourNameLabel')}</label>
                <input
                  id="displayName"
                  required
                  placeholder={t('common.examplePerson')}
                  value={form.displayName}
                  onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="currency">{t('common.currency')}</label>
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
              {t('households.displayNameHelp')}
            </p>
            <div className="row">
              <button type="submit" className="button" disabled={busy}>
                {t(busy ? 'households.creating' : 'households.create')}
              </button>
              <button type="button" className="button secondary" onClick={() => setCreating(false)}>
                {t('common.cancel')}
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
            {t('households.createCta')}
          </button>
        )}

        <p className="small muted" style={{ margin: 0 }}>
          {t('households.someoneElse')}
        </p>

        <p className="small muted" style={{ margin: 0 }}>
          {tx('households.signedInAs', {
            email: user?.email ?? '',
            signOut: (
              <button
                type="button"
                className="link-button"
                onClick={async () => {
                  await signOut();
                  navigate('/login', { replace: true });
                }}
              >
                {t('nav.signOut')}
              </button>
            ),
          })}
          {!closing && (
            <>
              {' · '}
              <button type="button" className="link-button" onClick={() => setClosing(true)}>
                {t('households.deleteAccount')}
              </button>
            </>
          )}
        </p>

        {closing && (
          <form className="card danger-zone stack" style={{ gap: '0.6rem' }} onSubmit={handleDeleteAccount}>
            <div>
              <h3 style={{ margin: 0 }}>{t('households.deleteTitle')}</h3>
              <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
                {t(
                  households.length === 0
                    ? 'households.deleteBodyNone'
                    : 'households.deleteBodySome',
                )}
              </p>
            </div>
            <div>
              <label htmlFor="closeAccountPassword">{t('common.confirmPassword')}</label>
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
                {t(busy ? 'households.deleting' : 'households.deleteSubmit')}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setClosing(false);
                  setPassword('');
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </AuthPage>
  );
}
