#!/usr/bin/env node
/**
 * Emit a COMPLETE production `.env` — every value the production config schema
 * requires, with the cryptographic secrets already generated and the
 * operator-supplied values marked with an unmistakable placeholder.
 *
 * Why this exists: `generate-secrets.mjs` produces the secrets, but an operator
 * still had to assemble the other ~20 production-required settings by reading
 * `packages/config/src/index.ts`, `.env.example` and the deployment checklist
 * and hoping they had not missed a refinement. A missed one does not warn — the
 * API refuses to boot (see A-096, and PRIVACY_HASH_KEY, which the generator
 * itself used to omit).
 *
 * The placeholder is deliberately loud and deliberately INVALID: it must fail
 * `deploy:preflight` if it survives to a deploy. Never make it a plausible
 * default — a config file that boots with a value nobody chose is worse than
 * one that refuses to boot.
 *
 *   node scripts/scaffold-production-env.mjs > .env.production
 *   # fill in every FILL_ME, then:
 *   pnpm deploy:preflight
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const PLACEHOLDER = 'FILL_ME';

const secrets = JSON.parse(
  execFileSync(
    process.execPath,
    [new URL('./generate-secrets.mjs', import.meta.url).pathname, '--json'],
    { encoding: 'utf8' },
  ),
);

/** [key, value, comment] — value `null` means operator-supplied. */
const SECTIONS = [
  [
    'Runtime identity',
    [
      ['NODE_ENV', 'production', null],
      ['WAITLAYER_ENVIRONMENT_KIND', 'production', 'Only the real production DB may claim this.'],
      [
        'WAITLAYER_ENVIRONMENT_ID',
        null,
        'Unique id for THIS deployment. Stamped into environment_markers; the API refuses to boot against a database stamped with a different one. That interlock is the point — it catches an API pointed at the wrong database.',
      ],
      ['LOG_LEVEL', 'info', null],
    ],
  ],
  [
    'Infrastructure',
    [
      ['DATABASE_URL', null, 'Managed Postgres, pooled connection.'],
      ['DIRECT_URL', null, 'Unpooled connection for migrations. May equal DATABASE_URL.'],
      ['REDIS_URL', null, 'Required in production: distributed rate limiting + brute-force tracking.'],
      ['API_PORT', '4000', null],
      ['API_BASE_URL', null, 'HTTPS, credential-free, e.g. https://api.waitlayer.com'],
      ['WEB_BASE_URL', null, 'HTTPS, credential-free, e.g. https://www.waitlayer.com'],
      [
        'BFF_TRUST_PROXY_HOPS',
        null,
        'Number of proxies in front of the BFF. WRONG VALUE = WRONG CLIENT IP, which silently breaks rate limiting and brute-force lockout. Count them; do not guess.',
      ],
      ['TRUST_PROXY_HOPS', null, 'Same count for the API.'],
    ],
  ],
  [
    'Signing and encryption (generated — keep secret, back up)',
    [
      ['JWT_PRIVATE_KEY', secrets.JWT_PRIVATE_KEY, 'Single line with literal \\n escapes. Compose and --env-file cannot carry multi-line values (A-097).'],
      ['JWT_PUBLIC_KEY', secrets.JWT_PUBLIC_KEY, 'Must ALSO be a Vercel BUILD variable — Next inlines it; runtime env never reaches middleware (A-083).'],
      ['JWT_SECRET', secrets.JWT_SECRET, 'Refresh-token HMAC + BFF identity signing.'],
      ['TOTP_SECRET_ENCRYPTION_KEY', secrets.TOTP_SECRET_ENCRYPTION_KEY, null],
      ['EMAIL_QUEUE_SECRET', secrets.EMAIL_QUEUE_SECRET, 'Queued email bodies contain reset/verify tokens.'],
      ['PRIVACY_HASH_KEY', secrets.PRIVACY_HASH_KEY, 'Keyed IP pseudonymization; a plain SHA-256 is reversible over IPv4.'],
      ['PAYOUT_ENCRYPTION_KEY', secrets.PAYOUT_ENCRYPTION_KEY, 'AES-256-GCM at rest.'],
      ['PAYOUT_HMAC_KEY', secrets.PAYOUT_HMAC_KEY, 'Must differ from PAYOUT_ENCRYPTION_KEY.'],
    ],
  ],
  [
    'Launch policy (no safe default exists — these are business decisions)',
    [
      ['ALLOWED_COUNTRIES', null, 'Comma-separated ISO-3166-1 alpha-2, e.g. US,GB,CA'],
      ['ALLOWED_CURRENCIES', null, 'Comma-separated ISO-4217, e.g. USD,GBP'],
      ['OPS_ALERT_EMAIL', null, 'Financial and security alerts land here.'],
    ],
  ],
  [
    'Email (required in production — the schema refuses a dev sender)',
    [
      ['EMAIL_DRIVER', 'resend', null],
      ['RESEND_API_KEY', null, 'Without this the API will not boot in production.'],
      ['EMAIL_FROM', null, 'A real verified sender. waitlayer.local / no-reply@waitlayer.dev are rejected.'],
    ],
  ],
  [
    'Security posture (do not weaken)',
    [
      ['PAYOUT_REQUIRE_2FA', 'true', 'Required true in production.'],
      ['PAYOUT_DESTINATION_COOLDOWN_HOURS', '24', 'Minimum 24 in production.'],
      ['COOKIE_SECURE', 'true', null],
      ['SWAGGER_ENABLED', 'false', null],
      ['MOCK_GOOGLE_ENABLED', '0', null],
      ['ALLOW_MOCK_GOOGLE', 'false', null],
    ],
  ],
  [
    'Optional integrations — leave unset until you have credentials',
    [
      ['# GOOGLE_CLIENT_ID', '', 'Only needed for the Google sign-in button.'],
      ['# STRIPE_SECRET_KEY', '', 'Advertiser deposits.'],
      ['# STRIPE_WEBHOOK_SECRET', '', ''],
      ['# PAYPAL_CLIENT_ID', '', 'Recommended first automated payout rail.'],
      ['# PAYPAL_CLIENT_SECRET', '', ''],
      ['# PAYPAL_MODE', '', 'sandbox | live'],
      ['# SENTRY_DSN', '', 'Error monitoring.'],
    ],
  ],
];

