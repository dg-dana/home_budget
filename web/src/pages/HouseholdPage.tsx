import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Category, type Invite, type Member, type Notice } from '../api';
import { formatMoney } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'CHF', 'SEK', 'PLN', 'INR'];

export default function HouseholdPage() {
  const { user, household, ownerRecovery, refresh } = useSession();
  const { t, tx, plural, message } = useI18n();
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
  // Invite failures show under the form rather than in the page-level alert at
  // the top: on a phone that alert is off screen by the time you have typed an
  // address, so a refusal looked like nothing happening at all.
  const [inviteError, setInviteError] = useState('');
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
    load().catch((err: unknown) => setError(message(err, 'common.somethingWrong')));
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
      setError(message(err, 'common.somethingWrong'));
    }
  };

  const inviteUrl = (token: string) => `${window.location.origin}/join/${token}`;

  // The two cases the server refuses to let somebody leave in (§3). Both are
  // already on screen in the member list above, so saying so under a disabled
  // button beats a round trip that only produces an error.
  const soleOwner = isOwner && !members.some((m) => m.role === 'owner' && m.id !== user?.id);
  const lastPerson = members.length === 1;
  const strandedOwner = soleOwner && !lastPerson;

  const copyInvite = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken(''), 2000);
    } catch {
      setError(t('common.copyFailed'));
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
      setPasswordNotice(t('household.passwordChanged'));
    } catch (err) {
      setError(message(err, 'household.passwordFailed'));
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
      setError(message(err, 'household.resetFailed'));
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

  /**
   * Leaving, which is the only thing in here that takes no password: it
   * destroys nothing and an invite undoes it, so the round trip would be
   * friction for the person with the least power in the household. The two
   * cases the server refuses are shown as text rather than tried — the
   * conditions are already on screen in the member list.
   */
  const handleLeave = async () => {
    setDangerError('');
    const name = household?.name ?? t('household.thisHousehold');
    if (!window.confirm(t('household.confirmLeave', { household: name }))) return;
    try {
      await api.delete('/household/members/me');
      await returnToHouseholds();
    } catch (err) {
      setDangerError(message(err, 'household.leaveFailed'));
    }
  };

  const handleDeleteHousehold = async (event: React.FormEvent) => {
    event.preventDefault();
    setDangerError('');
    const others = members.length - 1;
    const name = household?.name ?? t('household.thisHousehold');
    // Whole sentences either way rather than one built from clauses: what the
    // other people lose sits in the middle of the German one, not the end.
    const warning =
      others > 0
        ? plural(others, 'household.confirmDeleteOthers', { household: name })
        : t('household.confirmDelete', { household: name });
    if (!window.confirm(warning)) return;
    try {
      await api.delete('/household', { password: dangerPassword });
      await returnToHouseholds();
    } catch (err) {
      setDangerError(message(err, 'household.deleteFailed'));
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
      setError(t('household.budgetPositive'));
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
          <h1>{t('household.title')}</h1>
          <p>{t('household.subtitle')}</p>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="grid-2">
        <div className="card stack">
          <div className="card-title">
            <h2>{t('household.members')}</h2>
            <span className="muted small">{members.length}</span>
          </div>

          {/* The answer an owner needs when somebody says "I am locked out"
              and there is no longer a button here for it. */}
          {isOwner && !ownerRecovery && (
            <p className="small muted" style={{ margin: 0 }}>
              {t('household.lockedOutHint')}
            </p>
          )}

          <ul className="item-list">
            {members.map((member) => (
              <li className="item" key={member.id}>
                <div className="item-main">
                  <div className="item-name">
                    {member.name}
                    {member.id === user?.id && (
                      <span className="muted small"> · {t('common.you')}</span>
                    )}
                  </div>
                  <div className="item-meta">
                    <span>{member.email}</span>
                    <span className="tag">{t(`common.role.${member.role}`)}</span>
                  </div>
                </div>
                {/* Only where the app cannot email: everywhere else people
                    help themselves from the sign-in page, and an owner is not
                    given a key to an account that may span other households. */}
                {isOwner && ownerRecovery && (
                  <button
                    type="button"
                    className="button secondary small"
                    title={t('household.resetPasswordTitle', { name: member.name })}
                    onClick={() => handleIssueReset(member)}
                  >
                    {t('household.resetPassword')}
                  </button>
                )}
                {isOwner && member.id !== user?.id && (
                  <button
                    type="button"
                    className="button secondary small"
                    title={t(
                      member.role === 'owner'
                        ? 'household.makeMemberTitle'
                        : 'household.makeOwnerTitle',
                      { name: member.name },
                    )}
                    onClick={() => {
                      const next = member.role === 'owner' ? 'member' : 'owner';
                      const question = t(
                        next === 'owner'
                          ? 'household.confirmMakeOwner'
                          : 'household.confirmMakeMember',
                        { name: member.name },
                      );
                      if (window.confirm(question)) {
                        void run(async () => {
                          await api.put(`/household/members/${member.id}/role`, { role: next });
                          await refresh();
                        });
                      }
                    }}
                  >
                    {t(member.role === 'owner' ? 'household.makeMember' : 'household.makeOwner')}
                  </button>
                )}
                {isOwner && member.id !== user?.id && (
                  <button
                    type="button"
                    className="icon-button danger"
                    title={t('household.removeTitle', { name: member.name })}
                    aria-label={t('household.removeTitle', { name: member.name })}
                    onClick={() => {
                      if (window.confirm(t('household.confirmRemove', { name: member.name }))) {
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
              <h3 className="muted small">{t('household.resetLinks')}</h3>
              {Object.entries(resetLinks).map(([memberId, link]) => (
                <div key={memberId}>
                  <p className="small muted" style={{ margin: '0 0 0.25rem' }}>
                    {t(
                      link.delivered
                        ? 'household.resetLinkEmailed'
                        : 'household.resetLinkDirect',
                      {
                        name:
                          members.find((m) => m.id === memberId)?.name ??
                          t('household.someMember'),
                      },
                    )}
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
                          setError(t('common.copyFailed'));
                        }
                      }}
                    >
                      {t(copiedToken === memberId ? 'common.copied' : 'common.copy')}
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
                  setInviteError('');
                  void (async () => {
                    try {
                      const created = await api.post<{ notice: Notice }>('/household/invites', {
                        email: inviteEmail,
                        role: 'member',
                      });
                      setInviteNotice(
                        created.notice.delivered
                          ? t('household.inviteEmailed', { email: created.notice.to })
                          : '',
                      );
                      setInviteEmail('');
                      await load();
                    } catch (err) {
                      // Kept beside the form, and the address kept in the box:
                      // "already in this household" is answered by editing what
                      // was typed, not by typing it again.
                      setInviteError(
                        message(err, 'household.inviteFailed'),
                      );
                    }
                  })();
                }}
              >
                <input
                  type="email"
                  aria-label={t('household.inviteEmailLabel')}
                  placeholder={t('household.inviteEmailPlaceholder')}
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  style={{ flex: 1, minWidth: '180px' }}
                />
                <button type="submit" className="button">
                  {t('household.createInvite')}
                </button>
              </form>

              {inviteError && <div className="alert">{inviteError}</div>}

              {inviteNotice && (
                <p className="small muted" style={{ margin: 0 }}>
                  {inviteNotice}
                </p>
              )}

              {invites.length > 0 && (
                <div className="stack" style={{ gap: '0.5rem' }}>
                  <h3 className="muted small">{t('household.pendingInvites')}</h3>
                  {invites.map((invite) => (
                    <div className="share-box" key={invite.token}>
                      <code>{inviteUrl(invite.token)}</code>
                      <button
                        type="button"
                        className="button small"
                        onClick={() => copyInvite(invite.token)}
                      >
                        {t(copiedToken === invite.token ? 'common.copied' : 'common.copy')}
                      </button>
                      <button
                        type="button"
                        className="button danger small"
                        onClick={() => run(() => api.delete(`/household/invites/${invite.token}`))}
                      >
                        {t('household.revoke')}
                      </button>
                    </div>
                  ))}
                  <p className="small muted" style={{ margin: 0 }}>
                    {t('household.inviteExpiry')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="stack">
        <div className="card stack">
          <div className="card-title">
            <h2>{t('household.settings')}</h2>
          </div>

          {isOwner ? (
            <form className="stack" onSubmit={handleSaveSettings}>
              <div>
                <label htmlFor="householdName">{t('household.nameLabel')}</label>
                <input
                  id="householdName"
                  required
                  value={settings.name}
                  onChange={(event) => setSettings({ ...settings, name: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="currency">{t('common.currency')}</label>
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
                  {t('household.saveSettings')}
                </button>
              </div>
            </form>
          ) : (
            <p className="muted small">{t('household.ownerOnly')}</p>
          )}
        </div>

        <div className="card stack">
          <div className="card-title">
            <h2>{t('household.yourNameHere')}</h2>
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
                setDisplayNameNotice(t('household.saved'));
              });
            }}
          >
            <div>
              <label htmlFor="displayName">
                {t('household.nameInLabel', {
                  household: household?.name ?? t('household.thisHousehold'),
                })}
              </label>
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
                {t('household.saveName')}
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {t('household.nameHelp')}
            </p>
          </form>
        </div>

        <div className="card stack">
          <div className="card-title">
            <h2>{t('household.yourPassword')}</h2>
          </div>

          {passwordNotice && <div className="alert info">{passwordNotice}</div>}

          <form className="stack" onSubmit={handleChangePassword}>
            <div>
              <label htmlFor="currentPassword">{t('household.currentPassword')}</label>
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
              <label htmlFor="newPassword">{t('household.newPassword')}</label>
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
                {t('household.changePassword')}
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {t('household.passwordHelp')}
            </p>
          </form>
        </div>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">
          <h2>{t('household.categories')}</h2>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('common.category')}</th>
                <th>{t('household.monthlyBudget')}</th>
                <th aria-label={t('household.actions')} />
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td>
                    <span className="row" style={{ gap: '0.5rem' }}>
                      <input
                        type="color"
                        aria-label={t('household.categoryColour', { name: category.name })}
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
                      aria-label={t('household.categoryBudget', { name: category.name })}
                      placeholder={t('household.noLimit')}
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
                      title={t('household.deleteCategoryTitle', { name: category.name })}
                      aria-label={t('household.deleteCategoryTitle', { name: category.name })}
                      onClick={() => {
                        if (
                          window.confirm(
                            t('household.confirmDeleteCategory', { name: category.name }),
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
            aria-label={t('household.newCategoryName')}
            placeholder={t('household.newCategory')}
            value={newCategory.name}
            onChange={(event) => setNewCategory({ ...newCategory, name: event.target.value })}
            style={{ flex: 1, minWidth: '160px' }}
          />
          <input
            type="color"
            aria-label={t('household.newCategoryColour')}
            value={newCategory.color}
            onChange={(event) => setNewCategory({ ...newCategory, color: event.target.value })}
            style={{ width: '48px', padding: '2px', height: '38px' }}
          />
          <input
            type="number"
            min="0"
            aria-label={t('household.monthlyBudget')}
            placeholder={t('household.budgetPlaceholder', { currency })}
            value={newCategory.budget}
            onChange={(event) => setNewCategory({ ...newCategory, budget: event.target.value })}
            style={{ maxWidth: '160px' }}
          />
          <button type="submit" className="button" disabled={!newCategory.name.trim()}>
            {t('household.add')}
          </button>
        </form>

        <p className="small muted" style={{ margin: 0 }}>
          {t('household.budgetHelp', { amount: formatMoney(50000, currency) })}
        </p>
      </div>

      {/*
        Closing an account is not here: it belongs to the account rather than to
        whichever household happens to be open, and it lives on `/households`,
        which is the one page an account with no household can still reach.
        Leaving *is* here, because it is about this household and no other â and
        it is why this card renders for everybody, where deleting the household
        is the owner-only half inside it.
      */}
      <div className="card stack danger-zone">
        <div className="card-title">
          <h2>{t('household.dangerZone')}</h2>
        </div>

        {dangerError && <div className="alert">{dangerError}</div>}

        <div className="grid-2">
          <div className="stack">
            <div>
              <h3 style={{ margin: 0 }}>{t('household.leaveTitle')}</h3>
              <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
                {t(
                  strandedOwner
                    ? 'household.leaveSoleOwner'
                    : lastPerson
                      ? 'household.leaveLastPerson'
                      : 'household.leaveBody',
                )}
              </p>
            </div>
            <div>
              <button
                type="button"
                className="button danger-outline"
                disabled={strandedOwner || lastPerson}
                onClick={handleLeave}
              >
                {t('household.leaveButton')}
              </button>
            </div>
          </div>

          {isOwner && (
            <form className="stack" onSubmit={handleDeleteHousehold}>
              <div>
                <h3 style={{ margin: 0 }}>{t('household.deleteTitle')}</h3>
                <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
                  {t('household.deleteBody')}
                </p>
              </div>
              <div>
                <label htmlFor="deleteHouseholdPassword">{t('common.confirmPassword')}</label>
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
                  {t('household.deleteButton')}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="small muted" style={{ margin: 0 }}>
          {tx('household.dangerFooter', {
            link: <Link to="/households">{t('household.yourHouseholds')}</Link>,
          })}
        </p>
      </div>
    </div>
  );
}
