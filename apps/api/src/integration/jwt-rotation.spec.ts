import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRole } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from '../auth/__fixtures__/test-keys';
import { TEST_JWT_PRIVATE_KEY_2, TEST_JWT_PUBLIC_KEY_2 } from '../auth/__fixtures__/test-keys-2';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';

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

async function buildApp() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(BruteForceGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(ThrottleByRouteGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}

async function login(app: INestApplication) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: 'rotation@waitlayer.com', password: 'Password123!' })
    .expect(200);
  return res.body.accessToken as string;
}

/**
 * End-to-end JWT key rotation test (P1 #15).
 *
 * Verifies the zero-downtime rotation contract:
 *  - Tokens signed with the previous key continue to verify while the key
 *    remains in JWT_PUBLIC_KEYS.
 *  - Tokens signed with the new key verify after rotation.
 *  - Once the previous key is removed, old tokens are rejected.
 */
describe('JWT key rotation end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const originalPrivateKey = process.env.JWT_PRIVATE_KEY;
  const originalPublicKey = process.env.JWT_PUBLIC_KEY;
  const originalPublicKeys = process.env.JWT_PUBLIC_KEYS;

  beforeAll(async () => {
    process.env.JWT_PRIVATE_KEY = TEST_JWT_PRIVATE_KEY;
    process.env.JWT_PUBLIC_KEY = TEST_JWT_PUBLIC_KEY;
    delete process.env.JWT_PUBLIC_KEYS;

    app = await buildApp();
    prisma = app.get(PrismaService);
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Password123!', 12);
    await prisma.user.create({
      data: {
        email: 'rotation@waitlayer.com',
        passwordHash,
        name: 'Rotation User',
        role: UserRole.DEVELOPER,
        country: 'US',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    if (prisma) await cleanDb(prisma);
    if (app) await app.close();

    if (originalPrivateKey === undefined) delete process.env.JWT_PRIVATE_KEY;
    else process.env.JWT_PRIVATE_KEY = originalPrivateKey;
    if (originalPublicKey === undefined) delete process.env.JWT_PUBLIC_KEY;
    else process.env.JWT_PUBLIC_KEY = originalPublicKey;
    if (originalPublicKeys === undefined) delete process.env.JWT_PUBLIC_KEYS;
    else process.env.JWT_PUBLIC_KEYS = originalPublicKeys;
  });

  it('verifies a token signed with the current key', async () => {
    const token = await login(app);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('continues to verify pre-rotation tokens while the old key is trusted', async () => {
    const oldToken = await login(app);

    // Rotate: new primary key, but keep the old public key trusted.
    process.env.JWT_PRIVATE_KEY = TEST_JWT_PRIVATE_KEY_2;
    process.env.JWT_PUBLIC_KEY = TEST_JWT_PUBLIC_KEY_2;
    process.env.JWT_PUBLIC_KEYS = TEST_JWT_PUBLIC_KEY;

    const rotatedApp = await buildApp();
    try {
      await request(rotatedApp.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(200);
    } finally {
      await rotatedApp.close();
    }
  });

  it('verifies tokens signed with the new key after rotation', async () => {
    const rotatedApp = await buildApp();
    try {
      const newToken = await login(rotatedApp);
      await request(rotatedApp.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);
    } finally {
      await rotatedApp.close();
    }
  });

  it('rejects tokens signed with a rotated-out key', async () => {
    const oldToken = await login(app);

    // Now only trust the new key.
    process.env.JWT_PRIVATE_KEY = TEST_JWT_PRIVATE_KEY_2;
    process.env.JWT_PUBLIC_KEY = TEST_JWT_PUBLIC_KEY_2;
    delete process.env.JWT_PUBLIC_KEYS;

    const newApp = await buildApp();
    try {
      await request(newApp.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);
    } finally {
      await newApp.close();
    }
  });
});
