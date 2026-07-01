import chalk from 'chalk';
import { getCredentials } from '../lib/credentials';
import { ApiClient } from '../lib/api-client';
import { formatCurrency, formatNumber } from '../lib/format';

export async function runStatus(opts: { period?: string }) {
  const creds = getCredentials();
  if (!creds) {
    console.error(chalk.red('Not logged in. Run `waitlayer auth` first.'));
    process.exit(1);
  }

  const api = new ApiClient(creds);
  const period = opts.period ?? '7d';

  try {
    const [balance, overview] = await Promise.all([
      api.getBalance(),
      api.getOverview(),
    ]);

    console.log();
    console.log(chalk.bold.cyan('WaitLayer Status'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log();
    console.log(`${chalk.dim('Account:')}        ${creds.email}`);
    console.log(`${chalk.dim('Role:')}           ${creds.role}`);
    console.log();
    console.log(chalk.bold('Earnings'));
    console.log(`  Available:  ${chalk.green.bold(formatCurrency(balance.availableMinor))}`);
    console.log(`  Pending:    ${chalk.yellow(formatCurrency(balance.pendingMinor))}`);
    console.log(`  Lifetime:   ${formatCurrency(balance.totalMinor)}`);
    console.log(`  Paid out:   ${formatCurrency(balance.paidOutMinor)}`);
    console.log();

    console.log(chalk.bold(`Last ${period}`));
    console.log(`  Impressions:  ${chalk.cyan(formatNumber(overview.impressions))}`);
    console.log(`  Clicks:       ${chalk.cyan(formatNumber(overview.clicks))}`);
    console.log(`  Estimated:    ${chalk.cyan(formatCurrency(overview.estimatedMinor))}`);
    console.log();
  } catch (err: any) {
    if (err?.status === 401) {
      console.error(chalk.red('Session expired. Run `waitlayer auth` again.'));
    } else {
      console.error(chalk.red(`Failed to load status: ${err?.message}`));
    }
    process.exit(1);
  }
}
