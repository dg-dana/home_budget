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
  /** Kept for the one case that needs a link out of the message itself. */
  text: string;
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
      for (const address of payload.to) {
        sent.push({ to: address, subject: payload.subject, text: payload.text });
      }
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

/**
 * The language a message goes out in is a property of **the person receiving
 * it**, not of the request that caused it. These are the cases that prove it:
 * one household, two languages, one action.
 */
describe('what language it goes out in', () => {
  it('confirms a sign-up in the language the sign-up was made in', async () => {
    const client = createClient();
    const email = uniqueEmail('anmeldung');
    const registered = await client.post('/api/auth/register', {
      email,
      password: 'password123',
      language: 'de',
    });

    expect(registered.status).toBe(201);
    expect(to(email)).toEqual(['Bestätige deine E-Mail-Adresse']);
  });

  it('is English when the client says nothing, which is every old build', async () => {
    const client = createClient();
    const email = uniqueEmail('silent');
    await client.post('/api/auth/register', { email, password: 'password123' });

    expect(to(email)).toEqual(['Confirm your email address']);
  });

  it('writes to each member of one household in their own language', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat' });
    const english = await addMember(owner, 'Noa');
    const german = await addMember(owner, 'Jonas', { language: 'de' });
    sent = [];

    // One action, three people, two languages. The owner did it, so hears
    // nothing; the other two hear the same fact in different words.
    const renamed = await owner.client.put('/api/household', {
      name: 'The Old Flat',
      currency: 'USD',
    });
    expect(renamed.status).toBe(200);

    expect(to(english.email)).toEqual(['"The Flat" was changed']);
    expect(to(german.email)).toEqual(['„The Flat“ wurde geändert']);
    expect(to(owner.email)).toEqual([]);
  });

  it('follows the account when it changes its mind', async () => {
    const owner = await registerHousehold();
    const member = await addMember(owner, 'Noa');

    const changed = await member.client.put('/api/auth/preferences', { language: 'de', theme: 'system' });
    expect(changed.status).toBe(204);
    sent = [];

    await owner.client.put(`/api/household/members/${member.userId}/role`, { role: 'owner' });

    expect(to(member.email)).toEqual(['Du bist jetzt Eigentümer von „Test Household“']);
  });

  it('writes an invite in the inviting owner\'s language when the address is a stranger', async () => {
    const owner = await registerHousehold({ householdName: 'Die Wohnung' });
    await owner.client.put('/api/auth/preferences', { language: 'de', theme: 'system' });
    sent = [];

    const stranger = uniqueEmail('fremd');
    const invited = await owner.client.post('/api/household/invites', {
      email: stranger,
      role: 'member',
    });
    expect(invited.status).toBe(201);

    // Nobody has an account at that address yet, so there is no stored choice
    // to read. The owner is the one person who knows who they are writing to.
    expect(to(stranger)).toEqual(['Tritt Die Wohnung bei Home Budget bei']);
  });

  it("prefers an existing account's own choice over the inviter's", async () => {
    const owner = await registerHousehold({ householdName: 'Die Wohnung' });
    await owner.client.put('/api/auth/preferences', { language: 'de', theme: 'system' });
    // Already has an account, and reads English. Their choice, not the owner's.
    const existing = await registerAccount({ email: uniqueEmail('english') });
    sent = [];

    await owner.client.post('/api/household/invites', {
      email: existing.email,
      role: 'member',
    });

    expect(to(existing.email)).toEqual(['Join Die Wohnung on Home Budget']);
  });
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

  it('tells the owners when somebody leaves, and not the person leaving', async () => {
    const owner = await registerHousehold({ householdName: 'The Flat' });
    const member = await addMember(owner, 'Noa');
    sent = [];

    expect((await member.client.delete('/api/household/members/me')).status).toBe(204);

    // The household hears the same fact as a removal, so it is the same
    // notice. Nothing goes back to the person who walked out — they know.
    expect(to(owner.email)).toEqual(['Noa left "The Flat"']);
    expect(to(member.email)).toEqual([]);
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
    // A provider is configured here, so recovery is the account's own doing —
    // the owner-issued route is refused on a deployment that can email
    // (`ARCHITECTURE.md` §4). The reset link is only ever in the message, so
    // the token comes out of what was sent.
    await createClient().post('/api/auth/forgot', { email: owner.email });
    const token = sent.at(-1)!.text.match(/\/reset\/(\S+)/)![1]!;
    await createClient().post('/api/auth/reset', { token, password: 'another-password' });

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
