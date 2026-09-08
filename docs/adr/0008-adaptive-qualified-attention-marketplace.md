# ADR 0008: Adaptive Qualified-Attention Marketplace

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Ateva engineering and designated operators

## Master specification

The governing specification is the **Ateva Adaptive Qualified-Attention
Marketplace — Master Implementation Plan** supplied with this workstream. This
ADR records the architectural boundary and sequencing decisions needed to
implement it safely; it does not replace that specification or authorize live
financial behavior.

## Context

Ateva currently has a mature wait-state, impression, attestation, fraud, and
append-oriented ledger architecture. The adaptive marketplace needs richer
provider-neutral lifecycle telemetry and separate measurements for:

- rendered time (`R`);
- viewable time (`V`);
- eligible AI-controlled time; and
- qualified time (`Q`), the intersection of eligible work and viewability.

Passive viewable time (`P`) may be measured, but must not become unlimited
billing inventory. Economic candidates need versioned fixed-point policies,
privacy-minimized outcomes, interpretable models, and a constrained optimizer.

The existing attestation and financial controls are security boundaries. They
must not be weakened or bypassed to obtain training data or to make the new
model easier to test.

## Decision

### 1. Additive provider-neutral domain

Introduce the adaptive attention domain additively beside the existing
wait/impression/ledger paths. Canonical lifecycle events, attention windows,
viewability measurements, policy evaluations, experiments, model metadata, and
shadow economics must remain distinguishable from settlement records.

Existing `WaitStateEvent`, `AdImpression`, and ledger semantics remain the
source of truth for historical behavior. No migration in this phase rewrites
historical transactions or changes existing billing/reward authorization.

### 2. Explicit measurement separation

The system must preserve the distinction:

```text
agent processing != human attention != ad viewability != financial eligibility
```

All durations use integer milliseconds. Economic coefficients use fixed-point
integer representations (for example parts per million), never floating-point
values in settlement calculations.

The canonical invariants are:

```text
0 <= Q <= V <= R
P = max(V - Q, 0)
P_billable <= P
Q = 0 => P_billable = 0
not viewable => Q = 0 and userReward = 0
```

During telemetry and shadow phases, these values are observations or
hypothetical calculations only. They must not authorize advertiser charges,
user rewards, payout entries, or production ledger writes.

### 3. Immutable policy versions

Marketplace parameters are represented by immutable, versioned policies. A
session is assigned one policy version at session start; later policy changes
apply only to future sessions. Every shadow calculation, experiment assignment,
model output, and eventual settlement reference is reproducible from its policy
version and model metadata.

The optimizer may recommend policies but cannot activate them or change:

- campaign budgets or advertiser maximum bids;
- money feature switches;
- attestation requirements;
- fraud kill switches;
- legal/compliance limits;
- reserve minimums; or
- operator-defined reward floors and restrictions.

### 4. Statistical models do not directly set policy

Regression and prediction models estimate advertiser value, retention/churn,
user retention/supply, fraud risk, costs, and uncertainty. A separate
constraint-aware optimizer evaluates candidate policies using those predictions
and conservative bounds. Model output cannot directly set `alpha`, reward
rates, billing, or ledger values.

Until meaningful data and approved guardrails exist, model training and policy
optimization operate offline or in shadow mode only.

### 5. Privacy-minimized data

Only canonical, allowlisted lifecycle metadata and aggregate outcomes may be
used. Prompts, assistant responses, reasoning, source code, file contents,
commands, terminal output, transcript paths, raw credentials, and complete
working-directory paths must not be persisted or used as model features.

Provider-specific identifiers are locally pseudonymized where they are needed
for correlation. Unknown or unsupported provider state is represented
explicitly, not guessed into a billable classification.

### 6. Rollout and ownership

Implementation is sequenced in waves:

1. architecture/ADR and shared contracts/database;
2. CLI/provider state, viewability, and server aggregation;
3. shadow economics and analytics/data pipeline;
4. regression/modeling and constrained optimizer;
5. admin observability and adversarial verification;
6. ledger/live settlement only after attestation, payment, fraud, legal, and
   operator launch gates are satisfied.

Each wave has an owning workstream with an allowlisted file/domain boundary,
explicit dependencies, deliverables, and acceptance tests. Agents must not
expand scope into another workstream without an explicit handoff.

## Non-goals for this ADR

This decision does **not**:

- enable `wait.earnings`, deposits, payouts, or any production money switch;
- alter current advertiser billing or developer rewards;
- make client telemetry an attestation substitute;
- claim client viewability is cryptographically unforgeable;
- authorize autonomous policy activation;
- introduce individual-level dynamic pricing;
- choose business-critical retention, churn, or fairness thresholds without
  operator approval.

## Consequences

### Positive

- New measurement and economics can be developed without destabilizing the
  existing financial system.
- Historical calculations remain reproducible and auditable.
- Provider integration, human attention, viewability, and settlement evidence
  remain separate trust domains.
- Shadow comparisons can test candidate policies before any financial effect.
- The optimizer has explicit governance and uncertainty boundaries.

### Negative

- The initial implementation duplicates some data and reconciliation concepts.
- Additive compatibility and policy versioning increase schema and test scope.
- Useful economic conclusions require sufficient causal and longitudinal data;
  the system cannot safely jump directly from telemetry to adaptive payouts.
- Live settlement remains dependent on the independent attestation and payment
  launch gates documented in the existing operational ADRs.

## Required follow-up decisions

Before Wave 6, operators must explicitly approve:

- production policy bounds and reward floors;
- advertiser and user retention/churn constraints;
- experiment cohorts and outcome windows;
- model promotion and rollback authority;
- independent attestation operation and key custody;
- payment-provider readiness and reconciliation evidence;
- canary size, monitoring, and emergency freeze procedure.

No agent may infer or silently encode these decisions.

## Acceptance criteria

This ADR is accepted because reviewers confirmed that:

1. the master implementation plan remains the governing specification;
2. the additive domain cannot write live billing, rewards, or ledger rows before
   the Wave 6 gate;
3. policy versions are immutable and session-bound;
4. measurement invariants are machine-tested;
5. privacy and attestation boundaries are preserved;
6. model output is separated from policy promotion; and
7. the workstream ownership and sequencing are documented for agents.
