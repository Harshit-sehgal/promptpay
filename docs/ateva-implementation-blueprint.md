# WaitLayer Implementation Blueprint

## Sandbox-to-Beta Product, Architecture, Security, Testing, and Delivery Strategy

**Audit date:** 4 August 2026  
**Repository:** `Harshit-sehgal/promptpay`  
**Audited branch:** `main`  
**Audited commit:** `89ef9b6d21bc62fffbc037e4c2902cc1a5db787d`  
**Document status:** Implementation-ready for Release 0.x  
**Commercial status:** No real advertiser billing, withdrawable earnings, or payouts are authorized by this plan.

---

## 1. Purpose of this document

This document converts the current WaitLayer codebase and the product decisions made so far into an implementation-ready delivery strategy.

Its purpose is not to decide every future business question before development starts. Its purpose is to:

1. establish the architecture that will remain valid when those decisions are made;
2. identify the material gaps between the current repository and the intended product;
3. separate work that must be completed now from work that can be deferred safely;
4. define the sandbox and autonomous-agent beta precisely;
5. prevent an internal simulation from accidentally weakening production financial controls;
6. give a coding team or coding agent clear work packages, dependencies, acceptance criteria, and release gates;
7. define what evidence is required before each later release.

The immediate objective is:

> Build a complete, production-shaped WaitLayer sandbox in which real coding agents can use WaitLayer through VS Code and terminal workflows, see test advertising placements, accumulate unmistakably simulated rewards, exercise simulated advertiser and operator flows, and generate reproducible quality, fraud, reliability, and accounting evidence.

The sandbox is not a public paid product. It is the instrument through which the product will be discovered and validated.

---

## 2. Verification basis and limitations

### 2.1 Sources treated as authoritative

The strategy was derived primarily from current source code rather than repository claims.

The most important inspected sources were:

- `package.json`
- `README.md`
- `AGENTS.md`
- `FOUNDATION_STATUS.md`
- `packages/db/prisma/schema.prisma`
- `packages/config/src/index.ts`
- `.env.example`
- `apps/api/src/runtime-config/runtime-config.service.ts`
- `apps/api/src/extension/extension-wait.trait.ts`
- `apps/api/src/extension/extension-ad.trait.ts`
- `apps/cli/src/commands/run.ts`
- `apps/cli/src/lib/api-client.ts`
- `apps/vscode-extension/src/wait-detector.ts`
- `apps/vscode-extension/src/detector-adapters.ts`
- `apps/vscode-extension/src/extension.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/staging.yml`
- legal and policy pages under `apps/web/src/app`
- `docs/ops/remaining-open-items.md`

Current official lifecycle-hook documentation for Claude Code and Codex, and current VS Code shell-integration APIs, were also checked because those external interfaces can change.

### 2.2 What is demonstrably strong today

The repository already contains a substantial foundation:

- authenticated developer, advertiser, admin, and support roles;
- campaign lifecycle and creative review;
- append-oriented developer, advertiser, and platform ledgers;
- 60/30/10 split logic;
- payout lifecycle, holds, provider adapters, reconciliation, and fraud fences;
- idempotent wait, impression, click, ledger, webhook, and payout paths;
- consent records, retention controls, data export, and account erasure;
- per-device event signing;
- runtime kill switches for ads, earnings, deposits, payout requests, and automated payouts;
- independently verifiable wait-attestation session and assertion models;
- Docker, migration, browser E2E, package, backup/restore, security, and financial coverage gates;
- a working terminal wrapper (`waitlayer run -- ...`);
- a working VS Code extension with telemetry consent, false-positive feedback, experiment assignment, and heuristic wait detection.

This is valuable. The project does not need to be rewritten.

### 2.3 What is not yet proven

The latest source should not be treated as release-verified merely because historical documentation reports green gates.

At the time of this audit:

- the latest commit had a failing Vercel status;
- no corresponding pull-request workflow run was returned for the latest commit;
- no open issue backlog existed;
- a local clone and fresh full test run could not be performed in the audit environment because network access to GitHub was unavailable;
- the repository itself states that destructive integration resets require explicit consent and an isolated test database;
- the current full staging workflow assumes an attestation-enabled financial smoke rather than the new agent-only product sandbox described here.

Therefore, the first implementation task is to reproduce the entire gate set on an isolated developer machine or CI runner and record the results against the exact starting SHA.

### 2.4 Scope of the word “gap”

This document identifies material product, architecture, privacy, abuse, reliability, delivery, and operational gaps that block the intended sandbox-to-beta path.

It does not claim that no undiscovered line-level defect exists. That claim would require a fresh full build, test, deployment, adversarial run, and runtime observation. The plan explicitly creates those verification mechanisms.

---

## 3. Decisions already locked

The following decisions should be treated as current product directives.

### 3.1 Brand

The working product name is **WaitLayer**.

The repository may remain named `promptpay` temporarily, but all newly built product surfaces, protocol names, events, packages, and documentation should use WaitLayer.

### 3.2 Release philosophy

The product will be developed through narrow, measurable releases rather than one large launch.

Each release must prove a specific uncertainty and must have explicit entry and exit criteria.

### 3.3 Initial environments

The first complete product must cover both:

- VS Code workflows; and
- terminal coding-agent workflows.

This does not mean supporting every IDE and every agent immediately. It means supporting one reliable VS Code path and two high-quality native terminal integrations, with a generic fallback.

### 3.4 Integration hierarchy

The integration priority is:

1. native provider hooks or plugins;
2. a generic WaitLayer wrapper where native lifecycle events are unavailable;
3. optional process discovery only for setup suggestions and diagnostics.

Process scanning is never a sufficient source of truth for reward-bearing activity.

### 3.5 Background work

Background agent work is legitimate and valuable.

It must be recorded as agent-processing and delegated-work activity even when the user leaves the screen. It must not automatically be represented as continuous human advertising attention.

The system must distinguish:

- agent processing;
- user attention;
- user return;
- meaningful completion;
- advertising viewability; and
- future financial eligibility.

### 3.6 Privacy default

Release 0.x must not transmit or store:

- raw prompts;
- raw assistant responses;
- source code;
- file contents;
- terminal output;
- command arguments;
- transcript files;
- complete working-directory paths; or
- reasoning traces.

Only whitelisted lifecycle metadata may leave the device.

### 3.7 Financial policy

The existing standard split remains:

- 60% developer;
- 30% WaitLayer;
- 10% fraud/payment reserve.

In Release 0.x, the split is simulated only.

### 3.8 Paid launch boundary

No client-held HMAC, local hook, VS Code signal, wrapper observation, autonomous-agent report, or sandbox result authorizes real money.

Real earnings remain blocked until an independently verifiable attestation path has been implemented, externally reviewed, operationally deployed, and explicitly enabled.

---

## 4. Strategic product model

WaitLayer should not define its product as “pay users for every second an AI process exists.”

The product should be modeled as four related layers.

### 4.1 Agent-work layer

This answers:

- Is an AI agent actually performing work?
- Which provider and integration produced the event?
- Is the agent active, waiting for permission, stopped, failed, or completed?
- Are subagents or parallel work units running?
- Did the agent produce a completion event?

This layer powers productivity analytics.

### 4.2 Human-attention layer

This answers:

- Is a WaitLayer-capable surface actually visible?
- Is the user in the foreground?
- Did the user return after a completion or permission request?
- Is there one or more competing windows?
- Is the attention signal sufficiently reliable?

This layer prevents “ten agents running” from being interpreted as “ten humans watching.”

### 4.3 Advertising-opportunity layer

This answers:

- Is there a suitable moment to present a clearly labeled placement?
- What type of placement is it?
- Is the user likely to see it?
- Would it obstruct or manipulate an agent control?
- Has this task or event already produced an opportunity?
- Has frequency, quiet-mode, category, geography, and safety policy passed?

This layer creates inventory without assuming it is billable.

### 4.4 Financial-authorization layer

This answers:

- Was the opportunity independently verified?
- Was the placement actually rendered and viewable?
- Did all current kill switches still permit the transaction?
- Is the user active and eligible?
- Is the campaign funded?
- Is the event unique and unreplayed?
- Do ledgers reconcile exactly?

This layer remains disabled in Release 0.x except for isolated test credits.

### 4.5 The fundamental invariant

```text
Agent processing time
        ≠
Human attention time
        ≠
Ad viewability
        ≠
Financial eligibility
```

A single event can contribute to more than one layer, but one layer must never silently substitute for another.

---

## 5. Recommended release sequence

### Release 0.1 — Verified baseline and delivery controls

**Objective:** establish a trustworthy starting point.

Deliverables:

- full gates run against the exact baseline SHA;
- Vercel failure diagnosed or Vercel explicitly removed from the required deployment path;
- branch protection enabled;
- implementation backlog created;
- feature branch and migration policy established;
- separate sandbox environment and secrets namespace created;
- sandbox mode specified in configuration;
- all money switches confirmed off in non-sandbox environments.

Exit criteria:

- typecheck, lint, build, unit/integration, browser E2E, package, migration/drift, Docker, backup/restore, dependency, and security gates pass;
- no destructive test points at a non-test database;
- required checks are attached to protected `main`;
- the exact release evidence is stored as a CI artifact.

### Release 0.2 — Agent lifecycle protocol

**Objective:** create a provider-neutral event model.

Deliverables:

- shared protocol package;
- event taxonomy and schema versions;
- local sanitizer;
- signed and idempotent batch-ingestion endpoint;
- durable event tables;
- offline queue and replay behavior;
- legacy wait-event path left intact.

Exit criteria:

- provider fixtures normalize to the same canonical events;
- forbidden fields are rejected locally and server-side;
- duplicate and out-of-order events are handled deterministically;
- no event can create money.

### Release 0.3 — Native terminal integrations

**Objective:** support native Claude Code and Codex lifecycle events plus wrapper fallback.

Deliverables:

- hook installer, status, repair, and uninstaller;
- Claude Code adapter;
- Codex adapter;
- generic `waitlayer run` compatibility adapter;
- local event spool/bridge;
- capability/version reporting;
- terminal completion experience that does not corrupt agent stdout.

Exit criteria:

- genuine coding tasks produce correct session, processing, permission, tool, subagent, completion, failure, and end events where the provider exposes them;
- the hook path adds negligible blocking latency;
- prompt/tool payloads are discarded before persistence or upload;
- wrapper mode still works for unsupported agents.

### Release 0.4 — VS Code attention and correlation layer

**Objective:** make VS Code the attention sensor and controlled presentation surface.

Deliverables:

- extension subscribes to normalized agent sessions from the local bridge;
- VS Code focus, visibility, task, and terminal-shell signals are correlated rather than used as proof of AI generation;
- native events take precedence over heuristics;
- heuristic inactivity remains local shadow telemetry only;
- overlapping VS Code and terminal observations are deduplicated;
- foreground, background, return, and visible-surface windows are modeled.

