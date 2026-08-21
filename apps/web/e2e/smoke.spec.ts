import { expect, test } from '@playwright/test';

import { createTestUser, deleteTestUser, loginAs, makeTestUser, TestUser } from './fixtures/users';

/**
 * Ateva browser E2E smoke tests.
 *
 * These tests verify the most critical user-facing pages render correctly
 * in a real browser (Chromium). They complement the vitest unit/integration
 * tests by catching hydration errors, layout regressions, and missing
 * content that only surface in a real DOM.
 *
 * Required services:
 *   - Web: `pnpm --filter ateva-web build && pnpm --filter ateva-web start`
 *   - API: `pnpm --filter ateva-api build && node apps/api/dist/apps/api/src/main.js`
 *     (for API-dependent pages like /developer)
 *
 * Authenticated tests create real users through the public signup API and then
 * log in via the email/password form. This avoids relying on the mock Google
 * button, which is only available in development builds.
 *
 * Run with: pnpm --filter ateva-web e2e
 */

const developerUser: TestUser = makeTestUser('developer');
const advertiserUser: TestUser = makeTestUser('advertiser');

test.describe('Landing page', () => {
  test('renders the hero section and navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Ateva/i);
    await expect(page.locator('h1').first()).toBeVisible();
    const nav = page.locator('nav').first();
    await expect(nav).toHaveCount(1);
    // The primary nav is hidden below the md breakpoint (no mobile menu yet).
    const width = page.viewportSize()?.width ?? 0;
    if (width >= 768) {
      await expect(nav).toBeVisible();
    } else {
      await expect(nav).toBeHidden();
    }
  });

  test('has no console errors', async ({ page }) => {
    const errors: string[] = [];
    const unauthorized: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.status() === 401) unauthorized.push(new URL(res.url()).pathname);
    });

    await page.goto('/');
    // Assert only once the client bundle has mounted and gone quiet. Asserting
    // straight after `goto` raced the bundler: whether AuthProvider's bootstrap
    // had fired yet depended on the chunk graph, so this passed under Turbopack
    // and failed under webpack for reasons that had nothing to do with the page.
    await page.waitForLoadState('networkidle');

    // AuthProvider calls `/api/auth/me` on mount; on 401 the client interceptor
    // makes one `/api/auth/refresh` attempt. For an anonymous visitor both
    // legitimately return 401 and the browser logs each as a console error —
    // that is the logged-out bootstrap path, not a defect. The console text
    // carries no URL, so pin the tolerance to the observed response paths
    // instead of blanket-filtering the message; a 401 from anywhere else still
    // fails this test.
    expect(unauthorized, 'unexpected 401 outside the auth bootstrap').toEqual(
      unauthorized.filter((path) => /^\/api\/auth\/(me|refresh)$/.test(path)),
    );

    // Allow hydration warnings and those bootstrap 401s; fail on real JS errors.
    const tolerated = (message: string) =>
      message.includes('hydrat') || message.includes('401 (Unauthorized)');
    expect(errors.filter((e) => !tolerated(e))).toHaveLength(0);
  });
});

test.describe('Comparison page (A-033)', () => {
  test('renders all 6 Live tool labels', async ({ page }) => {
    await page.goto('/comparison');
    await expect(page).toHaveTitle(/Comparison/i);

    const liveTools = ['VS Code', 'Cursor', 'Windsurf', 'Cline', 'Claude Code', 'Terminal'];
    for (const tool of liveTools) {
      await expect(page.getByText(tool, { exact: false }).first()).toBeVisible();
    }

    await expect(page.getByText('Live').first()).toBeVisible();
  });
});

test.describe('Privacy page (A-036)', () => {
  test('renders CCPA opt-out section', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByText(/CCPA|California Privacy/i).first()).toBeVisible();
    await expect(page.getByText(/Do Not Sell/i).first()).toBeVisible();
  });
});

test.describe('Cookie consent (A-047)', () => {
  test('shows cookie consent banner on first visit', async ({ page }) => {
    await page.goto('/');
    const consentText = page.locator('text=/cookie|consent|accept|decline/i');
    await expect(consentText.first()).toBeVisible({ timeout: 15_000 });
  });

  test('cookie settings link is present in footer', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer').first();
    await expect(footer).toBeVisible();
    // The footer contains a "Cookie Settings" button that opens consent prefs
    await expect(page.getByText('Cookie Settings').first()).toBeVisible();
  });
});

test.describe('Authentication pages', () => {
  test('login page renders with email and password fields', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('h1').first()).toHaveText(/Welcome back|Sign in/i);
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('signup page renders with role selection', async ({ page }) => {
    await page.goto('/auth/signup');
    await expect(page.locator('h1').first()).toHaveText(/Create your account|Sign up/i);
    await expect(page.getByText('Developer').first()).toBeVisible();
    await expect(page.getByText('Advertiser').first()).toBeVisible();
  });
});

