import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Category, type Invite, type Member } from '../api';
import { formatMoney } from '../format';
import { useSession } from '../session';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'SEK', 'PLN', 'INR'];

export default function HouseholdPage() {
  const { user, household, refresh, signOut } = useSession();
  const navigate = useNavigate();
  const isOwner = user?.role === 'owner';
  const currency = household?.currency ?? 'USD';

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [settings, setSettings] = useState({ name: '', currency: 'USD' });
  const [newCategory, setNewCategory] = useState({ name: '', color: '#0f766e', budget: '' });
  const [error, setError] = useState('');
  const [copiedToken, setCopiedToken] = useState('');
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [passwordNotice, setPasswordNotice] = useState('');
  const [resetLinks, setResetLinks] = useState<Record<string, string>>({});
  const [dangerPasswords, setDangerPasswords] = useState({ account: '', household: '' });
  const [dangerError, setDangerError] = useState('');

  const load = useCallback(async () => {
    const [memberList, categoryList] = await Promise.all([
      api.get<Member[]>('/household/members'),
      api.get<Category[]>('/categories'),
    ]);
    setMembers(memberList);
    setCategories(categoryList);
    if (isOwner) setInvites(await api.get<Invite[]>('/household/invites'));
  }, [isOwner]);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  useEffect(() => {
    if (household) setSettings({ name: household.name, currency: household.currency });
  }, [household]);

  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const inviteUrl = (token: string) => `${window.location.origin}/join/${token}`;

  // A household must keep an owner, so its only one cannot delete their account
  // while anybody else is still here — the server refuses it, and saying so
  // before the button is pressed is cheaper than the round trip.
  const soleOwner = isOwner && !members.some((m) => m.role === 'owner' && m.id !== user?.id);
  const lastPerson = members.length === 1;
  const strandedOwner = soleOwner && !lastPerson;

  const copyInvite = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken(''), 2000);
    } catch {
      setError('Could not copy automatically — select the link and copy it manually.');
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setPasswordNotice('');
    try {
      await api.post('/auth/password', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      });
      setPasswords({ current: '', next: '' });
      setPasswordNotice('Password changed. Any other device using this account was signed out.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password');
    }
  };

  /** Owner action: mint a recovery link for someone who is locked out. */
  const handleIssueReset = async (member: Member) => {
    setError('');
    try {
      const issued = await api.post<{ token: string }>(
        `/household/members/${member.id}/reset-password`,
      );
      setResetLinks((previous) => ({
        ...previous,
        [member.id]: `${window.location.origin}/reset/${issued.token}`,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a reset link');
    }
  };

  /**
   * Both deletions end the session server-side, so the page it is on is about
   * to stop existing. Clear the client's copy and leave, rather than letting
   * `load()` run into a 401.
   */
  const leaveAfterDeletion = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const handleDeleteAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setDangerError('');
    // The last person out takes the household with them, so say so.
    const warning = lastPerson
      ? `Delete your account? You are the only person here, so "${household?.name ?? 'this household'}" and everything in it goes too. This cannot be undone.`
      : 'Delete your account? You lose access to this household. What you spent stays in its history, listed without a payer. This cannot be undone.';
    if (!window.confirm(warning)) return;
    try {
      await api.delete('/auth/account', { password: dangerPasswords.account });
      await leaveAfterDeletion();
    } catch (err) {
      setDangerError(err instanceof Error ? err.message : 'Could not delete your account');
    }
  };

  const handleDeleteHousehold = async (event: React.FormEvent) => {
    event.preventDefault();
    setDangerError('');
    const others = members.length - 1;
    const warning =
      `Delete "${household?.name ?? 'this household'}"? Every expense, budget, recurring rule and shopping list goes` +
      (others > 0 ? `, and ${others} other account${others === 1 ? '' : 's'} here` : '') +
      '. Share links stop working. This cannot be undone.';
    if (!window.confirm(warning)) return;
    try {
      await api.delete('/household', { password: dangerPasswords.household });
      await leaveAfterDeletion();
    } catch (err) {
      setDangerError(err instanceof Error ? err.message : 'Could not delete the household');
    }
  };

  const handleSaveSettings = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.put('/household', settings);
      await refresh();
    });
  };

  const handleAddCategory = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newCategory.name.trim()) return;
    const budget = newCategory.budget.trim() === '' ? null : Number(newCategory.budget);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
      setError('Budget must be a positive number');
      return;
    }
    void run(async () => {
      await api.post('/categories', {
        name: newCategory.name,
        color: newCategory.color,
        monthlyBudget: budget,
      });
      setNewCategory({ name: '', color: '#0f766e', budget: '' });
    });
  };

  const handleBudgetChange = (category: Category, value: string) => {
    const budget = value.trim() === '' ? null : Number(value);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return;
    void run(() =>
      api.put(`/categories/${category.id}`, {
        name: category.name,
        color: category.color,
        monthlyBudget: budget,
      }),
    );
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Household</h1>
          <p>Family members, invites, and the categories you budget against.</p>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="grid-2">
        <div className="card stack">
          <div className="card-title">
            <h2>Family members</h2>
            <span className="muted small">{members.length}</span>
          </div>

          <ul className="item-list">
            {members.map((member) => (
              <li className="item" key={member.id}>
                <div className="item-main">
                  <div className="item-name">
                    {member.name}
                    {member.id === user?.id && <span className="muted small"> · you</span>}
                  </div>
                  <div className="item-meta">
                    <span>{member.email}</span>
                    <span className="tag">{member.role}</span>
                  </div>
                </div>
                {isOwner && (
                  <button
                    type="button"
                    className="button secondary small"
                    title={`Create a password reset link for ${member.name}`}
                    onClick={() => handleIssueReset(member)}
                  >
                    Reset password
                  </button>
                )}
                {isOwner && member.id !== user?.id && (
                  <button
                    type="button"
                    className="icon-button danger"
                    title={`Remove ${member.name}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${member.name} from the household?`)) {
                        void run(() => api.delete(`/household/members/${member.id}`));
                      }
                    }}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>

          {Object.entries(resetLinks).length > 0 && (
            <div className="stack" style={{ gap: '0.5rem' }}>
              <h3 className="muted small">Reset links</h3>
              {Object.entries(resetLinks).map(([memberId, url]) => (
                <div key={memberId}>
                  <p className="small muted" style={{ margin: '0 0 0.25rem' }}>
                    For {members.find((m) => m.id === memberId)?.name ?? 'member'} — send it to them
                    directly. It works once, expires in 24 hours, and signs out their other devices.
                  </p>
                  <div className="share-box">
                    <code>{url}</code>
                    <button
                      type="button"
                      className="button small"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(url);
                          setCopiedToken(memberId);
                          window.setTimeout(() => setCopiedToken(''), 2000);
                        } catch {
                          setError('Could not copy automatically — select the link and copy it manually.');
                        }
                      }}
                    >
                      {copiedToken === memberId ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isOwner && (
            <>
              <form
                className="row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api.post('/household/invites', { email: inviteEmail, role: 'member' });
                    setInviteEmail('');
                  });
                }}
              >
                <input
                  type="email"
                  aria-label="Invite email (optional)"
                  placeholder="Email (optional)"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  style={{ flex: 1, minWidth: '180px' }}
                />
                <button type="submit" className="button">
                  Create invite
                </button>
              </form>

              {invites.length > 0 && (
                <div className="stack" style={{ gap: '0.5rem' }}>
                  <h3 className="muted small">Pending invites</h3>
                  {invites.map((invite) => (
                    <div className="share-box" key={invite.token}>
                      <code>{inviteUrl(invite.token)}</code>
                      <button
                        type="button"
                        className="button small"
                        onClick={() => copyInvite(invite.token)}
                      >
                        {copiedToken === invite.token ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        className="button danger small"
                        onClick={() => run(() => api.delete(`/household/invites/${invite.token}`))}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                  <p className="small muted" style={{ margin: 0 }}>
                    Each link works once and expires after 14 days.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="stack">
        <div className="card stack">
          <div className="card-title">
            <h2>Settings</h2>
          </div>

          {isOwner ? (
            <form className="stack" onSubmit={handleSaveSettings}>
              <div>
                <label htmlFor="householdName">Household name</label>
                <input
                  id="householdName"
                  required
                  value={settings.name}
                  onChange={(event) => setSettings({ ...settings, name: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="currency">Currency</label>
                <select
                  id="currency"
                  value={settings.currency}
                  onChange={(event) => setSettings({ ...settings, currency: event.target.value })}
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <button type="submit" className="button">
                  Save settings
                </button>
              </div>
            </form>
          ) : (
            <p className="muted small">Only the household owner can change these settings.</p>
          )}
        </div>

        <div className="card stack">
          <div className="card-title">
            <h2>Your password</h2>
          </div>

          {passwordNotice && <div className="alert info">{passwordNotice}</div>}

          <form className="stack" onSubmit={handleChangePassword}>
            <div>
              <label htmlFor="currentPassword">Current password</label>
              <input
                id="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                value={passwords.current}
                onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="newPassword">New password</label>
              <input
                id="newPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={passwords.next}
                onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
              />
            </div>
            <div>
              <button type="submit" className="button">
                Change password
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Changing it signs out every other device using your account.
            </p>
          </form>
        </div>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">
          <h2>Categories & budgets</h2>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Monthly budget</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td>
                    <span className="row" style={{ gap: '0.5rem' }}>
                      <input
                        type="color"
                        aria-label={`${category.name} colour`}
                        value={category.color}
                        style={{ width: '38px', padding: '2px', height: '32px' }}
                        onChange={(event) =>
                          run(() =>
                            api.put(`/categories/${category.id}`, {
                              name: category.name,
                              color: event.target.value,
                              monthlyBudget:
                                category.monthly_budget_cents === null
                                  ? null
                                  : category.monthly_budget_cents / 100,
                            }),
                          )
                        }
                      />
                      {category.name}
                    </span>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      aria-label={`${category.name} monthly budget`}
                      placeholder="No limit"
                      defaultValue={
                        category.monthly_budget_cents === null
                          ? ''
                          : String(category.monthly_budget_cents / 100)
                      }
                      onBlur={(event) => handleBudgetChange(category, event.target.value)}
                      style={{ maxWidth: '140px' }}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="icon-button danger"
                      title={`Delete ${category.name}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete "${category.name}"? Its expenses stay, but become uncategorised.`,
                          )
                        ) {
                          void run(() => api.delete(`/categories/${category.id}`));
                        }
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form className="row" onSubmit={handleAddCategory}>
          <input
            aria-label="New category name"
            placeholder="New category"
            value={newCategory.name}
            onChange={(event) => setNewCategory({ ...newCategory, name: event.target.value })}
            style={{ flex: 1, minWidth: '160px' }}
          />
          <input
            type="color"
            aria-label="New category colour"
            value={newCategory.color}
            onChange={(event) => setNewCategory({ ...newCategory, color: event.target.value })}
            style={{ width: '48px', padding: '2px', height: '38px' }}
          />
          <input
            type="number"
            min="0"
            aria-label="Monthly budget"
            placeholder={`Budget (${currency})`}
            value={newCategory.budget}
            onChange={(event) => setNewCategory({ ...newCategory, budget: event.target.value })}
            style={{ maxWidth: '160px' }}
          />
          <button type="submit" className="button" disabled={!newCategory.name.trim()}>
            Add
          </button>
        </form>

        <p className="small muted" style={{ margin: 0 }}>
          Budgets are compared against each month's spending on the Expenses page. Example limit:{' '}
          {formatMoney(50000, currency)}.
        </p>
      </div>

      <div className="card stack danger-zone">
        <div className="card-title">
          <h2>Danger zone</h2>
        </div>

        {dangerError && <div className="alert">{dangerError}</div>}

        <div className="grid-2">
          <form className="stack" onSubmit={handleDeleteAccount}>
            <div>
              <h3 style={{ margin: 0 }}>Delete your account</h3>
              <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
                {strandedOwner
                  ? 'You are this household’s only owner. Invite someone as an owner first, or delete the household instead.'
                  : lastPerson
                    ? 'You are the only person here, so this deletes the household with you.'
                    : 'Your expenses stay in the household history, listed without a payer.'}
              </p>
            </div>
            <div>
              <label htmlFor="deleteAccountPassword">Confirm with your password</label>
              <input
                id="deleteAccountPassword"
                type="password"
                required
                disabled={strandedOwner}
                autoComplete="current-password"
                value={dangerPasswords.account}
                onChange={(event) =>
                  setDangerPasswords({ ...dangerPasswords, account: event.target.value })
                }
              />
            </div>
            <div>
              <button type="submit" className="button danger-solid" disabled={strandedOwner}>
                Delete my account
              </button>
            </div>
          </form>

          {isOwner && (
            <form className="stack" onSubmit={handleDeleteHousehold}>
              <div>
                <h3 style={{ margin: 0 }}>Delete this household</h3>
                <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
                  Removes every expense, budget, recurring rule, shopping list and share link — and
                  everyone's account, not only yours.
                </p>
              </div>
              <div>
                <label htmlFor="deleteHouseholdPassword">Confirm with your password</label>
                <input
                  id="deleteHouseholdPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={dangerPasswords.household}
                  onChange={(event) =>
                    setDangerPasswords({ ...dangerPasswords, household: event.target.value })
                  }
                />
              </div>
              <div>
                <button type="submit" className="button danger-solid">
                  Delete household
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="small muted" style={{ margin: 0 }}>
          There is no undo and no export. Nothing here can be recovered afterwards.
        </p>
      </div>
    </div>
  );
}
