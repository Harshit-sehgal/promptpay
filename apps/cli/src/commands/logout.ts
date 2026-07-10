import chalk from 'chalk';

import { clearCredentials } from '../lib/credentials';

export async function runLogout() {
  await clearCredentials();
  console.log(chalk.green('✓ Logged out. Tokens cleared.'));
}
