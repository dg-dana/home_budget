import { expect, test } from '@playwright/test';
import { monthsAgo, openFromHeader, seedStatsHousehold } from './helpers';

/**
 * `.item` is the shared row on six pages, and how much room its text gets is a
 * question about what is on the screen — invisible to the server suite and to
 * a careful reading of the stylesheet.
 *
 * The row is a flex container with `flex-wrap: wrap`, and the wrap only ever
 * happens because `.item-main` carries a flex *basis*. At `flex: 1` the basis
 * is 0, which never overflows however little room is left — it just shrinks.
 * That shipped: on a phone a recurring rule's details ended up in a column
 * about sixty pixels wide, one word per line, and a member's email ran
 * underneath the "Reset password" button.
 *
 * So this asks the question directly: on a phone, does the text still get a
 * usable share of its row?
 */
test.describe('rows on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * How much of its row the text block must get. Measured at 390px: 0.60 on
   * the recurring rule and 0.92 on the member row as they stand, against 0.11
   * and 0.31 with the basis taken away. Half is the gap between those.
   */
  const USABLE_SHARE = 0.5;

  test('a recurring rule keeps a readable share of its row', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const household = await seedStatsHousehold(playwright.request, baseURL!, {});
    const category = household.categories.find((c) => c.name === 'Rent & Bills')!;

    // The widest case in the app: this row carries an amount, a text button and
    // two icon buttons beside its description.
    await household.api.post('/api/recurring', {
      data: {
        amount: 320,
        description: 'Rent',
        categoryId: category.id,
        frequency: 'monthly',
        startsOn: monthsAgo(2),
      },
    });

    await openFromHeader(page, household.email, 'Recurring', '/recurring');

    const row = page.locator('.item').first();
    const main = row.locator('.item-main');
    await expect(main).toBeVisible();

    const rowBox = (await row.boundingBox())!;
    const mainBox = (await main.boundingBox())!;
    expect(mainBox.width / rowBox.width).toBeGreaterThan(USABLE_SHARE);

    // The meta line reads as a line, not a stack. Four separated facts in a
    // sixty-pixel column ran to ten lines and made the card three times taller
    // than the row needed to be.
    const metaBox = (await row.locator('.item-meta').boundingBox())!;
    expect(metaBox.height).toBeLessThan(60);
  });

  test('a household member email is not squeezed under the reset button', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const household = await seedStatsHousehold(playwright.request, baseURL!, {
      memberNames: ['Yossi'],
    });

    await openFromHeader(page, household.email, 'Household', '/household');

    // The owner's own row carries no remove button, so take a member's: it is
    // the crowded one, and it is where the email disappeared.
    const row = page.locator('.item').filter({ hasText: 'Yossi' }).first();
    const main = row.locator('.item-main');
    await expect(main).toBeVisible();

    const rowBox = (await row.boundingBox())!;
    const mainBox = (await main.boundingBox())!;
    expect(mainBox.width / rowBox.width).toBeGreaterThan(USABLE_SHARE);

    // An email has no spaces to break at, so a squeezed row does not wrap it —
    // it paints straight through whatever sits beside it. The glyphs land
    // outside the element's box when that happens, which is why this asks
    // whether the text fits its box rather than comparing rectangles: the
    // boxes never overlapped, only the ink did.
    const emailFits = await main.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(emailFits).toBe(true);
  });
});
