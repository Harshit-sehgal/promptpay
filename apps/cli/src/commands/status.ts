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

function primaryDisplayCurrency(
  total: CurrencyAmount,
  lifetimeByCurrency?: Record<string, bigint>,
): string {
  const totals = total.byCurrency ?? lifetimeByCurrency;
  if (!totals) return total.currency;

  let currency = total.currency;
  let largestAmount = 0n;
  for (const [candidate, amountMinor] of Object.entries(totals)) {
    if (amountMinor > largestAmount) {
      currency = candidate;
      largestAmount = amountMinor;
    }
  }
  return currency;
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
    const displayCurrency = primaryDisplayCurrency(
      balance.total,
      overview.lifetimeEarningsByCurrency,
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
