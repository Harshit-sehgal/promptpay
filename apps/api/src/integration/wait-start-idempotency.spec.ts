import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { signPayload, UserRole } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { ActionStepUpGuard } from '../common/guards/action-step-up.guard';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';
import { BILLABLE_WAIT_SIGNALS } from '../extension/test/wait-fixtures';

/**
 * P1 #20 — wait-start idempotency ordering.
 *
 * Required order: verify user/device/signature → locate idempotency key →
 * return the existing result when payload identity matches → reject
 * conflicting idempotency reuse → reject a waitStateId reused under another
 * key → create, handling the unique-race winner.
 *
 * Before the fix, the duplicate-waitStateId check ran FIRST, so an exact
 * retry always got 409 instead of the original row.
 */
describe('wait-start idempotency ordering (P1 #20)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let previousRedisUrl: string | undefined;
  let devToken: string;
  let deviceId: string;
  let deviceEventSecret: string;

  beforeAll(async () => {
    previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = '';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
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

    await prisma.waitStateEvent.deleteMany();
    await prisma.device.deleteMany();
    await prisma.userSettings.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();

    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: 'wait-idem-dev@test.com',
        password: 'Password123!',
        role: UserRole.DEVELOPER,
        name: 'Wait Idem Dev',
        country: 'US',
        ageConfirmed: true,
        termsAccepted: true,
      })
      .expect(201);
    devToken = signup.body.accessToken;

    await request(app.getHttpServer())
      .patch('/api/v1/developer/settings')
      .set('Authorization', `Bearer ${devToken}`)
        .send({ adsEnabled: true, waitTelemetryEnabled: true })
      .expect(200);

    const device = await request(app.getHttpServer())
      .post('/api/v1/extension/register-device')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        toolType: 'vscode',
        fingerprintHash: 'wait-idem-fingerprint',
        extensionVersion: '1.0.0',
        platform: 'linux',
      })
      .expect(200);
    deviceId = device.body.id;
    deviceEventSecret = device.body.eventSecret;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
  });

  function signedStart(waitStateId: string, idempotencyKey: string) {
    const payload = {
      deviceId,
      sessionId: 'wait-idem-session',
      toolType: 'vscode',
      waitStateId,
      idempotencyKey,
      signals: BILLABLE_WAIT_SIGNALS,
    };
    return { ...payload, signature: signPayload(payload, deviceEventSecret) };
  }

  function postStart(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/extension/wait-state/start')
      .set('Authorization', `Bearer ${devToken}`)
      .send(body);
  }

  it('sequential exact retry returns the original row, not a 409', async () => {
    const body = signedStart('ws-seq-retry', 'ws-seq-retry-key');
    const first = await postStart(body).expect(200);
    const retry = await postStart(body).expect(200);

    expect(retry.body.id).toBe(first.body.id);
    const rows = await prisma.waitStateEvent.findMany({
      where: { waitStateId: 'ws-seq-retry', eventType: 'wait_state_start' },
    });
    expect(rows).toHaveLength(1);
  });

  it('rejects conflicting reuse of the same idempotency key under a different payload', async () => {
    await postStart(signedStart('ws-key-a', 'ws-shared-key')).expect(200);
    // Same key, different waitStateId — a conflicting replay, not a retry.
    await postStart(signedStart('ws-key-b', 'ws-shared-key')).expect(409);
  });

  it('rejects a waitStateId reused under a different idempotency key', async () => {
    await postStart(signedStart('ws-dup', 'ws-dup-key-1')).expect(200);
    const res = await postStart(signedStart('ws-dup', 'ws-dup-key-2'));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/wait_state_start event already exists/);
  });

  it('concurrent exact retries converge on a single persisted row', async () => {
    const body = signedStart('ws-concurrent', 'ws-concurrent-key');
    const results = await Promise.all(Array.from({ length: 5 }, () => postStart(body)));

    const ids = new Set<string>();
    for (const res of results) {
      expect(res.status).toBe(200);
      ids.add(res.body.id);
    }
    expect(ids.size).toBe(1);
    const rows = await prisma.waitStateEvent.findMany({
      where: { waitStateId: 'ws-concurrent', eventType: 'wait_state_start' },
    });
    expect(rows).toHaveLength(1);
  });
});
