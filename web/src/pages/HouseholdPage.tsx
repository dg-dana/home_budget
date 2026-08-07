import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Category, type Invite, type Member, type Notice } from '../api';
import { formatMoney } from '../format';
import { useSession } from '../session';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'SEK', 'PLN', 'INR'];

export default function HouseholdPage() {
  const { user, household, refresh } = useSession();
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
  const [resetLinks, setResetLinks] = useState<Record<string, { url: string; delivered: boolean }>>(
    {},
  );
  const [inviteNotice, setInviteNotice] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [displayNameNotice, setDisplayNameNotice] = useState('');
  const [dangerPassword, setDangerPassword] = useState('');
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

  // The name follows the household, so it has to be re-read when one is opened.
  useEffect(() => {
    if (user?.name) setDisplayName(user.name);
  }, [user?.name]);

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
      const issued = await api.post<{ token: string; notice: Notice }>(
        `/household/members/${member.id}/reset-password`,
      );
      setResetLinks((previous) => ({
        ...previous,
        [member.id]: {
          url: `${window.location.origin}/reset/${issued.token}`,
          delivered: issued.notice.delivered,
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a reset link');
    }
  };

  /**
   * Deleting a household does not end the session. The account outlives it and
   * may hold others, so the picker is where this lands — signing someone out of
   * an account that still exists would be a lie about what just happened.
   */
  const returnToHouseholds = async () => {
    await refresh();
    navigate('/households', { replace: true });
  };

  const handleDeleteHousehold = async (event: React.FormEvent) => {
    event.preventDefault();
    setDangerError('');
    const others = members.length - 1;
    const warning =
      `Delete "${household?.name ?? 'this household'}"? Every expense, budget, recurring rule and shopping list goes, ` +
      'and share links stop working' +
      (others > 0
        ? `. ${others} other ${others === 1 ? 'person' : 'people'} lose access to it — their accounts survive`
        : '') +
      '. This cannot be undone.';
    if (!window.confirm(warning)) return;
    try {
      await api.delete('/household', { password: dangerPassword });
      await returnToHouseholds();
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
                    className="button secondary small"
                    title={
                      member.role === 'owner'
                        ? `Make ${member.name} an ordinary member`
                        : `Let ${member.name} invite, rename and remove`
                    }
                    onClick={() => {
                      const next = member.role === 'owner' ? 'member' : 'owner';
                      const question =
                        next === 'owner'
                          ? `Make ${member.name} an owner? They will be able to invite and remove people, rename the household and delete it.`
                          : `Make ${member.name} an ordinary member? They will lose those powers.`;
                      if (window.confirm(question)) {
                        void run(async () => {
                          await api.put(`/household/members/${member.id}/role`, { role: next });
                          await refresh();
                        });
                      }
                    }}
                  >
                    {member.role === 'owner' ? 'Make member' : 'Make owner'}
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
              {Object.entries(resetLinks).map(([memberId, link]) => (
                <div key={memberId}>
                  <p className="small muted" style={{ margin: '0 0 0.25rem' }}>
                    For {members.find((m) => m.id === memberId)?.name ?? 'member'} —{' '}
                    {link.delivered
                      ? 'emailed to them, and here as well.'
                      : 'send it to them directly.'}{' '}
                    It works once, expires in 24 hours, and signs out their other devices.
                  </p>
                  <div className="share-box">
                    <code>{link.url}</code>
                    <button
                      type="button"
                      className="button small"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link.url);
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
                    const created = await api.post<{ notice: Notice }>('/household/invites', {
                      email: inviteEmail,
                      role: 'member',
                    });
                    setInviteNotice(
                      created.notice.delivered
                        ? `Invite emailed to ${created.notice.to}. The link is below too.`
                        : '',
                    );
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

              {inviteNotice && (
                <p className="small muted" style={{ margin: 0 }}>
                  {inviteNotice}
                </p>
              )}

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
            <h2>Your name here</h2>
          </div>

          {displayNameNotice && <div className="alert info">{displayNameNotice}</div>}

          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              setDisplayNameNotice('');
              void run(async () => {
                await api.put('/household/me', { displayName });
                await refresh();
                setDisplayNameNotice('Saved.');
              });
            }}
          >
            <div>
              <label htmlFor="displayName">Name in {household?.name ?? 'this household'}</label>
              <input
                id="displayName"
                required
                maxLength={80}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="button">
                Save name
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Only for this household — you can go by something different in each one. Your email
              and password belong to your account and are shared across all of them.
            </p>
          </form>
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

      {/*
        Closing an account is not here: it belongs to the account rather than to
        whichever household happens to be open, and it lives on `/households`,
        which is the one page an account with no household can still reach.
      */}
      {isOwner && (
        <div className="card stack danger-zone">
          <div className="card-title">
            <h2>Danger zone</h2>
          </div>

          {dangerError && <div className="alert">{dangerError}</div>}

          <form className="stack" onSubmit={handleDeleteHousehold}>
            <div>
              <h3 style={{ margin: 0 }}>Delete this household</h3>
              <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
                Removes every expense, budget, recurring rule, shopping list and share link, for
                everyone in it. Their accounts survive — only this household goes.
              </p>
            </div>
            <div>
              <label htmlFor="deleteHouseholdPassword">Confirm with your password</label>
              <input
                id="deleteHouseholdPassword"
                type="password"
                required
                autoComplete="current-password"
                value={dangerPassword}
                onChange={(event) => setDangerPassword(event.target.value)}
                style={{ maxWidth: '320px' }}
              />
            </div>
            <div>
              <button type="submit" className="button danger-solid">
                Delete household
              </button>
            </div>
          </form>

          <p className="small muted" style={{ margin: 0 }}>
            There is no undo and no export. Nothing here can be recovered afterwards. To close your
            account instead, go to <Link to="/households">Your households</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
