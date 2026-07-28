import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type Category,
  type Frequency,
  type Member,
  type RecurringExpense,
} from '../api';
import { centsToAmount, dayLabel, formatMoney, today } from '../format';
import { useSession } from '../session';

interface RuleForm {
  amount: string;
  description: string;
  categoryId: string;
  paidBy: string;
  frequency: Frequency;
  startsOn: string;
  endsOn: string;
}

const emptyForm = (userId: string): RuleForm => ({
  amount: '',
  description: '',
  categoryId: '',
  paidBy: userId,
  frequency: 'monthly',
  startsOn: today(),
  endsOn: '',
});

const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

/** Roughly what a rule costs per month, so mixed frequencies can be compared. */
function monthlyEquivalent(rule: RecurringExpense): number {
  if (rule.frequency === 'weekly') return Math.round((rule.amount_cents * 52) / 12);
  if (rule.frequency === 'yearly') return Math.round(rule.amount_cents / 12);
  return rule.amount_cents;
}

export default function RecurringPage() {
  const { user, household } = useSession();
  const currency = household?.currency ?? 'USD';

  const [rules, setRules] = useState<RecurringExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState<RuleForm>(() => emptyForm(user?.id ?? ''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [ruleList, categoryList, memberList] = await Promise.all([
      api.get<RecurringExpense[]>('/recurring'),
      api.get<Category[]>('/categories'),
      api.get<Member[]>('/household/members'),
    ]);
    setRules(ruleList);
    setCategories(categoryList);
    setMembers(memberList);
  }, []);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const update =
    (key: keyof RuleForm) =>
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
      setError('Enter an amount greater than zero');
      return;
    }

    setBusy(true);
    const payload = {
      amount,
      description: form.description,
      categoryId: form.categoryId || null,
      paidBy: form.paidBy || null,
      frequency: form.frequency,
      startsOn: form.startsOn,
      endsOn: form.endsOn || null,
    };

    await run(async () => {
      if (editingId) await api.put(`/recurring/${editingId}`, payload);
      else await api.post('/recurring', payload);
      resetForm();
    });
    setBusy(false);
  };

  const startEdit = (rule: RecurringExpense) => {
    setEditingId(rule.id);
    setForm({
      amount: centsToAmount(rule.amount_cents),
      description: rule.description,
      categoryId: rule.category_id ?? '',
      paidBy: rule.paid_by ?? '',
      frequency: rule.frequency,
      startsOn: rule.starts_on,
      endsOn: rule.ends_on ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = (rule: RecurringExpense) => {
    if (
      !window.confirm(
        `Stop "${rule.description || 'this recurring expense'}"? Expenses it already created are kept.`,
      )
    ) {
      return;
    }
    void run(() => api.delete(`/recurring/${rule.id}`));
  };

  const activeTotal = rules
    .filter((rule) => rule.is_active === 1)
    .reduce((sum, rule) => sum + monthlyEquivalent(rule), 0);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Recurring expenses</h1>
          <p>
            Rent, bills and subscriptions. Each one is added to your expenses automatically when it
            falls due — including anything missed while you were away.
          </p>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Committed per month</div>
          <div className="stat-value">{formatMoney(activeTotal, currency)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Active rules</div>
          <div className="stat-value">{rules.filter((rule) => rule.is_active === 1).length}</div>
        </div>
      </div>

      <form className="card stack" onSubmit={handleSubmit}>
        <div className="card-title">
          <h2>{editingId ? 'Edit recurring expense' : 'Add a recurring expense'}</h2>
          {editingId && (
            <button type="button" className="button secondary small" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>

        <div className="field-row">
          <div>
            <label htmlFor="amount">Amount</label>
            <input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              inputMode="decimal"
              placeholder="0.00"
              value={form.amount}
              onChange={update('amount')}
            />
          </div>
          <div>
            <label htmlFor="frequency">Repeats</label>
            <select id="frequency" value={form.frequency} onChange={update('frequency')}>
              {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((value) => (
                <option key={value} value={value}>
                  {FREQUENCY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="description">Description</label>
          <input
            id="description"
            required
            placeholder="Rent, electricity, streaming…"
            value={form.description}
            onChange={update('description')}
          />
        </div>

        <div className="field-row">
          <div>
            <label htmlFor="categoryId">Category</label>
            <select id="categoryId" value={form.categoryId} onChange={update('categoryId')}>
              <option value="">Uncategorised</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="paidBy">Paid by</label>
            <select id="paidBy" value={form.paidBy} onChange={update('paidBy')}>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row">
          <div>
            <label htmlFor="startsOn">First charge</label>
            <input id="startsOn" type="date" required value={form.startsOn} onChange={update('startsOn')} />
          </div>
          <div>
            <label htmlFor="endsOn">Stops after (optional)</label>
            <input id="endsOn" type="date" value={form.endsOn} onChange={update('endsOn')} />
          </div>
        </div>

        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add recurring expense'}
        </button>
      </form>

      <div className="card">
        <div className="card-title">
          <h2>Scheduled</h2>
          <span className="muted small">{rules.length} total</span>
        </div>

        {rules.length === 0 ? (
          <p className="empty">
            Nothing recurring yet. Add your rent or a subscription above and it will appear in your
            expenses on its own.
          </p>
        ) : (
          <ul className="item-list">
            {rules.map((rule) => (
              <li className={`item${rule.is_active ? '' : ' checked'}`} key={rule.id}>
                <span
                  className="dot"
                  style={{ background: rule.category_color ?? 'var(--muted)' }}
                  aria-hidden="true"
                />
                <div className="item-main">
                  <div className="item-name">
                    {rule.description || 'Recurring expense'}
                    {rule.is_active === 0 && <span className="tag" style={{ marginLeft: '0.4rem' }}>Paused</span>}
                  </div>
                  <div className="item-meta">
                    <span>{FREQUENCY_LABELS[rule.frequency]}</span>
                    <span>·</span>
                    <span>{rule.category_name ?? 'Uncategorised'}</span>
                    {rule.paid_by_name && (
                      <>
                        <span>·</span>
                        <span>{rule.paid_by_name}</span>
                      </>
                    )}
                    {rule.next_due_on && (
                      <>
                        <span>·</span>
                        <span>next {dayLabel(rule.next_due_on)}</span>
                      </>
                    )}
                    {rule.ends_on && (
                      <>
                        <span>·</span>
                        <span>until {dayLabel(rule.ends_on)}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="amount">{formatMoney(rule.amount_cents, currency)}</span>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() =>
                    run(() =>
                      api.post(`/recurring/${rule.id}/active`, { isActive: rule.is_active === 0 }),
                    )
                  }
                >
                  {rule.is_active === 1 ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="Edit"
                  onClick={() => startEdit(rule)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  title="Delete"
                  onClick={() => handleDelete(rule)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
