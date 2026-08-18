import chalk from 'chalk';
import { randomUUID } from 'node:crypto';

import { ApiClient, type SandboxPayoutOutcome } from '../lib/api-client';
import { getCredentials } from '../lib/credentials';
import { getErrorMessage } from '../lib/errors';
import { parseMinor } from '../lib/format';

type SandboxAction = 'faucet' | 'payout' | 'status';

export type SandboxOptions = {
  action?: string;
  idempotencyKey?: string;
  amountMinor?: string;
  destinationAlias?: string;
  outcome?: SandboxPayoutOutcome;
};

const SANDBOX_OUTCOMES: readonly SandboxPayoutOutcome[] = [
  'paid',
  'processing',
  'failed',
  'ambiguous',
  'reversed',
  'callback_before_response',
  'duplicate_callback',
  'timeout',
  'reconciliation_escalation',
];

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

export async function runSandbox(options: SandboxOptions = {}): Promise<void> {
  const action = normalizeAction(options.action);
  if (!action) {
    console.error(chalk.red('Unknown sandbox action. Use faucet, payout, or status.'));
    process.exitCode = 1;
    return;
  }

  if (action === 'payout') {
    const amountMinor = parseSandboxAmount(options.amountMinor);
    if (amountMinor === null) {
      console.error(chalk.red('--amount-minor must be an integer from 1 to 100000.'));
      process.exitCode = 1;
      return;
    }
    if (!isSandboxDestination(options.destinationAlias)) {
      console.error(chalk.red('--destination must be a sandbox:<alias> value.'));
      process.exitCode = 1;
      return;
    }
    if (!isSandboxOutcome(options.outcome)) {
      console.error(chalk.red(`--outcome must be one of: ${SANDBOX_OUTCOMES.join(', ')}.`));
      process.exitCode = 1;
      return;
    }

    await withSandboxClient(async (api) => {
      const result = await api.simulateSandboxPayout({
        amountMinor,
        destinationAlias: options.destinationAlias as string,
        outcome: options.outcome as SandboxPayoutOutcome,
        idempotencyKey: options.idempotencyKey ?? `cli-payout-${randomUUID()}`,
      });
      printJson(result);
    });
    return;
  }

  await withSandboxClient(async (api) => {
    if (action === 'faucet') {
      const result = await api.claimSandboxFaucet(
        options.idempotencyKey ?? `cli-faucet-${randomUUID()}`,
      );
      printJson(result);
      return;
    }

    const [credits, payouts] = await Promise.all([
      api.getSandboxCredits(),
      api.listSandboxPayouts(),
    ]);
    printJson({ credits, payouts });
  });
}

async function withSandboxClient(work: (api: ApiClient) => Promise<void>): Promise<void> {
  try {
    const api = await clientForSandbox();
    if (api) await work(api);
  } catch (error: unknown) {
    console.error(chalk.red(`Sandbox command failed: ${getErrorMessage(error)}`));
    process.exitCode = 1;
  }
}

function normalizeAction(action: string | undefined): SandboxAction | null {
  const normalized = action ?? 'status';
  return normalized === 'faucet' || normalized === 'payout' || normalized === 'status'
    ? normalized
    : null;
}

function parseSandboxAmount(value: string | undefined): number | null {
  if (!value) return null;
  try {
    const amountMinor = parseMinor(value);
    if (amountMinor < 1n || amountMinor > 100_000n) return null;
    // The API DTO intentionally accepts a number and caps sandbox amounts at
    // 100000; conversion is exact only after the bigint bounds check above.
    return Number(amountMinor);
  } catch {
    return null;
  }
}

function isSandboxDestination(value: string | undefined): value is string {
  return Boolean(value && value.length <= 80 && /^sandbox:[A-Za-z0-9._:-]+$/.test(value));
}

function isSandboxOutcome(value: string | undefined): value is SandboxPayoutOutcome {
  return Boolean(value && SANDBOX_OUTCOMES.includes(value as SandboxPayoutOutcome));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
