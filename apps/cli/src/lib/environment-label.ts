import chalk from 'chalk';

import type { EnvironmentIdentity } from './api-client';
import { canPresentTo } from './presentation-context';

const ENVIRONMENT_KINDS = new Set(['development', 'test', 'sandbox', 'staging', 'production']);

/**
 * Print a sandbox marker only after the API confirms the same environment.
 * A local setting alone is never treated as proof because it can point a
 * client at the wrong deployment.
 */
export async function printSandboxBanner(
  client?: { getEnvironmentIdentity?: () => Promise<EnvironmentIdentity> },
  // `isTTY` is carried alongside the write interface so the presentation gate
  // can be applied without a cast; plain writable sinks simply omit it.
  output: NodeJS.WritableStream & { isTTY?: boolean } = process.stdout,
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
    // The sandbox badge is decorative reassurance for a person reading the
    // terminal. Piped or CI output gets nothing: the badge would corrupt a
    // parsed stream, and no reader is reassured by a line in a build log.
    // The mismatch branch below is a misconfiguration error, not decoration,
    // so it still prints unconditionally.
    if (canPresentTo(output)) writeSandbox(output);
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
