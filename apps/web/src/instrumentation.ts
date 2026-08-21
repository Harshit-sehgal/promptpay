import * as Sentry from '@sentry/nextjs';

import { validateWebEnv } from './lib/web-env';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Deploy preflight: fail a real deploy at boot when the web environment is
    // misconfigured (e.g. cookie security, JWT material, API origin). Gated on
    // ATEVA_REQUIRE_DEPLOY_ENV so local/CI builds are unaffected — the
    // committed web build forces NODE_ENV=production without deploy secrets.
    // Falls back to the pre-rename name; see applyLegacyEnvAliases in @ateva/config.
    const requireDeployEnv =
      process.env.ATEVA_REQUIRE_DEPLOY_ENV ?? process.env.WAITLAYER_REQUIRE_DEPLOY_ENV;
    if (requireDeployEnv === '1') {
      validateWebEnv(process.env);
    }
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Capture Request Errors (App Router Server Components, Middleware, etc.)
export const onRequestError = Sentry.captureRequestError;
