import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../config/prisma.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private prisma: PrismaService) {}

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

    return checks;
  }
}