import { Router } from 'express';
import { z } from 'zod';
import { currentUser, newId, nowIso, requireAuth, requireHousehold } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, conflict, notFound, parseBody } from '../http.js';
import type { CategoryRow } from '../types.js';

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth, requireHousehold);

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(60),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #16a34a')
    .default('#64748b'),
  // Monthly spending limit in major currency units; null means "no budget set".
  monthlyBudget: z.number().nonnegative().nullable().default(null),
});

const toCents = (amount: number | null) => (amount === null ? null : Math.round(amount * 100));

const isUniqueViolation = (err: unknown) =>
  err instanceof Error && err.message.includes('UNIQUE constraint failed');

categoriesRouter.get(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const rows = db
      .prepare(
        'SELECT * FROM categories WHERE household_id = ? ORDER BY name COLLATE NOCASE',
      )
      .all(user.householdId) as CategoryRow[];
    res.json(rows);
  }),
);

categoriesRouter.post(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(categorySchema, req.body);
    const id = newId();
    try {
      db.prepare(
        `INSERT INTO categories (id, household_id, name, color, monthly_budget_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, user.householdId, input.name, input.color, toCents(input.monthlyBudget), nowIso());
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A category with that name already exists', 'error.categoryNameTaken');
      throw err;
    }
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
  }),
);

categoriesRouter.put(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(categorySchema, req.body);
    try {
      const result = db
        .prepare(
          `UPDATE categories SET name = ?, color = ?, monthly_budget_cents = ?
           WHERE id = ? AND household_id = ?`,
        )
        .run(input.name, input.color, toCents(input.monthlyBudget), req.params.id, user.householdId);
      if (result.changes === 0) throw notFound('That category does not exist', 'error.categoryNotFound');
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A category with that name already exists', 'error.categoryNameTaken');
      throw err;
    }
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
  }),
);

/** Deleting a category keeps its expenses; they fall back to "Uncategorised". */
categoriesRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const result = db
      .prepare('DELETE FROM categories WHERE id = ? AND household_id = ?')
      .run(req.params.id, user.householdId);
    if (result.changes === 0) throw notFound('That category does not exist', 'error.categoryNotFound');
    res.status(204).end();
  }),
);
