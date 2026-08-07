import { expect, test } from '@playwright/test';
import { PASSWORD, seedAccountWithHousehold, uniqueEmail } from './helpers';

/**
 * One account, more than one household.
 *
 * The server suite proves the data stays apart; these are the questions only a
 * browser can answer — whether the control to move between them exists, whether
 * using it actually repaints the page, and what a brand new account is shown
 * before it has a household at all.
 */
test.describe('several households', () => {
  test('switches between two households and shows each one’s own money', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('multi');
    await seedAccountWithHousehold(request, {
      email,
      householdName: 'Home',
      displayName: 'Dana',
    });
    await request.post('/api/expenses', {
      data: { amount: 12.5, description: 'Home groceries', spentOn: monthDay() },
    });

    // A second household on the same account, which creating switches into.
    const beach = await request.post('/api/households', {
      data: { name: 'Beach Flat', currency: 'USD', displayName: 'Dana' },
    });
    expect(beach.ok()).toBeTruthy();
    await request.post('/api/expenses', {
      data: { amount: 99, description: 'Beach deckchair', spentOn: monthDay() },
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Signing in lands back in the household last open — the beach flat.
    await page.waitForURL('/');
    await expect(page.getByText('Beach deckchair')).toBeVisible();
    await expect(page.getByText('Home groceries')).toHaveCount(0);

    // The switcher is a real control, and using it changes what is on screen.
    const switcher = page.getByLabel('Household');
    await expect(switcher).toBeVisible();
    await switcher.selectOption({ label: 'Home' });

    await expect(page.getByText('Home groceries')).toBeVisible();
    await expect(page.getByText('Beach deckchair')).toHaveCount(0);

    // And it survives a reload, because the choice is in the session cookie
    // rather than in the page's memory.
    await page.reload();
    await expect(page.getByText('Home groceries')).toBeVisible();
  });

  test('offers a way back to the households list with only one household', async ({
    page,
    request,
  }) => {
    // The case that shipped broken: with a single household the switcher
    // collapsed to plain text, so there was no route to /households at all —
    // and therefore no way to create a second one.
    const email = uniqueEmail('only');
    await seedAccountWithHousehold(request, {
      email,
      householdName: 'Test2',
      displayName: 'Dana',
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/');

    const switcher = page.getByLabel('Household');
    await expect(switcher).toBeVisible();
    await switcher.selectOption({ label: 'Households…' });

    await expect(page).toHaveURL('/households');
    await expect(page.getByRole('heading', { name: 'Your households' })).toBeVisible();
    // And from there a second one can actually be made — the reason the way
    // out has to exist even when there is nothing to switch between.
    await expect(page.getByRole('button', { name: 'Create a household' })).toBeEnabled();

    // Back in, without having to sign out and in again.
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL('/');
  });

  test('a brand new account is sent to the picker, and told to confirm first', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(uniqueEmail('new'));
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Confirm your address' })).toBeVisible();
    // Nothing is emailed in this suite — no provider is configured — so the
    // confirmation link has to be on screen, and said to be the only copy.
    await expect(page.getByText(/this link is the only copy/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();

    await page.getByRole('button', { name: 'Continue' }).click();

    // No household, so the app has nowhere else it can put them.
    await expect(page).toHaveURL('/households');
    await expect(page.getByText('You are not in a household yet.')).toBeVisible();

    // And creating one is refused until the address is confirmed — said on the
    // page rather than discovered by pressing the button.
    await expect(page.getByRole('button', { name: 'Create a household' })).toBeDisabled();
    await expect(page.getByText(/before creating or joining a household/)).toBeVisible();
  });

  test('an invitation waiting for your address can be joined from the picker', async ({
    page,
    request,
  }) => {
    // The case a real household hit: the invited person registered from the
    // invite email and never opened the link again, so the picker showed them
    // nothing and there was no way back to the invite.
    const invitedEmail = uniqueEmail('invitee');
    await seedAccountWithHousehold(request, {
      email: uniqueEmail('inviter'),
      householdName: 'The Flat',
      displayName: 'Dana',
    });
    const invite = await request.post('/api/household/invites', {
      data: { email: invitedEmail, role: 'member' },
    });
    expect(invite.ok()).toBeTruthy();

    await page.goto('/register');
    await page.getByLabel('Email').fill(invitedEmail);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    // No provider in this suite, so the confirmation link is on screen.
    const confirmUrl = (await page.locator('code').first().textContent())!.trim();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page).toHaveURL('/households');
    await expect(page.getByText('You have an invitation')).toBeVisible();
    await expect(page.getByText('The Flat')).toBeVisible();
    // Joining is still gated on the address being confirmed.
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeDisabled();

    await page.goto(confirmUrl);
    await page.getByRole('button', { name: /confirm/i }).click();
    await expect(page).toHaveURL('/households');

    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await page.getByLabel('Your name in that household').fill('Noa');
    await page.getByRole('button', { name: 'Join household' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByLabel('Household')).toBeVisible();
    // And it is gone from the picker once redeemed.
    await page.goto('/households');
    await expect(page.getByText('You have an invitation')).toHaveCount(0);
  });

  test('an account with no household can still delete itself', async ({ page }) => {
    // `/households` is the only place this action lives, and the only screen
    // an account in this state can reach — without it there was no way out at
    // all.
    const email = uniqueEmail('closing');
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL('/households');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.getByLabel('Confirm with your password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Delete my account' }).click();

    await expect(page).toHaveURL('/login');
    // Really gone: the address is free again rather than "already taken".
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Incorrect email or password')).toBeVisible();
  });
});

/** Today, in the app's own local-time reckoning. */
function monthDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}
