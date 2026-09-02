import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  type Household,
} from './helpers.js';

/**
 * The household's shared to-do list.
 *
 * The behaviour worth pinning down is not "a row can be inserted" — it is the
 * bookkeeping around ticking one off: who gets the credit, what happens when it
 * is un-ticked, and what an edit must *not* disturb.
 */
describe('to-do list', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold({ name: 'Dana' });
  });

  const add = async (title: string) => (await owner.client.post('/api/todos', { title })).body;

  it('adds a job and credits whoever added it', async () => {
    const created = await owner.client.post('/api/todos', { title: 'Call the plumber' });
    expect(created.status).toBe(201);
    expect(created.body.title).toBe('Call the plumber');
    expect(created.body.is_done).toBe(0);
    expect(created.body.added_by_name).toBe('Dana');
    expect(created.body.done_by_name).toBeNull();
    expect(created.body.done_at).toBeNull();

    const listed = await owner.client.get('/api/todos');
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(created.body.id);
  });

  it('refuses an empty title', async () => {
    expect((await owner.client.post('/api/todos', { title: '   ' })).status).toBe(400);
    expect((await owner.client.get('/api/todos')).body).toEqual([]);
  });

  it('credits whoever ticks it off, not whoever added it', async () => {
    const todo = await add('Take out the bins');
    const member = await addMember(owner, 'Sam');

    const done = await member.client.patch(`/api/todos/${todo.id}`, { isDone: true });
    expect(done.status).toBe(200);
    expect(done.body.is_done).toBe(1);
    expect(done.body.added_by_name).toBe('Dana');
    expect(done.body.done_by_name).toBe('Sam');
    expect(done.body.done_at).not.toBeNull();
  });

  it('keeps the original credit when a job that is already done is edited', async () => {
    const todo = await add('Take out the bins');
    const member = await addMember(owner, 'Sam');
    const done = (await member.client.patch(`/api/todos/${todo.id}`, { isDone: true })).body;

    const renamed = await owner.client.patch(`/api/todos/${todo.id}`, {
      title: 'Take out the bins and the recycling',
    });
    expect(renamed.body.title).toBe('Take out the bins and the recycling');
    // Editing the words is not doing the job: Sam keeps the credit and the time.
    expect(renamed.body.is_done).toBe(1);
    expect(renamed.body.done_by_name).toBe('Sam');
    expect(renamed.body.done_at).toBe(done.done_at);
  });

  it('clears the credit when a job is un-ticked', async () => {
    const todo = await add('Book the car in');
    await owner.client.patch(`/api/todos/${todo.id}`, { isDone: true });

    const reopened = await owner.client.patch(`/api/todos/${todo.id}`, { isDone: false });
    expect(reopened.body.is_done).toBe(0);
    expect(reopened.body.done_by).toBeNull();
    expect(reopened.body.done_by_name).toBeNull();
    expect(reopened.body.done_at).toBeNull();
  });

  it('lists outstanding jobs before finished ones', async () => {
    const first = await add('First');
    await add('Second');
    await owner.client.patch(`/api/todos/${first.id}`, { isDone: true });

    const listed = await owner.client.get('/api/todos');
    expect(listed.body.map((todo: { title: string }) => todo.title)).toEqual(['Second', 'First']);
  });

  it('clears the finished jobs and leaves the rest', async () => {
    const first = await add('First');
    await add('Second');
    await owner.client.patch(`/api/todos/${first.id}`, { isDone: true });

    const cleared = await owner.client.post('/api/todos/clear-done');
    expect(cleared.status).toBe(200);
    expect(cleared.body.removed).toBe(1);

    const listed = await owner.client.get('/api/todos');
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].title).toBe('Second');
  });

  it('deletes one job', async () => {
    const todo = await add('Fix the shelf');
    expect((await owner.client.delete(`/api/todos/${todo.id}`)).status).toBe(204);
    expect((await owner.client.get('/api/todos')).body).toEqual([]);

    const gone = await owner.client.delete(`/api/todos/${todo.id}`);
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe('error.todoNotFound');
  });

  it('keeps the job when the member who added it leaves, and stops naming them', async () => {
    const member = await addMember(owner, 'Sam');
    const todo = (await member.client.post('/api/todos', { title: 'Sam’s job' })).body;
    expect(todo.added_by_name).toBe('Sam');

    expect((await owner.client.delete(`/api/household/members/${member.userId}`)).status).toBe(204);

    const listed = await owner.client.get('/api/todos');
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].title).toBe('Sam’s job');
    // The row survives; the credit does not follow somebody out of the household.
    expect(listed.body[0].added_by_name).toBeNull();
  });

  it('is not reachable without a household, or without signing in', async () => {
    const stranger = await registerHousehold();
    await stranger.client.post('/api/auth/logout');
    expect((await stranger.client.get('/api/todos')).status).toBe(401);
  });
});
