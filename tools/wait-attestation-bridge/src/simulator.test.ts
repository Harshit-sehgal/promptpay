import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { type SimulatorInput, TrustedAttestationSimulator } from './simulator.js';

async function verify(
  simulator: TrustedAttestationSimulator,
  assertion: string,
  currentDate = new Date(),
) {
  const publicKey = await importSPKI(simulator.publicKeyPem, 'RS256');
  return jwtVerify(assertion, publicKey, {
    issuer: simulator.issuer,
    audience: simulator.audience,
    algorithms: ['RS256'],
    currentDate,
  });
}

const INPUT: SimulatorInput = {
  userId: 'user-1',
  deviceId: 'device-1',
  sessionId: 'client-session-1',
  waitStateId: 'wait-1',
  attestationSessionId: 'attestation-session-1',
  nonce: 'server-issued-nonce',
  durationMs: 5_000,
};

describe('TrustedAttestationSimulator', () => {
  it('issues a verifiable assertion with only opaque protocol claims', async () => {
    const simulator = new TrustedAttestationSimulator();
    const assertion = await simulator.issue(INPUT);
    const { payload } = await verify(simulator, assertion);

    expect(payload.sub).toBe(INPUT.userId);
    expect(payload.device_id).toBe(INPUT.deviceId);
    expect(payload.nonce).toBe(INPUT.nonce);
    expect(payload.attestation_id).toBe(INPUT.attestationSessionId);
    expect(payload.duration_ms).toBe(INPUT.durationMs);
    expect(payload).not.toHaveProperty('prompt');
    expect(payload).not.toHaveProperty('output');
    expect(simulator.issuerConfig().publicKeys[simulator.kid]).toContain('\\n');
  });

  it('generates a deterministic replay token for replay tests', async () => {
    const simulator = new TrustedAttestationSimulator();
    const first = await simulator.issue(INPUT, 'replayed');
    const second = await simulator.issue(INPUT, 'replayed');
    expect(second).toBe(first);
    simulator.clearReplays();
    expect(await simulator.issue(INPUT, 'replayed')).not.toBe(first);
  });

  it('generates a malformed assertion that verification rejects', async () => {
    const simulator = new TrustedAttestationSimulator();
    await expect(verify(simulator, await simulator.issue(INPUT, 'malformed'))).rejects.toThrow(
      /Invalid Compact JWS/,
    );
  });

  it('generates an expired assertion that verification rejects', async () => {
    const simulator = new TrustedAttestationSimulator();
    await expect(verify(simulator, await simulator.issue(INPUT, 'expired'))).rejects.toThrow(
      /exp.*timestamp check failed/,
    );
  });

  it('generates an unknown-key assertion that exposes an untrusted key id', async () => {
    const simulator = new TrustedAttestationSimulator();
    const assertion = await simulator.issue(INPUT, 'unknown_key');
    const header = decodeProtectedHeader(assertion);
    expect(header.kid).not.toBe(simulator.kid);
    expect(simulator.issuerConfig().publicKeys[header.kid as string]).toBeUndefined();
  });

  it('generates a bad-signature assertion that verification rejects', async () => {
    const simulator = new TrustedAttestationSimulator();
    const assertion = await simulator.issue(INPUT, 'bad_signature');
    // The token must carry the TRUSTED kid so a kid-selecting consumer fails
    // on the signature, not on key lookup (P2: previously it exposed the
    // alternate key's kid, which no consumer ever configured).
    expect(decodeProtectedHeader(assertion).kid).toBe(simulator.kid);
    await expect(verify(simulator, assertion)).rejects.toThrow(/signature verification failed/);
  });

  it.each([
    'wrong_nonce',
    'wrong_session',
    'wrong_provider',
    'future_timestamps',
    'invalid_duration',
  ] as const)('generates a signed but semantically invalid %s assertion', async (fault) => {
    const simulator = new TrustedAttestationSimulator();
    const assertion = await simulator.issue(INPUT, fault);
    const { payload } = await verify(
      simulator,
      assertion,
      fault === 'future_timestamps' ? new Date(Date.now() + 121_000) : new Date(),
    );
    expect(payload).toBeDefined();
    if (fault === 'wrong_nonce') expect(payload.nonce).not.toBe(INPUT.nonce);
    if (fault === 'wrong_session') expect(payload.session_id).not.toBe(INPUT.sessionId);
    if (fault === 'wrong_provider') expect(payload.provider).not.toBe(simulator.provider);
    if (fault === 'invalid_duration') expect(payload.duration_ms).toBe(0);
  });

  it('rejects malformed simulator inputs instead of creating ambiguous claims', async () => {
    const simulator = new TrustedAttestationSimulator();
    await expect(simulator.issue({ ...INPUT, userId: '' })).rejects.toThrow(/userId/);
    await expect(simulator.issue({ ...INPUT, durationMs: 0 })).rejects.toThrow(/durationMs/);
  });
});
