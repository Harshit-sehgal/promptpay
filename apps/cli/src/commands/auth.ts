import chalk from 'chalk';
import { prompt } from '../lib/prompt';
import { setCredentials, getCredentials } from '../lib/credentials';
import { ApiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';

export async function runAuth(opts: { email?: string; signup?: boolean }) {
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

  if (opts.signup) {
    await handleSignup(email, opts);
    return;
  }

  await handleLogin(email);
}

async function handleLogin(email: string) {
  // Password is always prompted interactively — never accepted as a CLI
  // argument so it cannot leak into shell history or /proc/<pid>/cmdline.
  const password = await prompt('Password:', { silent: true });
  if (!password) {
    console.error(chalk.red('Password required'));
    process.exit(1);
  }

  console.log(chalk.dim('Signing in...'));
  const api = new ApiClient();
  try {
    const res = await api.login({ email, password });
    setCredentials({
      email,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      userId: res.user.id,
      role: res.user.role,
    });
    console.log(chalk.green(`✓ Signed in as ${email} (role: ${res.user.role})`));
  } catch (err: unknown) {
    const msg = getErrorMessage(err, 'Login failed');
    console.error(chalk.red(`✗ ${msg}`));
    process.exit(1);
  }
}

async function handleSignup(email: string, _opts: { email?: string }) {
  console.log(chalk.dim(`Creating account for ${email}...`));

  const name = await prompt('Name (optional, press Enter to skip):');
  const password = await prompt('Password (min 8 chars):', { silent: true });
  if (!password || password.length < 8) {
    console.error(chalk.red('Password must be at least 8 characters'));
    process.exit(1);
  }
  const confirmPw = await prompt('Confirm password:', { silent: true });
  if (password !== confirmPw) {
    console.error(chalk.red('Passwords do not match'));
    process.exit(1);
  }

  console.log();
  console.log(chalk.dim('Select account type:'));
  console.log(`  1) ${chalk.bold('Developer')} — Earn from AI wait states`);
  console.log(`  2) ${chalk.bold('Advertiser')} — Run ad campaigns`);
  const roleChoice = await prompt('Choice (1-2) [1]:');
  const role = roleChoice?.trim() === '2' ? 'advertiser' : 'developer';

  const referrerCode = await prompt('Referral code (optional):');

  console.log(chalk.dim('Signing up...'));
  const api = new ApiClient();
  try {
    const res = await api.signup({
      email,
      password,
      role,
      name: name?.trim() || undefined,
      referrerCode: referrerCode?.trim().toUpperCase() || undefined,
    });
    setCredentials({
      email,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      userId: res.user.id,
      role: res.user.role,
    });
    console.log(chalk.green(`✓ Account created! Signed in as ${email} (role: ${res.user.role})`));
    if (res.user.referralCode) {
      console.log(chalk.dim(`  Referral code: ${chalk.cyan(res.user.referralCode)}`));
    }
  } catch (err: unknown) {
    const msg = getErrorMessage(err, 'Signup failed');
    console.error(chalk.red(`✗ ${msg}`));
    process.exit(1);
  }
}
