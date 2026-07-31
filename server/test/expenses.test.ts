import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  type Household,
} from './helpers.js';

describe('expenses', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  let categoryId: string;

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold();
    categoryId = (await owner.client.get('/api/categories')).body[0].id;
  });

  it('stores money as integer cents', async () => {
    const created = await owner.client.post('/api/expenses', {
      amount: 42.75,
      description: 'Weekly shop',
      categoryId,
      spentOn: '2026-04-10',
    });
    expect(created.status).toBe(201);
    expect(created.body.amount_cents).toBe(4275);
  });

  it('rounds a sub-cent amount rather than storing a float', async () => {
    const created = await owner.client.post('/api/expenses', {
      amount: 10.005,
      spentOn: '2026-04-10',
    });
    expect(created.body.amount_cents).toBe(1001);
    expect(Number.isInteger(created.body.amount_cents)).toBe(true);
  });

  it('adds up without floating point drift', async () => {
    // 0.1 + 0.2 is the classic float trap; in cents it is simply 10 + 20.
    await owner.client.post('/api/expenses', { amount: 0.1, spentOn: '2026-04-01' });
    await owner.client.post('/api/expenses', { amount: 0.2, spentOn: '2026-04-01' });

    const summary = await owner.client.get('/api/expenses/summary?month=2026-04');
    expect(summary.body.total_cents).toBe(30);
  });

  it('rejects a zero, negative or non-numeric amount', async () => {
    for (const amount of [0, -5, 'abc', null]) {
      const response = await owner.client.post('/api/expenses', { amount, spentOn: '2026-04-10' });
      expect(response.status, `amount ${amount} should be rejected`).toBe(400);
    }
  });

  it('rejects a malformed date', async () => {
    for (const spentOn of ['10-04-2026', '2026-4-1', 'yesterday', '']) {
      const response = await owner.client.post('/api/expenses', { amount: 5, spentOn });
      expect(response.status, `date "${spentOn}" should be rejected`).toBe(400);
    }
  });

  it('defaults the payer to whoever recorded the expense', async () => {
    const created = await owner.client.post('/api/expenses', { amount: 5, spentOn: '2026-04-10' });
    expect(created.body.paid_by).toBe(owner.userId);
    expect(created.body.paid_by_name).toBe('Owner');
  });

  it('filters by month, category and payer', async () => {
    const member = await addMember(owner, 'Yossi');
    const other = (await owner.client.get('/api/categories')).body[1].id;

    await owner.client.post('/api/expenses', { amount: 10, categoryId, spentOn: '2026-04-10' });
    await owner.client.post('/api/expenses', { amount: 20, categoryId: other, spentOn: '2026-04-11' });
    await member.client.post('/api/expenses', { amount: 30, categoryId, spentOn: '2026-04-12' });
    await owner.client.post('/api/expenses', { amount: 40, categoryId, spentOn: '2026-05-01' });

    expect((await owner.client.get('/api/expenses?month=2026-04')).body).toHaveLength(3);
    expect((await owner.client.get('/api/expenses?month=2026-05')).body).toHaveLength(1);
    expect((await owner.client.get(`/api/expenses?month=2026-04&categoryId=${categoryId}`)).body).toHaveLength(2);
    expect((await owner.client.get(`/api/expenses?month=2026-04&paidBy=${member.userId}`)).body).toHaveLength(1);
  });

  it('treats month boundaries as a half-open range', async () => {
    await owner.client.post('/api/expenses', { amount: 1, spentOn: '2026-03-31' });
    await owner.client.post('/api/expenses', { amount: 2, spentOn: '2026-04-01' });
    await owner.client.post('/api/expenses', { amount: 3, spentOn: '2026-04-30' });
    await owner.client.post('/api/expenses', { amount: 4, spentOn: '2026-05-01' });

    const april = await owner.client.get('/api/expenses/summary?month=2026-04');
    expect(april.body.total_cents).toBe(500);
    expect(april.body.count).toBe(2);
  });

  it('handles the December rollover', async () => {
    await owner.client.post('/api/expenses', { amount: 9, spentOn: '2026-12-31' });
    await owner.client.post('/api/expenses', { amount: 11, spentOn: '2027-01-01' });

    const december = await owner.client.get('/api/expenses/summary?month=2026-12');
    expect(december.body.total_cents).toBe(900);
  });

  it('rejects a malformed month parameter', async () => {
    for (const month of ['2026-13', 'April', '2026-00', '26-04']) {
      const response = await owner.client.get(`/api/expenses/summary?month=${month}`);
      expect(response.status, `month "${month}" should be rejected`).toBe(400);
    }
  });

  it('breaks the month down by category, including budgeted ones with no spend', async () => {
    await owner.client.put(`/api/categories/${categoryId}`, {
      name: 'Groceries',
      color: '#16a34a',
      monthlyBudget: 400,
    });
    await owner.client.post('/api/expenses', { amount: 120, categoryId, spentOn: '2026-04-10' });

    const summary = await owner.client.get('/api/expenses/summary?month=2026-04');
    const groceries = summary.body.by_category.find((row: any) => row.category_id === categoryId);
    expect(groceries.spent_cents).toBe(12000);
    expect(groceries.monthly_budget_cents).toBe(40000);

    // Every category is present, so budgets with no spending still render.
    expect(summary.body.by_category).toHaveLength(7);
  });

  it('reports uncategorised spending separately', async () => {
    await owner.client.post('/api/expenses', { amount: 15, spentOn: '2026-04-10' });
    const summary = await owner.client.get('/api/expenses/summary?month=2026-04');

    expect(summary.body.uncategorised_cents).toBe(1500);
    expect(summary.body.total_cents).toBe(1500);
  });

  it('splits the month by member', async () => {
    const member = await addMember(owner, 'Yossi');
    await owner.client.post('/api/expenses', { amount: 60, spentOn: '2026-04-10' });
    await member.client.post('/api/expenses', { amount: 40, spentOn: '2026-04-11' });

    const summary = await owner.client.get('/api/expenses/summary?month=2026-04');
    const byName = Object.fromEntries(
      summary.body.by_member.map((row: any) => [row.name, row.spent_cents]),
    );
    expect(byName).toEqual({ Owner: 6000, Yossi: 4000 });
  });

  it('returns a trailing six-month trend, oldest first', async () => {
    for (const month of ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04']) {
      await owner.client.post('/api/expenses', { amount: 10, spentOn: `${month}-05` });
    }
    const summary = await owner.client.get('/api/expenses/summary?month=2026-04');
    const months = summary.body.trend.map((point: any) => point.month);

    expect(months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('updates and deletes an expense', async () => {
    const created = await owner.client.post('/api/expenses', {
      amount: 10,
      description: 'Typo',
      spentOn: '2026-04-10',
    });

    const updated = await owner.client.put(`/api/expenses/${created.body.id}`, {
      amount: 12.5,
      description: 'Corrected',
      categoryId,
      paidBy: owner.userId,
      spentOn: '2026-04-11',
    });
    expect(updated.body.amount_cents).toBe(1250);
    expect(updated.body.description).toBe('Corrected');
    expect(updated.body.category_name).toBeTruthy();

    expect((await owner.client.delete(`/api/expenses/${created.body.id}`)).status).toBe(204);
    expect((await owner.client.get('/api/expenses?month=2026-04')).body).toHaveLength(0);
  });

  it('404s on updating or deleting an expense that does not exist', async () => {
    const missing = '11111111-1111-4111-8111-111111111111';
    expect((await owner.client.put(`/api/expenses/${missing}`, {
      amount: 1,
      spentOn: '2026-04-10',
    })).status).toBe(404);
    expect((await owner.client.delete(`/api/expenses/${missing}`)).status).toBe(404);
  });

  it('keeps expenses when their category is deleted', async () => {
    const created = await owner.client.post('/api/expenses', {
      amount: 20,
      categoryId,
      spentOn: '2026-04-10',
    });
    await owner.client.delete(`/api/categories/${categoryId}`);

    const list = await owner.client.get('/api/expenses?month=2026-04');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(created.body.id);
    expect(list.body[0].category_id).toBeNull();
    expect(list.body[0].category_name).toBeNull();
  });

  it('keeps expenses when the member who paid is removed', async () => {
    const member = await addMember(owner, 'Yossi');
    await member.client.post('/api/expenses', { amount: 25, description: 'Theirs', spentOn: '2026-04-10' });

    await owner.client.delete(`/api/household/members/${member.userId}`);

    const list = await owner.client.get('/api/expenses?month=2026-04');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].description).toBe('Theirs');
    expect(list.body[0].paid_by).toBeNull();
    // The money still counts towards the household total.
    expect((await owner.client.get('/api/expenses/summary?month=2026-04')).body.total_cents).toBe(2500);
  });
});

