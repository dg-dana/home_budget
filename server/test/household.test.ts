import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createClient,
  createSharedList,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  uniqueEmail,
  type Client,
  type Household,
} from './helpers.js';

describe('owner-only permissions', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  let member: { client: Client; userId: string; email: string };

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold({ householdName: 'The Cohens' });
    member = await addMember(owner, 'Yossi');
  });

  it('stops a member changing household settings', async () => {
    const response = await member.client.put('/api/household', { name: 'Renamed', currency: 'EUR' });
    expect(response.status).toBe(403);
    expect((await owner.client.get('/api/household')).body.name).toBe('The Cohens');
  });

  it('stops a member creating, listing or revoking invites', async () => {
    expect((await member.client.get('/api/household/invites')).status).toBe(403);
    expect((await member.client.post('/api/household/invites', { role: 'member' })).status).toBe(403);
    expect((await member.client.delete('/api/household/invites/whatever')).status).toBe(403);
  });

  it('stops a member removing anyone', async () => {
    const response = await member.client.delete(`/api/household/members/${owner.userId}`);
    expect(response.status).toBe(403);
    expect((await owner.client.get('/api/auth/me')).status).toBe(200);
  });

  it('lets the owner rename the household and change currency', async () => {
    const response = await owner.client.put('/api/household', { name: 'The Levys', currency: 'ils' });
    expect(response.status).toBe(200);
    expect(response.body.currency).toBe('ILS');

    // The change is visible to members too.
    expect((await member.client.get('/api/auth/me')).body.household.name).toBe('The Levys');
  });

  it('stops the owner removing themselves', async () => {
    const response = await owner.client.delete(`/api/household/members/${owner.userId}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/cannot remove yourself/i);
  });

  it('ends a removed member session immediately', async () => {
    expect((await member.client.get('/api/auth/me')).status).toBe(200);
    expect((await owner.client.delete(`/api/household/members/${member.userId}`)).status).toBe(204);
    // The cookie is still in the jar and unexpired, but the user is gone.
    expect((await member.client.get('/api/auth/me')).status).toBe(401);
    expect((await member.client.get('/api/expenses')).status).toBe(401);
  });

  it('lists members with the owner first', async () => {
    const members = await owner.client.get('/api/household/members');
    expect(members.body).toHaveLength(2);
    expect(members.body[0].role).toBe('owner');
    // Password hashes must never be serialised.
    expect(JSON.stringify(members.body)).not.toContain('password');
  });
});

describe('member permissions', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  let member: { client: Client; userId: string; email: string };

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold();
    member = await addMember(owner, 'Yossi');
  });

  it('lets a member do the everyday things', async () => {
    expect((await member.client.post('/api/expenses', { amount: 5, spentOn: '2026-04-10' })).status).toBe(201);
    expect((await member.client.post('/api/categories', { name: 'Pets' })).status).toBe(201);
    expect((await member.client.post('/api/lists', { name: 'Hardware' })).status).toBe(201);
    expect((await member.client.get('/api/household/members')).status).toBe(200);
    expect((await member.client.get('/api/household')).status).toBe(200);
  });

  it('lets a member share a list created by the owner', async () => {
    const list = await owner.client.post('/api/lists', { name: 'Shared' });
    const shared = await member.client.post(`/api/lists/${list.body.id}/share`, { canEdit: true });
    expect(shared.status).toBe(200);
    expect(shared.body.shareToken).toBeTruthy();

    const guest = createClient();
    expect((await guest.get(`/api/share/${shared.body.shareToken}`)).status).toBe(200);
  });

});

/**
 * The two irreversible ones. Both are confirmed with the caller's own password
 * — a cookie proves a browser signed in once, not who is holding it now.
 */
describe('deleting a household', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  let member: { client: Client; userId: string; email: string };

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold({ householdName: 'The Cohens' });
    member = await addMember(owner, 'Yossi');
  });

  it('cascades everything away, including the other accounts', async () => {
    const list = await owner.client.post('/api/lists', { name: 'Doomed' });
    await owner.client.post(`/api/lists/${list.body.id}/items`, { name: 'Milk' });
    await owner.client.post(`/api/lists/${list.body.id}/share`, { canEdit: true });
    await owner.client.post('/api/expenses', { amount: 5, spentOn: '2026-04-10' });
    await owner.client.post('/api/recurring', {
      amount: 900,
      frequency: 'monthly',
      startsOn: '2026-04-01',
    });
    await owner.client.post('/api/household/invites', { role: 'member' });

    expect((await owner.client.delete('/api/household', { password: 'password123' })).status).toBe(204);

    const { db } = await import('../src/db.js');
    for (const table of [
      'households',
      'users',
      'expenses',
      'recurring_expenses',
      'categories',
      'shopping_lists',
      'shopping_items',
      'invites',
    ]) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      expect(row.count, `${table} should be empty after the household is deleted`).toBe(0);
    }

    // Everybody's session dies with the rows, the owner's included.
    expect((await owner.client.get('/api/auth/me')).status).toBe(401);
    expect((await member.client.get('/api/auth/me')).status).toBe(401);
  });

  it('kills the share links along with the lists', async () => {
    const { token } = await createSharedList(owner);
    const guest = createClient();
    expect((await guest.get(`/api/share/${token}`)).status).toBe(200);

    await owner.client.delete('/api/household', { password: 'password123' });
    expect((await guest.get(`/api/share/${token}`)).status).toBe(404);
  });

  it('refuses without the right password, and changes nothing', async () => {
    expect((await owner.client.delete('/api/household', { password: 'wrong-password' })).status).toBe(400);
    expect((await owner.client.delete('/api/household')).status).toBe(400);

    expect((await owner.client.get('/api/household')).body.name).toBe('The Cohens');
    expect((await member.client.get('/api/auth/me')).status).toBe(200);
  });

  it('refuses a member, even with their own password', async () => {
    const response = await member.client.delete('/api/household', { password: 'password123' });
    expect(response.status).toBe(403);
    expect((await owner.client.get('/api/household')).status).toBe(200);
  });
});

describe('deleting your own account', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  let member: { client: Client; userId: string; email: string };

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold({ householdName: 'The Cohens' });
    member = await addMember(owner, 'Yossi');
  });

  it('lets a member go, and leaves the money behind', async () => {
    await member.client.post('/api/expenses', {
      amount: 40,
      description: 'Yossi shop',
      spentOn: '2026-04-10',
    });

    expect((await member.client.delete('/api/auth/account', { password: 'password123' })).status).toBe(204);
    expect((await member.client.get('/api/auth/me')).status).toBe(401);
    expect((await owner.client.get('/api/household/members')).body).toHaveLength(1);

    // History survives the person: the expense is still there, with no payer.
    const expenses = (await owner.client.get('/api/expenses?month=2026-04')).body;
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount_cents).toBe(4000);
    expect(expenses[0].paid_by).toBeNull();
    expect(expenses[0].paid_by_name).toBeNull();
  });

  it('frees the email address for a fresh account', async () => {
    await member.client.delete('/api/auth/account', { password: 'password123' });
    const again = await addMember(owner, 'Yossi');
    expect((await again.client.get('/api/auth/me')).status).toBe(200);
  });

  it('refuses without the right password', async () => {
    expect((await member.client.delete('/api/auth/account', { password: 'nope' })).status).toBe(400);
    expect((await member.client.delete('/api/auth/account')).status).toBe(400);
    expect((await member.client.get('/api/auth/me')).status).toBe(200);
  });

  it('refuses the only owner while anyone else is still here', async () => {
    const response = await owner.client.delete('/api/auth/account', { password: 'password123' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/only owner/i);
    expect((await owner.client.get('/api/auth/me')).status).toBe(200);
    expect((await member.client.get('/api/auth/me')).status).toBe(200);
  });

  it('lets the last owner out, taking the household with them', async () => {
    await owner.client.post('/api/expenses', { amount: 5, spentOn: '2026-04-10' });
    expect((await owner.client.delete(`/api/household/members/${member.userId}`)).status).toBe(204);

    expect((await owner.client.delete('/api/auth/account', { password: 'password123' })).status).toBe(204);
    expect((await owner.client.get('/api/auth/me')).status).toBe(401);

    const { db } = await import('../src/db.js');
    for (const table of ['households', 'users', 'expenses', 'categories']) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      expect(row.count, `${table} should be empty once the last owner leaves`).toBe(0);
    }
  });

  it('lets an owner leave once someone else owns the place', async () => {
    // Ownership is handed over with an invite carrying the owner role.
    const invite = await owner.client.post('/api/household/invites', { role: 'owner' });
    const heir = createClient();
    await heir.post('/api/auth/join', {
      token: invite.body.token,
      name: 'Heir',
      email: uniqueEmail('heir'),
      password: 'password123',
    });

    expect((await owner.client.delete('/api/auth/account', { password: 'password123' })).status).toBe(204);
    expect((await heir.get('/api/household')).body.name).toBe('The Cohens');
    expect((await heir.get('/api/household/members')).body).toHaveLength(2);
  });
});

describe('shopping lists', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold();
  });

  it('counts outstanding items per list', async () => {
    const list = await owner.client.post('/api/lists', { name: 'Supermarket' });
    const milk = await owner.client.post(`/api/lists/${list.body.id}/items`, { name: 'Milk' });
    await owner.client.post(`/api/lists/${list.body.id}/items`, { name: 'Bread' });
    await owner.client.patch(`/api/lists/${list.body.id}/items/${milk.body.id}`, { isChecked: true });

    const lists = await owner.client.get('/api/lists');
    expect(lists.body[0].itemCount).toBe(2);
    expect(lists.body[0].openCount).toBe(1);
  });

  it('sorts outstanding items above bought ones', async () => {
    const list = await owner.client.post('/api/lists', { name: 'Supermarket' });
    const first = await owner.client.post(`/api/lists/${list.body.id}/items`, { name: 'First' });
    await owner.client.post(`/api/lists/${list.body.id}/items`, { name: 'Second' });
    await owner.client.patch(`/api/lists/${list.body.id}/items/${first.body.id}`, { isChecked: true });

    const items = (await owner.client.get(`/api/lists/${list.body.id}`)).body.items;
    expect(items.map((item: any) => item.name)).toEqual(['Second', 'First']);
  });

  it('deletes a list and its items together', async () => {
    const list = await owner.client.post('/api/lists', { name: 'Temporary' });
    await owner.client.post(`/api/lists/${list.body.id}/items`, { name: 'Milk' });

    expect((await owner.client.delete(`/api/lists/${list.body.id}`)).status).toBe(204);
    expect((await owner.client.get(`/api/lists/${list.body.id}`)).status).toBe(404);

    const { db } = await import('../src/db.js');
    const row = db.prepare('SELECT COUNT(*) AS count FROM shopping_items').get() as { count: number };
    expect(row.count).toBe(0);
  });

  it('rejects an empty item name', async () => {
    const list = await owner.client.post('/api/lists', { name: 'Supermarket' });
    expect((await owner.client.post(`/api/lists/${list.body.id}/items`, { name: '   ' })).status).toBe(400);
  });

  it('starts a new list unshared', async () => {
    const list = await owner.client.post('/api/lists', { name: 'Private' });
    expect(list.body.shareToken).toBeNull();
  });
});