test.describe('Protected routes redirect when unauthenticated', () => {
  test('redirects /developer to login when not authenticated', async ({ page }) => {
    await page.goto('/developer');
    await page.waitForURL(/\/auth\/login/i, { timeout: 10_000 });
  });

  test('redirects /advertiser to login when not authenticated', async ({ page }) => {
    await page.goto('/advertiser');
    await page.waitForURL(/\/auth\/login/i, { timeout: 10_000 });
  });
});

// ── Advertiser waitlist (LAUNCH_PLAN Phase 2 step 11) ──
test.describe('Advertiser waitlist', () => {
  test('renders the waitlist page with the signup form', async ({ page }) => {
    await page.goto('/advertisers');
    await expect(page).toHaveTitle(/Advertisers/i);
    await expect(page.getByText('Join the advertiser waitlist').first()).toBeVisible();
    await expect(page.getByLabel('Work email')).toBeVisible();
    await expect(page.getByRole('button', { name: /Join the advertiser waitlist/i })).toBeVisible();
  });

  test('submits a signup and shows the recorded state', async ({ page }) => {
    const email = `e2e-waitlist-${Date.now()}@ateva.test`;
    await page.goto('/advertisers');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel(/I agree to receive email updates/i).check();
    await page.getByRole('button', { name: /Join the advertiser waitlist/i }).click();
    await expect(page.getByRole('status').first()).toContainText(/on the advertiser waitlist/i, {
      timeout: 15_000,
    });
  });
});

// ── Developer dashboard E2E (requires authenticated session) ──
test.describe('Developer dashboard (authenticated)', () => {
  test.beforeAll(async () => {
    await createTestUser(developerUser);
  });

  test.afterAll(async () => {
    await deleteTestUser(developerUser);
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, developerUser);
  });

  test('renders the developer dashboard with earnings cards', async ({ page }) => {
    await page.goto('/developer');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Estimated today').first()).toBeVisible();
    await expect(page.getByText('Available payout').first()).toBeVisible();
    await expect(page.getByText('Confirmed').first()).toBeVisible();
    await expect(page.getByText('Lifetime').first()).toBeVisible();
  });

  test('discloses telemetry-only beta status and the client activation path', async ({ page }) => {
    // Keep this content contract independent of the shared database's current
    // kill-switch state (which may be `paused` in CI). The dashboard and
    // device-registration read remain real; only the public health response is
    // fixed to the beta mode this test is proving.
    await page.route('**/api/platform-health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ waitLaunchMode: 'telemetry_only' }),
      }),
    );
    await page.goto('/developer');
    await expect(page.getByRole('status', { name: /private beta.*no earnings/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Get started — connect a client' })).toBeVisible(
      {
        timeout: 15_000,
      },
    );
    await expect(page.getByText(/install one below, sign in/i)).toBeVisible();
    await expect(page.getByText(/Not yet published to npm/i)).toBeVisible();
  });

  test('renders the trust and payout status section', async ({ page }) => {
    await page.goto('/developer');
    await expect(page.getByText('Trust & Payout Status').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Reward schedule').first()).toBeVisible();
    await expect(page.getByText(/Rewards are disabled during the private beta/i)).toBeVisible();
  });

  test('developer settings page renders', async ({ page }) => {
    await page.goto('/developer/settings');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });

  test('developer earnings page renders', async ({ page }) => {
    await page.goto('/developer/earnings');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });

  test('developer payouts page renders', async ({ page }) => {
    await page.goto('/developer/payouts');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });
});

// ── Advertiser campaign creation E2E (requires authenticated session) ──
test.describe('Advertiser campaign creation (authenticated)', () => {
  test.beforeAll(async () => {
    await createTestUser(advertiserUser);
  });

  test.afterAll(async () => {
    await deleteTestUser(advertiserUser);
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, advertiserUser);
  });

  test('renders the new campaign form with all required fields', async ({ page }) => {
    await page.goto('/advertiser/campaigns/new');
    await expect(page.locator('h1').first()).toHaveText('Create campaign');
    // Prefer getByLabel to verify the visible label is programmatically associated.
    await expect(page.getByLabel('Campaign name')).toBeVisible();
    await expect(page.getByLabel('Bid type')).toBeVisible();
    await expect(page.getByLabel('Bid amount (USD)')).toBeVisible();
    await expect(page.getByLabel('Total budget (USD)')).toBeVisible();
  });

  test('shows ad creative section with headline and message inputs', async ({ page }) => {
    await page.goto('/advertiser/campaigns/new');
    await expect(page.getByText('Ad creative').first()).toBeVisible();
    await expect(page.getByLabel('Headline')).toBeVisible();
    await expect(page.getByLabel('Message')).toBeVisible();
  });

  test('renders targeting section with country input', async ({ page }) => {
    await page.goto('/advertiser/campaigns/new');
    await expect(page.getByText('Targeting').first()).toBeVisible();
    await expect(page.getByLabel('Country targeting (comma-separated ISO codes)')).toBeVisible();
  });

  test('submit button is present', async ({ page }) => {
    await page.goto('/advertiser/campaigns/new');
    await expect(page.locator('button[type="submit"]').first()).toBeVisible({ timeout: 15_000 });
  });

  test('advertiser dashboard renders with campaign list or empty state', async ({ page }) => {
    await page.goto('/advertiser');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });
});
