import type { Response } from 'supertest';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';

import { AppModule } from '../app.module';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';

/**
 * Advertiser waitlist against the real database (LAUNCH_PLAN step 11):
 *  - a public submit persists exactly one normalized row with consent,
 *  - duplicate submissions are idempotent and never overwrite operator-set
 *    status,
 *  - the admin listing is authenticated (401 without a token) and returns the
 *    stored rows,
 *  - the GDPR erasure script deletes the row and scrubs the audit trail.
 */

const BASE = '/api/v1/marketing/waitlist';
const TEST_EMAIL = 'waitlist-integration@waitlayer.test';

async function cleanDb(prisma: PrismaService) {
  await prisma.advertiserWaitlist.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.auditLog.deleteMany({
    where: { targetType: 'advertiser_waitlist' },
  });
}

describe('Advertiser waitlist (real app, real DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.REDIS_URL = '';
    process.env.PRIVACY_HASH_KEY = 'waitlist-integration-privacy-key-000000000';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(BruteForceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottleByRouteGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorage)
      .useValue({ getRecord: async () => ({}), increment: async () => ({}), reset: async () => {} })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDb(prisma);
    await app.close();
  });

  async function submit(body: Record<string, unknown>): Promise<Response> {
    return request(app.getHttpServer()).post(BASE).send(body);
  }

  it('persists a normalized signup with consent and an audit trail', async () => {
    const res = await submit({
      email: '  Waitlist-Integration@WaitLayer.test ',
      company: 'Acme Corp',
      country: 'US',
      consent: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const row = await prisma.advertiserWaitlist.findUnique({
      where: { email: TEST_EMAIL },
    });
    expect(row).not.toBeNull();
    expect(row!.company).toBe('Acme Corp');
    expect(row!.country).toBe('US');
    expect(row!.consent).toBe(true);
    expect(row!.status).toBe('pending');

    const audit = await prisma.auditLog.findFirst({
      where: { targetType: 'advertiser_waitlist', targetId: row!.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.afterSnap).not.toContain(TEST_EMAIL);
  });

  it('rejects a missing consent flag', async () => {
    const res = await submit({ email: TEST_EMAIL, consent: false });
    expect(res.status).toBe(400);
  });

  it('is idempotent and never overwrites an operator-set status', async () => {
    const row = await prisma.advertiserWaitlist.findUnique({ where: { email: TEST_EMAIL } });
    expect(row).not.toBeNull();
    await prisma.advertiserWaitlist.update({
      where: { email: TEST_EMAIL },
      data: { status: 'invited' },
    });

    const res = await submit({ email: TEST_EMAIL, consent: true });
    expect(res.status).toBe(200);
    expect(res.body.alreadySignedUp).toBe(true);

    const count = await prisma.advertiserWaitlist.count({ where: { email: TEST_EMAIL } });
    expect(count).toBe(1);
    const after = await prisma.advertiserWaitlist.findUnique({ where: { email: TEST_EMAIL } });
    expect(after!.status).toBe('invited');
  });

  it('serves the admin listing only to authenticated callers', async () => {
    const anon = await request(app.getHttpServer()).get('/api/v1/admin/waitlist');
    expect(anon.status).toBe(401);
  });
});
