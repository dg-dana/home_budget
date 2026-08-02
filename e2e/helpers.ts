import type { APIRequest, APIRequestContext, Browser, Page } from '@playwright/test';

let counter = 0;

/**
 * Unique per test, so tests can share one database and still run in parallel.
 * The random segment matters: Playwright runs workers as separate processes, so
 * the counter restarts in each and two workers registering in the same
 * millisecond would otherwise collide.
 */
export const uniqueEmail = (prefix = 'owner') =>
  `${prefix}-${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export const PASSWORD = 'password123';

/**
 * Registers an account, confirms its address, and creates a household to own —
 * the three steps that now stand between a stranger and any data at all.
 * Returns the still-signed-in context.
 */
export async function seedAccountWithHousehold(
  api: APIRequestContext,
  {
    email,
    householdName = 'E2E Household',
    currency = 'USD',
    displayName = 'Dana',
  }: { email: string; householdName?: string; currency?: string; displayName?: string },
): Promise<{ userId: string; householdId: string }> {
  const registered = await api.post('/api/auth/register', { data: { email, password: PASSWORD } });
  if (!registered.ok()) throw new Error(`register failed: ${registered.status()}`);
  const account = await registered.json();

  // No mail provider, so the confirmation link comes back in the response.
  const token = String(account.verification.link).split('/').pop();
  const verified = await api.post('/api/auth/verify', { data: { token } });
  if (!verified.ok()) throw new Error(`verify failed: ${verified.status()}`);

  const created = await api.post('/api/households', {
    data: { name: householdName, currency, displayName },
  });
  if (!created.ok()) throw new Error(`create household failed: ${created.status()}`);

  return { userId: account.user.id, householdId: (await created.json()).household.id };
}

export interface Owner {
  email: string;
  listId: string;
  shareUrl: string;
  shareToken: string;
}

/**
 * Sets a household up through the API rather than the UI. Used by the focused
 * guest tests, where the owner's clicks are not what is under test — the full
 * journey test does the same work through the interface.
 */
export async function seedSharedList(
  request: APIRequestContext,
  baseURL: string,
  { canEdit = true, listName = 'Supermarket', items = ['Milk'] } = {},
): Promise<Owner> {
  const email = uniqueEmail();

  await seedAccountWithHousehold(request, { email });

  const list = await (await request.post('/api/lists', { data: { name: listName } })).json();
  for (const name of items) {
    await request.post(`/api/lists/${list.id}/items`, { data: { name } });
  }
  const shared = await (
    await request.post(`/api/lists/${list.id}/share`, { data: { canEdit } })
  ).json();

  return {
    email,
    listId: list.id,
    shareToken: shared.shareToken,
    shareUrl: `${baseURL}/s/${shared.shareToken}`,
  };
}

export interface StatsHousehold {
  email: string;
  /** The owner's own signed-in API context; expenses are posted through it. */
  api: APIRequestContext;
  members: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
}

/**
 * A household with people and categories, built through the API — the
 * statistics tests are about what the page draws, not about how the data got
 * in. Each member joins in a **context of their own**, because joining sets a
 * session cookie and a shared jar would sign the owner out halfway through.
 * Their expenses are then posted by the owner with an explicit `paidBy`.
 */
export async function seedStatsHousehold(
  apiRequest: APIRequest,
  baseURL: string,
  { memberNames = [] as string[], currency = 'USD', householdName = 'Stats Household' } = {},
): Promise<StatsHousehold> {
  const email = uniqueEmail('stats');
  const api = await apiRequest.newContext({ baseURL });

  const owner = await seedAccountWithHousehold(api, { email, householdName, currency });

  const members = [{ id: owner.userId, name: 'Dana' }];
  for (const name of memberNames) {
    const invite = await (await api.post('/api/household/invites', { data: { role: 'member' } })).json();
    const joiner = await apiRequest.newContext({ baseURL });
    // Joining is now something an account does, so each member registers and
    // confirms first, then redeems the invite.
    const joinerEmail = uniqueEmail(name.toLowerCase());
    const registered = await joiner.post('/api/auth/register', {
      data: { email: joinerEmail, password: PASSWORD },
    });
    if (!registered.ok()) throw new Error(`register failed: ${registered.status()}`);
    const account = await registered.json();
    await joiner.post('/api/auth/verify', {
      data: { token: String(account.verification.link).split('/').pop() },
    });
    const joined = await joiner.post('/api/households/join', {
      data: { token: invite.token, displayName: name },
    });
    if (!joined.ok()) throw new Error(`join failed: ${joined.status()}`);
    members.push({ id: account.user.id as string, name });
    await joiner.dispose();
  }

  return { email, api, members, categories: await (await api.get('/api/categories')).json() };
}

/** Signs a seeded household's owner into the browser and opens Statistics. */
export async function openStatistics(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');
  // Through the header link, not a direct URL: a page nobody can navigate to is
  // a page nobody has.
  await page.getByRole('link', { name: 'Statistics' }).click();
  await page.waitForURL('/stats');
}

/** The 15th of a month N months back, in local time — the app's own reckoning. */
export function monthsAgo(count: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - count, 15);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-15`;
}

/**
 * A guest is defined by having no session at all, so every guest gets a fresh
 * browser context — no cookies, no localStorage carried over from a member.
 */
export async function openAsGuest(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

/** Fills in the one-time "who's shopping?" prompt. */
export async function identifyAs(page: Page, name: string) {
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Open list' }).click();
}
