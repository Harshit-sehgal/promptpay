import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApiKeyService } from '../developer/api-key.service';
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
    getHistoryForAdmin: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getPlatformBreakdown: vi.fn().mockResolvedValue({}),
  };
}

interface BootstrapOpts {
  /** JWT role stamped by the JwtAuthGuard override (JWT-only path). */
  role?: string;
  /** When set, simulates an `x-api-key` request with this header value. */
  apiKeyHeader?: string;
  /** Scopes carried by the resolved API key. */
  apiKeyScopes?: string[];
  /** Role of the API key owner (synthesized req.user). */
  apiKeyOwnerRole?: string;
}

const apps: INestApplication[] = [];

async function bootstrap(opts: BootstrapOpts = {}): Promise<INestApplication> {
  const mockApiKeyService = {
    validateApiKey: vi.fn().mockImplementation(() => {
      if (opts.apiKeyHeader === undefined) return Promise.resolve(null);
      return Promise.resolve({
        id: 'key-1',
        ownerId: 'owner-1',
        advertiserId: null,
        scopes: opts.apiKeyScopes ?? [],
        owner: { role: opts.apiKeyOwnerRole ?? 'developer' },
      });
    }),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [LedgerController],
    providers: [
      { provide: LedgerService, useValue: buildService() },
      Reflector,
      RolesGuard,
      { provide: ApiKeyService, useValue: mockApiKeyService },
      { provide: APP_GUARD, useClass: ApiKeyGuard },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx) => {
        const req = ctx.switchToHttp().getRequest();
        // Only stamp a JWT user when an API key did not already synthesize one.
        if (!req.user) {
          req.user = { id: 'u-1', sub: 'u-1', role: opts.role ?? '' };
        }
        return true;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  apps.push(app);
  return app;
}

describe('LedgerController developer routes require developer role (A-008)', () => {
  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it('allows a developer to read their own ledger balance', async () => {
    const app = await bootstrap({ role: 'developer' });
    const res = await request(app.getHttpServer()).get('/ledger/balance');
    expect(res.status).toBe(200);
  });

  it('allows a developer to read their earnings history', async () => {
    const app = await bootstrap({ role: 'developer' });
    const res = await request(app.getHttpServer()).get('/ledger/history');
    expect(res.status).toBe(200);
  });

  it('rejects a non-developer (advertiser) from the developer ledger routes', async () => {
    const app = await bootstrap({ role: 'advertiser' });
    const res = await request(app.getHttpServer()).get('/ledger/balance');
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request (no role) from the developer ledger routes', async () => {
    const app = await bootstrap({ role: '' });
    const res = await request(app.getHttpServer()).get('/ledger/balance');
    expect(res.status).toBe(403);
  });

  it('allows an API key carrying the ledger:read scope (developer owner)', async () => {
    const app = await bootstrap({
      apiKeyHeader: 'key',
      apiKeyScopes: ['ledger:read'],
      apiKeyOwnerRole: 'developer',
    });
    const res = await request(app.getHttpServer()).get('/ledger/balance').set('x-api-key', 'key');
    expect(res.status).toBe(200);
  });

  it('rejects an API key WITHOUT the ledger:read scope', async () => {
    const app = await bootstrap({
      apiKeyHeader: 'key',
      apiKeyScopes: [],
      apiKeyOwnerRole: 'developer',
    });
    const res = await request(app.getHttpServer()).get('/ledger/breakdown').set('x-api-key', 'key');
    expect(res.status).toBe(403);
  });

  it('rejects an API key (no scope) from admin ledger routes — admin role required', async () => {
    const app = await bootstrap({
      apiKeyHeader: 'key',
      apiKeyScopes: [],
      apiKeyOwnerRole: 'developer',
    });
    const res = await request(app.getHttpServer())
      .get('/ledger/admin/breakdown')
      .set('x-api-key', 'key');
    expect(res.status).toBe(403);
  });

  it('allows an admin JWT through the admin ledger routes', async () => {
    const app = await bootstrap({ role: 'admin' });
    const res = await request(app.getHttpServer()).get('/ledger/admin/breakdown');
    expect(res.status).toBe(200);
  });
});
