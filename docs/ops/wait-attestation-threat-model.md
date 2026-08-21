# Wait-attestation threat model

Scope: the independent wait-attestation path from session creation through
settlement eligibility. This document assumes `wait.earnings` is disabled until
the independent-provider launch experiment passes.

## Assets and trust boundaries

| Asset                                   | Protection boundary                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Advertiser funds and developer earnings | API/database transaction and money-switch gates.                                      |
| Attestation private key                 | Independent provider operations; never shipped to clients or WaitLayer client builds. |
| Public issuer key set                   | WaitLayer API configuration, reviewed and rotated by operators.                       |
| Session nonce and event identity        | API-generated session plus database uniqueness/CAS.                                   |
| User/device/wait linkage                | Authenticated API, device ownership, and server-recorded lifecycle.                   |
| Privacy-sensitive operation data        | Deliberately excluded from assertions and persisted evidence.                         |

## Threats and mitigations

| Threat                          | Existing mitigation                                                                            | Residual action/risk                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client fabricates a wait        | Client telemetry is non-billable; settlement requires an allowlisted independent signature.    | Real provider independence must be verified in the launch experiment.                                                                                |
| Client alters a valid assertion | RS256 verification, issuer/audience/key-id allowlist, assertion digest, raw JWT not persisted. | Compromised provider key requires emergency revocation and event review.                                                                             |
| Nonce replay                    | Server-issued nonce digest plus atomic session consumption.                                    | Real-Postgres concurrent delivery coverage is in `integration/wait-attestation-replay.spec.ts`; provider delivery still needs live sandbox evidence. |
| Provider event replay           | Durable provider event identity and uniqueness constraints.                                    | Confirm Dodo/provider event-id stability in live sandbox traffic.                                                                                    |
| Cross-user/device/session reuse | Claims are compared against authenticated user, owned device, issued session, and wait state.  | Continue adding cross-tenant integration cases for every protocol version.                                                                           |
| Clock manipulation              | Bounded start/end/duration checks, JWT `nbf`/`exp`, server-recorded wait lifecycle.            | Tune tolerance only from measured provider clock behavior; do not widen by guesswork.                                                                |
| Altered duration                | End-start-duration consistency and comparison to the server-recorded wait.                     | Validate provider measurement semantics in the live experiment.                                                                                      |
| Unknown or revoked key          | `kid` must resolve to the configured public-key set.                                           | Key-revocation runbook and alerting must be owned by an operator.                                                                                    |
| Algorithm confusion             | Only `RS256` is accepted.                                                                      | Keep algorithm allowlists pinned during library upgrades.                                                                                            |
| Issuer impersonation            | Exact configured issuer, audience, and public key are required.                                | Independent DNS/key custody and provider compromise response remain external.                                                                        |
| Automated device/VM farms       | Fraud signals, device/account controls, rate limits, and review workflows.                     | Establish thresholds from beta data; do not enable aggressive payout blocks without policy.                                                          |
| User/provider collusion         | Independent observer and fraud review reduce, but do not eliminate, collusion.                 | Add multi-signal risk scoring and second-person review for suspicious payouts.                                                                       |
| Malicious extension build       | Server ignores detector claims for settlement; device HMAC cannot settle earnings.             | Client distribution signing and provider-side correlation remain launch work.                                                                        |
| Network tampering               | TLS provider endpoint requirement, signed assertion, and API signature verification.           | Rehearse provider outage, timeout, and delayed delivery behavior.                                                                                    |
| Prompt/output leakage           | Protocol accepts opaque identifiers and timestamps only; docs prohibit prompts/output.         | Fuzz payloads and add privacy canaries to every new provider adapter.                                                                                |
| Database race                   | Transactional CAS, unique constraints, advisory/row locking where applicable.                  | The real-Postgres replay race is covered; mutation testing and live provider outage/retry rehearsal remain launch work.                              |
| Settlement bypass               | `wait.earnings` remains fail-closed without configured independent issuers and versions.       | Keep the switch OFF until the full launch gate and operator approval pass.                                                                           |

## Required monitoring

Alert on:

- Signature or issuer failures by provider and key id.
- Replay/conflict attempts.
- Attestation acceptance/rejection ratio changes.
- Clock-skew and duration-mismatch spikes.
- Provider callback failures and stale sessions.
- Assertions accepted while corresponding server waits are absent.
- Settlement reversals or ledger discrepancies.
- Unexpected changes to issuer/key/version configuration.

Metrics must use provider/key/version labels only; never label by prompt,
output, terminal content, raw nonce, or raw assertion.

## Residual launch risks

The following cannot be closed by the simulator or unit tests:

1. Whether an actual provider independently observes the operation.
2. Whether the provider's event and duration semantics are accurate.
3. Whether provider private keys are isolated and rotated operationally.
4. Whether the fraud model is effective against organized farms or collusion.
5. Whether the staging-to-production experiment reconciles the real ledger and
   payout path exactly once.

Until those risks are evidenced by the launch experiment, the product remains
in the clearly labelled, non-billable beta mode.
