import { Router } from 'express';
import { z } from 'zod';
import { currentUser, newId, nowIso, requireAuth, requireHousehold } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, notFound, parseBody } from '../http.js';
import { materialiseDueExpenses } from '../recurring.js';

export const expensesRouter = Router();

expensesRouter.use(requireAuth, requireHousehold);

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Upper bound on a statistics range, so one request cannot ask for everything. */
const MAX_STATS_MONTHS = 24;

const expenseSchema = z.object({
  // Amount in major currency units (e.g. 12.40), converted to integer cents for storage.
  amount: z.number().positive('Amount must be greater than zero').max(1_000_000_000),
  description: z.string().trim().max(200).default(''),
  categoryId: z.string().uuid().nullable().default(null),
  // Absent means "me"; an explicit null means "nobody in particular", which is
  // a real state — it is also what a removed member's expenses fall back to.
  // Create and update treat this identically.
  paidBy: z.string().uuid().nullable().optional(),
  spentOn: z.string().regex(DATE_PATTERN, 'Date must be in YYYY-MM-DD format'),
});

/** Half-open date range [start, end) covering the given YYYY-MM month. */
function monthRange(month: string): { start: string; end: string } {
  if (!MONTH_PATTERN.test(month)) throw badRequest('month must be in YYYY-MM format');
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  if (monthIndex < 1 || monthIndex > 12) throw badRequest('month must be in YYYY-MM format');
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  return {
    start: `${month}-01`,
    end: `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`,
  };
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

/** Steps a YYYY-MM month by whole months, in either direction. */
function shiftMonth(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Every month from `from` to `to`, inclusive, oldest first. */
function monthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = shiftMonth(month, 1)) months.push(month);
  return months;
}

/**
 * Verifies a category / member id belongs to this household before it is
 * stored, so ids cannot be used to point at another household's rows.
 * Categories hang off the household directly; a person no longer does, so
 * "is this one of ours" is a membership question now.
 */
function assertOwned(
  table: 'categories' | 'users',
  id: string | null | undefined,
  householdId: string,
) {
  if (id === null || id === undefined) return;
  const row =
    table === 'categories'
      ? db.prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?').get(id, householdId)
      : db
          .prepare('SELECT user_id FROM memberships WHERE user_id = ? AND household_id = ?')
          .get(id, householdId);
  if (!row) {
    throw badRequest(table === 'categories' ? 'Unknown category' : 'Unknown household member');
  }
}

/**
 * A payer who has left the household reads as no payer at all.
 *
 * Removing someone now deletes their membership, not their account — they may
 * be in other households — so `expenses.paid_by` keeps pointing at a real user
 * row. Every per-member breakdown therefore has to ask whether that person is
 * still *here*: otherwise their spending would disappear from the split while
 * still counting towards the total, and the cross-tab would stop adding up.
 * Folding them into the existing null-payer row is exactly what §8 already
 * promises — "a removed member's expenses still exist".
 */
const PAYER_IF_STILL_HERE = `
  CASE WHEN EXISTS (
    SELECT 1 FROM memberships m WHERE m.user_id = e.paid_by AND m.household_id = e.household_id
  ) THEN e.paid_by END`;

const SELECT_EXPENSE = `
  SELECT e.id, e.amount_cents, e.description, e.spent_on, e.category_id,
         ${PAYER_IF_STILL_HERE} AS paid_by,
         e.recurring_id, e.created_at,
         c.name AS category_name, c.color AS category_color,
         m.display_name AS paid_by_name
  FROM expenses e
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN memberships m ON m.user_id = e.paid_by AND m.household_id = e.household_id
`;

expensesRouter.get(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    // Recurring rules become real expenses on read; see recurring.ts.
    materialiseDueExpenses(user.householdId);
    const filters: string[] = ['e.household_id = ?'];
    const params: unknown[] = [user.householdId];

    if (typeof req.query.month === 'string' && req.query.month) {
      const { start, end } = monthRange(req.query.month);
      filters.push('e.spent_on >= ?', 'e.spent_on < ?');
      params.push(start, end);
    }
    if (typeof req.query.categoryId === 'string' && req.query.categoryId) {
      filters.push('e.category_id = ?');
      params.push(req.query.categoryId);
    }
    if (typeof req.query.paidBy === 'string' && req.query.paidBy) {
      filters.push('e.paid_by = ?');
      params.push(req.query.paidBy);
    }

    const rows = db
      .prepare(
        `${SELECT_EXPENSE} WHERE ${filters.join(' AND ')} ORDER BY e.spent_on DESC, e.created_at DESC`,
      )
      .all(...params);
    res.json(rows);
  }),
);

