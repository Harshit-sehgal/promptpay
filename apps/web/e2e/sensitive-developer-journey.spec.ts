import { expect, Page, test } from '@playwright/test';

import { generateTotp } from '@waitlayer/shared';

import {
  assertTestUserCannotLogin,
  deleteTestUser,
  makeTestUser,
  TestUser,
} from './fixtures/users';

const user: TestUser = makeTestUser('developer');
const payoutEmail = user.email.replace('e2e-developer-', 'payout-');
let totpSecret: string | undefined;

function isWebResponse(
  response: { url(): string; request(): { method(): string } },
  path: string,
  method: string,
): boolean {
  return new URL(response.url()).pathname === path && response.request().method() === method;
}

async function expectResponseOk(
  responsePromise: Promise<{ ok(): boolean; status(): number; text(): Promise<string> }>,
  operation: string,
): Promise<void> {
  const response = await responsePromise;
  const detail = response.ok()
    ? operation
    : `${operation} returned ${response.status()}: ${(await response.text()).slice(0, 500)}`;
  expect(response.ok(), detail).toBe(true);
}

/**
 * Clear the consent re-prompt if it is showing.
 *
 * `ConsentRePrompt` renders `fixed top-0 inset-x-0 z-50` for any purpose the
 * account has not accepted at the currently required version. On a mobile
 * viewport it stacks vertically and covers the top of the authenticated shell,
 * so it intercepts pointer events for controls underneath it (observed
 * blocking "Sign out"). A real user accepts it first, so the journey does too —
 * suppressing it instead would stop this test from exercising the shell the way
 * a signed-up user actually sees it.
 */
async function acceptConsentRePromptIfShown(page: Page): Promise<void> {
  const banner = page.getByRole('alert', { name: 'Consent update required' });
  // The banner mounts only AFTER its `/consent/stale` request resolves, so a
  // point-in-time `isVisible()` races the fetch and reports "absent" moments
  // before it appears and starts swallowing clicks. Wait a bounded interval for
  // it to settle instead.
  try {
    await banner.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return; // Genuinely no stale consent for this account.
  }
  await banner.getByRole('button', { name: 'Accept' }).click();
  await expect(banner).toBeHidden({ timeout: 15_000 });
}

