import { beforeEach, describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';

import { BruteForceGuard, RequestLike } from './brute-force.guard';

function authReq(path: string, ip = '203.0.113.10'): RequestLike {
  return { ip, originalUrl: `/api/v1${path}` };
}

async function expectHttpStatus(promise: Promise<void>, status: HttpStatus): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected HTTP ${status}`);
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(status);
  }
}

describe('BruteForceGuard', () => {
  beforeEach(async () => {
    await BruteForceGuard.resetForTests();
    BruteForceGuard.configureForTests({ nodeEnv: 'test' });
  });

  it('locks a target across source IPs after five auth failures', async () => {
    const target = 'victim@example.com';
    const firstIp = authReq('/auth/login', '203.0.113.10');
    const secondIp = authReq('/auth/login', '203.0.113.11');

    for (let i = 0; i < 5; i += 1) {
      await BruteForceGuard.recordFailure(firstIp, target);
    }

    await expectHttpStatus(
      BruteForceGuard.assertCanAttempt(secondIp, target),
      HttpStatus.TOO_MANY_REQUESTS,
    );
    await expect(BruteForceGuard.assertCanAttempt(secondIp, 'other@example.com')).resolves.toBeUndefined();
  });

  it('locks a source IP after failures against different targets', async () => {
    const req = authReq('/auth/login', '198.51.100.50');

    for (let i = 0; i < 5; i += 1) {
      await BruteForceGuard.recordFailure(req, `target-${i}@example.com`);
    }

    await expectHttpStatus(
      BruteForceGuard.assertCanAttempt(req, 'new-target@example.com'),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('resets the route IP and target counters after successful auth', async () => {
    const req = authReq('/auth/login', '203.0.113.20');
    const target = 'recover@example.com';

    for (let i = 0; i < 5; i += 1) {
      await BruteForceGuard.recordFailure(req, target);
    }

    await expectHttpStatus(
      BruteForceGuard.assertCanAttempt(req, target),
      HttpStatus.TOO_MANY_REQUESTS,
    );

    await BruteForceGuard.resetOnSuccess(req, target);

    await expect(BruteForceGuard.assertCanAttempt(req, target)).resolves.toBeUndefined();
  });

  it('locks 2FA token attempts by user target', async () => {
    const req = authReq('/auth/2fa/disable', '203.0.113.25');
    const target = 'user_123';

    for (let i = 0; i < 5; i += 1) {
      await BruteForceGuard.recordFailure(req, target);
    }

    await expectHttpStatus(
      BruteForceGuard.assertCanAttempt(req, target),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it.each(['/auth/2fa/setup', '/auth/2fa/enable', '/auth/2fa/disable'])(
    'rate-limits every 2FA endpoint (%s) under repeated failed attempts',
    async (path) => {
      const req = authReq(path, '203.0.113.40');
      const target = 'user_2fa';

      for (let i = 0; i < 4; i += 1) {
        await BruteForceGuard.recordFailure(req, target);
      }
      // Still allowed before the threshold is reached.
      await expect(BruteForceGuard.assertCanAttempt(req, target)).resolves.toBeUndefined();

      await BruteForceGuard.recordFailure(req, target); // 5th failure

      await expectHttpStatus(
        BruteForceGuard.assertCanAttempt(req, target),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    },
  );

  it('locks a single IP only after exactly five failures (rate-limit threshold)', async () => {
    const req = authReq('/auth/login', '198.51.100.99');
    const target = 'threshold@example.com';

    for (let i = 0; i < 4; i += 1) {
      await BruteForceGuard.recordFailure(req, target);
      await expect(
        BruteForceGuard.assertCanAttempt(req, target),
      ).resolves.toBeUndefined();
    }

    await BruteForceGuard.recordFailure(req, target); // 5th failure trips the lock

    await expectHttpStatus(
      BruteForceGuard.assertCanAttempt(req, target),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('ignores non-auth routes', async () => {
    const req = authReq('/developer/dashboard', '203.0.113.30');

    for (let i = 0; i < 5; i += 1) {
      await BruteForceGuard.recordFailure(req, 'ignored@example.com');
    }

    await expect(BruteForceGuard.assertCanAttempt(req, 'ignored@example.com')).resolves.toBeUndefined();
  });

  it('fails closed in production when no Redis limiter is configured', async () => {
    await BruteForceGuard.resetForTests();
    BruteForceGuard.configureForTests({ nodeEnv: 'production' });

    await expectHttpStatus(
      BruteForceGuard.assertCanAttempt(authReq('/auth/login'), 'prod@example.com'),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });
});
