import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, registerAccount, resetDatabase, startServer, stopServer, uniqueEmail } from './helpers.js';

/**
 * Sending, and — more importantly — not sending.
 *
 * The suite must never make a real request, so `fetch` is stubbed throughout.
 * `config.ts` reads the environment once at import, so each case sets the
 * variables it wants and re-imports the module behind `vi.resetModules()`.
 */

const MAIL_ENV = ['RESEND_API_KEY', 'MAIL_FROM', 'APP_URL', 'DOMAIN'] as const;

async function loadNotifications(env: Partial<Record<(typeof MAIL_ENV)[number], string>>) {
  for (const key of MAIL_ENV) delete process.env[key];
  Object.assign(process.env, env);
  vi.resetModules();
  return import('../src/notifications.js');
}

/** A stub standing in for a provider that accepts everything. */
function acceptingFetch() {
  return vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }),
  );
}

const payloadOf = (init: RequestInit) => JSON.parse(init.body as string);

/** The recipient most of these cases are about: one address, reading English. */
const EN = { email: 'someone@example.test', language: 'en' } as const;

describe('notifications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of MAIL_ENV) delete process.env[key];
    vi.resetModules();
  });

  it('sends nothing when no provider is configured, and says so', async () => {
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { verifyEmailNotice } = await loadNotifications({ APP_URL: 'https://example.test' });
    const notice = await verifyEmailNotice(EN, '/verify/tok');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(notice.delivered).toBe(false);
    // The link is still the caller's to show — it is the only copy there is.
    expect(notice.link).toBe('/verify/tok');
  });

  it('posts to Resend when a key is configured', async () => {
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { verifyEmailNotice } = await loadNotifications({
      RESEND_API_KEY: 'test-key',
      MAIL_FROM: 'Home Budget <noreply@example.test>',
      APP_URL: 'https://example.test',
    });
    const notice = await verifyEmailNotice(EN, '/verify/tok');

    expect(notice.delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');

    const payload = payloadOf(init);
    expect(payload.from).toBe('Home Budget <noreply@example.test>');
    expect(payload.to).toEqual(['someone@example.test']);
    expect(payload.subject).toBe('Confirm your email address');
    // Relative links are useless in an inbox: APP_URL is what makes them real.
    expect(payload.text).toContain('https://example.test/verify/tok');
  });

  it('derives the sending address and the link base from DOMAIN', async () => {
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { verifyEmailNotice } = await loadNotifications({
      RESEND_API_KEY: 'test-key',
      DOMAIN: 'example.test',
    });
    await verifyEmailNotice(EN, '/verify/tok');

    const payload = payloadOf(fetchMock.mock.calls[0]![1]);
    expect(payload.from).toBe('Home Budget <noreply@example.test>');
    expect(payload.text).toContain('https://example.test/verify/tok');
  });

  it('does not send a link it cannot make absolute', async () => {
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { verifyEmailNotice } = await loadNotifications({
      RESEND_API_KEY: 'test-key',
      MAIL_FROM: 'Home Budget <noreply@example.test>',
    });
    const notice = await verifyEmailNotice(EN, '/verify/tok');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(notice.delivered).toBe(false);
  });

  it('writes the message in the recipient\'s language, link and all', async () => {
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { verifyEmailNotice } = await loadNotifications({
      RESEND_API_KEY: 'test-key',
      DOMAIN: 'example.test',
    });
    const notice = await verifyEmailNotice(
      { email: 'jemand@example.test', language: 'de' },
      '/verify/tok',
    );

    const payload = payloadOf(fetchMock.mock.calls[0]![1]);
    expect(payload.subject).toBe('Bestätige deine E-Mail-Adresse');
    expect(payload.text).toContain('Bestätige deine Adresse');
    // The link is appended the same way in either language — it is a URL, not
    // a sentence, and `APP_URL` does not know about any of this.
    expect(payload.text).toContain('https://example.test/verify/tok');
    expect(notice.language).toBe('de');
  });

  it('has nobody to email when an invite carries no address', async () => {
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { inviteNotice } = await loadNotifications({
      RESEND_API_KEY: 'test-key',
      DOMAIN: 'example.test',
    });
    const notice = await inviteNotice({ email: '', language: 'en' }, 'The Flat', '/join/tok');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(notice.delivered).toBe(false);
  });

  it('degrades to the link when the provider refuses', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 422 }));
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { passwordResetNotice } = await loadNotifications({
      RESEND_API_KEY: 'expired-key',
      DOMAIN: 'example.test',
    });
    const notice = await passwordResetNotice(EN, '/reset/tok');

    expect(notice.delivered).toBe(false);
    expect(notice.link).toBe('/reset/tok');
    expect(warn).toHaveBeenCalled();
    // Whatever it logs, it is not the link — that would be a credential in the
    // deploy logs.
    expect(warn.mock.calls.flat().join(' ')).not.toContain('/reset/tok');
    warn.mockRestore();
  });

  it('degrades to the link when the request itself fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { householdCreatedNotice } = await loadNotifications({
      RESEND_API_KEY: 'test-key',
      DOMAIN: 'example.test',
    });
    const notice = await householdCreatedNotice(EN, 'The Flat');

    expect(notice.delivered).toBe(false);
    warn.mockRestore();
  });
});

/**
 * The same guarantee from the outside: with no provider — which is how the
 * suite and local development run — every flow still hands back its link.
 */
describe('notices over HTTP with no provider', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);
  beforeEach(resetDatabase);

  it('returns the confirmation link on registration', async () => {
    const client = createClient();
    const registered = await client.post('/api/auth/register', {
      email: uniqueEmail('notice'),
      password: 'correct-horse-battery',
    });

    expect(registered.status).toBe(201);
    expect(registered.body.verification.delivered).toBe(false);
    expect(registered.body.verification.link).toMatch(/^\/verify\//);
  });

  it('returns the invite link, and the reset link, to the owner', async () => {
    const owner = await registerAccount({ email: uniqueEmail('owner') });
    const created = await owner.client.post('/api/households', {
      name: 'The Flat',
      currency: 'EUR',
      displayName: 'Owner',
    });
    expect(created.status).toBe(201);
    expect(created.body.notice.delivered).toBe(false);

    const invite = await owner.client.post('/api/household/invites', {
      email: 'invited@example.test',
      role: 'member',
    });
    expect(invite.status).toBe(201);
    expect(invite.body.token).toBeTruthy();
    expect(invite.body.notice.delivered).toBe(false);
    expect(invite.body.notice.link).toBe(`/join/${invite.body.token}`);

    const reset = await owner.client.post(
      `/api/household/members/${owner.userId}/reset-password`,
    );
    expect(reset.status).toBe(201);
    expect(reset.body.notice.delivered).toBe(false);
    expect(reset.body.notice.link).toBe(`/reset/${reset.body.token}`);
  });
});
