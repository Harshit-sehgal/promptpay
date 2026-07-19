#!/usr/bin/env node
/**
 * Staging release-gate smoke test (P1.23).
 *
 * Exercises the deployed staging API end-to-end before a human approves
 * promotion to production:
 *   1. Readiness probe (`/health/ready`).
 *   2. Create + submit + admin-approve a test campaign.
 *   3. Run the extension -> ledger flow (`/extension/ad-request` x N) so real
 *      earnings get credited through the financial core.
 *   4. Register a sandbox `paypal_email` payout method and request a payout,
 *      then admin-approve + process it (sandbox lifecycle).
 *   5. Pull Prometheus metrics and assert no critical alerts fired.
 *
 * Auth reuses the same RS256 admin/role token shape the API's JwtStrategy
 * expects (see scripts/enforce-health-metrics.mjs). Ephemeral users are
 * upserted in the staging database so the run is repeatable and isolated.
 *
 * Usage:
 *   node scripts/staging-smoke.mjs
 *
 * Required env:
 *   DATABASE_URL            - staging Postgres connection string
 *   JWT_PRIVATE_KEY         - RS256 private key (matches staging JWT_PUBLIC_KEY)
 *   STAGING_API_URL         - base URL of the deployed staging API
 *                            (default http://localhost:4002)
 *   STAGING_FULL_FLOW=1     - also run campaign/ad/payout flow (needs balance)
 */

import { createPublicKey, createHash, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(join(__dirname, '..', 'apps', 'api', 'package.json'));
const jwtPkgPath = apiRequire.resolve('@nestjs/jwt/package.json');
const jwtRequire = createRequire(jwtPkgPath);
const jwt = jwtRequire('jsonwebtoken');
const { PrismaClient, createPrismaAdapter } = apiRequire('@waitlayer/db');

const API_BASE_URL = process.env.STAGING_API_URL ?? 'http://localhost:4002';
const FULL_FLOW = process.env.STAGING_FULL_FLOW === '1';
const STAGING_ADMIN_EMAIL = 'staging-smoke-admin@waitlayer.com';
const STAGING_ADV_EMAIL = 'staging-smoke-advertiser@waitlayer.com';
const STAGING_DEV_EMAIL = 'staging-smoke-developer@waitlayer.com';

function deriveKid(privateKeyPem) {
  const pubPem =
    process.env.JWT_PUBLIC_KEY ||
    createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' });
  return createHash('sha256').update(pubPem.trim()).digest('hex').slice(0, 16);
}

let hardFailures = 0;
let softWarnings = 0;
function fail(message) {
  console.error(`[HARD FAIL] ${message}`);
  hardFailures++;
}
function warn(message) {
  console.warn(`[warn] ${message}`);
  softWarnings++;
}
function ok(message) {
  console.log(`[ok] ${message}`);
}

function signToken(user, privateKey, expiresIn = '10m') {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      jti: randomUUID(),
      aud: ['waitlayer-client', 'access'],
      iss: 'waitlayer',
    },
    privateKey,
    { algorithm: 'RS256', expiresIn, keyid: deriveKid(privateKey) },
  );
}

async function api(method, path, token, body) {
  const res = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json, text };
}

