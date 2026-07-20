import chalk from 'chalk';

import { ApiClient } from '../lib/api-client';
import { getCredentials } from '../lib/credentials';
import { getErrorMessage, getErrorStatus } from '../lib/errors';
import { formatCurrency } from '../lib/format';

interface CurrencyAmount {
  amountMinor: bigint;
  currency: string;
  byCurrency?: Record<string, bigint>;
}

/**
 * Deterministic, non-magnitude display-currency selection.
 *
 * Cross-currency comparison of RAW minor-unit values is meaningless: 100 JPY
 * minor (¥100) is not "smaller" than 100 USD cents ($1.00). The prior
 * implementation picked the currency with the LARGEST raw minor value, which
 * produced wildly wrong display currencies for multi-currency balances.
 *
 * We mirror `@waitlayer/shared#primaryCurrency` here rather than importing it:
 * the CLI deliberately avoids a dependency on the shared package (see
 * `format.ts`, which duplicates `minorUnitExponent`/`parseMinor` for the same
 * reason). The rule is identical — the first currency carrying a positive
 * balance, in ascending ISO-4217 order — so behavior stays consistent with
 * the server and the VS Code extension without pulling the shared bundle into
 * the CLI binary.
 */
function primaryCurrency(totals: Record<string, bigint>): string {
  const codes = Object.keys(totals).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const currency of codes) {
    if (totals[currency] > 0n) return currency;
  }
  return 'USD';
}

/**
 * Pick the currency to render the balance summary in.
 * Prefers a `byCurrency` map (when at least one currency is positive) and
 * falls back to the legacy scalar currency otherwise. Never compares raw
 * minor-unit magnitudes across currencies.
 */
function selectDisplayCurrency(
  byCurrency: Record<string, bigint> | undefined,
  fallbackCurrency: string,
): string {
  if (byCurrency && Object.keys(byCurrency).length > 0) {
    // Only override the scalar when at least one currency has a positive
    // balance; an all-zero/empty map has no meaningful "primary" and we must
    // not force 'USD' on a user whose scalar currency is something else.
    const hasPositive = Object.values(byCurrency).some((v) => v > 0n);
    if (hasPositive) return primaryCurrency(byCurrency);
  }
  return fallbackCurrency;
}

function balanceAmountForCurrency(amount: CurrencyAmount, currency: string): bigint {
  if (amount.byCurrency) return amount.byCurrency[currency] ?? 0n;
  return amount.currency === currency ? amount.amountMinor : 0n;
}

function overviewAmountForCurrency(
  byCurrency: Record<string, bigint> | undefined,
  legacyAmount: bigint,
  currency: string,
): bigint {
  return byCurrency ? (byCurrency[currency] ?? 0n) : legacyAmount;
}

export async function runStatus() {
  const creds = await getCredentials();
  if (!creds) {
    console.error(chalk.red('Not logged in. Run `waitlayer auth` first.'));
    process.exit(1);
  }

  const api = new ApiClient(creds);

  try {
    const [balance, overview] = await Promise.all([api.getBalance(), api.getOverview()]);
    const displayCurrency = selectDisplayCurrency(
      balance.total.byCurrency ?? overview.lifetimeEarningsByCurrency,
      balance.total.currency,
    );

    console.log();
    console.log(chalk.bold.cyan('WaitLayer Status'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log();
    console.log(`${chalk.dim('Account:')}        ${creds.email}`);
    console.log(`${chalk.dim('Role:')}           ${creds.role}`);
    console.log();
    console.log(chalk.bold('Earnings'));
    console.log(
      `  Available:  ${chalk.green.bold(formatCurrency(balanceAmountForCurrency(balance.available, displayCurrency), displayCurrency))}`,
    );
    console.log(
      `  Pending:    ${chalk.yellow(formatCurrency(balanceAmountForCurrency(balance.pending, displayCurrency), displayCurrency))}`,
    );
    console.log(
      `  Lifetime:   ${formatCurrency(balanceAmountForCurrency(balance.total, displayCurrency), displayCurrency)}`,
    );
    console.log(
      `  Paid out:   ${formatCurrency(balanceAmountForCurrency(balance.paidOut, displayCurrency), displayCurrency)}`,
    );
    console.log();

    console.log(chalk.bold(`Account Summary`));
    console.log(
      `  Est. Earnings:  ${chalk.green.bold(formatCurrency(overviewAmountForCurrency(overview.estimatedEarningsByCurrency, overview.estimatedEarnings, displayCurrency), displayCurrency))}`,
    );
    console.log(
      `  Confirmed:      ${chalk.yellow(formatCurrency(overviewAmountForCurrency(overview.confirmedEarningsByCurrency, overview.confirmedEarnings, displayCurrency), displayCurrency))}`,
    );
    console.log(
      `  Pending:        ${chalk.yellow(formatCurrency(overviewAmountForCurrency(overview.pendingEarningsByCurrency, overview.pendingEarnings, displayCurrency), displayCurrency))}`,
    );
    console.log(
      `  Lifetime:       ${formatCurrency(overviewAmountForCurrency(overview.lifetimeEarningsByCurrency, overview.lifetimeEarnings, displayCurrency), displayCurrency)}`,
    );
    console.log(`  Trust Level:    ${overview.trustLevel}`);
    if (overview.trustScore) console.log(`  Trust Score:    ${overview.trustScore}`);
    console.log();
  } catch (err: unknown) {
    if (getErrorStatus(err) === 401) {
      console.error(chalk.red('Session expired. Run `waitlayer auth` again.'));
    } else {
      console.error(chalk.red(`Failed to load status: ${getErrorMessage(err, 'request failed')}`));
    }
    process.exit(1);
  }
}
