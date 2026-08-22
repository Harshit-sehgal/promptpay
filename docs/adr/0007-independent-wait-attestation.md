# 7. Independent wait attestation

Date: 2026-08-23

## Status

Proposed. Requires review by two operators before `wait.earnings` may be
enabled (issue #45).

## Context

Ateva pays participants for verified waiting. The thing being paid for — that an
AI operation really took N seconds on a real machine — is observed on the
participant's own computer, by software the participant controls.

That is the whole problem. Every signal the client can produce, the client can
also fabricate:

- **Device HMACs** are computed with a secret the device holds. A user who
  modifies the client holds the secret too.
- **Detector versions and tool telemetry** are self-reported strings.
- **CLI supervision and VS Code lifecycle events** are observations made by a
  process running as the user, with no privileged boundary.

None of these are weak in a way better cryptography fixes. They are evidence
signed by the party who benefits from the outcome, which is not evidence.

The reference bridge in `tools/wait-attestation-bridge/` does not change this:
a bridge running on the participant's machine is still the participant.

## Decision

**A billable wait must be attested by a party that is not the participant, and
whose signing key the participant's software never holds.**

Concretely:

1. The API issues a short-lived, single-use **nonce** bound to a specific user,
   device, client session and wait state, and stores only its digest.
2. The client carries that nonce to an approved provider. It transports the
   assertion; it can never create or alter one.
3. The **provider or a server-side bridge under separate operational control**
   signs an assertion binding the nonce, the opaque user/device identifiers,
   provider identity and version, a durable provider event id, start/end
   timestamps, a bounded duration, the expected audience, and standard `kid` /
   `iss` / `nbf` / `exp` claims.
4. `POST /extension/wait-attestation/consume` verifies it against an
   allowlisted issuer and key set and **atomically consumes** the session by
   compare-and-set. Only then may qualification and settlement proceed.
5. The API persists minimised metadata plus a digest of the signed payload.
   Never the raw assertion, the raw nonce, prompts, command arguments, terminal
   output, or source code.

`wait.earnings` stays **fail-closed**: with no configured independent issuer,
settlement is refused even for a perfectly valid assertion.

### What "independent" has to mean

The signing key must be unreachable from any process the participant controls.
A bridge deployed by Ateva on Ateva-controlled infrastructure satisfies this. A
bridge shipped to participants does not, at any level of obfuscation.

This is the criterion that cannot be satisfied by writing code, and the reason
issue #45 stays open while the protocol is complete.

## Consequences

### What this buys

Settlement evidence is signed by a party with no financial interest in the
outcome. Colluding to fabricate a wait now requires compromising the provider or
its key, rather than editing a local client.

The verifier's rejection paths are exercised against the protocol simulator in
`wait-attestation.simulator.spec.ts` — malformed, expired, future timestamps,
invalid duration, unknown key, bad signature under a trusted `kid`, wrong nonce,
wrong session, wrong provider, replay, cross-user and cross-device binding, and
the unconfigured fail-closed path.

### What it costs

- A dependency on a third party for revenue-critical evidence. Provider outage
  means waits stop being billable, so the outage path must degrade to
  non-billable rather than to trusting the client.
- Key rotation and revocation become operational obligations with money
  attached.
- Participants can only earn while using a supported provider through an
  approved integration. That narrows the addressable beta, and the public copy
  must not imply otherwise.

### What it does not solve

**Collusion with the provider**, or a participant who genuinely runs the
operations but adds no value. Independence raises the cost of fabrication; it
does not make it impossible. Fraud scoring, hold periods and second-person
review for anomalous payouts remain necessary, and are tracked in
`docs/ops/wait-attestation-threat-model.md`.

## Alternatives considered

**Trust the client, mitigate with fraud scoring.** Rejected. It inverts the
burden: every payout becomes a judgement call, and the first competent attacker
sets the loss rate. It also cannot be described honestly to participants.

**Attest with a TEE or platform attestation on the participant's machine.**
Rejected for now. It moves the boundary rather than removing it, requires
hardware Ateva cannot assume, and the attestation still describes a machine the
participant administers.

**Pay for a proxy signal — API spend, token counts — instead of wait time.**
Rejected. It changes the product into something that rewards spend rather than
attention, and reintroduces the "participant owns a share of an advertiser
transaction" framing the payment provider is not approved for.

**Ship the reference bridge and treat it as independent.** Rejected, and
explicitly prohibited in `docs/ops/wait-attestation-launch-gate.md`. It is the
tempting option because it requires no partner, which is exactly why it is
written down as forbidden rather than left to judgement.

## Open items before this can move to Accepted

- An identified provider or independently operated bridge, with key custody
  documented.
- Review by two operators (the acceptance criterion of #45).
- The live experiment in `docs/ops/wait-attestation-launch-gate.md`, against a
  provider sandbox — a green unit suite is not a substitute.
- Alerting for signature failures, replay attempts, provider callback failures,
  attestation-volume anomalies and settlement reversals.
- A rehearsed kill switch and rollback, with the feature still disabled.
- A monitored canary enabled by a second operator before wider rollout.
