import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { runScenario } from './scenario-runner.mjs';
import { buildScenarioReport } from './scenario-report.mjs';

test('runs the disposable sandbox fixture as a subprocess and returns a trace', async () => {
  const result = await runScenario(
    path.resolve('scenarios/sandbox/terminal-claude-background-completion.json'),
  );
  assert.equal(result.trace.length, 6);
  assert.equal(result.trace.at(-1).placementType, 'completion_return');
  assert.ok(result.startedAt);
  assert.ok(result.endedAt);
  assert.ok(Date.parse(result.endedAt) >= Date.parse(result.startedAt));
});

test('runs a real shell-free child-process lifecycle fixture', async () => {
  const result = await runScenario(
    path.resolve('scenarios/sandbox/terminal-native-subprocess.json'),
  );
  assert.equal(result.trace.at(-1).eventType, 'session.ended');
  assert.equal(result.trace[2].eventType, 'task.completed');
});

test('records a child-process crash as a failed task without raw output', async () => {
  const result = await runScenario(
    path.resolve('scenarios/sandbox/terminal-native-subprocess-crash.json'),
  );
  assert.equal(result.trace[2].eventType, 'task.failed');
  assert.deepEqual(Object.keys(result.trace[2]), ['eventId', 'eventType']);
});

test('reports replayed canonical events as a failed adversarial scenario', async () => {
  const result = await runScenario(path.resolve('scenarios/sandbox/adversarial-replay.json'));
  const report = buildScenarioReport(result);
  assert.equal(report.status, 'failed');
  assert.match(report.errors.join('\n'), /duplicate canonical events/);
});

test('runs the real CLI hook normalizer without leaking planted private data', async () => {
  const result = await runScenario(
    path.resolve('scenarios/sandbox/privacy-hook-sanitization.json'),
  );
  assert.equal(result.trace[0].eventType, 'tool.started');
  assert.equal(result.trace[0].hasCashValue, false);
  assert.equal('prompt' in result.trace[0], false);
});

test('runs the real CLI spool deletion path without leaving local records', async () => {
  const result = await runScenario(path.resolve('scenarios/sandbox/local-queue-deletion.json'));
  assert.deepEqual(result.trace, []);
});

test('runs the real native lifecycle adapters for permission, failure, and cancellation', async () => {
  for (const [manifestName, expectedType] of [
    ['terminal-native-permission.json', 'permission.required'],
    ['terminal-native-failure.json', 'tool.failed'],
    ['terminal-native-cancelled.json', 'turn.cancelled'],
    ['terminal-native-subagent.json', 'subagent.started'],
  ]) {
    const result = await runScenario(path.resolve(`scenarios/sandbox/${manifestName}`));
    assert.equal(result.trace[0].eventType, expectedType);
    assert.equal(result.trace[0].hasCashValue, false);
  }
});

test('runs the remaining local privacy sanitizer cases', async () => {
  for (const [manifestName, expectedType] of [
    ['privacy-command-token.json', 'tool.failed'],
    ['privacy-user-path.json', 'tool.failed'],
    ['privacy-transcript-source.json', 'tool.failed'],
    ['privacy-large-payload.json', 'tool.failed'],
    ['privacy-prototype-pollution.json', 'tool.failed'],
    ['privacy-error-logging.json', 'tool.failed'],
  ]) {
    const result = await runScenario(path.resolve(`scenarios/sandbox/${manifestName}`));
    assert.equal(result.trace[0].eventType, expectedType);
    assert.equal(result.trace[0].hasCashValue, false);
  }
});

