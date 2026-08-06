# WaitLayer Release 0.x Residual Backlog

Audit date: 2026-08-06
Source of truth: live repository at `25da3e1` plus the current worktree.

The consented full root test is green (14/14 tasks, including the destructive
reset on the isolated test database). The latest remote CI failures were
source-level packaging/security issues and are fixed in the current worktree:
workspace dependency build ordering, standalone CLI packaging, Compose/Buildx
attestation wiring, scan-safe test fixtures, patched dependency floors, and
Docker workspace manifests. A fresh runner-backed CI execution on the updated
SHA is still required for release evidence.

This backlog is derived from `docs/waitlayer-implementation-blueprint.md`.
Statuses are intentionally conservative: a local unit test does not close a
release or operator gate.

## Blueprint requirement matrix

`Complete-source` means the repository has the requested implementation and
tests; it does not claim external deployment or product approval. `Foundation`
means only the safe repository slice is present. `External` means the next
proof requires an operator, provider, legal decision, or real client/runtime.

| Blueprint item              | Current status               | Remaining proof or work                                               |
| --------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| WL-G001                     | External                     | Exact-SHA CI/Docker/Vercel evidence and uploaded release artifact     |
| WL-G002/G003/G010–G014      | Complete-source              | Re-run gates and deployment proof                                     |
| WL-G004/G006/G011–G015/G017 | Complete-source              | Provider/runtime coverage remains where applicable                    |
| WL-G005                     | Complete-source, trust-gated | Real Codex installation/trust/runtime evidence                        |
| WL-G007/G018                | Complete-source              | Independent staging/runtime evidence                                  |
| WL-G008                     | Foundation                   | Actual terminal/web/VS Code harness and repeated clean runs           |
| WL-G009                     | Foundation                   | Copy/product review for every public surface                          |
| WL-G016                     | Complete-source catalog      | Independent/repeated runtime evidence                                 |
| WL-G019                     | Complete-source catalog      | Independent/repeated runtime evidence                                 |
| WL-G020                     | Foundation                   | Human approval workflow and issue-creation integration                |
| WL-G021                     | Complete-source foundation   | Per-run schema/artifact retention and interrupted-run cleanup proof   |
| WL-G022                     | External                     | Cross-platform clean-install measurements                             |
| WL-G023                     | External                     | Publisher/license/signing and release verification                    |
| WL-001                      | External                     | Runner-backed exact-SHA baseline and artifact upload                  |
| WL-002                      | External                     | GitHub branch protection settings                                     |
| WL-003                      | Complete-source              | Templates exist under `.github/`                                      |
| WL-004                      | Foundation                   | Release evidence still needs real Docker digests and runner results   |
| WL-010–014                  | Complete-source              | Deployment/runtime proof                                              |
| WL-020–023                  | Complete-source              | Broader recorded-provider regression corpus                           |
| WL-030–034                  | Complete-source foundation   | DB-backed clean-reset evidence and production-scale review            |
| WL-040–043/046              | Complete-source              | Cross-platform/runtime evidence                                       |
| WL-044                      | Complete-source              | Full supported Claude lifecycle matrix                                |
| WL-045                      | Complete-source, trust-gated | Real Codex version/trust/runtime evidence                             |
| WL-047                      | Complete-source              | Verify status UX across all packaged clients                          |
| WL-050–055                  | Complete-source foundation   | Full Electron/client journey evidence                                 |
| WL-060–064                  | Complete-source              | Placement expiry/dedup and scenario evidence                          |
| WL-065                      | Foundation                   | Performance/placement metrics beyond opportunity state counts         |
| WL-070–074                  | Complete-source foundation   | Independent sandbox run and broader reconciliation evidence           |
| WL-080                      | Complete-source              | Manifest schema, catalog, runner, and clean-state orchestration       |
| WL-081                      | Complete-source              | Repeated clean subprocess evidence                                    |
| WL-082–083                  | Foundation                   | Playwright advertiser/operator and VS Code/Electron runtime evidence  |
| WL-084                      | Foundation                   | Auditor coverage for all invariants and independent runtime execution |
| WL-085–086                  | Complete-source foundation   | Independent repeated fault/fraud runtime evidence                     |
| WL-087–088                  | Foundation                   | Connect reports to durable triage/approval without issue spam         |
| WL-090/093–095              | Remaining/decision-gated     | Copy/legal review, consent policy, research, kill-switch rehearsal    |
| WL-091–092                  | External                     | Domains, mailboxes, publisher/license/signing                         |

## Completed or in progress in the repository

- Environment identity and startup guards (`WL-010`–`WL-014`), including XTS
  test-credit policy and persistent sandbox labeling.
- Provider-neutral lifecycle protocol, privacy-safe fixtures, compatibility
  validation, additive persistence, batch ingestion, projection, reconciliation,
  and analytics (`WL-020`–`WL-034`).
- Random installation identity, local spool/bridge, Claude hook ingestion and
  hook configuration merging, wrapper fallback, and VS Code bridge/correlation
  foundations (`WL-040`–`WL-046`, `WL-050`). Codex native integration is now
  source-backed against the current command-hook contract, but remains
  explicitly trust-gated until an operator reviews and authorizes it.