/** Monthly totals: overall, per category (against budget), and per member. */
expensesRouter.get(
  '/summary',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    materialiseDueExpenses(user.householdId);
    const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : currentMonth();
    const { start, end } = monthRange(month);
    const scope = [user.householdId, start, end];

    const total = db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(*) AS count
         FROM expenses WHERE household_id = ? AND spent_on >= ? AND spent_on < ?`,
      )
      .get(...scope) as { total_cents: number; count: number };

    // Left join from categories so budgeted categories with no spend still appear.
    const byCategory = db
      .prepare(
        `SELECT c.id AS category_id, c.name, c.color, c.monthly_budget_cents,
                COALESCE(SUM(e.amount_cents), 0) AS spent_cents
         FROM categories c
         LEFT JOIN expenses e
           ON e.category_id = c.id AND e.spent_on >= ? AND e.spent_on < ?
         WHERE c.household_id = ?
         GROUP BY c.id
         ORDER BY spent_cents DESC, c.name COLLATE NOCASE`,
      )
      .all(start, end, user.householdId);

    const uncategorised = db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS spent_cents
         FROM expenses
         WHERE household_id = ? AND category_id IS NULL AND spent_on >= ? AND spent_on < ?`,
      )
      .get(...scope) as { spent_cents: number };

    const byMember = db
      .prepare(
        `SELECT u.user_id AS user_id, u.display_name AS name,
                COALESCE(SUM(e.amount_cents), 0) AS spent_cents
         FROM memberships u
         LEFT JOIN expenses e
           ON e.paid_by = u.user_id AND e.household_id = u.household_id
              AND e.spent_on >= ? AND e.spent_on < ?
         WHERE u.household_id = ?
         GROUP BY u.user_id
         ORDER BY spent_cents DESC`,
      )
      .all(start, end, user.householdId);

    // Six-month trailing trend, oldest first, for the dashboard chart.
    const trend = db
      .prepare(
        `SELECT substr(spent_on, 1, 7) AS month, SUM(amount_cents) AS total_cents
         FROM expenses
         WHERE household_id = ? AND spent_on < ?
         GROUP BY month
         ORDER BY month DESC
         LIMIT 6`,
      )
      .all(user.householdId, end) as Array<{ month: string; total_cents: number }>;

    res.json({
      month,
      total_cents: total.total_cents,
      count: total.count,
      by_category: byCategory,
      uncategorised_cents: uncategorised.spent_cents,
      by_member: byMember,
      trend: trend.reverse(),
    });
  }),
);

/**
 * Statistics over a range of months: who spent how much, on what, and the
 * cross-tab of the two. Unlike `/summary` (one month, budgets, trend) this
 * answers "how does the household divide up".
 *
 * Spending with no payer (a removed member's expenses) and with no category
 * both appear as a row with a `null` id rather than being dropped, so the
 * per-member and per-category totals always add up to the overall total.
 * They carry a `null` name too — what to call them is a display decision.
 */
