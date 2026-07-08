import { Module } from '@nestjs/common';
import { PrismaModule } from '../config/prisma.module';
import { HealthController } from './health.controller';
import { RedisHealthService } from './redis-health.service';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [RedisHealthService],
})
export class HealthModule {}