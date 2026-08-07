import { expect, test } from '@playwright/test';
import {
  PASSWORD,
  identifyAs,
  openAsGuest,
  seedAccountWithHousehold,
  seedSharedList,
  uniqueEmail,
} from './helpers';

/**
 * The language picker, which is a **per-device** choice like the theme and for
 * the same reasons — so these tests are mostly about the screens with no
 * account behind them.
 *
 * Three things need proving, and only a browser can do any of them:
 *
 * 1. The control is on the screens that have no header to hold it — the guest
 *    page and the signed-out pages. That is the trap the theme toggle fell into
 *    twice (`ARCHITECTURE.md` §9.1).
 * 2. Choosing German changes the **numbers as well as the words**. A page with
 *    German labels and `105.00` on it is half-translated, and no server test can
 *    see that.
 * 3. The choice survives a reload, and reaches `<html lang>`.
 */
test.describe('language', () => {
  test('a guest can read the list in German, and it survives a reload', async ({
    browser,
    request,
    baseURL,
  }) => {
    const owner = await seedSharedList(request, baseURL!, { items: ['Milk'] });
    const guest = await openAsGuest(browser, owner.shareUrl);
    await guest.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await identifyAs(guest, 'Ruti');

    // English to begin with: the browser locale is pinned to en-US in the
    // config, so nothing has been chosen and the device decides.
    await expect(guest.locator('html')).toHaveAttribute('lang', 'en');
    await expect(guest.getByRole('heading', { name: 'To buy' })).toBeVisible();

    await guest.getByRole('button', { name: 'Deutsch' }).click();

    await expect(guest.locator('html')).toHaveAttribute('lang', 'de');
    await expect(guest.getByRole('heading', { name: 'Zu kaufen' })).toBeVisible();
    await expect(guest.getByText('Unterwegs als Ruti')).toBeVisible();
    // The item's own words are the household's, and are never translated.
    await expect(guest.getByText('Milk')).toBeVisible();
    await expect(guest.getByText('Hinzugefügt von Dana')).toBeVisible();

    // The copied text goes out in the language of whoever is sending it — this
    // is the one piece of translated output that leaves the app.
    //
    // Headless Chromium has **one clipboard for the whole browser**, so the
    // other copy test can overwrite this between the click and the read. Both
    // steps therefore go inside the retry: each attempt writes afresh, so a
    // stale read is retried rather than failing the run.
    const copy = guest.getByRole('button', { name: /Liste kopieren|Kopiert/ });
    await expect(async () => {
      await copy.click();
      expect(await guest.evaluate(() => navigator.clipboard.readText())).toBe(
        ['Supermarket', 'Zu kaufen:', '- Milk'].join('\n'),
      );
    }).toPass({ timeout: 15_000 });

    await guest.reload();
    await expect(guest.locator('html')).toHaveAttribute('lang', 'de');
    await expect(guest.getByRole('heading', { name: 'Zu kaufen' })).toBeVisible();

    // And `lang` is set *before first paint*, like the theme — a screen reader
    // must not read the first frame in the wrong voice. Blocking the bundle is
    // what makes that testable: with React unable to run, the inline script in
    // index.html is the only thing left that could have set the attribute.
    await guest.route('**/assets/*.js', (route) => route.abort());
    await guest.reload();
    await expect(guest.locator('html')).toHaveAttribute('lang', 'de');
    await guest.unroute('**/assets/*.js');
    await guest.reload();

    // And back, so the switch is a switch rather than a one-way door.
    await guest.getByRole('button', { name: 'English' }).click();
    await expect(guest.getByRole('heading', { name: 'To buy' })).toBeVisible();

    await guest.context().close();
  });

  test('the signed-out pages carry the picker, and the choice holds across them', async ({
    page,
  }) => {
    // Same trap as the theme toggle: with no control here, the only route to
    // German would be to sign in first — and the sign-in page is the screen
    // somebody who cannot read it is looking at.
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    await page.getByRole('button', { name: 'Deutsch' }).click();
    await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
    await expect(page.getByLabel('Passwort')).toBeVisible();

    // The choice belongs to the device, not to the page that set it.
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Erstelle dein Konto' })).toBeVisible();
    await page.goto('/forgot');
    await expect(page.getByRole('heading', { name: 'Passwort vergessen?' })).toBeVisible();
  });

  test('German moves the decimal point, not only the labels', async ({ page, request }) => {
    const email = uniqueEmail('lang');
    await seedAccountWithHousehold(request, { email, currency: 'EUR' });
    await request.post('/api/expenses', {
      data: { amount: 105, description: 'Wocheneinkauf', spentOn: today() },
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');

    const total = page.locator('.stat', { hasText: 'Total spent' });
    await expect(total).toContainText('105.00');

    await page.getByRole('button', { name: 'Deutsch' }).click();

    // Labels, navigation and money all move together. If `format.ts` stopped
    // following the chosen language this would still say 105.00.
    await expect(page.getByRole('link', { name: 'Ausgaben' })).toBeVisible();
    const gesamt = page.locator('.stat', { hasText: 'Gesamtausgaben' });
    await expect(gesamt).toContainText('105,00');
    await expect(gesamt).not.toContainText('105.00');
  });
});

/** Today in local time, matching what the app itself records. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}
