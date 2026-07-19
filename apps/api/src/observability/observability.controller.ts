import { Request, Response } from 'express';
import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MetricsService, MetricsSnapshot } from './metrics.service';

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
  @ApiOperation({ summary: 'Operational metrics (JSON snapshot or Prometheus text exposition)' })
  getMetrics(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() _user: unknown,
  ): MetricsSnapshot | string {
    const accept = req.headers['accept'];
    const wantPrometheus =
      typeof accept === 'string' && accept.toLowerCase().includes('text/plain');
    if (wantPrometheus) {
      // Externalizable durable metrics: Prometheus scrapes this endpoint
      // (pull model) to build a time series, historical dashboards and
      // Alertmanager thresholds across replicas (P1.24).
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      return this.metrics.toPrometheus();
    }
    return this.metrics.snapshot();
  }
}
