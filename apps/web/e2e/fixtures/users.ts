import { Page } from '@playwright/test';

import { generateTotp } from '@waitlayer/shared';

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

interface LoginApiResponse {
  accessToken?: string;
  user?: {
    twoFactorEnabled?: boolean;
  };
}

interface TwoFactorSetupResponse {
  secret?: string;
}

interface StepUpResponse {
  stepUpToken?: string;
}

async function responseDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => 'unreadable response');
  return body.slice(0, 500);
}

async function requireOk(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${operation} failed: ${response.status} ${await responseDetail(response)}`);
}

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
  // Wait for redirect away from login. 30s headroom: the BFF does two
  // sequential API calls (login + /auth/me) and under CI suite load the
  // local API can be slow enough to exceed a tighter budget on emulated
  // mobile devices.
  await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 45_000 });
}

/**
 * Delete a test user through the same production security boundary as the UI.
 *
 * Account erasure requires both password re-authentication and an
 * action-scoped MFA step-up. Cleanup therefore enrolls 2FA for ordinary test
 * users before deleting them. If a test already enabled 2FA, pass the secret
 * it received so cleanup can log in and obtain a fresh step-up token.
 *
 * A 401 at the initial login is the one tolerated outcome: the test either
 * deleted the account itself or failed before signup completed. Every other
 * failure is surfaced so cleanup cannot manufacture a green suite while rows
 * accumulate in the database.
 */
export async function deleteTestUser(
  user: TestUser,
  options: { totpSecret?: string } = {},
): Promise<void> {
  let totpSecret = options.totpSecret;
  const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      ...(totpSecret ? { twoFactorToken: generateTotp(totpSecret) } : {}),
    }),
  });
  if (loginRes.status === 401) {
    const detail = await responseDetail(loginRes);
    if (/twoFactorRequired|two-factor authentication code required/i.test(detail)) {
      throw new Error(
        'E2E cleanup reached a 2FA-enabled user without a valid TOTP secret; pass totpSecret',
      );
    }
    return;
  }
  await requireOk(loginRes, 'E2E cleanup login');

  const login = (await loginRes.json()) as LoginApiResponse;
  const accessToken = login.accessToken;
  if (!accessToken) {
    throw new Error('E2E cleanup login returned no accessToken');
  }
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  if (login.user?.twoFactorEnabled !== true) {
    const setupRes = await fetch(`${API_BASE_URL}/auth/2fa/setup`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ currentPassword: user.password }),
    });
    await requireOk(setupRes, 'E2E cleanup 2FA setup');
    const setup = (await setupRes.json()) as TwoFactorSetupResponse;
    if (!setup.secret) {
      throw new Error('E2E cleanup 2FA setup returned no secret');
    }
    totpSecret = setup.secret;

    const enableRes = await fetch(`${API_BASE_URL}/auth/2fa/enable`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ token: generateTotp(totpSecret) }),
    });
    await requireOk(enableRes, 'E2E cleanup 2FA enable');
  }

  if (!totpSecret) {
    throw new Error('E2E cleanup cannot delete a 2FA-enabled user without its TOTP secret');
  }
  const stepUpRes = await fetch(`${API_BASE_URL}/auth/step-up`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ action: 'account:delete', token: generateTotp(totpSecret) }),
  });
  await requireOk(stepUpRes, 'E2E cleanup account-delete step-up');
  const stepUp = (await stepUpRes.json()) as StepUpResponse;
  if (!stepUp.stepUpToken) {
    throw new Error('E2E cleanup step-up response returned no stepUpToken');
  }

  const endpoint =
    user.role === 'developer' ? 'developer/delete-account' : 'advertiser/delete-account';
  const deleteRes = await fetch(`${API_BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: { ...authHeaders, 'x-step-up-token': stepUp.stepUpToken },
    body: JSON.stringify({
      confirmation: 'DELETE_MY_ACCOUNT',
      currentPassword: user.password,
      forfeitBalance: true,
    }),
  });
  await requireOk(deleteRes, `E2E cleanup ${user.role} account deletion`);
}

/** Assert that erased credentials can no longer create a session. */
export async function assertTestUserCannotLogin(user: TestUser): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (response.status !== 401) {
    throw new Error(
      `Erased E2E user unexpectedly received login status ${response.status}: ${await responseDetail(response)}`,
    );
  }
}

/**
 * Ensure a test user exists and is logged in on the given page.
 */
export async function ensureUserAndLogin(page: Page, user: TestUser): Promise<void> {
  await createTestUser(user);
  await loginAs(page, user);
}
