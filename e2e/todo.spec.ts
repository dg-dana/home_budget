import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, seedAccountWithHousehold, uniqueEmail } from './helpers';

/**
 * The to-do page.
 *
 * The server suite already proves the bookkeeping — who gets the credit for a
 * finished job, what an edit must not disturb, that one household never sees
 * another's. What it cannot see is whether any of that reaches a screen: that
 * the section is **reachable from the header** (a page nobody can navigate to
 * is a page nobody has — `ARCHITECTURE.md` §9), that ticking a box moves the
 * job into the finished group rather than only changing a database row, and
 * that the icon-only buttons carry an accessible name, since the glyph is all
 * a screen reader would otherwise have to announce.
 */
test.describe('the to-do page', () => {
  test('adds a job from the header link, ticks it off and clears it', async ({ page, request }) => {
    const email = uniqueEmail('todo');
    await seedAccountWithHousehold(request, { email });
    await signIn(page, email);

    // Through the header, not a direct URL.
    await page.getByRole('link', { name: 'To-do' }).click();
    await page.waitForURL('/todo');
    await expect(page.getByText('Nothing to do. Add the first job above.')).toBeVisible();

    await page.getByLabel('What needs doing').fill('Call the plumber');
    await page.getByRole('button', { name: 'Add' }).click();

    await expect(page.getByText('Call the plumber')).toBeVisible();
    // Whoever added it is named, which is the point of a shared list.
    await expect(page.getByText('added by Dana')).toBeVisible();
    await expect(page.getByText('1 to do · 0 done')).toBeVisible();

    // `click`, not `check`: the checkbox is controlled and only flips once the
    // write comes back and the page refetches.
    const done = page.getByRole('checkbox', { name: 'Mark "Call the plumber" as done' });
    await done.click();
    await expect(done).toBeChecked();

    await expect(page.getByText('0 to do · 1 done')).toBeVisible();
    await expect(page.getByText('done by Dana')).toBeVisible();
    await expect(page.locator('li.item.checked')).toHaveCount(1);

    await page.getByRole('button', { name: 'Clear 1 done' }).click();
    await expect(page.getByText('Nothing to do. Add the first job above.')).toBeVisible();
  });

  test('keeps outstanding jobs above finished ones, and removes one', async ({ page, request }) => {
    const email = uniqueEmail('todo-order');
    await seedAccountWithHousehold(request, { email });
    await signIn(page, email);
    await page.goto('/todo');

    for (const title of ['Fix the shelf', 'Book the car in']) {
      await page.getByLabel('What needs doing').fill(title);
      await page.getByRole('button', { name: 'Add' }).click();
      await expect(page.getByText(title)).toBeVisible();
    }

    const done = page.getByRole('checkbox', { name: 'Mark "Fix the shelf" as done' });
    await done.click();
    await expect(done).toBeChecked();

    // A finished job sinks below the outstanding one, so what is still to do
    // is what you read first.
    await expect(page.locator('li.item .item-name')).toHaveText([
      'Book the car in',
      'Fix the shelf',
    ]);

    // An icon-only button is announced by its accessible name, never its glyph.
    await page.getByRole('button', { name: 'Remove "Book the car in"' }).click();
    await expect(page.getByText('Book the car in')).toHaveCount(0);
    await expect(page.getByText('Fix the shelf')).toBeVisible();
  });
});

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');
}
