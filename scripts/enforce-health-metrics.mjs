#!/usr/bin/env node
/**
 * CI health-metrics enforcement script.
 *
 * Creates an ephemeral admin user + session in the test database, signs an
 * RS256 access token, fetches /health/metrics, and fails the build if any
 * ledger discrepancy or provider failure is detected.
 *
 * Usage (from repo root, with API deps available):
 *   pnpm --filter waitlayer-api exec node scripts/enforce-health-metrics.mjs
 *
 * Required env:
 *   DATABASE_URL - Postgres connection string
 *   JWT_PRIVATE_KEY - PEM-encoded RS256 private key
 *   JWT_PUBLIC_KEY - PEM-encoded RS256 public key (optional, derived if omitted)
 *   API_BASE_URL - defaults to http://localhost:4002
 */

import { createPublicKey, createHash, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Anchor bare-specifier resolution to the API package so this script works
// regardless of the cwd it is launched from (pnpm exec / CI / local). pnpm does
// not hoist @nestjs/jwt's `jsonwebtoken` or the workspace @waitlayer/db into the
// repo root node_modules, so resolving from the script's own location would fail.
const apiRequire = createRequire(join(__dirname, '..', 'apps', 'api', 'package.json'));
// `jsonwebtoken` is a transitive dep of @nestjs/jwt (not a direct api dep), so
// resolve it through @nestjs/jwt's own node_modules. @waitlayer/db is a direct
// workspace dep of the api, so it resolves directly.
const jwtPkgPath = apiRequire.resolve('@nestjs/jwt/package.json');
const jwtRequire = createRequire(jwtPkgPath);
const jwt = jwtRequire('jsonwebtoken');
const { PrismaClient, createPrismaAdapter } = apiRequire('@waitlayer/db');

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4002';
const CI_ADMIN_EMAIL = 'ci-admin@waitlayer.com';

/**
 * Derive the JWT `kid` exactly as the API does (sha256 of the PEM public key,
 * first 16 hex chars, input trimmed). The verification strategy is kid-aware,
 * so the CI admin token must carry the same kid the JwtModule would stamp on a
 * real access token. Prefer the configured JWT_PUBLIC_KEY (the exact source the
 * API signs/verifies against) and fall back to deriving the public key from the
 * private key when JWT_PUBLIC_KEY is not supplied.
 */
function deriveKid(privateKeyPem) {
  const pubPem =
    process.env.JWT_PUBLIC_KEY ||
    createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' });
  return createHash('sha256').update(pubPem.trim()).digest('hex').slice(0, 16);
}

function exit(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function main() {
  const privateKey = process.env.JWT_PRIVATE_KEY;
  if (!privateKey) {
    exit('JWT_PRIVATE_KEY is required to sign the CI admin token');
  }

  // Prisma 7 requires a driver adapter (the old `datasources` constructor
  // option was removed). createPrismaAdapter maps DATABASE_URL onto a pg Pool.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    exit('DATABASE_URL is required');
  }
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

  try {
    // Upsert an admin user for CI health checks.
    let user = await prisma.user.findUnique({ where: { email: CI_ADMIN_EMAIL } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: CI_ADMIN_EMAIL,
          name: 'CI Admin',
          role: 'admin',
          status: 'active',
          emailVerified: true,
        },
      });
    }

    if (user.role !== 'admin' && user.role !== 'super_admin') {
      exit(`CI admin user exists but has role ${user.role}, not admin/super_admin`);
    }

    // Create a session row so the JWT strategy accepts the token.
    const sessionId = randomUUID();
    const tokenFamily = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: randomUUID(),
        tokenFamily,
        revoked: false,
        expiresAt,
      },
    });

    // Sign an access token matching the API's JWT strategy expectations.
    // The kid is required: the JwtStrategy resolves the verification key from
    // the token's kid header (supports zero-downtime key rotation).
    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        jti: sessionId,
        // Match the real access-token audience shape: passport-jwt verifies
        // against JWT_AUDIENCE ('waitlayer-client'); the strategy's validate()
        // additionally requires the 'access' audience.
        aud: ['waitlayer-client', 'access'],
        iss: 'waitlayer',
      },
      privateKey,
      { algorithm: 'RS256', expiresIn: '5m', keyid: deriveKid(privateKey) },
    );

    const res = await fetch(`${API_BASE_URL}/api/v1/health/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      exit(`Health metrics request failed: HTTP ${res.status} ${text}`);
    }

    const data = await res.json();

    // Fail on ledger discrepancies.
    if (data.ledgerDiscrepancies?.hasDiscrepancy === true) {
      exit(
        `Ledger discrepancy detected: ${JSON.stringify(data.ledgerDiscrepancies)}`,
      );
    }

    // Fail on provider failures.
    if (data.providerFailures?.total > 0) {
      exit(
        `Provider failures detected: ${JSON.stringify(data.providerFailures)}`,
      );
    }

    console.log('Health metrics passed:', JSON.stringify({
      hasDiscrepancy: data.ledgerDiscrepancies?.hasDiscrepancy,
      providerFailuresTotal: data.providerFailures?.total,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => exit(err instanceof Error ? err.message : err));
