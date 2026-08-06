# Client Release Runbook

This runbook covers the distributed WaitLayer clients: `waitlayer-cli` on npm and
the `waitlayer-vscode` VS Code extension.

## Artifacts

- CLI release workflow: `.github/workflows/publish-cli.yml`
  - Packages `apps/cli` into `waitlayer-cli-*.tgz`.
  - Smoke-installs the tarball and runs `waitlayer --version` and
    `waitlayer --help` with `WAITLAYER_API_URL=https://api.waitlayer.com/api/v1`.
  - Uploads the tarball as the `waitlayer-cli-package` workflow artifact.
- VS Code release workflow: `.github/workflows/publish-vscode.yml`
  - Packages `apps/vscode-extension` into `waitlayer-vscode.vsix`.
  - Checks the VSIX metadata keeps `waitlayer.apiUrl` defaulted to
    `https://api.waitlayer.com/api/v1`.
  - Uploads the VSIX as the `waitlayer-vscode-vsix` workflow artifact.

Release-published events build and upload artifacts but do not publish to npm or
Marketplace automatically. Real publication is a manual `workflow_dispatch` run
with `publish=true`, guarded by the `npm-publish` or `vscode-marketplace`
GitHub environment.

## Publish

1. Verify CI is green for the release commit.
2. Create or publish the GitHub release to generate reviewable artifacts.
3. Download and smoke-test the uploaded artifact locally if needed.
4. Re-run the relevant publish workflow manually with `publish=true`.
5. Confirm the package appears in npm or Visual Studio Marketplace.

Required secrets:

- `NPM_TOKEN` for npm publication.
- `VSCE_PAT` for Visual Studio Marketplace publication.

## CLI installation identity and device migration

Current CLI installs generate a random UUID on first device registration and
store it in the protected WaitLayer credential metadata. The identity is stable
across CLI upgrades and contains no hostname, username, home directory, OS
release, architecture, or memory information. The API converts it to a
server-keyed pseudonym before storing the device fingerprint.

The CLI still sends the historical `fingerprintHash` field for compatibility.
During a rolling API deployment it retries registration without the additive
`installationId` field if an older strict API rejects that field. This is a
short-lived rollout compatibility path: the fingerprint is already derived from
the random ID, and the current API re-keyed path should be deployed before
relying on it for new environments. Existing legacy devices whose local event
secret is missing use the old fingerprint-only recovery path; this preserves
same-device recovery without creating a second identity. Do not manually copy
`credentials.json` between users or machines.

The identity metadata write is atomic and protected by a short-lived local lock.
If a process crashes, a demonstrably stale lock is reclaimed; otherwise the CLI
fails rather than racing credential metadata. Account logout/deletion cleanup removes queued, in-flight, and quarantined
agent events as well as the credential metadata according to the normal
credential policy.

## Local agent bridge and spool

The CLI’s Release 0.2 agent lifecycle path is local-first. A normalized event is
sent to `waitlayer bridge start` over an installation-local Unix socket (or a
Windows named pipe), authenticated with a random secret stored under the
protected WaitLayer config directory. The bridge acknowledges an event only
after it has been persisted to the local JSONL spool.

If the bridge is not running, the client writes directly to the same spool. The
spool is bounded, rejects forbidden protocol fields, expires old events, and
uses an in-flight claim file so a process crash causes replay rather than silent
loss. Successful API acknowledgements remove events; explicit per-event
rejections are quarantined for diagnostics. Uploads use the signed
`POST /api/v1/agent-events/batch` endpoint and have no financial side effects.
The endpoint accepts protocol version `1` and the CLI sends
`X-WaitLayer-Agent-Protocol-Version: 1`; mismatched or malformed versions are
rejected with machine-readable `agent_protocol_unsupported_version` or
`agent_protocol_invalid_version` errors. The response includes the negotiated
`protocolVersion`. Older clients may omit the header during rollout, but they
must still send a supported payload schema version.

The API also exposes developer-owned, non-financial analytics at
`GET /api/v1/agent-events/analytics`. It returns bounded session summaries and
aggregates by provider, session status, and work-unit kind/status. Queries are
limited to a 31-day window and paginated to at most 100 sessions per page (with
a bounded page number); the route is developer-role JWT-only and rejects API
keys. The response excludes
provider/session hashes, workspace identifiers, event metadata, prompts, paths,
source content, and all ledger or payout fields. It is analytics only and
returns `financialSideEffects: false`.

Useful commands:

