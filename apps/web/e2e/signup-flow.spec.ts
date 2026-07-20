import { expect, test } from '@playwright/test';

import { createTestUser, deleteTestUser, loginAs, makeTestUser, TestUser } from './fixtures/users';

/**
 * A-047 — full multi-step browser signup / cookie lifecycle E2E.
 *
 * Complements the in-process `e2e-http-flow.spec.ts` (signup API + cookie
 * issuance + consent versioning) and the `smoke.spec.ts` cookie-consent banner
 * check by exercising the flow in a real browser:
 *   1. a real UI login sets the auth cookie,
 *   2. an authenticated route is reachable,
 *   3. clearing the cookie forces re-authentication (expire → re-prompt).
 *
 * Also asserts the Google sign-in control is wired (A-018): the "Continue with
 * Google" control renders whether or not a client ID is configured, so this is
 * verifiable without live Google credentials. The real Google ID-token
 * callback still requires live credentials (see docs/ops/remaining-open-items.md).
 *
 * Required stack (same as smoke.spec.ts):
 *   pnpm --filter waitlayer-web build && pnpm --filter waitlayer-web start
 *   pnpm --filter waitlayer-api build && node apps/api/dist/apps/api/src/main.js
 *
 * Run with: pnpm --filter waitlayer-web e2e
 */

const user: TestUser = makeTestUser('developer');

test.describe('A-047 signup / cookie lifecycle', () => {
  test.beforeAll(async () => {
    await createTestUser(user);
  });

  test.afterAll(async () => {
    await deleteTestUser(user);
  });

  test('UI login sets an auth cookie and reaches an authenticated route', async ({
    page,
    context,
  }) => {
    await loginAs(page, user);

    const cookies = await context.cookies();
    const authCookie = cookies.find((c) => /access_token|session|refresh/i.test(c.name));
    expect(authCookie, 'expected an auth/session cookie after login').toBeDefined();

    await page.goto('/developer');
    await expect(page).toHaveURL(/\/developer/);
    // A-047: the auth cookie is valid and the authenticated dashboard chrome
    // rendered (nav with Overview/Earnings/Payouts). The dashboard data
    // section is client-fetched and may error in a manual local run; we
    // assert the authenticated route itself is reachable, not the data load.
    await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('clearing the auth cookie forces re-authentication (expire → re-prompt)', async ({
    page,
    context,
  }) => {
    await loginAs(page, user);
    await page.goto('/developer');
    await expect(page).toHaveURL(/\/developer/);

    await context.clearCookies();
    await page.goto('/developer');
    await page.waitForURL(/\/auth\/login/i, { timeout: 10_000 });
  });
});

test.describe('A-018 Google sign-in wiring', () => {
  test('Google sign-in control is present on the login page', async ({ page }) => {
    await page.goto('/auth/login');
    // Renders in both enabled (GIS button) and disabled ("client ID missing")
    // states, so this is verifiable without live Google credentials.
    await expect(page.getByText('Continue with Google').first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
