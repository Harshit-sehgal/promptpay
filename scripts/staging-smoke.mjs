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
const { signPayload } = apiRequire('@waitlayer/shared');

const API_BASE_URL = process.env.STAGING_API_URL ?? 'http://localhost:4002';
// P0 #7: the financial loop is MANDATORY — opt out only for local debugging
// (STAGING_FULL_FLOW=0), and even then the script hard-fails below so a
// release gate can never pass on the short path.
const FULL_FLOW = process.env.STAGING_FULL_FLOW !== '0';
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

function signToken(user, privateKey, sessionId, expiresIn = '10m') {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      jti: sessionId,
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
    // Each token's jti must match a real, active Session row for the same user.
    const mkSession = async (userId) => {
      const sessionId = randomUUID();
      await prisma.session.create({
        data: {
          id: sessionId,
          userId,
          tokenHash: randomUUID(),
          tokenFamily: randomUUID(),
          revoked: false,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      return sessionId;
    };
    const adminSessionId = await mkSession(admin.id);
    const advSessionId = await mkSession(advertiser.id);
    const devSessionId = await mkSession(developer.id);

    // Verify each session row belongs to the intended subject before signing.
    for (const [role, user, sessionId] of [
      ['admin', admin, adminSessionId],
      ['advertiser', advertiser, advSessionId],
      ['developer', developer, devSessionId],
    ]) {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { userId: true, revoked: true },
      });
      if (!session || session.revoked || session.userId !== user.id) {
        fail(`${role} session ${sessionId} does not belong to user ${user.id}`);
        process.exit(1);
      }
    }

    const adminToken = signToken(admin, privateKey, adminSessionId);
    const advToken = signToken(advertiser, privateKey, advSessionId);
    const devToken = signToken(developer, privateKey, devSessionId);

    // Preflight: every generated token must be accepted by /auth/me.
    for (const [role, token] of [
      ['admin', adminToken],
      ['advertiser', advToken],
      ['developer', devToken],
    ]) {
      const me = await api('GET', '/auth/me', token);
      if (me.status !== 200) {
        fail(`${role} token rejected by /auth/me (HTTP ${me.status}) — session binding mismatch`);
        process.exit(1);
      }
      ok(`${role} token accepted by /auth/me`);
    }

    if (!FULL_FLOW) {
      // P0 #7: the financial loop is the point of the staging gate. Skipping
      // it is only ever a local-debug convenience — the workflow defaults
      // STAGING_FULL_FLOW to '1', so a release cannot pass without it.
      fail('STAGING_FULL_FLOW=0 set — the financial loop is mandatory for a staging release gate');
    } else {
      // 2. Developer opts into ads (privacy-by-default: server setting is
      // authoritative; without this every ad request is rejected).
      const settings = await api('PATCH', '/developer/settings', devToken, { adsEnabled: true });
      if (settings.status >= 400) fail(`enable ads -> HTTP ${settings.status}: ${settings.text}`);
      else ok('developer adsEnabled=true (server setting)');

      // 3. Create campaign + inline creative via the real API (this also
      // auto-provisions the advertiser profile).
      const campaignRes = await api('POST', '/advertiser/campaigns', advToken, {
        name: `staging-smoke-${Date.now()}`,
        currency: 'USD',
        category: 'technology',
        bidType: 'CPC',
        budgetTotalMinor: 100_000,
        // CPC at $20/click so a single billed click credits the developer
        // >= the $10 payout minimum — CPM per-impression fractions cannot
        // fund a payout from one loop iteration.
        bidAmountMinor: 2_000,
        creative: {
          title: 'Staging smoke creative',
          body: 'Verified, private, paid back to you.',
          destinationUrl: 'https://waitlayer.com',
          category: 'technology',
          ctaText: 'Learn more',
        },
        targetingCountries: ['US'],
      });
      if (campaignRes.status >= 400) {
        fail(`create campaign -> HTTP ${campaignRes.status}: ${campaignRes.text}`);
      }
      const campaignId = campaignRes.json?.id;
      if (!campaignId) fail('campaign create returned no id');
      else ok(`campaign created (${campaignId})`);

      // 4. Fund the advertiser. STAGING-ONLY: seeds a confirmed credit row
      // directly (the live Stripe sandbox lifecycle is external item #38).
      // Campaign approval checks the balance inside its transaction and
      // activates only a funded campaign, so this must land BEFORE approve.
      let advertiserId = null;
      if (campaignId) {
        const advProfile = await prisma.advertiser.findUnique({ where: { userId: advertiser.id } });
        if (!advProfile) {
          fail('advertiser profile was not provisioned by campaign creation');
        } else {
          advertiserId = advProfile.id;
          await prisma.advertiserLedger.create({
            data: {
              advertiserId,
              currency: 'USD',
              entryType: 'credit',
              status: 'confirmed',
              amountMinor: 100_000n,
              idempotencyKey: `staging-smoke-fund-${Date.now()}`,
              description: 'staging-smoke seed funding (replaces live Stripe until #38)',
            },
          });
          ok('advertiser funded with confirmed staging credit (DB seed)');
        }
      }

      // 5. Submit + approve; approval must ACTIVATE the funded campaign.
      if (campaignId) {
        const submit = await api('POST', `/advertiser/campaigns/${campaignId}/submit`, advToken, {});
        if (submit.status >= 400) fail(`submit campaign -> HTTP ${submit.status}: ${submit.text}`);
        const approve = await api('POST', `/admin/campaigns/${campaignId}/approve`, adminToken, {
          reason: 'staging smoke',
        });
        if (approve.status >= 400) fail(`approve campaign -> HTTP ${approve.status}: ${approve.text}`);
        const campaignRow = await prisma.campaign.findUnique({ where: { id: campaignId } });
        if (campaignRow?.status !== 'active' || !campaignRow.activatedAt) {
          fail(
            `campaign not active after approval (status=${campaignRow?.status}, activatedAt=${campaignRow?.activatedAt})`,
          );
        } else {
          ok('campaign submitted, admin-approved, and ACTIVE (funded)');
        }
      }

      // 6. Register a REAL device and retain its event secret for HMAC.
      const deviceRes = await api('POST', '/extension/register-device', devToken, {
        toolType: 'cursor',
        fingerprintHash: `staging-smoke-${Date.now()}`,
        extensionVersion: 'staging-smoke-1.0.0',
        platform: 'linux',
      });
      if (deviceRes.status >= 400 || !deviceRes.json?.id || !deviceRes.json?.eventSecret) {
        fail(`register device -> HTTP ${deviceRes.status}: ${deviceRes.text}`);
      }
      const deviceId = deviceRes.json?.id;
      const deviceSecret = deviceRes.json?.eventSecret;
      if (deviceId && deviceSecret) ok(`device registered (${deviceId}), secret retained`);

      // Helper: sign a payload with the device secret exactly like the
      // extension client (canonical JSON + HMAC), then POST it.
      const signedPost = async (path, payload) => {
        const body = { ...payload, signature: signPayload(payload, deviceSecret) };
        return api('POST', path, devToken, body);
      };

      // 7. Signed wait start with signed EVIDENCE items (P0.1). Payment
      // eligibility now requires ≥2 observed primary evidence types. Since
      // heuristic ai_generation signals are 'inferred', the staging test
      // must use a task+terminal combination (both 'observed' when the
      // adapter provides real VS Code task/terminal lifecycle events).
      // For the staging smoke test we mimic the extension's event-building
      // code by creating evidence items and signing them with the device
      // secret, matching exactly how the packaged client produces evidence.
      const waitStateId = `staging-ws-${randomUUID()}`;
      const sessionId = `staging-sess-${randomUUID()}`;
      const detectorVersion = 'staging-smoke-1.0.0';
      const loopStart = Date.now();
      if (deviceId) {
        // Build evidence items exactly like the VS Code extension's
        // buildEvidence() — signs each with the device secret.
        const now = Date.now();
        const rawEvidence = [
          { type: 'active_task', sourceType: 'observed', adapterId: 'vscode.task', timestamp: now, correlationId: waitStateId },
          { type: 'command_execution', sourceType: 'observed', adapterId: 'vscode.terminal', timestamp: now + 1, correlationId: waitStateId },
        ];
        const evidence = rawEvidence.map((item) => {
          const evidencePayload = { ...item, detectorVersion, waitStateId, sessionId };
          return { ...evidencePayload, signature: signPayload(evidencePayload, deviceSecret) };
        });
        const wsStart = await signedPost('/extension/wait-state/start', {
          deviceId,
          sessionId,
          toolType: 'cursor',
          waitStateId,
          idempotencyKey: `staging-ws-start-${randomUUID()}`,
          signals: [{ type: 'ai_generation' }, { type: 'command_execution' }],
          evidence,
          detectorVersion,
        });
        if (wsStart.status >= 400) fail(`wait start -> HTTP ${wsStart.status}: ${wsStart.text}`);
        else ok('signed wait start recorded (signed evidence items, payment-eligible)');
      }

      // 8. Ad request with the SAME device/session/wait IDs — must serve.
      let impressionToken = null;
      if (deviceId) {
        const adRes = await signedPost('/extension/ad-request', {
          deviceId,
          sessionId,
          waitStateId,
          toolType: 'cursor',
          country: 'US',
          idempotencyKey: `staging-ad-${randomUUID()}`,
        });
        impressionToken = adRes.json?.ad?.impressionToken ?? null;
        if (adRes.status >= 400 || !impressionToken) {
          fail(`ad request did not serve -> HTTP ${adRes.status}: ${adRes.text}`);
        } else {
          ok('ad served for the signed wait (impressionToken issued)');
        }
      }

      // 9. Rendered event, then wait the server-enforced minimum visible
      // duration (A-060 floor ~5s) before qualifying.
      if (impressionToken) {
        const rendered = await signedPost('/extension/ad-rendered', {
          impressionToken,
          renderedAt: new Date().toISOString(),
          idempotencyKey: `staging-ren-${randomUUID()}`,
        });
        if (rendered.status >= 400) fail(`ad rendered -> HTTP ${rendered.status}: ${rendered.text}`);
        else ok('rendered event recorded; waiting minimum visible duration');
        await new Promise((r) => setTimeout(r, 5_500));

        // 10. Qualify the impression.
        const qualified = await signedPost('/extension/impression-qualified', {
          impressionToken,
          qualifiedAt: new Date().toISOString(),
          visibleDurationMs: 5_500,
          idempotencyKey: `staging-qual-${randomUUID()}`,
        });
        if (qualified.status >= 400) {
          fail(`qualify impression -> HTTP ${qualified.status}: ${qualified.text}`);
        } else {
          ok('impression qualified');
        }

        // 11. Click — the CPC billing trigger.
        const click = await signedPost('/extension/click', {
          impressionToken,
          clickedAt: new Date().toISOString(),
          idempotencyKey: `staging-clk-${randomUUID()}`,
        });
        if (click.status >= 400) fail(`ad click -> HTTP ${click.status}: ${click.text}`);
        else ok('click recorded (CPC billable event)');

        // 12. End the wait (duration must match server time within tolerance).
        const elapsedSeconds = Math.floor((Date.now() - loopStart) / 1000);
        const wsEnd = await signedPost('/extension/wait-state/end', {
          waitStateId,
          durationSeconds: String(elapsedSeconds),
          idempotencyKey: `staging-ws-end-${randomUUID()}`,
        });
        if (wsEnd.status >= 400) fail(`wait end -> HTTP ${wsEnd.status}: ${wsEnd.text}`);
        else ok(`wait ended (${elapsedSeconds}s)`);
      }

      // 13. Ledger assertions (DB): developer credit, advertiser debit,
      // platform split — every missing row or currency/amount mismatch fails.
      let earnedMinor = 0n;
      if (impressionToken && advertiserId) {
        const [earnings, advDebit, platformRows] = await Promise.all([
          prisma.earningsLedger.findMany({ where: { userId: developer.id, currency: 'USD' } }),
          prisma.advertiserLedger.findFirst({
            where: { advertiserId, entryType: 'debit', currency: 'USD' },
          }),
          prisma.platformLedger.findMany({ where: { currency: 'USD' } }),
        ]);
        const earning = earnings.find((e) => e.entryType === 'credit');
        if (!earning) {
          fail('no developer earnings credit row after billed click');
        } else {
          earnedMinor = BigInt(earning.amountMinor);
          if (earnedMinor <= 0n) fail(`developer credit is ${earnedMinor} (expected > 0)`);
          if (earnedMinor >= 2_000n) fail(`developer credit ${earnedMinor} exceeds gross bid`);
        }
        if (!advDebit) fail('no advertiser debit row after billed click');
        else if (BigInt(advDebit.amountMinor) !== 2_000n) {
          fail(`advertiser debit ${advDebit.amountMinor} != gross bid 2000`);
        }
        const platformTotal = platformRows
          .filter((r) => r.entryType === 'credit' || r.entryType === 'reserve')
          .reduce((sum, r) => sum + BigInt(r.amountMinor), 0n);
        if (platformRows.length === 0) fail('no platform ledger rows after billed click');
        // Money conservation: developer net + platform split must be bounded
        // by the advertiser debit (no money created) and non-trivial.
        if (advDebit && earnedMinor + platformTotal > BigInt(advDebit.amountMinor)) {
          fail(
            `money conservation violated: dev ${earnedMinor} + platform ${platformTotal} > debit ${advDebit.amountMinor}`,
          );
        }
        if (!hardFailures) {
          ok(`ledger split verified (dev=${earnedMinor}, platform=${platformTotal}, debit=${advDebit?.amountMinor})`);
        }
      }

      // 14. Mature the test earning explicitly (staging-only: the real hold
      // period is days/weeks; the payout path requires confirmed entries).
      if (earnedMinor > 0n) {
        const matured = await prisma.earningsLedger.updateMany({
          where: { userId: developer.id, entryType: 'credit', currency: 'USD', status: { not: 'paid' } },
          data: { status: 'confirmed', availableAt: null },
        });
        if (matured.count === 0) fail('no earning row could be advanced to confirmed');
        else ok(`test earning advanced to confirmed (${matured.count} row, staging-only)`);
      }

      // 15. Payout lifecycle: method -> request -> approve -> process, all
      // fail-closed, for the FULL earned amount.
      if (earnedMinor > 0n) {
        const method = await api('POST', '/payout/method', devToken, {
          provider: 'paypal_email',
          destination: 'staging-smoke@example.com',
        });
        if (method.status >= 400) {
          fail(`add payout method -> HTTP ${method.status}: ${method.text}`);
        } else {
          const payout = await api('POST', '/payout/request', devToken, {
            amountMinor: Number(earnedMinor),
            currency: 'USD',
          });
          if (payout.status >= 400) {
            fail(`request payout (${earnedMinor} minor) -> HTTP ${payout.status}: ${payout.text}`);
          } else {
            const payoutId = payout.json?.id;
            const approvePayout = await api('POST', `/admin/payouts/${payoutId}/approve`, adminToken, {});
            if (approvePayout.status >= 400) {
              fail(`approve payout -> HTTP ${approvePayout.status}: ${approvePayout.text}`);
            }
            const proc = await api('POST', `/admin/payouts/${payoutId}/process`, adminToken, {});
            if (proc.status >= 400) fail(`process payout -> HTTP ${proc.status}: ${proc.text}`);
            else ok(`payout ${payoutId} approved + processed (${earnedMinor} minor)`);

            // 16. Reconciliation assertions: allocations reference the
            // earning; the payout is in a valid post-process state.
            const [allocations, payoutRow] = await Promise.all([
              prisma.payoutAllocation.findMany({ where: { payoutRequestId: payoutId } }),
              prisma.payoutRequest.findUnique({ where: { id: payoutId } }),
            ]);
            if (allocations.length === 0) {
              fail('no payout allocations persisted for the processed payout');
            }
            const allocatedTotal = allocations.reduce((s, a) => s + BigInt(a.amountMinor), 0n);
            if (allocatedTotal !== earnedMinor) {
              fail(`allocations total ${allocatedTotal} != earned ${earnedMinor}`);
            }
            const validStates = ['processing', 'paid', 'failed'];
            if (!payoutRow || !validStates.includes(payoutRow.status)) {
              fail(`payout in unexpected state '${payoutRow?.status}' after process`);
            }
            if (!hardFailures) {
              ok(`payout reconciliation verified (${allocations.length} allocation(s), state=${payoutRow?.status})`);
            }
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