test('runs real CLI integration, queue, and deletion boundary fixtures', async () => {
  for (const [manifestName, expectedType] of [
    ['provider-hooks-disabled.json', 'integration.disabled'],
    ['provider-version-unsupported.json', 'integration.unverified'],
    ['wrapper-fallback.json', 'wrapper.completed'],
    ['malformed-hook-json.json', 'hook.rejected'],
    ['duplicate-agent-upload.json', 'upload.deduplicated'],
    ['old-schema-quarantine.json', 'queue.quarantined'],
    ['missing-executable.json', 'process.spawn_rejected'],
    ['hooks-account-deletion.json', 'account.deleted'],
    ['identity-consent-1.json', 'signup.completed'],
    ['identity-consent-2.json', 'telemetry.enabled'],
    ['identity-consent-3.json', 'ads.suppressed'],
    ['identity-consent-4.json', 'consent.revoked'],
    ['advertising-36.json', 'opportunity.foreground'],
    ['advertising-37.json', 'opportunity.completion_return'],
    ['advertising-38.json', 'opportunity.replayed'],
    ['advertising-39.json', 'opportunity.expired'],
    ['advertising-40.json', 'opportunity.category_blocked'],
    ['advertising-41.json', 'opportunity.country_blocked'],
    ['advertising-42.json', 'opportunity.frequency_capped'],
    ['vscode-21.json', 'vscode.foreground'],
    ['vscode-22.json', 'vscode.background_return'],
    ['vscode-23.json', 'vscode.single_owner'],
    ['vscode-26.json', 'vscode.reloaded'],
    ['vscode-27.json', 'vscode.closed'],
    ['vscode-24.json', 'vscode.terminal_lifecycle'],
    ['vscode-25.json', 'vscode.shell_integration_missing'],
    ['vscode-28.json', 'vscode.inactivity_shadow'],
    ['vscode-29.json', 'vscode.false_positive_suppressed'],
    ['vscode-30.json', 'vscode.quiet_mode'],
    ['concurrency-31.json', 'concurrency.two_sessions'],
    ['concurrency-32.json', 'concurrency.wrapper_deduplicated'],
    ['concurrency-33.json', 'concurrency.parallel_subagents'],
    ['concurrency-34.json', 'concurrency.partial_completion'],
    ['concurrency-35.json', 'concurrency.two_devices'],
    ['reliability-66.json', 'reliability.out_of_order_rejected'],
    ['reliability-70.json', 'opportunity.kill_switch'],
    ['advertising-43.json', 'ad.dismissed'],
    ['advertising-44.json', 'ad.reported'],
    ['advertising-45.json', 'opportunity.consent_revoked_before_render'],
    ['sandbox-finance-47.json', 'finance.cpm_split'],
    ['sandbox-finance-48.json', 'finance.cpc_split'],
    ['sandbox-finance-53.json', 'finance.earning_hold'],
    ['sandbox-finance-54.json', 'finance.hold_released'],
    ['sandbox-finance-49.json', 'finance.duplicate_impression'],
    ['sandbox-finance-50.json', 'finance.duplicate_click'],
    ['sandbox-finance-55.json', 'finance.reversed'],
    ['adversarial-81.json', 'adversarial.fake_long_task'],
    ['adversarial-82.json', 'adversarial.ten_sessions'],
    ['adversarial-84.json', 'process.renamed_untrusted'],
    ['adversarial-85.json', 'adversarial.mouse_jiggling'],
    ['adversarial-87.json', 'adversarial.repeated_completion'],
    ['adversarial-90.json', 'hook.tampered_rejected'],
    ['reliability-62.json', 'reliability.redis_offline'],
    ['reliability-63.json', 'reliability.database_timeout'],
    ['adversarial-88.json', 'adversarial.automated_clicks'],
    ['adversarial-86.json', 'adversarial.vm_clone'],
    ['adversarial-89.json', 'adversarial.referral_loop'],
    ['terminal-codex-normal.json', 'codex.normal_completion'],
    ['terminal-codex-permission.json', 'codex.permission_request'],
    ['terminal-codex-subagent.json', 'codex.subagent'],
    ['logout-queued-events.json', 'identity.logout.completed'],
    ['privacy-data-export.json', 'privacy.export.completed'],
    ['privacy-data-deletion.json', 'privacy.deletion.completed'],
    ['sandbox-test-deposit.json', 'sandbox.deposit.approved'],
    ['sandbox-refund.json', 'sandbox.deposit.refunded'],
    ['sandbox-dispute.json', 'sandbox.deposit.disputed'],
    ['sandbox-payout-success.json', 'sandbox.payout.paid'],
    ['sandbox-payout-failure.json', 'sandbox.payout.failed'],
    ['sandbox-payout-ambiguous.json', 'sandbox.payout.ambiguous'],
    ['sandbox-duplicate-payout.json', 'sandbox.payout.duplicate_request'],
    ['sandbox-reconciliation-escalation.json', 'sandbox.payout.reconciliation_escalation'],
    ['reliability-queue-full.json', 'queue.backpressure'],
    ['reliability-clock-skew.json', 'event.rejected'],
    ['reliability-api-offline.json', 'api.offline'],
  ]) {
    const result = await runScenario(path.resolve(`scenarios/sandbox/${manifestName}`));
    assert.equal(result.trace[0].eventType, expectedType);
    assert.equal(result.trace[0].hasCashValue, false);
  }
});

test('terminates a fixture that exceeds its fault-injection timeout', async () => {
  await assert.rejects(
    runScenario(path.resolve('scenarios/fixtures/fault-timeout.json')),
    /scenario fixture timed out/,
  );
});

test('rejects a trace that leaks a secret container (privacy canary)', async () => {
  await assert.rejects(
    runScenario(path.resolve('scenarios/sandbox/privacy-canary-leak.json')),
    /privacy canary triggered/,
  );
});

test('kills a fixture that floods stdout past the output cap', async () => {
  const started = Date.now();
  await assert.rejects(
    runScenario(path.resolve('scenarios/sandbox/runner-output-flood.json')),
    /exceeded the stdout output cap/,
  );
  // The cap check must fail fast, not buffer gigabytes until the timeout.
  assert.ok(Date.now() - started < 30_000);
});

test('terminates the whole process group when a grandchild holds stdout open', async () => {
  const { mkdtempSync, readFileSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'scenario-group-'));
  const pidFile = join(dir, 'grandchild.pid');
  try {
    process.env.SCENARIO_GRANDCHILD_PID_FILE = pidFile;
    // Fixture exits 0 but the grandchild keeps the pipe open: the run must
    // NOT return success, and must not hang past the fixture timeout.
    await assert.rejects(
      runScenario(path.resolve('scenarios/sandbox/runner-process-group-leak.json')),
      /scenario fixture timed out/,
    );
    delete process.env.SCENARIO_GRANDCHILD_PID_FILE;
    assert.ok(existsSync(pidFile), 'grandchild pid file was never written');
    const grandchildPid = Number(readFileSync(pidFile, 'utf8').trim());
    assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 1);
    // The detached process-group teardown must have reaped the grandchild.
    // A dying process may linger as a zombie for a moment, so poll briefly.
    const deadline = Date.now() + 3_000;
    let reaped = false;
    while (Date.now() < deadline) {
      try {
        process.kill(grandchildPid, 0);
      } catch {
        reaped = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(reaped, `grandchild ${grandchildPid} survived the group teardown`);
  } finally {
    delete process.env.SCENARIO_GRANDCHILD_PID_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});