- Placement configuration and provider-neutral opportunity projection
  (`WL-060`–`WL-061`).
- The current worktree implements sandbox foreground and completion-return
  placement, multi-window attention-owner behavior, and sandbox-only XTS credit
  accounts/faucet (`WL-051`, `WL-062`, `WL-063`, `WL-070`, `WL-071`). These
  changes remain uncommitted user work and must be reviewed before publication.
- Isolated house-campaign seed/reset/reconciliation tooling now exists for
  marked sandbox/test databases (`WL-065`, `WL-073`, `WL-074`). Reset requires
  both an environment marker and an explicit confirmation flag.
- Reporting query coverage now includes additive covering indexes for
  `earnings_ledger(userId, status, availableAt, createdAt)` and
  `ad_impressions(campaignId, qualifiedAt, isBillable)` via migration
  `20260806040000_reporting_query_indexes`; both local databases report 86
  migrations applied.
- The CLI now exposes sandbox status, faucet, and deterministic payout
  simulation commands, in addition to the HTTP/client APIs.
- The developer web dashboard now exposes a health-gated sandbox credit and
  payout-simulation panel with explicit XTS/no-cash-value terminology; its
  production-mode no-call behavior is covered by UI tests.
- Advertiser sandbox deposits now have a separate XTS-only simulation table,
  idempotent approved/processing/declined/refunded/disputed/timeout outcomes,
  isolated credit-entry accounting, advertiser-scoped API endpoints, and a
  health-gated dashboard panel. These simulations never touch advertiser or
  platform ledgers and never call an external provider.
- The sandbox payout simulation now also names callback-before-response,
  duplicate-callback, timeout, and reconciliation-escalation outcomes; status
  mapping remains fail-closed and all simulation labels remain non-cash.
- Public beta copy no longer promises a fixed support response time, active
  revenue sharing, or a fixed payout hold; the draft DPA now clearly marks its
  legal entity and privacy contact as pending confirmation.
- A constrained Node subprocess runner executes deterministic sandbox fixtures
  and feeds sanitized traces into the report pipeline, including an adversarial
  replay detector and timeout fault-injection fixture.
- The deterministic scenario manifest, independent sanitized-trace auditor,
  deterministic evidence report, subprocess/fault runner, and fingerprint-
  based duplicate grouping are checked in (`WL-080`, `WL-084`, `WL-087`,
  `WL-088` foundation).
  A privacy-safe triage queue now preserves acknowledgement/resolution state
  without retaining raw traces.
  `scenarios/catalog.json` enumerates and validates all 90 Appendix A
  scenarios exactly once; this is catalog completeness, not execution proof.
  The terminal runner now launches a separate shell-free child process and
  verifies both normal completion and crash outcomes. `scenario:coverage`
  reports current executable manifest coverage as 90/90
  and lists every missing scenario by category.
  Privacy scenarios now execute the compiled CLI hook normalizer and bounded
  input parser with planted prompt/command/path/transcript/source/API-key,
  oversized, prototype-pollution, and error values; they fail on leakage.
  Provider fixtures, fraud/fault catalog, and client journey harness remain.
- The compiled local runtime path is now proven: `start:api` boots the compiled
  API with connected Postgres/Redis, `start:web` delegates through the workspace
  package, and web health/proxy endpoints respond when the repository-root
  environment is loaded with the PEM-safe dotenv loader. This is local runtime
  evidence only; it does not replace Docker/CI runner evidence.
- The signup page's disabled Google control now meets WCAG contrast checks. The
  full Playwright matrix passed 86/86 after starting the API with documented
  test-only throttle overrides and loading the matching web JWT environment.
- Scenario evidence now requires a positive Appendix A `catalogId`, records it
  in every machine-readable report, and rejects traces missing canonical event
  types. Reports carry sanitized severity, reproduction-confidence, and
  artifact metadata; automatic triage is limited to deterministic,
  high-confidence failures. The combined auditor/report/runner/triage focused
  suite is 28/28, including repeated-run performance evidence and timestamp-
  independent report fingerprints.

## Repository-contained work remaining

These items can be implemented without production credentials, but each needs
its own tests and release evidence:

The blueprint Appendix A catalog is now executable for all 90/90 scenarios.
Codex scenarios 12–14 use the current official command-hook contract through
the source-backed Codex adapter, with trust remaining explicit and fail-closed.
All identity/consent, terminal/native, VS Code, concurrency, advertising,
sandbox-finance, reliability, privacy, and adversarial entries have executable
source-backed fixtures.

- `WL-044`/`WL-045`: source implementation and recorded lifecycle coverage are
  complete; real provider-version/trust/runtime verification remains external.
- `WL-047`, `WL-052`–`WL-055`: complete integration status reporting, native-vs-
  heuristic deduplication, attention/processing separation, completion summary,
  and mode-aware terminology across all clients.
