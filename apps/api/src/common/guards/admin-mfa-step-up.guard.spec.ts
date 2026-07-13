import { describe, expect, it } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { AdminMfaStepUpGuard } from './admin-mfa-step-up.guard';

function context(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guard(nodeEnv = 'production', maxAge = 600): AdminMfaStepUpGuard {
  return new AdminMfaStepUpGuard({
    get: (key: string, fallback?: unknown) => {
      if (key === 'NODE_ENV') return nodeEnv;
      if (key === 'ADMIN_MFA_STEP_UP_MAX_AGE_SECONDS') return maxAge;
      return fallback;
    },
  } as never);
}

describe('AdminMfaStepUpGuard', () => {
  it('requires enrolled and recently satisfied MFA for production admin mutations', () => {
    const req = {
      method: 'POST',
      user: { role: 'admin', twoFactorEnabled: true, mfaAt: Math.floor(Date.now() / 1000) },
    };
    expect(guard().canActivate(context(req))).toBe(true);
  });

  it.each([
    { twoFactorEnabled: false, mfaAt: Math.floor(Date.now() / 1000) },
    { twoFactorEnabled: true, mfaAt: undefined },
    { twoFactorEnabled: true, mfaAt: Math.floor(Date.now() / 1000) - 601 },
  ])('rejects missing, disabled, or stale step-up proof (%o)', (proof) => {
    expect(() =>
      guard().canActivate(context({ method: 'POST', user: { role: 'admin', ...proof } })),
    ).toThrow(ForbiddenException);
  });

  it('does not impose step-up on reads or non-production runs', () => {
    const user = { role: 'admin', twoFactorEnabled: false };
    expect(guard().canActivate(context({ method: 'GET', user }))).toBe(true);
    expect(guard('test').canActivate(context({ method: 'POST', user }))).toBe(true);
  });
});
