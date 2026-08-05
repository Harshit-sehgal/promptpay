import chalk from 'chalk';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';

import { sendAgentEventToBridge } from '../lib/agent-bridge';
import { ApiClient } from '../lib/api-client';
import { getCredentials } from '../lib/credentials';
import { printSandboxBanner } from '../lib/environment-label';
import { getErrorMessage } from '../lib/errors';
import { createGenericWrapperEvent } from '../lib/generic-wrapper-adapter';
import { normalizeToolType } from '../lib/tool-types';

const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/**
 * Run an AI command under direct CLI supervision.
 *
 * Unlike `waitlayer watch`, this path observes an actual child process start
 * and exit rather than trusting a user-written marker file. The resulting
 * telemetry is still deliberately non-billable: a client-held device secret
 * cannot independently attest that an unmodified CLI observed the process.
 * This gives the launch pilot a real event source without weakening the
 * server's settlement gate before a provider/server-verifiable attestation is
 * available.
 */
export async function runSupervisedCommand(command: string[]): Promise<number> {
  if (command.length === 0 || !command[0]) {
    throw new Error('Usage: waitlayer run -- <AI command> [arguments...]');
  }

  const creds = await getCredentials();
  if (!creds) {
    throw new Error('Not logged in. Run `waitlayer auth` first.');
  }

  const api = new ApiClient(creds);
  // Keep the wrapped command's stdout byte-for-byte compatible with normal
  // invocation; the environment marker belongs on stderr for `run`.
  await printSandboxBanner(api, process.stderr);
  const executable = command[0];
  const args = command.slice(1);
  const toolType = normalizeToolType(path.basename(executable));
  const waitStateId = `cli-run-${randomUUID()}`;
  const sessionId = `cli-run-session-${waitStateId}`;
  const startedAt = Date.now();
  const deviceId = await api.getOrRegisterDevice();

  // Start the child before reporting it. A failed spawn must never produce a
  // synthetic wait state. stdio is inherited so `waitlayer run` preserves the
  // wrapped tool's normal interactive behavior.
  const child = spawn(executable, args, {
    stdio: 'inherit',
    shell: false,
  });

  // `spawn()` returns a ChildProcess even when the executable cannot be
  // started. Wait for Node's definitive spawn/error event before sending any
  // telemetry so a missing binary cannot create a synthetic wait state.
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });

  // Install the close listener immediately after the spawn handshake. A very
  // short-lived command can exit while local telemetry is being queued; the
  // wrapper must never hang or miss its end event in that race.
  let exitResult: { code: number; signal: NodeJS.Signals | null } | undefined;
  let endedAt: Date | undefined;
  const exitPromise = new Promise<{ code: number; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      endedAt = new Date();
      const result = { code: signal ? signalExitCode(signal) : (code ?? 1), signal };
      exitResult = result;
      resolve(result);
    });
  });

  const installationId = creds.installationId;
  let wrapperStarted = false;
  if (installationId) {
    try {
      await sendAgentEventToBridge({
        installationId,
        deviceId,
        event: createGenericWrapperEvent({
          installationId,
          deviceId,
          correlationId: sessionId,
          executable,
          eventType: 'session.started',
          occurredAt: new Date(startedAt),
        }),
      });
      wrapperStarted = true;
    } catch (error: unknown) {
      // The wrapper remains useful when the local bridge/spool is unavailable;
      // never turn optional analytics into a broken coding-agent command.
      console.warn(chalk.yellow(`WaitLayer wrapper telemetry unavailable: ${getErrorMessage(error)}`));
    }
  }

  let forwardSignal: ((signal: NodeJS.Signals) => void) | undefined;
  let terminationSignal: NodeJS.Signals | null = null;
  let cancellationAt: Date | undefined;
  let cancellationEvent: Promise<void> | undefined;

  let started = false;
  try {
    await api.reportWaitState({
      deviceId,
      waitStateId,
      sessionId,
      toolType,
      evidence: [
        {
          type: 'command_execution',
          // Direct child-process observation is stronger than a marker file,
          // but remains local telemetry until independently attestable.
          sourceType: 'inferred',
          adapterId: 'cli.runner.supervisor',
          timestamp: startedAt,
          correlationId: sessionId,
        },
        {
          type: 'active_task',
          sourceType: 'inferred',
          adapterId: 'cli.runner.child_process',
          timestamp: startedAt + 1,
          correlationId: sessionId,
        },
      ],
    });
    started = true;
  } catch (error: unknown) {
    // The wrapped tool remains usable if telemetry is temporarily unavailable;
    // never turn an analytics outage into a broken developer command.
    console.warn(chalk.yellow(`WaitLayer telemetry unavailable: ${getErrorMessage(error)}`));
  }

  const removeSignalHandlers = () => {
    if (!forwardSignal) return;
    for (const signal of FORWARDED_SIGNALS) process.removeListener(signal, forwardSignal);
  };

  try {
    forwardSignal = (signal: NodeJS.Signals) => {
      // Forward Ctrl-C/termination to the exact supervised child. We do not
      // exit the parent here: the child's close event provides the single
      // authoritative end point for telemetry cleanup.
      terminationSignal = signal;
      cancellationAt = new Date();
      if (wrapperStarted && installationId) {
        cancellationEvent = sendAgentEventToBridge({
          installationId,
          deviceId,
          event: createGenericWrapperEvent({
            installationId,
            deviceId,
            correlationId: sessionId,
            executable,
            eventType: 'turn.cancelled',
            occurredAt: cancellationAt,
            signal,
          }),
        }).catch((error: unknown) => {
          console.warn(
            chalk.yellow(`WaitLayer cancellation telemetry unavailable: ${getErrorMessage(error)}`),
          );
        });
      }
      child.kill(signal);
    };
    for (const signal of FORWARDED_SIGNALS) process.once(signal, forwardSignal);
    const exit = await exitPromise;

    return exit.code;
  } finally {
    removeSignalHandlers();
    await cancellationEvent;
    if (wrapperStarted && installationId) {
      try {
        await sendAgentEventToBridge({
          installationId,
          deviceId,
          event: createGenericWrapperEvent({
            installationId,
            deviceId,
            correlationId: sessionId,
            executable,
            eventType: 'session.ended',
            occurredAt: endedAt,
            durationMs: Date.now() - startedAt,
            exitCode: terminationSignal ? null : exitResult?.code,
            signal: terminationSignal ?? exitResult?.signal,
          }),
        });
      } catch (error: unknown) {
        console.warn(
          chalk.yellow(`WaitLayer wrapper end was not recorded: ${getErrorMessage(error)}`),
        );
      }
    }
    if (started) {
      const durationSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      try {
        await api.endWaitState({ waitStateId, durationSeconds });
      } catch (error: unknown) {
        console.warn(
          chalk.yellow(`WaitLayer wait end was not recorded: ${getErrorMessage(error)}`),
        );
      }
    }
    const outcome = terminationSignal || exitResult?.signal || exitResult?.code !== 0 ? 'failed' : 'completed';
    const telemetry = started ? 'recorded' : 'unavailable';
    // Completion summaries belong on stderr so the wrapped agent's stdout
    // remains byte-for-byte compatible for pipes, scripts, and IDE terminals.
    console.error(
      chalk.dim(
        `WaitLayer: supervised session ${outcome} (${toolType}); telemetry ${telemetry}; rewards are not enabled.`,
      ),
    );
  }
}

function signalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case 'SIGINT':
      return 130;
    case 'SIGTERM':
      return 143;
    default:
      return 1;
  }
}
