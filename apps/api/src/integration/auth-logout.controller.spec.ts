import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { UserRole } from '@waitlayer/shared';

import { AppModule } from '../app.module';
import { ActionStepUpGuard } from '../common/guards/action-step-up.guard';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from '../common/guards/throttle-by-route.guard';
import { PrismaService } from '../config/prisma.service';

async function cleanDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "users", "sessions" CASCADE;`);
}

describe('Auth logout / refresh controller integration (P0.2/P0.3)', () => {
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
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Password123!', 12);
    await prisma.user.create({
      data: {
        email: 'logout-controller@waitlayer.com',
        passwordHash,
        name: 'Logout Controller Test',
        role: UserRole.DEVELOPER,
        country: 'US',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    if (prisma) await cleanDb(prisma);
    if (app) await app.close();
  });

  it('POST /auth/refresh rejects an access token (P0.2)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'logout-controller@waitlayer.com', password: 'Password123!' })
      .expect(200);

    const accessToken = loginRes.body.accessToken;

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: accessToken })
      .expect(401);
  });

  it('POST /auth/logout revokes the access-token session (P0.3)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'logout-controller@waitlayer.com', password: 'Password123!' })
      .expect(200);

    const accessToken = loginRes.body.accessToken;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    // The access token is now rejected.
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('POST /auth/logout/refresh revokes the refresh-token session (P0.3)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'logout-controller@waitlayer.com', password: 'Password123!' })
      .expect(200);

    const refreshToken = loginRes.body.refreshToken;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout/refresh')
      .send({ refreshToken })
      .expect(200);

    // The refresh token is now rejected.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('POST /auth/logout/refresh rejects an expired refresh token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout/refresh')
      .send({ refreshToken: 'expired-or-invalid-token' })
      .expect(401);
  });
});
