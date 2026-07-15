import { Page } from '@playwright/test';

/**
 * Test user credentials and API helpers for browser E2E tests.
 *
 * The web app is built for production (no mock Google button), so authenticated
 * tests create real users through the API and then log in through the email/password
 * form. This keeps the tests realistic and avoids relying on development-only UI.
 */

export interface TestUser {
  email: string;
  password: string;
  role: 'developer' | 'advertiser';
}

const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:4002/api/v1';

/** Generate a unique test user so repeated runs don't collide. */
export function makeTestUser(role: 'developer' | 'advertiser'): TestUser {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `e2e-${role}-${suffix}@waitlayer.test`,
    password: 'TestPassword123!',
    role,
  };
}

async function waitForApiReady(attempts = 60, delayMs = 1_000): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${API_BASE_URL}/health/ready`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
    } catch {
      // API not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('API did not become ready in time for E2E tests');
}

async function fetchPolicyVersion(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/consent/required-versions`);
  if (!res.ok) {
    throw new Error(`Failed to fetch consent policy version: ${res.status}`);
  }
  const data = (await res.json()) as Record<string, string>;
  const version = data.terms_of_service || data.privacy_policy || Object.values(data)[0];
  if (!version) {
    throw new Error('No consent policy version returned by API');
  }
  return version;
}

/**
 * Create a test user via the public signup API.
 * Safe to call multiple times — the API will return 409 if the user already exists,
 * which we ignore so tests can be retried.
 */
export async function createTestUser(user: TestUser): Promise<void> {
  await waitForApiReady();
  const policyVersion = await fetchPolicyVersion();

  const res = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      role: user.role,
      ageConfirmed: true,
      termsAccepted: true,
      policyVersion,
    }),
  });

  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => 'unknown');
    throw new Error(`Failed to create test user: ${res.status} ${body}`);
  }
}

/**
 * Log in through the web UI using email and password.
 */
export async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/auth/login');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('button[type="submit"]').click();
  // Wait for redirect away from login
  await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 15_000 });
}

/**
 * Delete a test user via the public delete-account API.
 * This is best-effort — the endpoint may require step-up re-auth in some
 * environments, in which case the user is left in the database. Unique emails
 * from {@link makeTestUser} prevent collisions across runs.
 */
export async function deleteTestUser(user: TestUser): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    if (!res.ok) return;
    const { access_token: token } = (await res.json()) as { access_token?: string };
    if (!token) return;

    await fetch(`${API_BASE_URL}/developer/delete-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirmation: 'DELETE_MY_ACCOUNT' }),
    });
  } catch {
    // Best-effort cleanup; don't fail the test suite.
  }
}

/**
 * Ensure a test user exists and is logged in on the given page.
 */
export async function ensureUserAndLogin(page: Page, user: TestUser): Promise<void> {
  await createTestUser(user);
  await loginAs(page, user);
}
