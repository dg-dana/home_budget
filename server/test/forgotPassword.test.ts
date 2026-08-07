/**
 * Self-service recovery: `POST /auth/forgot`.
 *
 * A provider **is** configured here, because the route refuses to work without
 * one — the link may never be put on screen, so with nothing able to send it
 * there is nowhere for it to go. The environment is therefore set before
 * `config.ts` is ever imported, which is what the top-level `await import`
 * below is for: static imports are hoisted above plain statements, so assigning
 * to `process.env` beside them would happen too late. (`password.test.ts` holds
 * the opposite case, where no provider is configured.)
 *
 * Requests to the app are real HTTP as everywhere else; only calls to the
 * provider are intercepted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.RESEND_API_KEY = 'test-key';
process.env.DOMAIN = 'example.test';

const { db } = await import('../src/db.js');
const {
  addMember,
  createClient,
  registerAccount,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  uniqueEmail,
} = await import('./helpers.js');

const NEW_PASSWORD = 'a-much-better-password';

interface Sent {
  to: string;
  subject: string;
  text: string;
}

let sent: Sent[] = [];

const to = (address: string) => sent.filter((message) => message.to === address);

/** The token out of the emailed link — the copy the person actually receives. */
function tokenFromEmail(address: string): string {
  const messages = to(address);
  const link = messages.at(-1)?.text.match(/https:\/\/example\.test\/reset\/(\S+)/);
  if (!link) throw new Error(`no reset link emailed to ${address}: ${JSON.stringify(messages)}`);
  return link[1]!;
}

const interceptProvider = () => {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://api.resend.com')) {
      const payload = JSON.parse(String(init?.body));
      for (const address of payload.to) {
        sent.push({ to: address, subject: payload.subject, text: payload.text });
      }
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
    }
    return realFetch(input, init);
  });
};

