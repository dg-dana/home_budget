import { Router } from 'express';
import { z } from 'zod';
import { currentUser, newId, nowIso, requireAuth, requireHousehold } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, notFound, parseBody } from '../http.js';

export const todosRouter = Router();

todosRouter.use(requireAuth, requireHousehold);

const newTodoSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
});

const updateTodoSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  isDone: z.boolean().optional(),
});

/**
 * A name is read through `memberships`, so somebody who has left the household
 * reads as nobody rather than as a name from a household they are no longer in
 * — the same rule the expense breakdowns follow (`PAYER_IF_STILL_HERE` in
 * `routes/expenses.ts`). The row itself survives; the credit for it does not
 * follow them out.
 */
const SELECT_TODO = `
  SELECT t.id, t.title, t.is_done, t.created_by, t.done_by, t.done_at,
         t.created_at, t.updated_at,
         added.display_name AS added_by_name,
         finished.display_name AS done_by_name
  FROM todos t
  LEFT JOIN memberships added
    ON added.user_id = t.created_by AND added.household_id = t.household_id
  LEFT JOIN memberships finished
    ON finished.user_id = t.done_by AND finished.household_id = t.household_id
`;

/** Outstanding jobs first, then oldest-first inside each group. */
const ORDER_BY = 'ORDER BY t.is_done ASC, t.created_at ASC';

/** Reads one row back, scoped to the household, so an id cannot cross over. */
function ownedTodo(id: string, householdId: string) {
  const row = db
    .prepare(`${SELECT_TODO} WHERE t.id = ? AND t.household_id = ?`)
    .get(id, householdId);
  if (!row) throw notFound('That to-do does not exist', 'error.todoNotFound');
  return row;
}

todosRouter.get(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    res.json(
      db.prepare(`${SELECT_TODO} WHERE t.household_id = ? ${ORDER_BY}`).all(user.householdId),
    );
  }),
);

todosRouter.post(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(newTodoSchema, req.body);
    const id = newId();
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO todos (id, household_id, title, is_done, created_by, done_by, done_at, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, NULL, NULL, ?, ?)`,
    ).run(id, user.householdId, input.title, user.id, timestamp, timestamp);
    res.status(201).json(ownedTodo(id, user.householdId));
  }),
);

todosRouter.patch(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(updateTodoSchema, req.body);
    const existing = db
      .prepare('SELECT * FROM todos WHERE id = ? AND household_id = ?')
      .get(req.params.id, user.householdId) as
      | { title: string; is_done: number; done_by: string | null; done_at: string | null }
      | undefined;
    if (!existing) throw notFound('That to-do does not exist', 'error.todoNotFound');

    const isDone = input.isDone ?? existing.is_done === 1;
    // Whoever ticks it off gets the credit, and un-ticking clears it — the same
    // bookkeeping a shopping item does with `checked_by_name`. Re-saving a job
    // that is already done must not hand the credit to whoever edited the text.
    const wasDone = existing.is_done === 1;
    const doneBy = isDone ? (wasDone ? existing.done_by : user.id) : null;
    const doneAt = isDone ? (wasDone ? existing.done_at : nowIso()) : null;

    db.prepare(
      `UPDATE todos SET title = ?, is_done = ?, done_by = ?, done_at = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
    ).run(
      input.title ?? existing.title,
      isDone ? 1 : 0,
      doneBy,
      doneAt,
      nowIso(),
      req.params.id,
      user.householdId,
    );

    res.json(ownedTodo(req.params.id, user.householdId));
  }),
);

todosRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const result = db
      .prepare('DELETE FROM todos WHERE id = ? AND household_id = ?')
      .run(req.params.id, user.householdId);
    if (result.changes === 0) throw notFound('That to-do does not exist', 'error.todoNotFound');
    res.status(204).end();
  }),
);

/**
 * Clears everything already finished, leaving the outstanding jobs — the same
 * gesture as "clear bought" on a shopping list. Registered after `/:id` would
 * be fine either way (the verbs differ), but it is kept explicit here.
 */
todosRouter.post(
  '/clear-done',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const removed = db
      .prepare('DELETE FROM todos WHERE household_id = ? AND is_done = 1')
      .run(user.householdId).changes;
    res.json({ removed });
  }),
);
