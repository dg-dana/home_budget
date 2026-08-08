import { Router } from 'express';
import { z } from 'zod';
import { currentUser, newId, nowIso, requireAuth, requireHousehold } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, notFound, parseBody } from '../http.js';
import { materialiseDueExpenses, occurrenceAt, previousDay, today } from '../recurring.js';
import type { RecurringExpenseRow } from '../types.js';

export const recurringRouter = Router();

recurringRouter.use(requireAuth, requireHousehold);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const date = (message: string) => z.string().regex(DATE_PATTERN, message);

const ruleSchema = z
  .object({
    amount: z.number().positive('Amount must be greater than zero').max(1_000_000_000),
    description: z.string().trim().max(200).default(''),
    categoryId: z.string().uuid().nullable().default(null),
    // Absent means "me"; an explicit null means "nobody in particular".
    paidBy: z.string().uuid().nullable().optional(),
    frequency: z.enum(['weekly', 'monthly', 'yearly']),
    startsOn: date('Start date must be in YYYY-MM-DD format'),
    endsOn: date('End date must be in YYYY-MM-DD format').nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .refine((value) => value.endsOn === null || value.endsOn >= value.startsOn, {
    message: 'End date cannot be before the start date',
    path: ['endsOn'],
  });

/** As in `expenses.ts`: a person belongs to a household through a membership. */
function assertOwned(table: 'categories' | 'users', id: string | null | undefined, householdId: string) {
  if (id === null || id === undefined) return;
  const row =
    table === 'categories'
      ? db.prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?').get(id, householdId)
      : db
          .prepare('SELECT user_id FROM memberships WHERE user_id = ? AND household_id = ?')
          .get(id, householdId);
  if (!row) {
    throw table === 'categories'
      ? badRequest('Unknown category', 'error.unknownCategory')
      : badRequest('Unknown household member', 'error.unknownMember');
  }
}

function ownedRule(id: string, householdId: string): RecurringExpenseRow {
  const row = db
    .prepare('SELECT * FROM recurring_expenses WHERE id = ? AND household_id = ?')
    .get(id, householdId) as RecurringExpenseRow | undefined;
  if (!row) throw notFound('That recurring expense does not exist', 'error.recurringNotFound');
  return row;
}

const SELECT_RULE = `
  SELECT r.*, c.name AS category_name, c.color AS category_color, m.display_name AS paid_by_name
  FROM recurring_expenses r
  LEFT JOIN categories c ON c.id = r.category_id
  LEFT JOIN memberships m ON m.user_id = r.paid_by AND m.household_id = r.household_id
`;

/** Adds the next date each rule will fire, which is what the UI actually shows. */
function withNextDate(row: any) {
  const rule = { frequency: row.frequency, startsOn: row.starts_on, endsOn: row.ends_on };
  const from = row.last_generated_on ?? null;
  let nextDue: string | null = null;

  if (row.is_active === 1) {
    for (let n = 0; n < 1000; n += 1) {
      const date = occurrenceAt(rule, n);
      if (row.ends_on && date > row.ends_on) break;
      if (from === null || date > from) {
        nextDue = date;
        break;
      }
    }
  }
  return { ...row, next_due_on: nextDue };
}

recurringRouter.get(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    // Catch up first, so `last_generated_on` and the next date are current.
    materialiseDueExpenses(user.householdId);
    const rows = db
      .prepare(`${SELECT_RULE} WHERE r.household_id = ? ORDER BY r.description COLLATE NOCASE`)
      .all(user.householdId) as any[];
    res.json(rows.map(withNextDate));
  }),
);

recurringRouter.post(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(ruleSchema, req.body);
    assertOwned('categories', input.categoryId, user.householdId);
    assertOwned('users', input.paidBy, user.householdId);

    const id = newId();
    db.prepare(
      `INSERT INTO recurring_expenses
         (id, household_id, category_id, paid_by, amount_cents, description, frequency,
          starts_on, ends_on, last_generated_on, is_active, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      id,
      user.householdId,
      input.categoryId,
      input.paidBy === undefined ? user.id : input.paidBy,
      Math.round(input.amount * 100),
      input.description,
      input.frequency,
      input.startsOn,
      input.endsOn,
      input.isActive ? 1 : 0,
      user.id,
      nowIso(),
    );

    // A rule starting today or earlier produces its due expenses immediately,
    // rather than waiting for the next visit to the expenses page.
    materialiseDueExpenses(user.householdId);

    res.status(201).json(withNextDate(db.prepare(`${SELECT_RULE} WHERE r.id = ?`).get(id)));
  }),
);

recurringRouter.put(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const existing = ownedRule(req.params.id, user.householdId);
    const input = parseBody(ruleSchema, req.body);
    assertOwned('categories', input.categoryId, user.householdId);
    assertOwned('users', input.paidBy, user.householdId);

    // Moving the start date later than what has already been generated would
    // otherwise strand `last_generated_on` and silently skip occurrences.
    const lastGenerated =
      existing.last_generated_on && input.startsOn > existing.last_generated_on
        ? null
        : existing.last_generated_on;

    db.prepare(
      `UPDATE recurring_expenses
       SET category_id = ?, paid_by = ?, amount_cents = ?, description = ?, frequency = ?,
           starts_on = ?, ends_on = ?, last_generated_on = ?, is_active = ?
       WHERE id = ? AND household_id = ?`,
    ).run(
      input.categoryId,
      input.paidBy === undefined ? existing.paid_by : input.paidBy,
      Math.round(input.amount * 100),
      input.description,
      input.frequency,
      input.startsOn,
      input.endsOn,
      lastGenerated,
      input.isActive ? 1 : 0,
      existing.id,
      user.householdId,
    );

    materialiseDueExpenses(user.householdId);
    res.json(withNextDate(db.prepare(`${SELECT_RULE} WHERE r.id = ?`).get(existing.id)));
  }),
);

/**
 * Deletes the rule. Expenses it already generated are kept — they record money
 * that really was spent — and simply lose their link back (ON DELETE SET NULL).
 */
recurringRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const rule = ownedRule(req.params.id, user.householdId);
    db.prepare('DELETE FROM recurring_expenses WHERE id = ?').run(rule.id);
    res.status(204).end();
  }),
);

/** Convenience for the pause/resume switch in the UI. */
recurringRouter.post(
  '/:id/active',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const rule = ownedRule(req.params.id, user.householdId);
    const { isActive } = parseBody(z.object({ isActive: z.boolean() }), req.body);

    // Resuming skips whatever fell due while paused, rather than dumping a pile
    // of back-dated expenses on the household. Marking everything up to
    // yesterday as generated leaves an occurrence falling today still due.
    const resuming = isActive && rule.is_active === 0;
    const cutoff = previousDay(today());
    const lastGenerated = resuming
      ? // Never move the marker backwards, in case something already generated today.
        [rule.last_generated_on, cutoff].filter((value): value is string => value !== null).sort().pop()!
      : rule.last_generated_on;

    db.prepare('UPDATE recurring_expenses SET is_active = ?, last_generated_on = ? WHERE id = ?').run(
      isActive ? 1 : 0,
      lastGenerated,
      rule.id,
    );

    if (isActive) materialiseDueExpenses(user.householdId);
    res.json(withNextDate(db.prepare(`${SELECT_RULE} WHERE r.id = ?`).get(rule.id)));
  }),
);
