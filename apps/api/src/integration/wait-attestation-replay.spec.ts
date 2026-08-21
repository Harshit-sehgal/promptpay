import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from '../app.module';
import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from '../auth/__fixtures__/test-keys';
import { PrismaService } from '../config/prisma.service';
import { WaitAttestationService } from '../extension/wait-attestation.service';

const PROVIDER = 'db-replay-attestor';
const ISSUER = 'https://db-replay-attestor.example.test';
const AUDIENCE = 'ateva-db-replay';
const KEY_ID = 'db-replay-attestor-key';
const ATTESTATION_VERSION = 'db-replay-v1';

/**
 * P0.2 — nonce replay against the real database.
 *
 * Unit tests prove the CAS branch is handled. This test exercises two actual
 * concurrent service calls against Postgres, where the row lock and unique
 * constraints are the replay boundary that protects settlement eligibility.
 */
describe('wait-attestation replay race (DB-backed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let attestation: WaitAttestationService;
  let previousRedisUrl: string | undefined;
  let previousIssuers: string | undefined;
  let previousVersions: string | undefined;

  beforeAll(async () => {
    previousRedisUrl = process.env.REDIS_URL;
    previousIssuers = process.env.WAIT_ATTESTATION_ISSUERS;
    previousVersions = process.env.VERIFIED_WAIT_ATTESTATION_VERSIONS;
    process.env.REDIS_URL = '';
    process.env.WAIT_ATTESTATION_ISSUERS = JSON.stringify([
      {
        provider: PROVIDER,
        issuer: ISSUER,
        audience: AUDIENCE,
        publicKeys: { [KEY_ID]: TEST_JWT_PUBLIC_KEY.replace(/\n/g, '\\n') },
      },
    ]);
    process.env.VERIFIED_WAIT_ATTESTATION_VERSIONS = ATTESTATION_VERSION;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    attestation = app.get(WaitAttestationService);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
    if (previousIssuers === undefined) delete process.env.WAIT_ATTESTATION_ISSUERS;
    else process.env.WAIT_ATTESTATION_ISSUERS = previousIssuers;
    if (previousVersions === undefined) delete process.env.VERIFIED_WAIT_ATTESTATION_VERSIONS;
    else process.env.VERIFIED_WAIT_ATTESTATION_VERSIONS = previousVersions;
  });

  it('accepts one concurrent delivery and rejects the replay', async () => {
    const user = await prisma.user.create({
      data: {
        email: `attestation-replay-${randomUUID()}@ateva.test`,
        role: 'developer',
        status: 'active',
        country: 'US',
      },
    });
    const device = await prisma.device.create({
      data: {
        userId: user.id,
        fingerprintHash: `attestation-replay-${randomUUID()}`,
        eventSecret: 'test-device-secret',
        toolType: 'vscode',
        platform: 'linux',
      },
    });
    await prisma.userSettings.create({
      data: { userId: user.id, waitTelemetryEnabled: true },
    });

    const now = Date.now();
    const waitStateId = `replay-wait-${randomUUID()}`;
    const clientSessionId = `replay-session-${randomUUID()}`;
    const nonce = `replay-nonce-${randomUUID()}`;
    const session = await prisma.waitAttestationSession.create({
      data: {
        userId: user.id,
        deviceId: device.id,
        waitStateId,
        clientSessionId,
        provider: PROVIDER,
        nonceHash: createHash('sha256').update(nonce).digest('hex'),
        operationStartDeadline: new Date(now + 60_000),
        consumeDeadline: new Date(now + 5 * 60_000),
        createdAt: new Date(now - 3_000),
      },
    });

    await prisma.waitStateEvent.create({
      data: {
        userId: user.id,
        deviceId: device.id,
        sessionId: clientSessionId,
        eventType: 'wait_state_start',
        waitStateId,
        toolType: 'vscode',
        signature: 'test-signature',
        idempotencyKey: `replay-start-${randomUUID()}`,
        createdAt: new Date(now - 2_000),
      },
    });
    await prisma.waitStateEvent.create({
      data: {
        userId: user.id,
        deviceId: device.id,
        sessionId: clientSessionId,
        eventType: 'wait_state_end',
        waitStateId,
        toolType: 'vscode',
        duration: 1,
        signature: 'test-signature',
        idempotencyKey: `replay-end-${randomUUID()}`,
        createdAt: new Date(now - 1_000),
      },
    });

    const assertion = await new JwtService().signAsync(
      {
        sub: user.id,
        device_id: device.id,
        nonce,
        session_id: clientSessionId,
        wait_state_id: waitStateId,
        provider: PROVIDER,
        event_id: `replay-event-${randomUUID()}`,
        attestation_version: ATTESTATION_VERSION,
        started_at_ms: now - 2_000,
        ended_at_ms: now - 1_000,
        duration_ms: 1_000,
      },
      {
        privateKey: TEST_JWT_PRIVATE_KEY,
        algorithm: 'RS256',
        keyid: KEY_ID,
        issuer: ISSUER,
        audience: AUDIENCE,
        notBefore: '-1s',
        expiresIn: '5m',
      },
    );

    const outcomes = await Promise.allSettled([
      attestation.consume(user.id, {
        attestationSessionId: session.id,
        assertion,
      }),
      attestation.consume(user.id, {
        attestationSessionId: session.id,
        assertion,
      }),
    ]);

    const accepted = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toEqual(
      expect.objectContaining({
        status: 'rejected',
        reason: expect.any(ConflictException),
      }),
    );

    const stored = await prisma.waitAttestation.findMany({ where: { sessionId: session.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.providerEventId).toBeDefined();
    expect(stored[0]?.assertionDigest).toBe(createHash('sha256').update(assertion).digest('hex'));

    const consumed = await prisma.waitAttestationSession.findUnique({
      where: { id: session.id },
      select: { consumedAt: true },
    });
    expect(consumed?.consumedAt).not.toBeNull();
  });
});
