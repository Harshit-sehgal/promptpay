import { importSPKI, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BridgeConfig } from './config.js';
import { startBridge } from './server.js';

const BRIDGE_TOKEN = 'test-token-123';

function createTestConfig(overrides?: Partial<BridgeConfig>): BridgeConfig {
  return {
    port: 0,
    provider: 'stub-bridge',
    issuer: 'https://test.local/attestation',
    audience: 'waitlayer-client',
    attestationVersion: 'stub-v1',
    bridgeToken: BRIDGE_TOKEN,
    privateKeyPath: '.keys/test-private.pem',
    publicKeyPath: '.keys/test-public.pem',
    generateKeyPair: true,
    ...overrides,
  };
}

describe('wait-attestation bridge', () => {
  let bridge: Awaited<ReturnType<typeof startBridge>>;
  let baseUrl: string;

  beforeAll(async () => {
    bridge = await startBridge(createTestConfig());
    baseUrl = `http://localhost:${bridge.port}`;
  });

  afterAll(async () => {
    await bridge.close();
  });

  it('returns 401 without a token', async () => {
    const response = await fetch(`${baseUrl}/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it('returns 400 for an invalid request', async () => {
    const response = await fetch(`${baseUrl}/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${BRIDGE_TOKEN}` },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('returns a verifiable assertion for a valid request', async () => {
    const response = await fetch(`${baseUrl}/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${BRIDGE_TOKEN}` },
      body: JSON.stringify({
        nonce: 'test-nonce',
        attestationSessionId: 'session-123',
        userId: 'user-123',
        deviceId: 'device-123',
        sessionId: 'client-session-123',
        waitStateId: 'wait-123',
        provider: 'stub-bridge',
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assertion?: string };
    expect(typeof body.assertion).toBe('string');

    const { publicKeyPem } = bridge;
    const publicKey = await importSPKI(publicKeyPem, 'RS256');
    const { payload } = await jwtVerify(body.assertion!, publicKey, {
      issuer: 'https://test.local/attestation',
      audience: 'waitlayer-client',
    });
    expect(payload.sub).toBe('user-123');
    expect(payload.device_id).toBe('device-123');
    expect(payload.nonce).toBe('test-nonce');
    expect(payload.provider).toBe('stub-bridge');
    expect(payload.attestation_version).toBe('stub-v1');
  });
});
