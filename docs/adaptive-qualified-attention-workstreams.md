# Adaptive Qualified-Attention Marketplace — Agent Workstreams

**Governing document:** the master implementation plan supplied with this
project, together with the current repository guidance in `AGENTS.md` and the
existing architecture/operations ADRs. Every agent reads those documents first.

**Current status:** Wave 1 planning/documentation. This document assigns work;
it does not authorize implementation outside the stated wave.

## Universal hard rules

1. **No live financial changes.** Until Wave 6 is explicitly opened, agents must
   not change advertiser billing, developer rewards, payouts, settlement,
   production ledgers, money switches, attestation requirements, or campaign
   financial semantics.
2. Telemetry, hypothetical economics, model output, and optimizer output are
   non-financial. They must run in telemetry/shadow mode and be structurally
   unable to authorize money.
3. Existing wait/impression/ledger behavior remains intact unless a separately
   approved compatibility fix is required. Additive migrations are preferred.
4. Do not persist prompts, model responses, reasoning, source code, file
   contents, commands, terminal output, transcript paths, raw credentials, or
   complete working-directory paths.
5. Do not invent business-critical retention, churn, fairness, reserve, legal,
   or payout thresholds. Put unresolved choices in the decision register.
6. Every deliverable needs focused tests plus the relevant repository quality
   gates. A narrow unit test alone is not evidence of release readiness.

## Wave sequencing and gates

### Wave 1 — Architecture, ADR, shared contracts, database

**Owners:** A, B

**Dependencies:** current repository audit; ADR 0003 and ADR 0007; master
implementation plan.

**Exit gate:** canonical contracts, additive schema, migration/backward-
compatibility plan, and ADR accepted. No runtime money behavior changes.

### Wave 2 — State, viewability, aggregation

**Owners:** C, D, E

**Dependencies:** Wave 1 contracts and schema.

**Exit gate:** provider-neutral events and attention intervals are deterministic,
privacy-safe, and shadow-only. Existing billing path is unchanged.

### Wave 3 — Shadow economics and analytics

**Owners:** E, F

**Dependencies:** Wave 2 interval outputs; policy contract; approved feature
allowlist.

**Exit gate:** Q/P/W and candidate-policy evaluations reconcile against fixtures
without financial writes. Feature datasets contain only approved aggregates.

### Wave 4 — Regression/modeling and constrained optimizer

**Owners:** G, H

**Dependencies:** Wave 3 data and causal/experimental dimensions.

**Exit gate:** temporal validation, uncertainty/calibration reports, guardrail
rejection, and shadow recommendations. No policy can become active automatically.

### Wave 5 — Admin observability and adversarial testing

**Owners:** J, K

**Dependencies:** Waves 1–4 outputs.

**Exit gate:** operators can inspect and freeze shadow/candidate policies;
adversarial tests cover the required invariants and no unauthorized financial
side effect is observed.

### Wave 6 — Ledger/live settlement

**Owner:** I

**Dependencies:** all prior wave exits plus independent attestation, payment,
fraud, legal, operator approval, canary, and rollback gates.

**Exit gate:** separately approved release plan. This wave is not open by this
document.

## Agent-specific workstreams

### Agent A — Architecture and ADR

**Responsibility:** audit affected paths and document the adaptive architecture.

**Allowed areas:** `docs/adr/`, architecture docs, decision registers, and
read-only inspection of affected source paths.

**Do not modify:** runtime behavior, Prisma schema, migrations, billing,
rewards, payouts, ledgers, or feature switches.

**Dependencies:** master plan; `AGENTS.md`; ADRs 0002, 0003, 0006, 0007.

**Deliverables:** architecture map; accepted/proposed ADR; compatibility plan;
assumptions and operator decision register; wave handoff notes.

**Acceptance tests:** ADR review checklist; links resolve; explicit no-live-
money boundary; all affected existing paths named; unresolved decisions are not
silently encoded.

### Agent B — Shared contracts and database

**Responsibility:** additive normalized states, policy/session/experiment/model
metadata contracts, validation, and migrations.