Exit criteria:

- a terminal agent running inside VS Code is represented as one session, not two;
- focus changes create correct attention windows;
- closing/restarting VS Code does not corrupt agent sessions;
- no advertisement is shown from inactivity alone.

### Release 0.5 — Complete isolated sandbox economy

**Objective:** exercise the entire business workflow without real money.

Deliverables:

- dedicated sandbox database and Redis;
- unmistakable sandbox UI and API mode;
- XTS/test-credit accounting;
- sandbox advertiser faucet;
- house/test campaigns;
- sandbox payout provider;
- developer, advertiser, and operator journeys;
- placement-aware ad opportunities;
- exact ledger reconciliation and reset tools.

Exit criteria:

- no production payment credential is accepted by the sandbox;
- no sandbox row can appear in a production ledger;
- advertiser test debit equals developer test credit plus platform test credit plus reserve test credit;
- refund, reversal, hold, release, and payout simulations reconcile;
- all sandbox surfaces say “test” or “simulated.”

### Release 0.6 — Deterministic beta simulation

**Objective:** prove expected workflows repeatedly.

Deliverables:

- disposable fixture repositories;
- scenario manifest format;
- terminal subprocess harness;
- VS Code extension/Electron harness;
- web Playwright journeys;
- deterministic auditor;
- fault injection;
- machine-readable report.

Exit criteria:

- critical scenarios pass repeatedly from clean state;
- expected and observed event timelines match;
- duplicate earnings and duplicate placements remain zero;
- every ledger invariant is exact;
- failures produce actionable artifacts.

### Release 0.7 — Adversarial and endurance sandbox

**Objective:** discover abuse and reliability failure modes.

Deliverables:

- fraud personas;
- replay, concurrency, clock, account, click, and completion attacks;
- provider outage and malformed-event scenarios;
- long-duration and restart tests;
- queue pressure and backfill tests;
- risk dashboard.

Exit criteria:

- no tested attack creates unauthorized test credit;
- ambiguous financial operations fail closed;
- agent and UI outages do not lose or multiply events;
- critical defects have owners and regression tests.

### Release 0.8 — Autonomous agent-only closed beta

**Objective:** let autonomous agents use the sandbox as normal users.

Deliverables:

- new-user, normal-user, distracted-user, power-user, advertiser, operator, fraud, reliability, and auditor personas;
- exploratory computer-use runs in disposable VMs;
- structured feedback;
- issue deduplication and triage;
- per-build beta scorecard.

Exit criteria:

- autonomous users can onboard and complete the main flows without internal APIs;
- critical actions are possible through the same UI/CLI as future users;
- no unresolved critical security, privacy, ledger, or data-loss defect remains;
- repeated agent runs produce stable results.

### Release 0.9 — Invited human alpha

**Objective:** measure comprehension, trust, annoyance, and real behavior.

Scope:

- small invited cohort;
- telemetry and simulated credits only;
- no public marketplace promises;
- explicit research consent and feedback.

This release is required because agents cannot prove human trust, perceived privacy, ad tolerance, or retention.

### Release 1.0 — Public telemetry beta

**Objective:** validate detection quality and developer retention at larger scale.

Still disabled:

- real advertiser deposits;
- withdrawable earnings;
- real payouts;
- claims that every detected minute is monetizable.

---

## 6. Current architecture assessment

### 6.1 Components to retain

The following current components should be extended rather than replaced:

| Component | Current strength | Recommended treatment |
|---|---|---|
| NestJS API | mature auth, role, ledger, fraud, payout, audit and runtime modules | retain |
| Next.js web | developer/advertiser/admin surfaces already exist | make mode-aware and sandbox-aware |
| Prisma/Postgres | strong relational and accounting foundation | add agent-domain tables additively |
| Redis | rate limiting and runtime invalidation | retain; add queue/lock use only where justified |
| RuntimeConfig | fail-closed financial switches | retain and extend |
| WaitAttestation | sound future financial boundary | retain; do not fake for sandbox |
| CLI | authentication, device registration, wrapper, signing | evolve into integration manager and local bridge client |
| VS Code extension | consent, UX, focus/task signals, ad panel | evolve into attention adapter and presentation client |
| CI | unusually comprehensive for project maturity | add protocol, adapter, and agent-beta gates |
| Ledgers | robust idempotency and reconciliation | reuse in isolated sandbox with explicit test currency/provider |

### 6.2 Components that are currently too coarse

#### Wait-state event model

Current `EventType` is centered on:

- `wait_state_start`;
- `wait_state_end`;
- ad request/render/qualification;
- click/report.

This cannot faithfully represent:

- provider sessions;
- user turns;
- tool calls;
- permission requests;
- subagents;
- tasks;
- foreground/background transitions;
- return-to-result;
- partial completion;
- stop failure;
- simultaneous tasks; or
- placement-specific opportunities.

#### VS Code detector

The source explicitly acknowledges that mappings for Claude, Codex, Cursor, Cline, and Aider are name-based heuristics rather than observed lifecycle events.

The detector:

- allows one active inferred wait;
- uses editor inactivity;
- sees VS Code tasks;
- uses terminal lifecycle heuristics;
- cannot read other extensions’ state;
- does not model agent tasks independently from attention.

It is useful as shadow telemetry. It must not become the core agent model.

#### Terminal wrapper

`waitlayer run -- ...` reliably observes process start and exit, but it cannot understand rich internal agent lifecycle state without parsing unstable terminal output.

It is a strong fallback, not the ideal primary integration.

#### Ad model

The campaign model currently supports category, country, CPM/CPC, bids, budgets, and frequency caps.

It does not model:

- placement type;
- lifecycle trigger;
- attention confidence;
- integration confidence;
- completion/permission/failure context;
- per-placement bid override;
- per-placement frequency policy; or
- ad-opportunity eligibility.

#### Staging workflow

The current staging release gate is designed to prove the financial loop with a configured attestation provider.

The new product-development sandbox needs a separate mode. It must not require operators to pretend a reference or locally controlled attester is independent.

---

## 7. Material gap register

Priority definitions:

- **P0:** blocks safe implementation or invalidates the sandbox result.
- **P1:** required before autonomous agent beta.
- **P2:** required before invited human alpha or public telemetry beta.
- **P3:** required only before real-money or broader international launch.

### 7.1 P0 gaps

#### WL-G001 — No authoritative live baseline on the latest SHA

**Problem:** historical green claims exist, but the latest remote status is not verified and Vercel is failing.

**Risk:** new architecture work may begin on a broken baseline, making regressions difficult to attribute.

**Resolution:**

1. run `scripts/ci-local.sh` against an isolated test database;
2. run Docker build and boot;
3. run full GitHub Actions on the exact SHA;
4. diagnose the Vercel failure;
5. either fix Vercel or document that Vercel is not a required deployment target;
6. store a baseline artifact with versions, hashes, migrations, test counts, and results.

**Acceptance:** one immutable baseline report with all required gates green.

---

#### WL-G002 — No executable product backlog

**Problem:** the repository has no open issue backlog even though substantial new product work is required.

**Risk:** autonomous coding agents may change unrelated systems, duplicate work, or claim completion without release-level evidence.

**Resolution:**

- create epics for protocol, terminal adapters, VS Code, sandbox, placements, agent harness, privacy, security, CI, and UX;
- create one issue per independently reviewable change;
- record dependencies and acceptance criteria;
- prohibit large “implement everything” commits.

**Acceptance:** every implementation commit maps to one issue and one release objective.

---

#### WL-G003 — Sandbox and production are not sufficiently separated

**Problem:** the current repository has staging smoke and dev stubs, but not a product-wide sandbox identity and isolation contract.

**Risk:** fake deposits, test campaigns, fake payouts, or test ads could mix with real records or be mistaken for real value.

**Resolution:**

- use a separate database, Redis namespace/instance, object storage prefix, email domain/driver, and deployment environment;
- add `WAITLAYER_ENVIRONMENT_KIND=development|test|sandbox|staging|production`;
- reject `sandbox` provider/faucet/test-currency configuration outside `sandbox` or `test`;
- reject production provider credentials in sandbox where possible;
- display a persistent sandbox badge;
- use ISO testing currency code `XTS` internally and label it “Test credits” to users;
- block withdrawals and external transfers;
- produce environment ID in every audit, event, and report.

**Acceptance:** an automated test proves sandbox startup fails when pointed at a production-marked database, and production startup fails when sandbox features are enabled.

---

#### WL-G004 — Current lifecycle domain is too narrow

**Problem:** `wait_state_start/end` cannot represent the product being built.

**Risk:** adding special cases to the current model will create unmaintainable semantics and incorrect advertising/attention claims.

**Resolution:** introduce an additive provider-neutral agent lifecycle model described in Section 8.

**Acceptance:** Claude Code, Codex, wrapper, and VS Code fixture events normalize into one schema without provider-specific fields leaking into core services.

---

#### WL-G005 — No safe native-hook ingestion path

**Problem:** Claude Code and Codex hooks can expose sensitive prompt, tool-input, path, and transcript data.

**Risk:** sending raw hook payloads to the API would violate the intended privacy model.

**Resolution:**

- hooks invoke a local WaitLayer sanitizer;
- sanitizer uses an allowlist, not a blacklist;
- network upload never occurs with raw provider payloads;
- prompt text, tool input, commands, outputs, transcript paths, and raw CWD are discarded;
- only canonical lifecycle metadata is queued;
- server repeats forbidden-field checks;
- property/fuzz tests inject secrets and source fragments and prove they never reach the canonical event.

**Acceptance:** raw fixture payloads containing planted secrets produce canonical events containing none of those values.

---

#### WL-G006 — No cross-surface correlation

**Problem:** a terminal agent inside VS Code can be observed by provider hooks, the CLI wrapper, VS Code tasks, shell integration, and window state.

**Risk:** one task becomes multiple sessions, impressions, or rewards.

**Resolution:**

- create one local installation identity;
- hash provider session identifiers locally;
- correlate using provider, session hash, workspace hash, time, and integration priority;
- define source precedence: native hook > wrapper lifecycle > VS Code task/shell observation > heuristic;
- store lower-priority evidence as corroboration, not a second session;
- implement deterministic merge rules.

**Acceptance:** the same Codex/Claude run inside VS Code creates one agent session and one completion opportunity.

---

#### WL-G007 — Sandbox ad testing is blocked by correct production safety behavior

**Problem:** current ad serving returns no ad unless the launch mode is `earnings_enabled`, which correctly requires attestation.

**Risk:** developers may weaken production controls just to test the sandbox.

**Resolution:**

