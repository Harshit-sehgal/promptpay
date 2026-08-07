import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enabledMoneySwitches,
  isExpectedAdminMfaRefusal,
  isExpectedPrivilegedRoleRefusal,
  isExpectedTwoFactorReauthRefusal,
} from './production-smoke-contract.mjs';

test('accepts only the exact two-factor reauthentication refusal', () => {
  assert.equal(
    isExpectedTwoFactorReauthRefusal({
      status: 401,
      json: { message: 'Reauthentication is required before setting up 2FA' },
    }),
    true,
  );
  for (const status of [200, 403, 404, 500]) {
    assert.equal(
      isExpectedTwoFactorReauthRefusal({ status, json: { message: 'Internal server error' } }),
      false,
    );
  }
});

test('accepts only the exact production admin MFA refusal', () => {
  assert.equal(
    isExpectedAdminMfaRefusal({
      status: 403,
      json: { message: 'Recent two-factor authentication is required for this admin action' },
    }),
    true,
  );
  for (const status of [200, 401, 404, 500]) {
    assert.equal(
      isExpectedAdminMfaRefusal({ status, json: { message: 'Forbidden resource' } }),
      false,
    );
  }
});

test('does not confuse an unrelated validation error with privileged-role rejection', () => {
  assert.equal(
    isExpectedPrivilegedRoleRefusal({
      status: 400,
      json: {
        message: 'Role must be developer or advertiser — privileged roles cannot be self-assigned',
      },
    }),
    true,
  );
  assert.equal(
    isExpectedPrivilegedRoleRefusal({
      status: 400,
      json: { message: 'policyVersion must be a string' },
    }),
    false,
  );
});

test('reports enabled money switches as release failures', () => {
  assert.deepEqual(
    enabledMoneySwitches([
      { scope: 'ads', target: 'global', value: { enabled: false } },
      { scope: 'payouts', target: 'requests', value: { enabled: true } },
    ]),
    ['payouts.requests'],
  );
  assert.deepEqual(enabledMoneySwitches(undefined), []);
});
