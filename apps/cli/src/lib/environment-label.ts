import chalk from 'chalk';

import type { EnvironmentIdentity } from './api-client';

const ENVIRONMENT_KINDS = new Set(['development', 'test', 'sandbox', 'staging', 'production']);

/**
 * Print a sandbox marker only after the API confirms the same environment.
 * A local setting alone is never treated as proof because it can point a
 * client at the wrong deployment.
 */
export async function printSandboxBanner(
  client?: { getEnvironmentIdentity?: () => Promise<EnvironmentIdentity> },
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const localKind = process.env.ATEVA_ENVIRONMENT_KIND ?? process.env.WAITLAYER_ENVIRONMENT_KIND;
  const getIdentity = client?.getEnvironmentIdentity;
  if (typeof getIdentity !== 'function') return;

  let serverKind: string | undefined;
  try {
    serverKind = (await getIdentity.call(client)).environmentKind;
  } catch {
    if (localKind === 'sandbox') {
      output.write(
        `${chalk.bgYellow.black(' ENVIRONMENT UNVERIFIED ')} ${chalk.yellow('Local sandbox setting was not confirmed by the API')}\n`,
      );
    }
    return;
  }

  if (serverKind === 'sandbox' && (!localKind || localKind === 'sandbox')) {
    writeSandbox(output);
  } else if (localKind && localKind !== serverKind && ENVIRONMENT_KINDS.has(serverKind)) {
    output.write(
      `${chalk.bgRed.white(' ENVIRONMENT MISMATCH ')} ${chalk.red(`client=${localKind ?? 'unset'} server=${serverKind}`)}\n`,
    );
  }
}

function writeSandbox(output: NodeJS.WritableStream): void {
  output.write(
    `${chalk.bgYellow.black(' SANDBOX ')} ${chalk.yellow('Test credits only — no cash value')}\n`,
  );
}