- create a separate sandbox opportunity and auction path;
- sandbox ads must use house/test campaigns and XTS;
- sandbox path must never set production `billingAuthorizedAt`;
- existing production `earnings_enabled` requirements remain untouched;
- the client receives a distinct `mode: sandbox`;
- sandbox impressions are visibly and structurally marked.

**Acceptance:** sandbox ads work while `WAIT_EARNINGS=false`; production ads still do not.

---

#### WL-G008 — No autonomous beta harness

**Problem:** existing tests validate code, browser flows, packages, payout sandbox paths, and staging smoke, but no agent behaves as a complete beta user.

**Resolution:** implement the scenario and agent-beta harness in Section 12.

**Acceptance:** a clean environment can run a normal terminal-user journey, a VS Code journey, an advertiser journey, an operator journey, and an auditor journey and produce one report.

---

#### WL-G009 — Product surfaces can misrepresent beta state

**Examples:**

- contact copy emphasizes payouts and campaigns;
- extension commands emphasize “earnings”;
- balances can look monetary;
- support addresses and service-level expectations are hardcoded;
- production domains are embedded in distributed clients;
- Terms and payout policy contain inconsistent hold language.

**Risk:** testers misunderstand simulated value or believe support/payment promises are active.

**Resolution:**

- centralize `ProductMode`;
- mode-aware vocabulary;
- “Test credits” instead of earnings in sandbox;
- “Projected/research only” where applicable;
- persistent mode banner;
- remove unsupported support SLA;
- centralize public contact/domain configuration;
- fix policy inconsistency before any external tester.

**Acceptance:** a screenshot/text scan finds no unqualified real-money claim in sandbox mode.

---

#### WL-G010 — Installation identity is overly derived from host attributes

**Problem:** the CLI fingerprint currently derives from hostname, username, home directory, OS details, release, architecture, and memory before hashing.

**Risk:**

- privacy concerns;
- instability after machine changes;
- collisions in cloned environments;
- difficulty rotating identity;
- unnecessary linkage to host attributes.

**Resolution:**

- generate a random installation ID on first run;
- store it in the OS keychain or protected local storage;
- use a server-keyed pseudonymous device hash for abuse correlation;
- retain coarse platform/version fields separately;
- migrate existing devices without breaking recovery;
- do not collect raw hostname, username, or home path.

**Acceptance:** fresh installs produce stable random IDs and event registration no longer depends on personal host strings.

---

### 7.2 P1 gaps

#### WL-G011 — Hook installation and ownership are undefined

Need:

- user-level versus project-level policy;
- merge behavior with existing hooks;
- trust prompts;
- idempotent upgrades;
- backup/restore;
- uninstall;
- managed environments;
- minimum provider version;
- disabled-hook detection;
- health reporting.

**Recommendation:** default to user-level hooks after explicit consent. Allow project-level mode only when a user chooses it. Never overwrite the entire provider hook file.

---

#### WL-G012 — Hook execution could interfere with coding agents

Command hooks may block an agent if slow, malformed, or configured incorrectly.

**Resolution:**

- hot path only validates and writes locally;
- no API request in the synchronous hook path;
- strict timeout;
- empty success response/exit 0;
- WaitLayer never returns permission decisions;
- failures are non-blocking;
- performance metric for p50/p95/p99 handler latency;
- kill switch and uninstall command.

---

#### WL-G013 — No local durable event queue

Network failures currently produce best-effort warnings. Native lifecycle events need durable delivery.

**Resolution:**

- local append-only spool or SQLite queue;
- encrypted/protected storage permissions;
- bounded capacity;
- event TTL;
- acknowledgements;
- retry with jitter;
- poison-event quarantine;
- crash-safe writes;
- user-visible queue health;
- delete on logout/account deletion.

---

#### WL-G014 — No event schema compatibility policy

Need:

- `schemaVersion`;
- adapter version;
- client version;
- minimum/blocked versions;
- tolerant readers;
- server-side compatibility matrix;
- deprecation period;
- golden fixtures.

---

#### WL-G015 — No foreground/background/return state machine

Window focus exists, but the product semantics do not.

Need:

- `AttentionWindow`;
- one active human-attention owner per installation;
- return detection;
- visibility duration;
- surface visibility;
- sleep/lock handling;
- multi-monitor caveat;
- remote/SSH caveat;
- confidence score;
- no mouse-jiggling proof.

---

#### WL-G016 — Concurrency policy is incomplete

Need explicit handling for:

- multiple provider sessions;
- multiple VS Code windows;
- nested subagents;
- parallel tool calls;
- tmux;
- SSH;
- WSL/containers;
- one user on multiple devices;
- restarts and resumes.

Rule:

> Record all legitimate agent work, but never multiply a single person’s attention window.

---

#### WL-G017 — No placement-aware campaign model

Need a new `AdOpportunity` and placement model instead of passing only `waitStateId` to generic ad selection.

Initial placement types:

- `foreground_wait`;
- `completion_return`;
- `input_required`;
- `background_sponsor`;
- `failure_recovery`;
- `dashboard_native`.

Only the first two should be candidates for the first external beta. The others remain sandbox experiments.

---

#### WL-G018 — No sandbox provider and test-currency policy

Need:

- `sandbox` payout provider;
- XTS currency policy;
- fake deposit provider/faucet;
- deterministic provider responses;
- delayed, failed, duplicated, ambiguous, and reversed outcomes;
- production config rejection;
- sandbox-only admin controls.

---

#### WL-G019 — No scenario truth labels

Autonomous agents cannot be used as the sole ground truth for detection.

Need each deterministic scenario to declare:

- expected provider events;
- expected session boundaries;
- expected attention windows;
- expected opportunities;
- expected impressions;
- expected ledger entries;
- forbidden events;
- tolerances.

---

#### WL-G020 — No issue-quality control for autonomous reports

Agents can produce duplicates, low-confidence observations, or incorrect diagnoses.

Need:

- report fingerprint;
- reproduction confidence;
- evidence links;
- build SHA;
- scenario ID;
- severity rubric;
- deduplication;
- human approval before issue creation for medium/low confidence;
- automatic creation only for deterministic assertion failures.

---

#### WL-G021 — No operational sandbox reset policy

Need:

- tenant/run isolation;
- deterministic seed;
- reset token;
- database/schema per run where feasible;
- artifact retention;
- no manual database repair accepted as a pass;
- cleanup after interrupted runs.

---

#### WL-G022 — CLI public-install friction is unmeasured

Current CLI requires Node 22 and a native keyring package.

Before human alpha, test:

- clean Windows;
- macOS;
- Ubuntu;
- Pop!_OS;
- WSL;
- headless Linux;
- environments without a secret-service/keychain;
- proxies and restricted networks.

Longer-term, consider standalone signed binaries, but this is not required to start Release 0.2.

---

#### WL-G023 — VS Code publication readiness is incomplete

The extension is `UNLICENSED`, uses the provisional publisher, and defaults to production domains.

Before external distribution:

- choose source/package license;
- secure publisher identity;
- verify marketplace policy compatibility;
- sign packages;
- use alpha/beta channels;
- test update and rollback;
- ensure sandbox builds point only to sandbox endpoints.

---

### 7.3 P2 gaps

These do not block the internal sandbox but block human/public beta.

- real, monitored support/privacy/security mailboxes;
- owned domain and DNS;
- accurate legal entity naming;
- removal of `WaitLayer, Inc.` unless that entity exists;
- consistent privacy contact domain;
- corrected payout hold wording;
- finalized telemetry notice and consent version;
- employer/workplace-use notice;
- age policy;
- analytics-vendor decision or explicit no-vendor decision;
- public incident/status page;
- client release signing and provenance;
- accessibility and usability study;
- human false-positive labeling workflow;
- retention policy for new agent lifecycle data;
- model/provider compatibility support policy;
- clear explanation that background processing is analytics, not paid attention;
- public beta kill-switch and rollback rehearsal.

### 7.4 P3 gaps

These block real-money or broad international launch, not current building:

- legal entity and banking;
- advertiser deposit provider;
- payout rails and live credentials;
- KYC/AML/sanctions design;
- tax reporting;
- country and currency allowlist;
- China-specific infrastructure/compliance decision;
- independent attestation provider and security review;
- advertiser contracts and refund/chargeback policy;
- final placement pricing;
- real campaign moderation operations;
- two-person payout controls;
- finance reconciliation staffing;
- insurer/security review where appropriate;
- data-transfer and subprocessor agreements.

---

## 8. Canonical agent lifecycle architecture

### 8.1 New shared package

Create:

```text
packages/agent-protocol
```

Responsibilities:

- event enums;
- Zod schemas;
- canonical metadata types;
- provider capability types;
- forbidden-field scanner;
- normalization helpers;
- state-machine utilities;
- golden fixture loader;
- version compatibility;
- event signing payload definition.

Do not put provider-specific parsing in this package.

### 8.2 Canonical event envelope

Every canonical event should contain:

```ts
interface AgentLifecycleEventV1 {
  schemaVersion: 1;
  eventId: string;
  idempotencyKey: string;

  environmentKind: 'development' | 'test' | 'sandbox' | 'staging' | 'production';

  installationId: string;
  deviceId?: string;

  provider:
    | 'claude_code'
    | 'codex_cli'
    | 'aider'
    | 'generic_wrapper'
    | 'vscode'
    | 'unknown';

  integrationMode:
    | 'native_hook'
    | 'native_plugin'
    | 'wrapper'
    | 'vscode_observation'
    | 'heuristic_shadow';

  providerSessionHash?: string;
  providerTurnHash?: string;
  providerTaskHash?: string;
  workspaceHash?: string;

  eventType: AgentEventType;
  sourceType: 'observed' | 'derived' | 'inferred';
  confidence: number;

  occurredAt: string;
  monotonicOffsetMs?: number;
  sequence?: number;

  correlationId: string;
  causationId?: string;
  parentCorrelationId?: string;

  adapterVersion: string;
  clientVersion: string;
  providerVersion?: string;

  metadata: CanonicalAgentMetadata;
}
```

### 8.3 Event taxonomy

Use namespaced canonical events.

#### Session

- `session.started`
- `session.resumed`
- `session.paused`
- `session.ended`

#### Turn/work unit

- `turn.submitted`
- `turn.processing_started`
- `turn.processing_stopped`
- `turn.completed`
- `turn.failed`
- `turn.cancelled`

#### Tool lifecycle

- `tool.started`
- `tool.succeeded`
- `tool.failed`
- `tool.batch_completed`

#### Permission/input

- `input.required`
- `input.resolved`
- `permission.required`
- `permission.allowed`
- `permission.denied`

WaitLayer should observe these events; it should never make the permission decision in Release 0.x.

#### Subagent/task

- `subagent.started`
- `subagent.stopped`
- `task.created`
- `task.completed`
- `task.failed`

