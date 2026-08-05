import chalk from 'chalk';

import { getBridgeStatus, startAgentBridge } from '../lib/agent-bridge';
import { clearAgentEventSpool, getSpoolPaths, readSpoolStatus } from '../lib/agent-spool';
import { getCredentials } from '../lib/credentials';

export async function runBridge(options: { action?: string } = {}) {
  const action = options.action ?? 'status';
  const paths = getSpoolPaths();

  if (action === 'status') {
    const status = await getBridgeStatus(paths);
    printStatus(status);
    return;
  }

  if (action === 'clear') {
    clearAgentEventSpool(paths);
    console.log(chalk.green('✓ Local agent event spool cleared.'));
    return;
  }

  const creds = await getCredentials();
  if (!creds) {
    throw new Error('Not logged in. Run `waitlayer auth` first.');
  }

  if (action === 'flush') {
    const bridge = await startAgentBridge({ credentials: creds, paths });
    try {
      const result = await bridge.flush();
      console.log(
        chalk.green(
          `✓ Flushed ${result.accepted + result.duplicates} events (${result.rejected} quarantined).`,
        ),
      );
    } finally {
      await bridge.stop();
    }
    return;
  }

  if (action === 'start') {
    const bridge = await startAgentBridge({
      credentials: creds,
      paths,
      onError: (error) => console.warn(chalk.yellow(`WaitLayer bridge: ${String(error)}`)),
    });
    console.log(chalk.green(`✓ WaitLayer bridge listening on ${paths.bridgeSocket}`));
    console.log(chalk.dim('Press Ctrl-C to stop.'));
    await new Promise<void>((resolve) => {
      const stop = () => {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
        resolve();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    await bridge.stop();
    return;
  }

  throw new Error(`Unknown bridge action: ${action}. Use start, status, flush, or clear.`);
}

function printStatus(status: Awaited<ReturnType<typeof getBridgeStatus>>) {
  console.log(chalk.bold.cyan('WaitLayer Local Bridge'));
  console.log(
    `  ${chalk.dim('Running:')} ${status.running ? chalk.green('yes') : chalk.yellow('no')}`,
  );
  console.log(`  ${chalk.dim('Queued:')} ${status.queuedEvents}`);
  console.log(`  ${chalk.dim('In flight:')} ${status.inFlightEvents}`);
  console.log(`  ${chalk.dim('Quarantined:')} ${status.quarantinedEvents}`);
  console.log(`  ${chalk.dim('Storage:')} ${status.bytes} bytes`);
  if (status.oldestEventAt) console.log(`  ${chalk.dim('Oldest event:')} ${status.oldestEventAt}`);
  console.log(`  ${chalk.dim('Socket:')} ${status.socket}`);
}

// Keep the status helper exported for command-level tests without exposing
// storage internals from the CLI entrypoint.
export function getBridgeSpoolStatus() {
  return readSpoolStatus(getSpoolPaths());
}
