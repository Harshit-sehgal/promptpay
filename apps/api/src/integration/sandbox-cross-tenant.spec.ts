/**
 * Phase 2 (plan) proof: sandbox idempotency is ACCOUNT-scoped, not global.
 *
 * The unit spec proves the serializable/advisory-lock logic with mocked
 * Prisma. This file proves the same contracts against the REAL AppModule and
 * the real :5433 test database:
 *
 *  - different users, same idempotency key  -> independent grants, no clash
 *  - same user, different environment, same key -> independent accounts
 *  - concurrent duplicate faucet claims     -> exactly ONE mutation
 *  - account erasure (status=deleted)       -> sandbox rows retained for
 *    reconciliation; hard row deletion cascades cleanly (no orphans)
 *
 * Environment gating: the sandbox module is fail-closed outside
 * test/sandbox deployments; this spec boots with ATEVA_ENVIRONMENT_KIND=test
 * and a dedicated ATEVA_ENVIRONMENT_ID so it can never touch a real-money
 * environment.
 */
import * as bcrypt from 'bcryptjs';
import type { Response } from 'supertest';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';

import { UserRole } from '@ateva/shared';

import { AppModule } from '../app.module';
import { ActionStepUpGuard } from '../common/guards/action-step-up.guard';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';

const BASE = '/api/v1/sandbox';
const FAUCET = `${BASE}/faucet`;

process.env.ATEVA_ENVIRONMENT_KIND = 'test';
process.env.ATEVA_ENVIRONMENT_ID = 'integration-xtest';

