import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncHandler, forbidden, notFound, parseBody } from '../http.js';
import { rateLimit } from '../rateLimit.js';
import {
  addItem,
  clearCheckedItems,
  deleteItem,
  getItems,
  newItemSchema,
  updateItem,
  updateItemSchema,
} from '../shoppingItems.js';
import type { ShoppingListRow } from '../types.js';

/**
 * Guest access to a single shopping list. These routes are deliberately
 * unauthenticated: anyone holding the share link can use them, which is the
 * point — a neighbour or babysitter can pick things up without an account.
 * Nothing here exposes expenses, members or any other household data.
 */
export const shareRouter = Router();

shareRouter.use(
  rateLimit({ windowMs: 60_000, max: 120, message: 'Too many requests, please wait a moment' }),
);

const guestNameSchema = z.object({
  guestName: z.string().trim().min(1).max(40).default('Guest'),
});

function sharedList(token: string): ShoppingListRow {
  const row = db
    .prepare('SELECT * FROM shopping_lists WHERE share_token = ?')
    .get(token) as ShoppingListRow | undefined;
  if (!row) throw notFound('This shopping list link is no longer active');
  return row;
}

/** Mutations are only allowed while the owner leaves guest editing switched on. */
function editableList(token: string): ShoppingListRow {
  const list = sharedList(token);
  if (list.share_can_edit !== 1) {
    throw forbidden('This list is shared as view-only');
  }
  return list;
}

const guestName = (body: unknown) => parseBody(guestNameSchema, body ?? {}).guestName;

shareRouter.get(
  '/:token',
  asyncHandler((req, res) => {
    const list = sharedList(req.params.token);
    res.json({
      name: list.name,
      canEdit: list.share_can_edit === 1,
      items: getItems(list.id),
    });
  }),
);

shareRouter.post(
  '/:token/items',
  asyncHandler((req, res) => {
    const list = editableList(req.params.token);
    const input = parseBody(newItemSchema, req.body);
    res.status(201).json(addItem(list.id, input, guestName(req.body)));
  }),
);

shareRouter.patch(
  '/:token/items/:itemId',
  asyncHandler((req, res) => {
    const list = editableList(req.params.token);
    const input = parseBody(updateItemSchema, req.body);
    res.json(updateItem(list.id, req.params.itemId, input, guestName(req.body)));
  }),
);

shareRouter.delete(
  '/:token/items/:itemId',
  asyncHandler((req, res) => {
    const list = editableList(req.params.token);
    deleteItem(list.id, req.params.itemId);
    res.status(204).end();
  }),
);

shareRouter.post(
  '/:token/clear-checked',
  asyncHandler((req, res) => {
    const list = editableList(req.params.token);
    res.json({ removed: clearCheckedItems(list.id) });
  }),
);
