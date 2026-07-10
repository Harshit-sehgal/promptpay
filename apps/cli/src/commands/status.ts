import chalk from 'chalk';

import { ApiClient } from '../lib/api-client';
import { getCredentials } from '../lib/credentials';
import { getErrorMessage, getErrorStatus } from '../lib/errors';
import { formatCurrency } from '../lib/format';

export async function runStatus(opts: { period?: string }) {
  const creds = await getCredentials();
  if (!creds) {
    console.error(chalk.red('Not logged in. Run `waitlayer auth` first.'));
    process.exit(1);
  }

  const api = new ApiClient(creds);
  const _period = opts.period ?? '7d';

  try {
    const [balance, overview] = await Promise.all([api.getBalance(), api.getOverview()]);

    console.log();
    console.log(chalk.bold.cyan('WaitLayer Status'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log();
    console.log(`${chalk.dim('Account:')}        ${creds.email}`);
    console.log(`${chalk.dim('Role:')}           ${creds.role}`);
    console.log();
    console.log(chalk.bold('Earnings'));
    console.log(`  Available:  ${chalk.green.bold(formatCurrency(balance.available.amountMinor))}`);
    console.log(`  Pending:    ${chalk.yellow(formatCurrency(balance.pending.amountMinor))}`);
    console.log(`  Lifetime:   ${formatCurrency(balance.total.amountMinor)}`);
    console.log(`  Paid out:   ${formatCurrency(balance.paidOut.amountMinor)}`);
    console.log();

    console.log(chalk.bold(`Account Summary`));
    console.log(
      `  Est. Earnings:  ${chalk.green.bold(formatCurrency(overview.estimatedEarnings))}`,
    );
    console.log(`  Confirmed:      ${chalk.yellow(formatCurrency(overview.confirmedEarnings))}`);
    console.log(`  Pending:        ${chalk.yellow(formatCurrency(overview.pendingEarnings))}`);
    console.log(`  Lifetime:       ${formatCurrency(overview.lifetimeEarnings)}`);
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