#### User/attention

- `user.foregrounded`
- `user.backgrounded`
- `user.returned`
- `user.interacted`
- `device.locked`
- `device.unlocked`
- `surface.visible`
- `surface.hidden`

#### Reliability

- `integration.connected`
- `integration.degraded`
- `integration.disconnected`
- `queue.backpressure`
- `event.rejected`

### 8.4 Metadata allowlist

Allowed examples:

- normalized tool family: `shell`, `editor`, `file`, `search`, `test`, `network`, `mcp`, `other`;
- success/failure boolean;
- normalized failure category;
- file-count bucket, not file names;
- elapsed-duration bucket;
- number of tool calls;
- number of subagents;
- provider-reported permission mode category;
- exit-code category, not command;
- coarse operating system;
- client/provider versions;
- local classification category;
- count of changed files if available without reading names/content.

Forbidden examples:

- prompt;
- response;
- reasoning;
- command;
- command arguments;
- terminal output;
- tool input;
- tool output;
- file path;
- file name where identifying;
- source snippet;
- transcript path;
- repository remote URL;
- environment variables;
- API keys;
- complete CWD;
- user name;
- host name.

### 8.5 Provider identifiers

Provider session/turn/task IDs should be HMACed locally with an installation-scoped secret before upload.

Raw IDs should not leave the device because they may correlate with local transcripts or provider accounts.

### 8.6 Database additions

Recommended additive Prisma models:

```prisma
model AgentSession {
  id                  String   @id @default(uuid())
  userId              String
  deviceId            String
  provider            AgentProvider
  integrationMode     AgentIntegrationMode
  providerSessionHash String?
  workspaceHash       String?
  status              AgentSessionStatus
  adapterVersion      String
  providerVersion     String?
  startedAt           DateTime @db.Timestamptz
  endedAt             DateTime? @db.Timestamptz
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  workUnits            AgentWorkUnit[]
  events               AgentLifecycleEvent[]
  attentionWindows     AttentionWindow[]
  adOpportunities      AdOpportunity[]

  @@unique([userId, deviceId, provider, providerSessionHash])
  @@index([userId, startedAt])
  @@index([deviceId, status])
}

model AgentWorkUnit {
  id                   String   @id @default(uuid())
  sessionId            String
  parentWorkUnitId     String?
  kind                 AgentWorkUnitKind
  providerWorkUnitHash String?
  status               AgentWorkUnitStatus
  startedAt            DateTime @db.Timestamptz
  endedAt              DateTime? @db.Timestamptz
  toolCallCount        Int @default(0)
  subagentCount        Int @default(0)
  outcomeCategory      String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

model AgentLifecycleEvent {
  id              String   @id @default(uuid())
  sessionId       String
  workUnitId      String?
  eventId         String   @unique
  idempotencyKey  String   @unique
  schemaVersion   Int
  eventType       AgentEventType
  sourceType      AgentEventSourceType
  confidence      Float
  occurredAt      DateTime @db.Timestamptz
  receivedAt      DateTime @default(now()) @db.Timestamptz
  sequence        Int?
  correlationId   String
  causationId     String?
  metadata        Json
  adapterVersion  String
  clientVersion   String
  signature       String
}

model AttentionWindow {
  id               String   @id @default(uuid())
  userId           String
  deviceId         String
  sessionId        String?
  state            AttentionState
  source           AttentionSource
  confidence       Float
  startedAt        DateTime @db.Timestamptz
  endedAt          DateTime? @db.Timestamptz
  visibleSurface   Float?
  createdAt        DateTime @default(now())
}

model AdOpportunity {
  id                  String   @id @default(uuid())
  userId              String
  deviceId            String
  sessionId           String?
  workUnitId          String?
  triggerEventId      String?
  placementType       AdPlacementType
  state               AdOpportunityState
  attentionConfidence Float
  integrationConfidence Float
  eligibleAt          DateTime @db.Timestamptz
  expiresAt           DateTime @db.Timestamptz
  rejectionReason     String?
  idempotencyKey      String @unique
  createdAt           DateTime @default(now())
}
```

Exact names may change during implementation, but the separation must remain.

### 8.7 Why not replace `WaitStateEvent` immediately

The current money and ad tests depend on the existing path.

Use an additive migration:

1. new clients can emit canonical agent events;
2. old clients continue using wait start/end;
3. a compatibility projector may derive non-billable summaries from canonical events;
4. sandbox opportunities use the new model;
5. no production ledger behavior changes in the first protocol release;
6. remove or retire legacy behavior only after Release 1.0 evidence.

---

## 9. Local integration bridge

### 9.1 Recommended first implementation

Do not send provider hook payloads directly to the WaitLayer API.

Add CLI commands:

```bash
waitlayer integrations install claude-code
waitlayer integrations install codex
waitlayer integrations status
waitlayer integrations repair
waitlayer integrations uninstall claude-code
waitlayer hooks ingest --provider claude-code --event SessionStart
waitlayer bridge start
waitlayer bridge status
waitlayer bridge flush
```

### 9.2 Hot path

A provider command hook should:

1. invoke `waitlayer hooks ingest`;
2. read JSON from stdin;
3. identify provider/event;
4. sanitize using an allowlist;
5. normalize to canonical event;
6. write to a local queue or local bridge socket;
7. exit success quickly;
8. never call a remote API synchronously;
9. never return a provider permission decision.

### 9.3 Local IPC

Preferred:

- Unix domain socket on Linux/macOS;
- named pipe on Windows;
- installation secret for local client authentication;
- strict file/socket permissions;
- maximum payload size;
- short local timeout;
- fallback to append-only spool when the bridge is not running.

### 9.4 Queue

Start with SQLite if operationally acceptable; otherwise use an append-only JSONL spool plus an index/ack file.

Requirements:

- atomic append;
- one writer lock;
- bounded storage;
- acknowledged batches;
- retry with jitter;
- no duplicate upload;
- event TTL;
- quarantine malformed events;
- health and backlog metrics;
- local deletion command;
- logout/account-deletion cleanup;
- no raw hook payload persisted.

### 9.5 Batch endpoint

Add:

```text
POST /api/v1/agent-events/batch
```

Request constraints:

- authenticated user;
- registered device;
- maximum 100 events;
- compressed request size limit;
- monotonically bounded timestamps;
- schema/version allowlist;
- idempotency per event;
- device signature over canonical payload;
- forbidden-key recursive scan;
- per-device and per-user rate limits;
- partial success with per-event acknowledgements;
- server receipt timestamp;
- no financial side effects.

### 9.6 Native integration behavior

#### Claude Code

Use command hooks initially because they allow local sanitization before networking.

Useful lifecycle events include:

- `SessionStart`;
- `UserPromptSubmit`;
- `PreToolUse`;
- `PermissionRequest`;
- `PostToolUse`;
- `PostToolUseFailure`;
- `PostToolBatch`;
- `SubagentStart`;
- `SubagentStop`;
- `TaskCreated`;
- `TaskCompleted`;
- `Stop`;
- `StopFailure`;
- `SessionEnd`.

Do not read `transcript_path`. Discard raw `tool_input`, prompt content, and final assistant message.

#### Codex

Use current lifecycle command hooks.

Useful events include:

- `SessionStart`;
- `UserPromptSubmit`;
- `PreToolUse`;
- `PermissionRequest`;
- `PostToolUse`;
- `SubagentStart`;
- `SubagentStop`;
- `Stop`;
- `SessionEnd`;
- compaction events only if useful for reliability analytics.

Codex requires hook trust for non-managed hooks. The installer must explain this and surface “installed but not trusted” separately from “active.”

#### Generic wrapper

Retain `waitlayer run -- ...`.

Enhance it to emit:

- process start;
- signal/cancel;
- exit;
- elapsed duration;
- normalized executable family;
- optional shell integration correlation.

It remains lower-confidence than native lifecycle events.

### 9.7 Upgrade and repair

The integration manager must:

- back up modified hook files;
- merge rather than overwrite;
- use a stable WaitLayer-owned marker/id;
- detect manual edits;
- show diff before install where feasible;
- re-run trust/setup instructions;
- uninstall only WaitLayer-owned entries;
- support provider minimum versions;
- report degraded capability rather than silently guessing.

---

## 10. VS Code strategy

### 10.1 Role of the extension

After native integrations exist, the VS Code extension should primarily provide:

- user consent;
- installation/session correlation;
- foreground/background and window state;
- visible WaitLayer surfaces;
- task and shell corroboration;
- completion/permission notifications;
- sandbox ad presentation;
- productivity analytics;
- false-positive feedback;
- integration health;
- quiet mode and category controls.

It should not claim that inactivity proves AI processing.

### 10.2 Use stable VS Code APIs

Use:

- `window.onDidChangeWindowState`;
- active editor/window changes;
- task start/end;
- stable terminal shell-execution events where shell integration is available;
- panel/webview visibility;
- extension lifecycle and workspace state.

Shell integration has limitations in SSH, subshell, and complex environments. Treat missing shell integration as degraded capability, not failure.

### 10.3 Attention state machine

Suggested states:

```text
unknown
foreground_visible
foreground_not_visible
background
device_locked
disconnected
```

Transitions are driven by observed events and timeouts.

A return is emitted when:

- user moves from background/locked to foreground;
- a relevant task completed or input became required while absent; and
- the completion/input surface becomes visible.

### 10.4 One attention owner

For each installation:

- only one surface may own `foreground_visible` attention at a time;
- multiple agent sessions can be associated with the same window;
- an opportunity chooses one eligible session/work unit;
- running multiple agents cannot multiply attention;
- multi-device attention is recorded separately but treated conservatively for future financial logic.

### 10.5 Heuristic fallback

Keep editor inactivity only for:

- local detector experiments;
- false-positive research;
- non-billable analytics labeled low-confidence.

It must not:

- request a sandbox placement by itself;
- produce “verified wait” wording;
- become future financial evidence.

### 10.6 Terminal ads

Never inject advertising into a coding agent’s stdout stream.

For terminal users, use one of:

- a WaitLayer sidecar/TUI pane;
- desktop notification leading to a WaitLayer summary;
- completion summary printed only after the agent exits and clearly separated;
- web dashboard;
- VS Code panel when terminal is integrated.

---

## 11. Advertising opportunity model

### 11.1 Placement types

#### Foreground wait

User is present and a WaitLayer surface is visible while an agent is processing.

First external candidate.

#### Completion return

Agent completed while user was absent; the user returned and opened the result/summary.

First external candidate.

#### Input required

Agent requires user permission or clarification.

High attention, but defer external use because the advertisement must never resemble, delay, or obstruct the required control.

#### Background sponsor

Associate one sponsor with a legitimate long-running task.