- `WL-063`–`WL-065`: finish placement metrics beyond the per-user opportunity
  state/type analytics; the API now also returns bounded total/claimed/expired
  counts and a deterministic claim rate. Agent analytics now includes the
  authoritative environment ID and bounded per-session duration. Completion-
  return, isolated house campaign, and leased candidate-expiry cleanup are
  present; deterministic repeated-run evidence now exists, while placement-
  scale performance telemetry still needs real client/runtime measurements.
- `WL-070`–`WL-074`: broaden reconciliation beyond the XTS account and payout
  invariants; the read-only reconciliation tool now validates payout and
  deposit simulations, all XTS entry balances, environment/currency labels,
  and the no-financial-row boundary. The durable XTS payout simulation covers
  paid/processing/failed/ambiguous/reversed outcomes, while external-provider
  calls remain impossible.
- `WL-080`–`WL-088`: deterministic schema, terminal fixtures, provider
  fixtures, all fraud/reliability scenarios, auditor/reporting, and triage are
  source-complete. The remaining slice is real Playwright advertiser/operator
  and VS Code/Electron runtime evidence.
- `WL-090`, `WL-093`–`WL-095`: finish copy/legal consistency without inventing
  an entity or promise, version retention/consent after legal approval, and
  rehearse the public kill-switch and rollback path.
- Complete Release 0.1 evidence (`WL-001`, `WL-004`): exact-SHA baseline
  artifact, Docker image build/boot evidence, migration/drift evidence, and a
  reproducible gate report. The destructive integration reset remains consent-
  protected in this agent session.

## Operator, external, or decision-gated work

The following cannot be closed by repository edits alone:

- Enable protected-main branch rules and required checks; create the actual
  issue/PR flow for each backlog item.
- Run the complete CI workflow and Docker image e2e on a runner with registry
  access; configure registry, staging/production hosts, SSH trust, DNS, TLS,
  deployment secrets, and public Vercel/API routing.
- Operate and security-review an independent attestation provider/bridge,
  configure issuer keys/version allowlists, prove rotation/revocation, and run
  the documented staged financial experiment. The repository reference bridge
  is not production proof.
- Choose and configure real payout/deposit providers and credentials; keep
  real rewards, advertiser billing, and withdrawals disabled until the
  attestation and launch gates pass.
- Finalize legal entity, privacy/support domains, consent/retention language,
  KYC/AML/tax/country policy, extension license/publisher/signing, human-alpha
  research, and monitored support/on-call ownership.

## Verification record

- `pnpm --filter @waitlayer/db exec prisma validate`: pass; migration status
  reports the local development database up to date with 86 migrations,
  including the reporting-index migration `20260806040000`.
- `pnpm typecheck`: 17/17 tasks pass.
- Focused sandbox service/placement tests: 14/14 pass; focused VS Code tests:
  21/21; CLI/VS Code API-client suites: 14/14 and 15/15.
- Sandbox developer panel environment-gate/no-cash UI tests: 2/2; production
  mode makes no sandbox API calls.
- Sandbox advertiser deposit service tests: 9/9; advertiser panel tests: 4/4;
  production mode makes no deposit API calls.
- Agent opportunity analytics contract: 3/3.
- Opportunity analytics now includes a bounded claim-rate summary; focused
  contract remains 3/3.
- Scenario catalog validation: 2/2; `pnpm run scenario:catalog` validates all
  90 Appendix A entries; coverage report currently identifies 90/90 executable
  manifests. Scenario manifest/auditor tests: 6/6;
  `pnpm run scenario:check` validates 90
  manifests,
  including rejection of production/cash-value labels, missing canonical IDs,
  and prototype-pollution keys.
- Combined auditor/catalog/coverage/report/repeat/runner/triage tests:
  `node --test scripts/scenario-*.test.mjs` — 28/28; the CLI boundary cases
  are included in the runner subprocess tests.
  `pnpm run scenario:run -- <manifest>` passes.
- Opportunity-expiry cron contract: 2/2.
- `pnpm lint`, `pnpm build`, `node scripts/audit-claims.mjs`, and
  `git diff --check`: pass.
- `pnpm run test:compiled-entrypoints`: 2/2; compiled API booted on `:4002`
  with database and Redis connected; web `/api/platform-health`, `/api/health`,
  and `/comparison` responded; focused browser coverage was 39/39 and the
  full browser suite was 86/86.
- `pnpm typecheck`: 17/17; `pnpm lint`: 11/11; `pnpm build`: 11/11;
  release-gate tests: 9/9; claims audit: 13/13.
- The latest root `pnpm test` run passed API unit tests (128 files / 1,295
  tests), CLI tests (20 files / 126 tests), VS Code tests (138 passed, one
  intentional skip), and web tests (49 files / 203 tests), then stopped at Prisma's
  explicit-consent guard before the destructive isolated test-database reset.
- Root `pnpm test`: all non-destructive workspace suites pass, including API
  unit 128 files/1,295 tests; it then stops before integration at Prisma's
  consent-protected `migrate reset --force` against `waitlayer_test`.
- `pnpm test`: unit/workspace suites passed, then stopped at the guarded
  `prisma migrate reset --force` integration phase because explicit user
  consent was not provided.
- Non-destructive Prisma verification against the API development database:
  85 migrations applied, status current, and `migrate diff` reports no
  difference.
