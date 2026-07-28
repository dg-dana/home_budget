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
  delete<T = any>(path: string): Promise<Response<T>>;
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
    'categories',
    'invites',
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
    delete: (path) => send('DELETE', path),
    cookies: () => [...jar.keys()].join(','),
  };
}

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}-${++counter}-${Date.now()}@example.com`;

export interface Household {
  client: Client;
  userId: string;
  householdId: string;
  email: string;
}

/** Registers a brand new household and returns a signed-in client for its owner. */
export async function registerHousehold(overrides: Partial<{
  householdName: string;
  currency: string;
  name: string;
  email: string;
  password: string;
}> = {}): Promise<Household> {
  const client = createClient();
  const email = overrides.email ?? uniqueEmail('owner');
  const response = await client.post('/api/auth/register', {
    householdName: overrides.householdName ?? 'Test Household',
    currency: overrides.currency ?? 'USD',
    name: overrides.name ?? 'Owner',
    email,
    password: overrides.password ?? 'password123',
  });
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return {
    client,
    userId: response.body.user.id,
    householdId: response.body.user.householdId,
    email,
  };
}

/** Invites a member into `owner`'s household and signs them in. */
export async function addMember(
  owner: Household,
  name = 'Member',
): Promise<{ client: Client; userId: string; email: string }> {
  const invite = await owner.client.post('/api/household/invites', { role: 'member' });
  if (invite.status !== 201) {
    throw new Error(`invite failed: ${invite.status} ${JSON.stringify(invite.body)}`);
  }
  const client = createClient();
  const email = uniqueEmail('member');
  const joined = await client.post('/api/auth/join', {
    token: invite.body.token,
    name,
    email,
    password: 'password123',
  });
  if (joined.status !== 201) {
    throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
  }
  return { client, userId: joined.body.user.id, email };
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
