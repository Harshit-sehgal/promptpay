import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RejectApiKeyGuard } from '../common/guards/reject-api-key.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AgentController } from './agent.controller';

describe('AgentController analytics authorization', () => {
  it('requires JWT, developer role, and rejects API keys for agent analytics', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AgentController);
    const roles = Reflect.getMetadata(ROLES_KEY, AgentController);

    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard, RejectApiKeyGuard]),
    );
    expect(roles).toEqual(['developer']);
  });
});
