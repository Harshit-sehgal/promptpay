import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';

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
