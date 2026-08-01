import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  type Household,
} from './helpers.js';

/**
 * The comment on a shopping item — "the seeded one, not the white". It rides
 * on the same `note` field for a member and for a guest, through the shared
 * service in `shoppingItems.ts`, so the two paths cannot answer differently.
 */
describe('item comments', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  let listId: string;

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold();
    listId = (await owner.client.post('/api/lists', { name: 'Supermarket' })).body.id;
  });

  const addItem = async (body: Record<string, unknown>) =>
    (await owner.client.post(`/api/lists/${listId}/items`, body)).body;

  it('stores a comment given when the item is added', async () => {
    const item = await addItem({ name: 'Bread', note: 'The seeded one, not the white' });
    expect(item.note).toBe('The seeded one, not the white');

    const items = (await owner.client.get(`/api/lists/${listId}`)).body.items;
    expect(items[0].note).toBe('The seeded one, not the white');
  });

  it('edits a comment without disturbing the rest of the item', async () => {
    const item = await addItem({ name: 'Bread', quantity: '2', note: 'First thought' });
    await owner.client.patch(`/api/lists/${listId}/items/${item.id}`, { isChecked: true });

    const edited = await owner.client.patch(`/api/lists/${listId}/items/${item.id}`, {
      note: 'Actually get four',
    });
    expect(edited.body.note).toBe('Actually get four');
    expect(edited.body.quantity).toBe('2');
    expect(edited.body.is_checked).toBe(1);
  });

  it('clears a comment when it is set to nothing', async () => {
    const item = await addItem({ name: 'Bread', note: 'Never mind' });
    const cleared = await owner.client.patch(`/api/lists/${listId}/items/${item.id}`, { note: '' });
    expect(cleared.body.note).toBe('');
  });

  it('refuses a comment longer than the column is meant to hold', async () => {
    const response = await owner.client.post(`/api/lists/${listId}/items`, {
      name: 'Bread',
      note: 'x'.repeat(501),
    });
    expect(response.status).toBe(400);
  });
});
