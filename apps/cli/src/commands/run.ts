import chalk from 'chalk';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';

import { ApiClient } from '../lib/api-client';
import { getCredentials } from '../lib/credentials';
import { getErrorMessage } from '../lib/errors';
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

  let forwardSignal: ((signal: NodeJS.Signals) => void) | undefined;
  const exitPromise = new Promise<number>((resolve, reject) => {
    // The spawn handshake above owns pre-start errors. This listener protects
    // the completed lifecycle after the child has successfully started.
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) resolve(128);
      else resolve(code ?? 1);
    });
  });

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
      child.kill(signal);
    };
    for (const signal of FORWARDED_SIGNALS) process.once(signal, forwardSignal);
    const exitCode = await exitPromise;

    return exitCode;
  } finally {
    removeSignalHandlers();
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
    console.log(chalk.dim('WaitLayer beta: supervised wait recorded; rewards are not enabled.'));
  }
}
