import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import {
  materialiseDueExpenses,
  occurrenceAt,
  occurrencesAfter,
  previousDay,
} from '../src/recurring.js';
import {
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  type Household,
} from './helpers.js';

/**
 * The date maths is a pure function, so it is tested directly — no HTTP, no
 * database. These are the cases that actually bite in production: month-end
 * clamping, leap years, and year rollovers.
 */
describe('recurrence dates', () => {
  const monthly = (startsOn: string, endsOn: string | null = null) =>
    ({ frequency: 'monthly', startsOn, endsOn }) as const;

  it('steps monthly on the same day', () => {
    const rule = monthly('2026-01-15');
    expect([0, 1, 2].map((n) => occurrenceAt(rule, n))).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('clamps a month-end start date without dragging the anchor down', () => {
    // The classic bug: after February pulls the 31st back to the 28th, every
    // later month must still use the 31st, not stay stuck on the 28th.
    const rule = monthly('2026-01-31');
    expect([0, 1, 2, 3].map((n) => occurrenceAt(rule, n))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('uses 29 February in a leap year', () => {
    const rule = monthly('2024-01-31');
    expect(occurrenceAt(rule, 1)).toBe('2024-02-29');
  });

  it('rolls over the year boundary', () => {
    const rule = monthly('2026-11-10');
    expect([0, 1, 2, 3].map((n) => occurrenceAt(rule, n))).toEqual([
      '2026-11-10',
      '2026-12-10',
      '2027-01-10',
      '2027-02-10',
    ]);
  });

  it('steps weekly by seven days, across months', () => {
    const rule = { frequency: 'weekly', startsOn: '2026-01-28', endsOn: null } as const;
    expect([0, 1, 2].map((n) => occurrenceAt(rule, n))).toEqual([
      '2026-01-28',
      '2026-02-04',
      '2026-02-11',
    ]);
  });

  it('steps yearly, clamping 29 February on non-leap years', () => {
    const rule = { frequency: 'yearly', startsOn: '2024-02-29', endsOn: null } as const;
    expect([0, 1, 2, 3, 4].map((n) => occurrenceAt(rule, n))).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('lists only occurrences after the last generated one', () => {
    const rule = monthly('2026-01-10');
    expect(occurrencesAfter(rule, '2026-02-10', '2026-05-01')).toEqual([
      '2026-03-10',
      '2026-04-10',
    ]);
  });

  it('includes everything from the start when nothing has been generated', () => {
    expect(occurrencesAfter(monthly('2026-01-10'), null, '2026-03-15')).toEqual([
      '2026-01-10',
      '2026-02-10',
      '2026-03-10',
    ]);
  });

  it('stops at the end date', () => {
    expect(occurrencesAfter(monthly('2026-01-10', '2026-02-28'), null, '2026-06-01')).toEqual([
      '2026-01-10',
      '2026-02-10',
    ]);
  });

  it('returns nothing when the rule has not started yet', () => {
    expect(occurrencesAfter(monthly('2026-06-01'), null, '2026-03-01')).toEqual([]);
  });

  it('walks back a day across month and year boundaries', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2024-03-01')).toBe('2024-02-29');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

describe('recurring expenses API', () => {
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

  /** Backdates a rule so materialisation has something to catch up on. */
  const backdate = (id: string, startsOn: string, lastGeneratedOn: string | null = null) =>
    db
      .prepare('UPDATE recurring_expenses SET starts_on = ?, last_generated_on = ? WHERE id = ?')
      .run(startsOn, lastGeneratedOn, id);

  /**
   * Reads expenses straight from the database. The API endpoints materialise
   * up to the real today before responding, which would generate occurrences
   * beyond the fixed `asOf` these tests pin behaviour to.
   */
  const storedDates = (householdId: string) =>
    (
      db
        .prepare('SELECT spent_on FROM expenses WHERE household_id = ? ORDER BY spent_on')
        .all(householdId) as Array<{ spent_on: string }>
    ).map((row) => row.spent_on);

  /** A year far enough ahead that nothing materialises against the real clock. */
  const futureYear = new Date().getFullYear() + 4;

  it('creates a rule and generates its first expense straight away', async () => {
    const created = await owner.client.post('/api/recurring', {
      amount: 1200,
      description: 'Rent',
      categoryId,
      frequency: 'monthly',
      startsOn: '2026-01-01',
    });
    expect(created.status).toBe(201);
    expect(created.body.amount_cents).toBe(120000);

    const expenses = await owner.client.get('/api/expenses?month=2026-01');
    expect(expenses.body).toHaveLength(1);
    expect(expenses.body[0].description).toBe('Rent');
    expect(expenses.body[0].recurring_id).toBe(created.body.id);
  });

  it('catches up on every occurrence missed since the last visit', async () => {
    const created = await owner.client.post('/api/recurring', {
      amount: 50,
      description: 'Streaming',
      frequency: 'monthly',
      startsOn: '2026-01-05',
    });
    // Pretend the rule was created in January and nobody opened the app since.
    db.prepare('DELETE FROM expenses').run();
    backdate(created.body.id, '2026-01-05', null);

    const generated = materialiseDueExpenses(owner.householdId, '2026-04-10');
    expect(generated).toBe(4);
    expect(storedDates(owner.householdId)).toEqual([
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
    ]);
  });

  it('never generates the same occurrence twice', async () => {
    const created = await owner.client.post('/api/recurring', {
      amount: 10,
      description: 'Gym',
      frequency: 'monthly',
      startsOn: '2026-01-05',
    });
    db.prepare('DELETE FROM expenses').run();
    backdate(created.body.id, '2026-01-05', null);

    expect(materialiseDueExpenses(owner.householdId, '2026-03-10')).toBe(3);
    // Running again for the same date, and for an earlier one, adds nothing.
    expect(materialiseDueExpenses(owner.householdId, '2026-03-10')).toBe(0);
    expect(materialiseDueExpenses(owner.householdId, '2026-02-01')).toBe(0);
    expect(storedDates(owner.householdId)).toHaveLength(3);
  });

  it('stops generating after the end date', async () => {
    const created = await owner.client.post('/api/recurring', {
      amount: 10,
      description: 'Course',
      frequency: 'monthly',
      startsOn: '2026-01-05',
      endsOn: '2026-03-31',
    });
    db.prepare('DELETE FROM expenses').run();
    backdate(created.body.id, '2026-01-05', null);

    expect(materialiseDueExpenses(owner.householdId, '2026-12-31')).toBe(3);
  });

  it('generates nothing while paused, and skips the gap on resume', async () => {
    const created = await owner.client.post('/api/recurring', {
      amount: 10,
      description: 'Paused thing',
      frequency: 'monthly',
      startsOn: '2026-01-05',
    });
    db.prepare('DELETE FROM expenses').run();
    backdate(created.body.id, '2026-01-05', '2026-01-05');

    await owner.client.post(`/api/recurring/${created.body.id}/active`, { isActive: false });
    expect(materialiseDueExpenses(owner.householdId, '2026-06-10')).toBe(0);

    const resumed = await owner.client.post(`/api/recurring/${created.body.id}/active`, {
      isActive: true,
    });
    expect(resumed.body.is_active).toBe(1);

    // The months spent paused are not back-charged.
    expect(storedDates(owner.householdId)).toHaveLength(0);
  });

  it('reports when the rule next falls due', async () => {
    // Dated into the future so listing the rules does not materialise anything
    // against the real clock and move the answer.
    const created = await owner.client.post('/api/recurring', {
      amount: 10,
      description: 'Rent',
      frequency: 'monthly',
      startsOn: `${futureYear}-01-10`,
    });
    backdate(created.body.id, `${futureYear}-01-10`, `${futureYear}-03-10`);

    const rules = await owner.client.get('/api/recurring');
    const rule = rules.body.find((row: any) => row.id === created.body.id);
    expect(rule.next_due_on).toBe(`${futureYear}-04-10`);
  });

  it('reports no next date for a paused rule', async () => {
    const created = await owner.client.post('/api/recurring', {
      amount: 10,
      frequency: 'monthly',
      startsOn: `${futureYear}-01-10`,
    });
    await owner.client.post(`/api/recurring/${created.body.id}/active`, { isActive: false });

    const rules = await owner.client.get('/api/recurring');
    expect(rules.body[0].next_due_on).toBeNull();
  });

  it('rejects an end date before the start date', async () => {
    const response = await owner.client.post('/api/recurring', {
      amount: 10,
      frequency: 'monthly',
      startsOn: '2026-05-01',
      endsOn: '2026-04-01',
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/end date/i);
  });

  it('rejects an unknown frequency and a malformed date', async () => {
    expect(
      (await owner.client.post('/api/recurring', {
        amount: 10,
        frequency: 'fortnightly',
        startsOn: '2026-01-01',
      })).status,
    ).toBe(400);
    expect(
      (await owner.client.post('/api/recurring', {
        amount: 10,
        frequency: 'monthly',
        startsOn: '01/01/2026',
      })).status,
    ).toBe(400);
  });

  it('keeps generated expenses when the rule is deleted', async () => {
    const created = await owner.client.post('/api/recurring', {
      amount: 99,
      description: 'Old subscription',
      frequency: 'monthly',
      startsOn: '2026-01-01',
    });
    expect((await owner.client.delete(`/api/recurring/${created.body.id}`)).status).toBe(204);

    const expenses = await owner.client.get('/api/expenses?month=2026-01');
    expect(expenses.body).toHaveLength(1);
    expect(expenses.body[0].description).toBe('Old subscription');
    // The link back is gone, but the money spent is still on record.
    expect(expenses.body[0].recurring_id).toBeNull();
  });

  it('re-generates from the new start date when the rule is moved later', async () => {
    const created = await owner.client.post('/api/recurring', {
      amount: 10,
      description: 'Moved',
      frequency: 'monthly',
      startsOn: '2026-01-05',
    });
    db.prepare('DELETE FROM expenses').run();
    backdate(created.body.id, '2026-01-05', '2026-01-05');

    await owner.client.put(`/api/recurring/${created.body.id}`, {
      amount: 10,
      description: 'Moved',
      frequency: 'monthly',
      startsOn: '2026-02-05',
    });

    const rule = db
      .prepare('SELECT last_generated_on FROM recurring_expenses WHERE id = ?')
      .get(created.body.id) as { last_generated_on: string | null };
    // The stale marker was cleared, so February onwards can still generate.
    expect(rule.last_generated_on === null || rule.last_generated_on >= '2026-02-05').toBe(true);
  });

  it('keeps one household rules invisible to another', async () => {
    const created = await owner.client.post('/api/recurring', {
      amount: 10,
      description: 'Private rent',
      frequency: 'monthly',
      startsOn: '2026-01-01',
    });
    const other = await registerHousehold();

    expect((await other.client.get('/api/recurring')).body).toEqual([]);
    expect((await other.client.delete(`/api/recurring/${created.body.id}`)).status).toBe(404);
    expect(
      (await other.client.post(`/api/recurring/${created.body.id}/active`, { isActive: false })).status,
    ).toBe(404);
    expect(
      (await other.client.put(`/api/recurring/${created.body.id}`, {
        amount: 1,
        frequency: 'monthly',
        startsOn: '2026-01-01',
      })).status,
    ).toBe(404);
  });

  it('rejects a category belonging to another household', async () => {
    const other = await registerHousehold();
    const response = await other.client.post('/api/recurring', {
      amount: 10,
      categoryId,
      frequency: 'monthly',
      startsOn: '2026-01-01',
    });
    expect(response.status).toBe(400);
  });

  it('requires a session', async () => {
    const { createClient } = await import('./helpers.js');
    expect((await createClient().get('/api/recurring')).status).toBe(401);
  });
});

describe('who paid, on create and update', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold();
  });

  it('defaults to the current user when paidBy is omitted, on both create and update', async () => {
    const created = await owner.client.post('/api/expenses', { amount: 5, spentOn: '2026-04-10' });
    expect(created.body.paid_by).toBe(owner.userId);

    const updated = await owner.client.put(`/api/expenses/${created.body.id}`, {
      amount: 6,
      spentOn: '2026-04-10',
    });
    // Previously an omitted field cleared the payer on update but not on create.
    expect(updated.body.paid_by).toBe(owner.userId);
  });

  it('honours an explicit null as "nobody in particular", on both', async () => {
    const created = await owner.client.post('/api/expenses', {
      amount: 5,
      paidBy: null,
      spentOn: '2026-04-10',
    });
    expect(created.body.paid_by).toBeNull();

    const updated = await owner.client.put(`/api/expenses/${created.body.id}`, {
      amount: 5,
      paidBy: null,
      spentOn: '2026-04-10',
    });
    expect(updated.body.paid_by).toBeNull();
  });
});
