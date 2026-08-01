import { expect, test } from '@playwright/test';
import { monthsAgo, openStatistics, seedStatsHousehold } from './helpers';

/**
 * The statistics page, in a browser, against the production build.
 *
 * Every bug this page has had was invisible to the server suite: a fold bucket
 * that borrowed a real category's name, a one-month range drawing a lone dot,
 * a control that existed but could not be reached. Those are questions about
 * what is on the screen, so they are asked here.
 */
test.describe('statistics', () => {
  test('reaches the page from the header and splits the money both ways', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const household = await seedStatsHousehold(playwright.request, baseURL!, {
      memberNames: ['Yossi'],
    });
    const [dana, yossi] = household.members;
    const groceries = household.categories.find((c) => c.name === 'Groceries')!;
    const transport = household.categories.find((c) => c.name === 'Transport')!;

    await household.api.post('/api/expenses', {
      data: { amount: 60, categoryId: groceries.id, paidBy: dana.id, spentOn: monthsAgo(0) },
    });
    await household.api.post('/api/expenses', {
      data: { amount: 40, categoryId: transport.id, paidBy: yossi.id, spentOn: monthsAgo(2) },
    });
    // No category at all: it must still be counted, under its own row.
    await household.api.post('/api/expenses', {
      data: { amount: 5, categoryId: null, paidBy: dana.id, spentOn: monthsAgo(1) },
    });

    await openStatistics(page, household.email);

    // The total covers the default six-month range, so all three land in it.
    // Scoped to the tile: the same figure is also in the cross-tab table, which
    // is in the DOM even while its <details> is shut.
    await expect(page.locator('.stat', { hasText: 'Total spent' })).toContainText('105.00');

    // Row by row: the amount also appears in each row's "· $x average" line,
    // so the assertion has to name whose row it is.
    const whoSpent = page.locator('.card', { has: page.getByRole('heading', { name: 'Who spent what' }) });
    await expect(whoSpent.locator('.budget-row', { hasText: 'Dana' })).toContainText('65.00');
    await expect(whoSpent.locator('.budget-row', { hasText: 'Yossi' })).toContainText('40.00');

    const whereItWent = page.locator('.card', { has: page.getByRole('heading', { name: 'Where it went' }) });
    await expect(whereItWent.getByRole('button', { name: /Groceries/ })).toContainText('60.00');
    await expect(whereItWent.getByRole('button', { name: /Transport/ })).toContainText('40.00');
    await expect(whereItWent.getByRole('button', { name: /Uncategorised/ })).toContainText('5.00');

    // One pie per person who spent, and the numbers behind them on request.
    await expect(page.locator('.pie')).toHaveCount(2);
    await page.getByText('Show the numbers').click();
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader', { name: 'Dana' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Yossi' })).toBeVisible();
    await expect(table.getByRole('row', { name: /Groceries/ })).toContainText('60.00');
  });

  test('opens a category to show how it moved, and closes it again', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const household = await seedStatsHousehold(playwright.request, baseURL!);
    const groceries = household.categories.find((c) => c.name === 'Groceries')!;

    for (const [monthsBack, amount] of [
      [0, 30],
      [1, 10],
      [3, 20],
    ] as const) {
      await household.api.post('/api/expenses', {
        data: { amount, categoryId: groceries.id, spentOn: monthsAgo(monthsBack) },
      });
    }

    await openStatistics(page, household.email);
    const row = page.getByRole('button', { name: /Groceries/ });
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.trend-panel')).toHaveCount(0);

    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    // A real chart, and the summary that reads the peak off it.
    await expect(page.locator('.trend-chart')).toBeVisible();
    await expect(page.locator('.trend-panel')).toContainText('a month on average');
    await expect(page.locator('.trend-panel')).toContainText('30.00');

    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.trend-panel')).toHaveCount(0);
  });

  test('says so rather than drawing a chart when the range is one month', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const household = await seedStatsHousehold(playwright.request, baseURL!);
    const groceries = household.categories.find((c) => c.name === 'Groceries')!;
    await household.api.post('/api/expenses', {
      data: { amount: 25, categoryId: groceries.id, spentOn: monthsAgo(0) },
    });

    await openStatistics(page, household.email);
    await page.getByRole('button', { name: 'This month' }).click();
    await page.getByRole('button', { name: /Groceries/ }).click();

    await expect(page.locator('.trend-panel')).toContainText('Widen the range');
    await expect(page.locator('.trend-panel')).toContainText('25.00');
    // One point is not a trend: there must be no chart to misread.
    await expect(page.locator('.trend-chart')).toHaveCount(0);
  });

  test('folds the tail without borrowing the name of a real category', async ({
    page,
    playwright,
    baseURL,
  }) => {
    // Eight people for six colour slots, and spending in every category, so
    // both folds have to happen. Eight and not seven: a lone folded member is
    // deliberately still shown by name, and it takes two before the bucket
    // needs a name of its own. A household is seeded with a category called
    // "Other" — the fold buckets must not answer to that name too.
    const household = await seedStatsHousehold(playwright.request, baseURL!, {
      memberNames: ['Batya', 'Chen', 'Dov', 'Efrat', 'Gil', 'Hila', 'Itai'],
    });
    expect(household.members).toHaveLength(8);
    expect(household.categories.map((c) => c.name)).toContain('Other');

    for (const [index, member] of household.members.entries()) {
      for (const category of household.categories) {
        await household.api.post('/api/expenses', {
          data: {
            amount: 10 + index,
            categoryId: category.id,
            paidBy: member.id,
            spentOn: monthsAgo(0),
          },
        });
      }
    }

    await openStatistics(page, household.email);

    const memberLegend = page
      .locator('.card', { has: page.getByRole('heading', { name: 'Month by month' }) })
      .locator('.legend');
    await expect(memberLegend).toContainText('Other people');

    const sliceLegend = page
      .locator('.card', { has: page.getByRole('heading', { name: 'per category' }) })
      .locator('.legend');
    await expect(sliceLegend).toContainText('Everything else (');

    // The real category keeps its own name, and is still its own openable row.
    const realOther = page.getByRole('button', { name: /^Other/ });
    await expect(realOther).toBeVisible();
    await realOther.click();
    await expect(page.locator('.trend-panel')).toHaveCount(1);

    // No fold bucket may be called "Other": the word belongs to the category,
    // and it may appear once in the slice legend for exactly that reason.
    const memberLabels = (await memberLegend.innerText()).split('\n').map((line) => line.trim());
    const sliceLabels = (await sliceLegend.innerText()).split('\n').map((line) => line.trim());
    expect(memberLabels).not.toContain('Other');
    expect(sliceLabels.filter((label) => label === 'Other')).toHaveLength(1);
    expect(sliceLabels.at(-1)).toMatch(/^Everything else \(\d+\)$/);
  });
});
