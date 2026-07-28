import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createSharedList,
  getBaseUrl,
  registerHousehold,
  resetDatabase,
  startServer,
  stopServer,
  type Household,
} from './helpers.js';

/**
 * Measures the bytes actually on the wire.
 *
 * Neither the test client nor `fetch` can do this: undici transparently
 * decompresses, so `arrayBuffer()` hands back the *decoded* body and a naive
 * size comparison ends up comparing a number with itself. `node:http` does no
 * such decoding, so it sees what a browser's network tab would.
 */
function rawRequest(
  path: string,
  { cookie, acceptEncoding }: { cookie?: string; acceptEncoding: string },
): Promise<{ status: number; encoding?: string; vary?: string; bytes: number }> {
  const url = new URL(`${getBaseUrl()}${path}`);
  const headers: Record<string, string> = { 'accept-encoding': acceptEncoding };
  if (cookie) headers.cookie = cookie;

  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers },
      (response) => {
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            encoding: response.headers['content-encoding'] as string | undefined,
            vary: response.headers.vary as string | undefined,
            bytes,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * These use `fetch` directly rather than the test client, because the client
 * transparently decodes the body — which is exactly the detail under test.
 */
async function rawGet(path: string, cookie?: string) {
  const headers: Record<string, string> = { 'accept-encoding': 'gzip' };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${getBaseUrl()}${path}`, { headers });
  return {
    status: response.status,
    encoding: response.headers.get('content-encoding'),
    vary: response.headers.get('vary'),
  };
}

/** The session cookie in the form a raw request needs. */
async function sessionCookie(email: string): Promise<string> {
  const response = await fetch(`${getBaseUrl()}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  const raw = response.headers.getSetCookie()[0] ?? '';
  return raw.split(';')[0] ?? '';
}

describe('response compression', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);

  let owner: Household;
  let cookie: string;

  beforeEach(async () => {
    resetDatabase();
    owner = await registerHousehold();
    cookie = await sessionCookie(owner.email);

    // Enough rows to comfortably clear the compressor's size threshold.
    for (let i = 0; i < 60; i += 1) {
      await owner.client.post('/api/expenses', {
        amount: 10 + i,
        description: `Supermarket run number ${i} with a typical description`,
        spentOn: '2026-04-10',
      });
    }
  });

  it('gzips a month of expenses', async () => {
    const response = await rawGet('/api/expenses?month=2026-04', cookie);
    expect(response.status).toBe(200);
    expect(response.encoding).toBe('gzip');
  });

  it('substantially shrinks the payload on the wire', async () => {
    const gzipped = await rawRequest('/api/expenses?month=2026-04', {
      cookie,
      acceptEncoding: 'gzip',
    });
    const plain = await rawRequest('/api/expenses?month=2026-04', {
      cookie,
      acceptEncoding: 'identity',
    });

    expect(gzipped.encoding).toBe('gzip');
    expect(plain.encoding).toBeUndefined();
    // Repeated field names and ISO dates compress hard; 3x is a floor, not a
    // target, so the assertion does not turn brittle on small payload changes.
    expect(gzipped.bytes).toBeLessThan(plain.bytes / 3);
  });

  it('still serves clients that do not accept gzip', async () => {
    const response = await fetch(`${getBaseUrl()}/api/expenses?month=2026-04`, {
      headers: { cookie, 'accept-encoding': 'identity' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(((await response.json()) as unknown[]).length).toBe(60);
  });

  it('sets Vary so caches keep the two forms apart', async () => {
    const response = await rawGet('/api/expenses?month=2026-04', cookie);
    expect(response.vary).toMatch(/accept-encoding/i);
  });

  it('compresses the guest share response too', async () => {
    const { listId, token } = await createSharedList(owner);
    for (let i = 0; i < 40; i += 1) {
      await owner.client.post(`/api/lists/${listId}/items`, {
        name: `Shopping item number ${i}`,
        note: 'a note long enough to matter',
      });
    }

    const response = await rawGet(`/api/share/${token}`);
    expect(response.status).toBe(200);
    expect(response.encoding).toBe('gzip');
  });

  it('leaves tiny responses alone', async () => {
    // Below the size threshold, compressing costs more than it saves.
    const response = await rawGet('/api/health');
    expect(response.status).toBe(200);
    expect(response.encoding).toBeNull();
  });
});
