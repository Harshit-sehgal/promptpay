import { expect, test } from '@playwright/test';

import { createTestUser, deleteTestUser, loginAs, makeTestUser, TestUser } from './fixtures/users';

/**
 * W1.5 — Dodo deposit rail content gate (no sandbox credentials required).
 *
 * The full deposit-journey test against the Dodo sandbox is blocked on §8.1/
 * §8.3 (webhook secret + a configured wallet-top-up product). This is the
 * plan's fallback: it proves the billing surface (1) renders the Dodo rail and
 * (2) fails closed — no processor is configured in a dev/e2e environment, so a
 * deposit attempt must show a clean "temporarily disabled" error and must NOT
 * navigate away to a hosted checkout URL.
 */
const advertiserUser: TestUser = makeTestUser('advertiser');

test.describe('Advertiser billing — Dodo deposit rail (content gate)', () => {
  test.beforeAll(async () => {
    await createTestUser(advertiserUser);
  });

  test.afterAll(async () => {
    await deleteTestUser(advertiserUser);
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, advertiserUser);
  });

  test('renders the Dodo deposit rail', async ({ page }) => {
    await page.goto('/advertiser/billing');
    await expect(page.locator('h1').first()).toHaveText('Billing');
    // The deposit card renders only after the ledger loads; wait for its heading.
    await expect(page.getByText('Deposit funds').first()).toBeVisible({ timeout: 15_000 });
    // Content gate: the rail is Dodo Payments, not the inactive Stripe rail.
    await expect(page.getByText('Dodo Payments', { exact: false }).first()).toBeVisible();
    await expect(
      page.getByText('Add funds to your account via Dodo Payments').first(),
    ).toBeVisible();
  });

  test('fails closed with no processor configured (no redirect to a checkout URL)', async ({
    page,
  }) => {
    await page.goto('/advertiser/billing');
    await expect(page.getByText('Deposit funds').first()).toBeVisible({ timeout: 15_000 });

    // Select the smallest preset ($1.00) so the deposit button becomes enabled.
    const preset = page.getByRole('button', { name: /\$/ }).first();
    await expect(preset).toBeVisible();
    await preset.click();

    const depositButton = page.getByRole('button', { name: /via Dodo Payments/ });
    await expect(depositButton).toBeEnabled();
    await depositButton.click();

    // Fail-closed: DEPOSIT_PROCESSOR is unset in the e2e environment, so the
    // deposit-session endpoint returns 400 and the page surfaces the message
    // instead of redirecting to a hosted checkout.
    await expect(page.getByText(/temporarily disabled/i).first()).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('/advertiser/billing');
  });
});
