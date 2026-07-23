/**
 * Small client-side coordinator for the independent wait proof protocol.
 * It intentionally keeps nonce and provider assertion only in memory: neither
 * belongs in extension settings, logs, telemetry, or a credential store.
 */
export interface WaitAttestationApi {
  createWaitAttestationSession(input: {
    deviceId: string;
    waitStateId: string;
    sessionId: string;
    provider: string;
  }): Promise<{
    attestationSessionId: string;
    nonce: string;
    operationStartDeadline: string;
    consumeDeadline: string;
  }>;
  consumeWaitAttestation(input: {
    attestationSessionId: string;
    assertion: string;
  }): Promise<unknown>;
}

export interface WaitAssertionProvider {
  readonly provider: string;
  obtainAssertion(input: {
    nonce: string;
    attestationSessionId: string;
    userId?: string;
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    operationStartDeadline: string;
    consumeDeadline: string;
  }): Promise<string>;
}

interface PendingAttestation {
  attestationSessionId: string;
  nonce: string;
  userId?: string;
  deviceId: string;
  sessionId: string;
  waitStateId: string;
  provider: WaitAssertionProvider;
  operationStartDeadline: string;
  consumeDeadline: string;
}

export class WaitAttestationFlow {
  private readonly pending = new Map<string, PendingAttestation>();

  constructor(private readonly api: WaitAttestationApi) {}

  async begin(input: {
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    provider: WaitAssertionProvider;
    userId?: string;
  }): Promise<void> {
    // A retry before the operation starts shares the in-memory attempt and
    // never generates a second nonce for the same wait.
    if (this.pending.has(input.waitStateId)) return;
    const session = await this.api.createWaitAttestationSession({
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      waitStateId: input.waitStateId,
      provider: input.provider.provider,
    });
    this.pending.set(input.waitStateId, { ...session, ...input });
  }

  async consume(waitStateId: string): Promise<void> {
    const pending = this.pending.get(waitStateId);
    if (!pending) throw new Error('No pending wait attestation for this operation');
    try {
      if (Date.parse(pending.consumeDeadline) <= Date.now()) {
        throw new Error('Wait attestation expired before it could be consumed');
      }
      const assertion = await pending.provider.obtainAssertion({
        nonce: pending.nonce,
        attestationSessionId: pending.attestationSessionId,
        userId: pending.userId,
        deviceId: pending.deviceId,
        sessionId: pending.sessionId,
        waitStateId: pending.waitStateId,
        operationStartDeadline: pending.operationStartDeadline,
        consumeDeadline: pending.consumeDeadline,
      });
      await this.api.consumeWaitAttestation({
        attestationSessionId: pending.attestationSessionId,
        assertion,
      });
    } finally {
      // Includes provider errors, expiry, network errors, and duplicate
      // responses. Callers must begin a new wait rather than replay data.
      this.pending.delete(waitStateId);
    }
  }

  cancel(waitStateId: string): void {
    this.pending.delete(waitStateId);
  }
}
