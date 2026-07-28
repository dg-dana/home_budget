import type { APIRequestContext, Browser, Page } from '@playwright/test';

let counter = 0;

/** Unique per test, so tests can share one database and still run in parallel. */
export const uniqueEmail = (prefix = 'owner') =>
  `${prefix}-${Date.now()}-${++counter}@example.com`;

export const PASSWORD = 'password123';

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

  const registered = await request.post('/api/auth/register', {
    data: {
      householdName: 'E2E Household',
      currency: 'USD',
      name: 'Dana',
      email,
      password: PASSWORD,
    },
  });
  if (!registered.ok()) throw new Error(`register failed: ${registered.status()}`);

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
