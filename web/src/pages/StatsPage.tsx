import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Stats } from '../api';
import { currentMonth, formatMoney, monthLabel, shiftMonth, shortMonthLabel } from '../format';
import { useSession } from '../session';

/**
 * The categorical slots from styles.css, in the order the API returns members
 * (by name). Position, never rank — so narrowing the range cannot repaint the
 * people who are still on screen. Anyone past the last slot folds into the
 * grey "Other" bucket rather than getting a made-up colour.
 */
const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];
const FOLDED = 'var(--muted)';

const PRESETS: Array<{ label: string; months: number }> = [
  { label: 'This month', months: 1 },
  { label: '3 months', months: 3 },
  { label: '6 months', months: 6 },
  { label: '12 months', months: 12 },
];

/** What a row with a null id is called. The API leaves naming to the UI. */
const memberName = (name: string | null) => name ?? 'Unassigned';
const categoryName = (name: string | null) => name ?? 'Uncategorised';

export default function StatsPage() {
  const { household } = useSession();
  const currency = household?.currency ?? 'USD';

  const [to, setTo] = useState(currentMonth());
  const [from, setFrom] = useState(() => shiftMonth(currentMonth(), -5));
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setStats(await api.get<Stats>(`/expenses/stats?from=${from}&to=${to}`));
  }, [from, to]);

  useEffect(() => {
    setError('');
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  const applyPreset = (months: number) => {
    const end = currentMonth();
    setTo(end);
    setFrom(shiftMonth(end, -(months - 1)));
  };

  // Keep the range the right way round rather than bouncing a 400 back at
  // someone who is only halfway through picking it.
  const pickFrom = (value: string) => {
    if (!value) return;
    setFrom(value);
    if (value > to) setTo(value);
  };
  const pickTo = (value: string) => {
    if (!value) return;
    setTo(value);
    if (value < from) setFrom(value);
  };

  /** Every member's colour, keyed by id, assigned once from the API's order. */
  const colorOf = useMemo(() => {
    const colors = new Map<string | null, string>();
    let slot = 0;
    for (const member of stats?.members ?? []) {
      colors.set(member.user_id, member.user_id === null ? FOLDED : (SERIES[slot++] ?? FOLDED));
    }
    return colors;
  }, [stats]);

  const membersBySpend = useMemo(
    () => [...(stats?.members ?? [])].sort((a, b) => b.spent_cents - a.spent_cents),
    [stats],
  );
  const spenders = membersBySpend.filter((row) => row.spent_cents > 0);
  const spentCategories = (stats?.categories ?? []).filter((row) => row.spent_cents > 0);

  /**
   * The stacked chart's series: one per member that has a colour of its own,
   * plus a single bucket for everyone folded into grey. Named separately when
   * the bucket is only the unattributed spending, since that is not "other
   * people" — it is money whose payer has left the household.
   */
  const series = useMemo(() => {
    const own = (stats?.members ?? []).filter((row) => colorOf.get(row.user_id) !== FOLDED);
    const folded = (stats?.members ?? []).filter((row) => colorOf.get(row.user_id) === FOLDED);
    const rows = own.map((row) => ({
      key: row.user_id ?? 'folded',
      label: memberName(row.name),
      color: colorOf.get(row.user_id) ?? FOLDED,
      ids: [row.user_id],
    }));
    if (folded.length > 0) {
      rows.push({
        key: 'folded',
        label: folded.length === 1 ? memberName(folded[0].name) : 'Other',
        color: FOLDED,
        ids: folded.map((row) => row.user_id),
      });
    }
    return rows;
  }, [stats, colorOf]);

  const total = stats?.total_cents ?? 0;
  const memberMax = Math.max(1, ...membersBySpend.map((row) => row.spent_cents));
  const categoryMax = Math.max(1, ...spentCategories.map((row) => row.spent_cents));
  const monthMax = Math.max(1, ...(stats?.monthly ?? []).map((point) => point.total_cents));

  /** Cross-tab lookup: what one member spent in one category. */
  const cell = (userId: string | null, categoryId: string | null) =>
    stats?.matrix.find((row) => row.user_id === userId && row.category_id === categoryId)
      ?.spent_cents ?? 0;

  const share = (cents: number) => (total > 0 ? Math.round((cents / total) * 100) : 0);
  const rangeLabel =
    from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Statistics</h1>
          <p>
            {stats
              ? `${stats.count} expense${stats.count === 1 ? '' : 's'} · ${rangeLabel}`
              : 'Loading…'}
          </p>
        </div>
        <div className="row">
          {PRESETS.map((preset) => {
            const active = to === currentMonth() && from === shiftMonth(to, -(preset.months - 1));
            return (
              <button
                key={preset.label}
                type="button"
                className={active ? 'button small' : 'button secondary small'}
                aria-pressed={active}
                onClick={() => applyPreset(preset.months)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="card range-picker">
        <div>
          <label htmlFor="statsFrom">From</label>
          <input
            id="statsFrom"
            type="month"
            value={from}
            onChange={(event) => pickFrom(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="statsTo">To</label>
          <input
            id="statsTo"
            type="month"
            value={to}
            onChange={(event) => pickTo(event.target.value)}
          />
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Total spent</div>
          <div className="stat-value">{formatMoney(total, currency)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Monthly average</div>
          <div className="stat-value">
            {formatMoney(Math.round(total / Math.max(1, stats?.months ?? 1)), currency)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Spent most</div>
          <div className="stat-value">{spenders[0] ? memberName(spenders[0].name) : '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Biggest category</div>
          <div className="stat-value">
            {spentCategories[0] ? categoryName(spentCategories[0].name) : '—'}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <h2>Who spent what</h2>
            <span className="muted small">{rangeLabel}</span>
          </div>
          {spenders.length === 0 ? (
            <p className="empty small">Nothing recorded in this range yet.</p>
          ) : (
            membersBySpend.map((row) => (
              <div className="budget-row" key={row.user_id ?? 'unassigned'}>
                <div className="budget-head">
                  <span className="row" style={{ gap: '0.4rem' }}>
                    <span
                      className="dot"
                      style={{ background: colorOf.get(row.user_id) }}
                      aria-hidden="true"
                    />
                    <span className={row.name === null ? 'muted' : undefined}>
                      {memberName(row.name)}
                    </span>
                  </span>
                  <span className="num">
                    <span className="strong">{formatMoney(row.spent_cents, currency)}</span>{' '}
                    <span className="muted small">{share(row.spent_cents)}%</span>
                  </span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(row.spent_cents / memberMax) * 100}%`,
                      background: colorOf.get(row.user_id),
                    }}
                  />
                </div>
                <span className="muted small">
                  {row.count} expense{row.count === 1 ? '' : 's'}
                  {row.count > 0 &&
                    ` · ${formatMoney(Math.round(row.spent_cents / row.count), currency)} average`}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Where it went</h2>
            <span className="muted small">{rangeLabel}</span>
          </div>
          {spentCategories.length === 0 ? (
            <p className="empty small">No spending to break down yet.</p>
          ) : (
            spentCategories.map((row) => (
              <div className="budget-row" key={row.category_id ?? 'uncategorised'}>
                <div className="budget-head">
                  <span className="row" style={{ gap: '0.4rem' }}>
                    <span
                      className="dot"
                      style={{ background: row.color ?? 'var(--muted)' }}
                      aria-hidden="true"
                    />
                    <span className={row.name === null ? 'muted' : undefined}>
                      {categoryName(row.name)}
                    </span>
                  </span>
                  <span className="num">
                    <span className="strong">{formatMoney(row.spent_cents, currency)}</span>{' '}
                    <span className="muted small">{share(row.spent_cents)}%</span>
                  </span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(row.spent_cents / categoryMax) * 100}%`,
                      background: row.color ?? 'var(--muted)',
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Month by month</h2>
          <span className="muted small">Stacked by who paid</span>
        </div>
        {total === 0 ? (
          <p className="empty small">Nothing recorded in this range yet.</p>
        ) : (
          <>
            <div className="stacked-chart">
              {stats?.monthly.map((point) => (
                <div className="stacked-col" key={point.month}>
                  <span className="stacked-label">
                    {point.total_cents > 0 ? Math.round(point.total_cents / 100) : ''}
                  </span>
                  <div
                    className="stacked-bar"
                    style={{ height: `${(point.total_cents / monthMax) * 100}%` }}
                    title={`${monthLabel(point.month)}: ${formatMoney(point.total_cents, currency)}`}
                  >
                    {series.map((row) => {
                      const cents = point.by_member
                        .filter((entry) => row.ids.includes(entry.user_id))
                        .reduce((sum, entry) => sum + entry.spent_cents, 0);
                      if (cents === 0) return null;
                      return (
                        <div
                          key={row.key}
                          className="stacked-seg"
                          style={{ flexGrow: cents, background: row.color }}
                          title={`${row.label}, ${monthLabel(point.month)}: ${formatMoney(cents, currency)}`}
                        />
                      );
                    })}
                  </div>
                  <span className="stacked-label">{shortMonthLabel(point.month)}</span>
                </div>
              ))}
            </div>
            <div className="legend">
              {series.map((row) => (
                <span key={row.key}>
                  <span className="swatch" style={{ background: row.color }} aria-hidden="true" />
                  {row.label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <h2>How much each spent, per category</h2>
          <span className="muted small">{rangeLabel}</span>
        </div>
        {spenders.length === 0 || spentCategories.length === 0 ? (
          <p className="empty small">Nothing to cross-reference yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  {spenders.map((member) => (
                    <th key={member.user_id ?? 'unassigned'} className="num">
                      {memberName(member.name)}
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {spentCategories.map((row) => (
                  <tr key={row.category_id ?? 'uncategorised'}>
                    <td>
                      {/* No wrapping: a narrow column would otherwise drop the
                          dot onto a line of its own. */}
                      <span className="row" style={{ gap: '0.4rem', flexWrap: 'nowrap' }}>
                        <span
                          className="dot"
                          style={{ background: row.color ?? 'var(--muted)' }}
                          aria-hidden="true"
                        />
                        {categoryName(row.name)}
                      </span>
                    </td>
                    {spenders.map((member) => {
                      const cents = cell(member.user_id, row.category_id);
                      return (
                        <td key={member.user_id ?? 'unassigned'} className="num">
                          {cents > 0 ? (
                            formatMoney(cents, currency)
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="num strong">{formatMoney(row.spent_cents, currency)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="strong">Total</td>
                  {spenders.map((member) => (
                    <td key={member.user_id ?? 'unassigned'} className="num strong">
                      {formatMoney(member.spent_cents, currency)}
                    </td>
                  ))}
                  <td className="num strong">{formatMoney(total, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
