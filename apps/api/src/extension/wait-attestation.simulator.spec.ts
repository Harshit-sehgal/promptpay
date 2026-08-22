import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type SimulatorInput,
  TrustedAttestationSimulator,
} from '@ateva/wait-attestation-bridge/simulator';

import { WaitAttestationService } from './wait-attestation.service';

/**
 * Every fault the protocol simulator can produce, checked against the verifier
 * that actually gates money.
 *
 * The simulator already had nine fault modes and its own test suite — but that
 * suite verified them with a bare `jose.jwtVerify`. Proving a raw JWT check
 * rejects an expired token says nothing about `WaitAttestationService`, which
 * additionally enforces the nonce-session compare-and-set, device ownership,
 * user binding, the server-recorded wait lifecycle, the version allowlist, the
 * provider allowlist, and timing bounds. The two were never wired together, so
 * the fault catalogue proved the simulator worked rather than that the verifier
 * did.
 *
 * `docs/ops/wait-attestation-launch-gate.md` is explicit that the simulator
 * "proves protocol and verifier behavior only; it cannot satisfy this
 * independent-provider launch gate" — an independent provider is a trust
 * relationship, not a test. What this file can do is make the protocol half of
 * that claim true, so the live provider experiment starts from a verifier whose
 * rejection paths are demonstrated rather than assumed.
 *
 * The simulator is a devDependency on purpose. It must never be reachable from
 * runtime code, and must never appear in `WAIT_ATTESTATION_ISSUERS`.
 */

const USER = 'user-1';
const DEVICE = 'device-1';
const CLIENT_SESSION = 'client-session-1';
const WAIT_STATE = 'wait-1';
const ATTESTATION_SESSION = 'attestation-session-1';
const NONCE = 'server-issued-single-use-nonce';

function simulatorInput(overrides: Partial<SimulatorInput> = {}): SimulatorInput {
  return {
    userId: USER,
    deviceId: DEVICE,
    sessionId: CLIENT_SESSION,
    waitStateId: WAIT_STATE,
    attestationSessionId: ATTESTATION_SESSION,
    nonce: NONCE,
    durationMs: 5_000,
    ...overrides,
  };
}

/**
 * Build the service with the simulator configured as the ONLY allowlisted
 * issuer, so a rejection can only come from the verifier's own checks.
 */