expensesRouter.get(
  '/stats',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    materialiseDueExpenses(user.householdId);

    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : currentMonth();
    const from =
      typeof req.query.from === 'string' && req.query.from ? req.query.from : shiftMonth(to, -5);
    // monthRange also validates the format, throwing a 400 on anything else.
    const { start } = monthRange(from);
    const { end } = monthRange(to);
    if (from > to) throw badRequest('from must not be after to');
    const months = monthsInRange(from, to);
    if (months.length > MAX_STATS_MONTHS) {
      throw badRequest(`Range must be ${MAX_STATS_MONTHS} months or fewer`);
    }
    const scope = [user.householdId, start, end];

    const total = db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(*) AS count
         FROM expenses WHERE household_id = ? AND spent_on >= ? AND spent_on < ?`,
      )
      .get(...scope) as { total_cents: number; count: number };

    // Ordered by name, not by spend: the order decides each member's colour in
    // the UI, and changing the range must not repaint everyone.
    const members = db
      .prepare(
        `SELECT u.user_id AS user_id, u.display_name AS name,
                COALESCE(SUM(e.amount_cents), 0) AS spent_cents, COUNT(e.id) AS count
         FROM memberships u
         LEFT JOIN expenses e
           ON e.paid_by = u.user_id AND e.household_id = u.household_id
              AND e.spent_on >= ? AND e.spent_on < ?
         WHERE u.household_id = ?
         GROUP BY u.user_id
         ORDER BY u.display_name COLLATE NOCASE`,
      )
      .all(start, end, user.householdId) as Array<{
      user_id: string | null;
      name: string | null;
      spent_cents: number;
      count: number;
    }>;

    const unattributed = db
      .prepare(
        `SELECT COALESCE(SUM(e.amount_cents), 0) AS spent_cents, COUNT(*) AS count
         FROM expenses e
         WHERE e.household_id = ? AND ${PAYER_IF_STILL_HERE} IS NULL
           AND e.spent_on >= ? AND e.spent_on < ?`,
      )
      .get(...scope) as { spent_cents: number; count: number };
    if (unattributed.count > 0) {
      members.push({ user_id: null, name: null, ...unattributed });
    }

    const categories = db
      .prepare(
        `SELECT c.id AS category_id, c.name, c.color,
                COALESCE(SUM(e.amount_cents), 0) AS spent_cents, COUNT(e.id) AS count
         FROM categories c
         LEFT JOIN expenses e
           ON e.category_id = c.id AND e.household_id = c.household_id
              AND e.spent_on >= ? AND e.spent_on < ?
         WHERE c.household_id = ?
         GROUP BY c.id
         ORDER BY spent_cents DESC, c.name COLLATE NOCASE`,
      )
      .all(start, end, user.householdId) as Array<{
      category_id: string | null;
      name: string | null;
      color: string | null;
      spent_cents: number;
      count: number;
    }>;

    const uncategorised = db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS spent_cents, COUNT(*) AS count
         FROM expenses
         WHERE household_id = ? AND category_id IS NULL AND spent_on >= ? AND spent_on < ?`,
      )
      .get(...scope) as { spent_cents: number; count: number };
    if (uncategorised.count > 0) {
      categories.push({ category_id: null, name: null, color: null, ...uncategorised });
    }

    // One cell per member/category pair that has any spending; the UI fills the
    // rest of the grid with zeroes rather than the server sending them.
    const matrix = db
      .prepare(
        `SELECT ${PAYER_IF_STILL_HERE} AS user_id, e.category_id,
                SUM(e.amount_cents) AS spent_cents, COUNT(*) AS count
         FROM expenses e
         WHERE e.household_id = ? AND e.spent_on >= ? AND e.spent_on < ?
         GROUP BY ${PAYER_IF_STILL_HERE}, e.category_id`,
      )
      .all(...scope);

    const monthlyRows = db
      .prepare(
        `SELECT substr(e.spent_on, 1, 7) AS month, ${PAYER_IF_STILL_HERE} AS user_id,
                SUM(e.amount_cents) AS spent_cents
         FROM expenses e
         WHERE e.household_id = ? AND e.spent_on >= ? AND e.spent_on < ?
         GROUP BY month, ${PAYER_IF_STILL_HERE}`,
      )
      .all(...scope) as Array<{ month: string; user_id: string | null; spent_cents: number }>;

    // The same months split the other way, so a category can be followed
    // through the range without asking the server again.
    const monthlyByCategory = db
      .prepare(
        `SELECT substr(spent_on, 1, 7) AS month, category_id,
                SUM(amount_cents) AS spent_cents
         FROM expenses
         WHERE household_id = ? AND spent_on >= ? AND spent_on < ?
         GROUP BY month, category_id`,
      )
      .all(...scope) as Array<{ month: string; category_id: string | null; spent_cents: number }>;

    // Months with no spending still get an entry, so the chart has no gaps.
    const monthly = months.map((month) => {
      const rows = monthlyRows.filter((row) => row.month === month);
      return {
        month,
        total_cents: rows.reduce((sum, row) => sum + row.spent_cents, 0),
        by_member: rows.map(({ user_id, spent_cents }) => ({ user_id, spent_cents })),
        by_category: monthlyByCategory
          .filter((row) => row.month === month)
          .map(({ category_id, spent_cents }) => ({ category_id, spent_cents })),
      };
    });

    res.json({
      from,
      to,
      months: months.length,
      total_cents: total.total_cents,
      count: total.count,
      members,
      categories,
      matrix,
      monthly,
    });
  }),
);

expensesRouter.post(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(expenseSchema, req.body);
    assertOwned('categories', input.categoryId, user.householdId);
    assertOwned('users', input.paidBy, user.householdId);

    const id = newId();
    db.prepare(
      `INSERT INTO expenses
         (id, household_id, category_id, paid_by, amount_cents, description, spent_on, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      user.householdId,
      input.categoryId,
      input.paidBy === undefined ? user.id : input.paidBy,
      Math.round(input.amount * 100),
      input.description,
      input.spentOn,
      user.id,
      nowIso(),
    );

    res.status(201).json(db.prepare(`${SELECT_EXPENSE} WHERE e.id = ?`).get(id));
  }),
);

expensesRouter.put(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(expenseSchema, req.body);
    assertOwned('categories', input.categoryId, user.householdId);
    assertOwned('users', input.paidBy, user.householdId);

    const result = db
      .prepare(
        `UPDATE expenses
         SET amount_cents = ?, description = ?, category_id = ?, paid_by = ?, spent_on = ?
         WHERE id = ? AND household_id = ?`,
      )
      .run(
        Math.round(input.amount * 100),
        input.description,
        input.categoryId,
        input.paidBy === undefined ? user.id : input.paidBy,
        input.spentOn,
        req.params.id,
        user.householdId,
      );
    if (result.changes === 0) throw notFound('That expense does not exist');

    res.json(db.prepare(`${SELECT_EXPENSE} WHERE e.id = ?`).get(req.params.id));
  }),
);

expensesRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const result = db
      .prepare('DELETE FROM expenses WHERE id = ? AND household_id = ?')
      .run(req.params.id, user.householdId);
    if (result.changes === 0) throw notFound('That expense does not exist');
    res.status(204).end();
  }),
);
