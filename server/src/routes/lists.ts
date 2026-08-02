import { Router } from 'express';
import { z } from 'zod';
import { currentUser, newId, newToken, nowIso, requireAuth, requireHousehold } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, notFound, parseBody } from '../http.js';
import {
  addItem,
  clearCheckedItems,
  deleteItem,
  getItems,
  newItemSchema,
  serialiseList,
  updateItem,
  updateItemSchema,
} from '../shoppingItems.js';
import type { ShoppingListRow } from '../types.js';

export const listsRouter = Router();

listsRouter.use(requireAuth, requireHousehold);

const listSchema = z.object({
  name: z.string().trim().min(1, 'List name is required').max(80),
});

const shareSchema = z.object({
  canEdit: z.boolean().default(true),
});

/** Loads a list, scoped to the caller's household so ids cannot cross over. */
function ownedList(listId: string, householdId: string): ShoppingListRow {
  const row = db
    .prepare('SELECT * FROM shopping_lists WHERE id = ? AND household_id = ?')
    .get(listId, householdId) as ShoppingListRow | undefined;
  if (!row) throw notFound('That shopping list does not exist');
  return row;
}

listsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const rows = db
      .prepare(
        `SELECT l.*,
                COUNT(i.id) AS item_count,
                COALESCE(SUM(CASE WHEN i.is_checked = 0 THEN 1 ELSE 0 END), 0) AS open_count
         FROM shopping_lists l
         LEFT JOIN shopping_items i ON i.list_id = l.id
         WHERE l.household_id = ?
         GROUP BY l.id
         ORDER BY l.created_at DESC`,
      )
      .all(user.householdId) as Array<ShoppingListRow & { item_count: number; open_count: number }>;

    res.json(
      rows.map((row) => ({
        ...serialiseList(row),
        itemCount: row.item_count,
        openCount: row.open_count,
      })),
    );
  }),
);

listsRouter.post(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(listSchema, req.body);
    const id = newId();
    db.prepare(
      `INSERT INTO shopping_lists (id, household_id, name, share_token, share_can_edit, created_by, created_at)
       VALUES (?, ?, ?, NULL, 1, ?, ?)`,
    ).run(id, user.householdId, input.name, user.id, nowIso());

    const list = ownedList(id, user.householdId);
    res.status(201).json({ ...serialiseList(list), itemCount: 0, openCount: 0 });
  }),
);

listsRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const list = ownedList(req.params.id, user.householdId);
    res.json({ ...serialiseList(list), items: getItems(list.id) });
  }),
);

listsRouter.put(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const list = ownedList(req.params.id, user.householdId);
    const input = parseBody(listSchema, req.body);
    db.prepare('UPDATE shopping_lists SET name = ? WHERE id = ?').run(input.name, list.id);
    res.json(serialiseList(ownedList(list.id, user.householdId)));
  }),
);

listsRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const list = ownedList(req.params.id, user.householdId);
    db.prepare('DELETE FROM shopping_lists WHERE id = ?').run(list.id);
    res.status(204).end();
  }),
);

/**
 * Turns on guest access. Anyone holding the link can open the list without an
 * account; `canEdit` decides whether they may also tick items off and add to it.
 * Re-posting keeps the existing token so links already shared keep working.
 */
listsRouter.post(
  '/:id/share',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const list = ownedList(req.params.id, user.householdId);
    const input = parseBody(shareSchema, req.body);
    const token = list.share_token ?? newToken();

    db.prepare('UPDATE shopping_lists SET share_token = ?, share_can_edit = ? WHERE id = ?').run(
      token,
      input.canEdit ? 1 : 0,
      list.id,
    );
    res.json(serialiseList(ownedList(list.id, user.householdId)));
  }),
);

/** Revokes guest access. The old link stops working immediately. */
listsRouter.delete(
  '/:id/share',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const list = ownedList(req.params.id, user.householdId);
    db.prepare('UPDATE shopping_lists SET share_token = NULL WHERE id = ?').run(list.id);
    res.json(serialiseList(ownedList(list.id, user.householdId)));
  }),
);

listsRouter.post(
  '/:id/items',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const list = ownedList(req.params.id, user.householdId);
    const input = parseBody(newItemSchema, req.body);
    res.status(201).json(addItem(list.id, input, user.name));
  }),
);

listsRouter.patch(
  '/:id/items/:itemId',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const list = ownedList(req.params.id, user.householdId);
    const input = parseBody(updateItemSchema, req.body);
    res.json(updateItem(list.id, req.params.itemId, input, user.name));
  }),
);

listsRouter.delete(
  '/:id/items/:itemId',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const list = ownedList(req.params.id, user.householdId);
    deleteItem(list.id, req.params.itemId);
    res.status(204).end();
  }),
);

listsRouter.post(
  '/:id/items/clear-checked',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const list = ownedList(req.params.id, user.householdId);
    res.json({ removed: clearCheckedItems(list.id) });
  }),
);
