import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, seedAccountWithHousehold, uniqueEmail } from './helpers';

/**
 * The expenses dashboard — the page the app is for, and the one that had no
 * browser coverage at all.
 *
 * The server suite proves the arithmetic: cents, month boundaries, budget
 * aggregation. What it cannot see is whether any of that reaches a screen —
 * whether the form saves, whether the summary beside it moves when it does,
 * and whether editing a row loads that row rather than a fresh one. Every bug
 * this page could have is of that kind.
 */
test.describe('the expenses dashboard', () => {
  test('records an expense, and the summary beside it moves', async ({ page, request }) => {
    const email = uniqueEmail('spend');
    await seedAccountWithHousehold(request, { email, currency: 'EUR' });
    await signIn(page, email);

    const total = page.locator('.stat', { hasText: 'Total spent' });
    await expect(total).toContainText('0.00');

    await addExpense(page, { amount: '42.50', description: 'Weekly shop', category: 'Groceries' });

    // The row, the total and the category breakdown are three separate reads of
    // the same write, and the page refetches rather than patching itself.
    await expect(page.getByText('Weekly shop')).toBeVisible();
    await expect(total).toContainText('42.50');
    const byCategory = page.locator('.card', { hasText: 'By category' });
    await expect(byCategory.getByText('Groceries')).toBeVisible();
    await expect(byCategory).toContainText('42.50');

    // Cents, not floats — the whole reason amounts are integers end to end.
    await addExpense(page, { amount: '0.05', description: 'Sweet' });
    await expect(total).toContainText('42.55');
  });

  test('edits a row in place rather than adding a second one', async ({ page, request }) => {
    const email = uniqueEmail('edit');
    await seedAccountWithHousehold(request, { email, currency: 'EUR' });
    await signIn(page, email);

    await addExpense(page, { amount: '20.00', description: 'Bus pass' });
    await page.getByRole('button', { name: 'Edit Bus pass' }).click();

    // The form has to arrive holding the row's own values, not empty ones —
    // this is what makes it an edit rather than a second expense.
    await expect(page.getByRole('heading', { name: 'Edit expense' })).toBeVisible();
    await expect(page.getByLabel('Amount')).toHaveValue('20.00');
    await expect(page.getByLabel('Description')).toHaveValue('Bus pass');

    await page.getByLabel('Amount').fill('25.00');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.locator('.stat', { hasText: 'Total spent' })).toContainText('25.00');
    await expect(page.getByText('Bus pass')).toHaveCount(1);
    // And the form goes back to being an add form, or the next entry silently
    // overwrites this one.
    await expect(page.getByRole('heading', { name: 'Add an expense' })).toBeVisible();
  });

  test('warns when a category is over its monthly budget', async ({ page, request }) => {
    const email = uniqueEmail('budget');
    await seedAccountWithHousehold(request, { email, currency: 'EUR' });
    const categories = await (await request.get('/api/categories')).json();
    const groceries = categories.find((c: { name: string }) => c.name === 'Groceries');
    await request.put(`/api/categories/${groceries.id}`, {
      data: { name: 'Groceries', color: groceries.color, monthlyBudget: 100 },
    });

    await signIn(page, email);
    const budgets = page.locator('.card', { hasText: 'Budgets' });
    await expect(budgets.getByText('Groceries')).toBeVisible();
    await expect(budgets).not.toContainText('Over by');

    await addExpense(page, { amount: '130.00', description: 'Big shop', category: 'Groceries' });

    // The number the page exists to surface: not "you have spent 130", but
    // "you are 30 past the line you drew".
    await expect(budgets).toContainText('Over by');
    await expect(budgets).toContainText('30.00');
  });

  test('moves between months, and says when one is empty', async ({ page, request }) => {
    const email = uniqueEmail('months');
    await seedAccountWithHousehold(request, { email, currency: 'EUR' });
    await signIn(page, email);
    await addExpense(page, { amount: '10.00', description: 'This month only' });

    await page.getByRole('button', { name: '← Previous' }).click();
    await expect(page.getByText('This month only')).toHaveCount(0);
    await expect(page.getByText(/Nothing recorded for/)).toBeVisible();

    await page.getByRole('button', { name: 'This month' }).click();
    await expect(page.getByText('This month only')).toBeVisible();
  });
});

async function addExpense(
  page: Page,
  { amount, description, category }: { amount: string; description: string; category?: string },
) {
  await page.getByLabel('Amount').fill(amount);
  await page.getByLabel('Description').fill(description);
  if (category) await page.getByLabel('Category').selectOption({ label: category });
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByText(description)).toBeVisible();
}

/** Signs in through the form and waits for the dashboard. */
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');
}
