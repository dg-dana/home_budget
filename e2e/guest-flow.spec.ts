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
    // --- Member: account first, then a household, through the UI -----------
    await page.goto('/register');
    await page.getByLabel('Email').fill(uniqueEmail());
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    // No mail provider, so the confirmation link is put on screen. Following it
    // is the whole point of the step, so the test follows it too.
    await expect(page.getByRole('heading', { name: 'Confirm your address' })).toBeVisible();
    const verifyUrl = await page.locator('.notice-card code').innerText();
    await page.goto(new URL(verifyUrl).pathname);
    await page.getByRole('button', { name: 'Confirm this address' }).click();

    await expect(page).toHaveURL('/households');
    await page.getByRole('button', { name: 'Create a household' }).click();
    await page.getByLabel('Household name').fill('The Test Family');
    await page.getByLabel('Your name in it').fill('Dana');
    await page.getByLabel('Currency').selectOption('EUR');
    await page.getByRole('button', { name: 'Create household' }).click();

    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL('/');
    // The header names the household through the switcher, so assert on what
    // is *selected* rather than on loose text — an unselected option would
    // match a plain text search while proving nothing about which is open.
    await expect(page.getByLabel('Household').locator('option:checked')).toHaveText(
      'The Test Family',
    );

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

  test('a guest adds an item with a comment, and the household sees it', async ({
    page,
    browser,
    request,
    baseURL,
  }) => {
    const owner = await seedSharedList(request, baseURL!, { items: [] });
    const guest = await openAsGuest(browser, owner.shareUrl);
    await identifyAs(guest, 'Ruti next door');

    // The comment lives behind a disclosure, closed by default.
    await expect(guest.getByLabel('Comment', { exact: true })).toHaveCount(0);
    await guest.getByRole('button', { name: 'Add a comment' }).click();

    await guest.getByLabel('Item', { exact: true }).fill('Olive oil');
    await guest.getByLabel('Comment', { exact: true }).fill('The tall green tin, not the bottle');
    await guest.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(guest.getByText('The tall green tin, not the bottle')).toBeVisible();
    // The composer resets, so the next item does not inherit the last comment.
    await expect(guest.getByLabel('Comment', { exact: true })).toHaveCount(0);

    // --- Member: the same comment on the same item -------------------------
    await page.goto('/login');
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');
    await page.getByRole('link', { name: 'Shopping' }).click();
    await page.getByRole('link', { name: /Supermarket/ }).click();

    await expect(page.getByText('The tall green tin, not the bottle')).toBeVisible();
    await expect(page.getByText('Added by Ruti next door')).toBeVisible();

    // A member can rewrite it, and the guest sees the new wording.
    page.once('dialog', (dialog) => dialog.accept('Any brand will do'));
    await page.getByRole('button', { name: 'Edit the comment on Olive oil' }).click();
    await expect(page.getByText('Any brand will do')).toBeVisible();

    await guest.reload();
    await expect(guest.getByText('Any brand will do')).toBeVisible();

    await guest.context().close();
  });

  test('a member watching a list keeps up with a guest, without touching anything', async ({
    page,
    browser,
    request,
    baseURL,
  }) => {
    // Two waits of up to a poll interval each, so this one test needs more
    // than the suite's 30 s. It is the only place where waiting *is* the
    // assertion: everything else here is a click and its consequence.
    test.setTimeout(90_000);

    // The gap this closes: the guest page has always refetched every 15 s, the
    // member page never did — so the person at home could be reading a list
    // that the person in the shop had already emptied.
    const owner = await seedSharedList(request, baseURL!, { items: ['Milk'] });

    await page.goto('/login');
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');
    await page.getByRole('link', { name: 'Shopping' }).click();
    await page.getByRole('link', { name: /Supermarket/ }).click();
    await expect(page.getByText('Milk')).toBeVisible();

    // From here the member's page is never touched again.
    const guest = await openAsGuest(browser, owner.shareUrl);
    await identifyAs(guest, 'Ruti next door');
    await guest.getByLabel('Item', { exact: true }).fill('Bread');
    await guest.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(guest.getByText('Bread')).toBeVisible();

    // No reload and no click on the member's side. The timeout is the poll
    // interval with room to spare; the assertion resolves the moment the item
    // arrives, so a working page does not cost the full wait.
    await expect(page.getByText('Bread')).toBeVisible({ timeout: 25_000 });

    // And it works in the other direction too: what the guest ticks off shows
    // up as bought without the member doing anything either.
    await guest.getByRole('checkbox', { name: 'Mark Milk as bought' }).click();
    await expect(page.getByText('1 to buy · 1 in the basket')).toBeVisible({ timeout: 25_000 });

    await guest.context().close();
  });

  test('copies what is still to buy as plain text, ready to paste into a chat', async ({
    page,
    browser,
    request,
    baseURL,
  }) => {
    const owner = await seedSharedList(request, baseURL!, { items: [] });
    const add = async (data: Record<string, unknown>) =>
      (await request.post(`/api/lists/${owner.listId}/items`, { data })).json();

    await add({ name: 'Milk', quantity: '2 L', note: 'The one in the glass bottle' });
    await add({ name: 'Bread' });
    const coffee = await add({ name: 'Coffee' });
    await request.patch(`/api/lists/${owner.listId}/items/${coffee.id}`, {
      data: { isChecked: true },
    });

    const guest = await openAsGuest(browser, owner.shareUrl);
    await guest.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await identifyAs(guest, 'Ruti');
    await expect(guest.getByText('Coffee')).toBeVisible();

    await guest.getByRole('button', { name: 'Copy list' }).click();
    await expect(guest.getByRole('button', { name: 'Copied' })).toBeVisible();

    const copied = await guest.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(
      [
        // The name runs straight into the heading, with no blank line to push
        // the shopping down a phone screen.
        'Supermarket',
        'To buy:',
        '- Milk (2 L)',
        '  The one in the glass bottle',
        '- Bread',
      ].join('\n'),
    );

    // Coffee is ticked off, so it is not in the message at all: a shopping list
    // that lists what you are already carrying is worse than no list.
    expect(copied).not.toContain('Coffee');

    // The share link is a credential and this text goes into group chats.
    expect(copied).not.toContain(owner.shareToken);
    expect(copied).not.toContain('Added by');

    // --- Member: from the index, and from the list itself -------------------
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/login');
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');
    await page.getByRole('link', { name: 'Shopping' }).click();

    // The index knows the counts but not the items, so this button fetches the
    // list mid-click — the case the promise-based clipboard write exists for.
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copied);
    // And it copied rather than navigating: a button inside the row's link
    // would have opened the list instead.
    await expect(page).toHaveURL('/lists');

    await page.getByRole('link', { name: /Supermarket/ }).click();
    await page.getByRole('button', { name: 'Copy list' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copied);

    await guest.context().close();
  });

  test('a view-only guest sees a comment but is given no way to change it', async ({
    browser,
    request,
    baseURL,
  }) => {
    const owner = await seedSharedList(request, baseURL!, { canEdit: false });
    const item = (await (await request.get(`/api/lists/${owner.listId}`)).json()).items[0];
    await request.patch(`/api/lists/${owner.listId}/items/${item.id}`, {
      data: { note: 'Semi-skimmed' },
    });

    const guest = await openAsGuest(browser, owner.shareUrl);
    await expect(guest.getByText('Semi-skimmed')).toBeVisible();

    // Reading is the whole point of a view-only link; changing is not.
    await expect(guest.getByRole('button', { name: /comment on Milk/i })).toHaveCount(0);
    await expect(guest.getByLabel('Comment', { exact: true })).toHaveCount(0);

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

  test('the sign-in page carries the theme toggle', async ({ page }) => {
    // Nobody signed in has a header to hold the toggle, so without one here the
    // only route to dark mode is to sign in first — no use to whoever is
    // looking at the sign-in page, which is where most people land.
    await page.goto('/login');
    const root = page.locator('html');
    const bodyColour = () =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await expect(root).not.toHaveAttribute('data-theme', /./);
    const systemColour = await bodyColour();

    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    const darkColour = await bodyColour();
    expect(darkColour).not.toBe(systemColour);

    // The choice is the device's, not the page's: it holds across the other
    // signed-out pages rather than resetting on each one.
    await page.goto('/register');
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', darkColour);

    // Adding the toggle must not shove the card off centre.
    await page.goto('/login');
    const card = await page.locator('.auth-card').boundingBox();
    const viewport = page.viewportSize()!;
    const above = card!.y;
    const below = viewport.height - (card!.y + card!.height);
    expect(Math.abs(above - below)).toBeLessThan(2);
  });

  test('an invented share token shows the dead-link page', async ({ browser, baseURL }) => {
    const guest = await openAsGuest(browser, `${baseURL}/s/not-a-real-token`);
    await expect(guest.getByRole('heading', { name: 'Link not active' })).toBeVisible();
    await guest.context().close();
  });
});
