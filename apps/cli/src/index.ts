import { Command } from 'commander';
import { runAuth } from './commands/auth';
import { runStatus } from './commands/status';
import { runWatch } from './commands/watch';
import { runLogout } from './commands/logout';

const program = new Command();
program
  .name('waitlayer')
  .description('WaitLayer CLI — track AI wait states and earn rewards')
  .version('0.0.1');

program
  .command('auth')
  .description('Authenticate with WaitLayer (saves token locally)')
  .option('-e, --email <email>', 'Login email')
  .option('-p, --password <password>', 'Login password (omit to be prompted)')
  .action((opts) => runAuth(opts));

program
  .command('status')
  .description('Show current earnings and wait state stats')
  .option('--period <period>', 'Period: 1d | 7d | 30d', '7d')
  .action((opts) => runStatus(opts));

program
  .command('watch')
  .description('Run daemon that reports wait states in real time')
  .option('--once', 'Report existing wait state once and exit (test mode)')
  .action((opts) => runWatch(opts));

program
  .command('logout')
  .description('Remove stored credentials')
  .action(() => runLogout());

program.parse();
