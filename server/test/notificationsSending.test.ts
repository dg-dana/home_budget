/**
 * The other half of `notifications.test.ts`: a provider **is** configured, so
 * every route that changes who is in a household — or what a household is —
 * has to tell the right people and nobody else.
 *
 * The environment is set before `config.ts` is ever imported, which is what
 * the top-level `await import` below is for: static imports are hoisted above
 * plain statements, so assigning to `process.env` beside them would happen too
 * late. Requests to the app are real HTTP as everywhere else in this suite —
 * only calls to the provider are intercepted.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.RESEND_API_KEY = 'test-key';
process.env.DOMAIN = 'example.test';

const { addMember, createClient, registerAccount, registerHousehold, resetDatabase, startServer, stopServer, uniqueEmail } =
  await import('./helpers.js');

interface Sent {
  to: string;
  subject: string;
}

let sent: Sent[] = [];

/** Everything sent to `address`, in subject form — the readable assertion. */
const to = (address: string) => sent.filter((message) => message.to === address).map((m) => m.subject);
const recipients = () => sent.map((message) => message.to).sort();

beforeAll(async () => {
  const realFetch = globalThis.fetch;
  // Pass everything through except the provider, so the test client can still
  // talk to the app over a real socket.
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://api.resend.com')) {
      const payload = JSON.parse(String(init?.body));
      for (const address of payload.to) sent.push({ to: address, subject: payload.subject });
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
    }
    return realFetch(input, init);
  });
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

afterEach(() => {
  sent = [];
});

describe('who hears about what', () => {
  it('emails the confirmation link rather than only showing it', async () => {
    const client = createClient();
    const email = uniqueEmail('signup');
    const registered = await client.post('/api/auth/register', { email, password: 'password123' });

    expect(registered.body.verification.delivered).toBe(true);
    expect(to(email)).toEqual(['Confirm your email address']);
  });

  it('tells the owners when somebody joins, and not the joiner', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat' });
    sent = [];

    const member = await addMember(owner, 'Noa');

    expect(to(owner.email)).toEqual(['Noa joined "The Flat"']);
    // Registering sent them a confirmation; joining tells them nothing more,
    // since they are looking at the household they just joined.
    expect(to(member.email)).toEqual(['Confirm your email address']);
  });

  it('tells the removed member and the other owners, but not the owner doing it', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat' });
    const coOwner = await addMember(owner, 'Yossi');
    await owner.client.put(`/api/household/members/${coOwner.userId}/role`, { role: 'owner' });
    const member = await addMember(owner, 'Noa');
    sent = [];

    const removed = await owner.client.delete(`/api/household/members/${member.userId}`);
    expect(removed.status).toBe(204);

    expect(to(member.email)).toEqual(['You were removed from "The Flat"']);
    expect(to(coOwner.email)).toEqual(['Noa left "The Flat"']);
    expect(to(owner.email)).toEqual([]);
  });

  it('tells somebody their role changed, and says nothing when it did not', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat' });
    const member = await addMember(owner, 'Noa');
    sent = [];

    await owner.client.put(`/api/household/members/${member.userId}/role`, { role: 'owner' });
    expect(to(member.email)).toEqual(['You are now an owner of "The Flat"']);

    sent = [];
    await owner.client.put(`/api/household/members/${member.userId}/role`, { role: 'owner' });
    expect(sent).toEqual([]);
  });

  it('tells everyone a household was deleted, the owner who did it included', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat', password: 'password123' });
    const member = await addMember(owner, 'Noa');
    sent = [];

    const deleted = await owner.client.delete('/api/household', { password: 'password123' });
    expect(deleted.status).toBe(204);

    expect(recipients()).toEqual([member.email, owner.email].sort());
    expect(to(member.email)).toEqual(['"The Flat" was deleted']);
  });

  it('tells the other members when the household is renamed, and not when nothing moved', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat', currency: 'EUR' });
    const member = await addMember(owner, 'Noa');
    sent = [];

    await owner.client.put('/api/household', { name: 'The House', currency: 'EUR' });
    expect(to(member.email)).toEqual(['"The Flat" was changed']);
    // The owner made the change; they do not need telling about it.
    expect(to(owner.email)).toEqual([]);

    sent = [];
    await owner.client.put('/api/household', { name: 'The House', currency: 'EUR' });
    expect(sent).toEqual([]);
  });

  it('tells the account and the household when somebody deletes their account', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat' });
    const member = await addMember(owner, 'Noa');
    sent = [];

    const deleted = await member.client.delete('/api/auth/account', { password: 'password123' });
    expect(deleted.status).toBe(204);

    expect(to(member.email)).toEqual(['Your Home Budget account was deleted']);
    expect(to(owner.email)).toEqual(['Noa left "The Flat"']);
  });

  it('says nothing to anyone else when the last person closes their account', async () => {
    const solo = await registerHousehold({ householdName: 'Just Me' });
    sent = [];

    await solo.client.delete('/api/auth/account', { password: 'password123' });

    expect(recipients()).toEqual([solo.email]);
  });

  it('tells the account when its password changes, either way', async () => {
    const owner = await registerHousehold();
    sent = [];

    await owner.client.post('/api/auth/password', {
      currentPassword: 'password123',
      newPassword: 'a-longer-password',
    });
    expect(to(owner.email)).toEqual(['Your Home Budget password was changed']);

    sent = [];
    const issued = await owner.client.post(`/api/household/members/${owner.userId}/reset-password`);
    const stranger = createClient();
    await stranger.post('/api/auth/reset', { token: issued.body.token, password: 'another-password' });

    expect(to(owner.email)).toEqual([
      'Reset your Home Budget password',
      'Your Home Budget password was changed',
    ]);
  });

  it('emails an invite that carries an address, and cannot email one that does not', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat' });
    sent = [];

    const addressed = await owner.client.post('/api/household/invites', {
      email: 'invited@example.test',
      role: 'member',
    });
    expect(addressed.body.notice.delivered).toBe(true);
    expect(to('invited@example.test')).toEqual(['Join The Flat on Home Budget']);

    sent = [];
    const anonymous = await owner.client.post('/api/household/invites', { role: 'member' });
    expect(anonymous.body.notice.delivered).toBe(false);
    expect(sent).toEqual([]);
  });

  it('leaves a household alone when the change is somebody renaming themselves', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat' });
    const member = await addMember(owner, 'Noa');
    sent = [];

    await member.client.put('/api/household/me', { displayName: 'Noa B' });

    expect(sent).toEqual([]);
  });

  it('does not email a second account that shares nothing with the household', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat' });
    const outsider = await registerAccount({ email: uniqueEmail('outsider') });
    sent = [];

    await owner.client.put('/api/household', { name: 'The House', currency: 'USD' });

    expect(to(outsider.email)).toEqual([]);
  });
});
