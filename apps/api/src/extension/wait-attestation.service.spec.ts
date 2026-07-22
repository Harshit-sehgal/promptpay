import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from '../auth/__fixtures__/test-keys';
import { WaitAttestationService } from './wait-attestation.service';

const PROVIDER = 'approved-provider';
const ISSUER = 'https://attestor.example.test';
const AUDIENCE = 'waitlayer-attestation';
const KID = 'attestor-key-1';
const nonce = 'server-issued-single-use-nonce';
const now = Date.now();

function issuerConfig() {
  return JSON.stringify([
    {
      provider: PROVIDER,
      issuer: ISSUER,
      audience: AUDIENCE,
      publicKeys: { [KID]: TEST_JWT_PUBLIC_KEY.replace(/\n/g, '\\n') },
    },
  ]);
}

async function signedAssertion(
  overrides: Record<string, unknown> = {},
  options: { notBefore?: string } = { notBefore: '0s' },
) {
  return new JwtService().signAsync(
    {
      sub: 'user-1',
      device_id: 'device-1',
      nonce,
      session_id: 'client-session-1',
      wait_state_id: 'wait-1',
      provider: PROVIDER,
      event_id: 'provider-event-1',
      attestation_version: 'provider-v1',
      started_at_ms: now - 5_000,
      ended_at_ms: now,
      duration_ms: 5_000,
      ...overrides,
    },
    {
      privateKey: TEST_JWT_PRIVATE_KEY,
      algorithm: 'RS256',
      keyid: KID,
      issuer: ISSUER,
      audience: AUDIENCE,
      ...(options.notBefore ? { notBefore: options.notBefore } : {}),
      expiresIn: '5m',
    },
  );
}

function makeService() {
  const session = {
    id: 'attestation-session-1',
    userId: 'user-1',
    deviceId: 'device-1',
    waitStateId: 'wait-1',
    clientSessionId: 'client-session-1',
    provider: PROVIDER,
    nonceHash: createHash('sha256').update(nonce).digest('hex'),
    operationStartDeadline: new Date(now + 60_000),
    consumeDeadline: new Date(now + 31 * 60_000),
    consumedAt: null,
    // The nonce is issued before the server-recorded wait start.
    createdAt: new Date(now - 7_000),
  };
  const prisma = {
    device: { findUnique: vi.fn().mockResolvedValue({ userId: 'user-1' }) },
    userSettings: { findUnique: vi.fn().mockResolvedValue({ waitTelemetryEnabled: true }) },
    waitAttestationSession: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new-session', ...data })),
      findUnique: vi.fn().mockResolvedValue(session),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    waitAttestation: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'attestation-1', ...data })),
    },
    waitStateEvent: {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({ createdAt: new Date(now - 6_000) })
        .mockResolvedValueOnce({ createdAt: new Date(now - 500), duration: 5 }),
    },
    $transaction: vi.fn((callback) => callback(prisma)),
  };
  const audit = { logStrict: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'WAIT_ATTESTATION_ISSUERS') return issuerConfig();
      if (key === 'VERIFIED_WAIT_ATTESTATION_VERSIONS') return 'provider-v1';
      return undefined;
    }),
  };
  return {
    service: new WaitAttestationService(prisma as never, audit as never, config as never),
    prisma,
    audit,
    session,
  };
}

describe('WaitAttestationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues a raw nonce once while persisting only its digest', async () => {
    const { service, prisma } = makeService();
    const result = await service.createSession('user-1', {
      deviceId: 'device-1',
      waitStateId: 'wait-1',
      sessionId: 'client-session-1',
      provider: PROVIDER,
    });

    expect(result.nonce).toHaveLength(43);
    expect(prisma.waitAttestationSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nonceHash: expect.not.stringContaining(result.nonce) }),
      }),
    );
  });

  it('accepts a correctly bound assertion once and never stores its raw JWT', async () => {
    const { service, prisma, audit } = makeService();
    const assertion = await signedAssertion();

    await expect(
      service.consume('user-1', { attestationSessionId: 'attestation-session-1', assertion }),
    ).resolves.toEqual({ id: 'attestation-1', provider: PROVIDER, durationMs: 5_000 });

    expect(prisma.waitAttestation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerEventId: 'provider-event-1',
          assertionDigest: createHash('sha256').update(assertion).digest('hex'),
        }),
      }),
    );
    expect(JSON.stringify(prisma.waitAttestation.create.mock.calls)).not.toContain(assertion);
    expect(audit.logStrict).toHaveBeenCalled();
  });

  it.each([
    ['wrong user', { sub: 'user-2' }],
    ['wrong device', { device_id: 'device-2' }],
    ['wrong nonce', { nonce: 'attacker-nonce' }],
    ['altered duration', { duration_ms: 7_000 }],
  ])('rejects a %s binding before persistence', async (_label, overrides) => {
    const { service, prisma } = makeService();
    const assertion = await signedAssertion(overrides);

    await expect(
      service.consume('user-1', { attestationSessionId: 'attestation-session-1', assertion }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.waitAttestation.create).not.toHaveBeenCalled();
  });

  it('rejects a replay when the compare-and-set session claim loses', async () => {
    const { service, prisma } = makeService();
    prisma.waitAttestationSession.updateMany.mockResolvedValue({ count: 0 });
    const assertion = await signedAssertion();

    await expect(
      service.consume('user-1', { attestationSessionId: 'attestation-session-1', assertion }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.waitAttestation.create).not.toHaveBeenCalled();
  });

  it('requires the attestation to bind to a completed server-recorded wait', async () => {
    const { service, prisma } = makeService();
    prisma.waitStateEvent.findFirst.mockReset();
    prisma.waitStateEvent.findFirst
      .mockResolvedValueOnce({ createdAt: new Date(now - 6_000) })
      .mockResolvedValueOnce(null);
    const assertion = await signedAssertion();

    await expect(
      service.consume('user-1', { attestationSessionId: 'attestation-session-1', assertion }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.waitAttestation.create).not.toHaveBeenCalled();
  });

  it('requires explicit expiry/not-before claims and a positive measured duration', async () => {
    const { service, prisma } = makeService();
    const noNotBefore = await signedAssertion({}, {});

    await expect(
      service.consume('user-1', {
        attestationSessionId: 'attestation-session-1',
        assertion: noNotBefore,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const zeroDuration = await signedAssertion({
      started_at_ms: now,
      ended_at_ms: now,
      duration_ms: 0,
    });
    await expect(
      service.consume('user-1', {
        attestationSessionId: 'attestation-session-1',
        assertion: zeroDuration,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.waitAttestation.create).not.toHaveBeenCalled();
  });

  it('rejects a nonce session created after the server-recorded wait began', async () => {
    const { service, prisma, session } = makeService();
    session.createdAt = new Date(now - 1_000);
    const assertion = await signedAssertion();

    await expect(
      service.consume('user-1', { attestationSessionId: 'attestation-session-1', assertion }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.waitAttestation.create).not.toHaveBeenCalled();
  });
});