```bash
waitlayer bridge start
waitlayer bridge status
waitlayer bridge flush
waitlayer bridge clear
```

The bridge is telemetry infrastructure only. It never authorizes permissions,
creates ad impressions, or creates money. Agent sessions are reconciled by a
server-side housekeeping job after a conservative recovery window.

The VS Code extension can opt into a separate read-only subscription socket,
`bridge-events.sock` (or the corresponding Windows named pipe). It authenticates
with the same installation-local bridge secret, receives only canonical
newline-delimited lifecycle events after the CLI has durably spooled them, and
reconnects with bounded backoff when the CLI bridge restarts. The extension does
not send those events back, duplicate native hook telemetry, or treat them as
financial evidence. Its local correlation layer prefers native hook/plugin
sources over wrapper observations and deduplicates repeated event IDs. Missing
shell/bridge capability is reported as unavailable/degraded telemetry rather
than converted into an ad opportunity or a verified wait. It marks
only stale active sessions with no recent lifecycle event and no activework unit as `abandoned`; it never closes active work units or changes attention,
ad-opportunity, ledger, or payout rows. Abandoned correlations are terminal:
late events are acknowledged as `abandoned_session` rejections, and a genuinely
resumed provider run must use a new correlation ID. The job is lease-protected
across API replicas and exposes `agent_session_reconciliation_*` operational
counters.
The fast local hook path is available as:

```bash
printf '%s' '{"session_id":"provider-session","timestamp":"2026-08-04T12:00:00.000Z"}' \
  | waitlayer hooks ingest --provider claude_code --event SessionStart
```

`hooks ingest` reads bounded JSON from stdin, projects only an explicit metadata
allowlist, hashes provider identifiers locally when the device secret is
available, and writes only a canonical event to the bridge/spool. It never makes
a synchronous API request and returns success/failure without printing provider
payloads. Claude Code lifecycle normalization is now handled by the local adapter (`claude-code-0.0.1`). It maps supported lifecycle names to canonical events, keeps only coarse allowlisted metadata, and discards prompts, transcript paths, tool input/output, commands, CWDs, and raw tool names before bridge delivery. Provider-specific configuration ownership remains managed separately:

```bash
waitlayer integrations install claude-code
waitlayer integrations status
waitlayer integrations repair claude-code
waitlayer integrations uninstall claude-code
```

`integrations status` reports a stable capability tier for automation and human
operators: `native` means the verified hook set is active, `wrapper`
means no native hook is installed and `waitlayer run -- ...` remains the safe
fallback, `degraded` means hooks are present but incomplete/unverified or the
configuration is malformed, and `disabled` means collection is explicitly
turned off. Use `integrations disable claude-code` / `integrations enable
claude-code` to toggle the explicit disabled state without removing hooks.
Codex is installed additively into its user-level `hooks.json`, but remains
`degraded` until the operator explicitly reviews the provider trust prompt and
runs `waitlayer integrations trust codex`. A degraded, disabled, or managed
status exits non-zero so CI and setup scripts cannot mistake an unhealthy
integration for success.

Installation is additive and idempotent. Existing provider hooks are preserved;
WaitLayer-owned entries carry a stable marker and are the only entries repair or
uninstall may change. Existing files are backed up with owner-only permissions
before modification. Invalid JSON or configurations marked as managed/locked are
reported as degraded/managed and are never overwritten. Project-level hooks and
provider-specific trust prompts remain an explicit user/provider concern; the
CLI does not silently modify project files or grant trust. Codex native ingestion
is implemented against its command-hook schema, projects only bounded scalar
metadata, and remains fail-closed until explicit local trust is recorded.

The generic wrapper path (`waitlayer run -- <command>`) now also emits canonical
`generic_wrapper` lifecycle events to the local bridge: process start, optional
cancellation, and process end. It records only a coarse executable family,
result category, and duration bucket; executable paths, command arguments,
stdout, stderr, and terminal output never enter the event. Wrapper events are
`sourceType: inferred`, lower confidence than native hooks, and remain telemetry
only with no ad or financial side effects. Legacy wait-state reporting is kept
for compatibility and failures in the optional bridge/spool path never block the
wrapped command.

## Rollback

- CLI: publish a corrected patch version. npm package versions are immutable, so
  do not attempt to replace an already-published tarball.
- VS Code: publish a corrected patch version or unpublish the Marketplace
  version only if the Marketplace policy and customer impact justify it.
- For both clients, leave the previous workflow artifacts attached for audit and
  incident review.
