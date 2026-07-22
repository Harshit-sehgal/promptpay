#!/usr/bin/env node
/**
 * Staging release-gate smoke test (P1.23).
 *
 * Exercises the deployed staging API end-to-end before a human approves
 * promotion to production:
 *   1. Readiness probe (`/health/ready`).
 *   2. Create, target, submit, and admin-approve a test campaign through the
 *      public API contract.
 *   3. Exercise a signed extension API flow, then obtain a separately signed
 *      wait assertion from the configured staging attestation bridge before
 *      the deployed ledger can record an earning and advertiser debit.
 *   4. Pull Prometheus metrics and assert no critical alerts fired.
 *
 * This is deliberately an API-contract smoke, not proof that a packaged
 * extension observed a real wait or that a payout provider settled money.
 * The attestation bridge must be separately operated and use a private signing
 * key unavailable to the extension/API. Packaged-client and payout-provider
 * launch evidence remain separate gates documented in
 * docs/ops/wait-attestation-launch-gate.md.
 *
 * Usage:
 *   node scripts/staging-smoke.mjs
 *
 * Required env:
 *   DATABASE_URL            - staging Postgres connection string
 *   JWT_PRIVATE_KEY         - RS256 private key (matches staging JWT_PUBLIC_KEY)
 *   STAGING_API_URL         - base URL of the deployed staging API
 *                            (default http://localhost:4002)
 *   STAGING_FULL_FLOW=1     - also run the mandatory campaign/ad/ledger flow
 *   STAGING_WAIT_ATTESTATION_PROVIDER - configured issuer provider id
 *   STAGING_WAIT_ATTESTATION_BRIDGE_URL - independently operated signer URL
 * Optional env:
 *   STAGING_WAIT_ATTESTATION_BRIDGE_TOKEN - bearer token for the bridge
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

async function requestIndependentAttestation(payload) {
  const url = process.env.STAGING_WAIT_ATTESTATION_BRIDGE_URL;
  if (!url) {
    fail('STAGING_WAIT_ATTESTATION_BRIDGE_URL is required for a billable staging smoke');
    return null;
  }
  const token = process.env.STAGING_WAIT_ATTESTATION_BRIDGE_TOKEN;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    fail(
      `attestation bridge request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON response is never a valid attestation response.
  }
  if (!response.ok || typeof json?.assertion !== 'string' || json.assertion.length < 32) {
    fail(`attestation bridge returned HTTP ${response.status}: ${text}`);
    return null;
  }
  return json.assertion;
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

      // 3. Create the campaign through its real API. Creatives and country
      // targeting are separate resources; keeping the smoke payload aligned
      // with the DTOs catches contract drift before production promotion.
      const campaignRes = await api('POST', '/advertiser/campaigns', advToken, {
        name: `staging-smoke-${Date.now()}`,
        currency: 'USD',
        category: 'technology',
        bidType: 'cpc',
        budgetTotalMinor: 100_000,
        // CPC at $20/click so a single billed click credits the developer
        // >= the $10 payout minimum — CPM per-impression fractions cannot
        // fund a payout from one loop iteration.
        bidAmountMinor: 2_000,
      });
      if (campaignRes.status >= 400) {
        fail(`create campaign -> HTTP ${campaignRes.status}: ${campaignRes.text}`);
      }
      const campaignId = campaignRes.json?.id;
      if (!campaignId) fail('campaign create returned no id');
      else ok(`campaign created (${campaignId})`);

      let creativeId = null;
      if (campaignId) {
        const creative = await api('POST', `/campaigns/${campaignId}/creatives`, advToken, {
          title: 'Staging smoke creative',
          sponsoredMessage: 'A staging-only API-contract smoke creative.',
          destinationUrl: 'https://waitlayer.com',
          displayDomain: 'waitlayer.com',
          ctaText: 'Learn more',
        });
        creativeId = creative.json?.id ?? null;
        if (creative.status >= 400 || !creativeId) {
          fail(`create creative -> HTTP ${creative.status}: ${creative.text}`);
        } else {
          ok(`creative created (${creativeId})`);
        }

        const targeting = await api(
          'POST',
          `/campaigns/${campaignId}/targeting/countries`,
          advToken,
          [{ countryCode: 'US', include: true }],
        );
        if (targeting.status >= 400) {
          fail(`set country targeting -> HTTP ${targeting.status}: ${targeting.text}`);
        } else {
          ok('country targeting configured through campaign API');
        }
      }

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
          // Use the staging-only admin faucet instead of writing directly to the
          // advertiser ledger. This keeps the smoke test on the public API
          // contract and avoids direct DB inserts for financial state.
          // NOTE: the deployed staging API must have ENABLE_STAGING_FAUCET=true.
          const faucetKey = `staging-smoke-fund-${crypto.randomUUID()}`;
          const faucet = await api('POST', '/admin/staging/advertiser-credit', adminToken, {
            userId: advertiser.id,
            // BigInt cannot be serialized by JSON.stringify; send as a string.
            amountMinor: '100000',
            currency: 'USD',
            idempotencyKey: faucetKey,
          });
          if (faucet.status >= 400) {
            fail(`advertiser faucet -> HTTP ${faucet.status}: ${faucet.text}`);
          } else {
            ok('advertiser funded with confirmed staging credit via admin faucet');
          }
        }
      }

      // 5. Submit + approve creative + approve campaign. Approval must
      // activate the funded campaign, and the ordering matches the real API.
      if (campaignId && creativeId) {
        const submit = await api(
          'POST',
          `/advertiser/campaigns/${campaignId}/submit`,
          advToken,
          {},
        );
        if (submit.status >= 400) fail(`submit campaign -> HTTP ${submit.status}: ${submit.text}`);
        const approveCreative = await api(
          'POST',
          `/campaigns/creatives/${creativeId}/approve`,
          adminToken,
          {},
        );
        if (approveCreative.status >= 400) {
          fail(`approve creative -> HTTP ${approveCreative.status}: ${approveCreative.text}`);
        } else {
          ok('creative approved');
        }
        const approve = await api('POST', `/admin/campaigns/${campaignId}/approve`, adminToken, {
          reason: 'staging smoke',
        });
        if (approve.status >= 400)
          fail(`approve campaign -> HTTP ${approve.status}: ${approve.text}`);
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

      // 7. Create the single-use attestation session BEFORE the operation,
      // then record an ordinary signed wait start. The smoke intentionally
      // does not manufacture observed evidence arrays: only an independent
      // provider signature may make this client flow billable.
      const waitStateId = `staging-ws-${randomUUID()}`;
      const sessionId = `staging-sess-${randomUUID()}`;
      const attestationProvider = process.env.STAGING_WAIT_ATTESTATION_PROVIDER;
      const loopStart = Date.now();
      let attestationSession = null;
      if (deviceId) {
        if (!attestationProvider) {
          fail('STAGING_WAIT_ATTESTATION_PROVIDER is required for a billable staging smoke');
        } else {
          const created = await api('POST', '/extension/wait-attestation/session', devToken, {
            deviceId,
            sessionId,
            waitStateId,
            provider: attestationProvider,
          });
          if (
            created.status >= 400 ||
            !created.json?.attestationSessionId ||
            !created.json?.nonce
          ) {
            fail(`create wait-attestation session -> HTTP ${created.status}: ${created.text}`);
          } else {
            attestationSession = created.json;
            ok('single-use wait-attestation nonce issued before wait start');
          }
        }
        const wsStart = await signedPost('/extension/wait-state/start', {
          deviceId,
          sessionId,
          toolType: 'cursor',
          waitStateId,
          idempotencyKey: `staging-ws-start-${randomUUID()}`,
          signals: [{ type: 'ai_generation' }, { type: 'command_execution' }],
        });
        if (wsStart.status >= 400) fail(`wait start -> HTTP ${wsStart.status}: ${wsStart.text}`);
        else ok('signed wait start recorded (non-billable without independent attestation)');
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
        if (rendered.status >= 400)
          fail(`ad rendered -> HTTP ${rendered.status}: ${rendered.text}`);
        else ok('rendered event recorded; waiting minimum visible duration');
        await new Promise((r) => setTimeout(r, 5_500));

        // 10. End the wait (duration must match server time within tolerance)
        // before asking the independently operated bridge to attest it.
        const elapsedSeconds = Math.floor((Date.now() - loopStart) / 1000);
        const wsEnd = await signedPost('/extension/wait-state/end', {
          waitStateId,
          durationSeconds: String(elapsedSeconds),
          idempotencyKey: `staging-ws-end-${randomUUID()}`,
        });
        if (wsEnd.status >= 400) fail(`wait end -> HTTP ${wsEnd.status}: ${wsEnd.text}`);
        else ok(`wait ended (${elapsedSeconds}s)`);

        // 11. The bridge owns a private key not available to this script or
        // the API. It receives the server nonce and operation bindings and
        // returns a signed assertion; the API independently verifies it.
        let assertion = null;
        if (attestationSession && attestationProvider) {
          assertion = await requestIndependentAttestation({
            attestationSessionId: attestationSession.attestationSessionId,
            nonce: attestationSession.nonce,
            userId: developer.id,
            deviceId,
            sessionId,
            waitStateId,
            provider: attestationProvider,
          });
        }
        if (assertion && attestationSession) {
          const consumed = await api('POST', '/extension/wait-attestation/consume', devToken, {
            attestationSessionId: attestationSession.attestationSessionId,
            assertion,
          });
          if (consumed.status >= 400) {
            fail(`consume wait attestation -> HTTP ${consumed.status}: ${consumed.text}`);
          } else {
            ok('independent wait attestation consumed and bound to the completed server wait');
          }
        } else if (!hardFailures) {
          fail('no independent wait assertion was returned; refusing to qualify the impression');
        }

        // 12. Qualify only after the server has verified the external proof.
        const qualified = await signedPost('/extension/impression-qualified', {
          impressionToken,
          qualifiedAt: new Date().toISOString(),
          visibleDurationMs: 5_500,
          idempotencyKey: `staging-qual-${randomUUID()}`,
        });
        if (qualified.status >= 400 || !qualified.json?.qualified) {
          fail(`qualify attested impression -> HTTP ${qualified.status}: ${qualified.text}`);
        } else {
          ok('attested impression qualified');
        }

        // 13. Click — the CPC billing trigger.
        const click = await signedPost('/extension/click', {
          impressionToken,
          clickedAt: new Date().toISOString(),
          idempotencyKey: `staging-clk-${randomUUID()}`,
        });
        if (click.status >= 400 || !click.json?.clicked)
          fail(`click attested impression -> HTTP ${click.status}: ${click.text}`);
        else ok('click recorded (CPC billable event)');
      }

      // 14. Ledger assertions (DB): tie every assertion to this campaign so
      // old staging rows cannot make a new smoke falsely pass.
      let earnedMinor = 0n;
      if (impressionToken && advertiserId && campaignId) {
        const [earnings, advDebit, platformRows] = await Promise.all([
          prisma.earningsLedger.findMany({
            where: { userId: developer.id, campaignId, currency: 'USD' },
          }),
          prisma.advertiserLedger.findFirst({
            where: { advertiserId, campaignId, entryType: 'debit', currency: 'USD' },
          }),
          prisma.platformLedger.findMany({ where: { campaignId, currency: 'USD' } }),
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
          ok(
            `ledger split verified (dev=${earnedMinor}, platform=${platformTotal}, debit=${advDebit?.amountMinor})`,
          );
        }
      }

      if (earnedMinor > 0n) {
        ok('pending ledger split verified after an independently signed wait assertion');
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
        const m = text.match(
          new RegExp(`${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}\\s+(\\d+)`),
        );
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
  console.log(`\nstaging-smoke PASSED (${softWarnings} warning(s), non-blocking)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