**Allowed areas:** `packages/agent-protocol/`, `packages/shared/`,
`packages/db/prisma/schema.prisma`, additive Prisma migrations, and focused
contract tests.

**Do not modify:** settlement behavior, existing ledger semantics, production
billing/reward gates, or provider-specific parsing.

**Dependencies:** Agent A's contracts and ADR; current schema and migration
rules.

**Deliverables:** versioned schemas/enums; fixed-point policy fields; additive
attention/session records; experiment/model metadata; privacy-safe validation;
backward-compatible migration and rollback notes.

**Acceptance tests:** typecheck; Prisma generate; migration/drift checks; schema
round-trip tests; forbidden-field tests; policy immutability/session-binding
tests; proof that no financial relation or write path is introduced.

### Agent C — CLI/provider state engine

**Responsibility:** normalize supported provider lifecycle events and explicitly
represent unknown/unsupported state.

**Allowed areas:** `apps/cli/src/`, provider adapters, local bridge/spool code,
and provider fixture tests.

**Do not modify:** API settlement, ledger calls, reward calculations, or
provider behavior that is not evidenced by documented events.

**Dependencies:** Agent B protocol; existing hook/bridge conventions.

**Deliverables:** provider mappings; state transition handling; unknown-state
telemetry; correlation metadata; golden fixtures; latency and privacy tests.

**Acceptance tests:** fixtures normalize deterministically; AI/tool/user-
required/idle states are distinct; malformed and unsupported events fail safe;
raw payload data is discarded; hook hot path makes no synchronous network call;
no money endpoint is invoked.

### Agent D — Viewability

**Responsibility:** measure foreground, panel, visibility, lock/sleep, render,
and lifecycle signals without claiming gaze detection.

**Allowed areas:** VS Code attention/viewability code, CLI presentation signals,
shared viewability contracts, and tests.

**Do not modify:** advertiser billing, rewards, attestation trust, or any code
that treats viewability alone as settlement proof.

**Dependencies:** Agent B contracts; Agent C correlation identifiers.

**Deliverables:** viewability state machine; visible-surface measurements;
transition handling; crash/restart behavior; local-only uncertainty markers.

**Acceptance tests:** foreground/background, minimized, panel switch, ad load
failure, visibility transitions, close/crash, and sleep/lock scenarios; integer
millisecond durations; no-viewability implies Q=0 and reward=0 in shadow
calculations; no gaze-detection claim.

### Agent E — Attention aggregation and shadow economics

**Responsibility:** reconstruct canonical intervals and calculate Q, P,
P_billable, W, and hypothetical policy outcomes.

**Allowed areas:** new attention aggregation/economics modules, pure helpers,
shadow tables or outputs, and focused tests.

**Do not modify:** live ledger writes, advertiser charges, user rewards,
settlement authorization, or existing impression qualification semantics.

**Dependencies:** Agents B–D; approved policy bounds; current time/order rules.

**Deliverables:** deterministic overlap/order/reconnect handling; fixed-point
policy evaluator; shadow-equivalence reports; idempotency and replay handling.

**Acceptance tests:** required mathematical invariants; zero-Q passive cap;
non-viewable behavior; session policy immutability; duplicate/out-of-order
fixtures; property tests; explicit proof that execution has no ledger or money
side effect.

### Agent F — Analytics and data pipeline

**Responsibility:** privacy-minimized aggregates, labels, experiment dimensions,
and marketplace metrics.

**Allowed areas:** analytics schemas/jobs, aggregate queries, dataset manifests,
feature definitions, and data-quality tests.

**Do not modify:** raw event retention policy without approval; settlement;
provider payload storage; production money tables.

**Dependencies:** canonical events and economics outputs from Waves 1–3;
privacy allowlist.

**Deliverables:** versioned datasets; time windows; advertiser/user/platform
metrics; outcome labels; feature lineage; retention and deletion behavior.

**Acceptance tests:** no forbidden fields; no future leakage; deterministic
reruns; time-based splits; aggregate reconciliation; environment/experiment/
policy dimensions present; dataset digest and timestamp recorded.

