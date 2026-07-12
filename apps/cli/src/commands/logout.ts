import chalk from 'chalk';

import { ApiClient } from '../lib/api-client';
import { clearCredentials, getCredentials } from '../lib/credentials';

export async function runLogout() {
  // Best-effort server-side session revocation. The access token may already
  // be expired, but we still attempt POST /auth/logout so the jti session row
  // is revoked server-side. Any failure (network, expired token) is swallowed
  // — local cleanup runs unconditionally, so the user's secrets are always
  // wiped regardless of server state.
  const creds = await getCredentials();
  if (creds) {
    const api = new ApiClient(creds);
    try {
      await api.logout();
    } catch {
      // Server revoke failed — token may be expired or network down.
      // Local cleanup proceeds anyway.
    }
  }

  await clearCredentials();
  console.log(chalk.green('✓ Logged out. Tokens cleared.'));
}
