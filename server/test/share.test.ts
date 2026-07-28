import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createClient,
  createSharedList,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  type Client,
  type Household,
} from './helpers.js';

/**
 * Guest access: someone with the link and no account. These tests pin down
 * both halves of the promise — that a guest CAN use the list, and that the
 * link exposes nothing else about the household.
 */
describe('guest access via a share link', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  let guest: Client;

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold({ householdName: 'The Sharing Family' });
    guest = createClient();
  });

  it('lets a guest read the list with no cookie at all', async () => {
    const { listId, token } = await createSharedList(owner);
    await owner.client.post(`/api/lists/${listId}/items`, { name: 'Milk', quantity: '2 L' });

    const view = await guest.get(`/api/share/${token}`);
    expect(view.status).toBe(200);
    expect(guest.cookies()).toBe('');
    expect(view.body.name).toBe('Groceries');
    expect(view.body.canEdit).toBe(true);
    expect(view.body.items).toHaveLength(1);
    expect(view.body.items[0].name).toBe('Milk');
  });

  it('exposes only the list, never the surrounding household', async () => {
    const { token } = await createSharedList(owner);
    const view = await guest.get(`/api/share/${token}`);

    // Whitelist the shape rather than blacklisting known-bad keys, so a field
    // added to the response later has to be considered deliberately.
    expect(Object.keys(view.body).sort()).toEqual(['canEdit', 'items', 'name']);

    const serialised = JSON.stringify(view.body);
    expect(serialised).not.toContain(owner.householdId);
    expect(serialised).not.toContain(owner.userId);
    expect(serialised).not.toContain(owner.email);
    expect(serialised).not.toContain('The Sharing Family');
  });

  it('records the guest name against items they add and tick off', async () => {
    const { listId, token } = await createSharedList(owner);
    await owner.client.post(`/api/lists/${listId}/items`, { name: 'Milk' });

    const added = await guest.post(`/api/share/${token}/items`, {
      name: 'Bread',
      guestName: 'Ruti next door',
    });
    expect(added.status).toBe(201);
    expect(added.body.added_by_name).toBe('Ruti next door');

    const milk = (await guest.get(`/api/share/${token}`)).body.items.find(
      (item: any) => item.name === 'Milk',
    );
    const ticked = await guest.patch(`/api/share/${token}/items/${milk.id}`, {
      isChecked: true,
      guestName: 'Ruti next door',
    });
    expect(ticked.body.is_checked).toBe(1);
    expect(ticked.body.checked_by_name).toBe('Ruti next door');
    // The original author is preserved — ticking is not authorship.
    expect(ticked.body.added_by_name).toBe('Owner');
  });

  it('clears the credit when an item is un-ticked', async () => {
    const { listId, token } = await createSharedList(owner);
    const item = await owner.client.post(`/api/lists/${listId}/items`, { name: 'Eggs' });

    await guest.patch(`/api/share/${token}/items/${item.body.id}`, {
      isChecked: true,
      guestName: 'Ruti',
    });
    const unticked = await guest.patch(`/api/share/${token}/items/${item.body.id}`, {
      isChecked: false,
      guestName: 'Ruti',
    });
    expect(unticked.body.is_checked).toBe(0);
    expect(unticked.body.checked_by_name).toBeNull();
  });

  it('falls back to a default label when a guest sends no name', async () => {
    const { token } = await createSharedList(owner);
    const added = await guest.post(`/api/share/${token}/items`, { name: 'Anonymous item' });
    expect(added.body.added_by_name).toBe('Guest');
  });

  it('blocks every mutation on a view-only link but still allows reading', async () => {
    const { listId, token } = await createSharedList(owner, { canEdit: false });
    const item = await owner.client.post(`/api/lists/${listId}/items`, { name: 'Rice' });

    const view = await guest.get(`/api/share/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.canEdit).toBe(false);

    for (const attempt of [
      guest.post(`/api/share/${token}/items`, { name: 'Sneaky' }),
      guest.patch(`/api/share/${token}/items/${item.body.id}`, { isChecked: true }),
      guest.delete(`/api/share/${token}/items/${item.body.id}`),
      guest.post(`/api/share/${token}/clear-checked`),
    ]) {
      const response = await attempt;
      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/view-only/i);
    }

    const unchanged = await guest.get(`/api/share/${token}`);
    expect(unchanged.body.items).toHaveLength(1);
    expect(unchanged.body.items[0].is_checked).toBe(0);
  });

  it('kills the link the moment sharing is revoked', async () => {
    const { listId, token } = await createSharedList(owner);
    expect((await guest.get(`/api/share/${token}`)).status).toBe(200);

    await owner.client.delete(`/api/lists/${listId}/share`);

    expect((await guest.get(`/api/share/${token}`)).status).toBe(404);
    expect((await guest.post(`/api/share/${token}/items`, { name: 'Too late' })).status).toBe(404);
  });

  it('keeps the same token when sharing is toggled, so old links survive', async () => {
    const { listId, token } = await createSharedList(owner);
    const again = await owner.client.post(`/api/lists/${listId}/share`, { canEdit: false });
    expect(again.body.shareToken).toBe(token);
    expect(again.body.shareCanEdit).toBe(false);

    const reopened = await owner.client.post(`/api/lists/${listId}/share`, { canEdit: true });
    expect(reopened.body.shareToken).toBe(token);
    expect((await guest.get(`/api/share/${token}`)).body.canEdit).toBe(true);
  });

  it('issues a fresh token after a revoke, and the old one stays dead', async () => {
    const { listId, token } = await createSharedList(owner);
    await owner.client.delete(`/api/lists/${listId}/share`);
    const reshared = await owner.client.post(`/api/lists/${listId}/share`, { canEdit: true });

    expect(reshared.body.shareToken).not.toBe(token);
    expect((await guest.get(`/api/share/${token}`)).status).toBe(404);
    expect((await guest.get(`/api/share/${reshared.body.shareToken}`)).status).toBe(200);
  });

  it('rejects an unknown or empty token', async () => {
    expect((await guest.get('/api/share/definitely-not-a-real-token')).status).toBe(404);
  });

  it('gives a guest no way into the authenticated API', async () => {
    await createSharedList(owner);
    for (const path of [
      '/api/auth/me',
      '/api/expenses',
      '/api/expenses/summary',
      '/api/categories',
      '/api/lists',
      '/api/household',
      '/api/household/members',
      '/api/household/invites',
    ]) {
      const response = await guest.get(path);
      expect(response.status, `${path} should reject a guest`).toBe(401);
    }
  });

  it('lets a guest clear bought items without disturbing the rest', async () => {
    const { listId, token } = await createSharedList(owner);
    const bought = await owner.client.post(`/api/lists/${listId}/items`, { name: 'Bought' });
    await owner.client.post(`/api/lists/${listId}/items`, { name: 'Outstanding' });
    await guest.patch(`/api/share/${token}/items/${bought.body.id}`, {
      isChecked: true,
      guestName: 'Ruti',
    });

    const cleared = await guest.post(`/api/share/${token}/clear-checked`);
    expect(cleared.body.removed).toBe(1);

    const remaining = (await guest.get(`/api/share/${token}`)).body.items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('Outstanding');
  });

  it('shows members and guests the same list state', async () => {
    const { listId, token } = await createSharedList(owner);
    await guest.post(`/api/share/${token}/items`, { name: 'Bread', guestName: 'Ruti' });

    const ownerView = await owner.client.get(`/api/lists/${listId}`);
    expect(ownerView.body.items).toHaveLength(1);
    expect(ownerView.body.items[0].name).toBe('Bread');
    expect(ownerView.body.items[0].added_by_name).toBe('Ruti');
  });
});
