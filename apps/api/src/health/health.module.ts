import { Module } from '@nestjs/common';

import { PrismaModule } from '../config/prisma.module';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import { HealthController } from './health.controller';
import { RedisHealthService } from './redis-health.service';

@Module({
  // RuntimeConfigModule supplies the wait launch mode published on `GET /health`
  // so shipped clients and the web app can state the settlement status honestly
  // instead of showing an empty earnings surface with no explanation (A-089).
  imports: [PrismaModule, RuntimeConfigModule],
  controllers: [HealthController],
  providers: [RedisHealthService],
})
export class HealthModule {}
