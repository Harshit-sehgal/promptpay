import { afterEach, describe, expect, it } from 'vitest';

import {
  getStepUpPrompt,
  isStepUpRequired,
  setStepUpPrompt,
  STEP_UP_LABELS,
  stepUpActionFor,
} from './step-up';

/**
 * A-102 regression. Sensitive API routes are guarded by `ActionStepUpGuard` and
 * refuse any request without an `x-step-up-token` header. No client ever sent
 * it and `/auth/step-up` was not on the BFF proxy allowlist, so the entire
 * payout path and both GDPR erasure routes were permanently 403 from the UI.
 *
 * These pin the mapping the interceptor relies on: if a route moves and its
 * action is not remapped here, the interceptor silently stops offering the
 * step-up prompt and the action becomes unreachable again — exactly the
 * original failure, and invisible without this test.
 */
describe('stepUpActionFor', () => {
  it.each([
    ['POST', '/payout/method', 'payout:method'],
    ['DELETE', '/payout/method/abc-123', 'payout:method'],
    ['POST', '/payout/stripe-connect/onboarding', 'payout:method'],
    ['POST', '/payout/request', 'payout:request'],
    ['POST', '/developer/api-keys', 'api_key:create'],
    ['POST', '/developer/delete-account', 'account:delete'],
    ['POST', '/advertiser/delete-account', 'account:delete'],
    ['POST', '/auth/2fa/disable', '2fa:disable'],
    ['POST', '/auth/2fa/backup-codes/regenerate', '2fa:regenerate'],
  ])('maps %s %s → %s', (method, url, expected) => {
    expect(stepUpActionFor(method, url)).toBe(expected);
  });

  it('tolerates the /api prefix the axios baseURL adds', () => {
    expect(stepUpActionFor('POST', '/api/payout/request')).toBe('payout:request');
  });

  it('ignores query strings', () => {
    expect(stepUpActionFor('POST', '/payout/request?currency=USD')).toBe('payout:request');
  });

  it('returns null for routes that do not require step-up', () => {
    expect(stepUpActionFor('GET', '/developer/dashboard')).toBeNull();
    expect(stepUpActionFor('GET', '/developer/api-keys')).toBeNull(); // read is not gated
    expect(stepUpActionFor('GET', '/payout/method')).toBeNull();
    expect(stepUpActionFor('POST', '/payout/methodology')).toBeNull();
  });

  it('has a human-readable label for every mapped action', () => {
    // The prompt tells the user what they are authorising. A missing label
    // would show an unexplained "enter your code" dialog.
    const actions = [
      'payout:method',
      'payout:request',
      'api_key:create',
      'account:delete',
      '2fa:disable',
      '2fa:regenerate',
    ];
    for (const action of actions) {
      expect(STEP_UP_LABELS[action], `no label for ${action}`).toBeTruthy();
    }
  });
});

describe('isStepUpRequired', () => {
  it('detects the guard refusal', () => {
    expect(isStepUpRequired(403, 'Step-up authentication is required for this action')).toBe(true);
  });

  it('handles a class-validator message array', () => {
    expect(isStepUpRequired(403, ['Step-up authentication is required for this action'])).toBe(
      true,
    );
  });

  it('does NOT trigger on other 403s', () => {
    // Critically: the admin MFA step-up guard has a different message and a
    // different remedy (enrol 2FA, re-login), so it must not be swallowed by
    // this retry path.
    expect(isStepUpRequired(403, 'Recent two-factor authentication is required')).toBe(false);
    expect(isStepUpRequired(403, 'Forbidden resource')).toBe(false);
  });

  it('does not trigger on other statuses', () => {
    expect(isStepUpRequired(401, 'Step-up authentication is required')).toBe(false);
    expect(isStepUpRequired(200, undefined)).toBe(false);
  });
});

describe('prompt registration', () => {
  afterEach(() => setStepUpPrompt(null));

  it('starts unset so requests outside the app shell fail closed', () => {
    expect(getStepUpPrompt()).toBeNull();
  });

  it('round-trips the installed handler', async () => {
    setStepUpPrompt(async () => '123456');
    const prompt = getStepUpPrompt();
    expect(prompt).not.toBeNull();
    await expect(prompt!('payout:request')).resolves.toBe('123456');
  });
});