Do not bill continuously while the user is absent. A billable impression occurs only when a visible sponsor surface is later rendered.

#### Failure/recovery

Potentially relevant but psychologically sensitive. Do not implement beyond sandbox research until policies prevent exploitative or misleading recommendations.

#### Dashboard native

Conventional placement inside WaitLayer analytics.

Lower technical risk and useful as a control group.

### 11.2 Opportunity lifecycle

```text
candidate
→ eligible
→ reserved
→ rendered
→ qualified
→ billed/test-billed
```

Alternative terminal states:

```text
expired
rejected
invalidated
dismissed
reported
```

### 11.3 Opportunity generation rules

Examples:

- `foreground_wait` after minimum processing duration and visible foreground state;
- `completion_return` once per completed work unit after observed return;
- `input_required` once per unresolved input event;
- `background_sponsor` once per work unit, but not qualified until visible;
- no opportunity from heuristic inactivity alone;
- no opportunity after task cancellation unless a separate safe placement applies;
- no opportunity if quiet mode, consent, frequency, category, country, tool, version, or account controls fail.

### 11.4 Campaign schema

Add an explicit placement relation, for example:

```prisma
model CampaignPlacement {
  id                 String @id @default(uuid())
  campaignId         String
  placementType      AdPlacementType
  bidType            BidType
  bidAmountMinor     BigInt
  minAttentionScore  Float?
  minIntegrationScore Float?
  frequencyCapPerHour Int?
  frequencyCapPerDay  Int?
  isActive           Boolean @default(true)

  @@unique([campaignId, placementType])
}
```

Do not hardcode price multipliers into the event code.

Pricing should remain configuration/data:

- baseline bid;
- placement bid;
- verification tier;
- geography;
- frequency;
- performance;
- advertiser constraints.

### 11.5 Contextual targeting

Initial context must remain coarse and privacy-preserving:

- provider;
- IDE/terminal;
- broad task category;
- language category only if derived locally without uploading file names/content;
- country from explicit profile/locale consent;
- operating system;
- placement type.

Do not target from raw prompts, code, errors, file paths, or terminal output.

### 11.6 Sandbox campaign set

Create controlled house campaigns for:

- cloud/hosting;
- testing;
- observability;
- security;
- databases;
- developer education.

Use safe destinations under a sandbox domain or local fixtures. No external affiliate tracking in Release 0.x.

---

## 12. Complete sandbox design

### 12.1 Environment

Recommended hostnames:

```text
sandbox.waitlayer.<owned-domain>
api.sandbox.waitlayer.<owned-domain>
status.sandbox.waitlayer.<owned-domain>
```

Until a domain is secured, use internal endpoints and do not ship public clients with speculative production domains.

### 12.2 Isolation

Mandatory:

- separate Postgres database/cluster or isolated database with hard environment marker;
- separate Redis;
- separate JWT keys;
- separate device secrets;
- separate email driver;
- separate object storage prefix;
- separate Sentry environment;
- separate OAuth client;
- no production Stripe/PayPal/Wise credentials;
- no production webhook endpoints;
- no shared payout destination data.

### 12.3 Test value

Use `XTS` internally and display:

> Test credits — no cash value

Never display `$` alone for sandbox balances.

Every API balance response in sandbox should include:

```json
{
  "mode": "sandbox",
  "hasCashValue": false
}
```

### 12.4 Sandbox deposit provider

Create an explicit provider:

```text
sandbox_faucet
```

Capabilities:

- create fixed test deposits;
- approve/deny;
- duplicate callback;
- delayed callback;
- partial refund;
- chargeback/dispute;
- currency mismatch;
- amount mismatch;
- timeout;
- idempotent replay.

It must be impossible to instantiate when `NODE_ENV=production` or `WAITLAYER_ENVIRONMENT_KIND=production`.

### 12.5 Sandbox payout provider

Create:

```text
sandbox
```

Capabilities:

- immediate paid;
- delayed processing;
- failed;
- ambiguous initiation;
- callback-before-response;
- duplicate callback;
- timeout;
- reversal;
- reconciliation escalation.

No bank/email/card information is needed. Destination is a generated test alias.

### 12.6 Personas

#### Developer personas

- new user;
- normal developer;
- distracted developer;
- power user;
- accessibility-focused user;
- privacy-conscious user.

#### Business personas

- advertiser;
- campaign reviewer;
- payout reviewer;
- support/operator.

#### Adversarial personas

- long-task gamer;
- parallel-session gamer;
- replay attacker;
- fake foreground attacker;
- click automation attacker;
- multi-account/referral attacker;
- tampered-client attacker.

#### Independent persona

- deterministic auditor.

The auditor must not rely on the user agent’s own report.

### 12.7 Real coding tasks

Fixture repositories should include tasks such as:

- fix a deterministic failing test;
- add input validation;
- refactor a small module;
- add a route;
- diagnose a TypeScript error;
- run a migration;
- write documentation;
- intentionally fail due to missing configuration;
- require permission;
- launch a subagent;
- complete in background;
- run two tasks concurrently.

Repositories must contain no production secrets or proprietary code.

### 12.8 Sandbox journeys

#### Developer

```text
signup
→ consent
→ install CLI/extension
→ install integrations
→ run coding task
→ foreground/background transitions
→ return/input/completion
→ see test placement
→ inspect productivity analytics
→ receive test credits
→ request test payout
```

#### Advertiser

```text
signup
→ create advertiser
→ receive test deposit
→ create campaign
→ choose placement and broad context
→ upload safe creative
→ submit
→ inspect results
→ pause
→ request test refund
```

#### Operator

```text
review campaign
→ approve/reject
→ inspect event timeline
→ inspect fraud flags
→ hold/release test credits
→ review payout
→ use kill switches
→ reconcile ledgers
```

### 12.9 Reset and reproducibility

Each run receives:

- `testRunId`;
- seed;
- build SHA;
- client versions;
- scenario version;
- environment ID;
- isolated tenant or schema;
- start/end timestamps.

A failed run must be reproducible from these values.

---

## 13. Autonomous agent beta harness

### 13.1 Test layers

#### Layer A — Unit and contract

Fast, deterministic, no live model required.

#### Layer B — Recorded provider fixtures

Replay official-shaped Claude/Codex hook payloads through sanitizers and normalizers.

#### Layer C — Local integration

Install hooks into isolated fake user homes and invoke providers or simulators.

#### Layer D — Real terminal agent runs

Controlled live credentials and budgets; actual coding tasks.

#### Layer E — VS Code/Electron

Install VSIX into isolated user data, run fixture workspace, automate extension and browser surfaces.

#### Layer F — Exploratory computer-use agent

Use the product as an unfamiliar user in a disposable VM.

### 13.2 Scenario manifest

Example:

```yaml
id: terminal-claude-background-completion
version: 1
persona: distracted_developer
environment: sandbox
workspace_fixture: ts-validation-bug
provider: claude_code
integration: native_hook
actions:
  - signup
  - enable_wait_telemetry
  - install_integration
  - start_task: fix_validation
  - background_after_seconds: 10
  - return_on_completion
  - open_waitlayer_summary
expected:
  sessions: 1
  work_units_min: 1
  completion_events: 1
  return_events: 1
  opportunities:
    foreground_wait: 0
    completion_return: 1
  qualified_impressions: 1
  duplicate_events: 0
  ledger:
    balanced: true
forbidden:
  - raw_prompt_stored
  - source_code_stored
  - continuous_background_billing
```

### 13.3 Agent feedback format

```json
{
  "runId": "...",
  "buildSha": "...",
  "persona": "new_user",
  "journeyCompleted": true,
  "confusingSteps": [],
  "unexpectedBehavior": [],
  "privacyConcern": null,
  "adObstruction": false,
  "severity": "none",
  "reproductionConfidence": 0.94,
  "evidenceArtifacts": []
}
```

### 13.4 Artifacts

Collect:

- canonical event timeline;
- API request IDs;
- screenshots/video where permitted;
- console/output logs with redaction;
- database invariant report;
- campaign/ledger snapshot;
- queue health;
- integration status;
- agent feedback;
- failure stack;
- environment manifest.

### 13.5 Issue creation

Automatic issue creation is allowed only for:

- deterministic assertion failure;
- crash;
- ledger imbalance;
- privacy leak detector;
- unauthorized financial side effect;
- reproducible security failure.

Exploratory observations should enter a triage queue first.

### 13.6 Agent limitations

Autonomous agents cannot establish:

- real human retention;
- ad acceptance;
- perceived intrusiveness;
- privacy trust;
- willingness to install hooks;
- advertiser willingness to pay;
- comprehension by nontechnical users.

Do not convert agent-beta success directly into public-launch confidence.

---

## 14. Fraud and abuse strategy

### 14.1 Threat model

Assume the user controls:

- the client;
- local files;
- hook configuration;
- clocks;
- processes;
- provider invocation;
- network retries;
- multiple accounts;
- multiple agents;
- multiple VMs.

Therefore, local events are telemetry, not independent proof.

### 14.2 Background task abuse

Attack:

- request intentionally slow work;
- leave it running;
- claim duration.

Policy:

- record processing duration;
- no continuous background attention credit;
- at most one task sponsor association;
- a visible return/completion placement may qualify later;
- outcome incentives, if ever added, are fixed/tiered rather than per-minute.

### 14.3 Parallel agents

Attack:

- run many agents simultaneously.

Policy:

- record all work;
- one attention owner;
- one foreground opportunity at a time;
- completion opportunities rate-limited and deduplicated;
- risk score for unnatural volume;
- no multiplication by process count.

### 14.4 Replay

Controls:

- per-event UUID;
- idempotency key;
- sequence;
- provider-session binding;
- server nonce for future financial attempts;
- event TTL;
- unique constraints;
- duplicate metrics.

### 14.5 Fake lifecycle events

Controls:

- native-adapter capability and version;
- device signature;
- local integration health;
- cross-signal consistency;
- behavioral baselines;
- independent attestation for money;
- server authoritative source classification;
- no client-declared “observed” authority.

### 14.6 Fake presence

Do not accept mouse movement alone.

Use a combination of:

- focused window;
- visible surface;
- recent meaningful interaction;
- lock state;
- return behavior;
- provider state;
- timing consistency;
- optional future OS integrity signals.

### 14.7 Completion farming

Controls:

- work-unit uniqueness;
- minimum meaningful lifecycle;
- tool activity distribution;
- outcome category;
- repeated identical pattern detection;
- fixed opportunity cap;
- no reward for repeated reopening;
- no source-code inspection required for the first risk layer.

### 14.8 Multi-account and device farms

Existing device/payout/fraud controls are useful, but Release 0.x should also test:

- cloned installation IDs;
- VM snapshots;
- shared payout aliases;
- referral loops;
- IP/device changes;
- account creation bursts.

---