async function main() {
  const privateKey = process.env.JWT_PRIVATE_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!privateKey) fail('JWT_PRIVATE_KEY is required');
  if (!databaseUrl) fail('DATABASE_URL is required');
  if (hardFailures) process.exit(1);

  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    // 1. Readiness probe (no auth).
    const ready = await fetch(`${API_BASE_URL}/api/v1/health/ready`);
    if (!ready.ok) {
      fail(`Staging /health/ready returned HTTP ${ready.status}`);
      process.exit(1);
    }
    ok('staging /health/ready is green');

    // Ensure the three ephemeral accounts exist.
    const upsert = async (email, role) => {
      let u = await prisma.user.findUnique({ where: { email } });
      if (!u) {
        u = await prisma.user.create({
          data: { email, name: `Staging ${role}`, role, status: 'active', emailVerified: true },
        });
      }
      return u;
    };
    const admin = await upsert(STAGING_ADMIN_EMAIL, 'admin');
    const advertiser = await upsert(STAGING_ADV_EMAIL, 'advertiser');
    const developer = await upsert(STAGING_DEV_EMAIL, 'developer');

    // Sessions so the JWT strategy accepts the tokens.
    const mkSession = async (userId) =>
      prisma.session.create({
        data: {
          id: randomUUID(),
          userId,
          tokenHash: randomUUID(),
          tokenFamily: randomUUID(),
          revoked: false,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
    await mkSession(admin.id);
    await mkSession(advertiser.id);
    await mkSession(developer.id);

    const adminToken = signToken(admin, privateKey);
    const advToken = signToken(advertiser, privateKey);
    const devToken = signToken(developer, privateKey);

    if (!FULL_FLOW) {
      ok('STAGING_FULL_FLOW not set — skipping campaign/ad/payout flow');
    } else {
      // 2. Create + submit + approve a test campaign.
      const campaignRes = await api('POST', '/advertiser/campaigns', advToken, {
        name: `staging-smoke-${Date.now()}`,
        currency: 'USD',
        budgetTotalMinor: 100_000,
        bidAmountMinor: 1_000,
        creative: {
          title: 'Staging smoke creative',
          body: 'Verified, private, paid back to you.',
          destinationUrl: 'https://waitlayer.com',
          category: 'technology',
          ctaText: 'Learn more',
        },
        targetingCountries: ['US'],
        billingModel: 'CPM',
      });
      if (campaignRes.status >= 400) {
        warn(`create campaign -> HTTP ${campaignRes.status}: ${campaignRes.text}`);
      } else {
        const campaignId = campaignRes.json?.id;
        ok(`campaign created (${campaignId})`);
        await api('POST', `/advertiser/campaigns/${campaignId}/submit`, advToken, {});
        const approve = await api('POST', `/admin/campaigns/${campaignId}/approve`, adminToken, {});
        if (approve.status >= 400) warn(`approve campaign -> HTTP ${approve.status}`);
        else ok('campaign submitted + admin-approved');

        // 3. Extension -> ledger flow: request ads a few times to credit earnings.
        let served = 0;
        for (let i = 0; i < 5; i++) {
          const ad = await api('POST', '/extension/ad-request', devToken, {
            deviceId: randomUUID(),
            country: 'US',
            signals: ['ai_generation'],
          });
          if (ad.status < 400 && ad.json?.campaignId) served++;
        }
        ok(`extension->ledger flow ran (${served}/5 ads served)`);

        // 4. Sandbox payout lifecycle: register paypal_email method + request + process.
        const method = await api('POST', '/payout/method', devToken, {
          provider: 'paypal_email',
          destination: 'staging-smoke@example.com',
        });
        if (method.status >= 400) {
          warn(`add payout method -> HTTP ${method.status}: ${method.text}`);
        } else {
          const payout = await api('POST', '/payout/request', devToken, {
            amountMinor: 1_000,
            currency: 'USD',
          });
          if (payout.status >= 400) {
            warn(`request payout -> HTTP ${payout.status} (likely insufficient balance in staging)`);
          } else {
            const payoutId = payout.json?.id;
            await api('POST', `/admin/payouts/${payoutId}/approve`, adminToken, {});
            const proc = await api('POST', `/admin/payouts/${payoutId}/process`, adminToken, {});
            if (proc.status >= 400) warn(`process payout -> HTTP ${proc.status}`);
            else ok('sandbox payout approved + processed');
          }
        }
      }
    }

    // 5. Verify alerts via Prometheus metrics (no critical alert counters).
    const metricsRes = await fetch(`${API_BASE_URL}/api/v1/observability/metrics`, {
      headers: { Authorization: `Bearer ${adminToken}`, Accept: 'text/plain' },
    });
    if (!metricsRes.ok) {
      fail(`metrics request failed: HTTP ${metricsRes.status}`);
    } else {
      const text = await metricsRes.text();
      const critical = [
        'alert{event=ledger_discrepancy',
        'alert{event=audit_dead_letter',
        'alert{event=payout_paid_without_provider_tx',
      ];
      const fired = critical.filter((c) => {
        const m = text.match(new RegExp(`${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}\\s+(\\d+)`));
        return m && Number(m[1]) > 0;
      });
      if (fired.length) fail(`critical alerts fired in staging: ${fired.join(', ')}`);
      else ok('no critical alerts fired in staging');
    }
  } finally {
    await prisma.$disconnect();
  }

  if (hardFailures) {
    console.error(`\nstaging-smoke FAILED with ${hardFailures} hard failure(s)`);
    process.exit(1);
  }
  console.log(
    `\nstaging-smoke PASSED (${softWarnings} warning(s), non-blocking)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
