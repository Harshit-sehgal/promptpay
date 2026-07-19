/**
 * P0.4 — Auth guard-order integration tests.
 *
 * Boots the REAL NestJS application (AppModule) with every global + controller
 * guard enabled and drives real HTTP requests against it, asserting HTTP status
 * codes. This exercises the full guard chain end-to-end:
 *
 *   global ApiKeyGuard  ->  (controller) JwtAuthGuard  ->  RolesGuard
 *
 * Nothing is mocked. Prisma talks to the real (test) Postgres instance and
 * API keys are minted through the real ApiKeyService.
 *
 * JWT minting: we sign access JWTs with the TEST key set that the test harness
 * injects as JWT_PRIVATE_KEY/JWT_PUBLIC_KEY (see src/test-setup.ts). The app's
 * JwtStrategy verifies against that same public key (kid = deriveKeyId(pub)),
 * so tokens we mint verify. We replicate auth-session.trait's access-token
 * shape: { sub, role, jti, iss, aud: [audience, 'access'], exp }. `jti` is the
 * id of a real Session row (the strategy looks it up and rejects revoked ones);
 * `sub` is the user id (the strategy looks the user up and rejects banned
 * users). `aud` MUST include 'access' (strategy check) AND the configured
 * JWT_AUDIENCE (passport verification), hence the array.
 */
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRole, UserStatus } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from '../auth/__fixtures__/test-keys';
import { deriveKeyId } from '../auth/jwt-key-id';
import { ActionStepUpGuard } from '../common/guards/action-step-up.guard';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';
import { ApiKeyService } from '../developer/api-key.service';

