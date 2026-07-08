import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

function buildService() {
  return {
    getAvailableBalance: vi.fn().mockResolvedValue(0),
    getPendingBalance: vi.fn().mockResolvedValue(0),
    getTotalEarnings: vi.fn().mockResolvedValue(0),
    getPaidOutTotal: vi.fn().mockResolvedValue(0),
    getEarningsBreakdown: vi.fn().mockResolvedValue([]),
    getEarningsHistory: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
}

async function bootstrap(role: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [LedgerController],
    providers: [
      { provide: LedgerService, useValue: buildService() },
      Reflector,
      RolesGuard,
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = { id: 'u-1', sub: 'u-1', role };
        return true;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('LedgerController developer routes require developer role (A-008)', () => {
  let app: INestApplication;

  afterAll(async () => {
    if (app) await app.close();
  });

  it('allows a developer to read their own ledger balance', async () => {
    app = await bootstrap('developer');
    const res = await request(app.getHttpServer()).get('/ledger/balance');
    expect(res.status).toBe(200);
  });

  it('allows a developer to read their earnings history', async () => {
    app = await bootstrap('developer');
    const res = await request(app.getHttpServer()).get('/ledger/history');
    expect(res.status).toBe(200);
  });

  it('rejects a non-developer (advertiser) from the developer ledger routes', async () => {
    app = await bootstrap('advertiser');
    const res = await request(app.getHttpServer()).get('/ledger/balance');
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request (no role) from the developer ledger routes', async () => {
    app = await bootstrap('');
    const res = await request(app.getHttpServer()).get('/ledger/balance');
    expect(res.status).toBe(403);
  });
});