describe('asking for your own recovery link', () => {
  beforeAll(async () => {
    interceptProvider();
    await startServer({ enableRateLimits: false });
  });

  afterAll(async () => {
    await stopServer();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetDatabase();
    sent = [];
  });

  const forgot = (email: string) => createClient().post('/api/auth/forgot', { email });

  it('emails a link that sets a new password and signs the person in', async () => {
    const owner = await registerHousehold({ householdName: 'The Cohens' });
    sent = [];

    const asked = await forgot(owner.email);
    expect(asked.status).toBe(202);
    expect(to(owner.email).map((m) => m.subject)).toEqual(['Reset your Home Budget password']);

    // The link out of the message, not out of the database: what is emailed is
    // the only copy this flow ever produces.
    const lockedOut = createClient();
    const redeemed = await lockedOut.post('/api/auth/reset', {
      token: tokenFromEmail(owner.email),
      password: NEW_PASSWORD,
    });
    expect(redeemed.status).toBe(201);
    expect(redeemed.body.user.id).toBe(owner.userId);
    expect((await lockedOut.get('/api/auth/me')).status).toBe(200);
    expect(
      (await createClient().post('/api/auth/login', {
        email: owner.email,
        password: NEW_PASSWORD,
      })).status,
    ).toBe(200);
  });

  it('answers an address with no account exactly as it answers one with', async () => {
    const owner = await registerHousehold();
    sent = [];

    const known = await forgot(owner.email);
    const unknown = await forgot('nobody-at-all@example.com');

    // Same status, same body. Anything that differs — a 404, a "no account
    // here", an extra field — turns this route into a way to find out who has
    // an account.
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    // And nothing is sent to an address nobody registered.
    expect(to('nobody-at-all@example.com')).toEqual([]);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM password_resets').get() as { n: number }).n,
    ).toBe(1);
  });

  it('never puts the link in the response', async () => {
    const owner = await registerHousehold();
    const asked = await forgot(owner.email);

    // Everywhere else an unconfigured deployment falls back to showing the
    // link; here that would hand anybody a way into any account by typing its
    // address, so the response carries nothing but an acknowledgement.
    expect(asked.body).toEqual({ ok: true });
    expect(JSON.stringify(asked.body)).not.toContain(tokenFromEmail(owner.email));
  });

  it('retires an owner-issued link, and an earlier one of its own', async () => {
    const owner = await registerHousehold();
    const member = await addMember(owner, 'Yossi');
    const issued = await owner.client.post(`/api/household/members/${member.userId}/reset-password`);
    sent = [];

    await forgot(member.email);
    const first = tokenFromEmail(member.email);
    await forgot(member.email);
    const second = tokenFromEmail(member.email);
    expect(second).not.toBe(first);

    // Only the newest link works, whoever asked for it.
    for (const dead of [issued.body.token, first]) {
      expect(
        (await createClient().post('/api/auth/reset', { token: dead, password: NEW_PASSWORD }))
          .status,
      ).toBe(400);
    }
    expect(
      (await createClient().post('/api/auth/reset', { token: second, password: NEW_PASSWORD }))
        .status,
    ).toBe(201);
  });

  it('finds the account however the address was typed', async () => {
    const owner = await registerHousehold({ email: uniqueEmail('mixedcase') });
    sent = [];

    const asked = await forgot(`  ${owner.email.toUpperCase()} `);
    expect(asked.status).toBe(202);
    expect(to(owner.email).map((m) => m.subject)).toEqual(['Reset your Home Budget password']);
  });

  it('serves an account whose address is not confirmed', async () => {
    // Holding a link sent to an inbox is the same proof confirming an address
    // asks for, so refusing here would strand the people most likely to be
    // stuck — the ones who never got the first message either.
    const unconfirmed = await registerAccount({ email: uniqueEmail('pending'), verify: false });
    sent = [];

    expect((await forgot(unconfirmed.email)).status).toBe(202);
    const redeemed = await createClient().post('/api/auth/reset', {
      token: tokenFromEmail(unconfirmed.email),
      password: NEW_PASSWORD,
    });
    expect(redeemed.status).toBe(201);
  });

  it('needs no session, and works for an account with no household', async () => {
    const account = await registerAccount({ email: uniqueEmail('homeless') });
    sent = [];

    expect((await forgot(account.email)).status).toBe(202);
    const redeemed = await createClient().post('/api/auth/reset', {
      token: tokenFromEmail(account.email),
      password: NEW_PASSWORD,
    });
    expect(redeemed.status).toBe(201);
    expect(redeemed.body.household).toBeNull();
  });

  it('rejects something that is not an address at all', async () => {
    const response = await createClient().post('/api/auth/forgot', { email: 'not-an-address' });
    expect(response.status).toBe(400);
    expect(sent).toEqual([]);
  });
});

describe('the per-address limit on asking', () => {
  beforeAll(async () => {
    interceptProvider();
    // The only place in the suite that wants the limiter on: this route sends
    // mail to somebody who did not ask for it, so the budget is the feature.
    await startServer({ enableRateLimits: true });
  });

  afterAll(async () => {
    await stopServer();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetDatabase();
    sent = [];
  });

  it('stops after five requests for one address, and leaves other addresses alone', async () => {
    const target = await registerHousehold({ email: uniqueEmail('flooded') });
    const other = await registerHousehold({ email: uniqueEmail('bystander') });
    sent = [];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await createClient().post('/api/auth/forgot', { email: target.email })).status).toBe(
        202,
      );
    }

    // A fresh client is a fresh cookie jar, not a fresh IP — but the point of
    // this limiter is that changing IP would not help either. The bucket is
    // the address.
    const sixth = await createClient().post('/api/auth/forgot', { email: target.email });
    expect(sixth.status).toBe(429);
    expect(to(target.email)).toHaveLength(5);

    // Somebody else asking is unaffected, which a purely per-IP budget could
    // not promise on a shared connection.
    expect((await createClient().post('/api/auth/forgot', { email: other.email })).status).toBe(202);
  });
});
