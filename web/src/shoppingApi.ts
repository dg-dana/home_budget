import { api, type ShoppingItem } from './api';

/**
 * Everything the two shopping pages do to an item, behind one interface.
 *
 * The member page and the guest page talk to different routes — `/lists/:id`
 * against a session, `/share/:token` against nothing at all — but they offer
 * the same actions, and the components below them take this object rather than
 * a URL. It is the frontend's half of `server/src/shoppingItems.ts`: one
 * implementation of the behaviour, two ways in, so the two cannot drift.
 */
export interface NewItem {
  name: string;
  quantity: string;
  note: string;
}

export interface ItemApi {
  add(input: NewItem): Promise<void>;
  toggle(item: ShoppingItem): Promise<void>;
  setNote(item: ShoppingItem, note: string): Promise<void>;
  remove(item: ShoppingItem): Promise<void>;
}

export function memberItemApi(listId: string): ItemApi {
  const items = `/lists/${listId}/items`;

  return {
    add: (input) => api.post(items, input).then(() => undefined),
    toggle: (item) => api.patch(`${items}/${item.id}`, { isChecked: item.is_checked === 0 }),
    setNote: (item, note) => api.patch(`${items}/${item.id}`, { note }),
    remove: (item) => api.delete(`${items}/${item.id}`),
  };
}

/**
 * The guest's name is a label, never an identity (see ARCHITECTURE §6). It
 * rides along with every write so the household can see who put what on the
 * list.
 */
export function guestItemApi(token: string, guestName: string): ItemApi {
  const items = `/share/${encodeURIComponent(token)}/items`;

  return {
    add: (input) => api.post(items, { ...input, guestName }).then(() => undefined),
    toggle: (item) =>
      api.patch(`${items}/${item.id}`, { isChecked: item.is_checked === 0, guestName }),
    setNote: (item, note) => api.patch(`${items}/${item.id}`, { note, guestName }),
    remove: (item) => api.delete(`${items}/${item.id}`),
  };
}
