import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type Category,
  type Frequency,
  type Member,
  type RecurringExpense,
} from '../api';
import { centsToAmount, dayLabel, formatMoney, normalizeAmountInput, today } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import type { StringKey } from '../strings';

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

const FREQUENCY_LABELS: Record<Frequency, StringKey> = {
  weekly: 'recurring.weekly',
  monthly: 'recurring.monthly',
  yearly: 'recurring.yearly',
};

/** Roughly what a rule costs per month, so mixed frequencies can be compared. */
function monthlyEquivalent(rule: RecurringExpense): number {
  if (rule.frequency === 'weekly') return Math.round((rule.amount_cents * 52) / 12);
  if (rule.frequency === 'yearly') return Math.round(rule.amount_cents / 12);
  return rule.amount_cents;
}

export default function RecurringPage() {
  const { user, household } = useSession();
  const { t, message } = useI18n();
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
    load().catch((err: unknown) => setError(message(err, 'common.somethingWrong')));
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(message(err, 'common.somethingWrong'));
    }
  };

  const update =
    (key: keyof RuleForm) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const updateAmount = (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, amount: normalizeAmountInput(event.target.value) }));

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
    const what = rule.description || t('recurring.thisRule');
    if (!window.confirm(t('recurring.confirmDelete', { what }))) return;
    void run(() => api.delete(`/recurring/${rule.id}`));
  };

  const activeTotal = rules
    .filter((rule) => rule.is_active === 1)
    .reduce((sum, rule) => sum + monthlyEquivalent(rule), 0);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>{t('recurring.title')}</h1>
          <p>{t('recurring.subtitle')}</p>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">{t('recurring.committed')}</div>
          <div className="stat-value">{formatMoney(activeTotal, currency)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('recurring.activeRules')}</div>
          <div className="stat-value">{rules.filter((rule) => rule.is_active === 1).length}</div>
        </div>
      </div>

      <form className="card stack" onSubmit={handleSubmit}>
        <div className="card-title">
          <h2>{t(editingId ? 'recurring.editTitle' : 'recurring.addTitle')}</h2>
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
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[.,]?[0-9]*"
              required
              placeholder={t('common.amountPlaceholder')}
              value={form.amount}
              onChange={updateAmount}
            />
          </div>
          <div>
            <label htmlFor="frequency">{t('recurring.repeats')}</label>
            <select id="frequency" value={form.frequency} onChange={update('frequency')}>
              {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((value) => (
                <option key={value} value={value}>
                  {t(FREQUENCY_LABELS[value])}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="description">{t('common.description')}</label>
          <input
            id="description"
            required
            placeholder={t('recurring.descriptionPlaceholder')}
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

        <div className="field-row">
          <div>
            <label htmlFor="startsOn">{t('recurring.firstCharge')}</label>
            <input id="startsOn" type="date" required value={form.startsOn} onChange={update('startsOn')} />
          </div>
          <div>
            <label htmlFor="endsOn">{t('recurring.stopsAfter')}</label>
            <input id="endsOn" type="date" value={form.endsOn} onChange={update('endsOn')} />
          </div>
        </div>

        <button type="submit" className="button" disabled={busy}>
          {t(
            busy
              ? 'common.saving'
              : editingId
                ? 'expenses.saveChanges'
                : 'recurring.addSubmit',
          )}
        </button>
      </form>

      <div className="card">
        <div className="card-title">
          <h2>{t('recurring.scheduled')}</h2>
          <span className="muted small">{t('recurring.totalCount', { count: rules.length })}</span>
        </div>

        {rules.length === 0 ? (
          <p className="empty">{t('recurring.empty')}</p>
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
                    {rule.description || t('recurring.fallbackName')}
                    {rule.is_active === 0 && (
                      <span className="tag" style={{ marginLeft: '0.4rem' }}>
                        {t('recurring.paused')}
                      </span>
                    )}
                  </div>
                  <div className="item-meta">
                    <span>{t(FREQUENCY_LABELS[rule.frequency])}</span>
                    <span>·</span>
                    <span>{rule.category_name ?? t('common.uncategorised')}</span>
                    {rule.paid_by_name && (
                      <>
                        <span>·</span>
                        <span>{rule.paid_by_name}</span>
                      </>
                    )}
                    {rule.next_due_on && (
                      <>
                        <span>·</span>
                        <span>{t('recurring.nextOn', { date: dayLabel(rule.next_due_on) })}</span>
                      </>
                    )}
                    {rule.ends_on && (
                      <>
                        <span>·</span>
                        <span>{t('recurring.until', { date: dayLabel(rule.ends_on) })}</span>
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
                  {t(rule.is_active === 1 ? 'recurring.pause' : 'recurring.resume')}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={t('common.edit')}
                  aria-label={t('expenses.editRow', { what: rule.description || t('recurring.fallbackName') })}
                  onClick={() => startEdit(rule)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  title={t('common.delete')}
                  aria-label={t('expenses.deleteRow', { what: rule.description || t('recurring.fallbackName') })}
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
