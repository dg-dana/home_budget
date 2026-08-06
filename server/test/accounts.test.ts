import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import {
  addMember,
  createClient,
  createHousehold,
  joinHousehold,
  pendingVerificationToken,
  registerAccount,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  uniqueEmail,
} from './helpers.js';

/**
 * The two-step sign-up: an account first, a household afterwards — and an
 * account may end up with several.
 */
describe('accounts and households', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  beforeEach(resetDatabase);

  it('registers an account that belongs to no household yet', async () => {
    const client = createClient();
    const registered = await client.post('/api/auth/register', {
      email: uniqueEmail('fresh'),
      password: 'password123',
    });

    expect(registered.status).toBe(201);
    expect(registered.body.household).toBeNull();
    expect(registered.body.households).toEqual([]);
    // Signed in immediately, so they can see what is blocked and why.
    expect((await client.get('/api/auth/me')).status).toBe(200);
    // ...but every household-scoped route has nothing to be about.
    expect((await client.get('/api/expenses')).status).toBe(403);
    expect((await client.get('/api/household')).status).toBe(403);
  });

  it('no longer takes a household name or a person name at registration', async () => {
    const client = createClient();
    const email = uniqueEmail('extra');
    // The old one-step payload: the household fields are simply not part of
    // registration any more, and must not quietly create anything.
    const registered = await client.post('/api/auth/register', {
      householdName: 'Sneaky',
      name: 'Sneaky',
      email,
      password: 'password123',
    });

    expect(registered.status).toBe(201);
    expect(registered.body.households).toEqual([]);
    const households = db.prepare('SELECT COUNT(*) AS count FROM households').get() as { count: number };
    expect(households.count).toBe(0);
  });

  it('refuses a second account on the same address', async () => {
    const email = uniqueEmail('taken');
    await registerAccount({ email });
    const again = await createClient().post('/api/auth/register', { email, password: 'password123' });
    expect(again.status).toBe(409);
  });

  it('still says 409, not 500, when two sign-ups race for one address', async () => {
    // Hashing is async, so both requests can pass the "is it taken?" lookup
    // before either inserts. The UNIQUE constraint settles it, and the loser
    // must get the same answer as if it had simply arrived second.
    const email = uniqueEmail('race');
    const [first, second] = await Promise.all([
      createClient().post('/api/auth/register', { email, password: 'password123' }),
      createClient().post('/api/auth/register', { email, password: 'password123' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const accounts = db.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').get(email) as {
      count: number;
    };
    expect(accounts.count).toBe(1);
  });

  describe('confirming the address', () => {
    it('blocks creating or joining a household until it is confirmed', async () => {
      const owner = await registerHousehold();
      const invite = await owner.client.post('/api/household/invites', { role: 'member' });

      const unconfirmed = await registerAccount({ email: uniqueEmail('pending'), verify: false });
      const me = await unconfirmed.client.get('/api/auth/me');
      expect(me.body.user.emailVerified).toBe(false);

      const created = await unconfirmed.client.post('/api/households', {
        name: 'Too soon',
        displayName: 'Nobody',
      });
      expect(created.status).toBe(403);
      expect(created.body.error).toMatch(/confirm your email/i);

      const joined = await joinHousehold(unconfirmed, invite.body.token, 'Nobody');
      expect(joined.status).toBe(403);

      // Nothing was created on the way past.
      const households = db.prepare('SELECT COUNT(*) AS count FROM households').get() as { count: number };
      expect(households.count).toBe(1);
    });

    it('lets the link through once, and only once', async () => {
      const account = await registerAccount({ verify: false });
      const token = pendingVerificationToken(account.userId);

      // Anyone holding the link can read whose it is, and redeem it.
      const preview = await createClient().get(`/api/auth/verify/${token}`);
      expect(preview.status).toBe(200);
      expect(preview.body.email).toBe(account.email);

      expect((await account.client.post('/api/auth/verify', { token })).status).toBe(200);
      expect((await account.client.get('/api/auth/me')).body.user.emailVerified).toBe(true);

      // Burnt.
      expect((await account.client.post('/api/auth/verify', { token })).status).toBe(400);
      expect((await createClient().get(`/api/auth/verify/${token}`)).status).toBe(400);
    });

    it('refuses an expired or unknown link', async () => {
      const account = await registerAccount({ verify: false });
      const token = pendingVerificationToken(account.userId);
      db.prepare('UPDATE email_verifications SET expires_at = ? WHERE token = ?').run(
        new Date(Date.now() - 1000).toISOString(),
        token,
      );

      expect((await account.client.post('/api/auth/verify', { token })).status).toBe(400);
      expect((await createClient().post('/api/auth/verify', { token: 'nope' })).status).toBe(400);
    });

    it('retires the previous link when a new one is issued', async () => {
      const account = await registerAccount({ verify: false });
      const first = pendingVerificationToken(account.userId);

      const resent = await account.client.post('/api/auth/verify/resend');
      expect(resent.status).toBe(201);
      const second = pendingVerificationToken(account.userId);
      expect(second).not.toBe(first);

      expect((await account.client.post('/api/auth/verify', { token: first })).status).toBe(400);
      expect((await account.client.post('/api/auth/verify', { token: second })).status).toBe(200);
    });

    it('will not resend for an address already confirmed', async () => {
      const account = await registerAccount();
      expect((await account.client.post('/api/auth/verify/resend')).status).toBe(400);
    });

    it('never puts the confirmation link in a response to a stranger', async () => {
      // The link is a credential. Registering hands it to the person who just
      // registered and to nobody else.
      const account = await registerAccount({ verify: false });
      const token = pendingVerificationToken(account.userId);
      const stranger = await createClient().post('/api/auth/verify/resend');
      expect(stranger.status).toBe(401);

      const others = await registerAccount();
      expect(JSON.stringify((await others.client.get('/api/auth/me')).body)).not.toContain(token);
    });
  });

  describe('belonging to several households', () => {
    it('lets one account own more than one', async () => {
      const owner = await registerHousehold({ householdName: 'Home' });
      const second = await createHousehold(owner, { name: 'Beach flat', displayName: 'Me' });

      const listed = await owner.client.get('/api/households');
      expect(listed.body.households.map((h: any) => h.name).sort()).toEqual(['Beach flat', 'Home']);
      // Creating one switches to it.
      expect(listed.body.currentId).toBe(second.id);
      expect((await owner.client.get('/api/household')).body.name).toBe('Beach flat');
    });

    it('keeps the two households’ data completely apart', async () => {
      const owner = await registerHousehold({ householdName: 'Home' });
      await owner.client.post('/api/expenses', { amount: 10, description: 'Home spend', spentOn: '2026-05-02' });

      const beach = await createHousehold(owner, { name: 'Beach flat', displayName: 'Me' });
      await owner.client.post('/api/expenses', { amount: 99, description: 'Beach spend', spentOn: '2026-05-02' });

      // Now looking at the beach flat: only its money is visible.
      const beachExpenses = await owner.client.get('/api/expenses?month=2026-05');
      expect(beachExpenses.body).toHaveLength(1);
      expect(beachExpenses.body[0].description).toBe('Beach spend');

      // Switch back, and the other household is untouched and unmixed.
      await owner.client.post(`/api/households/${owner.householdId}/switch`);
      const homeExpenses = await owner.client.get('/api/expenses?month=2026-05');
      expect(homeExpenses.body).toHaveLength(1);
      expect(homeExpenses.body[0].description).toBe('Home spend');
      expect((await owner.client.get('/api/expenses/summary?month=2026-05')).body.total_cents).toBe(1000);

      // Each got its own seeded categories rather than sharing one set.
      const categories = db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number };
      expect(categories.count).toBe(14);
      expect(beach.id).not.toBe(owner.householdId);
    });

    it('carries a different name in each household', async () => {
      const home = await registerHousehold({ householdName: 'Home', name: 'Dad' });
      await createHousehold(home, { name: 'Flat share', displayName: 'Dana' });

      expect((await home.client.get('/api/auth/me')).body.user.name).toBe('Dana');
      await home.client.post(`/api/households/${home.householdId}/switch`);
      expect((await home.client.get('/api/auth/me')).body.user.name).toBe('Dad');

      // And the name follows the household on anything that records a person.
      const list = await home.client.post('/api/lists', { name: 'Shopping' });
      const item = await home.client.post(`/api/lists/${list.body.id}/items`, { name: 'Milk' });
      expect(item.body.added_by_name).toBe('Dad');
    });

    it('refuses to switch to a household the account is not in', async () => {
      const alice = await registerHousehold();
      const bob = await registerHousehold();

      const switched = await bob.client.post(`/api/households/${alice.householdId}/switch`);
      expect(switched.status).toBe(404);
      // And bob is still where he was.
      expect((await bob.client.get('/api/household')).body.id).toBe(bob.householdId);
    });

    it('refuses to join the same household twice', async () => {
      const owner = await registerHousehold();
      const invite = await owner.client.post('/api/household/invites', { role: 'member' });
      const joiner = await registerAccount();
      const first = await joiner.client.post('/api/households/join', {
        token: invite.body.token,
        displayName: 'First',
      });
      expect(first.status).toBe(201);

      const again = await owner.client.post('/api/household/invites', { role: 'member' });
      const twice = await joiner.client.post('/api/households/join', {
        token: again.body.token,
        displayName: 'Again',
      });
      expect(twice.status).toBe(409);
    });

    it('lands a returning sign-in back where it left off', async () => {
      const email = uniqueEmail('returning');
      const owner = await registerHousehold({ email, householdName: 'Home' });
      await createHousehold(owner, { name: 'Beach flat', displayName: 'Me' });
      // Last open is the beach flat, since creating one switches to it.
      await owner.client.post(`/api/households/${owner.householdId}/switch`);

      const returning = createClient();
      const signedIn = await returning.post('/api/auth/login', { email, password: 'password123' });
      expect(signedIn.body.household.name).toBe('Home');
      // Never an access decision on its own: the membership still governs.
      expect((await returning.get('/api/expenses')).status).toBe(200);
    });

    it('asks again when the remembered household is gone', async () => {
      const email = uniqueEmail('gone');
      const owner = await registerHousehold({ email, householdName: 'Home' });
      await createHousehold(owner, { name: 'Beach flat', displayName: 'Me' });
      await owner.client.post(`/api/households/${owner.householdId}/switch`);
      await owner.client.delete('/api/household', { password: 'password123' });

      const returning = createClient();
      const signedIn = await returning.post('/api/auth/login', { email, password: 'password123' });
      // One household left, so it opens that rather than asking pointlessly.
      expect(signedIn.body.household.name).toBe('Beach flat');
    });

    it('signs in straight into the only household, and asks when there are two', async () => {
      const email = uniqueEmail('picker');
      const owner = await registerHousehold({ email, householdName: 'Home' });

      const one = createClient();
      expect((await one.post('/api/auth/login', { email, password: 'password123' })).body.household.name)
        .toBe('Home');

      await createHousehold(owner, { name: 'Beach flat', displayName: 'Me' });
      // Forget where they were, so this is genuinely "two, and no preference".
      db.prepare('UPDATE users SET last_household_id = NULL WHERE email = ?').run(email);

      const two = createClient();
      const signedIn = await two.post('/api/auth/login', { email, password: 'password123' });
      expect(signedIn.body.household).toBeNull();
      expect(signedIn.body.households).toHaveLength(2);
      // Nothing is open, so the scoped routes wait for a choice.
      expect((await two.get('/api/expenses')).status).toBe(403);
      expect((await two.post(`/api/households/${owner.householdId}/switch`)).status).toBe(200);
      expect((await two.get('/api/expenses')).status).toBe(200);
    });

    it('drops the open household the moment the membership ends', async () => {
      const owner = await registerHousehold();
      const member = await addMember(owner, 'Yossi');
      expect((await member.client.get('/api/expenses')).status).toBe(200);

      await owner.client.delete(`/api/household/members/${member.userId}`);

      // Their cookie still names the household; the membership behind it is
      // gone, so it counts for nothing on the very next request.
      const me = await member.client.get('/api/auth/me');
      expect(me.body.household).toBeNull();
      expect((await member.client.get('/api/expenses')).status).toBe(403);
    });

    it('closes an account that is in no household at all', async () => {
      // The state a brand new sign-up is in, and the state anybody removed
      // from their only household falls back to. There is no household to
      // administer, so `DELETE /auth/account` is the only way out — the
      // Household page carrying the same button is unreachable from here.
      const account = await registerAccount({ email: uniqueEmail('nowhere') });
      expect((await account.client.get('/api/auth/me')).body.households).toEqual([]);

      const deleted = await account.client.delete('/api/auth/account', { password: 'password123' });
      expect(deleted.status).toBe(204);
      expect((await account.client.get('/api/auth/me')).status).toBe(401);

      const users = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
      expect(users.count).toBe(0);
    });

    it('renames you in one household without touching the other', async () => {
      const home = await registerHousehold({ householdName: 'Home', name: 'Dad' });
      await createHousehold(home, { name: 'Flat share', displayName: 'Dana' });

      expect((await home.client.put('/api/household/me', { displayName: 'D' })).status).toBe(200);
      expect((await home.client.get('/api/auth/me')).body.user.name).toBe('D');

      await home.client.post(`/api/households/${home.householdId}/switch`);
      expect((await home.client.get('/api/auth/me')).body.user.name).toBe('Dad');
    });
  });
});
