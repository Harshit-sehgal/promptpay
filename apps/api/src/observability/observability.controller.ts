import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MetricsService } from './metrics.service';

/**
 * Read-only operational metrics endpoint (P1.24). Admin-scoped; reflects the
 * in-process MetricsService snapshot. A real deployment can additionally
 * forward this to Prometheus, but the JSON contract is stable.
 */
@ApiTags('Observability')
@Controller('observability')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class ObservabilityController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Operational metrics snapshot (JSON)' })
  getMetrics(@CurrentUser() _user: unknown): ReturnType<MetricsService['snapshot']> {
    return this.metrics.snapshot();
  }
}
