import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuditInterceptor, scrubBody } from './audit.interceptor';

describe('AuditInterceptor credential scrubbing', () => {
  it('redacts composed and nested credential field names', () => {
    expect(
      scrubBody({
        currentPassword: 'hunter2',
        googleIdToken: 'google-token',
        profile: {
          api_secret: 'secret',
          displayName: 'Safe value',
        },
        attempts: [{ resetPasswordToken: 'reset-token', reason: 'requested' }],
      }),
    ).toEqual({
      currentPassword: '[redacted]',
      googleIdToken: '[redacted]',
      profile: {
        api_secret: '[redacted]',
        displayName: 'Safe value',
      },
      attempts: [{ resetPasswordToken: '[redacted]', reason: 'requested' }],
    });
  });

  it('does not redact ordinary business fields that merely contain key', () => {
    expect(scrubBody({ idempotencyKey: 'business-key', publicKeyLabel: 'Laptop' })).toEqual({
      idempotencyKey: 'business-key',
      publicKeyLabel: 'Laptop',
    });
  });

  it('recursively scrubs nested arrays of objects', () => {
    expect(
      scrubBody({
        items: [[{ password: 'deep-secret' }]],
        flat: [{ apiKey: 'flat-secret' }],
      }),
    ).toEqual({
      items: [[{ password: '[redacted]' }]],
      flat: [{ apiKey: '[redacted]' }],
    });
  });
});

describe('AuditInterceptor durable success acknowledgement', () => {
  function setup() {
    const audit = {
      log: vi.fn().mockResolvedValue(undefined),
      logStrict: vi.fn().mockResolvedValue(undefined),
    };
    const reflector = {
      get: vi.fn().mockReturnValue({ action: 'sensitive_action', targetType: 'unknown' }),
    };
    const interceptor = new AuditInterceptor(audit as never, {} as never, reflector as never);
    const context = {
      getHandler: () => function handler() {},
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/sensitive',
          params: {},
          user: { id: 'actor-1', role: 'admin' },
          body: { currentPassword: 'must-not-persist' },
        }),
      }),
    };
    return { audit, interceptor, context };
  }

  it('awaits strict audit persistence before returning a success', async () => {
    const { audit, interceptor, context } = setup();
    await expect(
      lastValueFrom(interceptor.intercept(context as never, { handle: () => of({ ok: true }) })),
    ).resolves.toEqual({ ok: true });
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sensitive_action',
        beforeSnap: { body: { currentPassword: '[redacted]' } },
      }),
    );
  });

  it('does not acknowledge success when strict audit persistence fails', async () => {
    const { audit, interceptor, context } = setup();
    audit.logStrict.mockRejectedValue(new Error('audit database unavailable'));
    await expect(
      lastValueFrom(interceptor.intercept(context as never, { handle: () => of({ ok: true }) })),
    ).rejects.toThrow('audit database unavailable');
  });
});