## 15. Privacy and security design

### 15.1 Data classification

Classify every field before implementation:

- public;
- account data;
- pseudonymous telemetry;
- financial;
- authentication secret;
- local-only sensitive;
- prohibited.

No new field enters the protocol without a classification and retention period.

### 15.2 Local-first sanitization

Provider raw payload exists only in process memory long enough to normalize it.

Rules:

- whitelist accepted keys;
- discard unknown keys;
- enforce size/depth limits;
- remove control characters;
- never log raw payload;
- redact errors;
- hash identifiers locally;
- test with planted secrets.

### 15.3 Hook security

Provider hooks run with user permissions.

Controls:

- absolute path to signed/verified WaitLayer executable;
- no shell interpolation of event data;
- JSON via stdin;
- no dynamic command construction;
- safe file permissions;
- updater provenance;
- display exact installed hook;
- user consent;
- easy disable/uninstall.

### 15.4 API security

- device authentication;
- canonical signing;
- batch size/rate limits;
- timestamp window;
- schema allowlist;
- event-type allowlist;
- metadata allowlist;
- recursive forbidden-field detection;
- decompression-bomb limit;
- request and event idempotency;
- audit rejected events without storing forbidden content.

### 15.5 Workspace hashing

Use a rotating or installation-scoped HMAC of a normalized workspace identifier.

Do not send:

- raw path;
- remote URL;
- repository name.

Allow users to reset or disable workspace linkage.

### 15.6 Retention

Suggested Release 0.x defaults:

- raw canonical lifecycle events: 30 days;
- derived aggregate analytics: 180 days;
- agent-beta run artifacts: 30 days unless retained for a defect;
- security/audit records: per existing operational policy;
- financial sandbox ledger: retained for test evidence, then reset by run policy;
- local queue: uploaded events deleted after acknowledgement; unuploaded events expire.

Final periods require legal review before human beta.

### 15.7 User controls

Users must be able to:

- enable/disable telemetry;
- see installed integrations;
- see what data categories are collected;
- disable a provider;
- pause all collection;
- clear local queue;
- export data;
- delete account;
- block ad categories;
- set quiet mode;
- report false detection;
- uninstall hooks cleanly.

---

## 16. Product UX requirements

### 16.1 Onboarding

Recommended steps:

1. explain WaitLayer’s purpose;
2. state clearly that Release 0.x uses test credits;
3. request account consent;
4. install CLI/VSIX;
5. detect supported providers;
6. show exactly what hooks collect and do not collect;
7. install selected integrations;
8. verify hook trust/health;
9. run a sample task;
10. show the resulting timeline and analytics.

### 16.2 Integration status

Display:

| State | Meaning |
|---|---|
| Native | lifecycle hooks active |
| Wrapper | process lifecycle only |
| Observed | VS Code/OS corroboration |
| Shadow | heuristic local-only |
| Degraded | integration installed but events missing |
| Disabled | user/operator disabled |
| Attested | reserved for future independent proof |

Do not label a native hook as “verified” in the financial sense.

### 16.3 Sandbox language

Use:

- “Test credits”
- “Simulated payout”
- “Sandbox advertiser”
- “No cash value”
- “Research placement”
- “Agent telemetry”

Avoid:

- “cash earned”;
- “withdraw now”;
- “guaranteed earnings”;
- currency symbols without test labels.

### 16.4 Productivity dashboard

Show:

- total agent processing;
- foreground observation;
- background processing;
- completed work units;
- input-required events;
- return time;
- failed/cancelled tasks;
- provider/integration health;
- false-positive reports;
- test placement exposure;
- simulated split as an experiment, not income.

Do not claim “time saved” as a fact unless the metric is clearly defined. Prefer “delegated processing time” initially.

### 16.5 Advertisement ergonomics

- clearly labeled sponsored;
- never imitate agent controls;
- never delay permission;
- never cover error details;
- dismissible where appropriate;
- frequency capped;
- quiet mode;
- category blocking;
- report action;
- no dark patterns;
- no artificial waiting;
- no ads added solely because a task failed.

---

## 17. CI, release, and operations

### 17.1 New CI jobs

#### Protocol contract

- compile schemas;
- golden fixtures;
- compatibility;
- forbidden-field tests;
- fuzz/property tests.

#### Adapter tests

- Claude fixtures;
- Codex fixtures;
- wrapper lifecycle;
- hook-file merge/uninstall;
- trust/degraded state.

#### Sandbox boot

- start isolated stack;
- assert environment guards;
- seed test campaigns;
- run test-credit split;
- assert zero external calls.

#### Agent scenario smoke

On pull requests:

- recorded fixtures;
- simulated provider;
- one terminal scenario;
- one web advertiser/operator scenario.

Nightly/manual:

- live provider canaries;
- VS Code/Electron;
- autonomous exploratory runs;
- fault and endurance suite.

### 17.2 Default CI must not require paid model calls

Use recorded provider-shaped fixtures for ordinary commits.

Live agent runs should be:

- secret-gated;
- budget-capped;
- manually/nightly triggered;
- isolated;
- artifact-producing;
- non-blocking for unrelated documentation changes unless touching adapter/protocol code.

### 17.3 Release channels

- `dev`
- `sandbox`
- `alpha`
- `beta`
- `stable`

CLI, extension, API, protocol, and adapter versions must be visible in every report.

### 17.4 Runtime switches to add

Suggested:

- `agent_events.ingest`;
- `integrations.claude_code`;
- `integrations.codex_cli`;
- `integrations.wrapper`;
- `placements.foreground_wait`;
- `placements.completion_return`;
- `placements.input_required`;
- `placements.background_sponsor`;
- `sandbox.ads`;
- `sandbox.credits`;
- `sandbox.payouts`;
- `agent_beta.issue_creation`.

Existing production switches remain authoritative.

### 17.5 Observability

Add metrics:

- events received/rejected/deduplicated;
- event lag;
- queue backlog;
- adapter health;
- hook latency;
- session reconciliation;
- orphan events;
- out-of-order events;
- attention-window overlaps;
- opportunity counts by type/reason;
- sandbox ledger imbalance;
- scenario pass rate;
- privacy scanner failures;
- client version distribution.

### 17.6 Runbooks

Create runbooks for:

- disable one integration;
- disable one placement;
- revoke a bad client version;
- queue backlog;
- duplicate-event spike;
- privacy leak;
- sandbox/production crossover attempt;
- ledger imbalance;
- corrupted hook config;
- provider lifecycle change;
- extension rollback;
- autonomous-agent runaway cost.

---

## 18. Implementation work breakdown

Effort labels are relative, not delivery promises:

- **S:** narrow change;
- **M:** multi-file change;
- **L:** architectural change;
- **XL:** release-level work.

### Epic A — Baseline and governance

#### WL-001 — Baseline verification (M)

- run all gates;
- record exact SHA;
- diagnose Vercel;
- upload report.

#### WL-002 — Branch protection (S, operator)

- require CI checks;
- no force push/delete;
- CODEOWNERS approval;
- stale review dismissal.

#### WL-003 — Issue/PR templates (S)

- implementation issue;
- risk issue;
- agent-beta defect;
- migration checklist.

#### WL-004 — Release evidence manifest (M)

Generate JSON containing:

- SHA;
- migrations;
- package versions;
- Docker digests;
- test results;
- environment kind;
- protocol version.

### Epic B — Environment isolation

#### WL-010 — `WAITLAYER_ENVIRONMENT_KIND` (M)

Add config validation and expose read-only health metadata.

#### WL-011 — Sandbox startup guards (M)

Reject forbidden combinations.

#### WL-012 — XTS currency policy (S/M)

Sandbox-only formatting and thresholds.

#### WL-013 — Sandbox visual banner (M)

Web, VS Code, CLI.

#### WL-014 — Sandbox database marker (M)

Store environment marker and assert on startup.

### Epic C — Protocol

#### WL-020 — `@waitlayer/agent-protocol` (L)

Schemas, enums, sanitizer, versions.

#### WL-021 — Canonical forbidden-field scanner (M)

Recursive key/value/entropy tests.

#### WL-022 — Golden fixtures (M)

Claude, Codex, wrapper, VS Code.

#### WL-023 — Protocol compatibility gate (M)

Old/new schema behavior.

### Epic D — Persistence and API

#### WL-030 — Additive Prisma models (L)

AgentSession, AgentWorkUnit, AgentLifecycleEvent, AttentionWindow, AdOpportunity.

#### WL-031 — Batch ingestion endpoint (L)

Validation, signature, idempotency, partial ack.

#### WL-032 — Session projector (L)

Canonical events to session/work-unit state.

#### WL-033 — Orphan/reconciliation cron (M)

Close or flag abandoned sessions conservatively.

#### WL-034 — Analytics queries (M)

Aggregates without monetary claims.

### Epic E — Local bridge and integrations

#### WL-040 — Random installation identity migration (M/L)

Replace host-derived fingerprint for new clients.

#### WL-041 — Local spool/bridge (L)

IPC, queue, upload, health.

#### WL-042 — Hook ingestion command (M)

Fast local sanitizer path.

#### WL-043 — Hook configuration merger (L)

Backup, merge, uninstall.

#### WL-044 — Claude Code adapter (L)

Normalize supported lifecycle events.

#### WL-045 — Codex adapter (L)

Normalize supported lifecycle events and trust status.

#### WL-046 — Wrapper compatibility adapter (M)

Map existing process start/end into canonical events.

#### WL-047 — Integration status UI/CLI (M)

Native/wrapper/degraded/disabled.

### Epic F — VS Code

#### WL-050 — Bridge client (M)

Receive correlated sessions.

#### WL-051 — Attention state machine (L)

Focus, visibility, lock/disconnect handling.

#### WL-052 — Deduplicate native + VS Code signals (L)

Source precedence.

#### WL-053 — Replace heuristic-primary flow (L)

Native-first; shadow fallback.

#### WL-054 — Completion summary surface (M)

No stdout corruption.

#### WL-055 — Mode-aware terminology (M)

Test credits and sandbox.

### Epic G — Opportunities and advertising

#### WL-060 — Placement enums and campaign relation (L)

Additive migration.

#### WL-061 — Opportunity generator (L)

Rules, expiry, dedup.

#### WL-062 — Foreground-wait sandbox placement (M/L)

First placement.

#### WL-063 — Completion-return sandbox placement (M/L)

Second placement.

#### WL-064 — Sandbox house campaigns (M)

Safe seeds.

#### WL-065 — Placement analytics (M)

Counts and performance.

### Epic H — Sandbox economy

#### WL-070 — Sandbox deposit faucet (M)

XTS deposits.

#### WL-071 — Sandbox payout provider (M/L)

Deterministic states.

#### WL-072 — Sandbox financial guard (M)

