import { expect, test } from '@playwright/test';
import { PASSWORD, identifyAs, openAsGuest, seedSharedList, uniqueEmail } from './helpers';

/**
 * The guest flow is the app's riskiest path: it is the only surface reachable
 * without an account, and the only place where getting authorization wrong
 * would expose one family's data to a stranger. These run against the
 * production build — one process serving the API and the built frontend.
 */
test.describe('guest shopping list', () => {
  test('a household shares a list and a guest shops it end to end', async ({ page, browser }) => {
    // --- Member: create the household through the UI -----------------------
    await page.goto('/register');
    await page.getByLabel('Household name').fill('The Test Family');
    await page.getByLabel('Currency').selectOption('EUR');
    await page.getByLabel('Your name').fill('Dana');
    await page.getByLabel('Email').fill(uniqueEmail());
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create household' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: /The Test Family/ })).toBeVisible();

    // --- Member: create a list and put something on it ---------------------
    await page.getByRole('link', { name: 'Shopping' }).click();
    await page.getByLabel('New list name').fill('Supermarket');
    await page.getByRole('button', { name: 'New list' }).click();
    await page.getByRole('link', { name: /Supermarket/ }).click();

    await expect(page.getByRole('heading', { name: 'Supermarket' })).toBeVisible();
    await page.getByLabel('Item', { exact: true }).fill('Milk');
    await page.getByLabel('Quantity').fill('2 L');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Milk')).toBeVisible();

    // --- Member: turn on guest access --------------------------------------
    await page.getByRole('button', { name: 'Create share link' }).click();
    const shareUrl = await page.locator('.share-box code').innerText();
    expect(shareUrl).toContain('/s/');

    // --- Guest: no account, no cookies, just the link ----------------------
    const guest = await openAsGuest(browser, shareUrl);
    await expect(guest.getByRole('heading', { name: 'Supermarket' })).toBeVisible();

    // The guest is asked who they are before they can touch anything.
    await identifyAs(guest, 'Ruti next door');
    await expect(guest.getByText('Shopping as Ruti next door')).toBeVisible();
    await expect(guest.getByText('Milk')).toBeVisible();
    await expect(guest.getByText('Added by Dana')).toBeVisible();

    // --- Guest: add an item and tick one off -------------------------------
    await guest.getByLabel('Item', { exact: true }).fill('Bread');
    await guest.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(guest.getByText('Bread')).toBeVisible();
    await expect(guest.getByText('Added by Ruti next door')).toBeVisible();

    // `click`, not `check`: the checkbox is controlled and only flips once the
    // server round-trip lands, so assert the visible outcome instead.
    await guest.getByLabel('Mark Milk as bought').click();
    await expect(guest.getByText('picked up by Ruti next door')).toBeVisible();
    await expect(guest.getByLabel('Mark Milk as bought')).toBeChecked();

    // --- Member: sees exactly what the guest did ---------------------------
    await page.reload();
    await expect(page.getByText('Bread')).toBeVisible();
    await expect(page.getByText('Added by Ruti next door')).toBeVisible();
    await expect(page.getByText('picked up by Ruti next door')).toBeVisible();

    await guest.context().close();
  });

  test('the share link gives a guest no way into the rest of the app', async ({
    browser,
    request,
    baseURL,
  }) => {
    const owner = await seedSharedList(request, baseURL!);
    const guest = await openAsGuest(browser, owner.shareUrl);
    await identifyAs(guest, 'Ruti');
    await expect(guest.getByText('Milk')).toBeVisible();

    // Every private route bounces a guest to the sign-in page.
    for (const path of ['/', '/lists', '/household']) {
      await guest.goto(path);
      await expect(guest).toHaveURL('/login');
    }

    // And the household's own details never appear on the shared page.
    await guest.goto(owner.shareUrl);
    const content = await guest.content();
    expect(content).not.toContain('E2E Household');
    expect(content).not.toContain(owner.email);

    await guest.context().close();
  });

  test('a view-only link can be read but not changed', async ({ browser, request, baseURL }) => {
    const owner = await seedSharedList(request, baseURL!, { canEdit: false });
    const guest = await openAsGuest(browser, owner.shareUrl);

    // No name prompt, because there is nothing for the guest to sign.
    await expect(guest.getByText(/shared as view-only/i)).toBeVisible();
    await expect(guest.getByText('Milk')).toBeVisible();

    await expect(guest.getByLabel('Mark Milk as bought')).toBeDisabled();
    await expect(guest.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);

    await guest.context().close();
  });

  test('revoking the link locks the guest out immediately', async ({
    browser,
    request,
    baseURL,
  }) => {
    const owner = await seedSharedList(request, baseURL!);
    const guest = await openAsGuest(browser, owner.shareUrl);
    await identifyAs(guest, 'Ruti');
    await expect(guest.getByText('Milk')).toBeVisible();

    // The owner stops sharing while the guest still has the page open.
    const revoked = await request.delete(`/api/lists/${owner.listId}/share`);
    expect(revoked.ok()).toBe(true);

    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'Link not active' })).toBeVisible();
    await expect(guest.getByText('Milk')).toHaveCount(0);

    await guest.context().close();
  });

  test('a guest is only asked for their name once', async ({ browser, request, baseURL }) => {
    const owner = await seedSharedList(request, baseURL!);
    const guest = await openAsGuest(browser, owner.shareUrl);
    await identifyAs(guest, 'Ruti next door');

    await guest.reload();
    // Straight to the list — the name is remembered on the device.
    await expect(guest.getByText('Shopping as Ruti next door')).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Open list' })).toHaveCount(0);

    await guest.context().close();
  });

  test('a guest can pick a theme and it survives a reload', async ({
    browser,
    request,
    baseURL,
  }) => {
    const owner = await seedSharedList(request, baseURL!);
    const guest = await openAsGuest(browser, owner.shareUrl);
    await identifyAs(guest, 'Ruti');

    const root = guest.locator('html');
    const bodyColour = () =>
      guest.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // No attribute at all to begin with: follow the device.
    await expect(root).not.toHaveAttribute('data-theme', /./);
    const systemColour = await bodyColour();

    await guest.getByRole('button', { name: 'Dark' }).click();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    const darkColour = await bodyColour();
    expect(darkColour).not.toBe(systemColour);

    await guest.reload();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(guest.locator('body')).toHaveCSS('background-color', darkColour);

    // And it is applied *before first paint*, not once React has mounted —
    // otherwise every load flashes the light palette first. Blocking the bundle
    // is what makes that testable: with React unable to run, the inline script
    // in index.html is the only thing left that could have set the palette.
    await guest.route('**/assets/*.js', (route) => route.abort());
    await guest.reload();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    expect(await bodyColour()).toBe(darkColour);
    await guest.unroute('**/assets/*.js');
    await guest.reload();

    await guest.getByRole('button', { name: 'Match device' }).click();
    await expect(root).not.toHaveAttribute('data-theme', /./);
    expect(await bodyColour()).toBe(systemColour);

    await guest.context().close();
  });

  test('an invented share token shows the dead-link page', async ({ browser, baseURL }) => {
    const guest = await openAsGuest(browser, `${baseURL}/s/not-a-real-token`);
    await expect(guest.getByRole('heading', { name: 'Link not active' })).toBeVisible();
    await guest.context().close();
  });
});
