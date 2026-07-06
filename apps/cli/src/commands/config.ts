import chalk from 'chalk';
import { getCredentials } from '../lib/credentials';
import { ApiClient } from '../lib/api-client';
import { getErrorMessage, getErrorStatus } from '../lib/errors';
import { prompt } from '../lib/prompt';

export async function runConfig() {
  const creds = getCredentials();
  if (!creds) {
    console.error(chalk.red('Not logged in. Run `waitlayer auth` first.'));
    process.exit(1);
  }

  const api = new ApiClient(creds);

  try {
    const settings = await api.getSettings();

    console.log();
    console.log(chalk.bold.cyan('WaitLayer Settings'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log();
    console.log(`  ${chalk.dim('Ads enabled:')}     ${settings.adsEnabled ? chalk.green('✓ yes') : chalk.red('✗ no')}`);
    console.log(`  ${chalk.dim('Quiet mode:')}       ${settings.quietMode ? chalk.yellow(`on (${settings.quietModeStart ?? '22:00'}–${settings.quietModeEnd ?? '08:00'})`) : chalk.dim('off')}`);
    console.log(`  ${chalk.dim('Max ads/hour:')}     ${settings.maxAdsPerHour ?? 6}`);
    console.log(`  ${chalk.dim('Referral code:')}    ${settings.referralCode ? chalk.cyan(settings.referralCode) : chalk.dim('none')}`);
    console.log(`  ${chalk.dim('Email:')}            ${settings.email}`);
    if (settings.displayName) {
      console.log(`  ${chalk.dim('Name:')}            ${settings.displayName}`);
    }
    console.log();

    // ── Interactive update menu ──
    console.log(chalk.bold('Options'));
    console.log(`  1) ${settings.adsEnabled ? 'Disable' : 'Enable'} ads`);
    console.log(`  2) Toggle quiet mode`);
    console.log(`  3) Change max ads per hour (current: ${settings.maxAdsPerHour ?? 6})`);
    console.log(`  4) Return`);
    console.log();

    const choice = await prompt('Select an option (1-4):');
    if (!choice) return;

    switch (choice.trim()) {
      case '1': {
        const updated = await api.updateSettings({ adsEnabled: !settings.adsEnabled });
        console.log(chalk.green(`✓ Ads ${updated.adsEnabled ? 'enabled' : 'disabled'}.`));
        break;
      }
      case '2': {
        const newQuietMode = !settings.quietMode;
        const updatePayload: Record<string, unknown> = { quietMode: newQuietMode };

        if (newQuietMode) {
          const start = await prompt('Quiet mode start (HH:MM) [22:00]:');
          const end = await prompt('Quiet mode end (HH:MM) [08:00]:');
          updatePayload.quietModeStart = start || '22:00';
          updatePayload.quietModeEnd = end || '08:00';
        }

        const updated = await api.updateSettings(updatePayload);
        if (updated.quietMode) {
          console.log(chalk.green(`✓ Quiet mode on (${updated.quietModeStart ?? '22:00'}–${updated.quietModeEnd ?? '08:00'}).`));
        } else {
          console.log(chalk.green('✓ Quiet mode off.'));
        }
        break;
      }
      case '3': {
        const raw = await prompt(`Max ads per hour (1–12, current: ${settings.maxAdsPerHour ?? 6}):`);
        const num = parseInt(raw, 10);
        if (isNaN(num) || num < 1 || num > 12) {
          console.error(chalk.red('Enter a number between 1 and 12.'));
          process.exit(1);
        }
        await api.updateSettings({ maxAdsPerHour: num });
        console.log(chalk.green(`✓ Max ads per hour set to ${num}.`));
        break;
      }
      case '4':
        console.log(chalk.dim('Returning...'));
        return;
      default:
        console.error(chalk.red('Invalid option.'));
    }

    // Loop back to menu for further changes
    console.log();
    await runConfig();
  } catch (err: unknown) {
    if (getErrorStatus(err) === 401) {
      console.error(chalk.red('Session expired. Run `waitlayer auth` again.'));
    } else {
      console.error(chalk.red(`Failed to load settings: ${getErrorMessage(err, 'request failed')}`));
    }
    process.exit(1);
  }
}