describe('expense statistics', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  let categories: Array<{ id: string; name: string }>;

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold();
    categories = (await owner.client.get('/api/categories')).body;
  });

  const statsFor = (from: string, to: string) =>
    owner.client.get(`/api/expenses/stats?from=${from}&to=${to}`);

  it('splits a multi-month range by member', async () => {
    const member = await addMember(owner, 'Yossi');
    await owner.client.post('/api/expenses', { amount: 60, spentOn: '2026-03-10' });
    await owner.client.post('/api/expenses', { amount: 15.5, spentOn: '2026-04-02' });
    await member.client.post('/api/expenses', { amount: 40, spentOn: '2026-04-11' });
    // Outside the range: must not be counted.
    await member.client.post('/api/expenses', { amount: 999, spentOn: '2026-05-01' });

    const stats = await statsFor('2026-03', '2026-04');
    expect(stats.status).toBe(200);
    expect(stats.body.total_cents).toBe(11550);
    expect(stats.body.count).toBe(3);
    expect(stats.body.members.map((row: any) => [row.name, row.spent_cents, row.count])).toEqual([
      ['Owner', 7550, 2],
      ['Yossi', 4000, 1],
    ]);
  });

  it('orders members by name, not by spend, so a colour never moves', async () => {
    // 'Abigail' spends the least and must still come first.
    const big = await addMember(owner, 'Zoe');
    const small = await addMember(owner, 'Abigail');
    await small.client.post('/api/expenses', { amount: 1, spentOn: '2026-04-01' });
    await big.client.post('/api/expenses', { amount: 500, spentOn: '2026-04-01' });

    const stats = await statsFor('2026-04', '2026-04');
    expect(stats.body.members.map((row: any) => row.name)).toEqual(['Abigail', 'Owner', 'Zoe']);
  });

  it('splits the same range by category', async () => {
    await owner.client.post('/api/expenses', {
      amount: 30,
      categoryId: categories[0].id,
      spentOn: '2026-04-01',
    });
    await owner.client.post('/api/expenses', {
      amount: 10,
      categoryId: categories[1].id,
      spentOn: '2026-04-02',
    });

    const stats = await statsFor('2026-04', '2026-04');
    const spend = Object.fromEntries(
      stats.body.categories.map((row: any) => [row.name, row.spent_cents]),
    );
    expect(spend[categories[0].name]).toBe(3000);
    expect(spend[categories[1].name]).toBe(1000);
    // Categories with no spending still appear, at zero.
    expect(spend[categories[2].name]).toBe(0);
    expect(stats.body.categories[0].color).toBeTruthy();
  });

  it('cross-tabs how much each member spent per category', async () => {
    const member = await addMember(owner, 'Yossi');
    const [food, transport] = categories;
    await owner.client.post('/api/expenses', {
      amount: 20,
      categoryId: food.id,
      spentOn: '2026-04-01',
    });
    await owner.client.post('/api/expenses', {
      amount: 5,
      categoryId: food.id,
      spentOn: '2026-04-03',
    });
    await member.client.post('/api/expenses', {
      amount: 12,
      categoryId: food.id,
      spentOn: '2026-04-02',
    });
    await member.client.post('/api/expenses', {
      amount: 8,
      categoryId: transport.id,
      spentOn: '2026-04-02',
    });

    const stats = await statsFor('2026-04', '2026-04');
    const cell = (userId: string, categoryId: string) =>
      stats.body.matrix.find((row: any) => row.user_id === userId && row.category_id === categoryId);

    expect(cell(owner.userId, food.id)).toMatchObject({ spent_cents: 2500, count: 2 });
    expect(cell(member.userId, food.id)).toMatchObject({ spent_cents: 1200, count: 1 });
    expect(cell(member.userId, transport.id)).toMatchObject({ spent_cents: 800, count: 1 });
    // Pairs with no spending are simply absent rather than sent as zeroes.
    expect(cell(owner.userId, transport.id)).toBeUndefined();

    // The cross-tab adds up to the same money as the totals do.
    const matrixTotal = stats.body.matrix.reduce((sum: number, row: any) => sum + row.spent_cents, 0);
    expect(matrixTotal).toBe(stats.body.total_cents);
  });

  it('keeps spending with no payer or no category in the totals, under a null id', async () => {
    const member = await addMember(owner, 'Yossi');
    await member.client.post('/api/expenses', { amount: 25, spentOn: '2026-04-10' });
    await owner.client.delete(`/api/household/members/${member.userId}`);

    const stats = await statsFor('2026-04', '2026-04');
    const orphan = stats.body.members.find((row: any) => row.user_id === null);
    const uncategorised = stats.body.categories.find((row: any) => row.category_id === null);

    expect(orphan).toMatchObject({ name: null, spent_cents: 2500, count: 1 });
    expect(uncategorised).toMatchObject({ name: null, color: null, spent_cents: 2500 });
    // Both breakdowns still account for every cent.
    const memberTotal = stats.body.members.reduce((sum: number, row: any) => sum + row.spent_cents, 0);
    const categoryTotal = stats.body.categories.reduce(
      (sum: number, row: any) => sum + row.spent_cents,
      0,
    );
    expect(memberTotal).toBe(2500);
    expect(categoryTotal).toBe(2500);
    expect(stats.body.matrix[0]).toMatchObject({ user_id: null, category_id: null });
  });

  it('reports every month in the range, including the empty ones', async () => {
    const member = await addMember(owner, 'Yossi');
    await owner.client.post('/api/expenses', { amount: 10, spentOn: '2026-01-15' });
    await member.client.post('/api/expenses', { amount: 4, spentOn: '2026-03-02' });

    const stats = await statsFor('2026-01', '2026-03');
    expect(stats.body.months).toBe(3);
    expect(stats.body.monthly.map((point: any) => [point.month, point.total_cents])).toEqual([
      ['2026-01', 1000],
      ['2026-02', 0],
      ['2026-03', 400],
    ]);
    expect(stats.body.monthly[2].by_member).toEqual([{ user_id: member.userId, spent_cents: 400 }]);
  });

  it('follows one category through the range, month by month', async () => {
    const [food, transport] = categories;
    await owner.client.post('/api/expenses', {
      amount: 30,
      categoryId: food.id,
      spentOn: '2026-01-04',
    });
    await owner.client.post('/api/expenses', {
      amount: 12,
      categoryId: food.id,
      spentOn: '2026-01-20',
    });
    await owner.client.post('/api/expenses', {
      amount: 9,
      categoryId: transport.id,
      spentOn: '2026-02-10',
    });
    await owner.client.post('/api/expenses', {
      amount: 7,
      categoryId: food.id,
      spentOn: '2026-03-01',
    });
    await owner.client.post('/api/expenses', { amount: 5, spentOn: '2026-03-02' });

    const stats = await statsFor('2026-01', '2026-03');
    const forCategory = (categoryId: string | null) =>
      stats.body.monthly.map(
        (point: any) =>
          point.by_category.find((row: any) => row.category_id === categoryId)?.spent_cents ?? 0,
      );

    // January's two shops add up; February has none; March has one.
    expect(forCategory(food.id)).toEqual([4200, 0, 700]);
    expect(forCategory(transport.id)).toEqual([0, 900, 0]);
    // Uncategorised spending is followable the same way, under a null id.
    expect(forCategory(null)).toEqual([0, 0, 500]);

    // Each month's categories add up to that month's total.
    for (const point of stats.body.monthly) {
      const summed = point.by_category.reduce((sum: number, row: any) => sum + row.spent_cents, 0);
      expect(summed).toBe(point.total_cents);
    }
  });

  it('crosses a year boundary', async () => {
    await owner.client.post('/api/expenses', { amount: 10, spentOn: '2025-12-31' });
    await owner.client.post('/api/expenses', { amount: 20, spentOn: '2026-01-01' });

    const stats = await statsFor('2025-12', '2026-01');
    expect(stats.body.monthly.map((point: any) => point.month)).toEqual(['2025-12', '2026-01']);
    expect(stats.body.total_cents).toBe(3000);
  });

  it('defaults to the six months ending with this month', async () => {
    const stats = await owner.client.get('/api/expenses/stats');
    expect(stats.status).toBe(200);
    expect(stats.body.months).toBe(6);
    expect(stats.body.to).toBe(new Date().toISOString().slice(0, 7));
    expect(stats.body.monthly).toHaveLength(6);
    expect(stats.body.monthly[5].month).toBe(stats.body.to);
  });

  it('rejects a malformed, backwards or oversized range', async () => {
    expect((await statsFor('2026-13', '2026-04')).status).toBe(400);
    expect((await statsFor('April', '2026-04')).status).toBe(400);
    expect((await statsFor('2026-04', '2026-1')).status).toBe(400);

    const backwards = await statsFor('2026-06', '2026-01');
    expect(backwards.status).toBe(400);
    expect(backwards.body.error).toMatch(/from must not be after to/i);

    const tooLong = await statsFor('2024-01', '2026-04');
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toMatch(/24 months/);
    // The largest allowed range is still fine.
    expect((await statsFor('2024-05', '2026-04')).body.months).toBe(24);
  });
});

describe('categories', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold();
  });

  it('creates a category with a budget in cents', async () => {
    const created = await owner.client.post('/api/categories', {
      name: 'Pets',
      color: '#ff8800',
      monthlyBudget: 75.5,
    });
    expect(created.status).toBe(201);
    expect(created.body.monthly_budget_cents).toBe(7550);
  });

  it('treats a null budget as "no limit"', async () => {
    const created = await owner.client.post('/api/categories', { name: 'Gifts', monthlyBudget: null });
    expect(created.body.monthly_budget_cents).toBeNull();
  });

  it('rejects a duplicate name within the household', async () => {
    await owner.client.post('/api/categories', { name: 'Pets' });
    const duplicate = await owner.client.post('/api/categories', { name: 'Pets' });
    expect(duplicate.status).toBe(409);
  });

  it('allows the same category name in a different household', async () => {
    await owner.client.post('/api/categories', { name: 'Pets' });
    const other = await registerHousehold();
    expect((await other.client.post('/api/categories', { name: 'Pets' })).status).toBe(201);
  });

  it('rejects a malformed colour', async () => {
    const response = await owner.client.post('/api/categories', { name: 'Bad', color: 'red' });
    expect(response.status).toBe(400);
  });
});
