import { Controller, Get, HttpCode, HttpException, HttpStatus, Logger, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../config/prisma.service';
import { RedisHealthService } from './redis-health.service';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisHealthService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check() {
    const checks: Record<string, unknown> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };

    // Database connectivity check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'connected';
    } catch {
      checks['database'] = { status: 'error' as const, error: 'Database unreachable' };
      this.logger.error('Health check: database unreachable');
    }

    // Redis connectivity check (abuse controls / rate limiting backing store)
    const redis = await this.redis.check();
    checks['redis'] = redis;

    return checks;
  }

  /**
   * Readiness probe — used by Docker/K8s healthchecks and load balancers.
   *
   * Unlike `GET /health` (liveness, which always returns HTTP 200 so a
   * crashed process can be detected and restarted), readiness returns a
   * non-200 status when a required dependency (Postgres, Redis) is
   * unavailable. This prevents routing traffic to an API that cannot safely
   * serve it (A-042).
   */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async ready() {
    const checks: Record<string, unknown> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
    let ready = true;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'connected';
    } catch {
      ready = false;
      checks['database'] = { status: 'error' as const, error: 'Database unreachable' };
      this.logger.error('Readiness: database unreachable');
    }

    const redis = await this.redis.check();
    checks['redis'] = redis;
    if (redis.status !== 'connected') {
      ready = false;
    }

    if (!ready) {
      throw new HttpException(checks, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return checks;
  }

  @Get('metrics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @HttpCode(HttpStatus.OK)
  async metrics() {
    const mem = process.memoryUsage();
    const checks: Record<string, unknown> = {
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
      },
      database: 'unknown',
    };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'connected';

      const redis = await this.redis.check();
      checks['redis'] = redis;

      const [pendingPayouts, openFraudFlags, activeDevelopers] = await Promise.all([
        this.prisma.payoutRequest.count({ where: { status: { in: ['requested', 'under_review', 'approved', 'processing'] } } }),
        this.prisma.fraudFlag.count({ where: { status: 'open' } }),
        this.prisma.user.count({ where: { role: 'developer', status: 'active' } }),
      ]);
      checks['counts'] = {
        payoutsInFlight: pendingPayouts,
        openFraudFlags,
        activeDevelopers,
      };
    } catch {
      checks['database'] = { status: 'error' as const, error: 'Database unreachable' };
      this.logger.error('Metrics: database unreachable');
    }

    return checks;
  }
}