function makeService(simulator: TrustedAttestationSimulator, now = Date.now()) {
  const session = {
    id: ATTESTATION_SESSION,
    userId: USER,
    deviceId: DEVICE,
    waitStateId: WAIT_STATE,
    clientSessionId: CLIENT_SESSION,
    provider: simulator.provider,
    nonceHash: createHash('sha256').update(NONCE).digest('hex'),
    operationStartDeadline: new Date(now + 60_000),
    consumeDeadline: new Date(now + 31 * 60_000),
    consumedAt: null,
    createdAt: new Date(now - 7_000),
  };

  const prisma = {
    device: { findUnique: vi.fn().mockResolvedValue({ userId: USER }) },
    userSettings: { findUnique: vi.fn().mockResolvedValue({ waitTelemetryEnabled: true }) },
    waitAttestationSession: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new-session', ...data })),
      findUnique: vi.fn().mockResolvedValue(session),
      // count: 1 means this caller won the compare-and-set claim.
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

  const config = {
    get: vi.fn((key: string) => {
      if (key === 'WAIT_ATTESTATION_ISSUERS') {
        return JSON.stringify([
          {
            provider: simulator.provider,
            issuer: simulator.issuer,
            audience: simulator.audience,
            publicKeys: { [simulator.kid]: simulator.publicKeyPem.replace(/\n/g, '\\n') },
          },
        ]);
      }
      if (key === 'VERIFIED_WAIT_ATTESTATION_VERSIONS') return simulator.attestationVersion;
      return undefined;
    }),
  };

  const audit = { logStrict: vi.fn().mockResolvedValue(undefined) };

  return {
    service: new WaitAttestationService(prisma as never, audit as never, config as never),
    prisma,
    audit,
  };
}

describe('WaitAttestationService against the protocol simulator', () => {
  let simulator: TrustedAttestationSimulator;

  beforeEach(() => {
    vi.clearAllMocks();
    simulator = new TrustedAttestationSimulator();
  });

  it('accepts the clean assertion — otherwise the rejections below prove nothing', async () => {
    const { service } = makeService(simulator);
    const assertion = await simulator.issue(simulatorInput());

    await expect(
      service.consume(USER, { attestationSessionId: ATTESTATION_SESSION, assertion }),
    ).resolves.toMatchObject({ provider: simulator.provider, durationMs: 5_000 });
  });

  // Each fault is a row in docs/ops/wait-attestation-threat-model.md. A fault
  // that stops being rejected is a settlement bypass, so the assertion is only
  // that it is refused — the specific exception type is the verifier's choice
  // and pinning it here would make the table brittle for no safety gain.
  const faults: Array<[string, string]> = [
    ['malformed', 'not a JWT at all'],
    ['expired', 'past its exp claim'],
    ['future_timestamps', 'nbf in the future and impossible wait times'],
    ['invalid_duration', 'a zero measured duration'],
    ['unknown_key', 'a kid outside the configured key set'],
    ['bad_signature', 'a valid kid but a signature from another key'],
    ['wrong_nonce', 'a nonce that is not the one the server issued'],
    ['wrong_session', 'a client session id that is not the bound one'],
    ['wrong_provider', 'a provider outside the allowlist'],
  ];

  for (const [fault, why] of faults) {
    it(`rejects "${fault}" — ${why}`, async () => {
      const { service, prisma } = makeService(simulator);
      const assertion = await simulator.issue(simulatorInput(), fault as never);

      await expect(
        service.consume(USER, { attestationSessionId: ATTESTATION_SESSION, assertion }),
      ).rejects.toThrow();

      // Nothing may be persisted for a refused assertion — a stored row is a
      // settlement record, and the point of refusing is that none exists.
      expect(prisma.waitAttestation.create).not.toHaveBeenCalled();
    });
  }

  it('rejects a replayed assertion once the session claim is already lost', async () => {
    const { service, prisma } = makeService(simulator);
    // The simulator returns the SAME assertion for a replayed fault, which is
    // exactly what an attacker resubmits. The server side of the defence is the
    // compare-and-set: the second claim updates no rows.
    const assertion = await simulator.issue(simulatorInput(), 'replayed' as never);
    prisma.waitAttestationSession.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.consume(USER, { attestationSessionId: ATTESTATION_SESSION, assertion }),
    ).rejects.toThrow();
    expect(prisma.waitAttestation.create).not.toHaveBeenCalled();
  });

  it('rejects an assertion bound to another user, even with a valid signature', async () => {
    const { service, prisma } = makeService(simulator);
    const assertion = await simulator.issue(simulatorInput({ userId: 'someone-else' }));

    await expect(
      service.consume(USER, { attestationSessionId: ATTESTATION_SESSION, assertion }),
    ).rejects.toThrow();
    expect(prisma.waitAttestation.create).not.toHaveBeenCalled();
  });

  it('rejects an assertion bound to another device', async () => {
    const { service, prisma } = makeService(simulator);
    const assertion = await simulator.issue(simulatorInput({ deviceId: 'another-device' }));

    await expect(
      service.consume(USER, { attestationSessionId: ATTESTATION_SESSION, assertion }),
    ).rejects.toThrow();
    expect(prisma.waitAttestation.create).not.toHaveBeenCalled();
  });

  it('refuses everything when no independent issuer is configured', async () => {
    // The fail-closed default. An unconfigured deployment must not settle on a
    // perfectly valid assertion.
    const { service } = makeService(simulator);
    const bare = new WaitAttestationService(
      (service as never as { prisma: unknown }).prisma as never,
      { logStrict: vi.fn() } as never,
      { get: vi.fn(() => undefined) } as never,
    );
    const assertion = await simulator.issue(simulatorInput());

    await expect(
      bare.consume(USER, { attestationSessionId: ATTESTATION_SESSION, assertion }),
    ).rejects.toThrow();
  });
});
