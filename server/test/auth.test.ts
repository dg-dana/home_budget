import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import {
  createClient,
  getBaseUrl,
  joinHousehold,
  registerAccount,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  uniqueEmail,
} from './helpers.js';

describe('authentication', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);
  beforeEach(() => resetDatabase());

  it('creates a household with seeded categories and signs the owner in', async () => {
    const owner = await registerHousehold({ householdName: 'The Levy family', currency: 'EUR' });

    const me = await owner.client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('owner');
    expect(me.body.household.name).toBe('The Levy family');
    expect(me.body.household.currency).toBe('EUR');

    const categories = await owner.client.get('/api/categories');
    expect(categories.body).toHaveLength(7);
  });

  it('never stores the password in plain text', async () => {
    const owner = await registerHousehold({ password: 'correct horse battery' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(owner.userId) as {
      password_hash: string;
    };
    expect(row.password_hash).not.toContain('correct horse battery');
    expect(row.password_hash.startsWith('$2')).toBe(true);
  });

  it('rejects a duplicate email', async () => {
    const email = uniqueEmail();
    await registerHousehold({ email });

    const second = await createClient().post('/api/auth/register', {
      householdName: 'Another',
      name: 'Someone',
      email,
      password: 'password123',
    });
    expect(second.status).toBe(409);
  });

  it('rejects a short password and a malformed email', async () => {
    const short = await createClient().post('/api/auth/register', {
      householdName: 'Home',
      name: 'A',
      email: uniqueEmail(),
      password: 'short',
    });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/8 characters/);

    const badEmail = await createClient().post('/api/auth/register', {
      householdName: 'Home',
      name: 'A',
      email: 'not-an-email',
      password: 'password123',
    });
    expect(badEmail.status).toBe(400);
  });

  it('normalises the email so sign-in is case insensitive', async () => {
    const email = uniqueEmail();
    await registerHousehold({ email: email.toUpperCase() });

    const client = createClient();
    const login = await client.post('/api/auth/login', { email, password: 'password123' });
    expect(login.status).toBe(200);
  });

  it('gives the same error for an unknown email and a wrong password', async () => {
    const owner = await registerHousehold();

    const wrongPassword = await createClient().post('/api/auth/login', {
      email: owner.email,
      password: 'not-the-password',
    });
    const unknownEmail = await createClient().post('/api/auth/login', {
      email: uniqueEmail('nobody'),
      password: 'not-the-password',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Identical, so the endpoint cannot be used to discover who has an account.
    expect(wrongPassword.body.error).toBe(unknownEmail.body.error);
  });

  it('requires a session for protected routes and drops it on logout', async () => {
    const anonymous = createClient();
    expect((await anonymous.get('/api/auth/me')).status).toBe(401);

    const owner = await registerHousehold();
    expect((await owner.client.get('/api/auth/me')).status).toBe(200);

    await owner.client.post('/api/auth/logout');
    expect((await owner.client.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects forged and tampered session cookies', async () => {
    const owner = await registerHousehold();

    // A JWT signed with the wrong key, one that is simply not a JWT, and a
    // real token with its signature swapped for someone else's.
    const wrongSignature = jwt.sign({ sub: owner.userId }, 'a-different-secret');
    const forgeries = [wrongSignature, 'not-a-jwt-at-all', `${wrongSignature}.extra`, ''];

    for (const forgery of forgeries) {
      const response = await fetch(`${getBaseUrl()}/api/auth/me`, {
        headers: { cookie: `hb_session=${forgery}` },
      });
      expect(response.status, `cookie "${forgery.slice(0, 20)}" should be rejected`).toBe(401);
    }
  });

  it('does not accept an expired session token', async () => {
    const owner = await registerHousehold();
    const expired = jwt.sign({ sub: owner.userId }, 'test-secret-not-used-anywhere-real', {
      expiresIn: -60,
    });
    const response = await fetch(`${getBaseUrl()}/api/auth/me`, {
      headers: { cookie: `hb_session=${expired}` },
    });
    expect(response.status).toBe(401);
  });

  it('stops honouring the session as soon as the user row is gone', async () => {
    const owner = await registerHousehold();
    expect((await owner.client.get('/api/auth/me')).status).toBe(200);

    // The JWT is still valid and unexpired; the user simply no longer exists.
    db.prepare('DELETE FROM users WHERE id = ?').run(owner.userId);
    expect((await owner.client.get('/api/auth/me')).status).toBe(401);
  });

  it('returns 404 for an unknown API route', async () => {
    const response = await createClient().get('/api/not-a-real-endpoint');
    expect(response.status).toBe(404);
  });
});

describe('invites', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);
  beforeEach(() => resetDatabase());

  it('lets an invited person join and see the household data', async () => {
    const owner = await registerHousehold({ householdName: 'The Cohens' });
    await owner.client.post('/api/expenses', { amount: 30, description: 'Shared', spentOn: '2026-05-02' });

    const invite = await owner.client.post('/api/household/invites', { role: 'member' });
    expect(invite.status).toBe(201);

    const preview = await createClient().get(`/api/auth/invite/${invite.body.token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.householdName).toBe('The Cohens');

    // Joining is something an account does, so the invited person registers
    // first and arrives here signed in.
    const joiner = await registerAccount({ email: uniqueEmail('yossi') });
    const joined = await joinHousehold(joiner, invite.body.token, 'Yossi');
    expect(joined.status).toBe(201);
    expect(joined.body.household.role).toBe('member');
    expect(joined.body.household.id).toBe(owner.householdId);
    expect(joined.body.household.displayName).toBe('Yossi');

    const expenses = await joiner.client.get('/api/expenses?month=2026-05');
    expect(expenses.body).toHaveLength(1);
    expect(expenses.body[0].description).toBe('Shared');
  });

  it('burns the invite after one use', async () => {
    const owner = await registerHousehold();
    const invite = await owner.client.post('/api/household/invites', { role: 'member' });

    const first = await joinHousehold(await registerAccount(), invite.body.token, 'First');
    expect(first.status).toBe(201);

    const second = await joinHousehold(await registerAccount(), invite.body.token, 'Second');
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/invalid or has expired/i);

    // And it disappears from the pending list.
    expect((await owner.client.get('/api/household/invites')).body).toHaveLength(0);
  });

  it('refuses an expired invite', async () => {
    const owner = await registerHousehold();
    const invite = await owner.client.post('/api/household/invites', { role: 'member' });
    db.prepare('UPDATE invites SET expires_at = ? WHERE token = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      invite.body.token,
    );

    expect((await createClient().get(`/api/auth/invite/${invite.body.token}`)).status).toBe(400);
    const joined = await joinHousehold(await registerAccount(), invite.body.token, 'Late');
    expect(joined.status).toBe(400);
  });

  it('pins an invite to the email it was addressed to', async () => {
    const owner = await registerHousehold();
    const invited = uniqueEmail('invited');
    const invite = await owner.client.post('/api/household/invites', { email: invited });

    // The pin is now checked against the signed-in account's address, which is
    // a stronger promise than before: that address has been confirmed.
    const wrongPerson = await registerAccount({ email: uniqueEmail('other') });
    const refused = await joinHousehold(wrongPerson, invite.body.token, 'Impostor');
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain(invited);

    const rightPerson = await registerAccount({ email: invited });
    expect((await joinHousehold(rightPerson, invite.body.token, 'Invited')).status).toBe(201);
  });

  it('kills a revoked invite', async () => {
    const owner = await registerHousehold();
    const invite = await owner.client.post('/api/household/invites', { role: 'member' });
    await owner.client.delete(`/api/household/invites/${invite.body.token}`);

    const joined = await joinHousehold(await registerAccount(), invite.body.token, 'Revoked');
    expect(joined.status).toBe(400);
  });

  it('rejects an unknown invite token', async () => {
    expect((await createClient().get('/api/auth/invite/nope')).status).toBe(400);
  });
});