const out = [];
out.push('# WaitLayer production environment');
out.push('# Generated by scripts/scaffold-production-env.mjs');
out.push('#');
out.push(`# Every ${PLACEHOLDER} must be replaced before this file can be used.`);
out.push('# Then verify:  pnpm deploy:preflight   (and --with-db after migrations)');
out.push('#');
out.push('# The secrets below are freshly generated and unique to this file.');
out.push('# Store them in your secret manager; losing JWT_PRIVATE_KEY invalidates');
out.push('# every issued token, and losing PAYOUT_ENCRYPTION_KEY makes stored');
out.push('# payout destinations permanently unreadable.');

for (const [title, entries] of SECTIONS) {
  out.push('');
  out.push(`# ── ${title} ${'─'.repeat(Math.max(0, 68 - title.length))}`);
  for (const [key, value, comment] of entries) {
    if (comment) {
      for (const line of wrap(comment, 74)) out.push(`# ${line}`);
    }
    out.push(`${key}=${value === null ? PLACEHOLDER : quoteIfNeeded(value)}`);
  }
}
out.push('');

/**
 * PEMs contain spaces (`-----BEGIN PRIVATE KEY-----`), so an unquoted value
 * word-splits the moment anything `source`s the file — the API then boots with
 * no signing key. This is the repo convention for root `.env` (single line,
 * literal `\n` escapes, double-quoted) and the reason A-097 existed.
 */
function quoteIfNeeded(value) {
  if (value === '') return value;
  if (!/[\s"'#$`\\]/.test(value)) return value;
  return `"${value.replace(/(?<!\\)"/g, '\\"')}"`;
}

function wrap(text, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

process.stdout.write(out.join('\n'));