async function completeStepUp(page: Page, secret: string, expectedAction: RegExp): Promise<void> {
  const dialog = page.getByRole('dialog', {
    name: 'Confirm with two-factor authentication',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(expectedAction);
  await dialog.getByLabel('Two-factor authentication code').fill(generateTotp(secret));
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('production sensitive developer journey', () => {
  test.skip(
    process.env.E2E_PRODUCTION_MODE !== '1',
    'This contract is intentionally reserved for the production-mode API runner.',
  );

  test.afterEach(async () => {
    await deleteTestUser(user, { totpSecret });
  });

  test('signup → 2FA → logout/backup-code login → payout add/remove → GDPR erasure', async ({
    page,
    context,
  }) => {
    await page.goto('/auth/signup');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByLabel(/I confirm that I am at least 18 years old/i).check();
    const signupResponse = page.waitForResponse(
      (response) =>
        isWebResponse(response, '/api/auth/signup', 'POST') && response.status() === 201,
    );
    await page.getByRole('button', { name: 'Create account' }).click();
    await expectResponseOk(signupResponse, 'browser signup');
    await page.waitForURL(/\/developer(?:\/|$)/, { timeout: 30_000 });

    const cookies = await context.cookies();
    expect(
      cookies.some((cookie) => /access[_-]?token/i.test(cookie.name) && cookie.httpOnly),
      'signup should establish an httpOnly access-token cookie through the BFF',
    ).toBe(true);

    await page.goto('/developer/settings');
    await acceptConsentRePromptIfShown(page);
    const twoFactor = page.locator('section[aria-labelledby="two-factor-heading"]');
    await expect(
      twoFactor.getByRole('heading', { name: 'Two-factor authentication' }),
    ).toBeVisible();
    await twoFactor.getByLabel('Current password').fill(user.password);
    const setupResponse = page.waitForResponse((response) =>
      isWebResponse(response, '/api/auth/2fa/setup', 'POST'),
    );
    await twoFactor.getByRole('button', { name: 'Enable 2FA' }).click();
    await expectResponseOk(setupResponse, '2FA setup');

    const manualKey = twoFactor.locator('code').first();
    await expect(manualKey).toBeVisible();
    totpSecret = (await manualKey.textContent())?.trim();
    expect(totpSecret, '2FA setup must expose the manual enrollment secret').toBeTruthy();

    await twoFactor.getByLabel('Authentication code').fill(generateTotp(totpSecret!));
    const enableResponse = page.waitForResponse((response) =>
      isWebResponse(response, '/api/auth/2fa/enable', 'POST'),
    );
    await twoFactor.getByRole('button', { name: 'Verify and enable' }).click();
    await expectResponseOk(enableResponse, '2FA enable');
    await expect(twoFactor.getByRole('status')).toContainText('Two-factor authentication enabled');
    const backupCodes = twoFactor.getByLabel('Two-factor backup codes').locator('li');
    await expect(backupCodes).toHaveCount(10);
    const loginBackupCode = (await backupCodes.first().textContent())?.trim();
    expect(loginBackupCode, '2FA enablement must return a usable backup code').toBeTruthy();

    const logoutResponse = page.waitForResponse((response) =>
      isWebResponse(response, '/api/auth/logout', 'POST'),
    );
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expectResponseOk(logoutResponse, 'authenticated-shell logout');
    await page.waitForURL(/\/auth\/login$/, { timeout: 15_000 });

    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByLabel('2FA or backup code').fill(loginBackupCode!);
    const loginResponse = page.waitForResponse((response) =>
      isWebResponse(response, '/api/auth/login', 'POST'),
    );
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expectResponseOk(loginResponse, 'backup-code login');
    await page.waitForURL(/\/developer(?:\/|$)/, { timeout: 30_000 });

    await page.goto('/developer/payouts');
    await acceptConsentRePromptIfShown(page);
    const addMethodButton = page.getByRole('button', { name: '+ Add method' });
    await expect(addMethodButton).toBeEnabled({ timeout: 20_000 });
    await addMethodButton.click();
    const addForm = page
      .getByRole('button', { name: 'Add method' })
      .locator('xpath=ancestor::form');
    await addForm.locator('select').first().selectOption('paypal_email');
    await addForm.getByPlaceholder('you@example.com').fill(payoutEmail);

    await addForm.getByRole('button', { name: 'Add method' }).click();
    const addStepUpResponse = page.waitForResponse((response) =>
      isWebResponse(response, '/api/auth/step-up', 'POST'),
    );
    const addPayoutResponse = page.waitForResponse(
      (response) =>
        isWebResponse(response, '/api/payout/method', 'POST') && response.status() === 201,
    );
    await completeStepUp(page, totpSecret!, /add or remove a payout account/i);
    await expectResponseOk(addStepUpResponse, 'payout-method add step-up');
    await expectResponseOk(addPayoutResponse, 'payout-method add');
    await expect(page.getByText('pay***@waitlayer.test')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Confirm removal' }).click();
    const removeStepUpResponse = page.waitForResponse((response) =>
      isWebResponse(response, '/api/auth/step-up', 'POST'),
    );
    const removePayoutResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith('/api/payout/method/') &&
        response.request().method() === 'DELETE' &&
        response.status() === 200,
    );
    await completeStepUp(page, totpSecret!, /add or remove a payout account/i);
    await expectResponseOk(removeStepUpResponse, 'payout-method remove step-up');
    await expectResponseOk(removePayoutResponse, 'payout-method remove');
    await expect(page.getByText('Payout method removed.')).toBeVisible();
    await expect(page.getByText('No payout methods yet.')).toBeVisible({ timeout: 15_000 });

    await page.goto('/developer/settings');
    const erasure = page.locator('section[aria-labelledby="developer-account-erasure-heading"]');
    await expect(erasure.getByRole('heading', { name: 'Delete account' })).toBeVisible();
    await erasure.getByLabel('Current password').fill(user.password);
    await erasure.getByLabel('Type DELETE_MY_ACCOUNT').fill('DELETE_MY_ACCOUNT');
    await erasure.getByRole('checkbox').check();
    await erasure.getByRole('button', { name: 'Permanently delete my account' }).click();
    const deleteStepUpResponse = page.waitForResponse((response) =>
      isWebResponse(response, '/api/auth/step-up', 'POST'),
    );
    const deleteAccountResponse = page.waitForResponse(
      (response) =>
        isWebResponse(response, '/api/developer/delete-account', 'POST') &&
        response.status() === 200,
    );
    await completeStepUp(page, totpSecret!, /permanently delete this account/i);
    await expectResponseOk(deleteStepUpResponse, 'account-delete step-up');
    await expectResponseOk(deleteAccountResponse, 'account deletion');
    await page.waitForURL(/\/auth\/login\?deleted=1$/, { timeout: 20_000 });
    await expect(page.getByRole('status')).toContainText(
      'Your account identity was permanently erased. You have been signed out.',
    );

    await assertTestUserCannotLogin(user);
    await page.goto('/developer');
    await page.waitForURL(/\/auth\/login/i, { timeout: 15_000 });
  });
});
