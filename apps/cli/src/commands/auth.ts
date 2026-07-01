import chalk from 'chalk';
import { prompt } from '../lib/prompt';
import { setCredentials, getCredentials } from '../lib/credentials';
import { ApiClient } from '../lib/api-client';

export async function runAuth(opts: { email?: string; password?: string }) {
  const existing = getCredentials();
  if (existing) {
    console.log(chalk.green(`Already logged in as ${existing.email}`));
    console.log(chalk.dim('Run `waitlayer logout` to switch accounts.'));
    return;
  }

  let email = opts.email;
  if (!email) {
    email = await prompt('Email:');
    if (!email) {
      console.error(chalk.red('Email required'));
      process.exit(1);
    }
  }

  let password = opts.password;
  if (!password) {
    password = await prompt('Password:', { silent: true });
    if (!password) {
      console.error(chalk.red('Password required'));
      process.exit(1);
    }
  }

  console.log(chalk.dim('Signing in...'));
  const api = new ApiClient();
  try {
    const res = await api.login({ email: email!, password: password! });
    setCredentials({
      email: email!,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      userId: res.user.id,
      role: res.user.role,
    });
    console.log(chalk.green(`✓ Signed in as ${email} (role: ${res.user.role})`));
  } catch (err: any) {
    const msg = err?.message ?? 'Login failed';
    console.error(chalk.red(`✗ ${msg}`));
    process.exit(1);
  }
}
