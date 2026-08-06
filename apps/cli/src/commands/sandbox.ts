import chalk from 'chalk';
import { randomUUID } from 'node:crypto';

import { ApiClient } from '../lib/api-client';
import { getCredentials } from '../lib/credentials';
import { getErrorMessage } from '../lib/errors';

type SandboxOptions = {
  idempotencyKey?: string;
  amountMinor?: string;
  destinationAlias?: string;
  outcome?: 'paid' | 'processing' | 'failed' | 'ambiguous' | 'reversed';
};

async function clientForSandbox(): Promise<ApiClient | null> {
  const creds = await getCredentials();
  if (!creds) {
    console.error(chalk.red('Not logged in. Run `waitlayer auth` first.'));
    process.exitCode = 1;
    return null;
  }
  const api = new ApiClient(creds);
  const identity = await api.getEnvironmentIdentity();
  if (identity.environmentKind !== 'sandbox' && identity.environmentKind !== 'test') {
    console.error(
      chalk.red(
        `Sandbox commands require a sandbox/test API; server is ${identity.environmentKind}.`,
      ),
    );
    process.exitCode = 1;
    return null;
  }
  return api;
}

export async function runSandboxFaucet(options: SandboxOptions = {}) {
  const api = await clientForSandbox();
  if (!api) return;
  try {
    const result = await api.claimSandboxFaucet(
      options.idempotencyKey ?? `cli-faucet-${randomUUID()}`,
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    console.error(chalk.red(`Sandbox faucet failed: ${getErrorMessage(error)}`));
    process.exitCode = 1;
  }
}

export async function runSandboxPayout(options: SandboxOptions) {
  const api = await clientForSandbox();
  if (!api) return;
  const amountMinor = Number(options.amountMinor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 100_000) {
    console.error(chalk.red('--amount-minor must be an integer from 1 to 100000.'));
    process.exitCode = 1;
    return;
  }
  if (!options.destinationAlias?.startsWith('sandbox:')) {
    console.error(chalk.red('--destination must be a sandbox:<alias> value.'));
    process.exitCode = 1;
    return;
  }
  try {
    const result = await api.simulateSandboxPayout({
      amountMinor,
      destinationAlias: options.destinationAlias,
      outcome: options.outcome ?? 'paid',
      idempotencyKey: options.idempotencyKey ?? `cli-payout-${randomUUID()}`,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    console.error(chalk.red(`Sandbox payout failed: ${getErrorMessage(error)}`));
    process.exitCode = 1;
  }
}

export async function runSandboxStatus() {
  const api = await clientForSandbox();
  if (!api) return;
  try {
    console.log(JSON.stringify(await api.getSandboxCredits(), null, 2));
    console.log(JSON.stringify(await api.listSandboxPayouts(), null, 2));
  } catch (error: unknown) {
    console.error(chalk.red(`Sandbox status failed: ${getErrorMessage(error)}`));
    process.exitCode = 1;
  }
}