### Agent G — Regression/modeling

**Responsibility:** interpretable advertiser, user, cost, risk, retention, and
marginal-value models.

**Allowed areas:** offline modeling code, reports, artifact metadata, backtests,
and model tests.

**Do not modify:** active policy, settlement, live reward rate, or production
feature switches.

**Dependencies:** Agent F datasets; approved constraints; causal experiment
assignments.

**Deliverables:** versioned model artifacts; training manifests; temporal
validation; marginal effects; uncertainty; calibration; rollback metadata.

**Acceptance tests:** no future-data leakage; reproducible training; feature
allowlist; calibration/backtest reports; artifact digest; failure on corrupted
or incompatible artifacts; model output is advisory input only.

### Agent H — Constrained optimizer

**Responsibility:** evaluate candidate policy vectors under approved constraints
and produce shadow recommendations.

**Allowed areas:** optimizer, policy simulation, constraint configuration, and
recommendation reports.

**Do not modify:** active-policy status, money switches, campaign budgets/bids,
attestation/fraud controls, or ledgers.

**Dependencies:** Agents E–G; operator-approved guardrails.

**Deliverables:** uncertainty-aware candidate evaluation; current-vs-candidate
comparison; violated-constraint explanations; recommendation and rollback
report; shadow-only execution mode.

**Acceptance tests:** rejects every guardrail violation; never exceeds bid,
budget, reward-floor, reserve, or delta constraints; handles model failure by
retaining current policy; cannot activate a policy; reports uncertainty and
sample size; property tests cover runaway candidates.

### Agent I — Ledger/live settlement

**Responsibility:** future version-aware settlement integration only after the
full launch gate opens.

**Allowed areas before Wave 6:** documentation, interface review, migration
impact analysis, and isolated non-financial test doubles only.

**Forbidden before Wave 6:** any production ledger, charge, reward, payout,
settlement, or money-switch change.

**Dependencies:** all prior waves; ADR acceptance; shadow reconciliation;
independent attestation; payment/fraud/legal/operator gates.

**Deliverables:** gated implementation plan; historical-policy compatibility;
exactly-once settlement design; canary and rollback plan.

**Acceptance tests:** preconditions are machine-enforced; historical rows remain
reproducible; `C >= U + R`; ambiguous evidence fails closed; concurrency and
idempotency tests; separate operator approval recorded.

### Agent J — Admin and observability

**Responsibility:** inspect policies, experiments, model versions, economics,
confidence, and rollback/freeze state.

**Allowed areas:** admin read-only/operational UI and APIs for telemetry,
shadow results, audit views, and emergency policy freeze.

**Do not modify:** financial activation, campaign budgets, payout controls,
or attestation requirements.

**Dependencies:** policy/model/optimizer metadata from Waves 1–4.

**Deliverables:** policy history; current/candidate comparison; experiment and
model reports; uncertainty and constraint displays; freeze/rollback controls.

**Acceptance tests:** role guards; no secret/raw-content exposure; historical
versions auditable; freeze is fail-closed; candidate cannot become active from
UI/API; accessibility and browser coverage.

### Agent K — Adversarial verification

**Responsibility:** attack lifecycle, viewability, aggregation, models, optimizer,
and future settlement boundaries.

**Allowed areas:** adversarial tests, scenario harness, fault injection, audit
scripts, and test fixtures.

**Do not modify:** production behavior merely to make attacks pass; do not enable
live money or weaken gates.

**Dependencies:** each wave's contracts and test surfaces.

**Deliverables:** attack matrix; regression tests; privacy canaries; concurrency,
replay, clock, malformed-artifact, and runaway-optimizer scenarios; release
report.

**Acceptance tests:** fake qualified states, background windows, overlap,
reordering, replay, abandoned sessions, long passive intervals, zero-Q passive
exposure, mid-session policy changes, forged policy IDs, budget races, duplicate
settlement attempts, model failures, and optimizer runaway all fail safely.
