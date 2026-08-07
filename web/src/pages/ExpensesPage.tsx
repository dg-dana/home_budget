import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Category, type Expense, type Member, type Summary } from '../api';
import {
  centsToAmount,
  currentMonth,
  dayLabel,
  formatMoney,
  monthLabel,
  shiftMonth,
  shortMonthLabel,
  today,
} from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';

interface ExpenseForm {
  amount: string;
  description: string;
  categoryId: string;
  paidBy: string;
  spentOn: string;
}

const emptyForm = (userId: string): ExpenseForm => ({
  amount: '',
  description: '',
  categoryId: '',
  paidBy: userId,
  spentOn: today(),
});

export default function ExpensesPage() {
  const { user, household } = useSession();
  const { t, plural } = useI18n();
  const currency = household?.currency ?? 'USD';

  const [month, setMonth] = useState(currentMonth());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState<ExpenseForm>(() => emptyForm(user?.id ?? ''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [expenseList, summaryData, categoryList, memberList] = await Promise.all([
      api.get<Expense[]>(`/expenses?month=${month}`),
      api.get<Summary>(`/expenses/summary?month=${month}`),
      api.get<Category[]>('/categories'),
      api.get<Member[]>('/household/members'),
    ]);
    setExpenses(expenseList);
    setSummary(summaryData);
    setCategories(categoryList);
    setMembers(memberList);
  }, [month]);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  const update =
    (key: keyof ExpenseForm) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const resetForm = () => {
    setForm(emptyForm(user?.id ?? ''));
    setEditingId(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('expenses.amountPositive'));
      return;
    }

    setBusy(true);
    setError('');
    const payload = {
      amount,
      description: form.description,
      categoryId: form.categoryId || null,
      paidBy: form.paidBy || null,
      spentOn: form.spentOn,
    };

    try {
      if (editingId) {
        await api.put<Expense>(`/expenses/${editingId}`, payload);
      } else {
        await api.post<Expense>('/expenses', payload);
      }
      resetForm();
      // Jump to the month the expense landed in so it is visible straight away.
      const targetMonth = form.spentOn.slice(0, 7);
      if (targetMonth !== month) setMonth(targetMonth);
      else await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('expenses.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (expense: Expense) => {
    setEditingId(expense.id);
    setForm({
      amount: centsToAmount(expense.amount_cents),
      description: expense.description,
      categoryId: expense.category_id ?? '',
      paidBy: expense.paid_by ?? '',
      spentOn: expense.spent_on,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (expense: Expense) => {
    const what = expense.description || t('expenses.thisExpense');
    if (!window.confirm(t('expenses.confirmDelete', { what }))) return;
    try {
      await api.delete(`/expenses/${expense.id}`);
      if (editingId === expense.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('expenses.deleteFailed'));
    }
  };

  const budgeted = useMemo(
    () => summary?.by_category.filter((row) => row.monthly_budget_cents !== null) ?? [],
    [summary],
  );

  const trendMax = Math.max(1, ...(summary?.trend.map((point) => point.total_cents) ?? [1]));

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{monthLabel(month)}</h1>
          <p>
            {summary ? plural(summary.count, 'expenses.count') : t('common.loading')}
          </p>
        </div>
        <div className="row">
          <button type="button" className="button secondary small" onClick={() => setMonth(shiftMonth(month, -1))}>
            {t('expenses.previous')}
          </button>
          <button type="button" className="button secondary small" onClick={() => setMonth(currentMonth())}>
            {t('expenses.thisMonth')}
          </button>
          <button type="button" className="button secondary small" onClick={() => setMonth(shiftMonth(month, 1))}>
            {t('expenses.next')}
          </button>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">{t('expenses.totalSpent')}</div>
          <div className="stat-value">{formatMoney(summary?.total_cents ?? 0, currency)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('expenses.biggestCategory')}</div>
          <div className="stat-value">
            {summary && summary.by_category[0] && summary.by_category[0].spent_cents > 0
              ? summary.by_category[0].name
              : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('expenses.dailyAverage')}</div>
          <div className="stat-value">
            {formatMoney(
              Math.round((summary?.total_cents ?? 0) / new Date(
                Number(month.slice(0, 4)),
                Number(month.slice(5, 7)),
                0,
              ).getDate()),
              currency,
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <form className="card stack" onSubmit={handleSubmit}>
            <div className="card-title">
              <h2>{t(editingId ? 'expenses.editTitle' : 'expenses.addTitle')}</h2>
              {editingId && (
                <button type="button" className="button secondary small" onClick={resetForm}>
                  {t('common.cancel')}
                </button>
              )}
            </div>

            <div className="field-row">
              <div>
                <label htmlFor="amount">{t('common.amount')}</label>
                <input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  inputMode="decimal"
                  placeholder={t('common.amountPlaceholder')}
                  value={form.amount}
                  onChange={update('amount')}
                />
              </div>
              <div>
                <label htmlFor="spentOn">{t('common.date')}</label>
                <input id="spentOn" type="date" required value={form.spentOn} onChange={update('spentOn')} />
              </div>
            </div>

            <div>
              <label htmlFor="description">{t('common.description')}</label>
              <input
                id="description"
                placeholder={t('expenses.descriptionPlaceholder')}
                value={form.description}
                onChange={update('description')}
              />
            </div>

            <div className="field-row">
              <div>
                <label htmlFor="categoryId">{t('common.category')}</label>
                <select id="categoryId" value={form.categoryId} onChange={update('categoryId')}>
                  <option value="">{t('common.uncategorised')}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="paidBy">{t('common.paidBy')}</label>
                <select id="paidBy" value={form.paidBy} onChange={update('paidBy')}>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button type="submit" className="button" disabled={busy}>
              {t(
                busy
                  ? 'common.saving'
                  : editingId
                    ? 'expenses.saveChanges'
                    : 'expenses.addSubmit',
              )}
            </button>
          </form>

          <div className="card">
            <div className="card-title">
              <h2>{t('expenses.listTitle')}</h2>
              <span className="muted small">{t('expenses.shown', { count: expenses.length })}</span>
            </div>

            {expenses.length === 0 ? (
              <p className="empty">{t('expenses.emptyMonth', { month: monthLabel(month) })}</p>
            ) : (
              <div>
                {expenses.map((expense) => (
                  <div className="expense-row" key={expense.id}>
                    <span
                      className="dot"
                      style={{ background: expense.category_color ?? 'var(--muted)' }}
                      aria-hidden="true"
                    />
                    <div className="item-main">
                      <div className="item-name">
                        {expense.description || t('expenses.fallbackName')}
                        {expense.recurring_id && (
                          <span
                            className="tag"
                            style={{ marginLeft: '0.4rem' }}
                            title={t('expenses.repeatingTitle')}
                          >
                            {t('expenses.repeating')}
                          </span>
                        )}
                      </div>
                      <div className="item-meta">
                        <span>{dayLabel(expense.spent_on)}</span>
                        <span>·</span>
                        <span>{expense.category_name ?? t('common.uncategorised')}</span>
                        {expense.paid_by_name && (
                          <>
                            <span>·</span>
                            <span>{expense.paid_by_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="amount">{formatMoney(expense.amount_cents, currency)}</span>
                    <button
                      type="button"
                      className="icon-button"
                      title={t('common.edit')}
                      onClick={() => startEdit(expense)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      title={t('common.delete')}
                      onClick={() => handleDelete(expense)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-title">
              <h2>{t('expenses.budgets')}</h2>
            </div>
            {budgeted.length === 0 ? (
              <p className="empty small">{t('expenses.noBudgets')}</p>
            ) : (
              budgeted.map((row) => {
                const budget = row.monthly_budget_cents ?? 0;
                const ratio = budget > 0 ? row.spent_cents / budget : 0;
                const over = row.spent_cents > budget;
                return (
                  <div className="budget-row" key={row.category_id}>
                    <div className="budget-head">
                      <span className="strong">{row.name}</span>
                      <span className={over ? '' : 'muted'} style={over ? { color: 'var(--danger)' } : undefined}>
                        {formatMoney(row.spent_cents, currency)} / {formatMoney(budget, currency)}
                      </span>
                    </div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${Math.min(100, ratio * 100)}%`,
                          background: over ? 'var(--danger)' : row.color,
                        }}
                      />
                    </div>
                    {over && (
                      <span className="small" style={{ color: 'var(--danger)' }}>
                        {t('expenses.overBy', {
                          amount: formatMoney(row.spent_cents - budget, currency),
                        })}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h2>{t('expenses.byCategory')}</h2>
            </div>
            {summary && summary.total_cents > 0 ? (
              <div className="stack" style={{ gap: '0.6rem' }}>
                {summary.by_category
                  .filter((row) => row.spent_cents > 0)
                  .map((row) => (
                    <div key={row.category_id}>
                      <div className="budget-head">
                        <span className="row" style={{ gap: '0.4rem' }}>
                          <span className="dot" style={{ background: row.color }} aria-hidden="true" />
                          {row.name}
                        </span>
                        <span className="muted">
                          {formatMoney(row.spent_cents, currency)} (
                          {Math.round((row.spent_cents / summary.total_cents) * 100)}%)
                        </span>
                      </div>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            width: `${(row.spent_cents / summary.total_cents) * 100}%`,
                            background: row.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                {summary.uncategorised_cents > 0 && (
                  <div className="budget-head">
                    <span className="muted">{t('common.uncategorised')}</span>
                    <span className="muted">{formatMoney(summary.uncategorised_cents, currency)}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="empty small">{t('expenses.noBreakdown')}</p>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h2>{t('expenses.whoPaid')}</h2>
            </div>
            {summary && summary.by_member.some((row) => row.spent_cents > 0) ? (
              summary.by_member.map((row) => (
                <div className="budget-head" key={row.user_id} style={{ marginBottom: '0.4rem' }}>
                  <span>{row.name}</span>
                  <span className="muted">{formatMoney(row.spent_cents, currency)}</span>
                </div>
              ))
            ) : (
              <p className="empty small">{t('expenses.nothingRecorded')}</p>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h2>{t('expenses.lastSixMonths')}</h2>
            </div>
            {summary && summary.trend.length > 0 ? (
              <div className="trend">
                {summary.trend.map((point) => (
                  <div className="trend-col" key={point.month} title={formatMoney(point.total_cents, currency)}>
                    <span className="small muted">{Math.round(point.total_cents / 100)}</span>
                    <div
                      className="trend-bar"
                      style={{ height: `${(point.total_cents / trendMax) * 100}%` }}
                    />
                    <span className="small muted">{shortMonthLabel(point.month)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty small">{t('expenses.notEnoughHistory')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
