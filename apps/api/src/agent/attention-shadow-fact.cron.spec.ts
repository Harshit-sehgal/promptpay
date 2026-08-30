import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttentionShadowFactCron } from './attention-shadow-fact.cron';

const originalEnvironmentKind = process.env.ATEVA_ENVIRONMENT_KIND;
const originalPseudonymKey = process.env.ATTENTION_SHADOW_PSEUDONYM_KEY;

const newSession = {
  id: 'session-new',
  userId: 'user-1',
  deviceId: '11111111-1111-4111-8111-111111111111',
  provider: 'claude_code',
  integrationMode: 'native_hook',
  startedAt: new Date('2026-08-31T00:00:00.000Z'),
  endedAt: new Date('2026-08-31T00:00:02.000Z'),
};

describe('AttentionShadowFactCron', () => {
  afterEach(() => {
    if (originalEnvironmentKind === undefined) delete process.env.ATEVA_ENVIRONMENT_KIND;
    else process.env.ATEVA_ENVIRONMENT_KIND = originalEnvironmentKind;
    if (originalPseudonymKey === undefined) delete process.env.ATTENTION_SHADOW_PSEUDONYM_KEY;
    else process.env.ATTENTION_SHADOW_PSEUDONYM_KEY = originalPseudonymKey;
  });

  it('excludes materialized sessions before applying the bounded batch', async () => {
    process.env.ATEVA_ENVIRONMENT_KIND = 'test';
    process.env.ATTENTION_SHADOW_PSEUDONYM_KEY = ['shadow-fact', 'fixture'].join('-');

    const findManySessions = vi.fn((args: { where: { shadowFact?: null } }) => {
      expect(args.where.shadowFact).toBeNull();
      // Model the database relation filter: an older materialized session is
      // present, but it must not consume the batch ahead of this new session.
      return Promise.resolve([newSession]);
    });
    const prisma = {
      agentSession: { findMany: findManySessions },
      attentionSessionFact: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      attentionSessionPolicyAssignment: {
        findUnique: vi.fn().mockResolvedValue({
          policy: {
            version: 1,
            status: 'shadow',
            alphaPpm: 500_000n,
            passiveCapRatioPpm: 1_000_000n,
            passiveSessionCapMs: 60_000,
            minimumQualifiedMs: 1_000,
          },
        }),
      },
      agentLifecycleEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            schemaVersion: 1,
            eventId: '11111111-1111-4111-8111-111111111111',
            idempotencyKey: ['idempotency', 'fixture'].join('-'),
            environmentId: 'test-1',
            eventType: 'surface.visible',
            sourceType: 'observed',
            confidence: 1,
            occurredAt: new Date('2026-08-31T00:00:00.000Z'),
            sequence: 1,
            correlationId: 'correlation-1',
            causationId: null,
            adapterVersion: 'test',
            clientVersion: 'test',
            metadata: {},
          },
        ]),
      },
    };
    const facts = {
      persist: vi.fn().mockResolvedValue({ status: 'created' }),
    };

    const result = await new AttentionShadowFactCron(
      prisma as never,
      facts as never,
    ).tick();

    expect(result).toMatchObject({
      scanned: 1,
      created: 1,
      duplicates: 0,
      skipped: 0,
      errors: 0,
      financialSideEffects: false,
    });
    expect(facts.persist).toHaveBeenCalledWith('session-new', expect.anything());
  });
});