No external calls/production config.

#### WL-073 — Reconciliation report (M)

Exact invariant.

#### WL-074 — Reset/seed tooling (M)

Per-run isolation.

### Epic I — Agent beta

#### WL-080 — Scenario schema and runner (L)

Actions, expected, forbidden.

#### WL-081 — Terminal deterministic runner (L)

Actual subprocesses.

#### WL-082 — Web advertiser/operator runner (M/L)

Playwright.

#### WL-083 — VS Code/Electron runner (XL)

Isolated VSIX install and workflows.

#### WL-084 — Auditor (L)

Independent invariants.

#### WL-085 — Fraud scenarios (L)

Replay/concurrency/fake attention.

#### WL-086 — Fault injection (L)

Network/Redis/DB/provider failures.

#### WL-087 — Feedback and report generator (M)

Machine-readable + Markdown.

#### WL-088 — Issue dedup/triage (M)

No issue spam.

### Epic J — External beta readiness

#### WL-090 — Legal/copy consistency (M)

Entity, contacts, terms, payout policy.

#### WL-091 — Domain and official mailboxes (operator)

#### WL-092 — Extension license/publisher/signing (operator + code)

#### WL-093 — Retention and consent version update (M + legal)

#### WL-094 — Human-alpha research plan (M)

#### WL-095 — Public kill-switch rehearsal (M)

---

## 19. Recommended first implementation batch

Do not give a coding agent the entire document as one change request.

The first batch should contain only:

1. **WL-001:** reproduce full baseline;
2. **WL-003:** issue/PR templates;
3. **WL-010:** environment-kind config;
4. **WL-011:** sandbox startup guards;
5. **WL-020:** protocol package skeleton;
6. **WL-021:** sanitizer/forbidden-field tests;
7. **WL-022:** provider fixture format;
8. **WL-030:** additive schema draft and migration review;
9. **WL-031:** non-financial batch ingestion skeleton;
10. **WL-004:** release evidence manifest.

This batch establishes the rails without prematurely building UI, ads, or financial simulation.

### Batch acceptance

- no existing production-money behavior changes;
- current clients still work;
- new event endpoint cannot create ads or ledger entries;
- sandbox/production config incompatibilities fail startup;
- fixture payloads prove privacy sanitization;
- all existing gates remain green;
- new tests are added;
- migration is additive and reversible.

---

## 20. Release exit metrics

### 20.1 Detection and lifecycle

For deterministic scenarios:

- expected session boundary accuracy: 100%;
- duplicate canonical event rate: 0;
- missing required completion/input events: 0;
- raw forbidden-data leak: 0;
- orphan session after recovery window: 0 unless explicitly expected;
- cross-provider normalization contract: 100%.

For exploratory/live agent runs, collect distributions before setting hard public thresholds.

### 20.2 Attention

- multiple simultaneous foreground owners per installation: 0;
- completion opportunity before observed return: 0;
- heuristic-only billable/test-billable opportunity: 0;
- background duration converted to continuous attention: 0.

### 20.3 Advertising

- placement shown outside consent/policy: 0;
- repeated completion placement for same work unit: 0;
- ad obstruction of permission control: 0;
- sandbox placement mistaken by system as production: 0.

### 20.4 Financial sandbox

- ledger imbalance: exactly 0;
- duplicate credit from replay: 0;
- external provider calls: 0;
- non-XTS sandbox transaction: 0 unless an explicitly isolated provider test says otherwise;
- payout without matching allocation: 0;
- ambiguous provider initiation auto-released without reconciliation: 0.

### 20.5 Reliability

- local hook blocks agent because WaitLayer is offline: 0;
- acknowledged event lost after restart: 0;
- unbounded queue growth: 0;
- poisoned event blocks queue: 0;
- kill-switch propagation outside documented bound: 0.

### 20.6 UX

Before human alpha:

- new-user agent completes onboarding from product instructions;
- all sandbox money surfaces state no cash value;
- integration health is understandable;
- uninstall returns provider config to prior state;
- false-positive report is available;
- telemetry can be disabled immediately.

---

## 21. Risk register

| Risk | Likelihood | Impact | Mitigation | Detection | Release gate |
|---|---:|---:|---|---|---|
| provider hook API changes | medium | high | version adapters, golden fixtures, capability matrix | canary failures | 0.3+ |
| raw prompt/code leakage | medium | critical | local allowlist sanitizer, forbidden scanner | planted-secret tests | every release |
| hook blocks agent | medium | high | local-only hot path, timeout, non-blocking output | latency/error metrics | 0.3 |
| duplicate VS Code/terminal session | high | high | local correlation and source precedence | duplicate scenario | 0.4 |
| fake events | high | critical for money | non-financial telemetry, attestation later | fraud scenarios | paid launch |
| sandbox/production crossover | low | critical | separate infra, markers, startup guards | startup tests | 0.5 |
| misleading earnings language | medium | high | mode-aware copy and XTS | screenshot/text scan | 0.5 |
| agent beta overstates human readiness | high | high | mandatory human alpha | governance review | 0.9 |
| background work monetized as attention | medium | critical | separate processing/attention/opportunity models | invariant test | 0.5 |
| multi-agent reward multiplication | high | critical | one attention owner, opportunity dedup | fraud scenarios | 0.7 |
| local queue privacy exposure | medium | high | sanitized-only queue, permissions, TTL | local inspection test | 0.3 |
| autonomous test issue spam | high | medium | deterministic auto-create only, triage queue | duplicate rate | 0.8 |
| live-agent test cost runaway | medium | medium/high | budgets, timeouts, isolated triggers | spend alerts | 0.8 |
| Vercel/deployment drift | current | medium | choose authoritative host and gate | deployment smoke | 0.1 |
| legal entity/contact inaccuracy | current | high externally | correct before external users | legal checklist | 0.9 |
| extension marketplace rejection | unknown | high | policy review, signing, beta channel | package review | 0.9 |
| device fingerprint privacy | current | medium/high | random installation ID migration | payload audit | 0.3 |
| ad manipulates failure/permission | medium | high | defer, strict UX policy | human review | later |
| provider outage | medium | medium | degraded mode, wrapper fallback | health status | 0.3 |
| missing shell integration | high in some environments | low/medium | capability downgrade | client telemetry | 0.4 |

---

## 22. Deferred decision register

These decisions are intentionally deferred because they do not block the first implementation batch.

### Before invited human alpha

- owned domain;
- legal entity wording;
- public support/security/privacy mailboxes;
- extension license and publisher;
- consent-policy text;
- age policy;
- retention periods;
- analytics vendor or no-vendor decision.

### Before advertiser sandbox with external advertisers

- advertiser recruitment terms;
- creative moderation policy;
- test budget limits;
- initial placement set;
- advertiser performance metrics.

### Before restricted real-money pilot

- entity/bank/tax setup;
- deposit provider;
- payout provider;
- countries/currencies;
- KYC/AML/sanctions process;
- independent attestation provider;
- final pricing;
- operational staffing;
- refund/chargeback policy;
- two-person financial controls.

The architecture must expose configuration points for these choices without hardcoding an answer now.

---

## 23. Source inconsistencies to fix

### 23.1 Payout hold

- Terms state a 30-day new-account hold.
- Payout policy states “3 days for new accounts, longer for higher trust.”
- Code/shared policy previously uses 30/14/7 behavior.

Fix the page before any external tester.

### 23.2 Legal entity

`docs/legal/gdpr-dpa.md` identifies `WaitLayer, Inc.`.

Do not publish this unless that legal entity exists.

### 23.3 Contact domain

- contact page uses `@waitlayer.com`;
- DPA uses `privacy@waitlayer.dev`;
- clients hardcode `api.waitlayer.com`.

Centralize these values and use verified owned domains.

### 23.4 Support promise

The contact page promises a typical two-business-day response.

Remove or qualify this unless an operational process exists.

### 23.5 Beta wording

Some surfaces emphasize payouts, earnings, campaigns, and trust scores even though the current README and runtime behavior correctly describe telemetry-only beta.

Make product mode the source of user-facing terminology.

### 23.6 Documentation status claims

Files that claim all source gaps are closed should be scoped to the previous audit, not interpreted as closing the new product requirements in this document.

---

## 24. Recommended coding-agent operating rules

Any coding agent implementing this plan must follow these constraints.

1. Read current source before modifying it.
2. Do not trust a prose status claim over code or tests.
3. Do not enable existing real-money runtime switches.
4. Do not use the reference/stub attester as production proof.
5. Do not send raw provider hook payloads to the API.
6. Do not parse prompts, responses, source code, or terminal output for Release 0.x.
7. Do not inject ads into agent stdout.
8. Do not replace existing hooks/config files wholesale.
9. Do not perform destructive database resets without an isolated test URL and explicit permission.
10. Use additive migrations.
11. Preserve idempotency and append-only accounting.
12. Add tests before claiming a gap is closed.
13. Run targeted tests after each change and full gates before the PR is complete.
14. Record every assumption in the issue/PR.
15. Stop and fail closed if environment identity is ambiguous.
16. Never make sandbox value look withdrawable.
17. Keep each PR independently reviewable.
18. Include rollback notes for config, schema, hooks, and client changes.
19. Include privacy data-flow changes in the PR description.
20. Include exact acceptance evidence.

---

## 25. Definition of done for Release 0.8

Release 0.8 is complete only when all of the following are true.

### Architecture

- provider-neutral event protocol exists;
- Claude Code and Codex native adapters exist;
- wrapper fallback remains available;
- VS Code correlates rather than duplicates;
- processing and attention are separate;
- placement opportunities are separate from financial authorization.

### Privacy

- no raw prompt/response/code/output storage;
- local sanitizer and server scanner pass planted-secret tests;
- installation identity no longer derives from personal host strings for new installs;
- consent, export, deletion, and integration controls cover new data.

### Sandbox

- isolated environment;
- XTS/test credits;
- fake deposits/payouts;
- house ads;
- persistent sandbox labeling;
- production configuration guards;
- exact reconciliation.

### Testing

- deterministic terminal and VS Code scenarios;
- advertiser/operator flows;
- fraud and reliability scenarios;
- independent auditor;
- reproducible artifacts;
- autonomous exploratory agents;
- no unresolved critical defect.

### Operations

- protected main;
- exact-SHA CI green;
- release evidence;
- integration/placement kill switches;
- runbooks;
- cost and failure alerts;
- reset and rollback tested.

### Product honesty

- background work counted as work, not automatic attention;
- no claim of real earnings;
- no claim of independent verification from local hooks;
- no ad obstructs agent controls;
- no unsupported legal or support promise is exposed.

---

## 26. Final recommendation

Start building now, but begin with the event and environment foundations—not with new advertisement screens or payment integrations.

