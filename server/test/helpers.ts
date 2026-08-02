import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, type CreateAppOptions } from '../src/app.js';
import { db } from '../src/db.js';

export interface Response<T = any> {
  status: number;
  body: T;
}

/**
 * A tiny HTTP client that remembers cookies, so a session survives across
 * calls the way it does in a browser. Each `createClient()` is an independent
 * "person" — a member, a second household's owner, or a guest with no cookies
 * at all.
 */
export interface Client {
  get<T = any>(path: string): Promise<Response<T>>;
  post<T = any>(path: string, body?: unknown): Promise<Response<T>>;
  put<T = any>(path: string, body?: unknown): Promise<Response<T>>;
  patch<T = any>(path: string, body?: unknown): Promise<Response<T>>;
  delete<T = any>(path: string, body?: unknown): Promise<Response<T>>;
  cookies(): string;
}

let server: Server | undefined;
let baseUrl = '';

/** Starts the app on an ephemeral port. Call once per test file. */
export async function startServer(options?: CreateAppOptions): Promise<string> {
  await stopServer();
  server = createApp(options).listen(0);
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', () => resolve());
    server!.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return baseUrl;
}

/** Base URL of the running test server, for requests the Client cannot express. */
export const getBaseUrl = () => baseUrl;

export async function stopServer(): Promise<void> {
  if (!server) return;
  const closing = server;
  server = undefined;
  await new Promise<void>((resolve) => closing.close(() => resolve()));
}

/** Wipes every table. Order matters only for readability; FKs cascade anyway. */
export function resetDatabase(): void {
  for (const table of [
    'shopping_items',
    'shopping_lists',
    'expenses',
    'recurring_expenses',
    'categories',
    'invites',
    'password_resets',
    'email_verifications',
    'memberships',
    'users',
    'households',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
}

export function createClient(): Client {
  const jar = new Map<string, string>();

  const send = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size > 0) {
      headers.cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const index = pair.indexOf('=');
      if (index === -1) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      // An expired cookie (logout) clears the entry rather than storing "".
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }

    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  return {
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body ?? {}),
    put: (path, body) => send('PUT', path, body),
    patch: (path, body) => send('PATCH', path, body),
    delete: (path, body) => send('DELETE', path, body),
    cookies: () => [...jar.keys()].join(','),
  };
}

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}-${++counter}-${Date.now()}@example.com`;

export interface Account {
  client: Client;
  userId: string;
  email: string;
}

export interface Household extends Account {
  householdId: string;
}

const tokenFromLink = (link: string) => link.split('/').pop()!;

/**
 * Registers an account and confirms its address — the two steps that now come
 * before anybody can have a household at all. Leaves the client signed in with
 * no household selected.
 */
export async function registerAccount(
  overrides: Partial<{ email: string; password: string; verify: boolean }> = {},
): Promise<Account> {
  const client = createClient();
  const email = overrides.email ?? uniqueEmail('account');
  const registered = await client.post('/api/auth/register', {
    email,
    password: overrides.password ?? 'password123',
  });
  if (registered.status !== 201) {
    throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`);
  }

  if (overrides.verify !== false) {
    const verified = await client.post('/api/auth/verify', {
      token: tokenFromLink(registered.body.verification.link),
    });
    if (verified.status !== 200) {
      throw new Error(`verify failed: ${verified.status} ${JSON.stringify(verified.body)}`);
    }
  }

  return { client, userId: registered.body.user.id, email };
}

/** Registers an account, confirms it, and gives it a household to own. */
export async function registerHousehold(overrides: Partial<{
  householdName: string;
  currency: string;
  name: string;
  email: string;
  password: string;
}> = {}): Promise<Household> {
  const account = await registerAccount({
    email: overrides.email ?? uniqueEmail('owner'),
    password: overrides.password,
  });
  const created = await createHousehold(account, {
    name: overrides.householdName ?? 'Test Household',
    currency: overrides.currency ?? 'USD',
    displayName: overrides.name ?? 'Owner',
  });
  return { ...account, householdId: created.id };
}

/** Adds another household to an existing account, and switches to it. */
export async function createHousehold(
  account: Account,
  { name = 'Another Household', currency = 'USD', displayName = 'Owner' } = {},
): Promise<{ id: string }> {
  const response = await account.client.post('/api/households', { name, currency, displayName });
  if (response.status !== 201) {
    throw new Error(`create household failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { id: response.body.household.id };
}

/**
 * Invites someone into `owner`'s household, registers them an account and
 * redeems the invite. Joining is now something an account does, so this is
 * three steps where it used to be one.
 */
export async function addMember(
  owner: Household,
  name = 'Member',
): Promise<{ client: Client; userId: string; email: string }> {
  const invite = await owner.client.post('/api/household/invites', { role: 'member' });
  if (invite.status !== 201) {
    throw new Error(`invite failed: ${invite.status} ${JSON.stringify(invite.body)}`);
  }
  const account = await registerAccount({ email: uniqueEmail('member') });
  const joined = await joinHousehold(account, invite.body.token, name);
  if (joined.status !== 201) {
    throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
  }
  return { client: account.client, userId: account.userId, email: account.email };
}

/** Redeems an invite for an already-registered account. */
export const joinHousehold = (account: Account, token: string, displayName = 'Member') =>
  account.client.post('/api/households/join', { token, displayName });

/** The confirmation token for an account that has not redeemed one yet. */
export function pendingVerificationToken(userId: string): string {
  const row = db
    .prepare(
      'SELECT token FROM email_verifications WHERE user_id = ? AND used_at IS NULL ORDER BY created_at DESC',
    )
    .get(userId) as { token: string } | undefined;
  if (!row) throw new Error('no pending verification for that account');
  return row.token;
}

/** Creates a list with a share link and returns the token a guest would hold. */
export async function createSharedList(
  owner: Household,
  { name = 'Groceries', canEdit = true } = {},
): Promise<{ listId: string; token: string }> {
  const list = await owner.client.post('/api/lists', { name });
  const shared = await owner.client.post(`/api/lists/${list.body.id}/share`, { canEdit });
  return { listId: list.body.id, token: shared.body.shareToken };
}
