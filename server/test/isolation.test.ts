import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  joinHousehold,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  type Household,
} from './helpers.js';

/**
 * The load-bearing invariant: every household-scoped query filters on the
 * caller's household_id, so an id belonging to someone else must behave as if
 * it does not exist. If any of these ever fail, the app is leaking data
 * between families.
 */
describe('cross-household isolation', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let alice: Household;
  let bob: Household;

  beforeEach(async () => {
    resetDatabase();
    alice = await registerHousehold({ householdName: "Alice's home" });
    bob = await registerHousehold({ householdName: "Bob's home" });
  });

  it("hides another household's expenses", async () => {
    const category = await alice.client.get('/api/categories');
    const created = await alice.client.post('/api/expenses', {
      amount: 25,
      description: 'Alice private',
      categoryId: category.body[0].id,
      spentOn: '2026-03-04',
    });
    expect(created.status).toBe(201);

    const bobList = await bob.client.get('/api/expenses?month=2026-03');
    expect(bobList.body).toEqual([]);

    expect((await bob.client.put(`/api/expenses/${created.body.id}`, {
      amount: 1,
      spentOn: '2026-03-04',
    })).status).toBe(404);
    expect((await bob.client.delete(`/api/expenses/${created.body.id}`)).status).toBe(404);

    // Alice's row is untouched.
    const stillThere = await alice.client.get('/api/expenses?month=2026-03');
    expect(stillThere.body).toHaveLength(1);
    expect(stillThere.body[0].amount_cents).toBe(2500);
  });

  it('rejects an expense pointing at another household category or member', async () => {
    const aliceCategory = (await alice.client.get('/api/categories')).body[0];

    const withForeignCategory = await bob.client.post('/api/expenses', {
      amount: 10,
      categoryId: aliceCategory.id,
      spentOn: '2026-03-04',
    });
    expect(withForeignCategory.status).toBe(400);
    expect(withForeignCategory.body.error).toMatch(/unknown category/i);

    const withForeignPayer = await bob.client.post('/api/expenses', {
      amount: 10,
      paidBy: alice.userId,
      spentOn: '2026-03-04',
    });
    expect(withForeignPayer.status).toBe(400);
    expect(withForeignPayer.body.error).toMatch(/unknown household member/i);
  });

  it('hides another household categories', async () => {
    const aliceCategory = (await alice.client.get('/api/categories')).body[0];

    expect((await bob.client.put(`/api/categories/${aliceCategory.id}`, {
      name: 'Hijacked',
      color: '#000000',
      monthlyBudget: null,
    })).status).toBe(404);
    expect((await bob.client.delete(`/api/categories/${aliceCategory.id}`)).status).toBe(404);

    const aliceCategories = await alice.client.get('/api/categories');
    expect(aliceCategories.body.map((c: any) => c.name)).toContain(aliceCategory.name);
    expect(aliceCategories.body.map((c: any) => c.name)).not.toContain('Hijacked');
  });

  it('hides another household shopping lists and items', async () => {
    const list = await alice.client.post('/api/lists', { name: 'Alice list' });
    const item = await alice.client.post(`/api/lists/${list.body.id}/items`, { name: 'Milk' });

    expect((await bob.client.get('/api/lists')).body).toEqual([]);
    expect((await bob.client.get(`/api/lists/${list.body.id}`)).status).toBe(404);
    expect((await bob.client.put(`/api/lists/${list.body.id}`, { name: 'Taken' })).status).toBe(404);
    expect((await bob.client.delete(`/api/lists/${list.body.id}`)).status).toBe(404);
    expect((await bob.client.post(`/api/lists/${list.body.id}/items`, { name: 'Sneaky' })).status).toBe(404);
    expect(
      (await bob.client.patch(`/api/lists/${list.body.id}/items/${item.body.id}`, { isChecked: true })).status,
    ).toBe(404);
    expect((await bob.client.post(`/api/lists/${list.body.id}/share`, { canEdit: true })).status).toBe(404);

    expect((await bob.client.delete(`/api/lists/${list.body.id}/items/${item.body.id}`)).status).toBe(404);
    expect((await bob.client.post(`/api/lists/${list.body.id}/items/clear-checked`)).status).toBe(404);

    const aliceView = await alice.client.get(`/api/lists/${list.body.id}`);
    expect(aliceView.body.name).toBe('Alice list');
    expect(aliceView.body.items).toHaveLength(1);
    expect(aliceView.body.items[0].is_checked).toBe(0);
    expect(aliceView.body.shareToken).toBeNull();
  });

  it('never hands another household a comment from a list', async () => {
    const list = await alice.client.post('/api/lists', { name: 'Alice list' });
    const item = await alice.client.post(`/api/lists/${list.body.id}/items`, {
      name: 'Milk',
      note: 'The one in the glass bottle',
    });

    expect(
      (await bob.client.patch(`/api/lists/${list.body.id}/items/${item.body.id}`, { note: 'Mine now' }))
        .status,
    ).toBe(404);

    // Alice's comment is still hers, untouched.
    const aliceItem = (await alice.client.get(`/api/lists/${list.body.id}`)).body.items[0];
    expect(aliceItem.note).toBe('The one in the glass bottle');
  });

  it("hides another household's to-do list", async () => {
    const todo = await alice.client.post('/api/todos', { title: 'Alice job' });
    expect(todo.status).toBe(201);

    expect((await bob.client.get('/api/todos')).body).toEqual([]);
    expect((await bob.client.patch(`/api/todos/${todo.body.id}`, { isDone: true })).status).toBe(404);
    expect((await bob.client.patch(`/api/todos/${todo.body.id}`, { title: 'Mine now' })).status).toBe(404);
    expect((await bob.client.delete(`/api/todos/${todo.body.id}`)).status).toBe(404);

    // Bob clearing his own finished jobs must not reach into Alice's list.
    await bob.client.post('/api/todos', { title: 'Bob job' });
    const bobTodo = (await bob.client.get('/api/todos')).body[0];
    await bob.client.patch(`/api/todos/${bobTodo.id}`, { isDone: true });
    expect((await bob.client.post('/api/todos/clear-done')).body.removed).toBe(1);

    const aliceView = await alice.client.get('/api/todos');
    expect(aliceView.body).toHaveLength(1);
    expect(aliceView.body[0].title).toBe('Alice job');
    expect(aliceView.body[0].is_done).toBe(0);
  });

  it('never lists another household members', async () => {
    await addMember(alice, 'Alice partner');
    const bobMembers = await bob.client.get('/api/household/members');
    expect(bobMembers.body).toHaveLength(1);
    expect(bobMembers.body[0].id).toBe(bob.userId);
  });

  it('refuses to remove a member of another household', async () => {
    const removed = await bob.client.delete(`/api/household/members/${alice.userId}`);
    expect(removed.status).toBe(404);
    expect((await alice.client.get('/api/auth/me')).status).toBe(200);
  });

  it('refuses to change the role of someone in another household', async () => {
    const changed = await bob.client.put(`/api/household/members/${alice.userId}/role`, {
      role: 'member',
    });
    expect(changed.status).toBe(404);
    expect((await alice.client.get('/api/auth/me')).body.user.role).toBe('owner');
  });

  it('never lists or opens another account’s households', async () => {
    const listed = await bob.client.get('/api/households');
    expect(listed.body.households).toHaveLength(1);
    expect(listed.body.households[0].id).toBe(bob.householdId);

    // An id from another account behaves as "not found", never as forbidden.
    const switched = await bob.client.post(`/api/households/${alice.householdId}/switch`);
    expect(switched.status).toBe(404);
    expect((await bob.client.get('/api/household')).body.id).toBe(bob.householdId);
  });

  it('will not let an invite be redeemed by the wrong address', async () => {
    // An unpinned invite is a bearer credential by design; a pinned one is the
    // case that must not be transferable between accounts.
    const invite = await alice.client.post('/api/household/invites', {
      email: 'someone-else@example.com',
    });
    const joined = await joinHousehold(bob, invite.body.token, 'Bob');
    expect(joined.status).toBe(400);

    // Bob is still only in his own household, and Alice's is unchanged.
    expect((await bob.client.get('/api/households')).body.households).toHaveLength(1);
    expect((await alice.client.get('/api/household/members')).body).toHaveLength(1);
  });

  it('deletes only the calling household, never the other one', async () => {
    await alice.client.post('/api/expenses', { amount: 100, spentOn: '2026-03-04' });
    await bob.client.post('/api/expenses', { amount: 7, spentOn: '2026-03-04' });

    expect((await bob.client.delete('/api/household', { password: 'correct-horse-battery' })).status).toBe(204);

    // Alice never shared a household id with that request, and keeps everything.
    expect((await alice.client.get('/api/auth/me')).status).toBe(200);
    expect((await alice.client.get('/api/household')).body.name).toBe("Alice's home");
    expect((await alice.client.get('/api/expenses?month=2026-03')).body).toHaveLength(1);
    expect((await alice.client.get('/api/categories')).body.length).toBeGreaterThan(0);
  });

  it('leaves only the household that is open, never the account’s others', async () => {
    // Bob joins Alice's household, so one account holds two — then walks out
    // of hers. Leaving is scoped by the cookie, and the cookie names one.
    const invite = await alice.client.post('/api/household/invites', { role: 'member' });
    expect((await joinHousehold(bob, invite.body.token, 'Bob')).status).toBe(201);

    expect((await bob.client.delete('/api/household/members/me')).status).toBe(204);

    const households = (await bob.client.get('/api/households')).body.households;
    expect(households).toHaveLength(1);
    expect(households[0].id).toBe(bob.householdId);
    // His own household is untouched, and hers has only her in it again.
    expect((await bob.client.post(`/api/households/${bob.householdId}/switch`)).status).toBe(200);
    expect((await bob.client.get('/api/household')).body.name).toBe("Bob's home");
    expect((await alice.client.get('/api/household/members')).body).toHaveLength(1);
  });

  it('leaves the other household alone when someone deletes their account', async () => {
    const alicePartner = await addMember(alice, 'Alice partner');
    await alicePartner.client.post('/api/expenses', { amount: 12, spentOn: '2026-03-04' });

    expect((await bob.client.delete('/api/auth/account', { password: 'correct-horse-battery' })).status).toBe(204);

    expect((await alice.client.get('/api/household/members')).body).toHaveLength(2);
    expect((await alicePartner.client.get('/api/auth/me')).status).toBe(200);
    expect((await alice.client.get('/api/expenses?month=2026-03')).body).toHaveLength(1);
  });

  it('scopes the monthly summary to the calling household', async () => {
    await alice.client.post('/api/expenses', { amount: 100, spentOn: '2026-03-04' });
    await bob.client.post('/api/expenses', { amount: 7, spentOn: '2026-03-04' });

    const aliceSummary = await alice.client.get('/api/expenses/summary?month=2026-03');
    const bobSummary = await bob.client.get('/api/expenses/summary?month=2026-03');

    expect(aliceSummary.body.total_cents).toBe(10000);
    expect(bobSummary.body.total_cents).toBe(700);
  });

  it('scopes the statistics to the calling household', async () => {
    const aliceCategory = (await alice.client.get('/api/categories')).body[0];
    await alice.client.post('/api/expenses', {
      amount: 100,
      categoryId: aliceCategory.id,
      spentOn: '2026-03-04',
    });
    await bob.client.post('/api/expenses', { amount: 7, spentOn: '2026-03-04' });

    const stats = await bob.client.get('/api/expenses/stats?from=2026-03&to=2026-03');
    expect(stats.body.total_cents).toBe(700);
    // Neither Alice's money, nor her name, nor her categories appear anywhere.
    expect(stats.body.members.map((row: any) => row.user_id)).toEqual([bob.userId]);
    expect(stats.body.categories.every((row: any) => row.category_id !== aliceCategory.id)).toBe(true);
    expect(stats.body.categories.reduce((sum: number, row: any) => sum + row.spent_cents, 0)).toBe(700);
    expect(stats.body.matrix.every((row: any) => row.user_id !== alice.userId)).toBe(true);
    expect(stats.body.monthly[0].by_member).toEqual([{ user_id: bob.userId, spent_cents: 700 }]);

    const aliceStats = await alice.client.get('/api/expenses/stats?from=2026-03&to=2026-03');
    expect(aliceStats.body.total_cents).toBe(10000);
  });
});
