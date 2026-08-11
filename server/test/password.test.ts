import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import {
  addMember,
  createClient,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  type Client,
  type Household,
} from './helpers.js';

const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-much-better-password';

/** Signs in as an existing account on a brand new client (i.e. another device). */
async function signIn(email: string, password: string): Promise<Client> {
  const client = createClient();
  const response = await client.post('/api/auth/login', { email, password });
  if (response.status !== 200) {
    throw new Error(`login failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return client;
}

describe('changing your own password', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold();
  });

  it('replaces the password and lets the new one sign in', async () => {
    const response = await owner.client.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(204);

    const withNew = await createClient().post('/api/auth/login', {
      email: owner.email,
      password: NEW_PASSWORD,
    });
    expect(withNew.status).toBe(200);

    const withOld = await createClient().post('/api/auth/login', {
      email: owner.email,
      password: PASSWORD,
    });
    expect(withOld.status).toBe(401);
  });

  it('keeps the changing device signed in', async () => {
    await owner.client.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    // The response re-issues a cookie, so this session survives its own change.
    expect((await owner.client.get('/api/auth/me')).status).toBe(200);
  });

  it('signs every other device out', async () => {
    const otherDevice = await signIn(owner.email, PASSWORD);
    expect((await otherDevice.get('/api/auth/me')).status).toBe(200);

    await owner.client.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    // This is the point of the cutoff: a stolen cookie stops working the
    // moment the password is changed, rather than lingering until it expires.
    expect((await otherDevice.get('/api/auth/me')).status).toBe(401);
    expect((await otherDevice.get('/api/expenses')).status).toBe(401);
  });

  it('refuses without the correct current password', async () => {
    const response = await owner.client.post('/api/auth/password', {
      currentPassword: 'not-my-password',
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/current password/i);

    // Nothing changed.
    expect(
      (await createClient().post('/api/auth/login', { email: owner.email, password: PASSWORD }))
        .status,
    ).toBe(200);
  });

  it('rejects a new password that is too short', async () => {
    const response = await owner.client.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'short',
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('error.passwordTooShort');
  });

  it('requires a session', async () => {
    const response = await createClient().post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(401);
  });
});

describe('owner-issued password recovery, where nothing can send email', () => {
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

  const issueReset = (userId: string) =>
    owner.client.post(`/api/household/members/${userId}/reset-password`);

  it('lets a locked-out member set a new password and land signed in', async () => {
    const issued = await issueReset(member.userId);
    expect(issued.status).toBe(201);

    // The link is followed by someone with no session at all.
    const lockedOut = createClient();
    const preview = await lockedOut.get(`/api/auth/reset/${issued.body.token}`);
    expect(preview.status).toBe(200);
    // A name belongs to a household; a reset link is about the account, so the
    // address is what identifies the person here.
    expect(preview.body.email).toBe(member.email);

    const redeemed = await lockedOut.post('/api/auth/reset', {
      token: issued.body.token,
      password: NEW_PASSWORD,
    });
    expect(redeemed.status).toBe(201);
    expect(redeemed.body.user.id).toBe(member.userId);

    // Signed in, and the new password works from a fresh device.
    expect((await lockedOut.get('/api/auth/me')).status).toBe(200);
    expect(
      (await createClient().post('/api/auth/login', {
        email: member.email,
        password: NEW_PASSWORD,
      })).status,
    ).toBe(200);
  });

  it('leaks nothing beyond the person being recovered', async () => {
    const issued = await issueReset(member.userId);
    const preview = await createClient().get(`/api/auth/reset/${issued.body.token}`);

    expect(Object.keys(preview.body).sort()).toEqual(['email']);
    expect(JSON.stringify(preview.body)).not.toContain('The Cohens');
    expect(JSON.stringify(preview.body)).not.toContain(owner.householdId);
  });

  it('invalidates the old sessions of the account it recovers', async () => {
    expect((await member.client.get('/api/auth/me')).status).toBe(200);

    const issued = await issueReset(member.userId);
    await createClient().post('/api/auth/reset', {
      token: issued.body.token,
      password: NEW_PASSWORD,
    });

    expect((await member.client.get('/api/auth/me')).status).toBe(401);
    // The owner is untouched.
    expect((await owner.client.get('/api/auth/me')).status).toBe(200);
  });

  it('burns the link after one use', async () => {
    const issued = await issueReset(member.userId);
    await createClient().post('/api/auth/reset', {
      token: issued.body.token,
      password: NEW_PASSWORD,
    });

    const second = await createClient().post('/api/auth/reset', {
      token: issued.body.token,
      password: 'yet-another-password',
    });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/invalid or has expired/i);
  });

  it('retires an earlier link when a new one is issued', async () => {
    const first = await issueReset(member.userId);
    const second = await issueReset(member.userId);
    expect(second.body.token).not.toBe(first.body.token);

    expect(
      (await createClient().post('/api/auth/reset', {
        token: first.body.token,
        password: NEW_PASSWORD,
      })).status,
    ).toBe(400);
    expect(
      (await createClient().post('/api/auth/reset', {
        token: second.body.token,
        password: NEW_PASSWORD,
      })).status,
    ).toBe(201);
  });

  it('refuses an expired link', async () => {
    const issued = await issueReset(member.userId);
    db.prepare('UPDATE password_resets SET expires_at = ? WHERE token = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      issued.body.token,
    );

    expect((await createClient().get(`/api/auth/reset/${issued.body.token}`)).status).toBe(400);
    expect(
      (await createClient().post('/api/auth/reset', {
        token: issued.body.token,
        password: NEW_PASSWORD,
      })).status,
    ).toBe(400);
  });

  it('refuses an unknown token', async () => {
    expect((await createClient().get('/api/auth/reset/nope')).status).toBe(400);
    expect(
      (await createClient().post('/api/auth/reset', { token: 'nope', password: NEW_PASSWORD }))
        .status,
    ).toBe(400);
  });

  it('rejects a too-short password at redemption', async () => {
    const issued = await issueReset(member.userId);
    const response = await createClient().post('/api/auth/reset', {
      token: issued.body.token,
      password: 'short',
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('error.passwordTooShort');
  });

  it('is owner-only', async () => {
    const response = await member.client.post(
      `/api/household/members/${owner.userId}/reset-password`,
    );
    expect(response.status).toBe(403);
  });

  it('cannot target a member of another household', async () => {
    const stranger = await registerHousehold();
    const response = await stranger.client.post(
      `/api/household/members/${member.userId}/reset-password`,
    );
    expect(response.status).toBe(404);
    // The member's session is untouched.
    expect((await member.client.get('/api/auth/me')).status).toBe(200);
  });

  it('lets the owner recover their own account', async () => {
    const issued = await issueReset(owner.userId);
    const redeemed = await createClient().post('/api/auth/reset', {
      token: issued.body.token,
      password: NEW_PASSWORD,
    });
    expect(redeemed.status).toBe(201);
    expect(redeemed.body.household.role).toBe('owner');
  });

  it('drops outstanding links when the member is removed', async () => {
    const issued = await issueReset(member.userId);
    await owner.client.delete(`/api/household/members/${member.userId}`);

    // The account survives being removed from a household now, so this is an
    // explicit retirement rather than a cascade: otherwise an owner could mint
    // a link, remove the person, and redeem it to take over an account that
    // may belong to other households.
    expect(
      (await createClient().post('/api/auth/reset', {
        token: issued.body.token,
        password: NEW_PASSWORD,
      })).status,
    ).toBe(400);
  });

  it('survives here precisely because nothing else can get anybody back in', async () => {
    // The route is refused on a deployment that can email (see
    // `forgotPassword.test.ts`). This file configures no provider, which is the
    // one case where refusing here too would leave a locked-out member with no
    // way back in at all — so it works, and the frontend is told to render the
    // button.
    expect((await owner.client.get('/api/auth/me')).body.ownerRecovery).toBe(true);
    expect((await issueReset(member.userId)).status).toBe(201);
  });

  it('is the only recovery there is when nothing can send email', async () => {
    // No provider is configured in this file, which is the state the suite and
    // any local run are in. Self-service recovery refuses outright rather than
    // showing the link the way every other flow does: printing it would hand
    // anybody a way into any account by typing its address (`forgotPassword.test.ts`
    // holds the configured half).
    const response = await createClient().post('/api/auth/forgot', { email: member.email });
    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/household owner/i);
    expect(JSON.stringify(response.body)).not.toMatch(/token|reset\//);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM password_resets').get() as { n: number }).n,
    ).toBe(0);

    // The owner-issued route is untouched and still works.
    expect((await issueReset(member.userId)).status).toBe(201);
  });

  it('drops outstanding links when the member leaves of their own accord', async () => {
    const issued = await issueReset(member.userId);
    expect((await member.client.delete('/api/household/members/me')).status).toBe(204);

    // The door has to shut from this side too: an owner who minted a link an
    // hour ago must not still be holding a key to an account that has walked
    // out — it may belong to households they have never heard of.
    expect(
      (await createClient().post('/api/auth/reset', {
        token: issued.body.token,
        password: NEW_PASSWORD,
      })).status,
    ).toBe(400);
  });
});
