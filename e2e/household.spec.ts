import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, seedHouseholdWithMember } from './helpers';

/**
 * The Household page, which had no browser coverage at all until now — and is
 * where the money is administered and the buttons that cannot be undone live.
 *
 * These are the questions the server suite cannot answer, because they are
 * about what is on a screen:
 *
 * - **Who is shown which control.** The Danger zone card was briefly owner-only,
 *   correctly, when deleting the household was the only thing in it — and that
 *   shipped a page where "Leave this household" was hidden from precisely the
 *   people it exists for (`ARCHITECTURE.md` §9). The server would have been
 *   perfectly happy.
 * - **Where a refusal appears.** This page is several screens long on a phone,
 *   so an error at the top of it is an error nobody sees. That is a claim about
 *   pixels, and nothing else in the suite can check it.
 * - **Whether a control the server would refuse is offered at all.** The two
 *   cases somebody cannot leave in are shown as a disabled button with the
 *   reason, rather than as a round trip that only produces an error.
 */
test.describe('the household page', () => {
  test('an ordinary member gets the Danger zone, and can leave', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const household = await seedHouseholdWithMember(playwright.request, baseURL!);
    await signIn(page, household.memberEmail);
    await page.getByRole('link', { name: 'Household' }).click();
    await page.waitForURL('/household');

    // The trap this test exists for: gating the whole card on ownership hides
    // leaving from the only people who need it.
    await expect(page.getByRole('heading', { name: 'Danger zone' })).toBeVisible();
    const leave = page.getByRole('button', { name: 'Leave household' });
    await expect(leave).toBeEnabled();

    // The delete-household form is the owner-only half *inside* that card.
    await expect(page.getByRole('heading', { name: 'Delete this household' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete household' })).toHaveCount(0);

    // Leaving takes no password — deliberately, since an invite undoes it.
    await expect(page.getByLabel('Confirm with your password')).toHaveCount(0);

    page.once('dialog', (dialog) => dialog.accept());
    await leave.click();

    // Lands on the picker rather than being signed out: the account outlives
    // the membership, and may hold other households.
    await page.waitForURL('/households');
    await expect(page.getByText('You are not in a household yet.')).toBeVisible();
    await expect(page.getByText(household.householdName)).toHaveCount(0);
  });

  test('the only owner is refused, with the reason under the button', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const household = await seedHouseholdWithMember(playwright.request, baseURL!);
    await signIn(page, household.ownerEmail);
    await page.goto('/household');

    // Both conditions are already on screen in the member list above, so the
    // page says so rather than spending a round trip on an error.
    const leave = page.getByRole('button', { name: 'Leave household' });
    await expect(leave).toBeDisabled();
    await expect(page.getByText(/only owner/i)).toBeVisible();

    // Handing ownership over is what unblocks it, and the page has to notice.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Make owner' }).click();
    await expect(page.getByRole('button', { name: 'Make member' })).toBeVisible();

    await expect(leave).toBeEnabled();
    await expect(page.getByText(/only owner/i)).toHaveCount(0);
  });

  test('an invite refusal lands under the form, not at the top of the page', async ({
    page,
    playwright,
    baseURL,
  }) => {
    // Found by sending a real invite: the page is several screens long on a
    // phone, so a page-level alert is an alert nobody sees (`ARCHITECTURE.md`
    // §9). Whether an error is *visible where you are looking* is a question
    // about pixels — this is the only kind of test that can ask it.
    const household = await seedHouseholdWithMember(playwright.request, baseURL!);
    await signIn(page, household.ownerEmail);
    await page.goto('/household');

    const box = page.getByLabel('Invite email (optional)');
    await box.fill(household.memberEmail);
    await page.getByRole('button', { name: 'Create invite' }).click();

    const alert = page.locator('.alert', { hasText: /already in this household/i });
    await expect(alert).toBeVisible();

    // Below the input it is about, rather than off the top of the screen.
    const input = await box.boundingBox();
    const shown = await alert.boundingBox();
    expect(shown!.y).toBeGreaterThan(input!.y);

    // And what was typed survives: "that address is already in" is answered by
    // editing the box, not by filling it in again.
    await expect(box).toHaveValue(household.memberEmail);
  });

  test('categories can be added, budgeted and removed', async ({ page, playwright, baseURL }) => {
    const household = await seedHouseholdWithMember(playwright.request, baseURL!);
    await signIn(page, household.ownerEmail);
    await page.goto('/household');

    const table = page.locator('.table-wrap');
    await page.getByLabel('New category name').fill('Piano lessons');
    await page.getByLabel('Monthly budget', { exact: true }).fill('120');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(table.getByText('Piano lessons')).toBeVisible();

    // The budget is saved on blur, not by a button — easy to break, invisible
    // to the server suite, and the only way anyone sets one.
    const budget = page.getByLabel('Piano lessons monthly budget');
    await expect(budget).toHaveValue('120');
    await budget.fill('75');
    await budget.blur();
    await page.reload();
    await expect(page.getByLabel('Piano lessons monthly budget')).toHaveValue('75');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete Piano lessons' }).click();
    await expect(table.getByText('Piano lessons')).toHaveCount(0);
  });
});

/** Signs in through the form and waits for the dashboard. */
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');
}
