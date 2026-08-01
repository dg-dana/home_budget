import { useEffect, useMemo, useState } from 'react';
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

/**
 * How many categories get a slice of their own before the tail is folded into
 * "Other". A pie is only readable at a glance up to about six slices, and the
 * fold is decided across the whole household so a category keeps the same
 * colour — and the same meaning — in everybody's pie.
 */
const PIE_SLICES = 5;

const pointOnCircle = (radius: number, degrees: number) => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: 50 + radius * Math.cos(radians),
    y: 50 + radius * Math.sin(radians),
  };
};

/** An SVG wedge in a 100x100 viewBox centred on (50, 50). */
function wedge(radius: number, startDegrees: number, endDegrees: number): string {
  const start = pointOnCircle(radius, startDegrees);
  const end = pointOnCircle(radius, endDegrees);
  const sweptMoreThanHalf = endDegrees - startDegrees > 180 ? 1 : 0;
  return `M 50 50 L ${start.x} ${start.y} A ${radius} ${radius} 0 ${sweptMoreThanHalf} 1 ${end.x} ${end.y} Z`;
}

/**
 * One category followed through the range: a line over the months, with the
 * area under it filled in the category's own colour. Drawn in a 300x90 user
 * space and scaled to whatever width the card gives it.
 */
function CategoryTrend({
  label,
  color,
  currency,
  points,
}: {
  label: string;
  color: string;
  currency: string;
  points: Array<{ month: string; cents: number }>;
}) {
  const top = 8;
  const bottom = 74;
  const left = 6;
  const right = 294;
  const peak = Math.max(1, ...points.map((point) => point.cents));
  const spent = points.reduce((sum, point) => sum + point.cents, 0);
  const busiest = points.reduce(
    (best, point) => (point.cents > best.cents ? point : best),
    points[0],
  );

  // One month is not a trend: a lone dot with the same label at both ends reads
  // as a broken chart. Say what the month was and what would fix it.
  if (points.length < 2) {
    return (
      <div className="trend-panel">
        <p className="muted small" style={{ margin: 0 }}>
          {formatMoney(points[0].cents, currency)} in {monthLabel(points[0].month)}. Widen the range
          to see how it moves.
        </p>
      </div>
    );
  }

  const x = (index: number) => left + (index / (points.length - 1)) * (right - left);
  const y = (cents: number) => bottom - (cents / peak) * (bottom - top);

  const line = points.map((point, index) => `${x(index)},${y(point.cents)}`).join(' ');
  const area = `M ${x(0)},${bottom} L ${line.split(' ').join(' L ')} L ${x(points.length - 1)},${bottom} Z`;

  return (
    <div className="trend-panel">
      <svg
        viewBox="0 0 300 90"
        className="trend-chart"
        role="img"
        aria-label={`${label} by month: ${points
          .map((point) => `${shortMonthLabel(point.month)} ${formatMoney(point.cents, currency)}`)
          .join(', ')}`}
      >
        <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="var(--border)" strokeWidth="1" />
        <path d={area} fill={color} opacity="0.16" />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point, index) => (
          <g key={point.month}>
            <circle cx={x(index)} cy={y(point.cents)} r="3" fill={color} />
            {/* A bigger, invisible target: 3px of circle is not a hit area. */}
            <circle cx={x(index)} cy={y(point.cents)} r="9" fill="transparent">
              <title>{`${monthLabel(point.month)}: ${formatMoney(point.cents, currency)}`}</title>
            </circle>
          </g>
        ))}
        {/* Only the ends are labelled; a tick per month collides once a range
            runs past a handful of them. */}
        <text x={left} y="86" fontSize="9" fill="var(--muted)">
          {shortMonthLabel(points[0].month)}
        </text>
        <text x={right} y="86" fontSize="9" fill="var(--muted)" textAnchor="end">
          {shortMonthLabel(points[points.length - 1].month)}
        </text>
      </svg>
      <p className="muted small" style={{ margin: 0 }}>
        {formatMoney(Math.round(spent / points.length), currency)} a month on average · highest{' '}
        {formatMoney(busiest.cents, currency)} in {monthLabel(busiest.month)}
      </p>
    </div>
  );
}

