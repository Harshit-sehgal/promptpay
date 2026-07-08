import { describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HttpException } from '@nestjs/common';

import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { HealthController } from './health.controller';

describe('HealthController route security', () => {
  it('keeps the liveness endpoint unguarded for infrastructure probes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, HealthController.prototype.check);
    expect(guards).toBeUndefined();
  });

  it('guards operational metrics behind admin JWT roles', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, HealthController.prototype.metrics);
    const roles = Reflect.getMetadata(ROLES_KEY, HealthController.prototype.metrics);

    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    expect(roles).toEqual(['admin', 'super_admin']);
  });
});

describe('HealthController readiness (A-042)', () => {
  it('returns ok when DB and Redis are healthy', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const redis = { check: vi.fn().mockResolvedValue({ status: 'connected' }) };
    const controller = new HealthController(prisma as never, redis as never);

    const res = await controller.ready();
    expect(res.status).toBe('ok');
  });

  it('throws 503 when the database is unreachable', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('down')) };
    const redis = { check: vi.fn().mockResolvedValue({ status: 'connected' }) };
    const controller = new HealthController(prisma as never, redis as never);

    await expect(controller.ready()).rejects.toBeInstanceOf(HttpException);
    await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
  });

  it('throws 503 when Redis is down', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{}]) };
    const redis = { check: vi.fn().mockResolvedValue({ status: 'error' }) };
    const controller = new HealthController(prisma as never, redis as never);

    await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
  });
});
