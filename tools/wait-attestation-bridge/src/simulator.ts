import { importPKCS8, SignJWT } from 'jose';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';

export type SimulatorFault =
  | 'valid'
  | 'malformed'
  | 'expired'
  | 'replayed'
  | 'wrong_nonce'
  | 'wrong_session'
  | 'wrong_provider'
  | 'future_timestamps'
  | 'invalid_duration'
  | 'unknown_key'
  | 'bad_signature';

export interface SimulatorInput {
  userId: string;
  deviceId: string;
  sessionId: string;
  waitStateId: string;
  attestationSessionId: string;
  provider?: string;
  nonce: string;
  durationMs?: number;
  startedAtMs?: number;
  eventId?: string;
}

export interface SimulatorIssuerConfig {
  provider: string;
  issuer: string;
  audience: string;
  publicKeys: Record<string, string>;
}

interface PemKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  kid: string;
}

const DEFAULT_ISSUER = 'https://simulator.ateva.local/attestation';
const DEFAULT_AUDIENCE = 'ateva-attestation';
const DEFAULT_PROVIDER = 'trusted-attestation-simulator';
const DEFAULT_VERSION = 'simulator-v1';
const MAX_DURATION_MS = 30 * 60_000;

function createPemKeyPair(): PemKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    kid: createHash('sha256').update(publicKey).digest('hex').slice(0, 16),
  };
}

function assertInput(input: SimulatorInput): void {
  for (const [name, value] of Object.entries(input)) {
    if (name === 'durationMs' || name === 'startedAtMs') continue;
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Simulator input ${name} must be a non-empty string`);
    }
  }
  const duration = input.durationMs ?? 5_000;
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > MAX_DURATION_MS) {
    throw new Error('Simulator durationMs must be a positive safe integer within 30 minutes');
  }
}

/**
 * Deterministic-in-shape, in-memory attestation issuer for tests and local
 * protocol development only. It is intentionally not an HTTP provider and
 * must never be placed in WAIT_ATTESTATION_ISSUERS for a real-money
 * deployment. The simulator signs only opaque IDs, timestamps, and protocol
 * claims; prompts, model output, and generated content are never accepted as
 * input and can never enter an assertion.
 */
export class TrustedAttestationSimulator {
  readonly provider: string;
  readonly issuer: string;
  readonly audience: string;
  readonly attestationVersion: string;
  readonly kid: string;
  readonly publicKeyPem: string;

  private readonly privateKeyPem: string;
  private readonly badSignatureKey: PemKeyPair;
  private readonly replayed = new Map<string, string>();

  constructor(
    options: {
      provider?: string;
      issuer?: string;
      audience?: string;
      attestationVersion?: string;
    } = {},
  ) {
    const keyPair = createPemKeyPair();
    this.badSignatureKey = createPemKeyPair();
    this.provider = options.provider ?? DEFAULT_PROVIDER;
    this.issuer = options.issuer ?? DEFAULT_ISSUER;
    this.audience = options.audience ?? DEFAULT_AUDIENCE;
    this.attestationVersion = options.attestationVersion ?? DEFAULT_VERSION;
    this.kid = keyPair.kid;
    this.publicKeyPem = keyPair.publicKeyPem;
    this.privateKeyPem = keyPair.privateKeyPem;
  }

  issuerConfig(): SimulatorIssuerConfig {
    return {
      provider: this.provider,
      issuer: this.issuer,
      audience: this.audience,
      publicKeys: { [this.kid]: this.publicKeyPem.replace(/\n/g, '\\n') },
    };
  }

  /**
   * Issue one assertion or an explicit adversarial variant. `replayed` returns
   * the same signed token for a replay key, making replay tests deterministic.
   */
  async issue(input: SimulatorInput, fault: SimulatorFault = 'valid'): Promise<string> {
    assertInput(input);
    if (fault === 'malformed') return 'not-a-jwt';

    const replayKey = this.replayKey(input);
    if (fault === 'replayed') {
      const existing = this.replayed.get(replayKey);
      if (existing) return existing;
    }

    const nowMs = Date.now();
    const durationMs = input.durationMs ?? 5_000;
    const startedAtMs = input.startedAtMs ?? nowMs - durationMs;
    const endedAtMs = startedAtMs + durationMs;
    const nowSeconds = Math.floor(nowMs / 1_000);
    const claims = {
      attestation_id: input.attestationSessionId,
      sub: input.userId,
      device_id: input.deviceId,
      nonce: fault === 'wrong_nonce' ? `${input.nonce}-wrong` : input.nonce,
      session_id: fault === 'wrong_session' ? `${input.sessionId}-wrong` : input.sessionId,
      wait_state_id: input.waitStateId,
      provider:
        fault === 'wrong_provider' ? `${this.provider}-wrong` : (input.provider ?? this.provider),
      event_id: input.eventId ?? randomUUID(),
      attestation_version: this.attestationVersion,
      started_at_ms: fault === 'future_timestamps' ? nowMs + 120_000 : startedAtMs,
      ended_at_ms: fault === 'future_timestamps' ? nowMs + 125_000 : endedAtMs,
      duration_ms: fault === 'invalid_duration' ? 0 : durationMs,
    };

    const expiration = fault === 'expired' ? nowSeconds - 1 : nowSeconds + 300;
    const notBefore = fault === 'future_timestamps' ? nowSeconds + 120 : nowSeconds - 1;
    const signingKey = fault === 'bad_signature' ? this.badSignatureKey : undefined;
    // `bad_signature` deliberately keeps the TRUSTED kid so a consumer that
    // selects keys by kid exercises the signature check rather than reporting
    // an unknown key; only `unknown_key` exposes an untrusted kid.
    const kid = fault === 'unknown_key' ? `${this.kid}-unknown` : this.kid;
    const privateKey = await importPKCS8(signingKey?.privateKeyPem ?? this.privateKeyPem, 'RS256');
    const assertion = await this.sign(claims, privateKey, kid, expiration, notBefore);

    if (fault === 'replayed') this.replayed.set(replayKey, assertion);
    return assertion;
  }

  clearReplays(): void {
    this.replayed.clear();
  }

  private async sign(
    claims: Record<string, unknown>,
    privateKey: CryptoKey,
    kid: string,
    expiration: number,
    notBefore: number,
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setExpirationTime(expiration)
      .setNotBefore(notBefore)
      .sign(privateKey);
  }

  private replayKey(input: SimulatorInput): string {
    return [input.userId, input.deviceId, input.sessionId, input.waitStateId, input.nonce].join(
      ':',
    );
  }
}