The current repository’s most valuable assets are its fail-closed money path, accounting, security hardening, consent model, and operational gates. The implementation must preserve those.

The highest-leverage architecture is:

```text
Provider-native hooks / wrapper
             ↓
Local allowlist sanitizer
             ↓
Durable local bridge and queue
             ↓
Provider-neutral lifecycle events
             ↓
Agent sessions and work units
             ↓
VS Code attention correlation
             ↓
Ad opportunities
             ↓
Isolated sandbox auction and XTS ledger
             ↓
Deterministic + autonomous agent beta
             ↓
Human alpha
             ↓
Public telemetry beta
             ↓
Independent attestation and restricted money
```

This architecture supports the broader vision without forcing premature decisions about countries, payment providers, final pricing, or the independent attester.

It also closes the most dangerous conceptual gap:

> WaitLayer can respect autonomous background work while refusing to misrepresent unattended processing as continuous human attention.

The next action should be to open the Release 0.1 and Release 0.2 issues and execute the first implementation batch in Section 19.

---


## 27. Final refinement review

The strategy was reviewed against six failure perspectives before being finalized.

### 27.1 Product-coherence review

Question:

> Does the design preserve the value of autonomous background coding without pretending the user watches the screen continuously?

Result:

- agent processing is first-class;
- background work remains visible in analytics;
- attention is modeled separately;
- completion and return are explicit;
- background sponsorship does not bill by unattended duration.

### 27.2 Financial-safety review

Question:

> Could the team accidentally enable or weaken the production money path to make the sandbox work?

Initial risk:

The current ad-serving path correctly suppresses advertising unless real earnings and attestation requirements are met.

Refinement:

- create a separate sandbox opportunity/auction mode;
- use isolated infrastructure and XTS;
- keep existing `wait.earnings` behavior unchanged;
- reject sandbox provider/faucet configuration in production;
- require exact test-ledger reconciliation.

### 27.3 Privacy review

Question:

> Do native hooks create more privacy risk than the existing wrapper?

Initial risk:

Provider hook payloads can contain prompts, tool inputs, commands, paths, transcript references, and generated text.

Refinement:

- command hook to local sanitizer;
- allowlist fields;
- no network in hook hot path;
- no raw-payload persistence;
- local identifier hashing;
- server-side second-line scanner;
- planted-secret and source-code leak tests.

### 27.4 Technical-expandability review

Question:

> Will supporting Claude Code and Codex produce two separate products?

Refinement:

- provider-neutral protocol;
- adapters at the edge;
- canonical events and capabilities;
- additive database model;
- wrapper fallback;
- stable source precedence;
- compatibility/version policy.

### 27.5 Psychological and UX review

Question:

> Could users feel watched, manipulated, or deceived?

Refinement:

- explicit integration consent;
- exact collection disclosure;
- no general process surveillance as primary behavior;
- no prompt/code collection;
- no ad inside agent controls;
- no failure exploitation;
- sandbox badges and “no cash value” language;
- quiet mode, category controls, reports, and uninstall.

### 27.6 Delivery review

Question:

> Is the plan too large for an implementation agent to execute reliably?

Initial risk:

A single “build the full sandbox” prompt would likely create a broad, inconsistent patch.

Refinement:

- first batch limited to baseline, environment identity, protocol, privacy, additive schema, and non-financial ingestion;
- epics and independent issues;
- release evidence;
- targeted then full gates;
- agent-beta work begins only after deterministic rails exist.

### 27.7 Conclusion of refinement

The strategy is ready to implement at Release 0.1/0.2 scope.

Later releases are intentionally conditional. Their architecture is defined, but their commercial and legal activation decisions remain deferred until evidence makes those decisions meaningful.

---

## Appendix A — Minimum deterministic scenario catalog

### Identity and consent

1. new signup, telemetry disabled;
2. telemetry enabled;
3. ads disabled;
4. consent revoked mid-session;
5. logout with queued events;
6. account deletion with installed hooks.

### Terminal/native

7. Claude normal completion;
8. Claude permission request;
9. Claude failed tool;
10. Claude subagent;
11. Claude background completion;
12. Codex normal completion;
13. Codex permission request;
14. Codex subagent;
15. provider hooks untrusted/disabled;
16. provider version unsupported;
17. wrapper fallback;
18. missing executable;
19. Ctrl-C;
20. process crash.

### VS Code

21. task in foreground;
22. background and return;
23. multiple VS Code windows;
24. terminal agent inside VS Code;
25. shell integration missing;
26. extension reload during task;
27. VS Code closes while agent continues;
28. inactivity without AI;
29. false-positive report;
30. quiet mode.

### Concurrency

31. two provider sessions;
32. provider plus wrapper duplicate;
33. parallel subagents;
34. task completes while another remains active;
35. same user on two devices.

### Advertising

36. foreground opportunity;
37. completion-return opportunity;
38. repeated return;
39. opportunity expiry;
40. category block;
41. country block;
42. frequency cap;
43. ad dismiss;
44. ad report;
45. consent revoked before render.

### Sandbox finance

46. test deposit;
47. test CPM split;
48. test CPC split;
49. duplicate impression;
50. duplicate click;
51. refund;
52. dispute;
53. earning hold;
54. hold release;
55. reversal;
56. payout success;
57. payout failure;
58. ambiguous payout;
59. duplicate payout request;
60. reconciliation escalation.

### Reliability

61. API offline;
62. Redis offline;
63. database timeout;
64. queue full;
65. malformed hook JSON;
66. out-of-order events;
67. clock skew;
68. duplicate upload;
69. client upgrade with queued old schema;
70. kill switch during active opportunity.

### Privacy

71. prompt contains API key;
72. command contains token;
73. path contains user name;
74. transcript contains source code;
75. large/deep payload;
76. prototype-pollution keys;
77. error logging path;
78. data export;
79. data deletion;
80. local queue deletion.

### Adversarial

81. fake long task;
82. ten concurrent agents;
83. replayed completion;
84. renamed fake process;
85. mouse-jiggling;
86. VM clone;
87. repeated completion screen;
88. automated clicks;
89. multi-account referral loop;
90. tampered hook event.

---

## Appendix B — Pull request checklist

- [ ] Issue and release objective linked
- [ ] Current source inspected
- [ ] Data classification updated
- [ ] No raw sensitive provider data added
- [ ] Environment guard considered
- [ ] Production money path unchanged or explicitly reviewed
- [ ] Additive migration
- [ ] Idempotency behavior tested
- [ ] Concurrency behavior tested
- [ ] Failure/retry behavior tested
- [ ] Consent behavior tested
- [ ] Kill switch tested
- [ ] Unit/contract tests pass
- [ ] Integration tests pass on isolated DB
- [ ] Build/lint/typecheck pass
- [ ] Sandbox scenario added or updated
- [ ] Rollback documented
- [ ] User-facing terminology mode-aware
- [ ] No speculative legal/company claim
- [ ] Release evidence attached

---

## Appendix C — External interface evidence reviewed

### Claude Code

Current official documentation exposes command and HTTP lifecycle hooks covering session, prompt, tool, permission, subagent, task, stop/failure, and session-end events. Hook payloads may include highly sensitive fields such as prompt/tool input, transcript path, and working directory. This is why the plan requires a local allowlist sanitizer and forbids direct raw upload.

### Codex

Current official documentation exposes lifecycle command hooks, including session, prompt, tool, permission, subagent, stop, and session-end events. Non-managed hooks require trust review. This is why integration health distinguishes installed, trusted, and active states.

### VS Code

Current stable APIs can observe window focus, tasks, and terminal shell execution when shell integration is available. Shell integration is not guaranteed in every remote, subshell, or complex terminal configuration. This is why VS Code is an attention/corroboration layer rather than the sole agent-lifecycle source.

---

## Appendix D — Decisions that must not be silently made by code

A coding agent must not independently decide or activate:

- legal entity;
- real payment provider;
- payout provider;
- production countries;
- production currencies;
- real ad prices;
- real advertiser billing;
- real developer rewards;
- independent attestation acceptance;
- data-sale/CCPA legal scope;
- age-verification vendor;
- production analytics vendor;
- China launch;
- public support SLA;
- source/package license.

Those are owner, legal, operational, or commercial decisions with explicit phase gates.

---

## Appendix E — Repository evidence map

| Source path | Material finding used in this plan |
|---|---|
| `package.json` | WaitLayer monorepo, Node/pnpm versions, gate scripts |
| `README.md` | telemetry-only beta, no rewards, current CLI wrapper behavior |
| `AGENTS.md` | previous source-audit closure, gate history, destructive-test warning, remaining external work |
| `docs/ops/remaining-open-items.md` | provider, credentials, branch protection, CI, legal, and infra operator items |
| `packages/db/prisma/schema.prisma` | current event, wait, attestation, impression, campaign, ledger, payout, consent, and fraud models |
| `apps/api/src/runtime-config/runtime-config.service.ts` | fail-closed launch mode and money switches |
| `apps/api/src/extension/extension-wait.trait.ts` | wait start/end ingestion, signed evidence, server classification, duration and idempotency |
| `apps/api/src/extension/extension-ad.trait.ts` | attestation and launch-mode requirements before reward-bearing ad serving |
| `apps/cli/src/commands/run.ts` | wrapper observes process start/exit but not rich lifecycle |
| `apps/cli/src/lib/api-client.ts` | signed events, device registration, current host-derived fingerprint, wait/ad API shape |
| `apps/vscode-extension/src/detector-adapters.ts` | provider names are heuristic mappings, not live integrations |
| `apps/vscode-extension/src/wait-detector.ts` | inactivity/task/terminal/window heuristics and one-active-wait model |
| `apps/vscode-extension/src/extension.ts` | consent, attestation, ad panel, wait start/end coupling, false-positive feedback |
| `apps/vscode-extension/package.json` | version, provisional publisher, UNLICENSED state, production domain defaults |
| `.env.example` | current deployment, provider, privacy, attestation, and launch configuration surface |
| `.github/workflows/ci.yml` | current CI/security/migration/package/Docker coverage |
| `.github/workflows/staging.yml` | attestation-dependent staging financial smoke and deployment requirements |
| `apps/web/src/app/contact/page.tsx` | hardcoded contacts and support-response promise |
| `apps/web/src/app/terms/page.tsx` | beta wording, split, and 30-day hold |
| `apps/web/src/app/payout-policy/page.tsx` | planned policy and inconsistent three-day hold statement |
| `docs/legal/gdpr-dpa.md` | unverified legal-entity name and inconsistent privacy contact domain |

### External interfaces reviewed on 4 August 2026

- Claude Code official Hooks Reference
- Codex official Hooks and Configuration Reference
- VS Code official API and terminal shell-integration documentation

These interfaces must be covered by adapter canaries because vendor behavior can change after this audit.