/** Mirror of e2e-http-flow cleanDb: truncate shared schema between runs. */
async function cleanDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "users", "sessions", "devices", "device_recovery_tokens",
      "user_settings", "payout_accounts",
      "advertisers", "campaigns", "ad_creatives", "categories",
      "blocked_categories", "country_targeting", "tool_integrations",
      "wait_state_events", "ad_impressions", "ad_clicks", "ad_reports",
      "earnings_ledger", "advertiser_ledger", "platform_ledger",
      "payout_requests", "payout_allocations", "payout_transactions",
      "recovery_debt_cases",
      "fraud_flags", "trust_scores", "campaign_approvals", "api_keys",
      "webhook_events", "audit_logs", "referrals", "referral_rewards"
    CASCADE;
  `);
}

/**
 * Sign an access JWT with the test private key. `kid` is derived from the test
 * public key so the booted app's JwtStrategy (which loads JWT_PUBLIC_KEY from
 * the test env) accepts it. `aud`/`iss` mirror what auth-session.trait emits.
 */
const jwtSigner = new JwtService({
  privateKey: TEST_JWT_PRIVATE_KEY,
  publicKey: TEST_JWT_PUBLIC_KEY,
  signOptions: {
    algorithm: 'RS256',
    keyid: deriveKeyId(TEST_JWT_PUBLIC_KEY),
  },
});

async function mintAccessToken(opts: {
  sub: string;
  role: string;
  jti: string;
  /** Override `exp` (seconds since epoch). Defaults to +1h. */
  exp?: number;
  audience?: string | string[];
  issuer?: string;
}): Promise<string> {
  const audience = opts.audience ?? process.env.JWT_AUDIENCE ?? 'waitlayer-client';
  const issuer = opts.issuer ?? process.env.JWT_ISSUER ?? 'waitlayer';
  const exp = opts.exp ?? Math.floor(Date.now() / 1000) + 60 * 60;
  return jwtSigner.signAsync({
    sub: opts.sub,
    role: opts.role,
    jti: opts.jti,
    iss: issuer,
    aud: [audience, 'access'],
    exp,
  });
}

describe('P0.4 Auth guard-order (real app, DB-backed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let apiKeyService: ApiKeyService;

  // ── Identities ──
  let devUserId: string;
  let devSessionId: string;
  let devToken: string;

  let advAUserId: string;
  let advAAdvertiserId: string;
  let advASessionId: string;
  let advARevokedSessionId: string;
  let advAToken: string;
  let advARevokedToken: string;
  let advAExpiredToken: string;

  // B = a *different* advertiser/owner from A (used for the bypass regression).
  let advBUserId: string;
  let advBAdvertiserId: string;

  // Banned developer (JWT-banned case).
  let banDevUserId: string;
  let banDevSessionId: string;
  let banDevToken: string;

  // Banned API-key owner (key minted while active, then owner banned).
  let banOwnerUserId: string;

  // ── API keys (plainKey is the only time it exists) ──
  let keyA: string; // owned by A, scoped to A's advertiser, broad scopes
  let keyB: string; // owned by B, scoped to B's advertiser, has advertiser:read
  let keyNoAdvertiserRead: string; // owned by A but lacks advertiser:read
  let keyBannedOwner: string; // owned by banOwner (now banned)

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Same guard overrides as e2e-http-flow: keep rate-limit / step-up out of
      // the way so the auth-guard ordering is the only thing under test.
      .overrideGuard(BruteForceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottleByRouteGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ActionStepUpGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    // Cookie auth (access_token) is exercised in case 10; main.ts wires
    // cookieParser, so the booted test app must too.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
    apiKeyService = app.get(ApiKeyService);
    await cleanDb(prisma);

    // ── Seed users (real rows, not mocked) ──
    const makeUser = (email: string, role: UserRole, status: UserStatus) =>
      prisma.user.create({
        data: {
          email,
          passwordHash: bcrypt.hashSync('Password123!', 10),
          name: email.split('@')[0],
          role,
          status,
          country: 'US',
        },
      });

    const makeSession = (userId: string, revoked = false) =>
      prisma.session
        .create({
          data: {
            userId,
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            revoked,
          },
        })
        .then((s) => s.id);

    const makeAdvertiser = (userId: string) =>
      prisma.advertiser
        .create({
          data: {
            userId,
            companyName: `Adv ${userId.slice(0, 6)}`,
            billingEmail: `billing+${userId.slice(0, 6)}@example.com`,
          },
        })
        .then((a) => a.id);

    const dev = await makeUser('dev-a@waitlayer.com', UserRole.DEVELOPER, UserStatus.ACTIVE);
    devUserId = dev.id;
    devSessionId = await makeSession(devUserId);

    const advA = await makeUser('adv-a@waitlayer.com', UserRole.ADVERTISER, UserStatus.ACTIVE);
    advAUserId = advA.id;
    advAAdvertiserId = await makeAdvertiser(advAUserId);
    advASessionId = await makeSession(advAUserId);
    // A *separate* session for A, marked revoked — used to prove revocation
    // is still checked even when an API key is present.
    advARevokedSessionId = await makeSession(advAUserId, true);

    const advB = await makeUser('adv-b@waitlayer.com', UserRole.ADVERTISER, UserStatus.ACTIVE);
    advBUserId = advB.id;
    advBAdvertiserId = await makeAdvertiser(advBUserId);

    const banDev = await makeUser('ban-dev@waitlayer.com', UserRole.DEVELOPER, UserStatus.BANNED);
    banDevUserId = banDev.id;
    banDevSessionId = await makeSession(banDevUserId);

    // Banned API-key owner: create active, mint a key, then ban the owner so
    // the key's owner lookup fails isActiveAccountStatus.
    const banOwner = await makeUser(
      'ban-owner@waitlayer.com',
      UserRole.ADVERTISER,
      UserStatus.ACTIVE,
    );
    banOwnerUserId = banOwner.id;
    const banOwnerAdvertiserId = await makeAdvertiser(banOwnerUserId);

    // ── Mint API keys through the REAL ApiKeyService ──
    const mkA = await apiKeyService.generateApiKey(
      advAUserId,
      [
        'advertiser:read',
        'advertiser:write',
        'campaigns:read',
        'campaigns:write',
        'reports:read',
        'ledger:read',
      ],
      advAAdvertiserId,
    );
    keyA = mkA.plainKey;

    const mkB = await apiKeyService.generateApiKey(
      advBUserId,
      ['advertiser:read', 'ledger:read', 'reports:read', 'campaigns:read'],
      advBAdvertiserId,
    );
    keyB = mkB.plainKey;

    // Same owner A, but WITHOUT advertiser:read — to drive the scope 403.
    const mkNoRead = await apiKeyService.generateApiKey(
      advAUserId,
      ['campaigns:read'],
      advAAdvertiserId,
    );
    keyNoAdvertiserRead = mkNoRead.plainKey;

    const mkBan = await apiKeyService.generateApiKey(
      banOwnerUserId,
      ['advertiser:read'],
      banOwnerAdvertiserId,
    );
    keyBannedOwner = mkBan.plainKey;
    await prisma.user.update({
      where: { id: banOwnerUserId },
      data: { status: UserStatus.BANNED },
    });

    // ── Mint JWTs (controlling sub / jti / exp / aud) ──
    devToken = await mintAccessToken({ sub: devUserId, role: 'developer', jti: devSessionId });
    advAToken = await mintAccessToken({ sub: advAUserId, role: 'advertiser', jti: advASessionId });
    advARevokedToken = await mintAccessToken({
      sub: advAUserId,
      role: 'advertiser',
      jti: advARevokedSessionId,
    });
    advAExpiredToken = await mintAccessToken({
      sub: advAUserId,
      role: 'advertiser',
      jti: advASessionId,
      exp: Math.floor(Date.now() / 1000) - 60 * 60, // already in the past
    });
    banDevToken = await mintAccessToken({
      sub: banDevUserId,
      role: 'developer',
      jti: banDevSessionId,
    });
  });

  afterAll(async () => {
    if (prisma) await cleanDb(prisma);
    if (app) await app.close();
  });

  const server = () => app.getHttpServer();

  // ───────────────────────────────────────────────────────────────────────
  // 1. JWT only -> 200 on a JWT-protected route.
  // ───────────────────────────────────────────────────────────────────────
  it('1. JWT only -> 200 on a JWT-protected route (Bearer on /developer/dashboard)', async () => {
    const res = await request(server())
      .get('/api/v1/developer/dashboard')
      .set('Authorization', `Bearer ${devToken}`)
      .expect(200);
    expect(res.body).toBeDefined();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. API key only -> 200 on an @AllowApiKey route (no Bearer).
  // ───────────────────────────────────────────────────────────────────────
  it('2. API key only -> 200 on an @AllowApiKey route (x-api-key on /advertiser/profile)', async () => {
    const res = await request(server())
      .get('/api/v1/advertiser/profile')
      .set('x-api-key', keyA)
      .expect(200);
    expect(res.body).toBeDefined();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. valid API key with required scope -> 200; missing scope -> 403.
  // ───────────────────────────────────────────────────────────────────────
  it('3a. API key with required scope -> 200', async () => {
    // keyA carries advertiser:read, which /advertiser/profile requires.
    await request(server()).get('/api/v1/advertiser/profile').set('x-api-key', keyA).expect(200);
  });

  it('3b. API key missing required scope -> 403', async () => {
    // keyNoAdvertiserRead has only campaigns:read, not advertiser:read.
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('x-api-key', keyNoAdvertiserRead)
      .expect(403);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. same-owner JWT + API key -> 200 (reconciliation passes).
  // ───────────────────────────────────────────────────────────────────────
  it('4. same-owner JWT + API key -> 200 (reconciliation passes)', async () => {
    const res = await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Authorization', `Bearer ${advAToken}`)
      .set('x-api-key', keyA)
      .expect(200);
    expect(res.body).toBeDefined();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 5. different-owner JWT + API key -> 401. KEY REGRESSION (P0.3 bypass fix).
  //    Bearer for A + x-api-key owned by B: jwt.strategy validates A, but the
  //    guard reconciliation rejects because jwtUserId(A) != apiKeyOwner(B).
  // ───────────────────────────────────────────────────────────────────────
  it('5. different-owner JWT + API key -> 401 (P0.3 bypass regression)', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Authorization', `Bearer ${advAToken}`)
      .set('x-api-key', keyB)
      .expect(401);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 6. revoked JWT session + valid API key -> 401 (revocation still checked).
  // ───────────────────────────────────────────────────────────────────────
  it('6. revoked JWT session + valid API key -> 401', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Authorization', `Bearer ${advARevokedToken}`)
      .set('x-api-key', keyA)
      .expect(401);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 7. expired JWT (exp in past) + valid API key -> 401.
  // ───────────────────────────────────────────────────────────────────────
  it('7. expired JWT + valid API key -> 401', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Authorization', `Bearer ${advAExpiredToken}`)
      .set('x-api-key', keyA)
      .expect(401);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 8. banned user JWT -> 401 (status check in jwt.strategy.validate).
  // ───────────────────────────────────────────────────────────────────────
  it('8. banned user JWT -> 401', async () => {
    await request(server())
      .get('/api/v1/developer/dashboard')
      .set('Authorization', `Bearer ${banDevToken}`)
      .expect(401);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 9. banned API-key owner -> rejected.
  //    The real ApiKeyService.validateApiKey throws BadRequestException (400)
  //    for an owner whose status is not active, so the app returns 400 here
  //    (not 401). The point — a banned owner's key is refused — holds.
  // ───────────────────────────────────────────────────────────────────────
  it('9. banned API-key owner -> 400 (rejected)', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('x-api-key', keyBannedOwner)
      .expect(400);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 10. cookie JWT (access_token) + API key.
  // ───────────────────────────────────────────────────────────────────────
  it('10a. cookie JWT + same-owner API key -> 200', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Cookie', `access_token=${advAToken}`)
      .set('x-api-key', keyA)
      .expect(200);
  });

  it('10b. cookie JWT + different-owner API key -> 401', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Cookie', `access_token=${advAToken}`)
      .set('x-api-key', keyB)
      .expect(401);
  });
  // 10c/10d/10e/10f — `__Host-access_token` (the production-secure cookie name)
  // MUST also be detected as a JWT credential, so it is forced through JWT
  // validation when combined with an API key. Regression for the hasAccessCookie
  // bug where only `access_token` was detected (a `__Host-access_token` + API
  // key request was treated as API-key-only, bypassing revocation checks).
  it('10c. __Host-access_token cookie JWT + same-owner API key -> 200', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Cookie', `__Host-access_token=${advAToken}`)
      .set('x-api-key', keyA)
      .expect(200);
  });

  it('10d. __Host-access_token cookie JWT + different-owner API key -> 401', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Cookie', `__Host-access_token=${advAToken}`)
      .set('x-api-key', keyB)
      .expect(401);
  });

  it('10e. __Host-access_token cookie JWT (revoked session) + API key -> 401', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Cookie', `__Host-access_token=${advARevokedToken}`)
      .set('x-api-key', keyA)
      .expect(401);
  });

  it('10f. __Host-access_token cookie JWT (expired) + API key -> 401', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Cookie', `__Host-access_token=${advAExpiredToken}`)
      .set('x-api-key', keyA)
      .expect(401);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 11. malformed bearer token + valid API key -> 401.
  // ───────────────────────────────────────────────────────────────────────
  it('11. malformed bearer token + valid API key -> 401', async () => {
    await request(server())
      .get('/api/v1/advertiser/profile')
      .set('Authorization', 'Bearer not.a.valid.jwt')
      .set('x-api-key', keyA)
      .expect(401);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 12. API-key header on a JWT-only route (no @AllowApiKey) -> rejected.
  //    /developer/dashboard is JWT-only (DeveloperController has no
  //    @AllowApiKey). The ApiKeyGuard intentionally passes the header through
  //    on non-opted-in routes (to avoid leaking route existence); the JWT
  //    guard then rejects the missing credential, so the app returns 401
  //    (the brief guessed 403, but 401 is the real, by-design status).
  // ───────────────────────────────────────────────────────────────────────
  it('12. API-key header on a JWT-only route -> 401 (rejected, no @AllowApiKey)', async () => {
    await request(server()).get('/api/v1/developer/dashboard').set('x-api-key', keyA).expect(401);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 13. API key belonging to an advertiser on a developer-only endpoint ->
  //     403 (cross-role rejected). /ledger/balance is @AllowApiKey + scoped to
  //     @Roles('developer'); an advertiser-owned key passes scope check then
  //     fails RolesGuard.
  // ───────────────────────────────────────────────────────────────────────
  it('13. advertiser-owned API key on a developer-only endpoint -> 403 (cross-role)', async () => {
    await request(server()).get('/api/v1/ledger/balance').set('x-api-key', keyA).expect(403);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 14. no valid identity to a tenant route -> 401 and no tenant data leak.
  //     Without any credential the global ApiKeyGuard passes through and the
  //     JwtAuthGuard rejects before the handler ever runs, so no undefined
  //     userId can slip through a Prisma WHERE clause and return another
  //     user's data.
  // ───────────────────────────────────────────────────────────────────────
  it('14. no valid identity -> 401 (handler never runs, no cross-tenant data)', async () => {
    const res = await request(server()).get('/api/v1/advertiser/profile').expect(401);
    // Sanity: a rejection must not hand back a 200 with a real profile.
    expect(res.status).not.toBe(200);
  });
});
