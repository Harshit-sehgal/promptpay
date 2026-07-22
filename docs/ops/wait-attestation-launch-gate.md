# Wait-attestation launch gate

WaitLayer must not enable `wait.earnings` until this gate is satisfied. Device
HMACs, client telemetry, local CLI supervision, and VS Code lifecycle events
are useful beta signals, but a user can modify a client that holds its device
secret. They are not independent financial proof.

## Required trust boundary

The billable assertion must come from a provider or service whose signing key
is not available to the WaitLayer client. The API verifies the assertion using
an allowlisted issuer/key set or a server-to-server authenticated callback. A
client may transport the assertion, but must never be able to create or alter
it.

An accepted assertion must bind all of the following:

- the WaitLayer user and registered device (use stable opaque identifiers or
  hashes, never terminal contents);
- a server-issued, single-use wait-session nonce;
- provider/tool identity and attestation version;
- a provider event id that is unique and durable;
- start/end timestamps and a bounded measured duration;
- the expected WaitLayer audience/environment; and
- the provider's signature/key id, issuer, expiry, and not-before claims.

The API must reject an assertion if its issuer, audience, signature, key,
nonce, user/device binding, duration, clock window, or event-id uniqueness is
invalid. Persist the verified assertion metadata and a digest of the signed
payload in the existing audit/evidence record; do not persist prompts, command
arguments, terminal output, source code, or raw provider payloads unless a
separate privacy review approves a minimized field.

## Provider integration contract

1. The API creates a short-lived wait-attestation session and returns its
   opaque id and nonce to the approved client integration.
2. The integration requests or receives an AI operation from the chosen
   provider, carrying that nonce only where the provider can attest it.
3. The provider or a trusted server-side bridge signs an assertion when the
   operation completes. A local client must not sign this assertion.
4. The API verifies and atomically consumes the assertion before marking its
   wait as payment-eligible. Consumption must be idempotent and protected by a
   unique provider-event constraint.
5. Normal impression qualification then uses the verified attestation plus the
   existing fraud, duration, campaign-budget, ledger, and payout controls.

Use a separate adapter name and detector version for the integration. Do not
promote an existing `vscode.*`, `cli.*`, or heuristic adapter to billable
status merely because it has more client telemetry.

## Mandatory launch experiment

Run this against a provider sandbox and a staged deployment using isolated,
disposable advertiser and developer accounts:

1. Start one real supported AI operation through the approved integration.
2. Verify the provider assertion is accepted once and is rejected on replay,
   cross-user/device use, expiry, altered duration, and altered signature.
3. Render and qualify one policy-compliant ad, then verify the advertiser
   debit, platform split, developer pending earning, and audit records agree
   exactly by currency.
4. Complete the configured hold/fraud checks, request a payout through a real
   test-mode provider, and verify its provider callback/reconciliation and
   ledger allocation exactly once.
5. Disable `wait.earnings` during a second in-flight test. Confirm the
   impression invalidates and releases its reservation without any debit or
   credit.

Attach the immutable deployment digest, provider event id (or a redacted
reference), ledger reconciliation output, and test-mode payout reference to
the release record. A green unit or mocked integration test is not a substitute
for this experiment.

## Activation checklist

- Security review approves the provider issuer/key rotation and assertion
  schema.
- Production/staging issuer, audience, key/JWKS, callback credentials, and
  timeouts are configured through the secret manager.
- Alerting exists for signature failures, replay attempts, provider callback
  failures, attestation-volume anomalies, and settlement reversals.
- The deployment rollback and runtime kill switch are rehearsed with the
  feature still disabled by default.
- A second operator reviews the experiment evidence and explicitly enables
  `wait.earnings` for a small monitored canary before wider rollout.

Until every item is complete, launch only the clearly labelled, non-billable
beta mode.
