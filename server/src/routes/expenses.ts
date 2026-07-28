import { Router } from 'express';
import { z } from 'zod';
import { currentUser, newId, nowIso, requireAuth } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, notFound, parseBody } from '../http.js';
import { materialiseDueExpenses } from '../recurring.js';

export const expensesRouter = Router();

expensesRouter.use(requireAuth);

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * Verifies a category / member id belongs to this household before it is
 * stored, so ids cannot be used to point at another household's rows.
 */
function assertOwned(
  table: 'categories' | 'users',
  id: string | null | undefined,
  householdId: string,
) {
  if (id === null || id === undefined) return;
  const row = db
    .prepare(`SELECT id FROM ${table} WHERE id = ? AND household_id = ?`)
    .get(id, householdId);
  if (!row) {
    throw badRequest(table === 'categories' ? 'Unknown category' : 'Unknown household member');
  }
}

const SELECT_EXPENSE = `
  SELECT e.id, e.amount_cents, e.description, e.spent_on, e.category_id, e.paid_by,
         e.recurring_id, e.created_at,
         c.name AS category_name, c.color AS category_color,
         u.name AS paid_by_name
  FROM expenses e
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN users u ON u.id = e.paid_by
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
        `SELECT u.id AS user_id, u.name, COALESCE(SUM(e.amount_cents), 0) AS spent_cents
         FROM users u
         LEFT JOIN expenses e
           ON e.paid_by = u.id AND e.spent_on >= ? AND e.spent_on < ?
         WHERE u.household_id = ?
         GROUP BY u.id
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