async function cleanSandboxRows(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "sandbox_deposit_simulations", "sandbox_payout_simulations",
      "sandbox_credit_entries", "sandbox_operations",
      "sandbox_credit_accounts", "users"
    CASCADE;
  `);
}

type TestUser = { id: string; token: string };

async function createDeveloper(app: INestApplication, email: string): Promise<TestUser> {
  const signup = await request(app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({
      email,
      password: 'Password123!',
      name: `Sandbox ${email}`,
      role: 'developer',
      country: 'US',
      ageConfirmed: true,
      termsAccepted: true,
      policyVersion: '2026-07-01',
    });
  expect(signup.status).toBe(201);
  return { id: signup.body.user.id, token: signup.body.accessToken };
}

async function faucet(app: INestApplication, token: string, key: string): Promise<Response> {
  return request(app.getHttpServer())
    .post(FAUCET)
    .set('Authorization', `Bearer ${token}`)
    .send({ idempotencyKey: key });
}

describe('Sandbox cross-tenant idempotency (real app, real DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(BruteForceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottleByRouteGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ActionStepUpGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 0,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
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
    prisma = app.get(PrismaService);
    await cleanSandboxRows(prisma);
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (app) await app.close();
  });

  it('different users with the same idempotency key get independent grants', async () => {
    const alice = await createDeveloper(app, 'sandbox-alice@ateva.com');
    const bob = await createDeveloper(app, 'sandbox-bob@ateva.com');
    const key = 'itest-shared-key-0001';

    const aliceRes = await faucet(app, alice.token, key);
    const bobRes = await faucet(app, bob.token, key);

    expect(aliceRes.status).toBe(201);
    expect(bobRes.status).toBe(201);
    expect(aliceRes.body.grantedMinor).toBe(10000);
    expect(bobRes.body.grantedMinor).toBe(10000);

    const accounts = await prisma.sandboxCreditAccount.findMany({
      where: { environmentId: 'integration-xtest' },
      orderBy: { createdAt: 'asc' },
    });
    expect(accounts).toHaveLength(2);
    const aliceAccount = accounts.find((a) => a.userId === alice.id);
    const bobAccount = accounts.find((a) => a.userId === bob.id);
    expect(aliceAccount).toBeDefined();
    expect(bobAccount).toBeDefined();
    // The shared key produced one entry per account, never a cross-account clash.
    expect(
      await prisma.sandboxCreditEntry.count({
        where: { accountId: { in: [aliceAccount!.id, bobAccount!.id] }, idempotencyKey: key },
      }),
    ).toBe(2);
  });

  it('the same user in a different environment may reuse a key', async () => {
    const carol = await createDeveloper(app, 'sandbox-carol@ateva.com');
    const key = 'itest-env-scoped-key-0002';

    const first = await faucet(app, carol.token, key);
    expect(first.status).toBe(201);

    // A second app instance booted against the same database but with a
    // different environment id represents a separate sandbox deployment.
    process.env.ATEVA_ENVIRONMENT_ID = 'integration-xtest-2';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(BruteForceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottleByRouteGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ActionStepUpGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 0,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();
    const app2 = moduleFixture.createNestApplication();
    app2.setGlobalPrefix('api');
    app2.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app2.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app2.init();
    try {
      const second = await faucet(app2, carol.token, key);
      expect(second.status).toBe(201);

      const accounts = await prisma.sandboxCreditAccount.findMany({
        where: { userId: carol.id },
      });
      expect(accounts).toHaveLength(2);
      expect(accounts.map((a) => a.environmentId).sort()).toEqual([
        'integration-xtest',
        'integration-xtest-2',
      ]);
    } finally {
      await app2.close();
      process.env.ATEVA_ENVIRONMENT_ID = 'integration-xtest';
    }
  });

  it('concurrent duplicate faucet claims mutate exactly once', async () => {
    const dave = await createDeveloper(app, 'sandbox-dave@ateva.com');
    const key = 'itest-concurrent-key-0003';

    const [a, b] = await Promise.all([faucet(app, dave.token, key), faucet(app, dave.token, key)]);

    // One call performs the grant, the other is an idempotent replay. The
    // replay is still HTTP 201 (the body carries duplicate: true); exactly one
    // mutation must have happened.
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // The idempotent replay re-reads the committed grant (so both bodies
    // report grantedMinor 10000); the duplicate flag marks the replay.
    const dups = [a, b].filter((r) => r.body.duplicate === true);
    const fresh = [a, b].filter((r) => r.body.duplicate !== true);
    expect(dups).toHaveLength(1);
    expect(fresh).toHaveLength(1);
    for (const r of [a, b]) {
      expect(r.body.grantedMinor).toBe(10000);
      expect(r.body.exhausted).toBe(false);
    }

    const account = await prisma.sandboxCreditAccount.findUniqueOrThrow({
      where: { userId_environmentId: { userId: dave.id, environmentId: 'integration-xtest' } },
    });
    expect(account.balanceMinor).toBe(10_000n);
    expect(
      await prisma.sandboxCreditEntry.count({
        where: { accountId: account.id, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it('erasure keeps sandbox rows; hard delete cascades without orphans', async () => {
    const eve = await createDeveloper(app, 'sandbox-eve@ateva.com');
    const key = 'itest-retention-key-0004';
    expect((await faucet(app, eve.token, key)).status).toBe(201);

    // Account erasure marks status=deleted and anonymizes PII; it does not
    // remove the row, so sandbox financial evidence must survive for
    // reconciliation.
    await prisma.user.update({ where: { id: eve.id }, data: { status: 'deleted' } });
    expect(
      await prisma.sandboxCreditAccount.count({
        where: { userId: eve.id, environmentId: 'integration-xtest' },
      }),
    ).toBe(1);
    expect(
      await prisma.sandboxCreditEntry.count({
        where: { account: { userId: eve.id, environmentId: 'integration-xtest' } },
      }),
    ).toBe(1);

    // A hard row deletion (privacy erasure of a never-used account) cascades
    // the whole sandbox subtree; no orphaned rows may remain.
    await prisma.user.delete({ where: { id: eve.id } });
    expect(await prisma.sandboxCreditAccount.count({ where: { userId: eve.id } })).toBe(0);
    expect(
      await prisma.sandboxCreditEntry.count({
        where: { environmentId: 'integration-xtest', idempotencyKey: key },
      }),
    ).toBe(0);
    expect(
      await prisma.sandboxOperation.count({
        where: { environmentId: 'integration-xtest', idempotencyKey: key },
      }),
    ).toBe(0);
  });

  it('role gates: advertisers cannot claim faucet, developers cannot simulate deposits', async () => {
    const frank = await createDeveloper(app, 'sandbox-frank@ateva.com');
    const passwordHash = await bcrypt.hash('Password123!', 12);
    const advertiser = await prisma.user.create({
      data: {
        email: 'sandbox-advertiser@ateva.com',
        passwordHash,
        name: 'Sandbox Advertiser',
        role: UserRole.ADVERTISER,
        country: 'US',
        status: 'active',
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'sandbox-advertiser@ateva.com', password: 'Password123!' });
    expect(login.status).toBe(200);

    const advFaucet = await faucet(app, login.body.accessToken, 'itest-role-key-0005');
    expect(advFaucet.status).toBe(403);

    const devDeposit = await request(app.getHttpServer())
      .post(`${BASE}/deposits`)
      .set('Authorization', `Bearer ${frank.token}`)
      .send({
        amountMinor: 1000,
        outcome: 'approved',
        idempotencyKey: 'itest-role-key-0006',
      });
    expect(devDeposit.status).toBe(403);
    expect(advertiser.id).toBeTruthy();
  });
});
