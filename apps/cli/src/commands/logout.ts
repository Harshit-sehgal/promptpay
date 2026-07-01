import chalk from 'chalk';
import { clearCredentials } from '../lib/credentials';

export function runLogout() {
  clearCredentials();
  console.log(chalk.green('✓ Logged out. Tokens cleared.'));
}