export default function StatsPage() {
  const { household } = useSession();
  const currency = household?.currency ?? 'USD';

  const [to, setTo] = useState(currentMonth());
  const [from, setFrom] = useState(() => shiftMonth(currentMonth(), -5));
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  /** Which category's trend is open, by id — 'uncategorised' for the null one. */
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  /**
   * Changing the range while a request is still in flight leaves two of them
   * racing, and the one that answers last wins — which can be the older one.
   * The guard makes a superseded response land nowhere, so the charts can
   * never disagree with the range the controls are showing. (The other pages
   * fetch once per screen and do not need this; this one has four presets and
   * two month pickers a click apart.)
   */
  useEffect(() => {
    let current = true;
    setError('');
    api
      .get<Stats>(`/expenses/stats?from=${from}&to=${to}`)
      .then((data) => {
        if (current) setStats(data);
      })
      .catch((err: Error) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
    };
  }, [from, to]);

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
        // Not "Other": a household is seeded with a category of that name, and
        // three different meanings of the word on one page is two too many.
        label: folded.length === 1 ? memberName(folded[0].name) : 'Other people',
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

  /**
   * The slice colours, chosen once for the household: the biggest categories
   * keep their own colour, everything below the cut becomes one grey "Other".
   * Deciding it here rather than per person is what lets the pies be compared
   * with each other.
   */
  const slices = useMemo(() => {
    const named = spentCategories.slice(0, PIE_SLICES).map((row) => ({
      key: row.category_id ?? 'uncategorised',
      label: categoryName(row.name),
      color: row.color ?? 'var(--muted)',
      ids: [row.category_id],
    }));
    const folded = spentCategories.slice(PIE_SLICES);
    if (folded.length > 0) {
      named.push({
        key: 'other',
        // "Other" is a real seeded category name, so the fold cannot borrow it.
        label: `Everything else (${folded.length})`,
        color: 'var(--muted)',
        ids: folded.map((row) => row.category_id),
      });
    }
    return named;
  }, [spentCategories]);

  /** One pie per person: their spending split across those slices. */
  const pies = spenders.map((member) => {
    const parts = slices
      .map((slice) => ({
        ...slice,
        cents: slice.ids.reduce((sum, id) => sum + cell(member.user_id, id), 0),
      }))
      .filter((part) => part.cents > 0);

    let degrees = 0;
    const wedges = parts.map((part) => {
      const start = degrees;
      degrees += (part.cents / member.spent_cents) * 360;
      return { ...part, start, end: degrees };
    });
    return { member, wedges };
  });
  const rangeLabel = from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;

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
            <>
              <p className="muted small" style={{ margin: '-0.4rem 0 0.7rem' }}>
                Pick a category to see how it moved over the range.
              </p>
              {spentCategories.map((row) => {
                const key = row.category_id ?? 'uncategorised';
                const open = openCategory === key;
                return (
                  <div className="budget-row" key={key}>
                    <button
                      type="button"
                      className={`category-row${open ? ' open' : ''}`}
                      aria-expanded={open}
                      onClick={() => setOpenCategory(open ? null : key)}
                    >
                      {/* Spans, not divs: a <button> takes phrasing content, and
                          a <div> inside one is invalid however well it renders.
                          The CSS gives these the layout the divs had. */}
                      <span className="budget-head">
                        <span className="row" style={{ gap: '0.4rem', flexWrap: 'nowrap' }}>
                          <span
                            className="dot"
                            style={{ background: row.color ?? 'var(--muted)' }}
                            aria-hidden="true"
                          />
                          <span className={row.name === null ? 'muted' : undefined}>
                            {categoryName(row.name)}
                          </span>
                          <span className="chevron" aria-hidden="true">
                            {open ? '▾' : '▸'}
                          </span>
                        </span>
                        <span className="num">
                          <span className="strong">{formatMoney(row.spent_cents, currency)}</span>{' '}
                          <span className="muted small">{share(row.spent_cents)}%</span>
                        </span>
                      </span>
                      <span className="bar-track">
                        <span
                          className="bar-fill"
                          style={{
                            width: `${(row.spent_cents / categoryMax) * 100}%`,
                            background: row.color ?? 'var(--muted)',
                          }}
                        />
                      </span>
                    </button>
                    {open && (
                      <CategoryTrend
                        label={categoryName(row.name)}
                        color={row.color ?? 'var(--muted)'}
                        currency={currency}
                        points={(stats?.monthly ?? []).map((point) => ({
                          month: point.month,
                          cents:
                            point.by_category.find((entry) => entry.category_id === row.category_id)
                              ?.spent_cents ?? 0,
                        }))}
                      />
                    )}
                  </div>
                );
              })}
            </>
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
                    style={{
                      height: `${(point.total_cents / monthMax) * 100}%`,
                    }}
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
          <>
            <div className="legend" style={{ marginTop: 0, marginBottom: '1rem' }}>
              {slices.map((slice) => (
                <span key={slice.key}>
                  <span className="swatch" style={{ background: slice.color }} aria-hidden="true" />
                  {slice.label}
                </span>
              ))}
            </div>

            <div className="pie-grid">
              {pies.map(({ member, wedges }) => (
                <div className="pie-cell" key={member.user_id ?? 'unassigned'}>
                  <svg
                    className="pie"
                    viewBox="0 0 100 100"
                    role="img"
                    aria-label={`${memberName(member.name)} spent ${formatMoney(
                      member.spent_cents,
                      currency,
                    )}: ${wedges
                      .map(
                        (part) =>
                          `${part.label} ${Math.round((part.cents / member.spent_cents) * 100)}%`,
                      )
                      .join(', ')}`}
                  >
                    {/* A lone slice is a whole circle; an arc from 0° to 360°
                        would collapse to nothing. */}
                    {wedges.length === 1 ? (
                      <circle cx="50" cy="50" r="48" fill={wedges[0].color} />
                    ) : (
                      wedges.map((part) => (
                        <path
                          key={part.key}
                          d={wedge(48, part.start, part.end)}
                          fill={part.color}
                          /* The card colour between slices, so neighbours read
                             as two rather than one blended shape. */
                          stroke="var(--surface)"
                          strokeWidth="2"
                        >
                          <title>
                            {`${memberName(member.name)} · ${part.label}: ${formatMoney(
                              part.cents,
                              currency,
                            )} (${Math.round((part.cents / member.spent_cents) * 100)}%)`}
                          </title>
                        </path>
                      ))
                    )}
                  </svg>
                  <div className="pie-name">{memberName(member.name)}</div>
                  <div className="muted small">{formatMoney(member.spent_cents, currency)}</div>
                </div>
              ))}
            </div>

            {/* Angles are for the glance; the numbers are for the argument
                about who owes what. Both, rather than one or the other. */}
            <details className="table-details">
              <summary>Show the numbers</summary>
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
                              style={{
                                background: row.color ?? 'var(--muted)',
                              }}
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
            </details>
          </>
        )}
      </div>
    </div>
  );
}
