# Wait-attestation protocol

This document defines the protocol boundary used by WaitLayer before an
independent wait assertion can contribute to settlement. It is a protocol
contract, not evidence that an independent provider is operating. Until the
launch gate in `wait-attestation-launch-gate.md` is complete,
`wait.earnings` remains disabled.

## Trust boundary

The client may request a server-issued session and transport a provider
assertion. The client must not possess the signing key and must not be able to
choose the issuer, key id, event identity, or measured wait result. The API
accepts only an RS256 assertion from an allowlisted provider/key set.

```text
AI operation → independent observer → signed assertion → API verifier
             → replay/binding checks → fraud checks → settlement gate
```

Client telemetry, device HMACs, local timers, CLI supervision, and VS Code
lifecycle events are signals only. None is independent financial proof.

## Assertion format

Assertions are compact JWTs with this protected header:

| Claim | Requirement                                                      |
| ----- | ---------------------------------------------------------------- |
| `alg` | Exactly `RS256`.                                                 |
| `kid` | Non-empty key identifier selected from the provider's allowlist. |
| `typ` | `JWT` when emitted by the provider.                              |

The payload contains only minimized protocol metadata:

| Claim                 | Requirement                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `sub`                 | WaitLayer user identifier; must match the authenticated consumer.        |
| `device_id`           | Registered device identifier; must belong to `sub`.                      |
| `nonce`               | Raw server-issued session nonce; the database stores only its digest.    |
| `session_id`          | Opaque client operation/session identifier.                              |
| `wait_state_id`       | Opaque server lifecycle identifier.                                      |
| `provider`            | Provider identifier; must match the issued session.                      |
| `event_id`            | Durable provider event identity; must not be reused.                     |
| `attestation_version` | Explicit provider protocol version in the allowlist.                     |
| `started_at_ms`       | Provider-observed operation start in milliseconds.                       |
| `ended_at_ms`         | Provider-observed operation end in milliseconds.                         |
| `duration_ms`         | Positive measured duration; must equal end minus start within tolerance. |
| `iss`                 | Allowlisted issuer URL.                                                  |
| `aud`                 | Expected WaitLayer audience.                                             |
| `iat`                 | JWT issue time.                                                          |
| `nbf`                 | Not-before time.                                                         |
| `exp`                 | Expiration time.                                                         |

An implementation may carry an explicit `attestation_id` in a later protocol
version. The current API's durable identity is the provider `event_id` bound to
the server-issued attestation session and wait-state ID; adding a new identity
claim requires a versioned migration and uniqueness constraint.

### Prohibited content

Assertions must never contain prompts, generated output, source code, terminal
contents, command arguments, raw credentials, or unnecessary personal data.
The verifier persists minimized metadata and a digest of the signed assertion,
not the raw JWT or provider payload.

## Session and consumption lifecycle

1. The authenticated API creates a short-lived session after telemetry consent
   and device ownership checks.
2. The API returns one nonce and an operation-start/consume deadline.
3. The observer binds the operation to that nonce and measures the operation.
4. The observer signs one assertion with its private key.
5. The API verifies issuer, audience, key, signature, time claims, version,
   user/device/session/wait binding, and server-recorded wait lifecycle.
6. The API atomically changes the session from unconsumed to consumed and
   writes one minimized attestation record plus an audit event.
7. The settlement gate may consider the verified record only after fraud,
   campaign, duration, and money-switch checks pass.

A failed verification does not create a billable attestation. A consumed
session cannot be consumed again, even if the same request races concurrently.

## Replay and concurrency invariants

- `nonce` is single-use and compared by digest.
- A session compare-and-set requires `consumedAt IS NULL` and an unexpired
  consume deadline.
- Provider event identity and wait/session bindings are unique at persistence.
- The raw assertion is never used as an idempotency key or stored as evidence.
- A duplicate or replayed provider event is a conflict, not a second credit.
- An expired, cross-user, cross-device, cross-session, or altered-duration
  assertion is rejected before financial mutation.

The database uniqueness constraints and compare-and-set are the authoritative
concurrency controls; an in-memory client map is only a convenience that
prevents duplicate local requests.

## Key lifecycle

Each provider has an independently controlled private key and an API-visible
public-key allowlist keyed by `kid`. Rotation must follow this sequence:

1. Publish the new public key under a new `kid`.
2. Confirm the API accepts both old and new keys during the overlap window.
3. Move the provider to the new key and verify a staged assertion.
4. Retain the old public key until its maximum assertion lifetime and retry
   window have elapsed.
5. Remove the old key and record the rotation in the release evidence.

A compromised key requires immediate removal from the allowlist, provider
operation suspension, and review of all assertions issued under that key. The
reference bridge and `TrustedAttestationSimulator` are local test tools and
must never be promoted as independent issuers.

## Test support

`@waitlayer/wait-attestation-bridge/simulator` generates valid and adversarial
protocol fixtures in memory. It covers malformed, expired, replayed,
misbound, future-timestamp, invalid-duration, unknown-key, and bad-signature
cases. It proves verifier behavior only; it does not prove provider
independence or satisfy the launch experiment.
