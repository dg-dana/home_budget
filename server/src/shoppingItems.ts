import { z } from 'zod';
import { newId, nowIso } from './auth.js';
import { db } from './db.js';
import { notFound } from './http.js';
import type { ShoppingItemRow, ShoppingListRow } from './types.js';

/** Comments run longer than a quantity — a sentence about which brand to buy. */
const NOTE_MAX = 500;

export const newItemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(120),
  quantity: z.string().trim().max(40).default(''),
  note: z.string().trim().max(NOTE_MAX).default(''),
});

export const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  quantity: z.string().trim().max(40).optional(),
  note: z.string().trim().max(NOTE_MAX).optional(),
  isChecked: z.boolean().optional(),
});

export type NewItemInput = z.infer<typeof newItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

/** Unchecked items first, then oldest-first within each group. */
const ORDER_BY = 'ORDER BY is_checked ASC, created_at ASC';

export const getItems = (listId: string) =>
  db
    .prepare(`SELECT * FROM shopping_items WHERE list_id = ? ${ORDER_BY}`)
    .all(listId) as ShoppingItemRow[];

export function getItem(listId: string, itemId: string): ShoppingItemRow {
  const row = db
    .prepare('SELECT * FROM shopping_items WHERE id = ? AND list_id = ?')
    .get(itemId, listId) as ShoppingItemRow | undefined;
  if (!row) throw notFound('That item does not exist');
  return row;
}

/** `actorName` is the household member's name, or the name a guest typed in. */
export function addItem(listId: string, input: NewItemInput, actorName: string): ShoppingItemRow {
  const id = newId();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO shopping_items
       (id, list_id, name, quantity, note, is_checked, added_by_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, listId, input.name, input.quantity, input.note, actorName, timestamp, timestamp);
  return getItem(listId, id);
}

export function updateItem(
  listId: string,
  itemId: string,
  input: UpdateItemInput,
  actorName: string,
): ShoppingItemRow {
  const existing = getItem(listId, itemId);
  const isChecked = input.isChecked ?? existing.is_checked === 1;
  // Record who ticked it off; clear that credit when an item is un-ticked.
  const checkedBy = isChecked ? (existing.is_checked === 1 ? existing.checked_by_name : actorName) : null;

  db.prepare(
    `UPDATE shopping_items
     SET name = ?, quantity = ?, note = ?, is_checked = ?, checked_by_name = ?, updated_at = ?
     WHERE id = ? AND list_id = ?`,
  ).run(
    input.name ?? existing.name,
    input.quantity ?? existing.quantity,
    input.note ?? existing.note,
    isChecked ? 1 : 0,
    checkedBy,
    nowIso(),
    itemId,
    listId,
  );
  return getItem(listId, itemId);
}

export function deleteItem(listId: string, itemId: string) {
  const result = db
    .prepare('DELETE FROM shopping_items WHERE id = ? AND list_id = ?')
    .run(itemId, listId);
  if (result.changes === 0) throw notFound('That item does not exist');
}

/** Clears everything already in the basket, leaving the outstanding items. */
export function clearCheckedItems(listId: string): number {
  return db.prepare('DELETE FROM shopping_items WHERE list_id = ? AND is_checked = 1').run(listId)
    .changes;
}

export const serialiseList = (list: ShoppingListRow) => ({
  id: list.id,
  name: list.name,
  shareToken: list.share_token,
  shareCanEdit: list.share_can_edit === 1,
  createdAt: list.created_at,
});
